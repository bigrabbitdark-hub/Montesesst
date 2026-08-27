'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminNav } from '@/components/AdminNav';

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

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-brand-100 p-6">
      <p className="text-3xl font-bold text-brand-900">{value}</p>
      <p className="mt-1 text-sm text-brand-700">{label}</p>
    </div>
  );
}

export default function AdminOverviewPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [error, setError] = useState('');

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
  }, [router]);

  if (!ready) {
    return <div className="mx-auto max-w-5xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Painel administrativo</h1>
      <div className="mt-6">
        <AdminNav />
      </div>

      <div className="mt-8">
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
    </div>
  );
}
