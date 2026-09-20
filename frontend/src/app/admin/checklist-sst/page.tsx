'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface SstChecklistItem {
  id: string;
  nr_code: string;
  nr_title: string;
  nr_category: string;
  document_name: string;
  description: string;
  legal_requirement: string;
  infraction_index: number | null;
  is_fine_validated: boolean;
}

const CATEGORIES = ['geral', 'especial', 'setorial', 'revogada'];

const EMPTY_FORM = {
  nr_code: '',
  nr_title: '',
  nr_category: 'geral',
  document_name: '',
  description: '',
  legal_requirement: '',
  infraction_index: '',
};

function authHeaders() {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

export default function AdminChecklistSstPage() {
  const router = useRouter();
  const formSectionRef = useRef<HTMLElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<SstChecklistItem[]>([]);
  const [filterNrCode, setFilterNrCode] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [actionError, setActionError] = useState('');

  async function loadAll(nrCode?: string) {
    const url = nrCode ? `/api/sst-checklist?nr_code=${encodeURIComponent(nrCode)}` : '/api/sst-checklist';
    const res = await fetch(url, { headers: authHeaders() });
    if (res.ok) setItems(await res.json());
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

  function startEdit(item: SstChecklistItem) {
    setEditingId(item.id);
    setForm({
      nr_code: item.nr_code,
      nr_title: item.nr_title,
      nr_category: item.nr_category,
      document_name: item.document_name,
      description: item.description,
      legal_requirement: item.legal_requirement,
      infraction_index: item.infraction_index === null ? '' : String(item.infraction_index),
    });
    formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    firstFieldRef.current?.focus({ preventScroll: true });
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaveStatus('loading');
    setActionError('');

    const body = {
      nr_code: form.nr_code,
      nr_title: form.nr_title,
      nr_category: form.nr_category,
      document_name: form.document_name,
      description: form.description,
      legal_requirement: form.legal_requirement,
      infraction_index: form.infraction_index === '' ? null : Number(form.infraction_index),
    };

    const res = await fetch(editingId ? `/api/sst-checklist/${editingId}` : '/api/sst-checklist', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      resetForm();
      setSaveStatus('idle');
      loadAll(filterNrCode || undefined);
      return;
    }
    setSaveStatus('erro');
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir este item do catálogo? Essa ação não pode ser desfeita.')) return;
    const res = await fetch(`/api/sst-checklist/${id}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) {
      setActionError('Não foi possível excluir o item.');
      return;
    }
    setActionError('');
    if (editingId === id) resetForm();
    loadAll(filterNrCode || undefined);
  }

  function handleFilter(event: FormEvent) {
    event.preventDefault();
    loadAll(filterNrCode || undefined);
  }

  if (!ready) {
    return <p className="text-center text-brand-700">Carregando...</p>;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-brand-900">Checklist SST — catálogo de referência</h2>
      <p className="mt-2 text-sm text-brand-700">
        Curadoria interna da Montese sobre quais documentos uma empresa costuma precisar por NR — não é o
        texto oficial da norma. Usado pelo Assistente como uma fonte de citação rotulada como tal.
      </p>
      {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}

      <section ref={formSectionRef} className="mt-8 rounded-lg border border-brand-100 p-6">
        <h3 className="text-lg font-bold text-brand-900">{editingId ? 'Editar item' : 'Novo item'}</h3>
        <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-brand-700">
            <span>Código da NR</span>
            <input
              placeholder="ex: NR-13"
              ref={firstFieldRef}
              value={form.nr_code}
              onChange={(e) => setForm({ ...form, nr_code: e.target.value })}
              required
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-700">
            <span>Título da NR</span>
            <input
              placeholder="ex: Segurança em Caldeiras"
              value={form.nr_title}
              onChange={(e) => setForm({ ...form, nr_title: e.target.value })}
              required
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-700">
            <span>Categoria</span>
            <select
              value={form.nr_category}
              onChange={(e) => setForm({ ...form, nr_category: e.target.value })}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-700">
            <span>Índice de infração (0 a 4, opcional)</span>
            <input
              placeholder="ex: 2"
              type="number"
              min={0}
              max={4}
              value={form.infraction_index}
              onChange={(e) => setForm({ ...form, infraction_index: e.target.value })}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-700 sm:col-span-2">
            <span>Nome do documento</span>
            <input
              placeholder="ex: Prontuário de caldeira"
              value={form.document_name}
              onChange={(e) => setForm({ ...form, document_name: e.target.value })}
              required
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-700 sm:col-span-2">
            <span>Descrição</span>
            <textarea
              placeholder="Descreva o documento e sua importância"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
              rows={3}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-700 sm:col-span-2">
            <span>Requisito legal</span>
            <textarea
              placeholder="Qual é o requisito legal associado"
              value={form.legal_requirement}
              onChange={(e) => setForm({ ...form, legal_requirement: e.target.value })}
              required
              rows={3}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          {saveStatus === 'erro' && (
            <p className="text-sm text-red-600 sm:col-span-2">Não foi possível salvar. Confira os campos.</p>
          )}
          <div className="flex gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={saveStatus === 'loading'}
              className="self-start rounded-md bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {editingId ? 'Salvar edição' : 'Criar item'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="self-start rounded-md border border-brand-100 px-6 py-2 text-sm text-brand-700"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <form onSubmit={handleFilter} className="flex gap-3">
          <input
            placeholder="Filtrar por NR (ex: NR-13)"
            aria-label="Filtrar por NR"
            value={filterNrCode}
            onChange={(e) => setFilterNrCode(e.target.value)}
            className="flex-1 rounded-md border border-brand-100 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-md border border-brand-100 px-4 py-2 text-sm text-brand-700">
            Filtrar
          </button>
        </form>

        <h3 className="mt-4 text-lg font-bold text-brand-900">Itens ({items.length})</h3>
        <ul className="mt-4 flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between rounded-md border border-brand-100 px-3 py-2 text-sm">
              <span>
                <strong>{item.nr_code}</strong> ({item.nr_category}) — {item.document_name}
              </span>
              <span className="flex gap-3">
                <button onClick={() => startEdit(item)} className="text-brand-500 underline">
                  Editar
                </button>
                <button onClick={() => handleDelete(item.id)} className="text-red-600 underline">
                  Excluir
                </button>
              </span>
            </li>
          ))}
          {items.length === 0 && <p className="text-sm text-brand-700">Nenhum item encontrado.</p>}
        </ul>
      </section>
    </div>
  );
}
