'use client';

import { AsyncBody, Card, CardEmpty } from '../Card';
import { fillDailySeries, formatCompact, formatInt } from '../format';
import type { FetchState } from '../useAdminFetch';
import type { MiniMaxUsage } from '../types';
import { Tile } from './Tile';

// Dados de /admin/ai-usage (tabela minimax_usage_log): total, 7 dias e por
// capacidade. "Hoje" usa a data UTC (o endpoint agrupa por dia em UTC e não
// devolve dias sem uso — fillDailySeries preenche). A referência mostra "por
// agente" e "por modelo": aqui o que existe é "por capacidade"; modelo é SP2.
export function AiTokensCard({ miniMax, className = '' }: { miniMax: FetchState<MiniMaxUsage>; className?: string }) {
  return (
    <Card id="ia" title="IA & tokens" subtitle="MiniMax — chamadas registradas pela plataforma" className={className}>
      <AsyncBody state={miniMax} rows={4}>
        {(u) => {
          if (u.total_calls === 0) return <CardEmpty>Nenhuma chamada de IA registrada ainda.</CardEmpty>;
          const serie = fillDailySeries(u.last_7_days);
          const hoje = serie[serie.length - 1].total_tokens;
          const total7 = serie.reduce((sum, d) => sum + d.total_tokens, 0);
          const maxCap = Math.max(1, ...u.by_capability.map((c) => Number(c.total_tokens)));
          return (
            <>
              <dl className="grid grid-cols-3 gap-2">
                <Tile label="Hoje (UTC)" value={formatCompact(hoje)} />
                <Tile label="7 dias" value={formatCompact(total7)} />
                <Tile label="Total" value={formatCompact(u.total_tokens)} hint={`${formatInt(u.total_calls)} chamadas`} />
              </dl>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-brand-700">Por capacidade</p>
              <ul className="mt-2 flex flex-col gap-2.5">
                {u.by_capability.map((c) => (
                  <li key={c.capability}>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="truncate text-brand-900">{c.capability}</span>
                      <span className="shrink-0 text-brand-700">
                        {`${formatCompact(Number(c.total_tokens))} · ${formatInt(Number(c.calls))} chamadas`}
                      </span>
                    </div>
                    <div className="adm-card-2 mt-1 h-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-violet-400"
                        style={{ width: `${Math.max(2, (Number(c.total_tokens) / maxCap) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <a
                href="https://platform.minimax.io/user-center/payment/balance"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 text-xs font-medium text-emerald-400 hover:underline"
              >
                Ver saldo no painel da MiniMax
              </a>
            </>
          );
        }}
      </AsyncBody>
    </Card>
  );
}
