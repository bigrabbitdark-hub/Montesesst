import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';
import type { CreateInteracaoDto, UpdateInteracaoDto } from './dto/interacao.dto';

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
