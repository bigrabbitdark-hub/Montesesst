'use client';

import Link from 'next/link';
import { useAdminStatus } from '../AdminStatusProvider';
import { Card, CardError, CardSkeleton } from '../Card';
import { formatTime } from '../format';
import { AdminIcon } from '../icons';
import type { AlertSeverity } from '../types';

const SEV: Record<AlertSeverity, { label: string; icon: 'alert' | 'info'; text: string; box: string }> = {
  critico: { label: 'Crítico', icon: 'alert', text: 'text-adm-status-crit-text', box: 'border-adm-status-crit/40 bg-adm-status-crit-bg' },
  atencao: { label: 'Atenção', icon: 'alert', text: 'text-adm-status-warn-text', box: 'border-adm-status-warn/40 bg-adm-status-warn-bg' },
  info: { label: 'Info', icon: 'info', text: 'text-adm-status-info-text', box: 'border-adm-status-info/40 bg-adm-status-info-bg' },
};

// "O que precisa da minha atenção" (spec §49). Calculado na hora no backend por
// regras determinísticas — sem persistência, então sem "há X min" por item.
export function AlertsCard({ className = '' }: { className?: string }) {
  const { alertas, refresh } = useAdminStatus();
  const data = alertas.data;

  return (
    <Card
      id="alertas"
      title="Precisa da sua atenção"
      subtitle={data ? `Verificado às ${formatTime(data.gerado_em)}` : undefined}
      className={className}
    >
      {data === null && !alertas.error && <CardSkeleton rows={3} />}
      {data === null && alertas.error && <CardError onRetry={refresh} message="Não foi possível carregar os alertas." />}
      {data !== null && data.itens.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <AdminIcon name="check" className="h-7 w-7 text-adm-status-ok-text" />
          <p className="text-sm text-brand-700">Nenhum alerta — tudo certo.</p>
        </div>
      )}
      {data !== null && data.itens.length > 0 && (
        <ul className="-mx-2 flex flex-col">
          {data.itens.map((item) => {
            const s = SEV[item.severidade];
            return (
              <li key={item.id}>
                <Link href={item.href} className="flex items-start gap-3 rounded-lg p-2 hover:bg-brand-50">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${s.box} ${s.text}`}
                  >
                    <AdminIcon name={s.icon} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[11px] font-semibold uppercase tracking-wide ${s.text}`}>{s.label}</span>
                    <span className="mt-0.5 block text-sm font-medium text-brand-900">{item.titulo}</span>
                    <span className="block text-xs text-brand-700">{item.detalhe}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {data !== null && alertas.error && (
        <p className="mt-2 text-xs text-adm-status-warn-text">A última verificação falhou; exibindo a leitura anterior.</p>
      )}
    </Card>
  );
}
