'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import {
  atuacaoFetch, formatBRL, formatDataCurta, pagamentoLabel, pagamentoTone, SITUACAO_LABEL, SITUACAO_TONE, textoAtraso,
  type ClienteFinanceiro, type ResumoFinanceiro,
} from '../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const LINK =
  'font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 rounded';
const BTN_SEC =
  'rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';

function Resumo() {
  const [data, setData] = useState<ResumoFinanceiro | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(() => {
    setLoading(true);
    setError(null);
    atuacaoFetch<ResumoFinanceiro>('/financeiro/resumo')
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(carregar, [carregar]);

  return (
    <section aria-label="Resumo financeiro" className="mb-6">
      <AsyncBody
        data={data}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-32 w-full"
        render={(r) => (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Clientes ativos" value={r.clientes.ativos} />
            <KpiCard label="MRR" value={formatBRL(r.mrr_cents)} hint="Receita mensal recorrente das assinaturas ativas" />
            <KpiCard label="Clientes com pendência" value={r.clientes.com_pendencia} />
            <KpiCard label="Aprovado no mês" value={formatBRL(r.mes.aprovado_cents)} />
          </div>
        )}
      />
    </section>
  );
}

function Situacao({ c }: { c: ClienteFinanceiro }) {
  const atraso = textoAtraso(c.dias_em_atraso);
  return (
    <span className="flex flex-col items-start gap-1">
      <Badge tone={SITUACAO_TONE[c.situacao]}>{SITUACAO_LABEL[c.situacao]}</Badge>
      {c.pendencia && <Badge tone="crit">Com pendência</Badge>}
      {atraso && <span className="text-xs font-semibold text-dash-status-crit-text">{atraso}</span>}
    </span>
  );
}

function Ultimo({ c }: { c: ClienteFinanceiro }) {
  const u = c.ultimo_pagamento;
  if (!u) return <span className="text-dash-muted">Sem pagamentos</span>;
  return (
    <span className="flex flex-col items-start gap-1">
      <span>{formatDataCurta(u.data)} · {formatBRL(u.valor_cents)}</span>
      <Badge tone={pagamentoTone(u.status)}>{pagamentoLabel(u.status)}</Badge>
    </span>
  );
}

export default function FinanceiroPage() {
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [situacao, setSituacao] = useState('');
  const [soPendencia, setSoPendencia] = useState(false);
  const [data, setData] = useState<ClienteFinanceiro[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const ultima = useRef(0);

  const carregar = useCallback(() => {
    const id = ++ultima.current;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (buscaAplicada) qs.set('q', buscaAplicada);
    if (situacao) qs.set('situacao', situacao);
    if (soPendencia) qs.set('pendencia', 'true');
    const sufixo = qs.toString();
    atuacaoFetch<ClienteFinanceiro[]>(`/financeiro/clientes${sufixo ? `?${sufixo}` : ''}`)
      .then((d) => { if (id === ultima.current) setData(d); })
      .catch((e: Error) => { if (id === ultima.current) setError(e.message); })
      .finally(() => { if (id === ultima.current) setLoading(false); });
  }, [buscaAplicada, situacao, soPendencia]);

  useEffect(carregar, [carregar]);

  const filtrado = busca !== '' || situacao !== '' || soPendencia;
  function limpar() { setBusca(''); setBuscaAplicada(''); setSituacao(''); setSoPendencia(false); }

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader titulo="Financeiro" descricao="Situação das assinaturas e dos pagamentos da carteira Montese." />
      <p role="note" className="mb-6 rounded-md border border-dash-border-input bg-dash-card px-4 py-3 text-sm font-semibold text-dash-primary">
        Somente consulta. Esta tela não altera planos, valores nem pagamentos.
      </p>
      <Resumo />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
        <div>
          <label htmlFor="busca" className="mb-1 block text-sm font-medium text-dash-muted">Buscar</label>
          <input id="busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou fantasia" className={INPUT} />
        </div>
        <div>
          <label htmlFor="situacao" className="mb-1 block text-sm font-medium text-dash-muted">Situação</label>
          <select id="situacao" value={situacao} onChange={(e) => setSituacao(e.target.value)} className={INPUT}>
            <option value="">Todas</option>
            <option value="ativa">Ativa</option>
            <option value="trial">Em teste</option>
            <option value="pendente">Pendente</option>
            <option value="inativa">Inativa</option>
          </select>
        </div>
        <div className="flex items-center gap-3 pb-2">
          <input id="so-pendencia" type="checkbox" checked={soPendencia} onChange={(e) => setSoPendencia(e.target.checked)}
            className="h-4 w-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary" />
          <label htmlFor="so-pendencia" className="text-sm font-medium text-dash-primary">Só com pendência</label>
        </div>
      </div>
      {filtrado && (
        <div className="mb-4">
          <button type="button" onClick={limpar} className={BTN_SEC}>Limpar filtros</button>
        </div>
      )}
      <AsyncBody
        data={data}
        error={error}
        loading={loading}
        onRetry={carregar}
        skeletonClassName="h-48 w-full"
        render={(lista) =>
          lista.length === 0 ? (
            <p className="text-sm text-dash-muted">Nenhum cliente encontrado.</p>
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-[18px] bg-dash-card shadow-[0_4px_12px_rgba(15,23,42,0.08)] md:block">
                <table className="w-full table-fixed text-left text-sm">
                  <caption className="sr-only">Situação financeira dos clientes Montese</caption>
                  <thead className="text-xs uppercase text-dash-muted">
                    <tr>
                      <th scope="col" className="px-4 py-3">Empresa</th>
                      <th scope="col" className="px-4 py-3">Plano</th>
                      <th scope="col" className="px-4 py-3">Valor mensal</th>
                      <th scope="col" className="px-4 py-3">Situação</th>
                      <th scope="col" className="px-4 py-3">Último pagamento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((c) => (
                      <tr key={c.id} className="border-t border-dash-border-input align-top">
                        <td className="break-words px-4 py-3">
                          <Link href={`/atuacao/clientes/${c.id}`} className={LINK}>{c.name}</Link>
                          {c.trade_name && <div className="text-xs text-dash-muted">{c.trade_name}</div>}
                        </td>
                        <td className="break-words px-4 py-3">{c.plano ?? '—'}</td>
                        <td className="px-4 py-3">{formatBRL(c.valor_mensal_cents)}</td>
                        <td className="px-4 py-3"><Situacao c={c} /></td>
                        <td className="px-4 py-3"><Ultimo c={c} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="flex flex-col gap-3 md:hidden">
                {lista.map((c) => (
                  <li key={c.id} className="rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
                    <Link href={`/atuacao/clientes/${c.id}`} className={`${LINK} break-words`}>{c.name}</Link>
                    {c.trade_name && <p className="text-xs text-dash-muted">{c.trade_name}</p>}
                    <p className="mt-2 break-words text-sm">{c.plano ?? '—'}</p>
                    <p className="text-sm">{formatBRL(c.valor_mensal_cents)}</p>
                    <div className="mt-2 text-sm"><Situacao c={c} /></div>
                    <div className="mt-2 text-sm"><Ultimo c={c} /></div>
                  </li>
                ))}
              </ul>
            </>
          )
        }
      />
    </div>
  );
}
