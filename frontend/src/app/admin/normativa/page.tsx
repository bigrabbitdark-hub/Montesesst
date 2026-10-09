'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Card } from '@/components/admin/Card';
import { FontesPanel, type OfficialSource } from './FontesPanel';
import { DiffView, type DocumentDiff } from './DiffView';
import { authHeaders, mensagemDaApi } from './api';

interface NormativeDocument {
  id: string;
  source_id: string;
  status: string;
  file_name: string;
  detected_at: string;
  indexed_at: string | null;
  rejection_reason: string | null;
}

interface DocumentDetail {
  document: NormativeDocument & { raw_text: string };
  previous_text: string | null;
}

export default function AdminNormativaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [sources, setSources] = useState<OfficialSource[]>([]);
  const [pending, setPending] = useState<NormativeDocument[]>([]);
  const [vigentes, setVigentes] = useState<NormativeDocument[]>([]);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [diff, setDiff] = useState<DocumentDiff | null>(null);
  const [showSideBySide, setShowSideBySide] = useState(true);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [batchReason, setBatchReason] = useState('');
  const [batchError, setBatchError] = useState('');
  const [retirandoId, setRetirandoId] = useState<string | null>(null);
  const [retireReason, setRetireReason] = useState('');
  const [retireError, setRetireError] = useState('');
  const [enviandoLote, setEnviandoLote] = useState(false);
  const [retirando, setRetirando] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [okMsg, setOkMsg] = useState('');
  const detalheToken = useRef(0);
  const emVoo = useRef(false);
  const retireInput = useRef<HTMLInputElement | null>(null);

  async function loadAll() {
    const [sourcesRes, pendingRes, vigentesRes] = await Promise.all([
      fetch('/api/normative-sources', { headers: authHeaders() }),
      fetch('/api/normative-documents?status=aguardando_validacao', { headers: authHeaders() }),
      fetch('/api/normative-documents?status=vigente', { headers: authHeaders() }),
    ]);
    if (sourcesRes.ok) setSources(await sourcesRes.json());
    if (pendingRes.ok) setPending(await pendingRes.json());
    if (vigentesRes.ok) setVigentes(await vigentesRes.json());
  }

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // A gravação já deu certo: falha ao recarregar as listas não vira mensagem de erro da gravação.
  async function recarregar() {
    try {
      await loadAll();
    } catch {
      // listas desatualizadas até a próxima carga
    }
  }

  // O diff é auxiliar: qualquer falha dele cai no lado a lado e não bloqueia a revisão.
  async function fetchDiff(id: string): Promise<DocumentDiff | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(`/api/normative-documents/${id}/diff`, { headers: authHeaders(), signal: ctrl.signal });
      if (!res.ok) return null;
      const body = await res.json();
      if (!body || typeof body.has_previous !== 'boolean' || !Array.isArray(body.hunks) || !body.summary) return null;
      return body as DocumentDiff;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function openDetail(id: string) {
    const meu = ++detalheToken.current;
    let corpo: DocumentDetail;
    try {
      const res = await fetch(`/api/normative-documents/${id}`, { headers: authHeaders() });
      if (meu !== detalheToken.current) return;
      if (!res.ok) throw new Error('detalhe');
      corpo = await res.json();
    } catch {
      if (meu !== detalheToken.current) return;
      // O diff do detalhe anterior (se houver) fica obsoleto: descarta e não deixa o aviso preso.
      detalheToken.current++;
      setDiffLoading(false);
      setDiff(null);
      setActionError('Não foi possível abrir o documento.');
      return;
    }
    if (meu !== detalheToken.current) return;
    setActionError('');
    // O detalhe aparece já; o diff chega depois e nunca atrasa a revisão.
    setDetail(corpo);
    setDiff(null);
    setShowSideBySide(true);
    setDiffLoading(true);
    const d = await fetchDiff(id);
    if (meu !== detalheToken.current) return;
    setDiffLoading(false);
    setDiff(d);
    setShowSideBySide(!d?.has_previous);
  }

  function fecharDetalhe() {
    detalheToken.current++;
    setDetail(null);
    setDiff(null);
    setDiffLoading(false);
  }

  function alternarSelecao(id: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  const efetivos = pending.filter((d) => selecionados.has(d.id));
  const LIMITE_LOTE = 50;
  const excedeu = efetivos.length > LIMITE_LOTE;
  const todosSelecionados = pending.length > 0 && efetivos.length === pending.length;

  function alternarTodos() {
    setSelecionados(todosSelecionados ? new Set() : new Set(pending.map((d) => d.id)));
  }

  async function handleRejectBatch() {
    const ids = efetivos.map((d) => d.id);
    if (emVoo.current || ids.length === 0 || excedeu || !batchReason.trim()) return;
    setOkMsg('');
    if (!window.confirm(`Rejeitar ${ids.length} documentos? Esta ação não pode ser desfeita pela tela.`)) return;
    emVoo.current = true;
    setEnviandoLote(true);
    try {
      const res = await fetch('/api/normative-documents/reject-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ids, reason: batchReason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setBatchError(mensagemDaApi(body, 'Não foi possível rejeitar os documentos.'));
        return;
      }
    } catch {
      setBatchError('Não foi possível conectar ao servidor.');
      return;
    } finally {
      emVoo.current = false;
      setEnviandoLote(false);
    }
    setBatchError('');
    setSelecionados(new Set());
    setBatchReason('');
    setOkMsg(`${ids.length} documento(s) rejeitado(s).`);
    await recarregar();
  }

  async function handleRetire(id: string) {
    if (emVoo.current || !retireReason.trim()) return;
    setOkMsg('');
    const nome = vigentes.find((d) => d.id === id)?.file_name ?? 'este documento';
    if (!window.confirm(`Retirar ${nome} do Assistente? O documento deixa de ser usado nas respostas. A fonte fica sem versão vigente até uma nova versão ser detectada e aprovada.`)) return;
    emVoo.current = true;
    setRetirando(true);
    try {
      const res = await fetch(`/api/normative-documents/${id}/retire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ reason: retireReason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setRetireError(mensagemDaApi(body, 'Não foi possível retirar o documento.'));
        return;
      }
    } catch {
      setRetireError('Não foi possível conectar ao servidor.');
      return;
    } finally {
      emVoo.current = false;
      setRetirando(false);
    }
    setRetireError('');
    setRetirandoId(null);
    setRetireReason('');
    setOkMsg('Documento retirado do Assistente.');
    await recarregar();
  }

  async function handleApprove(id: string) {
    const res = await fetch(`/api/normative-documents/${id}/approve`, { method: 'POST', headers: authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setActionError(body?.message ?? 'Não foi possível aprovar o documento.');
      return;
    }
    setActionError('');
    fecharDetalhe();
    loadAll();
  }

  async function handleReject(id: string) {
    const res = await fetch(`/api/normative-documents/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ reason: rejectReason }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setActionError(body?.message ?? 'Não foi possível rejeitar o documento.');
      return;
    }
    setActionError('');
    setRejectReason('');
    fecharDetalhe();
    loadAll();
  }

  async function handleReindex(id: string) {
    const res = await fetch(`/api/normative-documents/${id}/reindex`, { method: 'POST', headers: authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setActionError(body?.message ?? 'Não foi possível reindexar o documento.');
      return;
    }
    setActionError('');
    loadAll();
  }

  if (!ready) {
    return <p className="text-center text-brand-700">Carregando...</p>;
  }

  return (
    <div>
      <AdminPageHeader title="Base normativa" />
      {actionError && <p role="alert" className="mt-2 text-sm text-red-600">{actionError}</p>}

      <FontesPanel sources={sources} onChanged={loadAll} />

      <Card title={`Aguardando validação (${pending.length})`} className="mt-8">
        {pending.length > 0 && (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={todosSelecionados} onChange={alternarTodos} />
              Selecionar todos
            </label>
            <input
              placeholder="Motivo da rejeição em lote"
              aria-label="Motivo da rejeição em lote"
              value={batchReason}
              onChange={(e) => setBatchReason(e.target.value)}
              className="adm-input flex-1 text-sm"
            />
            <button
              onClick={handleRejectBatch}
              disabled={enviandoLote || efetivos.length === 0 || excedeu || !batchReason.trim()}
              className="adm-btn adm-btn-danger disabled:opacity-50"
            >
              {enviandoLote ? 'Rejeitando…' : `Rejeitar selecionados (${efetivos.length})`}
            </button>
          </div>
        )}
        {excedeu && <p role="status" className="mb-2 text-sm text-brand-700">Selecione no máximo {LIMITE_LOTE} documentos por vez</p>}
        {okMsg && !okMsg.startsWith('Documento retirado') && <p role="status" className="mb-2 text-sm text-brand-700">{okMsg}</p>}
        {batchError && <p role="alert" className="mb-2 text-sm text-red-600">{batchError}</p>}
        <ul className="flex flex-col gap-2">
          {pending.map((doc) => (
            <li key={doc.id} className="adm-card-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <input
                type="checkbox"
                aria-label={`Selecionar ${doc.file_name}`}
                checked={selecionados.has(doc.id)}
                onChange={() => alternarSelecao(doc.id)}
              />
              <span className="min-w-0 flex-1 break-words">{doc.file_name} — detectado em {new Date(doc.detected_at).toLocaleDateString('pt-BR')}</span>
              <button onClick={() => openDetail(doc.id)} className="adm-link shrink-0 whitespace-nowrap">Revisar</button>
            </li>
          ))}
          {pending.length === 0 && <p className="text-sm text-brand-700">Nada pendente.</p>}
        </ul>
      </Card>

      <Card title={`Vigentes (${vigentes.length})`} className="mt-8">
        {okMsg.startsWith('Documento retirado') && <p role="status" className="mb-2 text-sm text-brand-700">{okMsg}</p>}
        <ul className="flex flex-col gap-2">
          {vigentes.map((doc) => (
            <li key={doc.id} className="adm-card-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0 break-words">{doc.file_name} — {doc.indexed_at ? 'indexado' : 'aprovado, indexação pendente'}</span>
              <span className="flex shrink-0 gap-3">
                {!doc.indexed_at && (
                  <button onClick={() => handleReindex(doc.id)} className="adm-link shrink-0 whitespace-nowrap">Reindexar</button>
                )}
                <button
                  onClick={() => {
                    setRetirandoId(doc.id);
                    setRetireReason('');
                    setRetireError('');
                    setTimeout(() => retireInput.current?.focus(), 0);
                  }}
                  aria-label={`Retirar ${doc.file_name}`}
                  className="adm-link-danger shrink-0 whitespace-nowrap"
                >
                  Retirar
                </button>
              </span>
              {retirandoId === doc.id && (
                <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    ref={retireInput}
                    placeholder="Motivo da retirada"
                    aria-label="Motivo da retirada"
                    value={retireReason}
                    onChange={(e) => setRetireReason(e.target.value)}
                    className="adm-input flex-1 text-sm"
                  />
                  <button
                    onClick={() => handleRetire(doc.id)}
                    disabled={retirando || !retireReason.trim()}
                    className="adm-btn adm-btn-danger disabled:opacity-50"
                  >
                    {retirando ? 'Retirando…' : 'Confirmar retirada'}
                  </button>
                  <button onClick={() => { setRetirandoId(null); setRetireError(''); }} className="adm-link">Cancelar</button>
                  <p className="w-full text-xs text-brand-700">O documento deixa de ser usado nas respostas. A fonte fica sem versão vigente até uma nova versão ser detectada e aprovada.</p>
                </div>
              )}
              {retirandoId === doc.id && retireError && (
                <p role="alert" className="w-full text-sm text-red-600">{retireError}</p>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {detail && (
        // O destaque (antes borda verde) vira outline: .adm-card já define a borda e vence border-*.
        <Card title="Revisar versão" className="mt-8 outline outline-2 outline-adm-brand">
          {diffLoading && <p role="status" className="text-xs text-brand-700">Calculando diferenças…</p>}
          {diff?.has_previous && <DiffView diff={diff} />}
          {diff?.has_previous && (
            <button onClick={() => setShowSideBySide((v) => !v)} aria-expanded={showSideBySide} className="adm-link mt-3">
              {showSideBySide ? 'Ocultar texto lado a lado' : 'Ver texto completo lado a lado'}
            </button>
          )}
          {showSideBySide && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h4 className="text-sm font-bold text-brand-700">Texto anterior</h4>
              <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-brand-700">
                {detail.previous_text || '(nenhuma versão vigente anterior)'}
              </p>
            </div>
            <div>
              <h4 className="text-sm font-bold text-brand-700">Texto novo</h4>
              <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-brand-900">
                {detail.document.raw_text}
              </p>
            </div>
          </div>
          )}
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button onClick={() => handleApprove(detail.document.id)} className="adm-btn adm-btn-primary">
              Aprovar
            </button>
            <input
              placeholder="Motivo da rejeição"
              aria-label="Motivo da rejeição"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="adm-input flex-1 text-sm"
            />
            <button onClick={() => handleReject(detail.document.id)} disabled={!rejectReason.trim()} className="adm-btn adm-btn-danger disabled:opacity-50">
              Rejeitar
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
