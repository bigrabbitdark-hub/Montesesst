import { BadRequestException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PERMISSIONS } from '../../common/permissions';
import { mapPgError } from '../../common/pg-error.util';
import { CATALOGO_PERMISSOES, ORDEM_PERMISSOES, PERMISSOES_SENSIVEIS } from './permissoes-catalogo';

const ordenar = (xs: string[]) => [...xs].sort((a, b) => ORDEM_PERMISSOES.indexOf(a) - ORDEM_PERMISSOES.indexOf(b));

export type AuditCtx = { role: string; method: string; path: string; ip?: string | null };

// Permissões RBAC dos sócios (somente admin). Sem e-mail em nenhuma resposta.
@Injectable()
export class PermissoesAdminService {
  async listar(client: PoolClient) {
    // Admin lê `users` direto: inclui sócios não ativos que ainda têm permissões.
    const s = await client.query(
      `SELECT id, full_name AS nome, status FROM users
        WHERE role = 'socio' AND (status = 'ativo' OR id IN (SELECT user_id FROM socio_permissions))
        ORDER BY full_name, id`,
    );
    const p = await client.query('SELECT user_id, permission FROM socio_permissions');
    const por = new Map<string, string[]>();
    for (const r of p.rows) por.set(r.user_id, [...(por.get(r.user_id) ?? []), r.permission]);
    return {
      catalogo: { grupos: CATALOGO_PERMISSOES },
      socios: s.rows.map((x: any) => ({ id: x.id as string, nome: x.nome as string, ativo: x.status === 'ativo', permissoes: ordenar(por.get(x.id) ?? []) })),
    };
  }

  // A auditoria é gravada na MESMA transação do chamador: se o INSERT falhar, tudo sofre ROLLBACK.
  async definir(client: PoolClient, adminId: string, userId: string, permissoes: string[], confirmarSensiveis: boolean, ctx?: AuditCtx) {
    const validas = PERMISSIONS as readonly string[];
    if (new Set(permissoes).size !== permissoes.length || permissoes.some((x) => !validas.includes(x))) {
      throw new BadRequestException('Permissões inválidas');
    }
    const s = await client.query(`SELECT id, full_name AS nome, status FROM users WHERE id = $1 AND role = 'socio'`, [userId]);
    if (!s.rows.length) throw new BadRequestException('Responsável inválido');
    // Serializa PUTs concorrentes do mesmo usuário (DELETE+INSERT).
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`socio_permissions:${userId}`]);
    const atuais = (await client.query('SELECT permission FROM socio_permissions WHERE user_id = $1', [userId])).rows.map((r: any) => r.permission as string);
    const novas = ordenar(permissoes);
    const adicionadas = novas.filter((x) => !atuais.includes(x));
    const removidas = ordenar(atuais.filter((x) => !novas.includes(x)));
    // Sócio inativo: apenas remoção.
    if (s.rows[0].status !== 'ativo' && adicionadas.length) {
      throw new BadRequestException('Sócio inativo: só é possível remover permissões.');
    }
    if (adicionadas.some((x) => PERMISSOES_SENSIVEIS.includes(x)) && confirmarSensiveis !== true) {
      throw new BadRequestException('Confirme a concessão de permissões sensíveis.');
    }
    if (adicionadas.length || removidas.length) {
      await client.query('DELETE FROM socio_permissions WHERE user_id = $1', [userId]);
      if (novas.length) {
        try {
          await client.query(
            `INSERT INTO socio_permissions (user_id, permission, granted_by) SELECT $1, p, $3 FROM unnest($2::text[]) AS p`,
            [userId, novas, adminId],
          );
        } catch (e) { mapPgError(e); }
      }
    }
    if ((adicionadas.length || removidas.length) && ctx) {
      // Apenas ids e NOMES de permissão (nunca e-mail ou nome da pessoa). O handler só responde 200 aqui.
      await client.query(
        `INSERT INTO audit_log (actor_user_id, actor_role, action, resource_type, resource_id, method, path, status_code, ip_address, detail)
         VALUES ($1, $2, 'socio_permissions.changed', 'socio_permissions', $3, $4, $5, 200, $6, $7)`,
        [adminId, ctx.role, userId, ctx.method, ctx.path, ctx.ip ?? null,
          `usuario: ${userId}; adicionadas(${adicionadas.length}): ${adicionadas.join(', ')}; removidas(${removidas.length}): ${removidas.join(', ')}`],
      );
    }
    return { id: userId, nome: s.rows[0].nome as string, permissoes: novas, adicionadas, removidas };
  }
}
