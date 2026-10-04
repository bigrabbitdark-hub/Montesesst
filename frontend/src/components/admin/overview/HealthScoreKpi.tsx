'use client';

import { useAdminStatus } from '../AdminStatusProvider';
import { CardSkeleton } from '../Card';
import { formatCompact } from '../format';
import { AdminIcon } from '../icons';
import type { AlertasResponse, FinanceiroResponse, MiniMaxUsage, OpenRouterUsage, SystemStatus } from '../types';
import type { FetchState } from '../useAdminFetch';

// =============================================================================
// Score de saúde — composição OPERACIONAL simples, NÃO científica.
// =============================================================================
// O score é um número 0–100 para uso no painel, sem pretensão de SLA ou
// auditoria. Se uma fonte de dados não estiver disponível, o sub-score
// correspondente fica null e o total é a média dos sub-scores disponíveis.
//
// Sub-scores (todos 0–100, maior = melhor):
//
// 1. Infraestrutura
//    input: system.memory.used_percent, system.disk.used_percent,
//           system.cpu.load_avg_1m / system.cpu.cores
//    cálculo: 100 - max(ram%, disk%, load_normalizado%)
//    motivo: o gargalo mais pressionado define a pior pressão.
//
// 2. Banco de Dados
//    input: system.services.postgres.reachable,
//           system.services.postgres.active_connections
//    cálculo: reachable ? (connections > 80 ? 70 : 100) : 0
//    motivo: a conexão cair é grave; conexões altas (sem limite documentado
//            aqui) só avisam.
//
// 3. APIs
//    input: contagem de {postgres, redis, frontend}.reachable
//    cálculo: 3→100, 2→70, 1→40, 0→0
//    motivo: até 1 serviço no ar ainda há degradação parcial.
//
// 4. IA
//    input: openrouter (configured, low_balance_warning, error)
//           e miniMax (total_calls)
//    cálculo:
//      - OpenRouter configurado, sem alerta de saldo, sem erro → 100
//      - Configurado mas com alerta de saldo ou erro → 60
//      - Não configurado e total_calls = 0 → 70 (sem uso = sem cobrança)
//      - Não configurado mas com uso registrado → 80 (roda só pelo MiniMax)
//    motivo: refletir disponibilidade do provedor principal; sem custo
//            auditável, o sub-score não tenta medir gasto.
//
// 5. Segurança
//    input: alertas.contagem.critico, alertas.contagem.atencao
//    cálculo: clamp(100 - critico*25 - atencao*5, 0, 100)
//    motivo: cada crítico derruba forte; "atenção" derruba pouco.
//
// 6. Financeiro
//    input: financeiro.mes.recusado_cents
//    cálculo: recusado == 0 → 100; ≤ R$ 100 → 80; ≤ R$ 500 → 60;
//             ≤ R$ 2.000 → 40; > R$ 2.000 → 20
//    motivo: pagamentos recusados são falha de receita direta.
//
// Total = média aritmética simples dos sub-scores disponíveis
// (sem peso). Quando todos disponíveis, é 1/6 cada.
// =============================================================================

type SubKey = 'infraestrutura' | 'banco' | 'apis' | 'ia' | 'seguranca' | 'financeiro';
type SubScore = { percent: number; reason: string };
type ScoreParts = Partial<Record<SubKey, SubScore>>;

