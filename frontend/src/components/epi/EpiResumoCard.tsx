'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { epiApi } from '@/lib/epi/api';
import { EpiApiError, mapEpiError } from '@/lib/epi/errors';
import { formatQty } from '@/lib/epi/format';
import type { EpiDashboard } from '@/lib/epi/types';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { BTN_PRIMARY, BTN_SECONDARY } from './styles';

// Resumo do módulo de EPI na página da empresa do técnico: 3 números do painel e o caminho para o módulo completo.
export function EpiResumoCard({ tenantId }: { tenantId: string }) {
  return <EpiResumoInner key={tenantId} tenantId={tenantId} />;
}

function EpiResumoInner({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<EpiDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const gen = useRef(0);

  useEffect(() => {
    const mine = ++gen.current;
    setError(null);
    epiApi.dashboard({ tenantId })
      .then((d) => { if (mine === gen.current) setData(d); })
      .catch((e) => {
        if (mine !== gen.current) return;
        setError(e instanceof EpiApiError && e.status === 404 ? 'Empresa não encontrada ou sem acesso para você.' : mapEpiError(e));
      });
    return () => { gen.current += 1; };
  }, [tenantId, tick]);

  const link = (
    <Link href={`/tecnico/empresas/${tenantId}/epi`} className={BTN_PRIMARY + ' inline-flex items-center'}>Abrir módulo de EPI</Link>
  );

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 text-base text-dash-status-crit-text">
        <span>{error}</span>
        <button type="button" className={BTN_SECONDARY} onClick={() => { setData(null); setTick((n) => n + 1); }}>Tentar novamente</button>
      </div>
    );
  }
  if (!data) return <div role="status" aria-label="Carregando resumo de EPI"><Skeleton className="h-32 w-full" /></div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard large label="EPIs ativos" value={formatQty(data.kpis.epis_total)} />
        <KpiCard large label="Estoque baixo ou zerado" value={formatQty(data.kpis.low_stock + data.kpis.zero_stock)} />
        <KpiCard large label="Aguardando assinatura" value={formatQty(data.kpis.pending_signatures)} />
      </div>
      <div>{link}</div>
    </div>
  );
}
