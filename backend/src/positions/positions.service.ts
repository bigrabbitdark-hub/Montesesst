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
  divergence_count: number;
}

export interface LinkSuggestion {
  suggested_name: string;
  employees: { id: string; full_name: string }[];
}

export interface Divergence {
  employee_id: string;
  employee_name: string;
  position_id: string;
  position_name: string;
  categoria: 'epi' | 'treinamento';
  requisito: string;
  empresa_tem_no_catalogo?: boolean;
}

export interface PositionDetail {
  id: string;
  name: string;
  epi_requirement_ids: string[];
  training_requirement_tipos: string[];
  employees: {
    id: string;
    full_name: string;
    divergences: Omit<Divergence, 'employee_id' | 'employee_name' | 'position_id' | 'position_name'>[];
  }[];
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
    const result = await client.query<Omit<PositionSummary, 'divergence_count'>>(
      `SELECT p.id, p.name,
         (SELECT COUNT(*)::int FROM employees e WHERE e.position_id = p.id) AS employee_count,
         (SELECT COUNT(*)::int FROM position_epi_requirements per WHERE per.position_id = p.id) AS epi_requirement_count,
         (SELECT COUNT(*)::int FROM position_training_requirements ptr WHERE ptr.position_id = p.id) AS training_requirement_count
       FROM positions p
       WHERE p.tenant_id = $1
       ORDER BY p.name`,
      [tenantId],
    );

    const divergences = await this.getDivergences(client, tenantId);
    const countByPosition = new Map<string, number>();
    for (const divergence of divergences) {
      countByPosition.set(divergence.position_id, (countByPosition.get(divergence.position_id) ?? 0) + 1);
    }

    return result.rows.map((row) => ({ ...row, divergence_count: countByPosition.get(row.id) ?? 0 }));
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
    const result = await client.query<{ id: string; full_name: string; position: string }>(
      `SELECT id, full_name, position FROM employees
       WHERE tenant_id = $1 AND position_id IS NULL AND position IS NOT NULL AND position != ''`,
      [tenantId],
    );

    const groups = new Map<
      string,
      { rawCounts: Map<string, number>; employees: { id: string; full_name: string }[] }
    >();
    for (const row of result.rows) {
      const normalized = this.normalizePositionText(row.position);
      if (!groups.has(normalized)) groups.set(normalized, { rawCounts: new Map(), employees: [] });
      const group = groups.get(normalized)!;
      group.employees.push({ id: row.id, full_name: row.full_name });
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
        employees: group.employees,
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

    try {
      await client.query('DELETE FROM position_epi_requirements WHERE position_id = $1', [positionId]);
      for (const epiCatalogItemId of epiCatalogItemIds) {
        await client.query(
          `INSERT INTO position_epi_requirements (tenant_id, position_id, epi_catalog_item_id) VALUES ($1, $2, $3)`,
          [tenantId, positionId, epiCatalogItemId],
        );
      }
    } catch (err) {
      mapPgError(err);
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

    try {
      await client.query('DELETE FROM position_training_requirements WHERE position_id = $1', [positionId]);
      for (const tipo of tipos) {
        await client.query(
          `INSERT INTO position_training_requirements (tenant_id, position_id, tipo) VALUES ($1, $2, $3)`,
          [tenantId, positionId, tipo],
        );
      }
    } catch (err) {
      mapPgError(err);
    }
  }

  async getDivergences(client: PoolClient, tenantId: string): Promise<Divergence[]> {
    const epiDivergences = await client.query<Divergence>(
      `SELECT e.id AS employee_id, e.full_name AS employee_name, p.id AS position_id, p.name AS position_name,
              'epi'::text AS categoria, eci.description AS requisito,
              EXISTS (SELECT 1 FROM tenant_epis te WHERE te.tenant_id = e.tenant_id
                      AND te.epi_catalog_item_id = eci.id) AS empresa_tem_no_catalogo
       FROM employees e
       JOIN positions p ON p.id = e.position_id
       JOIN position_epi_requirements per ON per.position_id = p.id
       JOIN epi_catalog_items eci ON eci.id = per.epi_catalog_item_id
       WHERE e.tenant_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM employee_epi_deliveries eed
           JOIN tenant_epis te ON te.id = eed.tenant_epi_id
           WHERE eed.employee_id = e.id AND te.epi_catalog_item_id = eci.id
         )`,
      [tenantId],
    );

    const trainingDivergences = await client.query<Divergence>(
      `SELECT e.id AS employee_id, e.full_name AS employee_name, p.id AS position_id, p.name AS position_name,
              'treinamento'::text AS categoria, ptr.tipo AS requisito
       FROM employees e
       JOIN positions p ON p.id = e.position_id
       JOIN position_training_requirements ptr ON ptr.position_id = p.id
       WHERE e.tenant_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM cipa_trainings ct
           WHERE ct.employee_id = e.id AND ct.tipo = ptr.tipo AND ct.data_validade >= CURRENT_DATE
         )`,
      [tenantId],
    );

    return [...epiDivergences.rows, ...trainingDivergences.rows];
  }

  async findOne(client: PoolClient, id: string): Promise<PositionDetail> {
    const positionResult = await client.query<{ id: string; name: string; tenant_id: string }>(
      'SELECT id, name, tenant_id FROM positions WHERE id = $1',
      [id],
    );
    const position = positionResult.rows[0];
    if (!position) throw new NotFoundException('Cargo não encontrado');

    const epiReqResult = await client.query<{ epi_catalog_item_id: string }>(
      'SELECT epi_catalog_item_id FROM position_epi_requirements WHERE position_id = $1',
      [id],
    );
    const trainingReqResult = await client.query<{ tipo: string }>(
      'SELECT tipo FROM position_training_requirements WHERE position_id = $1',
      [id],
    );
    const employeesResult = await client.query<{ id: string; full_name: string }>(
      'SELECT id, full_name FROM employees WHERE position_id = $1 ORDER BY full_name',
      [id],
    );

    const allDivergences = await this.getDivergences(client, position.tenant_id);
    const divergencesByEmployee = new Map<string, Divergence[]>();
    for (const divergence of allDivergences) {
      if (divergence.position_id !== id) continue;
      if (!divergencesByEmployee.has(divergence.employee_id)) divergencesByEmployee.set(divergence.employee_id, []);
      divergencesByEmployee.get(divergence.employee_id)!.push(divergence);
    }

    return {
      id: position.id,
      name: position.name,
      epi_requirement_ids: epiReqResult.rows.map((r) => r.epi_catalog_item_id),
      training_requirement_tipos: trainingReqResult.rows.map((r) => r.tipo),
      employees: employeesResult.rows.map((employee) => ({
        id: employee.id,
        full_name: employee.full_name,
        divergences: (divergencesByEmployee.get(employee.id) ?? []).map((d) => ({
          categoria: d.categoria,
          requisito: d.requisito,
          ...(d.categoria === 'epi' ? { empresa_tem_no_catalogo: d.empresa_tem_no_catalogo } : {}),
        })),
      })),
    };
  }
}
