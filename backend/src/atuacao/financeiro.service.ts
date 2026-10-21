import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { APPROVED_STATUSES, PENDING_STATUSES, REJECTED_STATUSES } from '../admin-dashboard/payment-status';
import { deriveAccessState, SubscriptionAccess } from '../payments/subscription-access.service';
import { diasEmAtraso, somarMrr, temPendencia } from './financeiro-regras';

export interface UltimoPagamento { data: string; status: string; valor_cents: number }
export interface ClienteFinanceiro {
  id: string; name: string; trade_name: string | null; situacao: SubscriptionAccess;
  plano: string | null; valor_mensal_cents: number | null;
  ultimo_pagamento: UltimoPagamento | null; pendencia: boolean; dias_em_atraso: number | null;
}
export interface ClienteFinanceiroFicha extends ClienteFinanceiro {
  assinaturas: { plano: string; status: string; valor_mensal_cents: number; desde: string }[];
  pagamentos: UltimoPagamento[];
}
export interface ResumoFinanceiro {
  periodo_dias: number;
  clientes: { total: number; ativos: number; trial: number; pendentes: number; inativos: number; com_pendencia: number };
  mrr_cents: number;
  hoje: { cobrado_cents: number; aprovado_cents: number; pendente_cents: number };
  mes: { cobrado_cents: number; aprovado_cents: number; pendente_cents: number; recusado_cents: number };
  serie: { data: string; cobrado_cents: number; aprovado_cents: number }[];
}
export interface FiltroClientesFinanceiro { q?: string; situacao?: SubscriptionAccess; pendencia?: string | boolean }

const SP = `'America/Sao_Paulo'`;

// Base única de lista/ficha/resumo. Explícita em colunas (nada de SELECT *, nenhuma
// coluna mercadopago_*). A restrição à carteira Montese vem do RLS (tenants_socio_select,
// subscriptions_socio_select, payment_events_socio_select). Defesa em profundidade no SQL:
// as consultas de lista/ficha/resumo filtram `is_montese_tenant(t.id)` no tenant e todas as
// de assinatura/pagamento exigem `s.tenant_id IS NOT NULL` (as agregadas de MRR, série e mês
// também `is_montese_tenant(s.tenant_id)`).
//
// "Último pagamento" (base de pendência e atraso): quando o cliente está 'ativa' (existe
// assinatura authorized), vale só o evento mais recente das assinaturas AUTHORIZED — eventos
// de assinaturas antigas canceladas/pausadas não geram pendência indevida. Nas demais
// situações, o mais recente de qualquer assinatura (apenas informativo; sem pendência).
function base(marcador: string): string {
  return `/* fin:${marcador} */
  SELECT t.id, t.name, t.trade_name, f.has_authorized, f.has_recent_pending, f.has_lapsed,
         to_char((now() AT TIME ZONE ${SP})::date, 'YYYY-MM-DD') AS hoje,
         pl.name AS plano, pl.price_cents AS valor_mensal_cents,
         up.data AS up_data, up.status AS up_status, up.amount_cents AS up_valor_cents
  FROM tenants t
  CROSS JOIN LATERAL (SELECT
      EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.tenant_id IS NOT NULL AND s.status = 'authorized') AS has_authorized,
      EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.tenant_id IS NOT NULL AND s.status = 'pending'
              AND s.created_at > now() - interval '3 days') AS has_recent_pending,
      EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.tenant_id IS NOT NULL AND s.status IN ('cancelled','paused')) AS has_lapsed
  ) f
  LEFT JOIN LATERAL (
    SELECT p.name, p.price_cents FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.tenant_id = t.id AND s.tenant_id IS NOT NULL AND s.status = 'authorized'
    ORDER BY s.created_at DESC LIMIT 1
  ) pl ON true
  LEFT JOIN LATERAL (
    SELECT to_char(e.occurred_at AT TIME ZONE ${SP}, 'YYYY-MM-DD') AS data, e.status, e.amount_cents
    FROM subscriptions s JOIN payment_events e ON e.subscription_id = s.id
    WHERE s.tenant_id = t.id AND s.tenant_id IS NOT NULL
      AND (s.status = 'authorized' OR NOT f.has_authorized)
    ORDER BY e.occurred_at DESC LIMIT 1
  ) up ON true`;
}

