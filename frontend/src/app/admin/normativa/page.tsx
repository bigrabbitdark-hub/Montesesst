'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Badge, Card } from '@/components/admin/Card';

interface OfficialSource {
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

function authHeaders() {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

function formatChecked(iso: string | null): string {
  if (!iso) return 'nunca verificada';
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return 'verificada há menos de 1 h';
  if (hours < 48) return `verificada há ${hours} h`;
  return `verificada há ${Math.floor(hours / 24)} dias`;
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

  const [entity, setEntity] = useState('');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [officialUrl, setOfficialUrl] = useState('');
  const [createStatus, setCreateStatus] = useState<'idle' | 'loading' | 'erro'>('idle');

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

  async function handleCreateSource(event: FormEvent) {
    event.preventDefault();
    setCreateStatus('loading');
    const res = await fetch('/api/normative-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ entity, code: code || undefined, title, official_url: officialUrl }),
    });
    if (res.ok) {
      setEntity('');
      setCode('');
      setTitle('');
      setOfficialUrl('');
      setCreateStatus('idle');
      loadAll();
      return;
    }
    setCreateStatus('erro');
  }

  async function openDetail(id: string) {
    const res = await fetch(`/api/normative-documents/${id}`, { headers: authHeaders() });
    if (res.ok) setDetail(await res.json());
  }

  async function handleApprove(id: string) {
    const res = await fetch(`/api/normative-documents/${id}/approve`, { method: 'POST', headers: authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setActionError(body?.message ?? 'Não foi possível aprovar o documento.');
      return;
    }
    setActionError('');
    setDetail(null);
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
    setDetail(null);
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
      {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}

      <Card title="Fontes monitoradas" className="mt-8">
        <form onSubmit={handleCreateSource} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input placeholder="Entidade (ex: MTE)" value={entity} onChange={(e) => setEntity(e.target.value)} required className="adm-input" />
          <input placeholder="Código (ex: NR-06)" value={code} onChange={(e) => setCode(e.target.value)} className="adm-input" />
          <input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} required className="adm-input sm:col-span-2" />
          <input placeholder="URL oficial" value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} required className="adm-input sm:col-span-2" />
          {createStatus === 'erro' && <p className="text-sm text-red-600 sm:col-span-2">Não foi possível cadastrar. Confira a URL.</p>}
          <button type="submit" disabled={createStatus === 'loading'} className="adm-btn adm-btn-primary self-start disabled:opacity-50 sm:col-span-2">
            Cadastrar fonte
          </button>
        </form>
        <ul className="mt-4 flex flex-col gap-1 text-sm text-brand-700">
          {sources.map((s) => (
            <li key={s.id}>
              {s.entity} {s.code ? `— ${s.code}` : ''} — {s.title}
              <span className="ml-2 text-xs text-brand-500">{formatChecked(s.last_checked_at)}</span>
              {s.consecutive_failures > 0 && (
                <span className="ml-2">
                  <Badge tone="bad">
                    Falhando ({s.consecutive_failures}){s.last_error ? ` — ${s.last_error}` : ''}
                  </Badge>
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={`Aguardando validação (${pending.length})`} className="mt-8">
        <ul className="flex flex-col gap-2">
          {pending.map((doc) => (
            <li key={doc.id} className="adm-card-2 flex items-center justify-between px-3 py-2 text-sm">
              <span>{doc.file_name} — detectado em {new Date(doc.detected_at).toLocaleDateString('pt-BR')}</span>
              <button onClick={() => openDetail(doc.id)} className="adm-link">Revisar</button>
            </li>
          ))}
          {pending.length === 0 && <p className="text-sm text-brand-700">Nada pendente.</p>}
        </ul>
      </Card>

      <Card title={`Vigentes (${vigentes.length})`} className="mt-8">
        <ul className="flex flex-col gap-2">
          {vigentes.map((doc) => (
            <li key={doc.id} className="adm-card-2 flex items-center justify-between px-3 py-2 text-sm">
              <span>{doc.file_name} — {doc.indexed_at ? 'indexado' : 'aprovado, indexação pendente'}</span>
              {!doc.indexed_at && (
                <button onClick={() => handleReindex(doc.id)} className="adm-link">Reindexar</button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {detail && (
        // O destaque (antes borda verde) vira outline: .adm-card já define a borda e vence border-*.
        <Card title="Revisar versão" className="mt-8 outline outline-2 outline-adm-brand">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button onClick={() => handleApprove(detail.document.id)} className="adm-btn adm-btn-primary">
              Aprovar
            </button>
            <input
              placeholder="Motivo da rejeição"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="adm-input flex-1 text-sm"
            />
            <button onClick={() => handleReject(detail.document.id)} disabled={!rejectReason} className="adm-btn adm-btn-danger disabled:opacity-50">
              Rejeitar
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
