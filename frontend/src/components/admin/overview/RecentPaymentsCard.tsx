'use client';

import { AsyncBody, Badge, Card, CardEmpty, CardLink } from '../Card';
import { formatCents, formatDateTime } from '../format';
import type { FetchState } from '../useAdminFetch';
import type { FinanceiroResponse } from '../types';
import { PAYMENT_STATUS, statusOf } from './labels';
import { Tile } from './Tile';

// Reaproveita a resposta do endpoint financeiro (resumo de hoje/mês + as 5
// últimas cobranças) — nenhuma chamada a mais.
export function RecentPaymentsCard({ state, className = '' }: { state: FetchState<FinanceiroResponse>; className?: string }) {
  return (
    <Card
      id="pagamentos"
      title="Pagamentos — Mercado Pago"
      subtitle="Últimas cobranças registradas"
      action={<CardLink href="/admin/financeiro">Ver todos</CardLink>}
      className={className}
    >
      <AsyncBody state={state} rows={4}>
        {(f) => (
          <>
            <dl className="grid grid-cols-3 gap-2">
              <Tile label="Hoje (aprovado)" value={formatCents(f.hoje.aprovado_cents)} />
              <Tile label="Pendente hoje" value={formatCents(f.hoje.pendente_cents)} />
              <Tile label="No mês (aprovado)" value={formatCents(f.mes.aprovado_cents)} />
            </dl>
            {f.recentes.length === 0 ? (
              <CardEmpty>Nenhuma cobrança registrada ainda.</CardEmpty>
            ) : (
              <div className="-mx-1 mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead>
                    <tr className="text-xs text-brand-700">
                      <th scope="col" className="px-1 pb-2 font-medium">Cliente</th>
                      <th scope="col" className="px-1 pb-2 font-medium">Plano</th>
                      <th scope="col" className="px-1 pb-2 text-right font-medium">Valor</th>
                      <th scope="col" className="px-1 pb-2 font-medium">Status</th>
                      <th scope="col" className="px-1 pb-2 font-medium">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.recentes.map((p) => {
                      const st = statusOf(PAYMENT_STATUS, p.status);
                      return (
                        <tr key={p.id} className="border-t border-brand-100">
                          <td className="px-1 py-2 font-medium text-brand-900">{p.cliente ?? 'Sem vínculo'}</td>
                          <td className="px-1 py-2 text-brand-700">{p.plano ?? '—'}</td>
                          <td className="px-1 py-2 text-right text-brand-900">{formatCents(p.amount_cents)}</td>
                          <td className="px-1 py-2">
                            <Badge tone={st.tone}>{st.label}</Badge>
                          </td>
                          <td className="px-1 py-2 text-brand-700">{formatDateTime(p.occurred_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </AsyncBody>
    </Card>
  );
}
