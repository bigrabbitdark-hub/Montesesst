import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { mapPgError } from '../../common/pg-error.util';
import type { AuditCtx } from '../permissoes/permissoes-admin.service';
import { AtualizarGheDto, CriarGheDto, DefinirCargosDto } from './dto/ghe.dto';
import type { Ator } from './perigos.service';

// Colunas que o UPDATE pode tocar (defesa em profundidade além do ValidationPipe).
const PERMITIDOS = ['name', 'company_unit_id', 'environment_description', 'process_description', 'activities', 'machines_products', 'notes'] as const;
const CAMPOS_TEXTO = ['environment_description', 'process_description', 'activities', 'machines_products', 'notes'] as const;

// Lista/retorno de GHE. `expostos` é só uma CONTAGEM de funcionários ativos (cargo do GHE e, se o GHE tem
// unidade, a mesma unidade): nunca copia funcionário e nunca seleciona nome/CPF/nascimento.
const SQL_GHE = `
  SELECT g.id, g.name, g.company_unit_id,
         COALESCE((SELECT json_agg(json_build_object('id', p.id, 'name', p.name) ORDER BY lower(p.name), p.id)
                     FROM pgr_ghe_positions gp JOIN positions p ON p.id = gp.position_id
                    WHERE gp.ghe_id = g.id), '[]'::json) AS positions,
         (SELECT count(*)::int FROM employees e
           WHERE e.tenant_id = g.tenant_id AND e.status = 'ativo'
             AND e.position_id IN (SELECT position_id FROM pgr_ghe_positions WHERE ghe_id = g.id)
             AND (g.company_unit_id IS NULL OR e.company_unit_id = g.company_unit_id)) AS expostos,
         (SELECT count(*)::int FROM pgr_risks r WHERE r.ghe_id = g.id) AS riscos
    FROM pgr_ghes g`;

// Cada método recebe o `client` já no contexto do usuário (req.withTenantContext, uma transação). A tabela e a
// RLS decidem o que cada papel vê; aqui o tenant da URL é sempre conferido contra o do registro (IDOR ⇒ 404).
// A auditoria é gravada na MESMA transação (fail-closed); `detail` leva só ids e NOMES de campos.
@Injectable()
export class GhesService {
  private async exigirEmpresa(c: PoolClient, tenantId: string) {
    // Só cliente da carteira Montese, para TODOS os papéis (inclusive admin): parceiro fora do escopo ⇒ 404.
    const r = await c.query('SELECT t.id FROM tenants t WHERE t.id = $1 AND is_montese_tenant(t.id)', [tenantId]);
    if (!r.rows.length) throw new NotFoundException('Empresa não encontrada');
  }

  // Trava o GHE (FOR UPDATE) só se for do tenant da URL; senão 404 uniforme.
  private async buscarTravado(c: PoolClient, tenantId: string, id: string) {
    const r = await c.query('SELECT * FROM pgr_ghes WHERE id = $1 AND tenant_id = $2 FOR UPDATE', [id, tenantId]);
    if (!r.rows.length) throw new NotFoundException('GHE não encontrado');
    return r.rows[0];
  }

