import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';

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

@Injectable()
export class EmployeesService {
  // Uma FK do Postgres sozinha não garante que a filial referenciada
  // pertence ao mesmo tenant do funcionário (checagem de FK roda sem
  // filtrar pela RLS da tabela referenciada) — por isso esta checagem
  // explícita roda dentro do mesmo client com contexto de tenant já
  // setado: a query já vem filtrada pela RLS de company_units sozinha,
  // sem precisar repetir tenant_id aqui.
  private async assertCompanyUnitBelongsToTenant(client: PoolClient, companyUnitId: string): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1', [companyUnitId]);
    if (result.rowCount === 0) throw new BadRequestException('Filial não encontrada');
  }

  async create(client: PoolClient, tenantId: string, data: CreateEmployeeData): Promise<Employee> {
    if (data.company_unit_id) {
      await this.assertCompanyUnitBelongsToTenant(client, data.company_unit_id);
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

  async findAll(client: PoolClient): Promise<Employee[]> {
    // Sem WHERE tenant_id: a RLS já filtra pelo contexto (app.tenant_id / app.role)
    // populado pelo TenantContextInterceptor.
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
      await this.assertCompanyUnitBelongsToTenant(client, data.company_unit_id);
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
    const result = await client.query('DELETE FROM employees WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Funcionário não encontrado');
  }
}
