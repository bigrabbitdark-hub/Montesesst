import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface CorrectiveAction {
  id: string;
  tenant_id: string;
  checklist_item_id: string | null;
  drill_id: string | null;
  description: string;
  deadline: string | null;
  responsible: string | null;
  status: 'pendente' | 'resolvido';
  created_at: string;
}

interface CreateCorrectiveActionData {
  tenantId: string;
  checklistItemId?: string;
  drillId?: string;
  description: string;
  deadline?: string;
  responsible?: string;
}

@Injectable()
export class PreventionCorrectiveActionsService {
  async create(client: PoolClient, data: CreateCorrectiveActionData): Promise<CorrectiveAction> {
    const result = await client.query<CorrectiveAction>(
      `INSERT INTO prevention_corrective_actions
         (tenant_id, checklist_item_id, drill_id, description, deadline, responsible)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        data.tenantId,
        data.checklistItemId ?? null,
        data.drillId ?? null,
        data.description,
        data.deadline ?? null,
        data.responsible ?? null,
      ],
    );
    return result.rows[0];
  }

  async findAll(
    client: PoolClient,
    filters: { tenantId?: string; status?: string },
  ): Promise<CorrectiveAction[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filters.tenantId) {
      values.push(filters.tenantId);
      conditions.push(`tenant_id = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      conditions.push(`status = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await client.query<CorrectiveAction>(
      `SELECT * FROM prevention_corrective_actions ${where} ORDER BY created_at DESC`,
      values,
    );
    return result.rows;
  }

  async updateStatus(client: PoolClient, id: string, status: 'pendente' | 'resolvido'): Promise<CorrectiveAction> {
    const result = await client.query<CorrectiveAction>(
      `UPDATE prevention_corrective_actions SET status = $2 WHERE id = $1 RETURNING *`,
      [id, status],
    );
    const action = result.rows[0];
    if (!action) throw new NotFoundException('Ação corretiva não encontrada');
    return action;
  }

  // Consumida pelo dashboard (Task 4). Sem deadline definido (comum nas
  // ações geradas automaticamente por checklist/simulado, que não setam
  // prazo na criação) ainda entra em "avisos" — deixar invisível até
  // alguém editar manualmente esconderia um achado de segurança real.
  async getStatusSummary(
    client: PoolClient,
    tenantId: string,
  ): Promise<{ pendencias: CorrectiveAction[]; avisos: CorrectiveAction[] }> {
    const actions = await this.findAll(client, { tenantId, status: 'pendente' });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pendencias: CorrectiveAction[] = [];
    const avisos: CorrectiveAction[] = [];
    for (const action of actions) {
      if (!action.deadline) {
        avisos.push(action);
        continue;
      }
      const deadline = new Date(action.deadline);
      deadline.setHours(0, 0, 0, 0);
      const diffDays = Math.round((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) pendencias.push(action);
      else if (diffDays <= 30) avisos.push(action);
    }
    return { pendencias, avisos };
  }
}
