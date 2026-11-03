'use client';

import { AreaChart } from '@/components/admin/charts/AreaChart';
import { formatCents, formatCentsAxis, formatDayMonth } from '@/components/admin/format';
import { Card } from '@/components/ui/Card';

export const PERIODOS_FINANCEIRO = [7, 30, 90] as const;
export type PeriodoFinanceiro = (typeof PERIODOS_FINANCEIRO)[number];

export interface DadosGraficoFinanceiro {
  periodo_dias: number;
  serie: { data: string; cobrado_cents: number; aprovado_cents: number }[];
  hoje: { cobrado_cents: number; aprovado_cents: number; pendente_cents: number };
  mes: { aprovado_cents: number; recusado_cents: number };
}

const COBRADO = '#3b82f6';
const APROVADO = '#059669';

// O AreaChart é o mesmo do /admin (tema escuro); aqui as variáveis dele recebem valores do tema claro
// do painel, só dentro deste wrapper (classe `dash-chart`, em globals.css, cuida do balão de valores).
const TEMA_CLARO = {
  '--admin-border': '#e2e8f0',
  '--admin-faint': '#64748b',
  '--admin-surface': '#ffffff',
  '--color-brand-900': '#0f172a',
  '--color-brand-700': '#475569',
} as React.CSSProperties;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-dash-page p-3">
      <dt className="text-xs text-dash-muted">{label}</dt>
      <dd className="mt-1 truncate text-lg font-semibold text-dash-primary">{value}</dd>
      {hint && <dd className="mt-0.5 truncate text-[11px] text-dash-muted">{hint}</dd>}
    </div>
  );
}

// Faturamento e recebimentos (somente leitura). "Cobrado" = eventos de cobrança do Mercado Pago;
// "Aprovado" = os aprovados. Mesma linguagem do card do /admin, com dados só da carteira Montese.
export function FinanceChartCard({
  data, dias, onDias,
}: { data: DadosGraficoFinanceiro; dias: PeriodoFinanceiro; onDias: (d: PeriodoFinanceiro) => void }) {
  const vazio = data.serie.every((p) => p.cobrado_cents === 0);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-dash-primary">Faturamento e recebimentos</h2>
          <p className="mt-0.5 text-xs text-dash-muted">Cobranças registradas pelo Mercado Pago, só da carteira Montese</p>
        </div>
        <div role="group" aria-label="Período do gráfico" className="flex rounded-lg border border-dash-border-input p-0.5">
          {PERIODOS_FINANCEIRO.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={dias === d}
              onClick={() => onDias(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary ${
                dias === d ? 'bg-dash-brand-green-light text-dash-status-ok-text' : 'text-dash-muted hover:text-dash-primary'
              }`}
            >
              {d} dias
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_200px]">
        <div className="dash-chart min-w-0" style={TEMA_CLARO}>
          <div className="mb-2 flex flex-wrap gap-4 text-xs text-dash-muted">
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: COBRADO }} />Cobrado</span>
            <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: APROVADO }} />Aprovado</span>
          </div>
          {vazio ? (
            <p className="py-10 text-center text-sm text-dash-muted">Sem cobranças no período.</p>
          ) : (
            <AreaChart
              labels={data.serie.map((p) => formatDayMonth(p.data))}
              series={[
                { name: 'Cobrado', color: COBRADO, values: data.serie.map((p) => p.cobrado_cents) },
                { name: 'Aprovado', color: APROVADO, values: data.serie.map((p) => p.aprovado_cents) },
              ]}
              format={formatCents}
              formatAxis={formatCentsAxis}
              ariaLabel={`Cobrado e aprovado por dia nos últimos ${data.periodo_dias} dias`}
            />
          )}
        </div>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
          <Tile label="Hoje (aprovado)" value={formatCents(data.hoje.aprovado_cents)} hint={`de ${formatCents(data.hoje.cobrado_cents)} cobrados`} />
          <Tile label="Pendente hoje" value={formatCents(data.hoje.pendente_cents)} hint="aguardando confirmação" />
          <Tile label="No mês (aprovado)" value={formatCents(data.mes.aprovado_cents)} hint={`recusado ${formatCents(data.mes.recusado_cents)}`} />
        </dl>
      </div>
    </Card>
  );
}
