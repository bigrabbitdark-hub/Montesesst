'use client';

import { useAdminStatus } from '../AdminStatusProvider';
import { Card, CardError, CardSkeleton, UnderConstructionBadge } from '../Card';
import { plural } from '../format';
import { AdminIcon } from '../icons';
import { deriveSystemState } from '../status-state';

function ServiceRow({ name, ok, detail }: { name: string; ok: boolean; detail?: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2.5">
        <AdminIcon
          name={ok ? 'check' : 'alert'}
          className={`h-[18px] w-[18px] shrink-0 ${ok ? 'text-emerald-400' : 'text-red-400'}`}
        />
        <span className="min-w-0">
          <span className="block text-sm text-brand-900">{name}</span>
          {detail && <span className="block text-xs text-brand-700">{detail}</span>}
        </span>
      </span>
      <span className={`shrink-0 text-xs font-semibold ${ok ? 'text-emerald-300' : 'text-red-300'}`}>
        {ok ? 'Online' : 'Fora do ar'}
      </span>
    </li>
  );
}

// Só os 3 serviços que o backend realmente checa (Postgres, Redis, Site).
// O resto da referência (Qdrant, Docker, worker…) NÃO é medido: fica em texto
// com selo, sem bolinha verde.
export function ServicesCard({ className = '' }: { className?: string }) {
  const { system, refresh } = useAdminStatus();
  const state = deriveSystemState(system);
  const s = system.data?.services;
  const show = s && (state === 'online' || state === 'degradado');
  const up = s ? [s.postgres.reachable, s.redis.reachable, s.frontend.reachable].filter(Boolean).length : 0;

  return (
    <Card id="servicos" title="Status dos serviços" subtitle={show ? `${up} de 3 online` : undefined} className={className}>
      {state === 'carregando' && <CardSkeleton rows={3} />}
      {state === 'sem-resposta' && <CardError onRetry={refresh} message="Não foi possível consultar os serviços." />}
      {show && s && (
        <ul className="divide-y divide-brand-100">
          <ServiceRow
            name="PostgreSQL"
            ok={s.postgres.reachable}
            detail={
              s.postgres.active_connections !== null
                ? plural(s.postgres.active_connections, 'conexão ativa', 'conexões ativas')
                : undefined
            }
          />
          <ServiceRow name="Redis" ok={s.redis.reachable} />
          <ServiceRow name="Site (frontend)" ok={s.frontend.reachable} />
        </ul>
      )}
      <div className="mt-3 flex items-start justify-between gap-3 border-t border-brand-100 pt-3">
        <p className="text-xs text-brand-700">Qdrant, Docker, worker, WhatsApp e Mercado Pago ainda não são monitorados.</p>
        <UnderConstructionBadge />
      </div>
    </Card>
  );
}