function paraCliente(r: any): ClienteFinanceiro {
  const situacao = deriveAccessState(r);
  const pendencia = temPendencia(situacao, r.up_status ?? null);
  return {
    id: r.id, name: r.name, trade_name: r.trade_name ?? null, situacao,
    plano: r.plano ?? null, valor_mensal_cents: r.valor_mensal_cents ?? null,
    ultimo_pagamento: r.up_status ? { data: r.up_data, status: r.up_status, valor_cents: Number(r.up_valor_cents) } : null,
    pendencia,
    dias_em_atraso: pendencia ? diasEmAtraso(r.up_data, r.hoje) : null,
  };
}

@Injectable()
export class FinanceiroService {
  // Sequencial de propósito: um único PoolClient não aceita consultas simultâneas.
  async resumo(client: PoolClient, dias: number): Promise<ResumoFinanceiro> {
    const approved = [...APPROVED_STATUSES];
    const pending = [...PENDING_STATUSES];
    const rejected = [...REJECTED_STATUSES];

    const clientes = (await client.query(`${base('clientes')} WHERE is_montese_tenant(t.id)`)).rows.map(paraCliente);
    const n = (s: SubscriptionAccess) => clientes.filter((c) => c.situacao === s).length;

    const mrr = await client.query(
      `/* fin:mrr */
       SELECT p.price_cents FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.status = 'authorized' AND s.tenant_id IS NOT NULL AND is_montese_tenant(s.tenant_id)`,
    );

    const serie = await client.query(
      `/* fin:serie */
       WITH dias AS (
         SELECT generate_series(
           ((now() AT TIME ZONE ${SP})::date - ($1::int - 1))::timestamp,
           (now() AT TIME ZONE ${SP})::date::timestamp,
           interval '1 day'
         )::date AS dia
       )
       SELECT to_char(d.dia, 'YYYY-MM-DD') AS data,
              COALESCE(sum(e.amount_cents), 0)::bigint AS cobrado_cents,
              COALESCE(sum(e.amount_cents) FILTER (WHERE e.status = ANY($2::text[])), 0)::bigint AS aprovado_cents
       FROM dias d
       LEFT JOIN (
         SELECT pe.amount_cents, pe.status, (pe.occurred_at AT TIME ZONE ${SP})::date AS dia
         FROM payment_events pe
         JOIN subscriptions s ON s.id = pe.subscription_id AND s.tenant_id IS NOT NULL AND is_montese_tenant(s.tenant_id)
         WHERE pe.occurred_at >= ((now() AT TIME ZONE ${SP})::date - ($1::int - 1))::timestamp AT TIME ZONE ${SP}
       ) e ON e.dia = d.dia
       GROUP BY d.dia ORDER BY d.dia`,
      [dias, approved],
    );

    const resumo = await client.query(
      `/* fin:resumo */
       WITH hoje AS (SELECT (now() AT TIME ZONE ${SP})::date AS d),
            e AS (
              SELECT pe.amount_cents, pe.status, (pe.occurred_at AT TIME ZONE ${SP})::date AS dia
              FROM payment_events pe
              JOIN subscriptions s ON s.id = pe.subscription_id AND s.tenant_id IS NOT NULL AND is_montese_tenant(s.tenant_id)
              WHERE pe.occurred_at >= date_trunc('month', now() AT TIME ZONE ${SP}) AT TIME ZONE ${SP}
            )
       SELECT
         COALESCE(sum(e.amount_cents) FILTER (WHERE e.dia = hoje.d), 0)::bigint AS hoje_cobrado_cents,
         COALESCE(sum(e.amount_cents) FILTER (WHERE e.dia = hoje.d AND e.status = ANY($1::text[])), 0)::bigint AS hoje_aprovado_cents,
         COALESCE(sum(e.amount_cents) FILTER (WHERE e.dia = hoje.d AND e.status = ANY($2::text[])), 0)::bigint AS hoje_pendente_cents,
         COALESCE(sum(e.amount_cents), 0)::bigint AS mes_cobrado_cents,
         COALESCE(sum(e.amount_cents) FILTER (WHERE e.status = ANY($1::text[])), 0)::bigint AS mes_aprovado_cents,
         COALESCE(sum(e.amount_cents) FILTER (WHERE e.status = ANY($2::text[])), 0)::bigint AS mes_pendente_cents,
         COALESCE(sum(e.amount_cents) FILTER (WHERE e.status = ANY($3::text[])), 0)::bigint AS mes_recusado_cents
       FROM e CROSS JOIN hoje`,
      [approved, pending, rejected],
    );
    const r = resumo.rows[0];
    return {
      periodo_dias: dias,
      clientes: {
        total: clientes.length, ativos: n('ativa'), trial: n('trial'), pendentes: n('pendente'), inativos: n('inativa'),
        com_pendencia: clientes.filter((c) => c.pendencia).length,
      },
      mrr_cents: somarMrr(mrr.rows.map((m: any) => Number(m.price_cents))),
      hoje: { cobrado_cents: Number(r.hoje_cobrado_cents), aprovado_cents: Number(r.hoje_aprovado_cents), pendente_cents: Number(r.hoje_pendente_cents) },
      mes: {
        cobrado_cents: Number(r.mes_cobrado_cents), aprovado_cents: Number(r.mes_aprovado_cents),
        pendente_cents: Number(r.mes_pendente_cents), recusado_cents: Number(r.mes_recusado_cents),
      },
      serie: serie.rows.map((s: any) => ({ data: s.data, cobrado_cents: Number(s.cobrado_cents), aprovado_cents: Number(s.aprovado_cents) })),
    };
  }

