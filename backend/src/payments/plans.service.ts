import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';

const UPDATABLE_FIELDS = ['price_cents'] as const;
const PLAN_COLUMNS = 'id, audience, slug, name, price_cents, employee_limit';

export interface Plan {
  id: string;
  audience: string;
  slug: string;
  name: string;
  price_cents: number;
  employee_limit: number | null;
}

interface UpdatePlanData {
  price_cents?: number;
}

@Injectable()
export class PlansService {
  async findAll(client: PoolClient, audience?: string): Promise<Plan[]> {
    const result = audience
      ? await client.query<Plan>(
          `SELECT ${PLAN_COLUMNS} FROM plans WHERE active = true AND audience = $1 ORDER BY price_cents`,
          [audience],
        )
      : await client.query<Plan>(
          `SELECT ${PLAN_COLUMNS} FROM plans WHERE active = true ORDER BY audience, price_cents`,
        );
    return result.rows;
  }

  async update(client: PoolClient, id: string, data: UpdatePlanData): Promise<Plan> {
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) {
      const result = await client.query<Plan>(`SELECT ${PLAN_COLUMNS} FROM plans WHERE id = $1`, [id]);
      const plan = result.rows[0];
      if (!plan) throw new NotFoundException('Plano não encontrado');
      return plan;
    }

    const result = await client.query<Plan>(
      `UPDATE plans SET ${setClauses.join(', ')} WHERE id = $1 RETURNING ${PLAN_COLUMNS}`,
      [id, ...values],
    );
    const plan = result.rows[0];
    if (!plan) throw new NotFoundException('Plano não encontrado');
    return plan;
  }
}