export interface HealthScore {
  total: number; // 0..100, arredondado
  parts: ScoreParts;
  available: number; // qtd. sub-scores com dado
  hasData: boolean; // false enquanto tudo carrega
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function scoreInfraestrutura(system: SystemStatus | null): SubScore | null {
  if (!system) return null;
  const ram = system.memory.used_percent;
  const disk = system.disk.used_percent;
  const loadNorm = system.cpu.cores > 0
    ? Math.min(100, (system.cpu.load_avg_1m / system.cpu.cores) * 100)
    : 0;
  const worst = Math.max(ram, disk, loadNorm);
  const percent = Math.round(clamp(100 - worst, 0, 100));
  const reason = `RAM ${ram.toFixed(0)}% · disco ${disk.toFixed(0)}% · carga ${loadNorm.toFixed(0)}%`;
  return { percent, reason };
}

function scoreBanco(system: SystemStatus | null): SubScore | null {
  if (!system) return null;
  const pg = system.services.postgres;
  if (!pg.reachable) return { percent: 0, reason: 'Postgres inacessível' };
  const conns = pg.active_connections ?? 0;
  const percent = conns > 80 ? 70 : 100;
  const reason = conns > 80
    ? `${conns} conexões (alto)`
    : pg.active_connections === null
      ? 'ok (sem leitura de conexões)'
      : `${conns} conexões`;
  return { percent, reason };
}

function scoreApis(system: SystemStatus | null): SubScore | null {
  if (!system) return null;
  const { postgres, redis, frontend } = system.services;
  const up = [postgres.reachable, redis.reachable, frontend.reachable].filter(Boolean).length;
  const percent = up === 3 ? 100 : up === 2 ? 70 : up === 1 ? 40 : 0;
  return { percent, reason: `${up} de 3 serviços acessíveis` };
}

function scoreIa(
  miniMax: MiniMaxUsage | null,
  openrouter: OpenRouterUsage | null,
): SubScore | null {
  if (!miniMax && !openrouter) return null;
  let percent = 100;
  let reason = 'ok';
  if (openrouter) {
    if (openrouter.error) {
      percent = 60;
      reason = 'OpenRouter indisponível';
    } else if (openrouter.configured) {
      if (openrouter.low_balance_warning) {
        percent = 60;
        reason = 'OpenRouter com saldo baixo';
      } else {
        percent = 100;
        reason = 'OpenRouter configurado';
      }
    } else {
      const hasUsage = (miniMax?.total_calls ?? 0) > 0;
      percent = hasUsage ? 80 : 70;
      reason = hasUsage ? 'uso via MiniMax' : 'sem uso registrado';
    }
  } else if (miniMax) {
    percent = (miniMax.total_calls ?? 0) > 0 ? 80 : 70;
    reason = (miniMax.total_calls ?? 0) > 0 ? 'uso via MiniMax' : 'sem uso registrado';
  }
  return { percent, reason };
}

function scoreSeguranca(alertas: AlertasResponse | null): SubScore | null {
  if (!alertas) return null;
  const c = alertas.contagem.critico;
  const a = alertas.contagem.atencao;
  const percent = clamp(100 - c * 25 - a * 5, 0, 100);
  const reason = c === 0 && a === 0
    ? 'sem alertas críticos ou de atenção'
    : `${c} crítico(s), ${a} atenção`;
  return { percent, reason };
}

function scoreFinanceiro(financeiro: FinanceiroResponse | null): SubScore | null {
  if (!financeiro) return null;
  const recusado = financeiro.mes?.recusado_cents ?? 0;
  let percent = 100;
  if (recusado > 0 && recusado <= 10_000) percent = 80;       // ≤ R$ 100
  else if (recusado <= 50_000) percent = 60;                  // ≤ R$ 500
  else if (recusado <= 200_000) percent = 40;                 // ≤ R$ 2.000
  else if (recusado > 200_000) percent = 20;                  // > R$ 2.000
  const reason = recusado === 0
    ? 'sem pagamentos recusados no mês'
    : `${formatCompact(recusado / 100)} recusados no mês`;
  return { percent, reason };
}

export function computeHealthScore(input: {
  system: SystemStatus | null;
  alertas: AlertasResponse | null;
  financeiro: FinanceiroResponse | null;
  miniMax: MiniMaxUsage | null;
  openrouter: OpenRouterUsage | null;
}): HealthScore {
  const parts: ScoreParts = {
    infraestrutura: scoreInfraestrutura(input.system) ?? undefined,
    banco: scoreBanco(input.system) ?? undefined,
    apis: scoreApis(input.system) ?? undefined,
    ia: scoreIa(input.miniMax, input.openrouter) ?? undefined,
    seguranca: scoreSeguranca(input.alertas) ?? undefined,
    financeiro: scoreFinanceiro(input.financeiro) ?? undefined,
  };
  const available = Object.values(parts).filter((p): p is SubScore => p !== undefined);
  if (available.length === 0) {
    return { total: 0, parts, available: 0, hasData: false };
  }
  const total = Math.round(available.reduce((sum, p) => sum + p.percent, 0) / available.length);
  return { total, parts, available: available.length, hasData: true };
}

function partTextColor(percent: number): string {
  if (percent >= 90) return 'text-adm-status-ok-text';
  if (percent >= 70) return 'text-adm-status-warn-text';
  return 'text-adm-status-crit-text';
}

function partDotClass(percent: number): string {
  if (percent >= 90) return 'bg-adm-status-ok';
  if (percent >= 70) return 'bg-adm-status-warn';
  return 'bg-adm-status-crit';
}

const SUB_LABELS: Record<SubKey, string> = {
  infraestrutura: 'Infraestrutura',
  banco: 'Banco de Dados',
  apis: 'APIs',
  ia: 'IA',
  seguranca: 'Segurança',
  financeiro: 'Financeiro',
};

export function HealthScoreKpi({
  className = '',
  financeiro,
  miniMax,
  openrouter,
}: {
  className?: string;
  financeiro: FetchState<FinanceiroResponse>;
  miniMax: FetchState<MiniMaxUsage>;
  openrouter: FetchState<OpenRouterUsage>;
}) {
  // `system` e `alertas` vêm do AdminStatusProvider (sem refetch);
  // `financeiro`, `miniMax` e `openrouter` vêm por prop para reusar
  // o fetch que o KpiRow já faz e evitar duplicação.
  const { system, alertas, refresh } = useAdminStatus();

  const score = computeHealthScore({
    system: system.data,
    alertas: alertas.data,
    financeiro: financeiro.data,
    miniMax: miniMax.data,
    openrouter: openrouter.data,
  });

  const loading = !system.data && !system.error;
  const totalColor =
    score.total >= 90 ? 'text-adm-status-ok-text' : score.total >= 70 ? 'text-adm-status-warn-text' : 'text-adm-status-crit-text';

  return (
    <div className={`adm-card flex min-w-0 items-start gap-4 p-4 sm:p-5 ${className}`}>
      <span
        aria-hidden="true"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-adm-status-warn-bg text-adm-status-warn-text"
      >
        <AdminIcon name="shield" className="h-6 w-6" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-brand-700">Saúde do Sistema</p>
          {score.hasData ? (
            <p className={`text-[26px] font-bold leading-none ${totalColor}`}>
              {score.total}
              <span className="ml-0.5 text-sm font-medium text-brand-700">%</span>
            </p>
          ) : (
            <span className="h-7 w-14 animate-pulse rounded-md bg-brand-100" aria-hidden="true" />
          )}
        </div>
        {loading && (
          <div className="mt-3">
            <CardSkeleton rows={3} />
          </div>
        )}
        {!loading && score.hasData && (
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            {(Object.keys(SUB_LABELS) as SubKey[]).map((key) => {
              const part = score.parts[key];
              return (
                <div key={key} className="flex items-center justify-between gap-2">
                  <dt className="truncate text-brand-700">{SUB_LABELS[key]}</dt>
                  <dd className="flex shrink-0 items-center gap-1.5">
                    {part ? (
                      <>
                        <span
                          aria-hidden="true"
                          className={`inline-block h-1.5 w-1.5 rounded-full ${partDotClass(part.percent)}`}
                        />
                        <span className={`font-semibold ${partTextColor(part.percent)}`}>
                          {part.percent}%
                        </span>
                      </>
                    ) : (
                      <span className="text-brand-500" title="Sem dado">—</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {!loading && !score.hasData && (
          <button
            type="button"
            onClick={refresh}
            className="mt-2 text-xs text-brand-700 underline hover:text-brand-900"
          >
            Tentar novamente
          </button>
        )}
        {score.hasData && score.available < 6 && (
          <p className="mt-2 text-[11px] text-brand-700">
            Score com {score.available} de 6 indicadores disponíveis.
          </p>
        )}
      </div>
    </div>
  );
}
