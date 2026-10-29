'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import {
  atuacaoFetch, docCategoriaLabel, formatDataCurta, hrefAtuacaoSeguro, plural, FAIXAS_VENCIMENTO, FAIXA_LABEL,
  VENCIMENTOS_POR_PAGINA, type ClienteResumo, type FaixaVencimento, type VencimentosResposta,
} from '../api';

const FOCO = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2';
const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const LINK = `rounded font-semibold text-dash-primary underline ${FOCO}`;
const BTN_PAG = `rounded-md border border-dash-border-input px-3 py-1.5 text-sm font-semibold text-dash-primary disabled:opacity-50 ${FOCO}`;

// dias < 0 = vencido (a contagem vem do servidor, não do relógio do navegador).
function Quando({ dias }: { dias: number }) {
  if (dias < 0) return <Badge tone="crit">{`Vencido há ${plural(-dias, 'dia', 'dias')}`}</Badge>;
  if (dias === 0) return <Badge tone="warn">Vence hoje</Badge>;
  return <Badge tone="warn">{`Vence em ${plural(dias, 'dia', 'dias')}`}</Badge>;
}

function VencimentosConteudo() {
  const params = useSearchParams();
  const faixaUrl = params.get('faixa');
  const tenantUrl = params.get('tenantId') ?? '';
  const [faixa, setFaixa] = useState<FaixaVencimento>(
    FAIXAS_VENCIMENTO.includes(faixaUrl as FaixaVencimento) ? (faixaUrl as FaixaVencimento) : 'vencidos',
  );
  const [tenantId, setTenantId] = useState(tenantUrl);
  const [page, setPage] = useState(1);
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [erroClientes, setErroClientes] = useState(false);
  const [data, setData] = useState<VencimentosResposta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ultima = useRef(0);

  useEffect(() => {
    atuacaoFetch<ClienteResumo[]>('/clientes')
      .then((c) => setClientes(Array.isArray(c) ? c : []))
      .catch(() => setErroClientes(true));
  }, []);

  const carregar = useCallback(() => {
    const id = ++ultima.current;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ faixa });
    if (tenantId) qs.set('tenantId', tenantId);
    qs.set('page', String(page));
    let reajustou = false;
    atuacaoFetch<VencimentosResposta>(`/vencimentos?${qs.toString()}`)
      .then((d) => {
        if (!d || !Array.isArray(d.itens) || typeof d.total !== 'number') throw new Error('Vencimentos indisponíveis. Tente novamente.');
        if (id !== ultima.current) return;
        const ultimaPagina = Math.max(1, Math.ceil(d.total / VENCIMENTOS_POR_PAGINA));
        if (page > ultimaPagina) { reajustou = true; setPage(ultimaPagina); return; } // total encolheu: volta à última página existente
        setData(d);
      })
      .catch((e: Error) => { if (id === ultima.current) { setData(null); setError(e.message); } })
      .finally(() => { if (id === ultima.current && !reajustou) setLoading(false); });
  }, [faixa, tenantId, page]);

  useEffect(() => {
    carregar();
    return () => { ultima.current += 1; };
  }, [carregar]);

  function trocarFaixa(f: FaixaVencimento) { setFaixa(f); setPage(1); }
  function trocarEmpresa(t: string) { setTenantId(t); setPage(1); }

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader
        titulo="Vencimentos"
        descricao='Documentos das empresas da carteira por validade. As faixas "até N dias" são cumulativas: "até 15 dias" já inclui os de "até 7 dias".'
      />
      <div className="mb-4 grid gap-3 lg:grid-cols-[auto_280px] lg:items-end">
        <div role="group" aria-label="Faixa de vencimento" className="flex flex-wrap gap-2">
          {FAIXAS_VENCIMENTO.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={faixa === f}
              onClick={() => trocarFaixa(f)}
              className={`rounded-md border px-3 py-2 text-sm font-semibold ${FOCO} ${
                faixa === f ? 'border-dash-primary bg-dash-primary text-white' : 'border-dash-border-input bg-white text-dash-primary'
              }`}
            >
              {FAIXA_LABEL[f]}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="v-empresa" className="mb-1 block text-sm font-medium text-dash-muted">Empresa</label>
          <select id="v-empresa" value={tenantId} onChange={(e) => trocarEmpresa(e.target.value)} className={INPUT}>
            <option value="">Todas as empresas</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      {erroClientes && (
        <p role="status" className="mb-3 text-sm text-dash-muted">Não foi possível carregar o filtro de empresas. A lista continua disponível.</p>
      )}
      <AsyncBody
        data={data}
        error={error}
        loading={loading && data === null}
        onRetry={carregar}
        skeletonClassName="h-48 w-full"
        render={(r) => {
          const paginas = Math.max(1, Math.ceil(r.total / VENCIMENTOS_POR_PAGINA));
          return (
            <div aria-busy={loading}>
              {loading ? (
                <p role="status" className="text-sm text-dash-muted">Atualizando…</p>
              ) : r.itens.length === 0 ? (
                <p className="text-sm text-dash-muted">Nenhum documento nesta faixa.</p>
              ) : (
                <div className="overflow-x-auto rounded-[18px] bg-dash-card shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <caption className="sr-only">{`Documentos: ${FAIXA_LABEL[faixa]}`}</caption>
                    <thead className="text-xs uppercase text-dash-muted">
                      <tr>
                        <th scope="col" className="px-4 py-3">Empresa</th>
                        <th scope="col" className="px-4 py-3">Documento</th>
                        <th scope="col" className="px-4 py-3">Categoria</th>
                        <th scope="col" className="px-4 py-3">Vencimento</th>
                        <th scope="col" className="px-4 py-3">Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.itens.map((i) => {
                        const href = hrefAtuacaoSeguro(i.href);
                        return (
                          <tr key={i.documento_id} className="border-t border-dash-border-input align-top">
                            <td className="break-words px-4 py-3">
                              {href ? <Link href={href} className={LINK}>{i.empresa}</Link> : i.empresa}
                            </td>
                            <td className="break-words px-4 py-3">{i.titulo}</td>
                            <td className="px-4 py-3">{docCategoriaLabel(i.categoria)}</td>
                            <td className="px-4 py-3">{formatDataCurta(i.expires_at)}</td>
                            <td className="px-4 py-3"><Quando dias={i.dias} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {!loading && paginas > 1 && (
                <nav aria-label="Paginação" className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="button" className={BTN_PAG} disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Anterior</button>
                  <span className="text-sm text-dash-muted">{`Página ${page} de ${paginas} (${r.total} documentos)`}</span>
                  <button type="button" className={BTN_PAG} disabled={page >= paginas || loading} onClick={() => setPage((p) => p + 1)}>Próxima</button>
                </nav>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}

export default function VencimentosPage() {
  // useSearchParams exige Suspense no build do Next.
  return (
    <Suspense fallback={null}>
      <VencimentosConteudo />
    </Suspense>
  );
}
