'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { atuacaoFetch, hojeIso, somarDias, DOC_STATUS_AGUARDANDO, type DocumentoResumo, type EventoResumo, type ResumoFinanceiro, type TarefasKpi } from './api';

interface Resumo { total: number; ativos: number; trial: number; pendentes: number; inativos: number }

function TarefasKpis() {
  const [data, setData] = useState<TarefasKpi | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(() => {
    setLoading(true);
    setError(null);
    atuacaoFetch<TarefasKpi>('/tarefas/resumo')
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(carregar, [carregar]);

  return (
    <section aria-labelledby="kpis-tarefas" className="mt-8">
      <h2 id="kpis-tarefas" className="mb-3 text-base font-semibold text-dash-primary">Suas tarefas</h2>
      <AsyncBody
        data={data}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-32 w-full"
        render={(t) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Minhas tarefas abertas" value={t.abertas} />
              <KpiCard label="Vencidas" value={t.vencidas} />
              <KpiCard label="Para hoje" value={t.hoje} />
              <KpiCard label="Bloqueadas" value={t.bloqueadas} />
            </div>
            <Link
              href="/atuacao/tarefas"
              className="mt-4 inline-block rounded text-sm font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2"
            >
              Ver minhas tarefas
            </Link>
          </>
        )}
      />
    </section>
  );
}

function AgendaKpi() {
  const [data, setData] = useState<EventoResumo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(() => {
    setLoading(true);
    setError(null);
    const hoje = hojeIso();
    const qs = new URLSearchParams({ owner: 'me', from: hoje, to: somarDias(hoje, 7), status: 'agendado' });
    atuacaoFetch<EventoResumo[]>(`/agenda?${qs.toString()}`)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(carregar, [carregar]);

  return (
    <section aria-labelledby="kpis-agenda" className="mt-8">
      <h2 id="kpis-agenda" className="mb-3 text-base font-semibold text-dash-primary">Sua agenda</h2>
      <AsyncBody
        data={data}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-32 w-full"
        render={(eventos) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Próximos atendimentos (7 dias)" value={eventos.length} />
            </div>
            <Link
              href="/atuacao/agenda"
              className="mt-4 inline-block rounded text-sm font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2"
            >
              Ver agenda
            </Link>
          </>
        )}
      />
    </section>
  );
}

function FinanceiroKpi() {
  const [data, setData] = useState<ResumoFinanceiro | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(() => {
    setLoading(true);
    setError(null);
    atuacaoFetch<ResumoFinanceiro>('/financeiro/resumo')
      .then((d) => {
        if (typeof d?.clientes?.com_pendencia !== 'number') throw new Error('Resumo financeiro indisponível.');
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(carregar, [carregar]);

  return (
    <section aria-labelledby="kpis-financeiro" className="mt-8">
      <h2 id="kpis-financeiro" className="mb-3 text-base font-semibold text-dash-primary">Financeiro</h2>
      <AsyncBody
        data={data}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-32 w-full"
        render={(r) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Clientes com pendência financeira" value={r.clientes.com_pendencia} />
            </div>
            <Link
              href="/atuacao/financeiro"
              className="mt-4 inline-block rounded text-sm font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2"
            >
              Ver financeiro
            </Link>
          </>
        )}
      />
    </section>
  );
}

function DocumentosKpi() {
  const [data, setData] = useState<DocumentoResumo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(() => {
    setLoading(true);
    setError(null);
    atuacaoFetch<DocumentoResumo[]>('/documentos')
      .then((d) => {
        if (!Array.isArray(d)) throw new Error('Resumo de documentos indisponível.');
        setData(d);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(carregar, [carregar]);

  return (
    <section aria-labelledby="kpis-documentos" className="mt-8">
      <h2 id="kpis-documentos" className="mb-3 text-base font-semibold text-dash-primary">Documentos</h2>
      <AsyncBody
        data={data}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-32 w-full"
        render={(docs) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                label="Documentos aguardando ação"
                value={docs.filter((d) => DOC_STATUS_AGUARDANDO.includes(d.status)).length}
                hint="Em revisão, aprovados ou assinados (registro interno)"
              />
            </div>
            <Link
              href="/atuacao/documentos"
              className="mt-4 inline-block rounded text-sm font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2"
            >
              Ver documentos
            </Link>
          </>
        )}
      />
    </section>
  );
}

export default function AtuacaoPainelPage() {
  const [data, setData] = useState<Resumo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(() => {
    setLoading(true);
    setError(null);
    atuacaoFetch<Resumo>('/resumo')
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(carregar, [carregar]);

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader titulo="Painel" descricao="Visão geral das empresas da carteira Montese." />
      <AsyncBody
        data={data}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-32 w-full"
        render={(r) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Clientes Montese" value={r.total} />
              <KpiCard label="Ativos" value={r.ativos} />
              <KpiCard label="Em teste" value={r.trial} />
              <KpiCard label="Inativos" value={r.inativos} />
            </div>
            <Link
              href="/atuacao/clientes"
              className="mt-6 inline-block rounded text-sm font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2"
            >
              Ver clientes
            </Link>
          </>
        )}
      />
      <TarefasKpis />
      <AgendaKpi />
      <FinanceiroKpi />
      <DocumentosKpi />
    </div>
  );
}
