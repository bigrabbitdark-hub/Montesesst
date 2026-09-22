'use client';

import type { ReactNode } from 'react';
import { Sparkline } from '../charts/Sparkline';
import { AsyncBody } from '../Card';
import { fillDailySeries, formatCents, formatCompact, formatUsd, plural } from '../format';
import { AdminIcon } from '../icons';
import type { FetchState } from '../useAdminFetch';
import type { MiniMaxUsage, OpenRouterUsage, OverviewMetrics } from '../types';

type Tint = 'green' | 'blue' | 'violet';

const TINT: Record<Tint, string> = {
  green: 'bg-emerald-500/15 text-emerald-300',
  blue: 'bg-blue-500/15 text-blue-300',
  violet: 'bg-violet-500/15 text-violet-300',
};

function KpiCard({ icon, tint, label, children }: { icon: ReactNode; tint: Tint; label: string; children: ReactNode }) {
  return (
    <div className="adm-card flex min-w-0 items-start gap-4 p-4 sm:p-5">
      <span aria-hidden="true" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${TINT[tint]}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-brand-700">{label}</p>
        {children}
      </div>
    </div>
  );
}

const VALUE = 'mt-1 text-[26px] font-bold leading-tight text-brand-900';
const NOTE = 'mt-1 text-xs text-brand-700';

function OpenRouterLine({ state }: { state: FetchState<OpenRouterUsage> }) {
  if (state.data === null) return <>{state.error ? 'OpenRouter indisponível' : 'OpenRouter: carregando…'}</>;
  const o = state.data;
  if (!o.configured) return <>OpenRouter não configurado</>;
  if (o.error) return <>OpenRouter: falha ao consultar</>;
  return (
    <>
      {typeof o.usage_monthly === 'number'
        ? `OpenRouter: ${formatUsd(o.usage_monthly)} este mês`
        : 'OpenRouter: sem dado do mês'}
      {o.low_balance_warning && <span className="text-amber-300"> · saldo baixo</span>}
    </>
  );
}

export function KpiRow({
  overview,
  miniMax,
  openrouter,
}: {
  overview: FetchState<OverviewMetrics>;
  miniMax: FetchState<MiniMaxUsage>;
  openrouter: FetchState<OpenRouterUsage>;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <KpiCard icon={<AdminIcon name="dollar" className="h-6 w-6" />} tint="green" label="MRR (assinaturas ativas)">
        <AsyncBody state={overview} rows={2}>
          {(m) => (
            <>
              <p className={VALUE}>{formatCents(m.receita_mensal_cents)}</p>
              <p className={NOTE}>{plural(m.assinaturas_ativas, 'assinatura ativa', 'assinaturas ativas')}</p>
            </>
          )}
        </AsyncBody>
      </KpiCard>

      <KpiCard icon={<AdminIcon name="building" className="h-6 w-6" />} tint="blue" label="Clientes ativos">
        <AsyncBody state={overview} rows={2}>
          {(m) => (
            <>
              <p className={VALUE}>{m.empresas_ativas}</p>
              <p className={NOTE}>
                {`${plural(m.tecnicos_vinculados, 'técnico', 'técnicos')} · ${plural(m.parceiros_vinculados, 'parceiro', 'parceiros')} vinculados`}
              </p>
            </>
          )}
        </AsyncBody>
      </KpiCard>

      <KpiCard icon={<AdminIcon name="sparkle" className="h-6 w-6" />} tint="violet" label="Uso de IA (7 dias)">
        <AsyncBody state={miniMax} rows={2}>
          {(u) => {
            const serie = fillDailySeries(u.last_7_days);
            const total7 = serie.reduce((sum, d) => sum + d.total_tokens, 0);
            return (
              <div className="mt-1 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[26px] font-bold leading-tight text-brand-900">
                    {formatCompact(total7)} <span className="text-sm font-medium text-brand-700">tokens</span>
                  </p>
                  <p className={NOTE}>
                    <OpenRouterLine state={openrouter} />
                  </p>
                </div>
                <Sparkline values={serie.map((d) => d.total_tokens)} color="#a78bfa" label="Tokens por dia nos últimos 7 dias" />
              </div>
            );
          }}
        </AsyncBody>
      </KpiCard>
    </div>
  );
}
