'use client';

import { FormEvent, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card } from '@/components/ui/Card';
import { AsyncBody } from '@/components/ui/AsyncBody';
import { Badge } from '@/components/ui/Badge';
import {
  atuacaoFetch, DOC_CATEGORIAS, DOC_STATUS, docCategoriaLabel, docStatusLabel, docStatusTone, formatDataHora,
  type ClienteFicha, type ClienteResumo, type DocumentoResumo,
} from '../api';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const LINK =
  'font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 rounded';
const BTN =
  'rounded-md bg-dash-primary px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 disabled:opacity-60';
const BTN_SEC =
  'rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:opacity-60';
const LABEL = 'mb-1 block text-sm font-medium text-dash-muted';

function NovoRascunho({ clientes, tenantInicial, onFechar }: { clientes: ClienteResumo[]; tenantInicial: string; onFechar: () => void }) {
  const router = useRouter();
  const [tenantId, setTenantId] = useState(tenantInicial);
  const [unidades, setUnidades] = useState<ClienteFicha['units']>([]);
  const [unidadeId, setUnidadeId] = useState('');
  const [categoria, setCategoria] = useState('');
  const [titulo, setTitulo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ultimaFicha = useRef(0);

  // Unidades do cliente escolhido (opcional); falha aqui não impede criar sem unidade.
  useEffect(() => {
    const id = ++ultimaFicha.current;
    setUnidadeId('');
    setUnidades([]);
    if (!tenantId) return;
    atuacaoFetch<ClienteFicha>(`/clientes/${tenantId}`)
      .then((f) => { if (id === ultimaFicha.current) setUnidades(Array.isArray(f.units) ? f.units : []); })
      .catch(() => { /* unidade é opcional */ });
  }, [tenantId]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !categoria || !titulo.trim()) {
      setErro('Informe cliente, categoria e título.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      const body: Record<string, string> = { tenant_id: tenantId, category: categoria, title: titulo.trim() };
      if (unidadeId) body.company_unit_id = unidadeId;
      const criado = await atuacaoFetch<{ id: string }>('/documentos', { method: 'POST', body: JSON.stringify(body) });
      router.push(`/atuacao/documentos/${criado.id}`);
    } catch (err) {
      setErro((err as Error).message);
      setEnviando(false);
    }
  }

  return (
    <Card title="Novo rascunho">
      <form onSubmit={enviar} aria-label="Novo rascunho" className="grid gap-3 sm:grid-cols-2" noValidate>
        <div>
          <label htmlFor="nd-cliente" className={LABEL}>Cliente</label>
          <select id="nd-cliente" value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={INPUT}>
            <option value="">Selecione</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="nd-unidade" className={LABEL}>Unidade (opcional)</label>
          <select id="nd-unidade" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} disabled={unidades.length === 0} className={INPUT}>
            <option value="">Sem unidade específica</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="nd-categoria" className={LABEL}>Categoria</label>
          <select id="nd-categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} className={INPUT}>
            <option value="">Selecione</option>
            {DOC_CATEGORIAS.map((c) => <option key={c} value={c}>{docCategoriaLabel(c)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="nd-titulo" className={LABEL}>Título</label>
          <input id="nd-titulo" type="text" maxLength={200} value={titulo} onChange={(e) => setTitulo(e.target.value)} className={INPUT} />
        </div>
        {erro && <p role="alert" className="text-sm text-dash-status-crit-text sm:col-span-2">{erro}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <button type="submit" disabled={enviando} className={BTN}>{enviando ? 'Criando...' : 'Criar rascunho'}</button>
          <button type="button" onClick={onFechar} className={BTN_SEC}>Fechar</button>
        </div>
      </form>
    </Card>
  );
}

function Estado({ d }: { d: DocumentoResumo }) {
  return <Badge tone={docStatusTone(d.status)}>{docStatusLabel(d.status)}</Badge>;
}
const versao = (d: DocumentoResumo) => (d.versao_atual ? `Versão ${d.versao_atual}` : 'Sem versão');

function DocumentosConteudo() {
  const params = useSearchParams();
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [erroClientes, setErroClientes] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [categoria, setCategoria] = useState('');
  const [tenantId, setTenantId] = useState(params.get('tenantId') ?? '');
  const [data, setData] = useState<DocumentoResumo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    atuacaoFetch<ClienteResumo[]>('/clientes').then(setClientes).catch((e: Error) => setErroClientes(e.message));
  }, []);

  const ultima = useRef(0);

  const carregar = useCallback(() => {
    const id = ++ultima.current;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (categoria) qs.set('category', categoria);
    if (tenantId) qs.set('tenantId', tenantId);
    const sufixo = qs.toString();
    atuacaoFetch<DocumentoResumo[]>(`/documentos${sufixo ? `?${sufixo}` : ''}`)
      .then((d) => { if (id === ultima.current) setData(d); })
      .catch((e: Error) => { if (id === ultima.current) setError(e.message); })
      .finally(() => { if (id === ultima.current) setLoading(false); });
  }, [status, categoria, tenantId]);

  useEffect(carregar, [carregar]);

  const filtrado = status !== '' || categoria !== '' || tenantId !== '';
  function limpar() { setStatus(''); setCategoria(''); setTenantId(''); }

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader titulo="Documentos" descricao="Rascunhos e documentos em andamento dos clientes Montese." />
      <div className="mb-4 grid gap-3 sm:grid-cols-[200px_200px_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="f-estado" className={LABEL}>Estado</label>
          <select id="f-estado" value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT}>
            <option value="">Todos</option>
            {DOC_STATUS.map((s) => <option key={s} value={s}>{docStatusLabel(s)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-categoria" className={LABEL}>Categoria</label>
          <select id="f-categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} className={INPUT}>
            <option value="">Todas</option>
            {DOC_CATEGORIAS.map((c) => <option key={c} value={c}>{docCategoriaLabel(c)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-cliente" className={LABEL}>Cliente</label>
          <select id="f-cliente" value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={INPUT}>
            <option value="">Todos</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {filtrado && <button type="button" onClick={limpar} className={BTN_SEC}>Limpar filtros</button>}
      </div>
      {erroClientes && <p role="alert" className="mb-4 text-sm text-dash-status-crit-text">{erroClientes}</p>}
      {!criando && (
        <div className="mb-4">
          <button type="button" onClick={() => setCriando(true)} className={BTN}>Novo rascunho</button>
        </div>
      )}
      {criando && (
        <div className="mb-6">
          <NovoRascunho clientes={clientes} tenantInicial={tenantId} onFechar={() => setCriando(false)} />
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
            <p className="text-sm text-dash-muted">
              {filtrado ? 'Nenhum documento encontrado com estes filtros.' : 'Nenhum documento em elaboração.'}
            </p>
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-[18px] bg-dash-card shadow-[0_4px_12px_rgba(15,23,42,0.08)] md:block">
                <table className="w-full table-fixed text-left text-sm">
                  <caption className="sr-only">Documentos dos clientes Montese</caption>
                  <thead className="text-xs uppercase text-dash-muted">
                    <tr>
                      <th scope="col" className="px-4 py-3">Título</th>
                      <th scope="col" className="px-4 py-3">Cliente</th>
                      <th scope="col" className="px-4 py-3">Categoria</th>
                      <th scope="col" className="px-4 py-3">Estado</th>
                      <th scope="col" className="px-4 py-3">Versão</th>
                      <th scope="col" className="px-4 py-3">Atualizado em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((d) => (
                      <tr key={d.id} className="border-t border-dash-border-input align-top">
                        <td className="break-words px-4 py-3"><Link href={`/atuacao/documentos/${d.id}`} className={LINK}>{d.title}</Link></td>
                        <td className="break-words px-4 py-3">{d.tenant_name}</td>
                        <td className="break-words px-4 py-3">{docCategoriaLabel(d.category)}</td>
                        <td className="px-4 py-3"><Estado d={d} /></td>
                        <td className="px-4 py-3">{versao(d)}</td>
                        <td className="px-4 py-3">{formatDataHora(d.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="flex flex-col gap-3 md:hidden">
                {lista.map((d) => (
                  <li key={d.id} className="rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link href={`/atuacao/documentos/${d.id}`} className={`${LINK} break-words`}>{d.title}</Link>
                      <Estado d={d} />
                    </div>
                    <p className="mt-1 break-words text-sm text-dash-muted">{d.tenant_name} · {docCategoriaLabel(d.category)}</p>
                    <p className="mt-1 text-sm">{versao(d)} · atualizado em {formatDataHora(d.updated_at)}</p>
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

export default function DocumentosPage() {
  // useSearchParams exige Suspense no build do Next.
  return (
    <Suspense fallback={null}>
      <DocumentosConteudo />
    </Suspense>
  );
}
