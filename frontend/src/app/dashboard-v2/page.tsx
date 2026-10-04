'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardBanner } from '@/components/dashboard/DashboardBanner';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { ScoreRing } from '@/components/dashboard/ScoreRing';
import { AuditoriaCard } from '@/components/dashboard/AuditoriaCard';
import { PendenciasCard } from '@/components/dashboard/PendenciasCard';
import { VencimentosCard } from '@/components/dashboard/VencimentosCard';
import { ProximosEventosCard } from '@/components/dashboard/ProximosEventosCard';
import { NrConformidadeCard } from '@/components/dashboard/NrConformidadeCard';
import { EmBreveCard } from '@/components/dashboard/EmBreveCard';
import { ApoioTecnicoCard } from '@/components/dashboard/ApoioTecnicoCard';
import { Skeleton } from '@/components/ui/Skeleton';
import type { ApiNrItem, ApiOverview, ApiSummary } from '@/lib/dashboard/api-types';
import { hojeISO, lerNrs, nivelScore, paraItensLista, paraNrLinhas, paraVencimentos, seloDoStatus } from '@/lib/dashboard/real';

interface TenantData {
  name: string;
  trade_name: string | null;
  cnpj?: string | null;
}

type Estado = 'carregando' | 'ok' | 'erro' | 'sem-assinatura';

const SELO_CLASSE = {
  ok: 'bg-dash-status-ok-bg text-dash-status-ok-text',
  warn: 'bg-dash-status-warn-bg text-dash-status-warn-text',
  crit: 'bg-dash-status-crit-bg text-dash-status-crit-text',
} as const;

function formatarHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function DashboardV2Page() {
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [summary, setSummary] = useState<ApiSummary | null>(null);
  const [overview, setOverview] = useState<ApiOverview | null>(null);
  const [nrs, setNrs] = useState<ApiNrItem[] | null>(null);
  const [estado, setEstado] = useState<Estado>('carregando');

  // Mesmo tratamento do /empresa/dashboard (ITEM 016): cada falha tem seu estado,
  // nunca uma tela vazia sem explicação.
  const carregar = useCallback(async () => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setEstado('carregando');
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [tenantRes, summaryRes, overviewRes, nrRes] = await Promise.all([
        fetch('/api/tenants/me', { headers }),
        fetch('/api/dashboard/summary', { headers }),
        fetch('/api/dashboard/overview', { headers }),
        fetch('/api/dashboard/nr-conformidade', { headers }).catch(() => null),
      ]);
      if (tenantRes.status === 401 || summaryRes.status === 401) {
        localStorage.removeItem('montese_token');
        localStorage.removeItem('montese_user');
        router.push('/login');
        return;
      }
      if (summaryRes.status === 403) {
        const body = await summaryRes.json().catch(() => null);
        if (body?.code === 'SUBSCRIPTION_INACTIVE') {
          setEstado('sem-assinatura');
          return;
        }
      }
      if (tenantRes.ok) setTenant(await tenantRes.json());
      // Sem as contagens o painel ainda é útil (KPIs mostram "—"); sem o resumo, não.
      setOverview(overviewRes.ok ? await overviewRes.json() : null);
      // Sem esta resposta o cartão mostra "indisponível"; o resto do painel segue.
      setNrs(await lerNrs(nrRes));
      if (!summaryRes.ok) {
        setEstado('erro');
        return;
      }
      setSummary(await summaryRes.json());
      setEstado('ok');
    } catch {
      setEstado('erro');
    }
  }, [router]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const empresaNome = tenant?.trade_name || tenant?.name || 'Sua empresa';
  const selo = summary ? seloDoStatus(summary.status) : null;
  const hoje = hojeISO();
  const num = (v: number | undefined) => (v === undefined ? '—' : v);

  return (
    <div className="px-4 py-6 sm:px-8">
          <DashboardBanner titulo="Painel de Controle SST" subtitulo={`${empresaNome} · CNPJ ${tenant?.cnpj ?? '—'}`} />

          {estado === 'carregando' && (
            <div role="status" aria-live="polite" className="mt-5 flex flex-col gap-5">
              <span className="sr-only">Carregando o painel...</span>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-[144px] rounded-[18px]" />
                ))}
              </div>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[300px] rounded-[18px]" />
                ))}
              </div>
            </div>
          )}

          {estado === 'erro' && (
            <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <p className="font-semibold">Não foi possível carregar o painel agora.</p>
              <p className="mt-1">Isso pode ser uma instabilidade momentânea. Seus dados não foram alterados.</p>
              <button
                type="button"
                onClick={carregar}
                className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-semibold text-red-900 hover:bg-red-100"
              >
                Tentar novamente
              </button>
            </div>
          )}

          {estado === 'sem-assinatura' && (
            <p className="mt-5 rounded-xl bg-dash-status-warn-bg px-4 py-3 text-sm text-dash-status-warn-text">
              O painel volta a aparecer quando o plano for reativado — veja o aviso de assinatura.
            </p>
          )}

          {estado === 'ok' && summary && selo && (
            <>
              <div className="mb-5 mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-dash-muted">
                <span className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${SELO_CLASSE[selo.tone]}`}>{selo.texto}</span>
                <span>Atualizado em {formatarHora(summary.updated_at)}</span>
              </div>

              <div className="flex flex-col gap-5">
                <section aria-label="Indicadores" className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
                  <KpiCard label="Empresas" value={1} hint={overview ? `${overview.filiais} ${overview.filiais === 1 ? 'filial' : 'filiais'}` : undefined} />
                  <KpiCard label="Funcionários" value={num(overview?.funcionarios)} hint="ativos" />
                  <KpiCard label="Documentos" value={num(overview?.documentos)} hint="cadastrados" />
                  <ScoreRing
                    score={summary.score}
                    nivel={nivelScore(summary.score)}
                    nota={summary.score === null ? 'Cadastre documentos com validade para calcular.' : 'Baseado em documentos com validade.'}
                  />
                </section>
                <section aria-label="Conformidade" className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                  <NrConformidadeCard itens={nrs === null ? null : paraNrLinhas(nrs)} />
                  <AuditoriaCard pgrPcmso={summary.auditoria?.pgr_pcmso} />
                  <PendenciasCard
                    itens={paraItensLista(summary.atencao)}
                    resumo={`${summary.resumo.pendencias} ${summary.resumo.pendencias === 1 ? 'pendência' : 'pendências'} · ${summary.resumo.avisos} ${summary.resumo.avisos === 1 ? 'aviso' : 'avisos'}`}
                  />
                </section>
                <section aria-label="Obrigações" className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                  <EmBreveCard titulo="eSocial" descricao="Acompanhamento dos eventos S-2210, S-2220 e S-2240 ainda não está disponível." />
                  <VencimentosCard itens={paraVencimentos(summary.atencao)} hoje={hoje} />
                  <ProximosEventosCard itens={paraItensLista(summary.proximos_eventos)} />
                </section>
                <ApoioTecnicoCard />
              </div>
            </>
          )}
    </div>
  );
}
