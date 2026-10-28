'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { EmBreveCard } from '@/components/dashboard/EmBreveCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { atuacaoFetch, erroLeituraPgr, type ClienteFicha, type Ghe, type PgrResumo } from '../../../api';
import { LINK } from '../../estilos';
import { Ambientes } from './Ambientes';
import { Etapas, type EtapaChave } from './Etapas';
import { Responsaveis } from './Responsaveis';
import { ResumoEmpresa } from './ResumoEmpresa';
import { Riscos } from './Riscos';

const EM_BREVE = [
  ['Matriz de riscos', 'Classificação dos riscos de cada GHE por probabilidade e severidade.'],
  ['Plano de ação', 'Medidas de prevenção com responsável e prazo.'],
  ['Emitir PGR', 'Geração do documento do programa a partir do inventário.'],
] as const;

// Fluxo guiado do inventário: Empresa → Responsáveis → Ambientes → Riscos. O servidor guarda o rascunho de cada etapa;
// esta tela só lê e grava pelas rotas /atuacao/pgr/empresas/:tenantId (o tenant é sempre o da URL).
export default function PgrFluxoPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  // key: ao trocar de empresa todo o estado local (etapa, formulários) recomeça.
  return <PgrFluxo key={tenantId} tenantId={tenantId} />;
}

function PgrFluxo({ tenantId }: { tenantId: string }) {
  const [resumo, setResumo] = useState<PgrResumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ficha, setFicha] = useState<ClienteFicha | null>(null);
  const [fichaFalhou, setFichaFalhou] = useState(false);
  const [ghes, setGhes] = useState<Ghe[]>([]);
  const [erroGhes, setErroGhes] = useState<string | null>(null);
  const [etapa, setEtapa] = useState<EtapaChave>('empresa');
  const seqResumo = useRef(0);
  const seqGhes = useRef(0);

  const carregarResumo = useCallback((silencioso: boolean) => {
    const id = ++seqResumo.current;
    if (!silencioso) { setCarregando(true); setErro(null); }
    atuacaoFetch<PgrResumo>(`/pgr/empresas/${tenantId}/resumo`)
      .then((d) => { if (id === seqResumo.current) { setResumo(d); setErro(null); } })
      .catch((e) => { if (id === seqResumo.current && !silencioso) { setResumo(null); setErro(erroLeituraPgr(e)); } })
      .finally(() => { if (id === seqResumo.current) setCarregando(false); });
  }, [tenantId]);

  const carregarGhes = useCallback(() => {
    const id = ++seqGhes.current;
    atuacaoFetch<Ghe[]>(`/pgr/empresas/${tenantId}/ghes`)
      .then((d) => { if (id === seqGhes.current) { setGhes(d); setErroGhes(null); } })
      .catch((e) => { if (id === seqGhes.current) setErroGhes(erroLeituraPgr(e)); });
  }, [tenantId]);

  useEffect(() => {
    carregarResumo(false);
    carregarGhes();
    let vivo = true;
    // Unidades e responsáveis vêm da ficha do cliente; sem permissão de clientes a tela segue (seletor/lista ficam vazios).
    setFicha(null);
    setFichaFalhou(false);
    atuacaoFetch<ClienteFicha>(`/clientes/${tenantId}`).then((d) => { if (vivo) setFicha(d); }).catch(() => { if (vivo) setFichaFalhou(true); });
    return () => { vivo = false; };
  }, [tenantId, carregarResumo, carregarGhes]);

  // Depois de gravar algo: atualiza os contadores e as pendências sem piscar a tela.
  const aoMudar = useCallback(() => { carregarResumo(true); carregarGhes(); }, [carregarResumo, carregarGhes]);

  if (carregando && !resumo) {
    return (
      <div className="px-4 py-8 sm:px-6" aria-busy="true">
        <p role="status" className="sr-only">Carregando inventário…</p>
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!resumo) {
    return (
      <div className="px-4 py-8 sm:px-6">
        <PageHeader titulo="Inventário de riscos do PGR" />
        <p role="alert" className="text-sm text-dash-status-crit-text">{erro ?? 'Empresa não encontrada.'}</p>
        <p className="mt-3 text-sm"><Link href="/atuacao/pgr" className={LINK}>Voltar ao PGR</Link></p>
      </div>
    );
  }

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader titulo="Inventário de riscos do PGR" descricao="Siga as etapas na ordem que preferir: cada uma é salva de forma independente e pode ser retomada depois." />
      <p className="mb-1 text-lg font-semibold text-dash-primary">{resumo.empresa.name}</p>
      <p className="mb-4 text-sm"><Link href="/atuacao/pgr" className={LINK}>Voltar ao PGR</Link></p>
      <Etapas atual={etapa} onIr={setEtapa} resumo={resumo} />
      {erroGhes && <p role="alert" className="mb-3 text-sm text-dash-status-crit-text">{erroGhes}</p>}
      {etapa === 'empresa' && <ResumoEmpresa resumo={resumo} tenantId={tenantId} />}
      {etapa === 'responsaveis' && <Responsaveis responsaveis={ficha ? (ficha.responsaveis ?? null) : null} carregando={!ficha && !fichaFalhou} falhou={fichaFalhou} />}
      {etapa === 'ambientes' && (
        <Ambientes tenantId={tenantId} ghes={ghes} unidades={(ficha?.units ?? []).filter((u) => u.status === 'ativo')} onGhes={setGhes} onMudou={aoMudar} />
      )}
      {etapa === 'riscos' && <Riscos tenantId={tenantId} ghes={ghes} onMudou={aoMudar} />}
      <ul className="mt-6 grid gap-3 sm:grid-cols-3">
        {EM_BREVE.map(([t, d]) => <li key={t}><EmBreveCard titulo={t} descricao={d} /></li>)}
      </ul>
    </div>
  );
}
