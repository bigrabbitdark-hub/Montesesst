'use client';

import { useState } from 'react';
import { getToken } from '@/lib/auth';

export function NovaExtraordinariaForm({ committeeId, onCreated }: { committeeId: string; onCreated: () => void }) {
  const [titulo, setTitulo] = useState('');
  const [data, setData] = useState('');
  const [hora, setHora] = useState('');
  const [local, setLocal] = useState('');
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const token = getToken();
    try {
      const res = await fetch('/api/cipa/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          committee_id: committeeId,
          titulo,
          data: data || undefined,
          hora: hora || undefined,
          local: local || undefined,
          motivo: motivo || undefined,
        }),
      });
      if (!res.ok) {
        setError('Não foi possível criar a reunião. Confira os campos.');
        return;
      }
      onCreated();
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <label className="flex flex-col gap-1 text-sm text-brand-900">
        Título
        <input
          type="text"
          required
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Data
          <input
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Horário
          <input
            type="time"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm text-brand-900">
        Local
        <input
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-brand-900">
        Motivo
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={loading}
        className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? 'Criando...' : 'Criar reunião extraordinária'}
      </button>
    </form>
  );
}
