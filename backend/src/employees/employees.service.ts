import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { buildSafeSetClause } from '../common/safe-update.util';
import { parseEmployeesCsv, ParsedCsvRow } from './csv-import.util';
import { applyColumnMapping, ColumnMapping, MappedEmployeeRow, parseSpreadsheet, suggestColumnMapping } from './spreadsheet-import.util';
import { SubscriptionsService } from '../payments/subscriptions.service';

// Únicas colunas que update() pode alterar — nunca confiar nas chaves do
// body pra montar o SET (ver common/safe-update.util.ts).
const UPDATABLE_FIELDS = [
  'full_name',
  'cpf',
  'birth_date',
  'position',
  'admission_date',
  'company_unit_id',
  'position_id',
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
  position_id?: string;
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
  constructor(private readonly subscriptions: SubscriptionsService) {}

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

  private async assertEmployeeLimitNotExceeded(client: PoolClient, tenantId: string, callerRole: string): Promise<void> {
    if (callerRole === 'admin') return;
    const limit = await this.subscriptions.getActiveEmployeeLimit(client, tenantId);
    if (limit === null) return;
    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) FROM employees WHERE tenant_id = $1 AND status = 'ativo'`,
      [tenantId],
    );
    const count = parseInt(countResult.rows[0].count, 10);
    if (count >= limit) {
      throw new ForbiddenException(`Limite de ${limit} funcionários do plano atingido. Faça upgrade para adicionar mais.`);
    }
  }

  async create(client: PoolClient, tenantId: string, data: CreateEmployeeData, callerRole: string): Promise<Employee> {
    await this.assertEmployeeLimitNotExceeded(client, tenantId, callerRole);
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

  async update(client: PoolClient, id: string, data: UpdateEmployeeData, callerRole: string): Promise<Employee> {
    if (data.status === 'ativo') {
      const existing = await client.query<{ tenant_id: string; status: string }>(
        'SELECT tenant_id, status FROM employees WHERE id = $1',
        [id],
      );
      if (existing.rowCount === 0) throw new NotFoundException('Funcionário não encontrado');
      if (existing.rows[0].status !== 'ativo') {
        await this.assertEmployeeLimitNotExceeded(client, existing.rows[0].tenant_id, callerRole);
      }
    }
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
    if (data.position_id) {
      // Mesmo raciocínio de company_unit_id acima: um position_id de outro
      // tenant não é barrado pela RLS de `positions` pro role admin (bypass
      // explícito na policy), então precisa de checagem cruzada explícita
      // aqui, não só confiar na visibilidade de RLS.
      const existing = await client.query<{ tenant_id: string }>('SELECT tenant_id FROM employees WHERE id = $1', [
        id,
      ]);
      if (existing.rowCount === 0) throw new NotFoundException('Funcionário não encontrado');
      const positionResult = await client.query('SELECT id FROM positions WHERE id = $1 AND tenant_id = $2', [
        data.position_id,
        existing.rows[0].tenant_id,
      ]);
      if (positionResult.rowCount === 0) throw new BadRequestException('Cargo não encontrado');
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
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23503') {
        // Fase 15: cipa_trainings.employee_id também é RESTRICT agora
        // (histórico de treinamento é compliance NR, não pode ser
        // apagado junto com o funcionário). O nome da constraint abaixo
        // é o gerado automaticamente pelo Postgres pra uma FK sem nome
        // explícito (<tabela>_<coluna>_fkey) — confirmado contra o
        // Postgres real (`\d cipa_trainings`) durante a implementação
        // desta task, não é um palpite.
        if (pgErr.constraint === 'cipa_trainings_employee_id_fkey') {
          throw new ConflictException('Não é possível apagar um funcionário que tem histórico de treinamento registrado');
        }
        throw new ConflictException('Não é possível apagar um funcionário que já foi candidato em uma eleição da CIPA');
      }
      mapPgError(err);
    }
  }

  async importCsv(client: PoolClient, tenantId: string, csvContent: string): Promise<ImportResult> {
    const { rows, formatError } = parseEmployeesCsv(csvContent);
    if (formatError) throw new BadRequestException(formatError);
    return this.processImportRows(client, tenantId, rows);
  }

  async previewSpreadsheet(
    buffer: Buffer,
    mimetype: string,
    filename?: string,
  ): Promise<{ headers: string[]; suggested_mapping: ColumnMapping; sample_rows: string[][]; total_rows: number }> {
    const { headers, rows, formatError } = await parseSpreadsheet(buffer, mimetype, filename);
    if (formatError) throw new BadRequestException(formatError);

    return {
      headers,
      suggested_mapping: suggestColumnMapping(headers),
      sample_rows: rows.slice(0, 5),
      total_rows: rows.length,
    };
  }

  async importMapped(
    client: PoolClient,
    tenantId: string,
    buffer: Buffer,
    mimetype: string,
    mapping: ColumnMapping,
    filename?: string,
  ): Promise<ImportResult> {
    const { rows, formatError } = await parseSpreadsheet(buffer, mimetype, filename);
    if (formatError) throw new BadRequestException(formatError);

    const mappedRows = applyColumnMapping(rows, mapping);
    return this.processImportRows(client, tenantId, mappedRows);
  }

  // Compartilhado entre importCsv (caminho antigo, cabeçalho fixo) e
  // importMapped (Fase 22, mapeamento flexível de coluna) — os dois
  // convergem pro mesmo formato de linha (ParsedCsvRow e
  // MappedEmployeeRow têm exatamente os mesmos 5 campos) antes de chegar
  // aqui, então a validação/inserção em si nunca precisou saber de onde a
  // linha veio.
  private async processImportRows(
    client: PoolClient,
    tenantId: string,
    rows: (ParsedCsvRow | MappedEmployeeRow)[],
  ): Promise<ImportResult> {
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

      // SAVEPOINT por linha: sem isso, o primeiro erro de INSERT (ex.: CPF
      // duplicado) deixa a transação inteira em estado "aborted" pro
      // Postgres, que rejeita todo comando subsequente até um ROLLBACK —
      // inclusive o INSERT das linhas seguintes que seriam válidas.
      // Isolando cada linha em seu próprio savepoint, só a linha que falhou
      // é desfeita, as demais seguem normalmente.
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
