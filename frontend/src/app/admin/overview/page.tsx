'use client';

import { useState } from 'react';
import { useAdminStatus } from '@/components/admin/AdminStatusProvider';
import { relativeTime } from '@/components/admin/format';
import { AdminIcon } from '@/components/admin/icons';
import { AlertsCard } from '@/components/admin/overview/AlertsCard';
import { FinanceCard } from '@/components/admin/overview/FinanceCard';
import type { Periodo } from '@/components/admin/overview/FinanceCard';
import { HealthCard } from '@/components/admin/overview/HealthCard';
import { KpiRow } from '@/components/admin/overview/KpiRow';
import type { FinanceiroResponse, MiniMaxUsage, OpenRouterUsage, OverviewMetrics } from '@/components/admin/types';
import { useAdminFetch } from '@/components/admin/useAdminFetch';
import { useNow } from '@/components/admin/useNow';

export default function AdminOverviewPage() {
  const status = useAdminStatus();
  const now = useNow();
  const [refreshKey, setRefreshKey] = useState(0);
  const [dias, setDias] = useState<Periodo>(30);

  const overview = useAdminFetch<OverviewMetrics>('/api/overview', refreshKey);
  const miniMax = useAdminFetch<MiniMaxUsage>('/api/admin/ai-usage', refreshKey);
  const openrouter = useAdminFetch<OpenRouterUsage>('/api/ai-copilot/usage', refreshKey);
  const financeiro = useAdminFetch<FinanceiroResponse>(`/api/admin/dashboard/financeiro?dias=${dias}`, refreshKey);

  const refreshAll = () => {
    setRefreshKey((k) => k + 1);
    status.refresh();
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-brand-900">Visão Geral</h2>
          <p className="mt-1 text-sm text-brand-700">
            Acompanhe o desempenho, as finanças, os clientes e a saúde do sistema.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-brand-700">
          <span>{status.lastUpdated ? `Status atualizado ${relativeTime(status.lastUpdated, now)}` : 'Carregando…'}</span>
          <button
            type="button"
            onClick={refreshAll}
            className="flex items-center gap-1.5 rounded-lg border border-brand-100 px-3 py-1.5 font-medium text-brand-900 hover:bg-brand-50"
          >
            <AdminIcon name="refresh" className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </div>

      {/* Mobile: uma coluna, "Precisa da sua atenção" primeiro (order-*).
          ≥ xl: duas colunas independentes (os wrappers deixam de ser `contents`). */}
      <div className="mt-6 flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <div className="contents xl:flex xl:flex-col xl:gap-4">
          <div className="order-2 xl:order-none">
            <KpiRow overview={overview} miniMax={miniMax} openrouter={openrouter} />
          </div>
          <div className="order-4 xl:order-none">
            <FinanceCard state={financeiro} dias={dias} onDias={setDias} />
          </div>
        </div>
        <div className="contents xl:flex xl:flex-col xl:gap-4">
          <div className="order-1 xl:order-none">
            <AlertsCard />
          </div>
          <div className="order-3 xl:order-none">
            <HealthCard />
          </div>
        </div>
      </div>
    </div>
  );
}
