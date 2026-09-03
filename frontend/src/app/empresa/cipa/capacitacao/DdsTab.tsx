'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { CipaDdsRecord, formatDateBR, getSelectedCompanyUnitId } from '@/lib/cipa-types';

export default function DdsTab() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [records, setRecords] = useState<CipaDdsRecord[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [data, setData] = useState('');
  const [tema, setTema] = useState('');
  const [numeroParticipantes, setNumeroParticipantes] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [observacoes, setObservacoes] = useState('');

  async function load() {
    const token = getToken();
    const unitId = getSelectedCompanyUnitId();
    if (!token) {
      router.push('/login');
      return;
    }
    if (!unitId) {
      setReady(true);
      return;
    }
    const result = await fetch(`/api/cipa/dds?company_unit_id=${unitId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : []));
    setRecords(result);
    setReady(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const token = getToken();
    const unitId = getSelectedCompanyUnitId();
    try {
      const res = await fetch('/api/cipa/dds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_unit_id: unitId,
          data,
          tema,
          numero_participantes: numeroParticipantes ? Number(numeroParticipantes) : undefined,
          responsavel: responsavel || undefined,
          observacoes: observacoes || undefined,
        }),
      });
      if (!res.ok) {
        setError('Não foi possível registrar o DDS.');
        return;
      }
      setShowForm(false);
      setData('');
      setTema('');
      setNumeroParticipantes('');
      setResponsavel('');
      setObservacoes('');
      await load();
    } catch {
      setError('Falha de conexão ao registrar o DDS.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Apagar este registro de DDS?')) return;
    const token = getToken();
    const res = await fetch(`/api/cipa/dds/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      await load();
    } else {
      setError('Não foi possível apagar o registro.');
    }
  }

  if (!ready) {
    return <div className="py-8 text-center text-brand-700">Carregando...</div>;
  }

  if (!getSelectedCompanyUnitId()) {
    return <p className="text-sm text-brand-700">Selecione um estabelecimento pra ver os DDS.</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + Novo DDS
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3 rounded-lg border border-brand-100 p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Data
              <input
                type="date"
                required
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Nº de participantes
              <input
                type="number"
                min={0}
                value={numeroParticipantes}
                onChange={(e) => setNumeroParticipantes(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tema abordado
            <input
              required
              value={tema}
              onChange={(e) => setTema(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Responsável (opcional)
            <input
              value={responsavel}
              onChange={(e) => setResponsavel(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Observações (opcional)
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Registrar DDS'}
          </button>
        </form>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {records.map((r) => (
          <div key={r.id} className="rounded-md border border-brand-100 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-900">{r.tema}</p>
                <p className="mt-0.5 text-xs text-brand-700">
                  {formatDateBR(r.data)}
                  {r.numero_participantes !== null && ` · ${r.numero_participantes} participantes`}
                  {r.responsavel && ` · ${r.responsavel}`}
                </p>
                {r.observacoes && <p className="mt-1 text-xs text-brand-700">{r.observacoes}</p>}
              </div>
              <button onClick={() => handleDelete(r.id)} className="shrink-0 text-xs text-red-600 hover:underline">
                Apagar
              </button>
            </div>
          </div>
        ))}
        {records.length === 0 && <p className="text-sm text-brand-700">Nenhum DDS registrado.</p>}
      </div>
    </div>
  );
}
