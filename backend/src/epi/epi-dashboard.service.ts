import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { diffDays, isDateOnly, todayDateOnly } from '../common/dates/date-only';
import { TODAY_SP } from './epi.service';

export interface EpiDashboard {
  alert_days: number;
  period: { from: string; to: string };
  kpis: {
    epis_total: number; stock_total: number; stock_value: string; low_stock: number; zero_stock: number;
    ca_expired: number; ca_expiring: number; lots_expired: number; lots_expiring: number; pending_signatures: number;
  };
  alerts: Array<{
    epi_id: string; description: string; ca_number: string; stock_balance: number; min_stock: number | null;
    stock_band: string; ca_alert: string; ca_valid_until: string | null; lots_expired: number; lots_expiring: number;
  }>;
  recent_movements: Array<{
    id: string; type: string; quantity: number; occurred_at: string; epi_id: string; epi_description: string;
    employee_name: string | null; reason: string | null; reversed: boolean;
  }>;
  pending: Array<{
    delivery_id: string; delivered_at: string; employee_id: string; employee_name: string; epi_id: string;
    epi_description: string; quantity: number | null; signature_status: string; active_request_expires_at: string | null;
  }>;
}

export const DEFAULT_PERIOD_DAYS = 30;
export const MAX_PERIOD_DAYS = 366;
const LIST_LIMIT = 10;

const addDays = (d: string, n: number): string => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10);
};

// Período em dias do calendário de São Paulo. Padrão: os últimos 30 dias (hoje e os 29 anteriores).
// Aceita só 'AAAA-MM-DD' existente; to < from ou intervalo acima de 366 dias -> 400.
export function resolvePeriod(from?: string, to?: string, now: Date = new Date()): { from: string; to: string } {
  if ((from !== undefined && !isDateOnly(from)) || (to !== undefined && !isDateOnly(to))) {
    throw new BadRequestException('Período inválido');
  }
  const end = to ?? (from && from > todayDateOnly(now) ? from : todayDateOnly(now));
  const start = from ?? addDays(end, -(DEFAULT_PERIOD_DAYS - 1));
  if (diffDays(start, end) < 0) throw new BadRequestException('A data inicial deve ser anterior ou igual à final');
  if (diffDays(start, end) > MAX_PERIOD_DAYS) {
    throw new BadRequestException(`O período não pode passar de ${MAX_PERIOD_DAYS} dias`);
  }
  return { from: start, to: end };
}

