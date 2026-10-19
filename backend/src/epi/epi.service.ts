import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { buildSafeSetClause } from '../common/safe-update.util';
import { UpdateEpiDto } from './dto/update-epi.dto';

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
  manufacturer: string | null;
  model: string | null;
  unit: string;
  min_stock: number | null;
  max_stock: number | null;
  unit_cost: string | null;
  controls_lot: boolean;
  replacement_days: number | null;
  status: string;
  stock_balance: number;
}

// Campos editáveis pelo PATCH (allowlist; nomes de coluna nunca vêm do corpo).
const UPDATABLE = [
  'manufacturer', 'model', 'unit', 'min_stock', 'max_stock', 'unit_cost', 'controls_lot',
  'replacement_days', 'status', 'ca_number', 'ca_valid_until',
] as const;

// "Hoje" no fuso da operação (a sessão do banco pode estar em UTC).
export const TODAY_SP = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;

export interface SearchEpisQuery {
  tenantId?: string;
  q?: string;
  status?: string;
  category?: string;
  stockBand?: string;
  caAlert?: string;
  page: number;
  pageSize: number;
}

export interface EpiListItem extends Epi {
  stock_band: 'sem_estoque' | 'abaixo' | 'otimo' | 'acima';
  ca_alert: 'vencido' | 'a_vencer' | 'ok' | 'sem_validade';
  lots_expired: number;
  lots_expiring: number;
  stock_value: string;
}

interface CreateEpiData {
  tenantId: string;
  epiCatalogItemId: string;
  caNumber: string;
  caValidUntil?: string;
  manufacturer?: string;
  model?: string;
  unit?: string;
  minStock?: number;
  maxStock?: number;
  unitCost?: number;
  controlsLot?: boolean;
  replacementDays?: number;
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
         eci.category, eci.code, eci.equipment_group, eci.description,
         te.manufacturer, te.model, te.unit, te.min_stock, te.max_stock, te.unit_cost,
         te.controls_lot, te.replacement_days, te.status, te.stock_balance
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
    if (data.minStock != null && data.maxStock != null && data.maxStock < data.minStock) {
      throw new BadRequestException('Estoque máximo menor que o mínimo');
    }
    try {
      const result = await client.query<{ id: string }>(
        `INSERT INTO tenant_epis
           (tenant_id, epi_catalog_item_id, ca_number, ca_valid_until, created_by_user_id,
            manufacturer, model, unit, min_stock, max_stock, unit_cost, controls_lot, replacement_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'un'), $9, $10, $11, COALESCE($12, false), $13)
         RETURNING id`,
        [
          data.tenantId, data.epiCatalogItemId, data.caNumber, data.caValidUntil ?? null, data.createdByUserId,
          data.manufacturer ?? null, data.model ?? null, data.unit ?? null, data.minStock ?? null,
          data.maxStock ?? null, data.unitCost ?? null, data.controlsLot ?? null, data.replacementDays ?? null,
        ],
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

  // Edição parcial. O tenant vem da linha (RLS: EPI invisível -> 404). O saldo nunca é editável.
  async update(client: PoolClient, id: string, dto: UpdateEpiDto, userId: string): Promise<Epi> {
    // Trava a linha (mesma que applyMovement trava) para fechar a janela com movimentações concorrentes.
    const lock = await client.query('SELECT id FROM tenant_epis WHERE id = $1 FOR UPDATE', [id]);
    if (!lock.rowCount) throw new NotFoundException('EPI não encontrado');
    const current = await this.findOne(client, id);
    if (dto.controls_lot !== undefined && dto.controls_lot !== current.controls_lot) {
      const mv = await client.query('SELECT 1 FROM epi_movements WHERE tenant_epi_id = $1 LIMIT 1', [id]);
      if (mv.rowCount) {
        throw new ConflictException('Não é possível alterar o controle de lote com movimentações registradas');
      }
    }
    // null explícito limpa o campo; undefined mantém o valor atual.
    const min = dto.min_stock !== undefined ? dto.min_stock : current.min_stock;
    const max = dto.max_stock !== undefined ? dto.max_stock : current.max_stock;
    if (min != null && max != null && max < min) {
      throw new BadRequestException('Estoque máximo menor que o mínimo');
    }
    const { setClauses, values } = buildSafeSetClause(dto, UPDATABLE, 3);
    if (!setClauses.length) return current;
    try {
      await client.query(
        `UPDATE tenant_epis SET ${setClauses.join(', ')}, updated_by_user_id = $2, updated_at = now() WHERE id = $1`,
        [id, userId, ...values],
      );
    } catch (err) {
      mapPgError(err);
    }
    return this.findOne(client, id);
  }

  // Listagem paginada com faixas de estoque e alertas. A janela de alerta vem de
  // tenants.epi_alert_days (padrão 30); o LEFT JOIN roda sob RLS (policy de tenants
  // enxerga a própria empresa, as vinculadas e, para admin, todas).
  async search(
    client: PoolClient,
    f: SearchEpisQuery,
  ): Promise<{ items: EpiListItem[]; total: number; page: number; page_size: number }> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (f.q) {
      // Escapa curingas do termo; um único parâmetro repetido nas três colunas.
      params.push(f.q.replace(/[\\%_]/g, '\\$&'));
      const n = `$${params.length}`;
      where.push(
        `(eci.description ILIKE '%' || ${n} || '%' ESCAPE '\\' OR te.ca_number ILIKE '%' || ${n} || '%' ESCAPE '\\'` +
          ` OR te.manufacturer ILIKE '%' || ${n} || '%' ESCAPE '\\')`,
      );
    }
    if (f.tenantId) { params.push(f.tenantId); where.push(`te.tenant_id = $${params.length}`); }
    if (f.status) { params.push(f.status); where.push(`te.status = $${params.length}`); }
    if (f.category) { params.push(f.category); where.push(`eci.category = $${params.length}`); }

    const base = `
      SELECT te.id, te.tenant_id, te.epi_catalog_item_id, te.ca_number, te.ca_valid_until,
             te.created_by_user_id, te.created_at, te.updated_at,
             eci.category, eci.code, eci.equipment_group, eci.description,
             te.manufacturer, te.model, te.unit, te.min_stock, te.max_stock, te.unit_cost,
             te.controls_lot, te.replacement_days, te.status, te.stock_balance,
             CASE WHEN te.stock_balance = 0 THEN 'sem_estoque'
                  WHEN te.min_stock IS NOT NULL AND te.stock_balance < te.min_stock THEN 'abaixo'
                  WHEN te.max_stock IS NOT NULL AND te.stock_balance > te.max_stock THEN 'acima'
                  ELSE 'otimo' END AS stock_band,
             CASE WHEN te.ca_valid_until IS NULL THEN 'sem_validade'
                  WHEN te.ca_valid_until < ${TODAY_SP} THEN 'vencido'
                  WHEN te.ca_valid_until <= ${TODAY_SP} + COALESCE(t.epi_alert_days, 30) THEN 'a_vencer'
                  ELSE 'ok' END AS ca_alert,
             (SELECT count(*) FROM epi_lots l WHERE l.tenant_epi_id = te.id AND l.balance > 0
                AND l.valid_until < ${TODAY_SP})::int AS lots_expired,
             (SELECT count(*) FROM epi_lots l WHERE l.tenant_epi_id = te.id AND l.balance > 0
                AND l.valid_until >= ${TODAY_SP}
                AND l.valid_until <= ${TODAY_SP} + COALESCE(t.epi_alert_days, 30))::int AS lots_expiring,
             (te.stock_balance::numeric * COALESCE(te.unit_cost, 0))::numeric(30,2)::text AS stock_value
      FROM tenant_epis te
      JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
      LEFT JOIN tenants t ON t.id = te.tenant_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const outer: string[] = [];
    if (f.stockBand) { params.push(f.stockBand); outer.push(`stock_band = $${params.length}`); }
    if (f.caAlert) { params.push(f.caAlert); outer.push(`ca_alert = $${params.length}`); }
    const sqlText = `SELECT * FROM (${base}) x ${outer.length ? `WHERE ${outer.join(' AND ')}` : ''}`;

    const total = await client.query<{ n: string }>(`SELECT count(*) AS n FROM (${sqlText}) c`, params);
    // page/pageSize já são inteiros saneados pelo DTO; mesmo assim entram como parâmetros.
    const pageParams = [...params, f.pageSize, (f.page - 1) * f.pageSize];
    const rows = await client.query<EpiListItem>(
      `${sqlText} ORDER BY description, ca_number, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      pageParams,
    );
    return { items: rows.rows, total: Number(total.rows[0].n), page: f.page, page_size: f.pageSize };
  }

