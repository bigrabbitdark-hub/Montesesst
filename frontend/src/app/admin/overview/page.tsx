'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface OverviewMetrics {
  empresas_ativas: number;
  tecnicos_vinculados: number;
  parceiros_vinculados: number;
  inspecoes_no_mes: number;
  documentos_vencendo: number;
  epis_vencendo: number;
  assinaturas_ativas: number;
  receita_mensal_cents: number;
  planos_acao_pendentes: number;
}

interface SystemStatus {
  memory: { total_gb: number; free_gb: number; used_percent: number };
  cpu: { cores: number; load_avg_1m: number; load_avg_5m: number; load_avg_15m: number };
  disk: { total_gb: number; free_gb: number; used_percent: number };
  services: {
    postgres: { reachable: boolean; active_connections: number | null };
    redis: { reachable: boolean };
    frontend: { reachable: boolean };
  };
}

interface AiUsage {
  configured: boolean;
  provider: 'openrouter';
  is_free_tier?: boolean;
  total_credits?: number;
  total_usage?: number;
  usage_monthly?: number;
  low_balance_warning?: boolean;
  dashboard_url: string;
  error?: string;
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatUsd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-brand-100 p-6">
      <p className="text-3xl font-bold text-brand-900">{value}</p>
      <p className="mt-1 text-sm text-brand-700">{label}</p>
    </div>
  );
}

function UsageBar({ label, usedPercent, detail }: { label: string; usedPercent: number; detail: string }) {
  const barColor = usedPercent >= 90 ? 'bg-red-600' : usedPercent >= 70 ? 'bg-yellow-600' : 'bg-brand-500';
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-brand-900">{label}</span>
        <span className="text-brand-700">{detail}</span>
      </div>
      <div className="mt-1 h-2 w-full rounded-full bg-brand-50">
        <div
          className={`h-2 rounded-full ${barColor}`}
          style={{ width: `${Math.min(usedPercent, 100)}%` }}
        />
      </div>
    </div>
  );
}

function ServiceBadge({ label, reachable }: { label: string; reachable: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
        reachable ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
      }`}
    >
      {label}: {reachable ? 'Ativo' : 'Fora do ar'}
    </span>
  );
}

export default function AdminOverviewPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [error, setError] = useState('');
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [systemStatusError, setSystemStatusError] = useState('');
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    fetch('/api/overview', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(setMetrics)
      .catch(() => setError('Não foi possível carregar a visão geral.'));

    fetch('/api/system-status', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(setSystemStatus)
      .catch(() => setSystemStatusError('Não foi possível carregar o status da VPS.'));

    fetch('/api/ai-copilot/usage', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(setAiUsage)
      .catch(() => {
        // seção de IA fica oculta; não é crítico o bastante pra um erro de página
      });
  }, [router]);

  if (!ready) {
    return <p className="text-center text-brand-700">Carregando...</p>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-brand-900">Visão Geral</h2>

      <div className="mt-6">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!error && !metrics && <p className="text-sm text-brand-700">Carregando métricas...</p>}
        {metrics && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard label="Empresas ativas" value={metrics.empresas_ativas} />
            <StatCard label="Técnicos vinculados" value={metrics.tecnicos_vinculados} />
            <StatCard label="Parceiros vinculados" value={metrics.parceiros_vinculados} />
            <StatCard label="Inspeções no mês" value={metrics.inspecoes_no_mes} />
            <StatCard label="Documentos vencendo (30 dias)" value={metrics.documentos_vencendo} />
            <StatCard label="EPIs vencendo (30 dias)" value={metrics.epis_vencendo} />
            <StatCard label="Assinaturas ativas" value={metrics.assinaturas_ativas} />
            <StatCard label="Receita mensal recorrente" value={formatCents(metrics.receita_mensal_cents)} />
            <StatCard label="Planos de ação pendentes" value={metrics.planos_acao_pendentes} />
          </div>
        )}
      </div>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h3 className="text-lg font-bold text-brand-900">Servidor (VPS)</h3>
        {systemStatusError && <p className="mt-2 text-sm text-red-600">{systemStatusError}</p>}
        {!systemStatusError && !systemStatus && (
          <p className="mt-2 text-sm text-brand-700">Carregando status do servidor...</p>
        )}
        {systemStatus && (
          <div className="mt-4 flex flex-col gap-4">
            <UsageBar
              label="Memória (RAM)"
              usedPercent={systemStatus.memory.used_percent}
              detail={`${(systemStatus.memory.total_gb - systemStatus.memory.free_gb).toFixed(1)} GB de ${systemStatus.memory.total_gb.toFixed(1)} GB usados`}
            />
            <UsageBar
              label="Disco"
              usedPercent={systemStatus.disk.used_percent}
              detail={`${(systemStatus.disk.total_gb - systemStatus.disk.free_gb).toFixed(1)} GB de ${systemStatus.disk.total_gb.toFixed(1)} GB usados`}
            />
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-brand-900">Processador (CPU)</span>
              <span className="text-brand-700">
                carga média {systemStatus.cpu.load_avg_1m.toFixed(2)} em {systemStatus.cpu.cores} núcleos
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <ServiceBadge label="Banco de dados" reachable={systemStatus.services.postgres.reachable} />
              <ServiceBadge label="Redis" reachable={systemStatus.services.redis.reachable} />
              <ServiceBadge label="Site" reachable={systemStatus.services.frontend.reachable} />
            </div>
            {systemStatus.services.postgres.active_connections !== null && (
              <p className="text-xs text-brand-700">
                {systemStatus.services.postgres.active_connections} conexões ativas no banco de dados
              </p>
            )}
          </div>
        )}
      </section>

      {aiUsage?.configured && (
        <section className="mt-8 rounded-lg border border-brand-100 p-6">
          <h3 className="text-lg font-bold text-brand-900">Uso da IA (Copiloto)</h3>
          {aiUsage.error && <p className="mt-2 text-sm text-red-600">{aiUsage.error}</p>}
          {!aiUsage.error && (
            <div className="mt-4 flex flex-col gap-2 text-sm">
              <p className="text-brand-900">
                Crédito comprado: <strong>{formatUsd(aiUsage.total_credits ?? 0)}</strong>
              </p>
              <p className="text-brand-900">
                Uso total até agora: <strong>{formatUsd(aiUsage.total_usage ?? 0)}</strong>
              </p>
              {typeof aiUsage.usage_monthly === 'number' && (
                <p className="text-brand-900">
                  Uso este mês: <strong>{formatUsd(aiUsage.usage_monthly)}</strong>
                </p>
              )}
              {aiUsage.low_balance_warning && (
                <p className="rounded-md bg-yellow-50 p-3 text-yellow-800">
                  ⚠️ Sua conta está no plano gratuito, sem crédito comprado ainda. As chamadas de IA podem
                  parar de funcionar a qualquer momento.{' '}
                  <a href={aiUsage.dashboard_url} target="_blank" rel="noopener noreferrer" className="underline">
                    Adicionar crédito no OpenRouter
                  </a>
                  .
                </p>
              )}
              {!aiUsage.low_balance_warning && (
                <a
                  href={aiUsage.dashboard_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-500 hover:underline"
                >
                  Ver/adicionar crédito no painel do OpenRouter
                </a>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
