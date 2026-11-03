'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import { atuacaoFetch, formatCnpj, SITUACAO_LABEL, SITUACAO_TONE, type ClienteResumo } from '../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const LINK =
  'font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 rounded';

export default function ClientesPage() {
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [situacao, setSituacao] = useState('');
  const [data, setData] = useState<ClienteResumo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Pequena espera para não consultar a cada tecla.
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
    const sufixo = qs.toString();
    atuacaoFetch<ClienteResumo[]>(`/clientes${sufixo ? `?${sufixo}` : ''}`)
      .then((d) => { if (id === ultima.current) setData(d); })
      .catch((e: Error) => { if (id === ultima.current) setError(e.message); })
      .finally(() => { if (id === ultima.current) setLoading(false); });
  }, [buscaAplicada, situacao]);

  useEffect(carregar, [carregar]);

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader titulo="Clientes Montese" descricao="Empresas da carteira. Abra uma para ver a ficha e atualizar o contato." />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px]">
        <div>
          <label htmlFor="busca" className="mb-1 block text-sm font-medium text-dash-muted">Buscar</label>
          <input
            id="busca"
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome, fantasia ou CNPJ"
            className={INPUT}
          />
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
      </div>
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
                  <caption className="sr-only">Clientes Montese</caption>
                  <thead className="text-xs uppercase text-dash-muted">
                    <tr>
                      <th scope="col" className="px-4 py-3">Empresa</th>
                      <th scope="col" className="px-4 py-3">CNPJ</th>
                      <th scope="col" className="px-4 py-3">Setor</th>
                      <th scope="col" className="px-4 py-3">Contato</th>
                      <th scope="col" className="px-4 py-3">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((c) => (
                      <tr key={c.id} className="border-t border-dash-border-input align-top">
                        <td className="break-words px-4 py-3">
                          <Link href={`/atuacao/clientes/${c.id}`} className={LINK}>{c.name}</Link>
                          {c.trade_name && <div className="text-xs text-dash-muted">{c.trade_name}</div>}
                        </td>
                        <td className="px-4 py-3">{formatCnpj(c.cnpj)}</td>
                        <td className="break-words px-4 py-3">{c.sector ?? '—'}</td>
                        <td className="break-words px-4 py-3">
                          {c.contact_name ?? '—'}
                          {c.contact_phone && <div className="text-xs text-dash-muted">{c.contact_phone}</div>}
                        </td>
                        <td className="px-4 py-3"><Badge tone={SITUACAO_TONE[c.situacao]}>{SITUACAO_LABEL[c.situacao]}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="flex flex-col gap-3 md:hidden">
                {lista.map((c) => (
                  <li key={c.id} className="rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/atuacao/clientes/${c.id}`} className={`${LINK} break-words`}>{c.name}</Link>
                      <Badge tone={SITUACAO_TONE[c.situacao]}>{SITUACAO_LABEL[c.situacao]}</Badge>
                    </div>
                    {c.trade_name && <p className="text-xs text-dash-muted">{c.trade_name}</p>}
                    <p className="mt-2 text-sm">{formatCnpj(c.cnpj)}</p>
                    <p className="text-sm text-dash-muted">{c.sector ?? '—'}</p>
                    <p className="break-words text-sm">{c.contact_name ?? '—'}{c.contact_phone ? ` · ${c.contact_phone}` : ''}</p>
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
