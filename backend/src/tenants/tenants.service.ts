import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';

const UPDATABLE_FIELDS = ['sector', 'contact_name', 'contact_phone'] as const;

export interface Tenant {
  id: string;
  name: string;
  cnpj: string;
  plan: string;
  status: string;
  sector: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

interface UpdateTenantData {
  sector?: string;
  contact_name?: string;
  contact_phone?: string;
}

// tenants NÃO tem RLS própria (ver Global Constraints do plano) — este
// service nunca aceita um id vindo de fora, só o tenantId já resolvido
// do JWT pelo controller (req.user.tenantId).
@Injectable()
export class TenantsService {
  async findOne(client: PoolClient, id: string): Promise<Tenant> {
    const result = await client.query<Tenant>('SELECT * FROM tenants WHERE id = $1', [id]);
    const tenant = result.rows[0];
    if (!tenant) throw new NotFoundException('Empresa não encontrada');
    return tenant;
  }

  async update(client: PoolClient, id: string, data: UpdateTenantData): Promise<Tenant> {
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

    const result = await client.query<Tenant>(
      `UPDATE tenants SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const tenant = result.rows[0];
    if (!tenant) throw new NotFoundException('Empresa não encontrada');
    return tenant;
  }
}
