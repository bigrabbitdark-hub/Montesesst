import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import * as bcrypt from 'bcrypt';
import { mapPgError } from '../common/pg-error.util';

export interface Partner {
  id: string;
  user_id: string;
  service_region: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CreatePartnerData {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
  service_region: string;
}

interface UpdatePartnerData {
  service_region?: string;
  status?: string;
}

@Injectable()
export class PartnersService {
  async create(client: PoolClient, data: CreatePartnerData): Promise<Partner> {
    try {
      const passwordHash = await bcrypt.hash(data.password, 10);
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users (role, email, password_hash, full_name, phone, status)
         VALUES ('parceiro', $1, $2, $3, $4, 'ativo') RETURNING id`,
        [data.email, passwordHash, data.full_name, data.phone ?? null],
      );
      const result = await client.query<Partner>(
        `INSERT INTO partners (user_id, service_region) VALUES ($1, $2) RETURNING *`,
        [userResult.rows[0].id, data.service_region],
      );
      return result.rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient): Promise<Partner[]> {
    const result = await client.query<Partner>('SELECT * FROM partners ORDER BY created_at DESC');
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<Partner> {
    const result = await client.query<Partner>('SELECT * FROM partners WHERE id = $1', [id]);
    const partner = result.rows[0];
    if (!partner) throw new NotFoundException('Parceiro não encontrado');
    return partner;
  }

  async update(client: PoolClient, id: string, data: UpdatePartnerData): Promise<Partner> {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return this.findOne(client, id);

    const setClauses = entries.map(([field], idx) => `${field} = $${idx + 2}`);
    const values = entries.map(([, value]) => value);

    const result = await client.query<Partner>(
      `UPDATE partners SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const partner = result.rows[0];
    if (!partner) throw new NotFoundException('Parceiro não encontrado');
    return partner;
  }

  async assign(client: PoolClient, partnerId: string, tenantId: string): Promise<void> {
    try {
      await client.query(
        `INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)
         ON CONFLICT (tenant_id, partner_id) DO UPDATE SET status = 'ativo'`,
        [tenantId, partnerId],
      );
    } catch (err) {
      mapPgError(err);
    }
  }

  async unassign(client: PoolClient, partnerId: string, tenantId: string): Promise<void> {
    const result = await client.query(
      'DELETE FROM tenant_partners WHERE tenant_id = $1 AND partner_id = $2',
      [tenantId, partnerId],
    );
    if (result.rowCount === 0) throw new NotFoundException('Vínculo não encontrado');
  }
}
