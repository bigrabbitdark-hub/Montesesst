import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';

const UPDATABLE_FIELDS = ['sector', 'contact_name', 'contact_phone'] as const;

export interface TenantLink {
  id: string;
  name: string;
}

export interface TenantWithLinks extends Tenant {
  technicians: TenantLink[];
  partners: TenantLink[];
}

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
  async findAllWithLinks(client: PoolClient): Promise<TenantWithLinks[]> {
    const result = await client.query<TenantWithLinks>(
      `SELECT
         t.id, t.name, t.cnpj, t.plan, t.status, t.sector, t.contact_name,
         t.contact_phone, t.created_at, t.updated_at,
         COALESCE(
           (SELECT json_agg(jsonb_build_object('id', tech.id, 'name', tu.full_name))
            FROM tenant_technicians tt
            JOIN technicians tech ON tech.id = tt.technician_id
            JOIN users tu ON tu.id = tech.user_id
            WHERE tt.tenant_id = t.id AND tt.status = 'ativo'),
           '[]'
         ) AS technicians,
         COALESCE(
           (SELECT json_agg(jsonb_build_object('id', p.id, 'name', pu.full_name))
            FROM tenant_partners tp
            JOIN partners p ON p.id = tp.partner_id
            JOIN users pu ON pu.id = p.user_id
            WHERE tp.tenant_id = t.id AND tp.status = 'ativo'),
           '[]'
         ) AS partners
       FROM tenants t
       ORDER BY t.created_at DESC`,
    );
    return result.rows;
  }

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
