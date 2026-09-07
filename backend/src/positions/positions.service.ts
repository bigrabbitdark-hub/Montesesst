import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { TRAINING_TYPES, TrainingType } from '../cipa/trainings.service';

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
    // `suggested_name`, não `name`: nenhum chamador real (nem o teste e2e,
    // que reenvia o item de LinkSuggestion como veio de GET
    // .../link-suggestions, nem o frontend da Task 5) produz um campo
    // `name` de verdade — é sempre a sugestão devolvida, editada ou não.
    groups: { suggested_name: string; employee_ids: string[] }[],
  ): Promise<void> {
    for (const group of groups) {
      const positionResult = await client.query<{ id: string }>(
        `INSERT INTO positions (tenant_id, name) VALUES ($1, $2)
         ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [tenantId, group.suggested_name],
      );
      const positionId = positionResult.rows[0].id;
      if (group.employee_ids.length > 0) {
        // Filtro de tenant explícito aqui, mesmo padrão do INSERT acima:
        // sem o `AND tenant_id = $3`, um caller admin (bypass explícito nas
        // policies de RLS de `positions`/`employees`) poderia vincular
        // employee_ids de QUALQUER tenant ao position_id recém-criado no
        // tenant do caller, silenciosamente — a mesma classe de risco que
        // EmployeesService.update() já blinda pro vínculo manual individual.
        await client.query(`UPDATE employees SET position_id = $1 WHERE id = ANY($2) AND tenant_id = $3`, [
          positionId,
          group.employee_ids,
          tenantId,
        ]);
      }
    }
  }

  async setEpiRequirements(client: PoolClient, positionId: string, epiCatalogItemIds: string[]): Promise<void> {
    const positionResult = await client.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM positions WHERE id = $1',
      [positionId],
    );
    if (positionResult.rowCount === 0) throw new NotFoundException('Cargo não encontrado');
    const tenantId = positionResult.rows[0].tenant_id;

    await client.query('DELETE FROM position_epi_requirements WHERE position_id = $1', [positionId]);
    for (const epiCatalogItemId of epiCatalogItemIds) {
      await client.query(
        `INSERT INTO position_epi_requirements (tenant_id, position_id, epi_catalog_item_id) VALUES ($1, $2, $3)`,
        [tenantId, positionId, epiCatalogItemId],
      );
    }
  }

  async setTrainingRequirements(client: PoolClient, positionId: string, tipos: string[]): Promise<void> {
    const positionResult = await client.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM positions WHERE id = $1',
      [positionId],
    );
    if (positionResult.rowCount === 0) throw new NotFoundException('Cargo não encontrado');
    const tenantId = positionResult.rows[0].tenant_id;

    for (const tipo of tipos) {
      if (!TRAINING_TYPES.includes(tipo as TrainingType)) {
        throw new BadRequestException(`Tipo de treinamento inválido: ${tipo}`);
      }
    }

    await client.query('DELETE FROM position_training_requirements WHERE position_id = $1', [positionId]);
    for (const tipo of tipos) {
      await client.query(
        `INSERT INTO position_training_requirements (tenant_id, position_id, tipo) VALUES ($1, $2, $3)`,
        [tenantId, positionId, tipo],
      );
    }
  }
}
