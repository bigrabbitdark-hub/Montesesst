'use client';

import { useAdminStatus } from '../AdminStatusProvider';
import { Card, CardError, CardSkeleton, UnderConstructionBadge } from '../Card';
import { AdminIcon } from '../icons';
import { deriveSystemState, SYSTEM_STATE_LABEL } from '../status-state';

// Resumo do estado do sistema. O detalhe por serviço está no card "Status dos
// serviços". O "score geral" (%) da referência NÃO existe ainda: selo, sem número.
export function HealthCard({ className = '' }: { className?: string }) {
  const { system, refresh } = useAdminStatus();
  const state = deriveSystemState(system);
  const s = system.data?.services;
  const up = s ? [s.postgres.reachable, s.redis.reachable, s.frontend.reachable].filter(Boolean).length : 0;
  const ok = state === 'online';

  return (
    <Card id="saude" title="Saúde do sistema" className={className}>
      {state === 'carregando' && <CardSkeleton rows={2} />}
      {state === 'sem-resposta' && (
        <CardError onRetry={refresh} message="Não foi possível consultar o servidor." />
      )}
      {(state === 'online' || state === 'degradado') && (
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
              ok ? 'bg-adm-status-ok-bg text-adm-status-ok-text' : 'bg-adm-status-crit-bg text-adm-status-crit-text'
            }`}
          >
            <AdminIcon name={ok ? 'shield' : 'alert'} className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className={`text-lg font-semibold ${ok ? 'text-adm-status-ok-text' : 'text-adm-status-crit-text'}`}>
              {SYSTEM_STATE_LABEL[state]}
            </p>
            <p className="text-xs text-brand-700">{`${up} de 3 serviços monitorados acessíveis`}</p>
          </div>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-brand-100 pt-3">
        <p className="text-xs text-brand-700">Score geral de saúde</p>
        <UnderConstructionBadge />
      </div>
    </Card>
  );
}
