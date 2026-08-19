import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import * as bcrypt from 'bcrypt';
import { mapPgError } from '../common/pg-error.util';
import { buildSafeSetClause } from '../common/safe-update.util';

// Únicas colunas que update() pode alterar — nunca confiar nas chaves do
// body pra montar o SET (ver common/safe-update.util.ts).
const UPDATABLE_FIELDS = ['registration_number', 'specialization', 'status'] as const;

export interface Technician {
  id: string;
  user_id: string;
  registration_number: string | null;
  specialization: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CreateTechnicianData {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
  registration_number?: string;
  specialization?: string;
}

interface UpdateTechnicianData {
  registration_number?: string;
  specialization?: string;
  status?: string;
}

@Injectable()
export class TechniciansService {
  async create(client: PoolClient, data: CreateTechnicianData): Promise<Technician> {
    try {
      const passwordHash = await bcrypt.hash(data.password, 10);
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users (role, email, password_hash, full_name, phone, status)
         VALUES ('tecnico', $1, $2, $3, $4, 'ativo') RETURNING id`,
        [data.email, passwordHash, data.full_name, data.phone ?? null],
      );
      const result = await client.query<Technician>(
        `INSERT INTO technicians (user_id, registration_number, specialization)
         VALUES ($1, $2, $3) RETURNING *`,
        [userResult.rows[0].id, data.registration_number ?? null, data.specialization ?? null],
      );
      return result.rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient): Promise<Technician[]> {
    const result = await client.query<Technician>(
      'SELECT * FROM technicians ORDER BY created_at DESC',
    );
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<Technician> {
    const result = await client.query<Technician>('SELECT * FROM technicians WHERE id = $1', [id]);
    const technician = result.rows[0];
    if (!technician) throw new NotFoundException('Técnico não encontrado');
    return technician;
  }

  async update(client: PoolClient, id: string, data: UpdateTechnicianData): Promise<Technician> {
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

    const result = await client.query<Technician>(
      `UPDATE technicians SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const technician = result.rows[0];
    if (!technician) throw new NotFoundException('Técnico não encontrado');
    return technician;
  }

  async assign(client: PoolClient, technicianId: string, tenantId: string): Promise<void> {
    try {
      await client.query(
        `INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)
         ON CONFLICT (tenant_id, technician_id) DO UPDATE SET status = 'ativo'`,
        [tenantId, technicianId],
      );
    } catch (err) {
      mapPgError(err);
    }
  }

  async unassign(client: PoolClient, technicianId: string, tenantId: string): Promise<void> {
    const result = await client.query(
      'DELETE FROM tenant_technicians WHERE tenant_id = $1 AND technician_id = $2',
      [tenantId, technicianId],
    );
    if (result.rowCount === 0) throw new NotFoundException('Vínculo não encontrado');
  }
}
