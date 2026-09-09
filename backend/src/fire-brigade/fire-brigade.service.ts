import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { buildSafeSetClause } from '../common/safe-update.util';
import { DocumentsService } from '../documents/documents.service';

export const FUNCAO_BRIGADA_VALUES = ['lider', 'vice_lider', 'brigadista'] as const;
export type FuncaoBrigada = (typeof FUNCAO_BRIGADA_VALUES)[number];

const VENCENDO_WINDOW_DAYS = 30;

export interface FireBrigadeMemberRow {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  employee_id: string;
  funcao_brigada: FuncaoBrigada;
  turno: string | null;
  telefone: string | null;
  status: 'ativo' | 'inativo';
  created_at: string;
  updated_at: string;
}

export interface FireBrigadeMember extends FireBrigadeMemberRow {
  employee_full_name: string;
  position_name: string | null;
}

interface CreateMemberData {
  tenantId: string;
  companyUnitId: string;
  employeeId: string;
  funcaoBrigada: FuncaoBrigada;
  turno?: string;
  telefone?: string;
}

interface UpdateMemberData {
  company_unit_id?: string;
  funcao_brigada?: string;
  turno?: string;
  telefone?: string;
  status?: string;
}

const MEMBER_UPDATABLE_FIELDS = ['company_unit_id', 'funcao_brigada', 'turno', 'telefone', 'status'] as const;

export type BrigadeMemberTrainingStatus = 'vencido' | 'vencendo' | 'treinado';

export function classifyBrigadeTrainingStatus(maxDataValidade: string | Date | null): BrigadeMemberTrainingStatus {
  if (!maxDataValidade) return 'vencido';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const validade = new Date(maxDataValidade);
  validade.setHours(0, 0, 0, 0);
  const diffDays = Math.round((validade.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'vencido';
  if (diffDays <= VENCENDO_WINDOW_DAYS) return 'vencendo';
  return 'treinado';
}

const MEMBER_SELECT = `
  SELECT m.*, e.full_name AS employee_full_name, p.name AS position_name
  FROM fire_brigade_members m
  JOIN employees e ON e.id = m.employee_id
  LEFT JOIN positions p ON p.id = e.position_id
`;

@Injectable()
export class FireBrigadeService {
  constructor(private readonly documents: DocumentsService) {}

  private async assertCompanyUnitBelongsToTenant(client: PoolClient, companyUnitId: string, tenantId: string): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (result.rowCount === 0) throw new BadRequestException('Filial não encontrada');
  }

  async createMember(client: PoolClient, data: CreateMemberData): Promise<FireBrigadeMember> {
    await this.assertCompanyUnitBelongsToTenant(client, data.companyUnitId, data.tenantId);

    const empCheck = await client.query<{ full_name: string }>(
      `SELECT full_name FROM employees WHERE id = $1 AND tenant_id = $2 AND status = 'ativo'`,
      [data.employeeId, data.tenantId],
    );
    if (empCheck.rowCount === 0) {
      throw new BadRequestException('Funcionário informado não pertence a este tenant ou não está ativo');
    }

    try {
      const result = await client.query<{ id: string }>(
        `INSERT INTO fire_brigade_members (tenant_id, company_unit_id, employee_id, funcao_brigada, turno, telefone)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [data.tenantId, data.companyUnitId, data.employeeId, data.funcaoBrigada, data.turno ?? null, data.telefone ?? null],
      );
      return this.findMember(client, result.rows[0].id);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findMembers(
    client: PoolClient,
    filters: { tenantId?: string; companyUnitId?: string; status?: string },
  ): Promise<FireBrigadeMember[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filters.tenantId) {
      values.push(filters.tenantId);
      conditions.push(`m.tenant_id = $${values.length}`);
    }
    if (filters.companyUnitId) {
      values.push(filters.companyUnitId);
      conditions.push(`m.company_unit_id = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      conditions.push(`m.status = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await client.query<FireBrigadeMember>(`${MEMBER_SELECT} ${where} ORDER BY e.full_name`, values);
    return result.rows;
  }

  async findMember(client: PoolClient, id: string): Promise<FireBrigadeMember> {
    const result = await client.query<FireBrigadeMember>(`${MEMBER_SELECT} WHERE m.id = $1`, [id]);
    const member = result.rows[0];
    if (!member) throw new NotFoundException('Brigadista não encontrado');
    return member;
  }

  async updateMember(client: PoolClient, id: string, data: UpdateMemberData): Promise<FireBrigadeMember> {
    if (data.company_unit_id) {
      const existing = await client.query<{ tenant_id: string }>('SELECT tenant_id FROM fire_brigade_members WHERE id = $1', [
        id,
      ]);
      if (existing.rowCount === 0) throw new NotFoundException('Brigadista não encontrado');
      await this.assertCompanyUnitBelongsToTenant(client, data.company_unit_id, existing.rows[0].tenant_id);
    }
    const { setClauses, values } = buildSafeSetClause(data, MEMBER_UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findMember(client, id);

    const result = await client.query<{ id: string }>(
      `UPDATE fire_brigade_members SET ${setClauses.join(', ')} WHERE id = $1 RETURNING id`,
      [id, ...values],
    );
    if (result.rowCount === 0) throw new NotFoundException('Brigadista não encontrado');
    return this.findMember(client, id);
  }

  async removeMember(client: PoolClient, id: string): Promise<void> {
    const result = await client.query('DELETE FROM fire_brigade_members WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Brigadista não encontrado');
  }
}
