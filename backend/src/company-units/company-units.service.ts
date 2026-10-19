import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';
import { mapPgError } from '../common/pg-error.util';

// ITEM 019 (auditoria 2026-09-27): apagar uma filial apagava em CASCATA todo o histórico
// de conformidade vinculado a ela (CIPA, brigada de incêndio, checklist de prevenção) — 12
// tabelas, sem confirmação nem aviso do que ia junto. Decisão do fundador (2026-09-28):
// nunca apagar de verdade. `remove()` reaproveita a coluna `status` (já existia, sem uso
// nenhum até então) para marcar a filial como 'inativo' — reversível via
// PATCH .../company-units/:id { status: 'ativo' }, que já era uma rota existente.

const UPDATABLE_FIELDS = [
  'name',
  'cnpj',
  'address_street',
  'address_number',
  'address_city',
  'address_state',
  'address_zip',
  'status',
  'legal_name',
  'notes',
  'address_neighborhood',
  'address_complement',
  'cnae_code',
  'cnae_description',
] as const;

export interface CompanyUnit {
  id: string;
  tenant_id: string;
  name: string;
  // Nulo nas filiais anteriores a esta coluna e na matriz (que usa tenants.cnpj).
  cnpj: string | null;
  address_street: string;
  address_number: string | null;
  address_city: string;
  address_state: string;
  address_zip: string;
  legal_name: string | null;
  notes: string | null;
  address_neighborhood: string | null;
  address_complement: string | null;
  cnae_code: string | null;
  cnae_description: string | null;
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
  cnpj: string;
  address_street: string;
  address_number?: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  legal_name?: string;
  notes?: string;
  address_neighborhood?: string;
  address_complement?: string;
  cnae_code?: string;
  cnae_description?: string;
}

interface UpdateCompanyUnitData {
  name?: string;
  cnpj?: string;
  address_street?: string;
  address_number?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  status?: string;
  legal_name?: string;
  notes?: string;
  address_neighborhood?: string;
  address_complement?: string;
  cnae_code?: string;
  cnae_description?: string;
}

@Injectable()
export class CompanyUnitsService {
  // O CNPJ da filial não pode ser o da própria empresa (o da matriz, em tenants.cnpj).
  private async assertNotTenantCnpj(client: PoolClient, tenantId: string, cnpj: string): Promise<void> {
    const result = await client.query<{ cnpj: string }>('SELECT cnpj FROM tenants WHERE id = $1', [tenantId]);
    if (result.rows[0]?.cnpj === cnpj) {
      throw new BadRequestException('Este CNPJ é o da matriz. Informe o CNPJ próprio da filial.');
    }
  }

  async create(client: PoolClient, tenantId: string, data: CreateCompanyUnitData): Promise<CompanyUnit> {
    await this.assertNotTenantCnpj(client, tenantId, data.cnpj);
    try {
      const result = await client.query<CompanyUnit>(
        `INSERT INTO company_units (tenant_id, name, cnpj, address_street, address_number, address_city, address_state, address_zip,
                                   legal_name, notes, address_neighborhood, address_complement, cnae_code, cnae_description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [
          tenantId,
          data.name,
          data.cnpj,
          data.address_street,
          data.address_number ?? null,
          data.address_city,
          data.address_state,
          data.address_zip,
          data.legal_name ?? null,
          data.notes ?? null,
          data.address_neighborhood ?? null,
          data.address_complement ?? null,
          data.cnae_code || null,
          data.cnae_description ?? null,
        ],
      );
      return result.rows[0];
    } catch (err) {
      this.throwIfDuplicateCnpj(err);
      mapPgError(err);
    }
  }

  private throwIfDuplicateCnpj(err: unknown): void {
    const pg = err as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === 'company_units_cnpj_per_tenant') {
      throw new ConflictException('Já existe uma filial com este CNPJ nesta empresa.');
    }
  }

  // `includeInactive`: por padrão as listagens (seletor de filial pra agendar visita, ficha
  // da empresa vista pelo técnico, etc.) não devem oferecer uma filial desativada. `true` é
  // o único jeito de redescobrir o id de uma filial desativada para reativá-la — sem UI
  // dedicada hoje, é a rota de recuperação real.
  async findAll(client: PoolClient, includeInactive = false): Promise<CompanyUnit[]> {
    // Sem WHERE tenant_id: RLS já filtra pelo contexto (app.tenant_id/app.role).
    const result = await client.query<CompanyUnit>(
      includeInactive
        ? 'SELECT * FROM company_units ORDER BY name'
        : `SELECT * FROM company_units WHERE status <> 'inativo' ORDER BY name`,
    );
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<CompanyUnit> {
    const result = await client.query<CompanyUnit>('SELECT * FROM company_units WHERE id = $1', [id]);
    const unit = result.rows[0];
    if (!unit) throw new NotFoundException('Filial não encontrada');
    return unit;
  }

  async update(client: PoolClient, id: string, data: UpdateCompanyUnitData): Promise<CompanyUnit> {
    // A mesma proteção do remove() vale aqui: sem isso, dava pra desativar a matriz só
    // trocando de rota (PATCH status='inativo' em vez de DELETE).
    if (data.status === 'inativo') {
      const current = await this.findOne(client, id);
      if (current.is_matriz) {
        throw new BadRequestException('A matriz não pode ser desativada — é a unidade do cadastro da empresa.');
      }
    }

    if (data.cnpj !== undefined) {
      const current = await this.findOne(client, id);
      if (current.is_matriz) {
        throw new BadRequestException('O CNPJ da matriz é o do cadastro da empresa e não muda aqui.');
      }
      await this.assertNotTenantCnpj(client, current.tenant_id, data.cnpj);
    }

    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

    try {
      const result = await client.query<CompanyUnit>(
        `UPDATE company_units SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
        [id, ...values],
      );
      const unit = result.rows[0];
      if (!unit) throw new NotFoundException('Filial não encontrada');
      return unit;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.throwIfDuplicateCnpj(err);
      mapPgError(err);
    }
  }

  // Nunca DELETE físico (ver comentário no topo do arquivo — ITEM 019). Idempotente: chamar
  // de novo numa filial já inativa não é erro. Reativação: PATCH .../:id { status: 'ativo' }.
  async remove(client: PoolClient, id: string): Promise<void> {
    const unit = await this.findOne(client, id);
    if (unit.is_matriz) {
      throw new BadRequestException('A matriz não pode ser removida — é a unidade do cadastro da empresa.');
    }
    await client.query(`UPDATE company_units SET status = 'inativo' WHERE id = $1`, [id]);
  }
}
