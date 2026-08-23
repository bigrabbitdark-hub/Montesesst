import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface LinkedTenant {
  tenant_id: string;
  tenant_name: string;
  tenant_cnpj: string;
}

@Injectable()
export class TenantTechniciansService {
  async findMyTenants(client: PoolClient, userId: string): Promise<LinkedTenant[]> {
    const result = await client.query<LinkedTenant>(
      `SELECT t.id AS tenant_id, t.name AS tenant_name, t.cnpj AS tenant_cnpj
       FROM tenant_technicians tt
       JOIN technicians tech ON tech.id = tt.technician_id
       JOIN tenants t ON t.id = tt.tenant_id
       WHERE tech.user_id = $1
       ORDER BY t.name`,
      [userId],
    );
    return result.rows;
  }
}
