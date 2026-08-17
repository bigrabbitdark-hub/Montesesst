import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface Employee {
  id: string;
  tenant_id: string;
  user_id: string | null;
  full_name: string;
  cpf: string;
  birth_date: string | null;
  position: string | null;
  admission_date: string | null;
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
}

interface UpdateEmployeeData {
  full_name?: string;
  cpf?: string;
  birth_date?: string;
  position?: string;
  admission_date?: string;
  status?: string;
}

@Injectable()
export class EmployeesService {
  async create(client: PoolClient, tenantId: string, data: CreateEmployeeData): Promise<Employee> {
    const result = await client.query<Employee>(
      `INSERT INTO employees (tenant_id, full_name, cpf, birth_date, position, admission_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        tenantId,
        data.full_name,
        data.cpf,
        data.birth_date ?? null,
        data.position ?? null,
        data.admission_date ?? null,
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
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return this.findOne(client, id);

    const setClauses = entries.map(([field], idx) => `${field} = $${idx + 2}`);
    const values = entries.map(([, value]) => value);

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
