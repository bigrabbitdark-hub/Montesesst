import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { mapPgError } from '../../common/pg-error.util';
import { DOC_ACOES, SEPARACAO_PADRAO, avaliarViabilidade, type DocAcao } from './documento-fluxo';
import { CATEGORIAS_DOCUMENTO } from './dto/documentos.dto';
import { ACOES_MATRIZ, type CreateRegistroDto } from './dto/documentos-admin.dto';

const COLUNAS_REGISTRO = `r.id, r.user_id, s.full_name AS nome, r.council, r.registration_number, r.uf, r.status, r.confirmed_at, r.revoked_at`;

// Matriz de responsabilidades por tipo de documento e registros profissionais (somente admin).
// A matriz nasce vazia: nenhum código aqui cria linhas por conta própria.
@Injectable()
export class DocumentosAdminService {
  private async assertSocio(client: PoolClient, userId: string) {
    const r = await client.query('SELECT id FROM list_socios() WHERE id = $1', [userId]);
    if (!r.rows.length) throw new BadRequestException('Responsável inválido');
  }

  // Inclui apenas usuários com ao menos uma ação (quem não tem linha não aparece).
  async listarMatriz(client: PoolClient, category?: string) {
    const r = await client.query(
      `SELECT p.category, p.user_id, s.full_name AS nome,
              array_agg(p.action ORDER BY array_position($${category ? 2 : 1}::text[], p.action)) AS acoes
         FROM document_type_permissions p
         LEFT JOIN list_socios() s ON s.id = p.user_id
        ${category ? 'WHERE p.category = $1' : ''}
        GROUP BY p.category, p.user_id, s.full_name
        ORDER BY p.category, s.full_name, p.user_id`,
      category ? [category, ACOES_MATRIZ as unknown as string[]] : [ACOES_MATRIZ as unknown as string[]],
    );
    return r.rows;
  }

  async listarSocios(client: PoolClient): Promise<{ id: string; nome: string }[]> {
    const r = await client.query('SELECT id, full_name AS nome FROM list_socios() ORDER BY full_name, id');
    return r.rows;
  }

  // Informativa: nunca bloqueia a gravação da matriz. Não lê conselho nem número do registro.
  async viabilidade(client: PoolClient) {
    const linhas = await this.listarMatriz(client);
    const reg = await client.query(`SELECT DISTINCT user_id FROM professional_registrations WHERE status = 'confirmado'`);
    const confirmados = new Set<string>(reg.rows.map((x: any) => x.user_id));
    return CATEGORIAS_DOCUMENTO.map((category) => {
      // quem não é sócio (sem nome em list_socios) não age no fluxo: ignorado
      const doCat = linhas.filter((l: any) => l.category === category && l.nome != null);
      const avaliacao = avaliarViabilidade({
        matriz: doCat.map((l: any) => ({ userId: l.user_id, acoes: l.acoes as DocAcao[] })),
        registrosConfirmados: confirmados,
        separacao: SEPARACAO_PADRAO,
      });
      const habilitados = DOC_ACOES.map((acao) => ({
        acao,
        pessoas: doCat.filter((l: any) => l.acoes.includes(acao)).map((l: any) =>
          acao === 'assinar'
            ? { id: l.user_id as string, nome: l.nome as string, registro_confirmado: confirmados.has(l.user_id) }
            : { id: l.user_id as string, nome: l.nome as string }),
      }));
      return { category, ...avaliacao, habilitados };
    });
  }

  async definirMatriz(client: PoolClient, adminId: string, category: string, userId: string, acoes: string[]) {
    await this.assertSocio(client, userId);
    // Serializa PUTs concorrentes do mesmo par (DELETE+INSERT).
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`document_matrix:${category}:${userId}`]);
    await client.query('DELETE FROM document_type_permissions WHERE category = $1 AND user_id = $2', [category, userId]);
    const ordenadas = ACOES_MATRIZ.filter((a) => acoes.includes(a));
    if (ordenadas.length) {
      try {
        await client.query(
          `INSERT INTO document_type_permissions (category, user_id, action, granted_by)
           SELECT $1, $2, a, $4 FROM unnest($3::text[]) AS a`,
          [category, userId, ordenadas, adminId],
        );
      } catch (e) { mapPgError(e); }
    }
    return { category, user_id: userId, acoes: ordenadas as string[] };
  }

  async listarRegistros(client: PoolClient, userId?: string) {
    const r = await client.query(
      `SELECT ${COLUNAS_REGISTRO} FROM professional_registrations r
         LEFT JOIN list_socios() s ON s.id = r.user_id
        ${userId ? 'WHERE r.user_id = $1' : ''}
        ORDER BY s.full_name, r.created_at, r.id`,
      userId ? [userId] : [],
    );
    return r.rows;
  }

  async criarRegistro(client: PoolClient, adminId: string, dto: CreateRegistroDto) {
    await this.assertSocio(client, dto.user_id);
    try {
      const r = await client.query(
        `INSERT INTO professional_registrations (user_id, council, registration_number, uf, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [dto.user_id, dto.council, dto.registration_number, dto.uf, adminId],
      );
      const out = await client.query(
        `SELECT ${COLUNAS_REGISTRO} FROM professional_registrations r LEFT JOIN list_socios() s ON s.id = r.user_id WHERE r.id = $1`,
        [r.rows[0].id],
      );
      return out.rows[0];
    } catch (e) { return mapPgError(e); }
  }

  async confirmarRegistro(client: PoolClient, adminId: string, id: string) {
    const r = await client.query(
      `UPDATE professional_registrations SET status = 'confirmado', confirmed_by = $2, confirmed_at = now()
        WHERE id = $1 AND status = 'pendente' RETURNING id, user_id, status, confirmed_at`,
      [id, adminId],
    );
    if (r.rows.length) return r.rows[0];
    const ex = await client.query('SELECT id FROM professional_registrations WHERE id = $1', [id]);
    if (!ex.rows.length) throw new NotFoundException('Registro não encontrado');
    throw new ConflictException('Registro já confirmado');
  }

  // Revogação: só confirmado -> revogado (terminal). A assinatura já feita permanece no histórico (snapshot).
  async revogarRegistro(client: PoolClient, adminId: string, id: string) {
    const r = await client.query(
      `UPDATE professional_registrations SET status = 'revogado', revoked_by = $2, revoked_at = now()
        WHERE id = $1 AND status = 'confirmado' RETURNING id, user_id, status, revoked_at`,
      [id, adminId],
    );
    if (r.rows.length) return r.rows[0];
    const ex = await client.query('SELECT id FROM professional_registrations WHERE id = $1', [id]);
    if (!ex.rows.length) throw new NotFoundException('Registro não encontrado');
    throw new ConflictException('Só registro confirmado pode ser revogado');
  }
}
