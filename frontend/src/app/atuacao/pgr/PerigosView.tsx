'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  atuacaoFetch, MSG_403, MSG_PGR_BIBLIOTECA_VAZIA, MSG_PGR_ESCRITA, MSG_PGR_LEITURA, PERIGO_CATEGORIAS, PERIGO_CATEGORIA_LABEL, perigoCategoriaLabel,
  type ClienteResumo, type PerigoDetalhe, type PerigoResumo,
} from '../api';
import { PerigosForm, type PerigoPayload } from './PerigosForm';

const INPUT =
  'w-full rounded-md border border-dash-border-input bg-white px-3 py-2 text-sm text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary';
const LABEL = 'mb-1 block text-sm font-medium text-dash-muted';
const BTN =
  'rounded-md border border-dash-border-input px-3 py-1.5 text-sm font-semibold text-dash-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary disabled:cursor-not-allowed disabled:opacity-50';
const LINK =
  'font-semibold text-dash-primary underline focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary focus-visible:ring-offset-2 rounded';
const POR_PAGINA = 10;
const NI = 'não informado';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FormState = { inicial: PerigoDetalhe | null; somenteLeitura: boolean } | null;

export function PerigosView() {
  const params = useSearchParams();
  const [tenantId, setTenantId] = useState(() => {
    const v = params.get('tenantId') ?? '';
    return UUID.test(v) ? v : '';
  });
  const [clientes, setClientes] = useState<ClienteResumo[]>([]);
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [categoria, setCategoria] = useState('');
  const [ativo, setAtivo] = useState('');
  const [escopo, setEscopo] = useState('');
  const [pagina, setPagina] = useState(0);
  const [lista, setLista] = useState<PerigoResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [form, setForm] = useState<FormState>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const origem = useRef<HTMLElement | null>(null);
  const seq = useRef(0);
  const seqDetalhe = useRef(0);

  // Lista de empresas só ajuda a escolher o escopo; se faltar permissão, a biblioteca segue funcionando.
  useEffect(() => {
    let vivo = true;
    atuacaoFetch<ClienteResumo[]>('/clientes').then((d) => { if (vivo) setClientes(d); }).catch(() => { /* sem lista de empresas */ });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(() => {
    const id = ++seq.current;
    setCarregando(true);
    setErro(null);
    const qs = new URLSearchParams();
    if (buscaAplicada) qs.set('q', buscaAplicada);
    if (categoria) qs.set('categoria', categoria);
    if (ativo) qs.set('ativo', ativo);
    if (tenantId) qs.set('tenantId', tenantId);
    const s = qs.toString();
    atuacaoFetch<PerigoResumo[]>(`/pgr/perigos${s ? `?${s}` : ''}`)
      .then((d) => { if (id === seq.current) { setLista(d); setPagina(0); } })
      .catch((e: Error) => {
        if (id !== seq.current) return;
        setLista(null);
        setErro(e.message === MSG_403 ? MSG_PGR_LEITURA : e.message);
      })
      .finally(() => { if (id === seq.current) setCarregando(false); });
  }, [buscaAplicada, categoria, ativo, tenantId]);

  useEffect(carregar, [carregar]);

  const nomeEmpresa = (id: string | null) => clientes.find((c) => c.id === id)?.name ?? null;
  const podeCriar = Boolean(tenantId);

  const visiveis = (lista ?? []).filter((p) => !escopo || p.scope === escopo);
  const totalPaginas = Math.max(1, Math.ceil(visiveis.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const pagItens = visiveis.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA);

  function fecharForm() {
    setForm(null);
    const el = origem.current;
    origem.current = null;
    if (el) setTimeout(() => { if (el.isConnected) el.focus(); }, 0);
  }

  function limparAvisos() { setSucesso(null); setErroAcao(null); }

  function abrir(p: PerigoResumo, somenteLeitura: boolean, el: HTMLElement) {
    origem.current = el;
    limparAvisos();
    setErroForm(null);
    const id = ++seqDetalhe.current;
    setOcupado(p.id);
    atuacaoFetch<PerigoDetalhe>(`/pgr/perigos/${p.id}${p.tenant_id ? `?tenantId=${encodeURIComponent(p.tenant_id)}` : ''}`)
      .then((d) => { if (id === seqDetalhe.current) setForm({ inicial: d, somenteLeitura }); })
      .catch((e: Error) => { if (id === seqDetalhe.current) setErroAcao(e.message === MSG_403 ? MSG_PGR_LEITURA : e.message); })
      .finally(() => { if (id === seqDetalhe.current) setOcupado(null); });
  }

  function salvar(payload: PerigoPayload) {
    limparAvisos();
    setErroForm(null);
    setSalvando(true);
    const inicial = form?.inicial ?? null;
    if (!inicial && !tenantId) { setErroForm('Selecione uma empresa para criar um perigo personalizado.'); setSalvando(false); return; }
    const req = inicial
      ? atuacaoFetch<PerigoDetalhe>(`/pgr/perigos/${inicial.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : atuacaoFetch<PerigoDetalhe>('/pgr/perigos', {
        method: 'POST',
        body: JSON.stringify({ ...payload, tenant_id: tenantId }),
      });
    req
      .then(() => { fecharForm(); setSucesso(inicial ? 'Perigo atualizado.' : 'Perigo criado.'); carregar(); })
      .catch((e: Error) => setErroForm(e.message === MSG_403 ? MSG_PGR_ESCRITA : e.message))
      .finally(() => setSalvando(false));
  }

  function acao(p: PerigoResumo, req: Promise<unknown>, ok: string) {
    limparAvisos();
    setOcupado(p.id);
    req
      .then(() => { setSucesso(ok); carregar(); })
      .catch((e: Error) => setErroAcao(e.message === MSG_403 ? MSG_PGR_ESCRITA : e.message))
      .finally(() => setOcupado(null));
  }

  function duplicar(p: PerigoResumo) {
    const alvo = p.tenant_id ?? tenantId;
    acao(
      p,
      atuacaoFetch(`/pgr/perigos/${p.id}/duplicar`, { method: 'POST', body: JSON.stringify(alvo ? { tenant_id: alvo } : {}) }),
      `Perigo duplicado: ${p.name}.`,
    );
  }

  function alternar(p: PerigoResumo) {
    acao(
      p,
      atuacaoFetch(`/pgr/perigos/${p.id}/ativo`, { method: 'PATCH', body: JSON.stringify({ active: !p.active }) }),
      p.active ? 'Perigo inativado.' : 'Perigo reativado.',
    );
  }

  const bloqueado = ocupado !== null;

  return (
    <div className="px-4 py-8 sm:px-6">
      <PageHeader
        titulo="Biblioteca de perigos"
        descricao="Perigos globais são somente leitura; os personalizados pertencem a uma empresa."
      />
      <p className="mb-4 text-sm"><Link href="/atuacao/pgr" className={LINK}>Voltar ao PGR</Link></p>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor="pg-busca" className={LABEL}>Buscar perigo</label>
          <input id="pg-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do perigo" className={INPUT} />
        </div>
        <div>
          <label htmlFor="pg-categoria" className={LABEL}>Categoria</label>
          <select id="pg-categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} className={INPUT}>
            <option value="">Todas</option>
            {PERIGO_CATEGORIAS.map((c) => <option key={c} value={c}>{PERIGO_CATEGORIA_LABEL[c]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pg-ativo" className={LABEL}>Situação</label>
          <select id="pg-ativo" value={ativo} onChange={(e) => setAtivo(e.target.value)} className={INPUT}>
            <option value="">Todos</option>
            <option value="true">Ativos</option>
            <option value="false">Inativos</option>
          </select>
        </div>
        <div>
          <label htmlFor="pg-escopo" className={LABEL}>Escopo</label>
          <select id="pg-escopo" value={escopo} onChange={(e) => { setEscopo(e.target.value); setPagina(0); }} className={INPUT}>
            <option value="">Todos</option>
            <option value="global">Global</option>
            <option value="tenant">Da empresa</option>
          </select>
        </div>
        <div>
          <label htmlFor="pg-empresa" className={LABEL}>Empresa</label>
          <select id="pg-empresa" value={tenantId} onChange={(e) => { setTenantId(e.target.value); setForm(null); }} className={INPUT}>
            <option value="">Nenhuma (só perigos globais)</option>
            {tenantId && !clientes.some((c) => c.id === tenantId) && <option value={tenantId}>Empresa informada</option>}
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            disabled={!podeCriar || bloqueado || salvando}
            aria-describedby={podeCriar ? undefined : 'pg-dica'}
            onClick={(e) => { origem.current = e.currentTarget; limparAvisos(); setErroForm(null); setForm({ inicial: null, somenteLeitura: false }); }}
            className={`${BTN} bg-dash-primary text-white`}
          >
            Novo perigo
          </button>
        </div>
      </div>
      {!podeCriar && (
        <p id="pg-dica" className="mb-4 text-sm text-dash-muted">Selecione uma empresa para criar ou duplicar perigos personalizados.</p>
      )}

      {sucesso && <p role="status" className="mb-3 text-sm font-semibold text-dash-status-ok-text">{sucesso}</p>}
      {erroAcao && <p role="alert" className="mb-3 text-sm text-dash-status-crit-text">{erroAcao}</p>}

      {form && (
        <PerigosForm
          key={form.inicial?.id ?? 'novo'}
          inicial={form.inicial}
          somenteLeitura={form.somenteLeitura}
          salvando={salvando}
          erro={erroForm}
          onSalvar={salvar}
          onCancelar={fecharForm}
        />
      )}

      {carregando && lista === null && !erro && <Skeleton className="h-48 w-full" />}
      {erro && (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-dash-status-crit-text">
          <span>{erro}</span>
          <button type="button" onClick={carregar} className="rounded border border-dash-border-input px-2 py-1 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-dash-primary">Tentar novamente</button>
        </div>
      )}
      {lista !== null && !erro && (
        lista.length === 0 ? (
          <p className="text-sm text-dash-muted">
            {buscaAplicada || categoria || ativo
              ? 'Nenhum perigo encontrado com estes filtros.'
              : MSG_PGR_BIBLIOTECA_VAZIA}
          </p>
        ) : visiveis.length === 0 ? (
          <p className="text-sm text-dash-muted">Nenhum perigo encontrado com estes filtros.</p>
        ) : (
          <div aria-busy={carregando}>
            <ul className="grid gap-3">
              {pagItens.map((p) => {
                const global = p.scope === 'global';
                const editavel = !global;
                const alvoDuplicar = p.tenant_id ?? tenantId;
                const empresa = nomeEmpresa(p.tenant_id);
                return (
                  <li key={p.id} className="rounded-[18px] bg-dash-card p-4 shadow-[0_4px_12px_rgba(15,23,42,0.08)]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-words font-semibold text-dash-primary">{p.name}</span>
                      <Badge tone="info">{perigoCategoriaLabel(p.category)}</Badge>
                      <Badge tone={global ? 'epi' : 'ok'}>{global ? 'Global' : 'Da empresa'}</Badge>
                      {!p.active && <Badge tone="high">Inativo</Badge>}
                    </div>
                    {!global && <p className="mt-1 text-xs text-dash-muted">Empresa: {empresa ?? NI}</p>}
                    <p className="mt-2 break-words text-sm">{p.description?.trim() ? p.description : `Descrição: ${NI}`}</p>
                    <p className="mt-1 text-xs text-dash-muted">Código eSocial: {p.esocial_code?.trim() ? p.esocial_code : NI}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button" disabled={bloqueado} className={BTN}
                        aria-label={`${editavel ? 'Editar' : 'Ver detalhes de'} ${p.name}`}
                        onClick={(e) => abrir(p, !editavel, e.currentTarget)}
                      >
                        {editavel ? 'Editar' : 'Ver detalhes'}
                      </button>
                      <button
                        type="button" className={BTN} aria-label={`Duplicar ${p.name}`}
                        disabled={bloqueado || !alvoDuplicar} onClick={() => duplicar(p)}
                      >
                        Duplicar
                      </button>
                      {editavel && (
                        <button
                          type="button" className={BTN} disabled={bloqueado}
                          aria-label={`${p.active ? 'Inativar' : 'Reativar'} ${p.name}`} onClick={() => alternar(p)}
                        >
                          {p.active ? 'Inativar' : 'Reativar'}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <nav aria-label="Paginação" className="mt-4 flex items-center gap-3 text-sm">
              <button type="button" className={BTN} disabled={paginaAtual === 0} onClick={() => setPagina(paginaAtual - 1)}>Anterior</button>
              <span>Página {paginaAtual + 1} de {totalPaginas}</span>
              <button type="button" className={BTN} disabled={paginaAtual >= totalPaginas - 1} onClick={() => setPagina(paginaAtual + 1)}>Próxima</button>
            </nav>
          </div>
        )
      )}
    </div>
  );
}
