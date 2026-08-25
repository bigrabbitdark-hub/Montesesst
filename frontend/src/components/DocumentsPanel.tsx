'use client';

import { FormEvent, useEffect, useState } from 'react';

interface DocumentRow {
  id: string;
  category: string;
  title: string;
  file_name: string;
  expires_at: string | null;
  uploaded_by_user_id: string;
  created_at: string;
}

interface ComplianceItem {
  id: string;
  category: string;
  title: string;
  expires_at: string;
  dias_vencido?: number;
  dias_restantes?: number;
}

interface ComplianceResult {
  score: number | null;
  pendencias: ComplianceItem[];
  avisos: ComplianceItem[];
}

const CATEGORY_LABELS: Record<string, string> = {
  pgr: 'PGR',
  pcmso: 'PCMSO',
  laudo: 'Laudo',
  ficha_epi: 'Ficha de EPI',
  treinamento: 'Treinamento',
};

interface AgendaItem {
  id: string;
  category: string;
  title: string;
  expires_at: string;
}

interface AgendaGroup {
  label: string;
  items: AgendaItem[];
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function groupAgendaByMonth(documents: DocumentRow[]): AgendaGroup[] {
  const items = documents
    .filter((doc): doc is DocumentRow & { expires_at: string } => doc.expires_at !== null)
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at));

  const groups: AgendaGroup[] = [];
  for (const item of items) {
    const label = capitalize(
      new Date(item.expires_at).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    );
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.label === label) {
      lastGroup.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

export function DocumentsPanel({ tenantId }: { tenantId?: string }) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('pgr');
  const [title, setTitle] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [listError, setListError] = useState('');
  const [compliance, setCompliance] = useState<ComplianceResult | null>(null);

  function currentUserId(): string | null {
    const raw = localStorage.getItem('montese_user');
    if (!raw) return null;
    return JSON.parse(raw).id;
  }

  function listUrl(): string {
    return tenantId ? `/api/documents?tenant_id=${tenantId}` : '/api/documents';
  }

  function complianceUrl(): string {
    return tenantId ? `/api/documents/compliance?tenant_id=${tenantId}` : '/api/documents/compliance';
  }

  async function loadCompliance() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(complianceUrl(), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setCompliance(await res.json());
        setListError('');
      } else {
        setListError('Não foi possível carregar o score de conformidade.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  async function loadDocuments() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(listUrl(), { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setDocuments(await res.json());
        setListError('');
      } else {
        setListError('Não foi possível carregar os documentos.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
    setLoading(false);
  }

  useEffect(() => {
    loadDocuments();
    loadCompliance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setStatus('loading');
    setErrorMessage('');
    const token = localStorage.getItem('montese_token');
    const formData = new FormData();
    formData.append('category', category);
    formData.append('title', title);
    if (expiresAt) formData.append('expires_at', expiresAt);
    if (tenantId) formData.append('tenant_id', tenantId);
    formData.append('file', file);

    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        setTitle('');
        setExpiresAt('');
        setFile(null);
        setStatus('idle');
        loadDocuments();
        loadCompliance();
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(body?.message ?? 'Não foi possível enviar o documento.');
      setStatus('erro');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setStatus('erro');
    }
  }

  async function handleDownload(id: string) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/documents/${id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const { url } = await res.json();
        window.open(url, '_blank');
      } else {
        setListError('Não foi possível baixar o documento.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  async function handleDelete(id: string) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        loadDocuments();
        loadCompliance();
      } else {
        setListError('Não foi possível apagar o documento.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  const userId = currentUserId();
  const agendaGroups = groupAgendaByMonth(documents);

  if (loading) {
    return <p className="text-brand-700">Carregando documentos...</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      {compliance && (
        <section className="rounded-lg border border-brand-100 p-6">
          <h2 className="text-lg font-bold text-brand-900">Conformidade</h2>
          <p className="mt-2 text-3xl font-bold text-brand-900">
            {compliance.score === null ? 'Sem dados ainda' : `${compliance.score}%`}
          </p>
          {compliance.pendencias.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-bold text-red-600">Pendências</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-red-600">
                {compliance.pendencias.map((item) => (
                  <li key={item.id}>
                    {CATEGORY_LABELS[item.category]} — {item.title} (venceu há {item.dias_vencido} dia(s))
                  </li>
                ))}
              </ul>
            </div>
          )}
          {compliance.avisos.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-bold text-yellow-700">Vencendo em breve</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-yellow-700">
                {compliance.avisos.map((item) => (
                  <li key={item.id}>
                    {CATEGORY_LABELS[item.category]} — {item.title} (vence em {item.dias_restantes} dia(s))
                  </li>
                ))}
              </ul>
            </div>
          )}
          {compliance.score !== null && compliance.pendencias.length === 0 && compliance.avisos.length === 0 && (
            <p className="mt-4 text-sm text-green-700">Tudo em dia.</p>
          )}
        </section>
      )}

      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Agenda de vencimentos</h2>
        {agendaGroups.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhum vencimento cadastrado.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-5">
            {agendaGroups.map((group) => (
              <div key={group.label}>
                <h3 className="text-sm font-bold text-brand-900">{group.label}</h3>
                <ul className="mt-2 flex flex-col gap-1 text-sm text-brand-700">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      {CATEGORY_LABELS[item.category]} — {item.title} (
                      {new Date(item.expires_at).toLocaleDateString('pt-BR')})
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Enviar documento</h2>
        <form onSubmit={handleUpload} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Categoria
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Título
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Vencimento (opcional)
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Arquivo (PDF, JPG ou PNG, até 10MB)
            <input
              type="file"
              required
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-brand-900"
            />
          </label>
          {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={status === 'loading'}
            className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {status === 'loading' ? 'Enviando...' : 'Enviar documento'}
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Documentos</h2>
        {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}
        {documents.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhum documento enviado ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between rounded-md border border-brand-100 px-4 py-3 text-sm"
              >
                <div>
                  <strong className="text-brand-900">{CATEGORY_LABELS[doc.category]}</strong>{' '}
                  <span className="text-brand-700">— {doc.title}</span>
                  {doc.expires_at && (
                    <span className="ml-2 text-brand-700">
                      (vence em {new Date(doc.expires_at).toLocaleDateString('pt-BR')})
                    </span>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => handleDownload(doc.id)} className="text-brand-500 hover:underline">
                    Baixar
                  </button>
                  {doc.uploaded_by_user_id === userId && (
                    <button onClick={() => handleDelete(doc.id)} className="text-red-600 hover:underline">
                      Apagar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