  async listLots(client: PoolClient, epiId: string) {
    await this.findOne(client, epiId);
    const r = await client.query(
      'SELECT * FROM epi_lots WHERE tenant_epi_id = $1 ORDER BY valid_until NULLS LAST, lot_code',
      [epiId],
    );
    return r.rows;
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    try {
      const result = await client.query('DELETE FROM tenant_epis WHERE id = $1', [id]);
      if (result.rowCount === 0) throw new NotFoundException('EPI não encontrado');
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      const pgErr = err as { code?: string };
      if (pgErr.code === '23503') {
        throw new ConflictException('Não é possível apagar um EPI com entregas registradas');
      }
      mapPgError(err);
    }
  }

  async createDelivery(
    client: PoolClient,
    tenantEpiId: string,
    data: CreateDeliveryData,
  ): Promise<EmployeeEpiDelivery> {
    // Trava a linha do EPI (a mesma que update() e applyMovement travam) antes de checar livro/CA/status e inserir.
    const lock = await client.query('SELECT id FROM tenant_epis WHERE id = $1 FOR UPDATE', [tenantEpiId]);
    if (!lock.rowCount) throw new NotFoundException('EPI não encontrado');
    const epi = await this.findOne(client, tenantEpiId);

    // Rota legada: não vale para EPI inativo, com CA vencido nem para EPI que usa o livro de estoque
    // (a entrega sem baixa de saldo deixaria o estoque inconsistente). O tenant segue vindo da linha (RLS).
    if (epi.status !== 'ativo') throw new ConflictException('EPI inativo: não é possível entregar este EPI');
    // Comparação no banco (data de São Paulo): ca_valid_until chega do driver como Date, não como texto.
    const caCheck = await client.query<{ expired: boolean }>(
      `SELECT (ca_valid_until IS NOT NULL AND ca_valid_until < ${TODAY_SP}) AS expired FROM tenant_epis WHERE id = $1`,
      [tenantEpiId],
    );
    if (caCheck.rows[0]?.expired) {
      throw new ConflictException('CA vencido: não é possível entregar este EPI');
    }
    const ledger = await client.query('SELECT 1 FROM epi_movements WHERE tenant_epi_id = $1 LIMIT 1', [tenantEpiId]);
    if (ledger.rowCount) {
      throw new ConflictException('Este EPI usa o registro de movimentação de estoque; registre a entrega em Movimentação.');
    }

    const employeeCheck = await client.query('SELECT id FROM employees WHERE id = $1 AND tenant_id = $2', [
      data.employeeId,
      epi.tenant_id,
    ]);
    if (employeeCheck.rowCount === 0) {
      throw new NotFoundException('Funcionário não encontrado');
    }

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
