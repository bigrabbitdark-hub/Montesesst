'use client';

import { AreaChart } from '../charts/AreaChart';
import { AsyncBody, Card, CardEmpty } from '../Card';
import { formatCents, formatCentsAxis, formatDayMonth } from '../format';
import type { FetchState } from '../useAdminFetch';
import type { FinanceiroResponse } from '../types';
import { Tile } from './Tile';

export const PERIODOS = [7, 30, 90] as const;
export type Periodo = (typeof PERIODOS)[number];

const COBRADO = '#60a5fa';
const APROVADO = '#34d399';

// "Cobrado" = todos os eventos de cobrança do Mercado Pago; "Aprovado" = os
// aprovados (é o que de fato entrou). Não usamos "faturamento/recebido" porque
// a base só registra eventos de cobrança — ver spec §6.
export function FinanceCard({
  state,
  dias,
  onDias,
  className = '',
}: {
  state: FetchState<FinanceiroResponse>;
  dias: Periodo;
  onDias: (d: Periodo) => void;
  className?: string;
}) {
  return (
    <Card
      id="financeiro"
      title="Faturamento e recebimentos"
      subtitle="Cobranças registradas pelo Mercado Pago"
      className={className}
      action={
        <div role="group" aria-label="Período do gráfico" className="flex rounded-lg border border-brand-100 p-0.5">
          {PERIODOS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={dias === d}
              onClick={() => onDias(d)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                dias === d ? 'bg-emerald-500/20 text-emerald-200' : 'text-brand-700 hover:text-brand-900'
              }`}
            >
              {d} dias
            </button>
          ))}
        </div>
      }
    >
      <AsyncBody state={state} rows={5}>
        {(f) => {
          const vazio = f.serie.every((p) => p.cobrado_cents === 0);
          return (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap gap-4 text-xs text-brand-700">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: COBRADO }} />
                    Cobrado
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: APROVADO }} />
                    Aprovado
                  </span>
                </div>
                {vazio ? (
                  <CardEmpty>Sem cobranças no período.</CardEmpty>
                ) : (
                  <AreaChart
                    labels={f.serie.map((p) => formatDayMonth(p.data))}
                    series={[
                      { name: 'Cobrado', color: COBRADO, values: f.serie.map((p) => p.cobrado_cents) },
                      { name: 'Aprovado', color: APROVADO, values: f.serie.map((p) => p.aprovado_cents) },
                    ]}
                    format={formatCents}
                    formatAxis={formatCentsAxis}
                    ariaLabel={`Cobrado e aprovado por dia nos últimos ${f.periodo_dias} dias`}
                  />
                )}
              </div>
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
                <Tile label="Hoje (aprovado)" value={formatCents(f.hoje.aprovado_cents)} hint={`de ${formatCents(f.hoje.cobrado_cents)} cobrados`} />
                <Tile label="Pendente hoje" value={formatCents(f.hoje.pendente_cents)} hint="aguardando confirmação" />
                <Tile
                  label="No mês (aprovado)"
                  value={formatCents(f.mes.aprovado_cents)}
                  hint={`recusado ${formatCents(f.mes.recusado_cents)}`}
                />
              </dl>
            </div>
          );
        }}
      </AsyncBody>
    </Card>
  );
}