  private async exigirUnidade(c: PoolClient, tenantId: string, unitId: string) {
    const r = await c.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [unitId, tenantId]);
    if (!r.rows.length) throw new BadRequestException('Unidade não pertence a esta empresa');
  }

  private async auditar(c: PoolClient, ator: Ator, ctx: AuditCtx, action: string, gheId: string, detail: string) {
    await c.query(
      `INSERT INTO audit_log (actor_user_id, actor_role, action, resource_type, resource_id, method, path, status_code, ip_address, detail)
       VALUES ($1, $2, $3, 'pgr_ghe', $4, $5, $6, 200, $7, $8)`,
      [ator.id, ctx.role, action, gheId, ctx.method, ctx.path, ctx.ip ?? null, detail],
    );
  }

  async listar(c: PoolClient, tenantId: string) {
    await this.exigirEmpresa(c, tenantId);
    return (await c.query(`${SQL_GHE} WHERE g.tenant_id = $1 ORDER BY lower(g.name), g.id LIMIT 500`, [tenantId])).rows;
  }

  // Cargos da empresa para o fluxo guiado: só id + nome (nenhuma outra coluna).
  async cargos(c: PoolClient, tenantId: string) {
    await this.exigirEmpresa(c, tenantId);
    return (await c.query('SELECT id, name FROM positions WHERE tenant_id = $1 ORDER BY lower(name), id LIMIT 500', [tenantId])).rows;
  }

  private async projetar(c: PoolClient, tenantId: string, id: string) {
    const r = await c.query(`${SQL_GHE} WHERE g.tenant_id = $1 AND g.id = $2`, [tenantId, id]);
    if (!r.rows.length) throw new NotFoundException('GHE não encontrado');
    return r.rows[0];
  }

  async criar(c: PoolClient, ator: Ator, tenantId: string, dto: CriarGheDto, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    if (dto.company_unit_id) await this.exigirUnidade(c, tenantId, dto.company_unit_id);
    const cols = ['tenant_id', 'name', 'company_unit_id'];
    const vals: unknown[] = [tenantId, dto.name, dto.company_unit_id ?? null];
    for (const k of CAMPOS_TEXTO) {
      if (dto[k] === undefined) continue;
      cols.push(k);
      vals.push(dto[k]);
    }
    let id: string;
    try {
      id = (await c.query(
        `INSERT INTO pgr_ghes (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, vals,
      )).rows[0].id;
    } catch (e) { return mapPgError(e); }
    const campos = ['name', ...(dto.company_unit_id ? ['company_unit_id'] : []), ...CAMPOS_TEXTO.filter((k) => dto[k] !== undefined)];
    await this.auditar(c, ator, ctx, 'pgr.ghe.created', id, `ghe: ${id}; empresa: ${tenantId}; campos: ${campos.join(', ')}`);
    return this.projetar(c, tenantId, id);
  }

  async atualizar(c: PoolClient, ator: Ator, tenantId: string, id: string, dto: AtualizarGheDto, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    const campos = (PERMITIDOS as readonly string[]).filter((k) => (dto as any)[k] !== undefined);
    if (!campos.length) throw new BadRequestException('Informe ao menos um campo para alterar');
    if ((dto as any).name === null) throw new BadRequestException('name não pode ser nulo');
    await this.buscarTravado(c, tenantId, id);
    if (dto.company_unit_id) await this.exigirUnidade(c, tenantId, dto.company_unit_id);
    const vals: unknown[] = campos.map((k) => (dto as any)[k]);
    const sets = campos.map((k, i) => `${k} = $${i + 1}`);
    vals.push(id, tenantId);
    try {
      await c.query(`UPDATE pgr_ghes SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length}`, vals);
    } catch (e) { return mapPgError(e); }
    await this.auditar(c, ator, ctx, 'pgr.ghe.updated', id, `ghe: ${id}; empresa: ${tenantId}; campos: ${campos.join(', ')}`);
    return this.projetar(c, tenantId, id);
  }

  async excluir(c: PoolClient, ator: Ator, tenantId: string, id: string, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    await this.buscarTravado(c, tenantId, id);
    const n = (await c.query('SELECT count(*)::int AS n FROM pgr_risks WHERE ghe_id = $1', [id])).rows[0].n;
    if (n > 0) throw new ConflictException('O GHE possui riscos; remova-os antes de excluir');
    await c.query('DELETE FROM pgr_ghes WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    await this.auditar(c, ator, ctx, 'pgr.ghe.deleted', id, `ghe: ${id}; empresa: ${tenantId}`);
    return { id };
  }

  // Substitui o conjunto de cargos do GHE (idempotente). Cargo de outra empresa ⇒ 400.
  async definirCargos(c: PoolClient, ator: Ator, tenantId: string, id: string, dto: DefinirCargosDto, ctx: AuditCtx) {
    await this.exigirEmpresa(c, tenantId);
    await this.buscarTravado(c, tenantId, id);
    const ids = [...new Set(dto.position_ids)];
    if (ids.length) {
      const ok = await c.query('SELECT id FROM positions WHERE tenant_id = $1 AND id = ANY($2::uuid[])', [tenantId, ids]);
      if (ok.rows.length !== ids.length) throw new BadRequestException('Há cargos que não pertencem a esta empresa');
    }
    try {
      await c.query('DELETE FROM pgr_ghe_positions WHERE ghe_id = $1 AND tenant_id = $2', [id, tenantId]);
      if (ids.length) {
        await c.query(
          'INSERT INTO pgr_ghe_positions (tenant_id, ghe_id, position_id) SELECT $1, $2, unnest($3::uuid[])',
          [tenantId, id, ids],
        );
      }
    } catch (e) { return mapPgError(e); }
    await this.auditar(c, ator, ctx, 'pgr.ghe.positions_set', id, `ghe: ${id}; empresa: ${tenantId}; cargos: ${ids.join(', ') || 'nenhum'}`);
    return this.projetar(c, tenantId, id);
  }
}
