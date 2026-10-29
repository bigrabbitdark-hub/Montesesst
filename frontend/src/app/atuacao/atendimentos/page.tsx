'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { AsyncBody } from '@/components/ui/AsyncBody';
import {
  atuacaoFetch, formatDataCurta, hrefAtuacaoSeguro, INTERACAO_TIPO_LABEL, INTERACOES_POR_PAGINA,
  type ClienteResumo, type InteracaoTipo, type InteracoesGlobalResposta,
} from '../api';

const FOCO = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2';
const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const LABEL = 'mb-1 block text-sm font-medium text-dash-muted';
const LINK = `rounded font-semibold text-dash-primary underline ${FOCO}`;
const BTN_PAG = `rounded-md border border-dash-border-input px-3 py-1.5 text-sm font-semibold text-dash-primary disabled:opacity-50 ${FOCO}`;
const MSG_PERIODO = 'A data inicial deve ser anterior ou igual à data final.';

export default function AtendimentosPage() {
  const [tenantId, setTenantId] = useState('');
  const [tipo, setTipo] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [erroClientes, setErroClientes] = useState(false);
  const [data, setData] = useState<InteracoesGlobalResposta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ultima = useRef(0);
  const periodoInvalido = Boolean(from && to && from > to);

  useEffect(() => {
    atuacaoFetch<ClienteResumo[]>('/clientes')
      .then((c) => setClientes(Array.isArray(c) ? c : []))
      .catch(() => setErroClientes(true));
  }, []);

  const carregar = useCallback(() => {
    const id = ++ultima.current;
    if (periodoInvalido) { // não consulta com período invertido; respostas em voo ficam obsoletas
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (tenantId) qs.set('tenantId', tenantId);
    if (tipo) qs.set('tipo', tipo);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    qs.set('page', String(page));
    let reajustou = false;
    atuacaoFetch<InteracoesGlobalResposta>(`/interacoes?${qs.toString()}`)
      .then((d) => {
        if (!d || !Array.isArray(d.itens) || typeof d.total !== 'number') throw new Error('Histórico de atendimento indisponível. Tente novamente.');
        if (id !== ultima.current) return;
        const ultimaPagina = Math.max(1, Math.ceil(d.total / INTERACOES_POR_PAGINA));
        if (page > ultimaPagina) { reajustou = true; setPage(ultimaPagina); return; } // total encolheu
        setData(d);
      })
      .catch((e: Error) => { if (id === ultima.current) { setData(null); setError(e.message); } })
      .finally(() => { if (id === ultima.current && !reajustou) setLoading(false); });
  }, [tenantId, tipo, from, to, page, periodoInvalido]);

  useEffect(() => {
    carregar();
    return () => { ultima.current += 1; };
  }, [carregar]);

  const filtrar = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); };

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader titulo="Histórico de atendimento" descricao="Contatos registrados com as empresas da carteira Montese, do mais recente ao mais antigo." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_200px_170px_170px] lg:items-end">
        <div>
          <label htmlFor="a-empresa" className={LABEL}>Empresa</label>
          <select id="a-empresa" value={tenantId} onChange={(e) => filtrar(setTenantId)(e.target.value)} className={INPUT}>
            <option value="">Todas as empresas</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="a-tipo" className={LABEL}>Tipo de contato</label>
          <select id="a-tipo" value={tipo} onChange={(e) => filtrar(setTipo)(e.target.value)} className={INPUT}>
            <option value="">Todos</option>
            {(Object.keys(INTERACAO_TIPO_LABEL) as InteracaoTipo[]).map((t) => <option key={t} value={t}>{INTERACAO_TIPO_LABEL[t]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="a-de" className={LABEL}>De</label>
          <input id="a-de" type="date" value={from} max={to || undefined} onChange={(e) => filtrar(setFrom)(e.target.value)} className={INPUT} />
        </div>
        <div>
          <label htmlFor="a-ate" className={LABEL}>Até</label>
          <input id="a-ate" type="date" value={to} min={from || undefined} onChange={(e) => filtrar(setTo)(e.target.value)} className={INPUT} />
        </div>
      </div>
      {erroClientes && (
        <p role="status" className="mb-3 text-sm text-dash-muted">Não foi possível carregar o filtro de empresas. A lista continua disponível.</p>
      )}
      {periodoInvalido ? (
        <p role="alert" className="text-sm text-dash-status-crit-text">{MSG_PERIODO}</p>
      ) : (
        <AsyncBody
          data={data}
          error={error}
          loading={loading && data === null}
          onRetry={carregar}
          skeletonClassName="h-48 w-full"
          render={(r) => {
            const paginas = Math.max(1, Math.ceil(r.total / INTERACOES_POR_PAGINA));
            return (
              <div aria-busy={loading}>
                {loading ? (
                  <p role="status" className="text-sm text-dash-muted">Atualizando…</p>
                ) : r.itens.length === 0 ? (
                  <p className="text-sm text-dash-muted">Nenhum atendimento encontrado.</p>
                ) : (
                  <div className="overflow-x-auto rounded-[18px] bg-dash-card shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <caption className="sr-only">Histórico de atendimento</caption>
                      <thead className="text-xs uppercase text-dash-muted">
                        <tr>
                          <th scope="col" className="w-28 px-4 py-3">Data</th>
                          <th scope="col" className="px-4 py-3">Empresa</th>
                          <th scope="col" className="w-28 px-4 py-3">Tipo</th>
                          <th scope="col" className="w-[36%] px-4 py-3">Resumo</th>
                          <th scope="col" className="px-4 py-3">Responsável</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.itens.map((i) => {
                          const href = hrefAtuacaoSeguro(i.href);
                          return (
                            <tr key={i.id} className="border-t border-dash-border-input align-top">
                              <td className="px-4 py-3">{formatDataCurta(i.occurred_on)}</td>
                              <td className="break-words px-4 py-3">{href ? <Link href={href} className={LINK}>{i.empresa}</Link> : i.empresa}</td>
                              <td className="px-4 py-3">{INTERACAO_TIPO_LABEL[i.type] ?? i.type}</td>
                              <td className="whitespace-pre-wrap break-words px-4 py-3">{i.summary_truncado ? `${i.summary}…` : i.summary}</td>
                              <td className="break-words px-4 py-3">{i.created_by_name ?? '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {!loading && paginas > 1 && (
                  <nav aria-label="Paginação" className="mt-4 flex flex-wrap items-center gap-3">
                    <button type="button" className={BTN_PAG} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
                    <span className="text-sm text-dash-muted">{`Página ${page} de ${paginas} (${r.total} atendimentos)`}</span>
                    <button type="button" className={BTN_PAG} disabled={page >= paginas} onClick={() => setPage((p) => p + 1)}>Próxima</button>
                  </nav>
                )}
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
