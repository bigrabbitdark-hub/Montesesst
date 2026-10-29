import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';
import type { CreateInteracaoDto, ListInteracoesQuery, UpdateInteracaoDto } from './dto/interacao.dto';

export interface Interacao {
  id: string; tenant_id: string; type: string; occurred_on: string; participants: string | null; summary: string;
  decisions: string | null; next_steps: string | null; agenda_event_id: string | null; created_by: string;
  created_by_name: string | null; created_at: string; updated_at: string; editavel: boolean;
}

export const CAMPOS_INTERACAO = ['type', 'occurred_on', 'participants', 'summary', 'decisions', 'next_steps', 'agenda_event_id'] as const;
const TEXTOS_OPCIONAIS = ['participants', 'decisions', 'next_steps'];

// DATE sai como texto (to_char) para o driver não aplicar fuso.
const SELECT_INTERACAO = `
  SELECT i.id, i.tenant_id, i.type, to_char(i.occurred_on, 'YYYY-MM-DD') AS occurred_on, i.participants, i.summary,
         i.decisions, i.next_steps, i.agenda_event_id, i.created_by, c.full_name AS created_by_name,
         i.created_at, i.updated_at
    FROM client_interactions i
    LEFT JOIN list_socios() c ON c.id = i.created_by`;

export interface InteracaoGlobal {
  id: string; tenant_id: string; empresa: string; type: string; occurred_on: string; summary: string;
  summary_truncado: boolean; created_by_name: string | null; href: string;
}
const PAGINA = 100;
const RESUMO_MAX = 200;

@Injectable()
export class InteracoesService {
  private comEditavel(row: any, userId: string): Interacao {
    return { ...row, editavel: row.created_by === userId };
  }

  private async assertTenant(client: PoolClient, tenantId: string) {
    const t = await client.query('SELECT id FROM tenants WHERE id = $1', [tenantId]);
    if (t.rowCount === 0) throw new NotFoundException('Cliente não encontrado');
  }

  private async assertEvento(client: PoolClient, eventId: string, tenantId: string) {
    const r = await client.query('SELECT 1 FROM agenda_events WHERE id = $1 AND tenant_id = $2', [eventId, tenantId]);
    if (r.rowCount === 0) throw new BadRequestException('Evento de agenda inválido');
  }

  private async obter(client: PoolClient, userId: string, id: string): Promise<Interacao> {
    const res = await client.query(`${SELECT_INTERACAO} WHERE i.id = $1`, [id]);
    if (res.rowCount === 0) throw new NotFoundException('Interação não encontrada');
    return this.comEditavel(res.rows[0], userId);
  }

  async listar(client: PoolClient, userId: string, tenantId: string): Promise<Interacao[]> {
    await this.assertTenant(client, tenantId);
    const res = await client.query(
      `${SELECT_INTERACAO}
       WHERE i.tenant_id = $1
       ORDER BY i.occurred_on DESC, i.created_at DESC
       LIMIT 200`,
      [tenantId],
    );
    return res.rows.map((r) => this.comEditavel(r, userId));
  }

