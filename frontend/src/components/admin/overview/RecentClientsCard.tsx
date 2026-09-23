'use client';

import { AsyncBody, Badge, Card, CardEmpty, CardLink } from '../Card';
import { formatCents, formatDateTime, relativeTime } from '../format';
import type { FetchState } from '../useAdminFetch';
import { useNow } from '../useNow';
import type { ClienteRecente } from '../types';
import { planLabel, statusOf, TENANT_STATUS } from './labels';

export function RecentClientsCard({ state, className = '' }: { state: FetchState<ClienteRecente[]>; className?: string }) {
  const now = useNow();
  return (
    <Card
      id="clientes"
      title="Clientes recentes"
      subtitle="Últimas empresas cadastradas"
      action={<CardLink href="/admin/empresas">Ver todas</CardLink>}
      className={className}
    >
      <AsyncBody state={state} rows={4}>
        {(rows) =>
          rows.length === 0 ? (
            <CardEmpty>Nenhuma empresa cadastrada ainda.</CardEmpty>
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead>
                  <tr className="text-xs text-brand-700">
                    <th scope="col" className="px-1 pb-2 font-medium">Empresa</th>
                    <th scope="col" className="px-1 pb-2 font-medium">Plano</th>
                    <th scope="col" className="px-1 pb-2 font-medium">Status</th>
                    <th scope="col" className="px-1 pb-2 text-right font-medium">MRR</th>
                    <th scope="col" className="px-1 pb-2 font-medium">Último acesso</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const st = statusOf(TENANT_STATUS, c.status);
                    return (
                      <tr key={c.id} className="border-t border-brand-100">
                        <td className="px-1 py-2 font-medium text-brand-900">{c.nome}</td>
                        <td className="px-1 py-2 text-brand-700">{planLabel(c.plano)}</td>
                        <td className="px-1 py-2">
                          <Badge tone={st.tone}>{st.label}</Badge>
                        </td>
                        <td className="px-1 py-2 text-right text-brand-900">
                          {c.mrr_cents === null ? '—' : formatCents(c.mrr_cents)}
                        </td>
                        <td
                          className="px-1 py-2 text-brand-700"
                          title={c.ultimo_acesso ? formatDateTime(c.ultimo_acesso) : 'Sem login registrado'}
                        >
                          {relativeTime(c.ultimo_acesso, now)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </AsyncBody>
    </Card>
  );
}
