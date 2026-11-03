import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { mapPgError } from '../../common/pg-error.util';
import type { CreateMudancaDto, ListMudancasQuery, ListNotificacoesQuery, UpdateRegraDto } from './alertas.dto';
import { NOTICE_PADRAO } from './alertas.dto';

const PAGINA = 50;

function traduzir(err: unknown): never {
  if ((err as { code?: string })?.code === 'P0001') throw new ConflictException('Operação não permitida para este registro.');
  return mapPgError(err);
}

@Injectable()
export class AlertasService {
  // ---- regras (tabela existente document_validity_rules, 0079) ----------------------------------

  async listarRegras(c: PoolClient) {
    const r = await c.query(
      `/* alertas:regras */
       SELECT category, validity_months, alert_days, notice_days, source, updated_at
         FROM document_validity_rules ORDER BY category`,
    );
    return r.rows.map((x) => ({ ...x, notice_days_efetivo: x.notice_days ?? [...NOTICE_PADRAO], usa_padrao: x.notice_days == null }));
  }

  async atualizarRegra(c: PoolClient, userId: string, categoria: string, dto: UpdateRegraDto) {
    const notice = [...dto.notice_days].sort((a, b) => b - a);
    try {
      const r = await c.query(
        `UPDATE document_validity_rules SET notice_days = $2, source = $3, updated_by_user_id = $4 WHERE category = $1 RETURNING category`,
        [categoria, notice, dto.source?.trim() || null, userId],
      );
      if (r.rowCount === 0) throw new NotFoundException('Tipo de documento não encontrado');
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      traduzir(err);
    }
    return (await this.listarRegras(c)).find((x) => x.category === categoria);
  }

  // ---- revisão por mudança nas condições de trabalho --------------------------------------------

  async listarMudancas(c: PoolClient, q: ListMudancasQuery) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.abertas !== 'false') where.push('f.resolved_at IS NULL');
    if (q.tenantId) { params.push(q.tenantId); where.push(`f.tenant_id = $${params.length}`); }
    const r = await c.query(
      `/* alertas:mudancas */
       SELECT f.id, f.tenant_id, t.name AS empresa, f.document_id, f.category, f.reason, f.note, f.created_at,
              cb.full_name AS created_by_name, f.resolved_at, rb.full_name AS resolved_by_name, f.resolution_note
         FROM document_change_flags f
         JOIN tenants t ON t.id = f.tenant_id
         LEFT JOIN list_socios() cb ON cb.id = f.created_by
         LEFT JOIN list_socios() rb ON rb.id = f.resolved_by
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY f.created_at DESC, f.id
        LIMIT 200`,
      params,
    );
    return r.rows;
  }

  async registrarMudanca(c: PoolClient, userId: string, dto: CreateMudancaDto) {
    if (!dto.document_id && !dto.category) throw new BadRequestException('Informe o documento ou o tipo de documento afetado.');
    const t = await c.query('SELECT 1 FROM tenants WHERE id = $1', [dto.tenant_id]);
    if (t.rowCount === 0 || t.rows.length === 0) throw new NotFoundException('Empresa não encontrada');
    try {
      const r = await c.query<{ id: string }>(
        `INSERT INTO document_change_flags (tenant_id, document_id, category, reason, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [dto.tenant_id, dto.document_id ?? null, dto.category ?? null, dto.reason, dto.note?.trim() || null, userId],
      );
      return (await this.listarMudancas(c, { abertas: 'false', tenantId: dto.tenant_id })).find((x) => x.id === r.rows[0].id);
    } catch (err) {
      return traduzir(err);
    }
  }

  async resolverMudanca(c: PoolClient, userId: string, id: string, nota?: string) {
    const cur = await c.query<{ resolved_at: string | null }>('SELECT resolved_at FROM document_change_flags WHERE id = $1 FOR UPDATE', [id]);
    if (cur.rowCount === 0 || !cur.rows[0]) throw new NotFoundException('Registro não encontrado');
    if (cur.rows[0].resolved_at) throw new ConflictException('Este registro já foi resolvido.');
    try {
      await c.query(
        'UPDATE document_change_flags SET resolved_by = $2, resolved_at = clock_timestamp(), resolution_note = $3 WHERE id = $1',
        [id, userId, nota?.trim() || null],
      );
    } catch (err) {
      traduzir(err);
    }
    return (await this.listarMudancas(c, { abertas: 'false' })).find((x) => x.id === id);
  }

  // ---- notificações do próprio usuário (a RLS já restringe às dele) ------------------------------

  async listarNotificacoes(c: PoolClient, q: ListNotificacoesQuery) {
    const offset = ((q.page ?? 1) - 1) * PAGINA;
    const filtro = q.naoLidas === 'true' ? 'WHERE n.read_at IS NULL' : '';
    const lista = await c.query(
      `/* alertas:notificacoes */
       SELECT n.id, n.type, n.priority, n.title, n.tenant_id, n.href, n.created_at, n.read_at
         FROM notifications n ${filtro}
        ORDER BY (n.read_at IS NULL) DESC, n.created_at DESC, n.id
        LIMIT ${PAGINA} OFFSET $1`,
      [offset],
    );
    const total = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM notifications n ${filtro}`);
    return { itens: lista.rows, total: total.rows[0]?.n ?? 0 };
  }

  async resumoNotificacoes(c: PoolClient) {
    const r = await c.query<{ nao_lidas: number; alta: number }>(
      `/* alertas:resumo */
       SELECT count(*)::int AS nao_lidas, count(*) FILTER (WHERE priority = 'alta')::int AS alta
         FROM notifications WHERE read_at IS NULL`,
    );
    return r.rows[0] ?? { nao_lidas: 0, alta: 0 };
  }

  async marcarLida(c: PoolClient, id: string) {
    const r = await c.query(
      'UPDATE notifications SET read_at = clock_timestamp() WHERE id = $1 AND read_at IS NULL RETURNING id', [id],
    );
    if (r.rowCount === 0) {
      const ex = await c.query('SELECT 1 FROM notifications WHERE id = $1', [id]);
      if (ex.rowCount === 0 || ex.rows.length === 0) throw new NotFoundException('Notificação não encontrada');
    }
    return this.resumoNotificacoes(c);
  }

  async marcarTodasLidas(c: PoolClient) {
    await c.query('UPDATE notifications SET read_at = clock_timestamp() WHERE read_at IS NULL');
    return this.resumoNotificacoes(c);
  }
}
