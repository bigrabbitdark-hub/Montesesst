import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OverviewService } from '../overview/overview.service';
import { SystemStatusService } from '../system-status/system-status.service';
import { AiUsageLogService } from '../common/ai-usage/ai-usage-log.service';
import { envFloat } from '../common/env';
import {
  AlertResult,
  computeAlerts,
  OpenRouterCreditInput,
  PENDING_STALE_DAYS,
  REJECTED_WINDOW_DAYS,
} from './alert-rules';
import { APPROVED_STATUSES, PENDING_STATUSES, REJECTED_STATUSES, STALE_PENDING_STATUSES } from './payment-status';

export interface AlertasResponse extends AlertResult {
  gerado_em: string;
}

export interface FinanceiroPeriodo {
  cobrado_cents: number;
  aprovado_cents: number;
  pendente_cents: number;
}

export interface PagamentoRecente {
  id: string;
  mercadopago_payment_id: string;
  amount_cents: number;
  status: string;
  occurred_at: string;
  cliente: string | null;
  plano: string | null;
}

export interface FinanceiroResponse {
  periodo_dias: number;
  serie: { data: string; cobrado_cents: number; aprovado_cents: number }[];
  hoje: FinanceiroPeriodo;
  mes: FinanceiroPeriodo & { recusado_cents: number };
  recentes: PagamentoRecente[];
}

export interface ClienteRecente {
  id: string;
  nome: string;
  plano: string;
  status: string;
  mrr_cents: number | null;
  ultimo_acesso: string | null;
  created_at: string;
}

interface ResumoRow {
  hoje_cobrado_cents: number;
  hoje_aprovado_cents: number;
  hoje_pendente_cents: number;
  mes_cobrado_cents: number;
  mes_aprovado_cents: number;
  mes_pendente_cents: number;
  mes_recusado_cents: number;
}

