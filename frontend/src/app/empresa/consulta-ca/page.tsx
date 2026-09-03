'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface CaepiRecord {
  numero_ca: string;
  data_validade: string | null;
  situacao: string | null;
  equipamento: string | null;
  descricao_equipamento: string | null;
  marca_ca: string | null;
  razao_social: string | null;
  norma: string | null;
}

interface CaepiSyncStatus {
  last_synced_at: string | null;
  rows_imported: number | null;
  rows_skipped: number | null;
}

const SITUACAO_CLASS: Record<string, string> = {
  'VÁLIDO': 'bg-green-50 text-green-800',
  SUSPENSO: 'bg-amber-50 text-amber-800',
  VENCIDO: 'bg-red-50 text-red-800',
  CANCELADO: 'bg-red-50 text-red-800',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function formatSyncedAt(iso: string | null): string {
  if (!iso) return 'nunca sincronizada';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ConsultaCaPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CaepiRecord[]>([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<CaepiSyncStatus | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    fetch('/api/caepi/sync-status', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then(setSyncStatus)
      .catch(() => {});
  }, [router]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = query.trim();
    if (!trimmed) return;
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/caepi/search?q=${encodeURIComponent(trimmed)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setError('Não foi possível buscar. Tente novamente.');
        return;
      }
      const data: CaepiRecord[] = await res.json();
      setResults(data);
      setSearched(true);
    } catch {
      setError('Falha de conexão ao buscar.');
    }
  }

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">🔎 Consulta de CA</h1>
      <p className="mt-1 text-sm text-brand-700">
        Busque pelo número do Certificado de Aprovação (CA) ou por equipamento/fabricante, na base
        oficial do MTE (sistema CAEPI).
      </p>

      <form onSubmit={handleSearch} className="mt-6 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Número do CA ou nome do equipamento"
          className="flex-1 rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
        />
        <button
          type="submit"
          className="rounded-[9px] bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Consultar
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 flex flex-col gap-2">
        {results.map((r) => (
          <div key={r.numero_ca} className="rounded-md border border-brand-100 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-900">
                  CA {r.numero_ca} — {r.equipamento || 'Equipamento não informado'}
                </p>
                <p className="mt-0.5 text-xs text-brand-700">
                  Fabricante: {r.razao_social || '—'} · Marca: {r.marca_ca || '—'} · Validade:{' '}
                  {formatDate(r.data_validade)}
                  {r.norma && ` · Norma: ${r.norma}`}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  SITUACAO_CLASS[r.situacao ?? ''] ?? 'bg-brand-50 text-brand-700'
                }`}
              >
                {r.situacao ?? 'SITUAÇÃO DESCONHECIDA'}
              </span>
            </div>
          </div>
        ))}
        {searched && results.length === 0 && (
          <p className="text-sm text-brand-700">Nenhum CA encontrado pra essa busca.</p>
        )}
      </div>

      <p className="mt-8 text-xs text-brand-700">
        Fonte oficial: MTE / CAEPI. Base local atualizada em {formatSyncedAt(syncStatus?.last_synced_at ?? null)}.
      </p>
    </div>
  );
}