  // Filtros no SQL e LIMIT 200 DEPOIS do filtro. `q` com escape de \, % e _ (como em atuacao.service.ts).
  async listar(client: PoolClient, f: FiltroClientesFinanceiro): Promise<ClienteFinanceiro[]> {
    const like = f.q ? `%${f.q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const soPendencia = f.pendencia === true || f.pendencia === 'true';
    const res = await client.query(
      `${base('lista')}
       WHERE is_montese_tenant(t.id)
         AND ($1::text IS NULL OR t.name ILIKE $1 OR t.trade_name ILIKE $1)
         AND ($2::text IS NULL OR $2::text = CASE WHEN f.has_authorized THEN 'ativa' WHEN f.has_recent_pending THEN 'pendente'
                                                  WHEN f.has_lapsed THEN 'inativa' ELSE 'trial' END)
         AND ($3::boolean = false OR (f.has_authorized AND up.status IS NOT NULL AND NOT (up.status = ANY($4::text[]))))
       ORDER BY t.name LIMIT 200`,
      [like, f.situacao ?? null, soPendencia, [...APPROVED_STATUSES]],
    );
    return res.rows.map(paraCliente);
  }

  async ficha(client: PoolClient, tenantId: string): Promise<ClienteFinanceiroFicha> {
    const res = await client.query(`${base('lista')} WHERE t.id = $1 AND is_montese_tenant(t.id)`, [tenantId]);
    if (res.rows.length === 0) throw new NotFoundException('Cliente não encontrado');
    const assinaturas = await client.query(
      `/* fin:assinaturas */
       SELECT p.name AS plano, s.status, p.price_cents AS valor_mensal_cents,
              to_char(s.created_at AT TIME ZONE ${SP}, 'YYYY-MM-DD') AS desde
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1 AND s.tenant_id IS NOT NULL
       ORDER BY s.created_at DESC`,
      [tenantId],
    );
    const pagamentos = await client.query(
      `/* fin:pagamentos */
       SELECT to_char(e.occurred_at AT TIME ZONE ${SP}, 'YYYY-MM-DD') AS data, e.status, e.amount_cents AS valor_cents
       FROM payment_events e JOIN subscriptions s ON s.id = e.subscription_id
       WHERE s.tenant_id = $1 AND s.tenant_id IS NOT NULL
       ORDER BY e.occurred_at DESC LIMIT 24`,
      [tenantId],
    );
    return {
      ...paraCliente(res.rows[0]),
      assinaturas: assinaturas.rows.map((a: any) => ({
        plano: a.plano, status: a.status, valor_mensal_cents: Number(a.valor_mensal_cents), desde: a.desde,
      })),
      pagamentos: pagamentos.rows.map((p: any) => ({ data: p.data, status: p.status, valor_cents: Number(p.valor_cents) })),
    };
  }
}
