import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';
import { exigeNotaAgenda, transicaoAgendaPermitida, type AgendaStatus } from './agenda-status';
import type { ChangeAgendaStatusDto, CreateAgendaDto, ListAgendaQuery, UpdateAgendaDto } from './dto/agenda.dto';

export interface EventoResumo {
  id: string; tenant_id: string; tenant_name: string; owner_user_id: string; owner_name: string | null;
  type: string; title: string; event_date: string; start_time: string | null; end_time: string | null; status: string;
}
export type EventoDetalhe = EventoResumo & {
  location: string | null; meeting_link: string | null; company_unit_id: string | null; notes: string | null;
  outcome_note: string | null; created_by_name: string | null; created_at: string;
};

export const CAMPOS_AGENDA = [
  'type', 'title', 'event_date', 'start_time', 'end_time', 'location', 'meeting_link', 'company_unit_id', 'notes', 'owner_user_id',
] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DATE/TIME saem como texto (to_char) para o driver não aplicar fuso.
const SELECT_EVENTO = `
  SELECT e.id, e.tenant_id, t.name AS tenant_name, e.owner_user_id, o.full_name AS owner_name,
         e.type, e.title, to_char(e.event_date, 'YYYY-MM-DD') AS event_date,
         to_char(e.start_time, 'HH24:MI') AS start_time, to_char(e.end_time, 'HH24:MI') AS end_time, e.status,
         e.location, e.meeting_link, e.company_unit_id, e.notes, e.outcome_note,
         c.full_name AS created_by_name, e.created_at
    FROM agenda_events e
    JOIN tenants t ON t.id = e.tenant_id
    LEFT JOIN list_socios() o ON o.id = e.owner_user_id
    LEFT JOIN list_socios() c ON c.id = e.created_by`;

const SELECT_TRAVA = `SELECT tenant_id, owner_user_id, status, to_char(event_date, 'YYYY-MM-DD') AS event_date,
       to_char(start_time, 'HH24:MI') AS start_time, to_char(end_time, 'HH24:MI') AS end_time
  FROM agenda_events WHERE id = $1 FOR UPDATE`;

function validarHorario(inicio: string | null | undefined, fim: string | null | undefined) {
  if (inicio && fim && fim <= inicio) throw new BadRequestException('O horário final deve ser depois do inicial');
}

@Injectable()
export class AgendaService {
  private async assertSocio(client: PoolClient, userId: string) {
    const r = await client.query('SELECT 1 FROM list_socios() WHERE id = $1', [userId]);
    if (r.rowCount === 0) throw new BadRequestException('Responsável inválido');
  }

  private async assertUnidade(client: PoolClient, unitId: string, tenantId: string) {
    const r = await client.query('SELECT 1 FROM company_units WHERE id = $1 AND tenant_id = $2', [unitId, tenantId]);
    if (r.rowCount === 0) throw new BadRequestException('Unidade inválida');
  }

  async obter(client: PoolClient, id: string): Promise<EventoDetalhe> {
    const res = await client.query(`${SELECT_EVENTO} WHERE e.id = $1`, [id]);
    if (res.rowCount === 0) throw new NotFoundException('Evento não encontrado');
    return res.rows[0];
  }

