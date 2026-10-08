'use client';

import { FormEvent, useRef, useState } from 'react';
import { Badge, Card } from '@/components/admin/Card';
import type { Tone } from '@/components/admin/Card';
import { authHeaders } from './api';

export interface OfficialSource {
  id: string;
  entity: string;
  code: string | null;
  title: string;
  official_url: string;
  active: boolean;
  last_checked_at: string | null;
  last_check_status: 'ok' | 'erro' | null;
  last_error: string | null;
  consecutive_failures: number;
}

interface Preview {
  ok: boolean;
  message?: string;
  status_code?: number;
  mime_type?: string;
  chars?: number;
  meaningful_chars?: number;
  sample?: string;
  suspicious?: string | null;
  duplicate_of?: { id: string; title: string; code: string | null } | null;
}

interface Rascunho {
  entity: string;
  code: string;
  title: string;
  official_url: string;
}

function formatChecked(iso: string | null): string {
  if (!iso) return 'nunca verificada';
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'verificada há menos de 1 h';
  if (hours < 48) return `verificada há ${hours} h`;
  return `verificada há ${Math.floor(hours / 24)} dias`;
}

function estadoDaFonte(s: OfficialSource): { tom: Tone; texto: string } {
  if (!s.active) return { tom: 'neutral', texto: 'Inativa' };
  if (s.consecutive_failures > 0) {
    return { tom: 'bad', texto: `Falhando (${s.consecutive_failures})` };
  }
  if (!s.last_checked_at) return { tom: 'neutral', texto: 'Nunca verificada' };
  return { tom: 'ok', texto: 'ok' };
}

const temProblema = (s: OfficialSource) => !s.active || s.consecutive_failures > 0;

