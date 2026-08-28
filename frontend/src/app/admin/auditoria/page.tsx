'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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

const STATUS_LABELS: Record<number, string> = {
  200: 'Sucesso',
  201: 'Criado com sucesso',
  204: 'Sucesso, sem conteúdo',
  400: 'Pedido inválido',
  401: 'Não autenticado',
  403: 'Sem permissão',
  404: 'Não encontrado',
  429: 'Limite de tentativas excedido',
  500: 'Erro interno do servidor',
  502: 'Erro ao falar com serviço externo',
  503: 'Serviço indisponível',
};

function statusLabel(code: number): string {
  if (STATUS_LABELS[code]) return STATUS_LABELS[code];
  if (code >= 200 && code < 300) return 'Sucesso';
  if (code >= 400 && code < 500) return 'Erro do usuário/pedido';
  if (code >= 500) return 'Erro do servidor';
  return 'Outro';
}

function statusColorClass(code: number): string {
  if (code >= 200 && code < 300) return 'text-green-700';
  if (code >= 400 && code < 500) return 'text-yellow-700';
  if (code >= 500) return 'text-red-700';
  return 'text-brand-700';
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
    return <p className="text-center text-brand-700">Carregando...</p>;
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-brand-900">Auditoria</h2>
      <p className="mt-1 text-sm text-brand-700">
        Registro de ações realizadas no sistema — quem fez o quê, quando, e o resultado (coluna
        "Status"). Passe o mouse sobre o número do status pra ver o que significa em termos simples.
      </p>

      <form onSubmit={handleFilterSubmit} className="mt-6 flex items-end gap-3">
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
                    <td className={`py-2 ${statusColorClass(row.status_code)}`}>
                      <span title={statusLabel(row.status_code)}>
                        {row.method} {row.status_code}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 rounded-md bg-brand-50 p-3 text-xs text-brand-700">
            <span>
              <strong className="text-green-700">200/201</strong> — deu certo
            </span>
            <span>
              <strong className="text-yellow-700">400/401/403/404</strong> — algo no pedido não foi
              aceito (dado errado, sem permissão, ou não existe)
            </span>
            <span>
              <strong className="text-yellow-700">429</strong> — muitas tentativas seguidas, bloqueado
              temporariamente
            </span>
            <span>
              <strong className="text-red-700">500/502/503</strong> — erro do sistema, não do usuário
            </span>
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
