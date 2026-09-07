import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';

export interface Position {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string;
}

export interface PositionSummary {
  id: string;
  name: string;
  employee_count: number;
  epi_requirement_count: number;
  training_requirement_count: number;
}

@Injectable()
export class PositionsService {
  async create(client: PoolClient, tenantId: string, name: string): Promise<Position> {
    try {
      const result = await client.query<Position>(
        `INSERT INTO positions (tenant_id, name) VALUES ($1, $2) RETURNING *`,
        [tenantId, name],
      );
      return result.rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, tenantId: string): Promise<PositionSummary[]> {
    const result = await client.query<PositionSummary>(
      `SELECT p.id, p.name,
         (SELECT COUNT(*)::int FROM employees e WHERE e.position_id = p.id) AS employee_count,
         (SELECT COUNT(*)::int FROM position_epi_requirements per WHERE per.position_id = p.id) AS epi_requirement_count,
         (SELECT COUNT(*)::int FROM position_training_requirements ptr WHERE ptr.position_id = p.id) AS training_requirement_count
       FROM positions p
       WHERE p.tenant_id = $1
       ORDER BY p.name`,
      [tenantId],
    );
    return result.rows;
  }

  async update(client: PoolClient, id: string, name: string): Promise<Position> {
    try {
      const result = await client.query<Position>(
        `UPDATE positions SET name = $2 WHERE id = $1 RETURNING *`,
        [id, name],
      );
      const position = result.rows[0];
      if (!position) throw new NotFoundException('Cargo não encontrado');
      return position;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      mapPgError(err);
    }
  }
}
