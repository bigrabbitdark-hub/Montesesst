'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { atuacaoFetch, CHAVE_ULTIMA_EMPRESA, formatCnpj, type EmpresaVisaoGeral } from '../../api';
import { VisaoGeral, Documentos, Vencimentos, Funcionarios, Epis, Tecnicos } from './Secoes';

const ABAS = ['Visão geral', 'Documentos', 'Vencimentos', 'Funcionários', 'EPI', 'Documentos técnicos'] as const;
const LINK =
  'rounded text-sm font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2';

export default function EmpresaPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [visao, setVisao] = useState<EmpresaVisaoGeral | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState(0);
  const abasRef = useRef<(HTMLButtonElement | null)[]>([]);
  const seq = useRef(0);

  const carregar = useCallback(() => {
    const id = ++seq.current;
    setCarregando(true);
    setErro(null);
    atuacaoFetch<EmpresaVisaoGeral>(`/empresas/${tenantId}/visao-geral`)
      .then((d) => {
        if (id !== seq.current) return;
        setVisao(d);
        try {
          localStorage.setItem(CHAVE_ULTIMA_EMPRESA, JSON.stringify({ id: tenantId, name: d.empresa.name }));
        } catch { /* conveniência: segue sem lembrar */ }
      })
      .catch((e: Error) => { if (id === seq.current) { setVisao(null); setErro(e.message); } })
      .finally(() => { if (id === seq.current) setCarregando(false); });
  }, [tenantId]);

  useEffect(carregar, [carregar]);

  // Recarrega só os contadores (sem skeleton e sem derrubar a tela se falhar); mesma guarda de resposta antiga.
  const recarregarVisao = useCallback(() => {
    const id = ++seq.current;
    atuacaoFetch<EmpresaVisaoGeral>(`/empresas/${tenantId}/visao-geral`)
      .then((d) => { if (id === seq.current) setVisao(d); })
      .catch(() => { /* mantém os números anteriores; a aba Visão geral pode ser recarregada ao reabrir a página */ });
  }, [tenantId]);

  function teclar(e: React.KeyboardEvent, i: number) {
    let n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % ABAS.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + ABAS.length) % ABAS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = ABAS.length - 1;
    else return;
    e.preventDefault();
    setAba(n);
    abasRef.current[n]?.focus();
  }

  const voltar = <Link href="/atuacao/empresas" className={LINK}>Trocar de empresa</Link>;

  if (carregando && !visao) {
    return <div className="px-4 py-8 sm:px-6"><Skeleton className="h-48 w-full" /></div>;
  }
  if (erro || !visao) {
    return (
      <div className="px-4 py-8 sm:px-6">
        <div role="alert" className="mb-4 flex flex-col items-start gap-2 text-sm text-dash-status-crit-text">
          <span>{erro ?? 'Nenhum dado disponível.'}</span>
          <button type="button" onClick={carregar} className="rounded border border-dash-border-input px-2 py-1 text-xs font-semibold">
            Tentar novamente
          </button>
        </div>
        {voltar}
      </div>
    );
  }

  const e = visao.empresa;
  return (
    <div className="px-4 py-8 sm:px-6">
      <div className="mb-2">{voltar}</div>
      <PageHeader titulo={e.name} descricao={`${e.trade_name ? `${e.trade_name} · ` : ''}CNPJ ${formatCnpj(e.cnpj)}`} />
      <div role="tablist" aria-label="Seções da empresa" className="mb-4 flex flex-wrap gap-1 border-b border-dash-border-input">
        {ABAS.map((nome, i) => (
          <button
            key={nome}
            ref={(el) => { abasRef.current[i] = el; }}
            type="button"
            role="tab"
            id={`aba-${i}`}
            aria-selected={aba === i}
            aria-controls="painel-empresa"
            tabIndex={aba === i ? 0 : -1}
            onClick={() => setAba(i)}
            onKeyDown={(ev) => teclar(ev, i)}
            className={`rounded-t-md px-3 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary ${
              aba === i ? 'border-b-2 border-dash-primary text-dash-primary' : 'text-dash-muted'
            }`}
          >
            {nome}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="painel-empresa" aria-labelledby={`aba-${aba}`} tabIndex={0} className="min-w-0 focus:outline-none">
        {aba === 0 && <VisaoGeral visao={visao} />}
        {aba === 1 && <Documentos tenantId={tenantId} onVigenciaAlterada={recarregarVisao} />}
        {aba === 2 && <Vencimentos tenantId={tenantId} />}
        {aba === 3 && <Funcionarios tenantId={tenantId} />}
        {aba === 4 && <Epis tenantId={tenantId} />}
        {aba === 5 && <Tecnicos tenantId={tenantId} />}
      </div>
    </div>
  );
}
