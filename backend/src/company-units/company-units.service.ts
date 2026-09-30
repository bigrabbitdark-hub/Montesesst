import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';

// ITEM 019 (auditoria 2026-09-27): apagar uma filial apagava em CASCATA todo o histórico
// de conformidade vinculado a ela (CIPA, brigada de incêndio, checklist de prevenção) — 12
// tabelas, sem confirmação nem aviso do que ia junto. Decisão do fundador (2026-09-28):
// nunca apagar de verdade. `remove()` reaproveita a coluna `status` (já existia, sem uso
// nenhum até então) para marcar a filial como 'inativo' — reversível via
// PATCH .../company-units/:id { status: 'ativo' }, que já era uma rota existente.

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
