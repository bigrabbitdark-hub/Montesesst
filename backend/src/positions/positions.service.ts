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

export interface LinkSuggestion {
  suggested_name: string;
  employee_ids: string[];
  employee_count: number;
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

  private normalizePositionText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  async getLinkSuggestions(client: PoolClient, tenantId: string): Promise<LinkSuggestion[]> {
    const result = await client.query<{ id: string; position: string }>(
      `SELECT id, position FROM employees
       WHERE tenant_id = $1 AND position_id IS NULL AND position IS NOT NULL AND position != ''`,
      [tenantId],
    );

    const groups = new Map<string, { rawCounts: Map<string, number>; employeeIds: string[] }>();
    for (const row of result.rows) {
      const normalized = this.normalizePositionText(row.position);
      if (!groups.has(normalized)) groups.set(normalized, { rawCounts: new Map(), employeeIds: [] });
      const group = groups.get(normalized)!;
      group.employeeIds.push(row.id);
      group.rawCounts.set(row.position, (group.rawCounts.get(row.position) ?? 0) + 1);
    }

    return Array.from(groups.values()).map((group) => {
      // Texto raw mais frequente vira o nome sugerido; empate desfeito por
      // ordem alfabética — determinístico, sem depender de ordem de inserção.
      // Comparação simples por code point (não localeCompare): localeCompare
      // usa a collation ICU do ambiente, que não é garantidamente estável
      // entre máquinas/containers (ex.: aqui ICU trata 'a' < 'A', mas
      // comparação simples trata 'A' < 'a' — o resultado varia por
      // ambiente). Determinístico de verdade exige não depender disso.
      const [suggestedName] = Array.from(group.rawCounts.entries()).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      })[0];
      return {
        suggested_name: suggestedName,
        employee_ids: group.employeeIds,
        employee_count: group.employeeIds.length,
      };
    });
  }

  async confirmLinks(
    client: PoolClient,
    tenantId: string,
    // Aceita tanto `name` (grupo já "achatado" pro formato de confirmação)
    // quanto `suggested_name` (o item de LinkSuggestion devolvido por
    // GET .../link-suggestions, reenviado sem alteração) — o frontend desta
    // fase reenvia a sugestão como veio (campo `suggested_name`) quando a
    // empresa não edita o nome, e envia `name` quando edita antes de
    // confirmar; sem esse fallback o primeiro caso grava `name` NULL.
    groups: { name?: string; suggested_name?: string; employee_ids: string[] }[],
  ): Promise<void> {
    for (const group of groups) {
      const name = group.name ?? group.suggested_name;
      const positionResult = await client.query<{ id: string }>(
        `INSERT INTO positions (tenant_id, name) VALUES ($1, $2)
         ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [tenantId, name],
      );
      const positionId = positionResult.rows[0].id;
      if (group.employee_ids.length > 0) {
        await client.query(`UPDATE employees SET position_id = $1 WHERE id = ANY($2)`, [
          positionId,
          group.employee_ids,
        ]);
      }
    }
  }
}