function hostDe(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function mensagemDaApi(body: { message?: unknown } | null, padrao: string): string {
  const m = body?.message;
  if (Array.isArray(m)) return m.join('; ');
  return typeof m === 'string' && m ? m : padrao;
}

const ERRO_MAX = 120;
const truncar = (t: string) => (t.length > ERRO_MAX ? `${t.slice(0, ERRO_MAX - 1)}…` : t);

function PreviewResultado({ preview, editandoId }: { preview: Preview; editandoId?: string | null }) {
  if (!preview.ok) {
    return (
      <p role="alert" className="text-sm text-red-600">
        Não foi possível ler a URL: {preview.message}
      </p>
    );
  }
  return (
    <div className="adm-card-2 flex flex-col gap-2 p-3 text-sm">
      <p className="text-brand-900">
        Leitura OK · HTTP {preview.status_code} · {preview.mime_type} · {preview.chars} caracteres ({preview.meaningful_chars} de texto)
      </p>
      {preview.suspicious && <p className="text-red-600">{preview.suspicious}</p>}
      {preview.duplicate_of && preview.duplicate_of.id !== editandoId && (
        <p className="text-adm-status-warn-text">
          Atenção: já existe a fonte “{preview.duplicate_of.code ? `${preview.duplicate_of.code} — ` : ''}
          {preview.duplicate_of.title}” com esta URL.
        </p>
      )}
      <p className="break-words text-xs text-brand-700">{preview.sample}</p>
    </div>
  );
}

export function FontesPanel({ sources, onChanged }: { sources: OfficialSource[]; onChanged: () => void | Promise<void> }) {
  const [soProblema, setSoProblema] = useState(false);
  const [mensagens, setMensagens] = useState<Record<string, string>>({});
  const [ocupada, setOcupada] = useState<string | null>(null);

  const [novo, setNovo] = useState<Rascunho>({ entity: '', code: '', title: '', official_url: '' });
  const [createStatus, setCreateStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [createErro, setCreateErro] = useState('');
  const [previewNovo, setPreviewNovo] = useState<Preview | null>(null);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>({ entity: '', code: '', title: '', official_url: '' });
  const [editErro, setEditErro] = useState('');
  const [previewEdicao, setPreviewEdicao] = useState<Preview | null>(null);

  const comProblema = sources.filter(temProblema).length;
  const visiveis = soProblema ? sources.filter(temProblema) : sources;

  const seq = useRef({ novo: 0, edicao: 0 });

  // Invalida leituras em andamento do alvo (resposta antiga é descartada).
  function invalidar(alvo: 'novo' | 'edicao') {
    seq.current[alvo] += 1;
    if (alvo === 'novo') setPreviewNovo(null);
    else setPreviewEdicao(null);
  }

  async function testarUrl(url: string, alvo: 'novo' | 'edicao') {
    const definir = alvo === 'novo' ? setPreviewNovo : setPreviewEdicao;
    const minha = ++seq.current[alvo];
    const aplicar = (p: Preview) => {
      if (seq.current[alvo] === minha) definir(p);
    };
    try {
      const res = await fetch('/api/normative-sources/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ official_url: url }),
      });
      const body = await res.json().catch(() => null);
      aplicar(res.ok ? body : { ok: false, message: mensagemDaApi(body, 'Não foi possível testar a URL.') });
    } catch {
      aplicar({ ok: false, message: 'Não foi possível conectar ao servidor.' });
    }
  }

  // A gravação já deu certo: falha ao recarregar a lista não pode virar mensagem de falha da gravação.
  async function recarregar() {
    try {
      await onChanged();
    } catch {
      // lista desatualizada até a próxima carga; nada a informar sobre a gravação
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateStatus('loading');
    setCreateErro('');
    try {
      const res = await fetch('/api/normative-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          entity: novo.entity,
          code: novo.code || undefined,
          title: novo.title,
          official_url: novo.official_url,
        }),
      });
      if (res.ok) {
        setNovo({ entity: '', code: '', title: '', official_url: '' });
        invalidar('novo');
        setCreateStatus('idle');
        await recarregar();
        return;
      }
      const body = await res.json().catch(() => null);
      setCreateErro(mensagemDaApi(body, 'Confira a URL.'));
      setCreateStatus('erro');
    } catch {
      setCreateErro('Não foi possível conectar ao servidor.');
      setCreateStatus('erro');
    }
  }

  function abrirEdicao(s: OfficialSource) {
    setEditandoId(s.id);
    setRascunho({ entity: s.entity, code: s.code ?? '', title: s.title, official_url: s.official_url });
    setEditErro('');
    invalidar('edicao');
  }

  async function salvarEdicao(event: FormEvent) {
    event.preventDefault();
    if (!editandoId) return;
    const id = editandoId;
    setOcupada(id);
    setEditErro('');
    try {
      const res = await fetch(`/api/normative-sources/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(rascunho),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setEditErro(mensagemDaApi(body, 'Não foi possível salvar a edição.'));
        return;
      }
      setEditandoId(null);
      invalidar('edicao');
    } catch {
      setEditErro('Não foi possível conectar ao servidor.');
      return;
    } finally {
      setOcupada(null);
    }
    await recarregar();
  }

  async function alternarAtiva(s: OfficialSource) {
    setOcupada(s.id);
    try {
      const res = await fetch(`/api/normative-sources/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ active: !s.active }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setMensagens((m) => ({ ...m, [s.id]: mensagemDaApi(body, 'Não foi possível alterar a fonte.') }));
        return;
      }
      setMensagens((m) => ({ ...m, [s.id]: '' }));
    } catch {
      setMensagens((m) => ({ ...m, [s.id]: 'Não foi possível conectar ao servidor.' }));
      return;
    } finally {
      setOcupada(null);
    }
    await recarregar();
  }

  async function verificarAgora(s: OfficialSource) {
    setOcupada(s.id);
    setMensagens((m) => ({ ...m, [s.id]: 'Verificando…' }));
    try {
      const res = await fetch(`/api/normative-sources/${s.id}/check-now`, { method: 'POST', headers: authHeaders() });
      const body = await res.json().catch(() => null);
      const texto = !res.ok
        ? mensagemDaApi(body, 'Não foi possível verificar a fonte.')
        : body?.outcome === 'erro'
          ? `Falhou: ${body.message}`
          : body?.message || 'Verificação concluída.';
      setMensagens((m) => ({ ...m, [s.id]: texto }));
    } catch {
      setMensagens((m) => ({ ...m, [s.id]: 'Não foi possível conectar ao servidor.' }));
    }
    setOcupada(null);
    await recarregar();
  }

  const rotulo = (s: OfficialSource) => `${s.code ?? s.title} (${hostDe(s.official_url)})`;

  return (
    <Card title="Fontes monitoradas" className="mt-8">
      <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input placeholder="Entidade (ex: MTE)" aria-label="Entidade (ex: MTE)" value={novo.entity} onChange={(e) => setNovo({ ...novo, entity: e.target.value })} required className="adm-input" />
        <input placeholder="Código (ex: NR-06)" aria-label="Código (ex: NR-06)" value={novo.code} onChange={(e) => setNovo({ ...novo, code: e.target.value })} className="adm-input" />
        <input placeholder="Título" aria-label="Título" value={novo.title} onChange={(e) => setNovo({ ...novo, title: e.target.value })} required className="adm-input sm:col-span-2" />
        <input placeholder="URL oficial" aria-label="URL oficial" value={novo.official_url} onChange={(e) => { setNovo({ ...novo, official_url: e.target.value }); invalidar('novo'); }} required className="adm-input sm:col-span-2" />
        {createStatus === 'erro' && (
          <p role="alert" className="text-sm text-red-600 sm:col-span-2">Não foi possível cadastrar. {createErro}</p>
        )}
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <button type="submit" disabled={createStatus === 'loading'} className="adm-btn adm-btn-primary self-start disabled:opacity-50">
            Cadastrar fonte
          </button>
          <button
            type="button"
            disabled={!novo.official_url}
            onClick={() => testarUrl(novo.official_url, 'novo')}
            className="adm-btn self-start disabled:opacity-50"
          >
            Testar URL
          </button>
        </div>
        <div role="status" className="sm:col-span-2">
          {previewNovo && <PreviewResultado preview={previewNovo} />}
        </div>
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-brand-700">
        <span>
          {sources.length} fontes · {comProblema} com problema
        </span>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={soProblema} onChange={(e) => setSoProblema(e.target.checked)} />
          Mostrar só fontes com problema ({comProblema})
        </label>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="adm-table">
          <thead>
            <tr>
              <th scope="col">Fonte</th>
              <th scope="col">Estado</th>
              <th scope="col">Verificação</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((s) => {
              const estado = estadoDaFonte(s);
              return [
                <tr key={s.id}>
                  <td className="min-w-0 break-words text-brand-900">
                    <div className="font-medium">
                      {s.entity}
                      {s.code ? ` — ${s.code}` : ''}
                    </div>
                    <div className="text-brand-700">{s.title}</div>
                    <a href={s.official_url} target="_blank" rel="noopener noreferrer" className="adm-link break-all text-xs">
                      {hostDe(s.official_url)}
                    </a>
                  </td>
                  <td>
                    <Badge tone={estado.tom}>{estado.texto}</Badge>
                    {estado.tom === 'bad' && s.last_error && (
                      <p title={s.last_error} className="mt-1 max-w-[16rem] break-words text-left text-xs leading-snug text-brand-700">
                        {truncar(s.last_error)}
                      </p>
                    )}
                  </td>
                  <td className="text-xs text-brand-700">{formatChecked(s.last_checked_at)}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" disabled={ocupada === s.id} onClick={() => verificarAgora(s)} aria-label={`Verificar agora — ${rotulo(s)}`} className="adm-link shrink-0 whitespace-nowrap disabled:opacity-50">
                        Verificar agora
                      </button>
                      <button type="button" onClick={() => abrirEdicao(s)} aria-label={`Editar — ${rotulo(s)}`} className="adm-link shrink-0 whitespace-nowrap">
                        Editar
                      </button>
                      <button type="button" disabled={ocupada === s.id} onClick={() => alternarAtiva(s)} aria-label={`${s.active ? 'Desativar' : 'Reativar'} — ${rotulo(s)}`} className="adm-link shrink-0 whitespace-nowrap disabled:opacity-50">
                        {s.active ? 'Desativar' : 'Reativar'}
                      </button>
                    </div>
                    {mensagens[s.id] && (
                      <p role="status" className="mt-1 text-xs text-brand-700">
                        {mensagens[s.id]}
                      </p>
                    )}
                  </td>
                </tr>,
                editandoId === s.id && (
                  <tr key={`${s.id}-edicao`}>
                    <td colSpan={4}>
                      <form onSubmit={salvarEdicao} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <input aria-label="Entidade (edição)" value={rascunho.entity} onChange={(e) => setRascunho({ ...rascunho, entity: e.target.value })} required className="adm-input" />
                        <input aria-label="Código (edição)" value={rascunho.code} onChange={(e) => setRascunho({ ...rascunho, code: e.target.value })} className="adm-input" />
                        <input aria-label="Título (edição)" value={rascunho.title} onChange={(e) => setRascunho({ ...rascunho, title: e.target.value })} required className="adm-input sm:col-span-2" />
                        <input aria-label="URL oficial (edição)" value={rascunho.official_url} onChange={(e) => { setRascunho({ ...rascunho, official_url: e.target.value }); invalidar('edicao'); }} required className="adm-input sm:col-span-2" />
                        {editErro && <p role="alert" className="text-sm text-red-600 sm:col-span-2">{editErro}</p>}
                        <div className="flex flex-wrap gap-3 sm:col-span-2">
                          <button type="submit" disabled={ocupada === s.id} className="adm-btn adm-btn-primary self-start disabled:opacity-50">
                            Salvar edição
                          </button>
                          <button type="button" disabled={!rascunho.official_url} onClick={() => testarUrl(rascunho.official_url, 'edicao')} className="adm-btn self-start disabled:opacity-50">
                            Testar URL (edição)
                          </button>
                          <button type="button" onClick={() => { setEditandoId(null); invalidar('edicao'); }} className="adm-btn self-start">
                            Cancelar
                          </button>
                        </div>
                        <div role="status" className="sm:col-span-2">
                          {previewEdicao && <PreviewResultado preview={previewEdicao} editandoId={editandoId} />}
                        </div>
                      </form>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
