'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminNav } from '@/components/AdminNav';

interface AuditLogRow {
  id: string;
  occurred_at: string;
  actor_full_name: string | null;
  actor_role: string | null;
  actor_tenant_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  method: string;
  path: string;
  status_code: number;
}

const PAGE_SIZE = 50;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR');
}

export default function AdminAuditoriaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState('');

  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [appliedFilter, setAppliedFilter] = useState('');

  function auditLogUrl(currentOffset: number, filter: string): string {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(currentOffset) });
    if (filter) params.set('resource_type', filter);
    return `/api/audit-log?${params.toString()}`;
  }

  async function loadPage(currentOffset: number, filter: string, append: boolean) {
    setLoadingMore(true);
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(auditLogUrl(currentOffset, filter), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const page: AuditLogRow[] = await res.json();
        setRows((prev) => (append ? [...prev, ...page] : page));
        setOffset(currentOffset + page.length);
        setHasMore(page.length === PAGE_SIZE);
        setListError('');
      } else {
        setListError('Não foi possível carregar a auditoria.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    loadPage(0, '', false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function handleFilterSubmit(event: FormEvent) {
    event.preventDefault();
    setAppliedFilter(resourceTypeFilter);
    loadPage(0, resourceTypeFilter, false);
  }

  if (!ready) {
    return <div className="mx-auto max-w-5xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Painel administrativo</h1>
      <div className="mt-6">
        <AdminNav />
      </div>

      <form onSubmit={handleFilterSubmit} className="mt-8 flex items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Filtrar por tipo de recurso
          <input
            value={resourceTypeFilter}
            onChange={(e) => setResourceTypeFilter(e.target.value)}
            placeholder="ex: technicians, documents, inspections"
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Filtrar
        </button>
        {appliedFilter && (
          <button
            type="button"
            onClick={() => {
              setResourceTypeFilter('');
              setAppliedFilter('');
              loadPage(0, '', false);
            }}
            className="rounded-md border border-brand-100 px-4 py-2 text-sm text-brand-700"
          >
            Limpar
          </button>
        )}
      </form>

      <div className="mt-8">
        {listError && <p className="text-sm text-red-600">{listError}</p>}
        {rows.length === 0 && !listError ? (
          <p className="text-sm text-brand-700">Nenhum evento de auditoria encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-brand-100 text-brand-700">
                  <th className="py-2">Quando</th>
                  <th className="py-2">Quem</th>
                  <th className="py-2">Empresa</th>
                  <th className="py-2">Ação</th>
                  <th className="py-2">Recurso</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-brand-100">
                    <td className="py-2 text-brand-700">{formatDateTime(row.occurred_at)}</td>
                    <td className="py-2 text-brand-700">
                      {row.actor_full_name ?? '—'} {row.actor_role ? `(${row.actor_role})` : ''}
                    </td>
                    <td className="py-2 text-brand-700">{row.actor_tenant_name ?? '—'}</td>
                    <td className="py-2 text-brand-900">{row.action}</td>
                    <td className="py-2 text-brand-700">{row.resource_type}</td>
                    <td className="py-2 text-brand-700">
                      {row.method} {row.status_code}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && rows.length > 0 && (
          <button
            onClick={() => loadPage(offset, appliedFilter, true)}
            disabled={loadingMore}
            className="mt-4 rounded-md border border-brand-100 px-4 py-2 text-sm text-brand-700 disabled:opacity-50"
          >
            {loadingMore ? 'Carregando...' : 'Carregar mais'}
          </button>
        )}
      </div>
    </div>
  );
}
