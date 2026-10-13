import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { normalizeEmployeeInput } from './employee-fields.util';
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
  'esocial_registration',
  'sex',
  'cbo_code',
  'activity_description',
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
  esocial_registration: string | null;
  sex: 'F' | 'M' | null;
  cbo_code: string | null;
  activity_description: string | null;
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
  esocial_registration?: string;
  sex?: string;
  cbo_code?: string;
  activity_description?: string;
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
  esocial_registration?: string;
  sex?: string;
  cbo_code?: string;
  activity_description?: string;
}

export interface EmployeeTableRow {
  id: string;
  sequence: number;
  row_version: string;
  full_name: string;
  esocial_registration: string | null;
  cpf: string;
  birth_date: string | null;
  sex: 'F' | 'M' | null;
  position: string | null;
  admission_date: string | null;
  cbo_code: string | null;
  activity_description: string | null;
  company_unit_id: string | null;
  status: string;
}

// Datas saem como texto (nunca Date do JS) e row_version com precisão de
// microssegundos, para o controle de concorrência otimista da tabela.
const ROW_VERSION_SQL = `to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const TABLE_COLUMNS = `id, full_name, esocial_registration, cpf,
  to_char(birth_date,'YYYY-MM-DD') AS birth_date, sex, position,
  to_char(admission_date,'YYYY-MM-DD') AS admission_date, cbo_code, activity_description,
  company_unit_id, status, ${ROW_VERSION_SQL} AS row_version`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BULK_MAX_CHANGES = 200;

export interface BulkChangeInput {
  id: string;
  row_version: string;
  fields: Record<string, unknown>;
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
    const { values, errors } = normalizeEmployeeInput({
      full_name: data.full_name,
      cpf: data.cpf,
      birth_date: data.birth_date,
      position: data.position,
      admission_date: data.admission_date,
      sex: data.sex,
      cbo_code: data.cbo_code,
      esocial_registration: data.esocial_registration,
      activity_description: data.activity_description,
    });
    if (Object.keys(errors).length) throw new BadRequestException(Object.values(errors).join('; '));
    try {
      const result = await client.query<Employee>(
        `INSERT INTO employees (tenant_id, full_name, cpf, birth_date, position, admission_date, company_unit_id,
                                esocial_registration, sex, cbo_code, activity_description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          tenantId,
          values.full_name,
          values.cpf,
          values.birth_date ?? null,
          values.position ?? null,
          values.admission_date ?? null,
          data.company_unit_id ?? null,
          values.esocial_registration ?? null,
          values.sex ?? null,
          values.cbo_code ?? null,
          values.activity_description ?? null,
        ],
      );
      return result.rows[0];
    } catch (err) {
      mapPgError(err);
    }
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

  async findTable(
    client: PoolClient,
    opts: { tenantId?: string; companyUnitId?: string; limit?: number; offset?: number },
  ): Promise<{ items: EmployeeTableRow[]; total: number }> {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > BULK_MAX_CHANGES) {
      throw new BadRequestException(`limit deve estar entre 1 e ${BULK_MAX_CHANGES}`);
    }
    if (!Number.isInteger(offset) || offset < 0) throw new BadRequestException('offset deve ser maior ou igual a 0');
    for (const [label, v] of [['tenant_id', opts.tenantId], ['company_unit_id', opts.companyUnitId]] as const) {
      if (v !== undefined && !UUID_RE.test(v)) throw new BadRequestException(`${label} inválido`);
    }

    // RLS segue sendo a barreira; os filtros abaixo só estreitam o resultado.
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.tenantId) {
      params.push(opts.tenantId);
      where.push(`tenant_id = $${params.length}`);
    }
    if (opts.companyUnitId) {
      params.push(opts.companyUnitId);
      where.push(`company_unit_id = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalResult = await client.query<{ count: string }>(`SELECT COUNT(*) FROM employees ${whereSql}`, params);
    const rows = await client.query<EmployeeTableRow>(
      // A janela é avaliada antes de OFFSET/LIMIT, então ROW_NUMBER já é offset + posição.
      `SELECT (ROW_NUMBER() OVER (ORDER BY full_name, id))::int AS sequence,
              ${TABLE_COLUMNS}
         FROM employees ${whereSql}
        ORDER BY full_name, id
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return { items: rows.rows, total: parseInt(totalResult.rows[0].count, 10) };
  }

  // Edição em lote atômica (a transação é a do withTenantContext: qualquer
  // exceção desfaz tudo). Concorrência otimista por row_version.
  async bulkUpdate(
    client: PoolClient,
    changes: BulkChangeInput[],
    callerRole: string,
  ): Promise<{ updated: number; items: EmployeeTableRow[] }> {
    if (!Array.isArray(changes) || changes.length < 1 || changes.length > BULK_MAX_CHANGES) {
      throw new BadRequestException(`Envie de 1 a ${BULK_MAX_CHANGES} alterações por vez`);
    }

    const errors: Record<string, string> = {};
    const normalized: { id: string; row_version: string; values: Record<string, unknown> }[] = [];
    const seen = new Set<string>();
    for (const change of changes) {
      const id = typeof change?.id === 'string' ? change.id : '';
      if (!UUID_RE.test(id)) {
        errors['id'] = 'Identificador de funcionário inválido';
        continue;
      }
      if (seen.has(id)) {
        errors[`${id}.id`] = 'Funcionário repetido no lote';
        continue;
      }
      seen.add(id);
      if (typeof change.row_version !== 'string' || !change.row_version) {
        errors[`${id}.row_version`] = 'Versão da linha é obrigatória';
        continue;
      }
      const fields = change.fields;
      if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
        errors[`${id}.fields`] = 'Campos inválidos';
        continue;
      }
      const result = normalizeEmployeeInput(fields);
      for (const [field, message] of Object.entries(result.errors)) errors[`${id}.${field}`] = message;
      normalized.push({ id, row_version: change.row_version, values: result.values });
    }
    if (Object.keys(errors).length) throw new BadRequestException({ message: 'Há campos inválidos', errors });

    const ids = normalized.map((c) => c.id).sort();
    // Ordem fixa de bloqueio evita deadlock entre lotes concorrentes. Id
    // inexistente e id de outro tenant (RLS) são indistinguíveis de propósito.
    const current = await client.query<{ id: string; row_version: string }>(
      `SELECT id, ${ROW_VERSION_SQL} AS row_version FROM employees WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [ids],
    );
    if (current.rowCount !== ids.length) throw new NotFoundException('Funcionário não encontrado');
    const versions = new Map(current.rows.map((r) => [r.id, r.row_version]));
    for (const change of normalized) {
      if (versions.get(change.id) !== change.row_version) {
        throw new ConflictException('Esta linha foi alterada por outra pessoa. Atualize a tabela e refaça a edição.');
      }
    }

    for (const change of normalized) {
      if (Object.keys(change.values).length === 0) continue;
      await this.update(client, change.id, change.values as UpdateEmployeeData, callerRole);
    }

    const items = await client.query<EmployeeTableRow>(
      `SELECT ${TABLE_COLUMNS} FROM employees WHERE id = ANY($1::uuid[]) ORDER BY full_name, id`,
      [ids],
    );
    return { updated: normalized.length, items: items.rows };
  }

  async findOne(client: PoolClient, id: string): Promise<Employee> {
    const result = await client.query<Employee>('SELECT * FROM employees WHERE id = $1', [id]);
    const employee = result.rows[0];
    if (!employee) throw new NotFoundException('Funcionário não encontrado');
    return employee;
  }

  async update(client: PoolClient, id: string, rawData: UpdateEmployeeData, callerRole: string): Promise<Employee> {
    const { values: data, errors } = normalizeEmployeeInput(rawData as Record<string, unknown>);
    if (Object.keys(errors).length) throw new BadRequestException(Object.values(errors).join('; '));
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
      await this.assertCompanyUnitBelongsToTenant(client, data.company_unit_id as string, existing.rows[0].tenant_id);
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
        data.position_id as string,
        existing.rows[0].tenant_id,
      ]);
      if (positionResult.rowCount === 0) throw new BadRequestException('Cargo não encontrado');
    }
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

    let result;
    try {
      result = await client.query<Employee>(
        `UPDATE employees SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
        [id, ...values],
      );
    } catch (err) {
      mapPgError(err);
    }
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

  async importCsv(client: PoolClient, tenantId: string, csvContent: string, callerRole: string): Promise<ImportResult> {
    const { rows, formatError } = parseEmployeesCsv(csvContent);
    if (formatError) throw new BadRequestException(formatError);
    return this.processImportRows(client, tenantId, rows, callerRole);
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
    filename: string | undefined,
    callerRole: string,
  ): Promise<ImportResult> {
    const { rows, formatError } = await parseSpreadsheet(buffer, mimetype, filename);
    if (formatError) throw new BadRequestException(formatError);

    const mappedRows = applyColumnMapping(rows, mapping);
    return this.processImportRows(client, tenantId, mappedRows, callerRole);
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
    callerRole: string,
  ): Promise<ImportResult> {
    const unitsResult = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM company_units WHERE tenant_id = $1',
      [tenantId],
    );
    const unitsByName = new Map(unitsResult.rows.map((u) => [u.name, u.id]));

    // Limite e contagem atual buscados UMA vez antes do loop (mesmo padrão
    // de unitsByName acima) — callerRole admin pula a checagem inteira.
    const limit =
      callerRole === 'admin' ? null : await this.subscriptions.getActiveEmployeeLimit(client, tenantId);
    let currentActiveCount = 0;
    if (limit !== null) {
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) FROM employees WHERE tenant_id = $1 AND status = 'ativo'`,
        [tenantId],
      );
      currentActiveCount = parseInt(countResult.rows[0].count, 10);
    }

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
      if (limit !== null && currentActiveCount + importados >= limit) {
        erros.push({ linha: row.line, motivo: 'Limite de funcionários do plano atingido' });
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
