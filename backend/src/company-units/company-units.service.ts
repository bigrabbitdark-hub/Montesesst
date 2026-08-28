import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';

const UPDATABLE_FIELDS = [
  'name',
  'address_street',
  'address_number',
  'address_city',
  'address_state',
  'address_zip',
  'status',
] as const;

export interface CompanyUnit {
  id: string;
  tenant_id: string;
  name: string;
  address_street: string;
  address_number: string | null;
  address_city: string;
  address_state: string;
  address_zip: string;
  status: string;
  // Só true na unidade criada automaticamente por TenantsService.update()
  // quando o endereço da matriz fica completo — nenhum endpoint deste
  // service aceita esse campo como entrada, é sempre false aqui.
  is_matriz: boolean;
  created_at: string;
  updated_at: string;
}

interface CreateCompanyUnitData {
  name: string;
  address_street: string;
  address_number?: string;
  address_city: string;
  address_state: string;
  address_zip: string;
}

interface UpdateCompanyUnitData {
  name?: string;
  address_street?: string;
  address_number?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  status?: string;
}

@Injectable()
export class CompanyUnitsService {
  async create(client: PoolClient, tenantId: string, data: CreateCompanyUnitData): Promise<CompanyUnit> {
    const result = await client.query<CompanyUnit>(
      `INSERT INTO company_units (tenant_id, name, address_street, address_number, address_city, address_state, address_zip)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        tenantId,
        data.name,
        data.address_street,
        data.address_number ?? null,
        data.address_city,
        data.address_state,
        data.address_zip,
      ],
    );
    return result.rows[0];
  }

  async findAll(client: PoolClient): Promise<CompanyUnit[]> {
    // Sem WHERE tenant_id: RLS já filtra pelo contexto (app.tenant_id/app.role).
    const result = await client.query<CompanyUnit>('SELECT * FROM company_units ORDER BY name');
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<CompanyUnit> {
    const result = await client.query<CompanyUnit>('SELECT * FROM company_units WHERE id = $1', [id]);
    const unit = result.rows[0];
    if (!unit) throw new NotFoundException('Filial não encontrada');
    return unit;
  }

  async update(client: PoolClient, id: string, data: UpdateCompanyUnitData): Promise<CompanyUnit> {
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

    const result = await client.query<CompanyUnit>(
      `UPDATE company_units SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const unit = result.rows[0];
    if (!unit) throw new NotFoundException('Filial não encontrada');
    return unit;
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    const result = await client.query('DELETE FROM company_units WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Filial não encontrada');
  }
}