@Injectable()
export class EpiDashboardService {
  // Roda sob o client do withTenantContext (RLS); tenantId vem de resolveTenantScope, nunca confiado sozinho:
  // todas as consultas filtram tenant_id E continuam sob a RLS da sessão.
  async getDashboard(
    client: PoolClient,
    tenantId: string,
    q: { from?: string; to?: string; epiId?: string; employeeId?: string },
  ): Promise<EpiDashboard> {
    const { from, to } = resolvePeriod(q.from, q.to);
    const t = await client.query<{ d: number }>('SELECT COALESCE(epi_alert_days, 30) AS d FROM tenants WHERE id = $1', [tenantId]);
    if (!t.rows[0]) throw new NotFoundException('Empresa não encontrada');
    const days = t.rows[0].d;
    const epiId = q.epiId ?? null;
    const employeeId = q.employeeId ?? null;

    const kpi = await client.query(
      `SELECT count(*) FILTER (WHERE te.status = 'ativo')::int AS epis_total,
              COALESCE(sum(te.stock_balance) FILTER (WHERE te.status = 'ativo'), 0)::bigint AS stock_total,
              COALESCE(sum(te.stock_balance * COALESCE(te.unit_cost, 0)) FILTER (WHERE te.status = 'ativo'), 0)::numeric(30,2)::text AS stock_value,
              count(*) FILTER (WHERE te.status = 'ativo' AND te.stock_balance = 0)::int AS zero_stock,
              count(*) FILTER (WHERE te.status = 'ativo' AND te.stock_balance > 0 AND te.min_stock IS NOT NULL AND te.stock_balance < te.min_stock)::int AS low_stock,
              count(*) FILTER (WHERE te.status = 'ativo' AND te.ca_valid_until < ${TODAY_SP})::int AS ca_expired,
              count(*) FILTER (WHERE te.status = 'ativo' AND te.ca_valid_until >= ${TODAY_SP} AND te.ca_valid_until <= ${TODAY_SP} + $3::int)::int AS ca_expiring
       FROM tenant_epis te
       WHERE te.tenant_id = $1 AND ($2::uuid IS NULL OR te.id = $2)`,
      [tenantId, epiId, days],
    );

    const lots = await client.query(
      `SELECT count(*) FILTER (WHERE l.valid_until < ${TODAY_SP})::int AS lots_expired,
              count(*) FILTER (WHERE l.valid_until >= ${TODAY_SP} AND l.valid_until <= ${TODAY_SP} + $3::int)::int AS lots_expiring
       FROM epi_lots l JOIN tenant_epis te ON te.id = l.tenant_epi_id
       WHERE te.tenant_id = $1 AND te.status = 'ativo' AND l.balance > 0 AND ($2::uuid IS NULL OR te.id = $2)`,
      [tenantId, epiId, days],
    );

    const pendingJoins = `
       FROM employee_epi_deliveries d
       JOIN employees e ON e.id = d.employee_id
       JOIN tenant_epis te ON te.id = d.tenant_epi_id
       JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id`;
    const pendingWhere = `
       WHERE d.tenant_id = $1 AND d.signature_status IN ('pendente', 'recusada') AND d.quantity IS NOT NULL
         AND ($2::uuid IS NULL OR te.id = $2) AND ($3::uuid IS NULL OR d.employee_id = $3)`;
    const pendingCount = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n ${pendingJoins} ${pendingWhere}`,
      [tenantId, epiId, employeeId],
    );
    const pending = await client.query(
      `SELECT d.id AS delivery_id, to_char(d.delivered_at, 'YYYY-MM-DD') AS delivered_at,
              d.employee_id, e.full_name AS employee_name, te.id AS epi_id, eci.description AS epi_description,
              d.quantity, d.signature_status, ar.expires_at AS active_request_expires_at
       ${pendingJoins}
       LEFT JOIN LATERAL (
              SELECT r.expires_at FROM epi_signature_request_items i
              JOIN epi_signature_requests r ON r.id = i.request_id
              WHERE i.delivery_id = d.id AND r.status = 'ativa' AND r.expires_at > now()
              ORDER BY r.created_at DESC LIMIT 1) ar ON true
       ${pendingWhere}
       ORDER BY d.delivered_at, d.id LIMIT ${LIST_LIMIT}`,
      [tenantId, epiId, employeeId],
    );

    // Mesmas expressões de EpiService.search; gravidade 0 = sem estoque / CA vencido / lote vencido.
    const alerts = await client.query(
      `SELECT * FROM (
         SELECT te.id AS epi_id, eci.description, te.ca_number, te.stock_balance, te.min_stock,
                CASE WHEN te.stock_balance = 0 THEN 'sem_estoque'
                     WHEN te.min_stock IS NOT NULL AND te.stock_balance < te.min_stock THEN 'abaixo'
                     WHEN te.max_stock IS NOT NULL AND te.stock_balance > te.max_stock THEN 'acima'
                     ELSE 'otimo' END AS stock_band,
                CASE WHEN te.ca_valid_until IS NULL THEN 'sem_validade'
                     WHEN te.ca_valid_until < ${TODAY_SP} THEN 'vencido'
                     WHEN te.ca_valid_until <= ${TODAY_SP} + $3::int THEN 'a_vencer'
                     ELSE 'ok' END AS ca_alert,
                to_char(te.ca_valid_until, 'YYYY-MM-DD') AS ca_valid_until,
                (SELECT count(*) FROM epi_lots l WHERE l.tenant_epi_id = te.id AND l.balance > 0
                   AND l.valid_until < ${TODAY_SP})::int AS lots_expired,
                (SELECT count(*) FROM epi_lots l WHERE l.tenant_epi_id = te.id AND l.balance > 0
                   AND l.valid_until >= ${TODAY_SP} AND l.valid_until <= ${TODAY_SP} + $3::int)::int AS lots_expiring
         FROM tenant_epis te JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
         WHERE te.tenant_id = $1 AND te.status = 'ativo' AND ($2::uuid IS NULL OR te.id = $2)
       ) x
       WHERE stock_band IN ('sem_estoque','abaixo') OR ca_alert IN ('vencido','a_vencer') OR lots_expired > 0 OR lots_expiring > 0
       ORDER BY (CASE WHEN stock_band = 'sem_estoque' OR ca_alert = 'vencido' OR lots_expired > 0 THEN 0 ELSE 1 END),
                (stock_band = 'sem_estoque') DESC, (ca_alert = 'vencido') DESC, description, ca_number, epi_id
       LIMIT ${LIST_LIMIT}`,
      [tenantId, epiId, days],
    );

    // Dia de São Paulo -> intervalo [from 00:00, to+1 00:00) em timestamptz (usa o índice por occurred_at).
    // O estorno é verificado só nas 10 linhas devolvidas (EXISTS fora do LIMIT usa o índice parcial
    // uq_epi_movements_reverses); no EXISTS interno o planner varria o livro inteiro da empresa.
    const movements = await client.query(
      `SELECT x.id, x.type, x.quantity, x.occurred_at, x.epi_id, x.epi_description, x.employee_name, x.reason,
              EXISTS (SELECT 1 FROM epi_movements r WHERE r.reverses_movement_id = x.id) AS reversed
       FROM (
         SELECT m.id, m.type, m.quantity, m.occurred_at, m.created_at, te.id AS epi_id, eci.description AS epi_description,
                e.full_name AS employee_name, m.reason
         FROM epi_movements m
         JOIN tenant_epis te ON te.id = m.tenant_epi_id
         JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
         LEFT JOIN employees e ON e.id = m.employee_id
         WHERE m.tenant_id = $1
           AND m.occurred_at >= ($2::date)::timestamp AT TIME ZONE 'America/Sao_Paulo'
           AND m.occurred_at < (($3::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
           AND ($4::uuid IS NULL OR m.tenant_epi_id = $4) AND ($5::uuid IS NULL OR m.employee_id = $5)
         ORDER BY m.occurred_at DESC, m.created_at DESC, m.id
         LIMIT ${LIST_LIMIT}
       ) x
       ORDER BY x.occurred_at DESC, x.created_at DESC, x.id`,
      [tenantId, from, to, epiId, employeeId],
    );

    return {
      alert_days: days,
      period: { from, to },
      kpis: { ...kpi.rows[0], stock_total: Number(kpi.rows[0].stock_total), ...lots.rows[0], pending_signatures: pendingCount.rows[0].n },
      alerts: alerts.rows,
      recent_movements: movements.rows,
      pending: pending.rows,
    };
  }
}
