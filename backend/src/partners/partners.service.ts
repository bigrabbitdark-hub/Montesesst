import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import * as bcrypt from 'bcrypt';
import { mapPgError } from '../common/pg-error.util';
import { buildSafeSetClause } from '../common/safe-update.util';
import { BCRYPT_COST } from '../common/auth/bcrypt-cost';

// Únicas colunas que update() pode alterar — nunca confiar nas chaves do
// body pra montar o SET (ver common/safe-update.util.ts).
const UPDATABLE_FIELDS = ['service_region', 'status'] as const;

export interface Partner {
  id: string;
  user_id: string;
  service_region: string;
  status: string;
  created_at: string;
  updated_at: string;
  full_name: string | null;
  email: string | null;
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
      const passwordHash = await bcrypt.hash(data.password, BCRYPT_COST);
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

  // LEFT JOIN (não JOIN): users tem RLS própria (users_isolation) e a linha
  // de um parceiro costuma ter tenant_id NULL, invisível pra um caller
  // 'empresa'. Com INNER JOIN isso derrubava silenciosamente a linha inteira
  // de partners (que a RLS de partners_isolation já deixaria ver) — ver
  // backend/test/technicians-partners-fields.e2e-spec.ts.
  async findAll(client: PoolClient): Promise<Partner[]> {
    const result = await client.query<Partner>(
      `SELECT partners.*, users.full_name, users.email
       FROM partners
       LEFT JOIN users ON users.id = partners.user_id
       ORDER BY partners.created_at DESC`,
    );
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<Partner> {
    const result = await client.query<Partner>(
      `SELECT partners.*, users.full_name, users.email
       FROM partners
       LEFT JOIN users ON users.id = partners.user_id
       WHERE partners.id = $1`,
      [id],
    );
    const partner = result.rows[0];
    if (!partner) throw new NotFoundException('Parceiro não encontrado');
    return partner;
  }

  async update(client: PoolClient, id: string, data: UpdatePartnerData): Promise<Partner> {
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

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