// Só leitura. Chamado apenas por rotas @Roles('admin'); o `client` vem de
// req.withTenantContext, então as políticas RLS de admin já se aplicam.
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly systemStatus: SystemStatusService,
    private readonly overview: OverviewService,
    private readonly aiUsageLog: AiUsageLogService,
  ) {}

  // ITEM 013/014: as duas linhas novas (openrouter_credit_status, soma de hoje da
  // MiniMax) continuam respeitando a regra original deste método — nenhuma chamada de
  // REDE aqui (nada de OpenRouter etc.): só banco e `os`, para a resposta ser rápida e o
  // sino da topbar nunca travar por terceiro. O saldo do OpenRouter já vem PRONTO do
  // cache que o cron grava (OpenRouterCreditMonitorCronService).
  async getAlertas(client: PoolClient): Promise<AlertasResponse> {
    const [status, metrics, payments, openrouter, minimaxCostToday] = await Promise.all([
      this.systemStatus.getStatus(),
      this.overview.getMetrics(client),
      this.countPaymentAlerts(client),
      this.getOpenRouterCreditStatus(client),
      this.aiUsageLog.getTodayEstimatedCostUsd(),
    ]);

    const result = computeAlerts(
      {
        services: {
          postgres: status.services.postgres.reachable,
          redis: status.services.redis.reachable,
          site: status.services.frontend.reachable,
        },
        disk_used_percent: status.disk.used_percent,
        ram_used_percent: status.memory.used_percent,
        payments_rejected_7d: payments.rejected,
        payments_pending_stale: payments.pendingStale,
        documentos_vencendo: metrics.documentos_vencendo,
        epis_vencendo: metrics.epis_vencendo,
        openrouter: openrouter.alertInput,
        // Real (OpenRouter, do próprio provedor) + estimado (MiniMax, sem API de saldo).
        ai_cost_today_usd: (openrouter.usageDailyUsd ?? 0) + minimaxCostToday,
      },
      {
        openrouterLowCreditUsd: envFloat('OPENROUTER_LOW_CREDIT_USD', 5),
        aiDailyCostCapUsd: envFloat('AI_DAILY_COST_CAP_USD', 20),
      },
    );

    return { gerado_em: new Date().toISOString(), ...result };
  }

  private async getOpenRouterCreditStatus(
    client: PoolClient,
  ): Promise<{ alertInput: OpenRouterCreditInput | null; usageDailyUsd: number | null }> {
    const result = await client.query<{
      checked_at: string;
      check_succeeded: boolean;
      is_unlimited: boolean;
      limit_remaining_usd: string | null;
      usage_daily_usd: string | null;
      error_message: string | null;
    }>(`SELECT checked_at, check_succeeded, is_unlimited, limit_remaining_usd, usage_daily_usd, error_message
        FROM openrouter_credit_status WHERE id = 1`);
    const row = result.rows[0];
    if (!row) return { alertInput: null, usageDailyUsd: null };
    return {
      alertInput: {
        checked_at: row.checked_at,
        check_succeeded: row.check_succeeded,
        is_unlimited: row.is_unlimited,
        limit_remaining_usd: row.limit_remaining_usd !== null ? Number(row.limit_remaining_usd) : null,
        error_message: row.error_message,
      },
      usageDailyUsd: row.check_succeeded && row.usage_daily_usd !== null ? Number(row.usage_daily_usd) : null,
    };
  }

  // "Cobrado" = soma de todos os eventos do período; "aprovado" = status
  // approved; "pendente"/"recusado" seguem os grupos de payment-status.ts.
  // Dia, hoje e mês em America/Sao_Paulo — um evento às 23:59 de Brasília é
  // do dia de Brasília, mesmo que em UTC já seja o dia seguinte.
  async getFinanceiro(client: PoolClient, dias: number): Promise<FinanceiroResponse> {
    const approved = [...APPROVED_STATUSES];
    const pending = [...PENDING_STATUSES];
    const rejected = [...REJECTED_STATUSES];

    // Sequencial de propósito: o pg deprecou consultas simultâneas no mesmo
    // PoolClient (fila implícita), e o `client` aqui é um só.
    const serie = await client.query<{ data: string; cobrado_cents: number; aprovado_cents: number }>(
      `WITH dias AS (
         SELECT generate_series(
           ((now() AT TIME ZONE 'America/Sao_Paulo')::date - ($1::int - 1))::timestamp,
           (now() AT TIME ZONE 'America/Sao_Paulo')::date::timestamp,
           interval '1 day'
         )::date AS dia
       )
       SELECT to_char(d.dia, 'YYYY-MM-DD') AS data,
              COALESCE(sum(e.amount_cents), 0)::int AS cobrado_cents,
              COALESCE(sum(e.amount_cents) FILTER (WHERE e.status = ANY($2::text[])), 0)::int AS aprovado_cents
       FROM dias d
       LEFT JOIN payment_events e
         ON (e.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date = d.dia
       GROUP BY d.dia
       ORDER BY d.dia`,
      [dias, approved],
    );
    const resumo = await client.query<ResumoRow>(
      `WITH hoje AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d),
            e AS (
              SELECT amount_cents, status,
                     (occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia
              FROM payment_events
              WHERE occurred_at >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
                                     AT TIME ZONE 'America/Sao_Paulo'
            )
       SELECT
         COALESCE(sum(e.amount_cents) FILTER (WHERE e.dia = hoje.d), 0)::int AS hoje_cobrado_cents,
         COALESCE(sum(e.amount_cents) FILTER (WHERE e.dia = hoje.d AND e.status = ANY($1::text[])), 0)::int AS hoje_aprovado_cents,
         COALESCE(sum(e.amount_cents) FILTER (WHERE e.dia = hoje.d AND e.status = ANY($2::text[])), 0)::int AS hoje_pendente_cents,
         COALESCE(sum(e.amount_cents), 0)::int AS mes_cobrado_cents,
         COALESCE(sum(e.amount_cents) FILTER (WHERE e.status = ANY($1::text[])), 0)::int AS mes_aprovado_cents,
         COALESCE(sum(e.amount_cents) FILTER (WHERE e.status = ANY($2::text[])), 0)::int AS mes_pendente_cents,
         COALESCE(sum(e.amount_cents) FILTER (WHERE e.status = ANY($3::text[])), 0)::int AS mes_recusado_cents
       FROM e CROSS JOIN hoje`,
      [approved, pending, rejected],
    );
    // Mesmo join de SubscriptionsService.findAllForAdmin; LEFT JOIN porque
    // evento gravado sem vínculo de assinatura é legítimo (webhook órfão).
    const recentes = await client.query<PagamentoRecente>(
      `SELECT e.id, e.mercadopago_payment_id, e.amount_cents, e.status, e.occurred_at,
              COALESCE(t.name, u.full_name) AS cliente, p.name AS plano
       FROM payment_events e
       LEFT JOIN subscriptions s ON s.id = e.subscription_id
       LEFT JOIN plans p ON p.id = s.plan_id
       LEFT JOIN tenants t ON t.id = s.tenant_id
       LEFT JOIN users u ON u.id = s.technician_user_id
       ORDER BY e.occurred_at DESC
       LIMIT 5`,
    );

    const r = resumo.rows[0];
    return {
      periodo_dias: dias,
      serie: serie.rows,
      hoje: {
        cobrado_cents: r.hoje_cobrado_cents,
        aprovado_cents: r.hoje_aprovado_cents,
        pendente_cents: r.hoje_pendente_cents,
      },
      mes: {
        cobrado_cents: r.mes_cobrado_cents,
        aprovado_cents: r.mes_aprovado_cents,
        pendente_cents: r.mes_pendente_cents,
        recusado_cents: r.mes_recusado_cents,
      },
      recentes: recentes.rows,
    };
  }

  // "Último acesso" vem de audit_log (login_success), não de
  // users.last_login_at — essa coluna existe no schema mas nenhum código a
  // grava. LATERAL + LIMIT: o custo cresce com `limit`, não com a base.
  async getClientesRecentes(client: PoolClient, limit: number): Promise<ClienteRecente[]> {
    const result = await client.query<ClienteRecente>(
      `SELECT t.id, t.name AS nome, t.status::text AS status, t.created_at,
              COALESCE(sub.plan_name, t.plan) AS plano,
              sub.price_cents AS mrr_cents,
              acesso.ultimo_acesso
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT p.name AS plan_name, p.price_cents
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
         WHERE s.tenant_id = t.id AND s.status = 'authorized'
         ORDER BY s.created_at DESC
         LIMIT 1
       ) sub ON true
       LEFT JOIN LATERAL (
         SELECT max(al.occurred_at) AS ultimo_acesso
         FROM audit_log al
         WHERE al.actor_tenant_id = t.id AND al.action = 'login_success'
       ) acesso ON true
       ORDER BY t.created_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  private async countPaymentAlerts(
    client: PoolClient,
  ): Promise<{ rejected: number; pendingStale: number }> {
    const result = await client.query<{ rejected: number; pending_stale: number }>(
      `SELECT
         (SELECT count(*) FROM payment_events
            WHERE status = ANY($1::text[])
              AND occurred_at >= now() - make_interval(days => $3::int))::int AS rejected,
         (SELECT count(*) FROM payment_events
            WHERE status = ANY($2::text[])
              AND occurred_at < now() - make_interval(days => $4::int))::int AS pending_stale`,
      [[...REJECTED_STATUSES], [...STALE_PENDING_STATUSES], REJECTED_WINDOW_DAYS, PENDING_STALE_DAYS],
    );
    return { rejected: result.rows[0].rejected, pendingStale: result.rows[0].pending_stale };
  }
}