  // Histórico global (somente leitura) das empresas Montese. Sem participantes, decisões nem próximos passos; o
  // resumo é cortado em RESUMO_MAX. Empresa de parceiro/inexistente => 404 (RLS do sócio + is_montese_tenant).
  async listarGlobal(
    client: PoolClient, q: ListInteracoesQuery,
  ): Promise<{ itens: InteracaoGlobal[]; total: number; page: number; page_size: number }> {
    if (q.from && q.to && q.from > q.to) throw new BadRequestException('Período inválido');
    if (q.tenantId) await this.assertTenant(client, q.tenantId);
    const filtro = `is_montese_tenant(i.tenant_id)
      AND ($1::uuid IS NULL OR i.tenant_id = $1::uuid)
      AND ($2::text IS NULL OR i.type = $2::text)
      AND ($3::date IS NULL OR i.occurred_on >= $3::date)
      AND ($4::date IS NULL OR i.occurred_on <= $4::date)`;
    const params = [q.tenantId ?? null, q.tipo ?? null, q.from ?? null, q.to ?? null];
    const page = q.page ?? 1;
    const lista = await client.query(
      `/* interacoes:global-lista */
       SELECT i.id, i.tenant_id, t.name AS empresa, i.type, to_char(i.occurred_on, 'YYYY-MM-DD') AS occurred_on,
              left(i.summary, ${RESUMO_MAX}) AS summary, (char_length(i.summary) > ${RESUMO_MAX}) AS summary_truncado,
              c.full_name AS created_by_name
         FROM client_interactions i
         JOIN tenants t ON t.id = i.tenant_id
         LEFT JOIN list_socios() c ON c.id = i.created_by
        WHERE ${filtro}
        ORDER BY i.occurred_on DESC, i.created_at DESC, i.id DESC
        LIMIT ${PAGINA} OFFSET $5`,
      [...params, (page - 1) * PAGINA],
    );
    const total = await client.query(
      `/* interacoes:global-total */ SELECT count(*)::int AS n FROM client_interactions i WHERE ${filtro}`,
      params,
    );
    return {
      itens: lista.rows.map((r: any) => ({ ...r, href: `/atuacao/empresas/${r.tenant_id}` })),
      total: total.rows[0]?.n ?? 0, page, page_size: PAGINA,
    };
  }

  async criar(client: PoolClient, actorId: string, tenantId: string, dto: CreateInteracaoDto): Promise<Interacao> {
    await this.assertTenant(client, tenantId);
    if (dto.agenda_event_id) await this.assertEvento(client, dto.agenda_event_id, tenantId);
    const ins = await client.query<{ id: string }>(
      `INSERT INTO client_interactions (tenant_id, created_by, type, occurred_on, participants, summary, decisions, next_steps, agenda_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        tenantId, actorId, dto.type, dto.occurred_on, dto.participants?.trim() || null, dto.summary,
        dto.decisions?.trim() || null, dto.next_steps?.trim() || null, dto.agenda_event_id ?? null,
      ],
    );
    return this.obter(client, actorId, ins.rows[0].id);
  }

  // Só o autor edita: a policy limita o UPDATE; 0 linhas => 404 (não revela a existência).
  async atualizar(
    client: PoolClient, userId: string, id: string, dto: UpdateInteracaoDto,
  ): Promise<{ interacao: Interacao; campos: string[] }> {
    const cur = await client.query<{ tenant_id: string; created_by: string }>(
      'SELECT tenant_id, created_by FROM client_interactions WHERE id = $1', [id],
    );
    if (cur.rowCount === 0 || cur.rows[0].created_by !== userId) throw new NotFoundException('Interação não encontrada');

    const limpo: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto as Record<string, unknown>)) {
      if (v === undefined || !(CAMPOS_INTERACAO as readonly string[]).includes(k)) continue;
      limpo[k] = TEXTOS_OPCIONAIS.includes(k) && typeof v === 'string' ? v.trim() || null : v;
    }
    const { setClauses, values } = buildSafeSetClause(limpo, CAMPOS_INTERACAO, 3);
    if (setClauses.length === 0) return { interacao: await this.obter(client, userId, id), campos: [] };
    if (typeof limpo.agenda_event_id === 'string') await this.assertEvento(client, limpo.agenda_event_id, cur.rows[0].tenant_id);

    const up = await client.query(
      `UPDATE client_interactions SET ${setClauses.join(', ')} WHERE id = $1 AND created_by = $2 RETURNING id`,
      [id, userId, ...values],
    );
    if (up.rowCount === 0) throw new NotFoundException('Interação não encontrada');
    return { interacao: await this.obter(client, userId, id), campos: Object.keys(limpo) };
  }
}
