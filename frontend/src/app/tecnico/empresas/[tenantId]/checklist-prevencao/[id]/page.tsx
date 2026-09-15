'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface ChecklistItem {
  id: string;
  item_key: string;
  item_label: string;
  status: 'C' | 'NC' | 'NA' | null;
  observacoes: string | null;
  foto_r2_key: string | null;
}

interface ChecklistDetail {
  id: string;
  status: 'rascunho' | 'concluida';
  data_realizacao: string;
  items: ChecklistItem[];
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export default function ChecklistPrevencaoPage() {
  const router = useRouter();
  const params = useParams<{ tenantId: string; id: string }>();
  const [checklist, setChecklist] = useState<ChecklistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [concluding, setConcluding] = useState(false);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);

  async function loadChecklist() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/prevention-checklists/${params.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setChecklist(await res.json());
      } else {
        setError('Não foi possível carregar o checklist.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    loadChecklist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const isDraft = checklist?.status === 'rascunho';

  async function saveItem(itemId: string, patch: { status?: string; observacoes?: string }) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/prevention-checklists/${params.id}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const updatedItem = await res.json();
        setChecklist((prev) =>
          prev ? { ...prev, items: prev.items.map((i) => (i.id === itemId ? updatedItem : i)) } : prev,
        );
      } else {
        setError('Não foi possível salvar o item.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
  }

  async function handleUploadFoto(itemId: string, file: File) {
    setUploadingItemId(itemId);
    setError('');
    const token = localStorage.getItem('montese_token');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch(`/api/prevention-checklists/${params.id}/items/${itemId}/foto`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        const updatedItem = await res.json();
        setChecklist((prev) =>
          prev ? { ...prev, items: prev.items.map((i) => (i.id === itemId ? updatedItem : i)) } : prev,
        );
      } else {
        setError('Não foi possível enviar a foto.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
    setUploadingItemId(null);
  }

  async function handleVerFoto(itemId: string) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/prevention-checklists/${params.id}/items/${itemId}/foto`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const { url } = await res.json();
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        setError('Não foi possível abrir a foto.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
  }

  async function handleConcluir(event: FormEvent) {
    event.preventDefault();
    setConcluding(true);
    setError('');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/prevention-checklists/${params.id}/concluir`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setChecklist(await res.json());
      } else {
        setError('Não foi possível concluir o checklist.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
    setConcluding(false);
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }
  if (!checklist) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-red-600">{error}</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-900">
          Checklist de prevenção — {formatDate(checklist.data_realizacao)}
        </h1>
        <span className={checklist.status === 'concluida' ? 'text-green-700' : 'text-yellow-700'}>
          {checklist.status === 'concluida' ? 'Concluído' : 'Rascunho'}
        </span>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <div className="flex flex-col gap-4">
          {checklist.items.map((item) => (
            <div key={item.id} className="border-b border-brand-100 pb-4 last:border-0 last:pb-0">
              <p className="text-sm font-medium text-brand-900">{item.item_label}</p>
              <div className="mt-2 flex gap-3 text-sm">
                {(['C', 'NC', 'NA'] as const).map((option) => (
                  <label key={option} className="flex items-center gap-1">
                    <input
                      type="radio"
                      name={`item-${item.id}`}
                      checked={item.status === option}
                      disabled={!isDraft}
                      onChange={() => saveItem(item.id, { status: option })}
                    />
                    {option}
                  </label>
                ))}
              </div>
              <textarea
                defaultValue={item.observacoes ?? ''}
                disabled={!isDraft}
                placeholder="Observação (opcional)"
                onBlur={(e) => saveItem(item.id, { observacoes: e.target.value })}
                className="mt-2 w-full rounded-md border border-brand-100 px-3 py-2 text-sm disabled:bg-brand-50"
              />
              <div className="mt-2 flex items-center gap-3 text-xs">
                {item.foto_r2_key && (
                  <button
                    type="button"
                    onClick={() => handleVerFoto(item.id)}
                    className="text-brand-700 underline"
                  >
                    📷 Ver foto
                  </button>
                )}
                {isDraft && (
                  <label className="text-brand-700">
                    {uploadingItemId === item.id
                      ? 'Enviando...'
                      : item.foto_r2_key
                        ? 'Trocar foto'
                        : 'Adicionar foto'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      disabled={uploadingItemId === item.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadFoto(item.id, file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {isDraft && (
        <form onSubmit={handleConcluir} className="mt-8">
          <button
            type="submit"
            disabled={concluding}
            className="w-full rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {concluding ? 'Concluindo...' : 'Concluir checklist'}
          </button>
        </form>
      )}
    </div>
  );
}
