import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';
import { ABERTAS, exigeNota, transicaoPermitida, type TarefaStatus } from './tarefa-status';
import type { ChangeTarefaStatusDto, CreateTarefaDto, EncaminharTarefaDto, ListTarefasQuery, UpdateTarefaDto } from './dto/tarefa.dto';

export interface TarefaResumo {
  id: string; tenant_id: string; tenant_name: string; title: string; priority: string; status: string;
  due_date: string | null; assignee_user_id: string; assignee_name: string | null; created_by_name: string | null;
  vencida: boolean;
}
export interface TarefaEvento {
  id: string; type: string; actor_name: string | null; from_value: string | null; to_value: string | null;
  note: string | null; created_at: string;
}
export type TarefaDetalhe = TarefaResumo & {
  description: string | null; category: string | null; completed_at: string | null; created_at: string;
  eventos: TarefaEvento[];
};

export const CAMPOS_TAREFA = ['title', 'description', 'priority', 'due_date', 'category', 'assignee_user_id'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOJE_SP = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";

// due_date vem como DATE; to_char evita que o driver o converta para Date com fuso.
const SELECT_RESUMO = `
  SELECT k.id, k.tenant_id, t.name AS tenant_name, k.title, k.priority, k.status,
         to_char(k.due_date, 'YYYY-MM-DD') AS due_date, k.assignee_user_id,
         a.full_name AS assignee_name, c.full_name AS created_by_name,
         (k.due_date < ${HOJE_SP} AND k.status = ANY($ABERTAS)) AS vencida,
         k.description, k.category, k.completed_at, k.created_at
    FROM tasks k
    JOIN tenants t ON t.id = k.tenant_id
    LEFT JOIN list_socios() a ON a.id = k.assignee_user_id
    LEFT JOIN list_socios() c ON c.id = k.created_by`;

@Injectable()
export class TarefasService {
  private async assertSocio(client: PoolClient, userId: string) {
    const r = await client.query('SELECT 1 FROM list_socios() WHERE id = $1', [userId]);
    if (r.rowCount === 0) throw new BadRequestException('Responsável inválido');
  }

  // created_at = clock_timestamp() para manter a ordem dos eventos dentro da mesma transação.
  private async evento(
    client: PoolClient, taskId: string, tenantId: string, actorId: string,
    type: 'created' | 'updated' | 'assigned' | 'status_changed',
    from: string | null, to: string | null, note: string | null,
  ) {
    await client.query(
      `INSERT INTO task_events (task_id, tenant_id, actor_user_id, type, from_value, to_value, note, created_at)
       VALUES ($1,$2,$3,'${type}',$4,$5,$6,clock_timestamp())`,
      [taskId, tenantId, actorId, from, to, note],
    );
  }

  async obter(client: PoolClient, id: string): Promise<TarefaDetalhe> {
    const res = await client.query(`${SELECT_RESUMO.replace('$ABERTAS', '$2')} WHERE k.id = $1`, [id, ABERTAS]);
    if (res.rowCount === 0) throw new NotFoundException('Tarefa não encontrada');
    const ev = await client.query(
      `SELECT e.id, e.type, a.full_name AS actor_name, e.from_value, e.to_value, e.note, e.created_at
         FROM task_events e LEFT JOIN list_socios() a ON a.id = e.actor_user_id
        WHERE e.task_id = $1 ORDER BY e.created_at, e.id`,
      [id],
    );
    return { ...res.rows[0], eventos: ev.rows };
  }

  async criar(client: PoolClient, actorId: string, dto: CreateTarefaDto): Promise<TarefaDetalhe> {
    const t = await client.query('SELECT id FROM tenants WHERE id = $1', [dto.tenant_id]);
    if (t.rowCount === 0) throw new NotFoundException('Cliente não encontrado');
    await this.assertSocio(client, dto.assignee_user_id);
    const ins = await client.query<{ id: string }>(
      `INSERT INTO tasks (tenant_id, title, description, created_by, assignee_user_id, priority, due_date, category)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'media'),$7,$8) RETURNING id`,
      [dto.tenant_id, dto.title, dto.description ?? null, actorId, dto.assignee_user_id, dto.priority ?? null, dto.due_date ?? null, dto.category ?? null],
    );
    await this.evento(client, ins.rows[0].id, dto.tenant_id, actorId, 'created', null, 'pending', null);
    return this.obter(client, ins.rows[0].id);
  }

  async atualizar(
    client: PoolClient, actorId: string, id: string, dto: UpdateTarefaDto,
  ): Promise<{ tarefa: TarefaDetalhe; reassigned: { from: string; to: string } | null }> {
    const cur = await client.query<{ tenant_id: string; assignee_user_id: string }>(
      'SELECT tenant_id, assignee_user_id FROM tasks WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (cur.rowCount === 0) throw new NotFoundException('Tarefa não encontrada');
    const { tenant_id, assignee_user_id: atual } = cur.rows[0];

    // String vazia ou null nunca apaga um campo (título vazio já é barrado pelo DTO).
    const limpo: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto as Record<string, unknown>)) {
      if (v === undefined || v === null || v === '') continue;
      if (k === 'assignee_user_id' && v === atual) continue;
      limpo[k] = v;
    }
    const { setClauses, values } = buildSafeSetClause(limpo, CAMPOS_TAREFA, 2);
    if (setClauses.length === 0) return { tarefa: await this.obter(client, id), reassigned: null };

    const novoResp = typeof limpo.assignee_user_id === 'string' ? limpo.assignee_user_id : null;
    if (novoResp) await this.assertSocio(client, novoResp);

    await client.query(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $1`, [id, ...values]);
    if (novoResp) await this.evento(client, id, tenant_id, actorId, 'assigned', atual, novoResp, null);
    const campos = Object.keys(limpo).filter((k) => k !== 'assignee_user_id' && (CAMPOS_TAREFA as readonly string[]).includes(k));
    if (campos.length > 0) await this.evento(client, id, tenant_id, actorId, 'updated', null, campos.join(', '), null);
    return { tarefa: await this.obter(client, id), reassigned: novoResp ? { from: atual, to: novoResp } : null };
  }

  // Encaminhar = trocar o responsável por OUTRO sócio ativo, com nota opcional (só no histórico, nunca na auditoria).
  // 404 uniforme (inexistente/invisível); tarefa encerrada => 409; para si mesmo ou para o responsável atual => 400.
  async encaminhar(
    client: PoolClient, actorId: string, id: string, dto: EncaminharTarefaDto,
  ): Promise<{ tarefa: TarefaDetalhe; de: string; para: string }> {
    const cur = await client.query<{ tenant_id: string; status: TarefaStatus; assignee_user_id: string }>(
      'SELECT tenant_id, status, assignee_user_id FROM tasks WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (cur.rowCount === 0) throw new NotFoundException('Tarefa não encontrada');
    const { tenant_id, status, assignee_user_id: atual } = cur.rows[0];
    if (!ABERTAS.includes(status)) throw new ConflictException('Tarefa encerrada não pode ser encaminhada');
    if (dto.assignee_user_id === actorId) throw new BadRequestException('Não é possível encaminhar para si mesmo');
    if (dto.assignee_user_id === atual) throw new BadRequestException('Tarefa já está com este responsável');
    await this.assertSocio(client, dto.assignee_user_id);
    await client.query('UPDATE tasks SET assignee_user_id = $2 WHERE id = $1', [id, dto.assignee_user_id]);
    await this.evento(client, id, tenant_id, actorId, 'assigned', atual, dto.assignee_user_id, dto.nota?.trim() || null);
    return { tarefa: await this.obter(client, id), de: atual, para: dto.assignee_user_id };
  }

  async mudarStatus(client: PoolClient, actorId: string, id: string, dto: ChangeTarefaStatusDto): Promise<TarefaDetalhe> {
    const cur = await client.query<{ tenant_id: string; status: TarefaStatus }>(
      'SELECT tenant_id, status FROM tasks WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (cur.rowCount === 0) throw new NotFoundException('Tarefa não encontrada');
    const para = dto.status as TarefaStatus;
    const de = cur.rows[0].status;
    if (!transicaoPermitida(de, para)) throw new BadRequestException('Transição de status não permitida');
    const nota = dto.note?.trim() || null;
    if (exigeNota(para) && !nota) throw new BadRequestException('Informe o motivo');
    await client.query(
      `UPDATE tasks SET status = $2::text,
              completed_at = CASE WHEN $2::text = 'completed' THEN now() ELSE NULL END
        WHERE id = $1`,
      [id, para],
    );
    await this.evento(client, id, cur.rows[0].tenant_id, actorId, 'status_changed', de, para, nota);
    return this.obter(client, id);
  }

  async listar(client: PoolClient, userId: string, f: ListTarefasQuery): Promise<TarefaResumo[]> {
    const params: unknown[] = [ABERTAS];
    const where: string[] = [];
    const add = (cond: (n: number) => string, v: unknown) => { params.push(v); where.push(cond(params.length)); };
    if (f.assignee) {
      if (f.assignee !== 'me' && !UUID_RE.test(f.assignee)) throw new BadRequestException('Responsável inválido');
      add((n) => `k.assignee_user_id = $${n}`, f.assignee === 'me' ? userId : f.assignee);
    }
    if (f.status) add((n) => `k.status = $${n}`, f.status);
    if (f.tenantId) add((n) => `k.tenant_id = $${n}`, f.tenantId);
    if (f.vencidas === 'true') where.push(`k.due_date < ${HOJE_SP} AND k.status = ANY($1)`);
    const res = await client.query(
      `${SELECT_RESUMO.replace('$ABERTAS', '$1')}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY (k.status = ANY($1)) DESC, k.due_date NULLS LAST,
                CASE k.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
                k.created_at DESC
       LIMIT 200`,
      params,
    );
    return res.rows;
  }

  async resumo(client: PoolClient, userId: string) {
    const res = await client.query(
      `SELECT COUNT(*) FILTER (WHERE status = ANY($2))::int AS abertas,
              COUNT(*) FILTER (WHERE status = ANY($2) AND due_date < ${HOJE_SP})::int AS vencidas,
              COUNT(*) FILTER (WHERE status = ANY($2) AND due_date = ${HOJE_SP})::int AS hoje,
              COUNT(*) FILTER (WHERE status = 'blocked')::int AS bloqueadas,
              COUNT(*) FILTER (WHERE status = 'awaiting_client')::int AS aguardando_cliente,
              COUNT(*) FILTER (WHERE status = 'awaiting_review')::int AS aguardando_avaliacao,
              COUNT(*) FILTER (WHERE status = 'awaiting_execution')::int AS aguardando_execucao,
              COUNT(*) FILTER (WHERE status = 'awaiting_efficacy')::int AS aguardando_eficacia
         FROM tasks WHERE assignee_user_id = $1`,
      [userId, ABERTAS],
    );
    const r = res.rows[0];
    return {
      abertas: r.abertas, vencidas: r.vencidas, hoje: r.hoje, bloqueadas: r.bloqueadas,
      aguardando_cliente: r.aguardando_cliente ?? 0, aguardando_avaliacao: r.aguardando_avaliacao ?? 0,
      aguardando_execucao: r.aguardando_execucao ?? 0, aguardando_eficacia: r.aguardando_eficacia ?? 0,
    };
  }
}
