import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { buildSafeSetClause } from '../common/safe-update.util';
import { parseEmployeesCsv } from './csv-import.util';

// Únicas colunas que update() pode alterar — nunca confiar nas chaves do
// body pra montar o SET (ver common/safe-update.util.ts).
const UPDATABLE_FIELDS = [
  'full_name',
  'cpf',
  'birth_date',
  'position',
  'admission_date',
  'company_unit_id',
  'status',
] as const;

export interface Employee {
  id: string;
  tenant_id: string;
  user_id: string | null;
  full_name: string;
  cpf: string;
  birth_date: string | null;
  position: string | null;
  admission_date: string | null;
  company_unit_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CreateEmployeeData {
  full_name: string;
  cpf: string;
  birth_date?: string;
  position?: string;
  admission_date?: string;
  company_unit_id?: string;
}

interface UpdateEmployeeData {
  full_name?: string;
  cpf?: string;
  birth_date?: string;
  position?: string;
  admission_date?: string;
  company_unit_id?: string;
  status?: string;
}

export interface ImportRowError {
  linha: number;
  motivo: string;
}

export interface ImportResult {
  importados: number;
  erros: ImportRowError[];
}

@Injectable()
export class EmployeesService {
  // Uma FK do Postgres sozinha não garante que a filial referenciada
  // pertence ao mesmo tenant do funcionário (checagem de FK roda sem
  // filtrar pela RLS da tabela referenciada). Também não dá pra confiar só
  // na RLS de company_units aqui: a policy dessa tabela tem um bypass pra
  // role admin (`current_setting('app.role') = 'admin' OR tenant_id = ...`),
  // então pra um caller admin o SELECT abaixo enxergaria filiais de
  // QUALQUER tenant — por isso o tenant_id é comparado explicitamente na
  // própria query, não deixado a cargo da visibilidade de RLS.
  private async assertCompanyUnitBelongsToTenant(
    client: PoolClient,
    companyUnitId: string,
    tenantId: string,
  ): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (result.rowCount === 0) throw new BadRequestException('Filial não encontrada');
  }

  async create(client: PoolClient, tenantId: string, data: CreateEmployeeData): Promise<Employee> {
    if (data.company_unit_id) {
      await this.assertCompanyUnitBelongsToTenant(client, data.company_unit_id, tenantId);
    }
    const result = await client.query<Employee>(
      `INSERT INTO employees (tenant_id, full_name, cpf, birth_date, position, admission_date, company_unit_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        tenantId,
        data.full_name,
        data.cpf,
        data.birth_date ?? null,
        data.position ?? null,
        data.admission_date ?? null,
        data.company_unit_id ?? null,
      ],
    );
    return result.rows[0];
  }

  async findAll(client: PoolClient, tenantId?: string): Promise<Employee[]> {
    if (tenantId) {
      const result = await client.query<Employee>(
        'SELECT * FROM employees WHERE tenant_id = $1 ORDER BY full_name',
        [tenantId],
      );
      return result.rows;
    }
    // Sem filtro: RLS já restringe pelo contexto (app.tenant_id / app.role).
    const result = await client.query<Employee>('SELECT * FROM employees ORDER BY full_name');
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<Employee> {
    const result = await client.query<Employee>('SELECT * FROM employees WHERE id = $1', [id]);
    const employee = result.rows[0];
    if (!employee) throw new NotFoundException('Funcionário não encontrado');
    return employee;
  }

  async update(client: PoolClient, id: string, data: UpdateEmployeeData): Promise<Employee> {
    if (data.company_unit_id) {
      // O tenant relevante aqui é o do funcionário ALVO (id), não necessariamente o do
      // caller — um admin pode atualizar funcionário de qualquer tenant, então é preciso
      // buscar a qual tenant o funcionário já pertence antes de validar a filial.
      const existing = await client.query<{ tenant_id: string }>('SELECT tenant_id FROM employees WHERE id = $1', [
        id,
      ]);
      if (existing.rowCount === 0) throw new NotFoundException('Funcionário não encontrado');
      await this.assertCompanyUnitBelongsToTenant(client, data.company_unit_id, existing.rows[0].tenant_id);
    }
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

    const result = await client.query<Employee>(
      `UPDATE employees SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const employee = result.rows[0];
    if (!employee) throw new NotFoundException('Funcionário não encontrado');
    return employee;
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    try {
      const result = await client.query('DELETE FROM employees WHERE id = $1', [id]);
      if (result.rowCount === 0) throw new NotFoundException('Funcionário não encontrado');
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      const pgErr = err as { code?: string };
      if (pgErr.code === '23503') {
        throw new ConflictException('Não é possível apagar um funcionário que já foi candidato em uma eleição da CIPA');
      }
      mapPgError(err);
    }
  }

  async importCsv(client: PoolClient, tenantId: string, csvContent: string): Promise<ImportResult> {
    const { rows, formatError } = parseEmployeesCsv(csvContent);
    if (formatError) throw new BadRequestException(formatError);

    const unitsResult = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM company_units WHERE tenant_id = $1',
      [tenantId],
    );
    const unitsByName = new Map(unitsResult.rows.map((u) => [u.name, u.id]));

    const erros: ImportRowError[] = [];
    let importados = 0;

    for (const row of rows) {
      if (!row.full_name) {
        erros.push({ linha: row.line, motivo: 'Nome é obrigatório' });
        continue;
      }
      if (!/^\d{11}$/.test(row.cpf)) {
        erros.push({ linha: row.line, motivo: 'CPF inválido (precisa ter 11 dígitos)' });
        continue;
      }
      const unitId = unitsByName.get(row.company_unit_name);
      if (!unitId) {
        erros.push({ linha: row.line, motivo: `Filial "${row.company_unit_name}" não encontrada` });
        continue;
      }

      // SAVEPOINT por linha: sem isso, o primeiro erro de INSERT (ex: CPF
      // duplicado) deixa a transação inteira "aborted" no Postgres, e
      // toda linha seguinte falharia com "current transaction is
      // aborted", mesmo capturada pelo catch do lado do Node.
      await client.query('SAVEPOINT import_row');
      try {
        await client.query(
          `INSERT INTO employees (tenant_id, full_name, cpf, position, company_unit_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, row.full_name, row.cpf, row.position || null, unitId],
        );
        await client.query('RELEASE SAVEPOINT import_row');
        importados++;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT import_row');
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505') {
          erros.push({ linha: row.line, motivo: 'CPF já cadastrado nesta empresa' });
        } else {
          erros.push({ linha: row.line, motivo: 'Erro ao importar esta linha' });
        }
      }
    }

    return { importados, erros };
  }
}