  async criar(client: PoolClient, actorId: string, dto: CreateAgendaDto): Promise<EventoDetalhe> {
    const t = await client.query('SELECT id FROM tenants WHERE id = $1', [dto.tenant_id]);
    if (t.rowCount === 0) throw new NotFoundException('Cliente não encontrado');
    const owner = dto.owner_user_id ?? actorId;
    await this.assertSocio(client, owner);
    validarHorario(dto.start_time, dto.end_time);
    if (dto.company_unit_id) await this.assertUnidade(client, dto.company_unit_id, dto.tenant_id);
    const ins = await client.query<{ id: string }>(
      `INSERT INTO agenda_events (tenant_id, owner_user_id, created_by, type, title, event_date,
                                  start_time, end_time, location, meeting_link, company_unit_id, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        dto.tenant_id, owner, actorId, dto.type, dto.title, dto.event_date, dto.start_time ?? null, dto.end_time ?? null,
        dto.location?.trim() || null, dto.meeting_link ?? null, dto.company_unit_id ?? null, dto.notes?.trim() || null,
      ],
    );
    return this.obter(client, ins.rows[0].id);
  }

  async atualizar(
    client: PoolClient, id: string, dto: UpdateAgendaDto,
  ): Promise<{ evento: EventoDetalhe; reagendado: boolean }> {
    const cur = await client.query(SELECT_TRAVA, [id]);
    if (cur.rowCount === 0) throw new NotFoundException('Evento não encontrado');
    const atual = cur.rows[0];
    if (atual.status !== 'agendado') throw new BadRequestException('Evento encerrado');

    const limpo: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto as Record<string, unknown>)) {
      if (v === undefined || !(CAMPOS_AGENDA as readonly string[]).includes(k)) continue;
      limpo[k] = (k === 'location' || k === 'notes') && typeof v === 'string' ? v.trim() || null : v;
    }
    const { setClauses, values } = buildSafeSetClause(limpo, CAMPOS_AGENDA, 2);
    if (setClauses.length === 0) return { evento: await this.obter(client, id), reagendado: false };

    validarHorario(
      'start_time' in limpo ? (limpo.start_time as string) : atual.start_time,
      'end_time' in limpo ? (limpo.end_time as string) : atual.end_time,
    );
    if (typeof limpo.owner_user_id === 'string') await this.assertSocio(client, limpo.owner_user_id);
    if (typeof limpo.company_unit_id === 'string') await this.assertUnidade(client, limpo.company_unit_id, atual.tenant_id);

    await client.query(`UPDATE agenda_events SET ${setClauses.join(', ')} WHERE id = $1`, [id, ...values]);
    const reagendado =
      ('event_date' in limpo && limpo.event_date !== atual.event_date) ||
      ('start_time' in limpo && limpo.start_time !== atual.start_time);
    return { evento: await this.obter(client, id), reagendado };
  }

  async mudarStatus(client: PoolClient, id: string, dto: ChangeAgendaStatusDto): Promise<EventoDetalhe> {
    const cur = await client.query<{ status: AgendaStatus }>(SELECT_TRAVA, [id]);
    if (cur.rowCount === 0) throw new NotFoundException('Evento não encontrado');
    const para = dto.status as AgendaStatus;
    if (!transicaoAgendaPermitida(cur.rows[0].status, para)) throw new BadRequestException('Transição de status não permitida');
    const nota = dto.note?.trim() || null;
    if (exigeNotaAgenda(para) && !nota) throw new BadRequestException('Informe o motivo');
    await client.query('UPDATE agenda_events SET status = $2, outcome_note = $3 WHERE id = $1', [id, para, nota]);
    return this.obter(client, id);
  }

  async listar(client: PoolClient, userId: string, f: ListAgendaQuery): Promise<EventoResumo[]> {
    if (f.from && f.to && f.to < f.from) throw new BadRequestException('Período inválido');
    if (f.owner && f.owner !== 'me' && !UUID_RE.test(f.owner)) throw new BadRequestException('Responsável inválido');
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (cond: (n: number) => string, v: unknown) => { params.push(v); where.push(cond(params.length)); };
    if (f.owner) add((n) => `e.owner_user_id = $${n}`, f.owner === 'me' ? userId : f.owner);
    if (f.status) add((n) => `e.status = $${n}`, f.status);
    if (f.tenantId) add((n) => `e.tenant_id = $${n}`, f.tenantId);
    if (f.from) add((n) => `e.event_date >= $${n}`, f.from);
    if (f.to) add((n) => `e.event_date <= $${n}`, f.to);
    const res = await client.query(
      `${SELECT_EVENTO}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY e.event_date, e.start_time NULLS FIRST, e.created_at
       LIMIT 300`,
      params,
    );
    return res.rows;
  }
}
