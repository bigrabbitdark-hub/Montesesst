import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';

export interface EpiCatalogItem {
  id: string;
  category: string;
  code: string;
  equipment_group: string;
  description: string;
  risk_protected: string;
  related_nr: string | null;
  legal_basis: string;
}

export interface Epi {
  id: string;
  tenant_id: string;
  epi_catalog_item_id: string;
  ca_number: string;
  ca_valid_until: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  category: string;
  code: string;
  equipment_group: string;
  description: string;
}

interface CreateEpiData {
  tenantId: string;
  epiCatalogItemId: string;
  caNumber: string;
  caValidUntil?: string;
  createdByUserId: string;
}

export interface EmployeeEpiDelivery {
  id: string;
  tenant_id: string;
  tenant_epi_id: string;
  employee_id: string;
  delivered_at: string;
  signed_by_name: string;
  signed_at: string;
  created_by_user_id: string;
  created_at: string;
}

interface CreateDeliveryData {
  employeeId: string;
  deliveredAt: string;
  signedByName: string;
  createdByUserId: string;
}

const EPI_SELECT = `
  SELECT te.id, te.tenant_id, te.epi_catalog_item_id, te.ca_number, te.ca_valid_until,
         te.created_by_user_id, te.created_at, te.updated_at,
         eci.category, eci.code, eci.equipment_group, eci.description
  FROM tenant_epis te
  JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
`;

@Injectable()
export class EpiService {
  async findCatalogItems(client: PoolClient): Promise<EpiCatalogItem[]> {
    const result = await client.query<EpiCatalogItem>(
      'SELECT * FROM epi_catalog_items ORDER BY category, code, description',
    );
    return result.rows;
  }

  async create(client: PoolClient, data: CreateEpiData): Promise<Epi> {
    try {
      const result = await client.query<{ id: string }>(
        `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, ca_valid_until, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [data.tenantId, data.epiCatalogItemId, data.caNumber, data.caValidUntil ?? null, data.createdByUserId],
      );
      return this.findOne(client, result.rows[0].id);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, tenantId?: string): Promise<Epi[]> {
    if (tenantId) {
      const result = await client.query<Epi>(
        `${EPI_SELECT} WHERE te.tenant_id = $1 ORDER BY te.created_at DESC`,
        [tenantId],
      );
      return result.rows;
    }
    // Sem filtro: RLS já restringe (admin vê tudo, empresa vê o próprio
    // tenant, técnico/parceiro vê tenants vinculados via
    // assigned_tenant_ids_for_current_user()) — usado pela agenda
    // agregada da carteira.
    const result = await client.query<Epi>(`${EPI_SELECT} ORDER BY te.created_at DESC`);
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<Epi> {
    const result = await client.query<Epi>(`${EPI_SELECT} WHERE te.id = $1`, [id]);
    const epi = result.rows[0];
    if (!epi) throw new NotFoundException('EPI não encontrado');
    return epi;
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    const result = await client.query('DELETE FROM tenant_epis WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('EPI não encontrado');
  }

  async createDelivery(
    client: PoolClient,
    tenantEpiId: string,
    data: CreateDeliveryData,
  ): Promise<EmployeeEpiDelivery> {
    const epi = await this.findOne(client, tenantEpiId);
    try {
      const result = await client.query<EmployeeEpiDelivery>(
        `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, signed_by_name, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [epi.tenant_id, tenantEpiId, data.employeeId, data.deliveredAt, data.signedByName, data.createdByUserId],
      );
      return result.rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async findDeliveries(client: PoolClient, tenantEpiId: string): Promise<EmployeeEpiDelivery[]> {
    const result = await client.query<EmployeeEpiDelivery>(
      'SELECT * FROM employee_epi_deliveries WHERE tenant_epi_id = $1 ORDER BY delivered_at DESC',
      [tenantEpiId],
    );
    return result.rows;
  }
}
