'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { CipaPendencia, PRIORIDADE_LABEL, STATUS_PENDENCIA_LABEL, formatDateBR, getSelectedCompanyUnitId } from '@/lib/cipa-types';

const STATUS_CLASS: Record<CipaPendencia['status'], string> = {
  aberta: 'bg-red-50 text-red-800',
  andamento: 'bg-amber-50 text-amber-800',
  concluida: 'bg-green-50 text-green-800',
  atrasada: 'bg-red-100 text-red-900',
};

export default function PendenciasPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [pendencias, setPendencias] = useState<CipaPendencia[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [descricao, setDescricao] = useState('');
  const [prazo, setPrazo] = useState('');
  const [prioridade, setPrioridade] = useState<CipaPendencia['prioridade']>('media');

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
    const data = await fetch(`/api/cipa/pendencias?company_unit_id=${unitId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : []));
    setPendencias(data);
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
      const res = await fetch('/api/cipa/pendencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_unit_id: unitId,
          descricao,
          prazo: prazo || undefined,
          prioridade,
        }),
      });
      if (!res.ok) {
        setError('Não foi possível registrar a pendência.');
        return;
      }
      setShowForm(false);
      setDescricao('');
      setPrazo('');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(p: CipaPendencia, status: CipaPendencia['status']) {
    const token = getToken();
    const res = await fetch(`/api/cipa/pendencias/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setError(null);
      await load();
    } else {
      // Achado da revisão final (Fix 4 — Important): sem este else, uma
      // falha no PATCH não mostrava erro nenhum — e como o <select> é
      // controlado por p.status, o DOM continuava exibindo o valor que o
      // usuário acabou de escolher mesmo o servidor tendo rejeitado,
      // afirmando um estado persistido que não é verdade. `load()` não é
      // chamado aqui de propósito: sem ele, o <select> reverte pro valor
      // real de `pendencias` no próximo render (estado controlado).
      setError('Não foi possível atualizar o status da pendência.');
    }
  }

  if (!ready) {
    return <div className="px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-900">📌 Pendências da CIPA</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + Nova pendência
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3 rounded-lg border border-brand-100 p-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Descrição
            <textarea
              required
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Prazo
              <input
                type="date"
                value={prazo}
                onChange={(e) => setPrazo(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Prioridade
              <select
                value={prioridade}
                onChange={(e) => setPrioridade(e.target.value as CipaPendencia['prioridade'])}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              >
                {Object.entries(PRIORIDADE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Registrar pendência'}
          </button>
        </form>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {pendencias.map((p) => (
          <div key={p.id} className="rounded-md border border-brand-100 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-900">{p.descricao}</p>
                <p className="mt-0.5 text-xs text-brand-700">
                  {PRIORIDADE_LABEL[p.prioridade]} · Prazo: {formatDateBR(p.prazo)}
                  {p.meeting_id && ' · Originada de reunião'}
                  {p.origem === 'treinamento' && ' · Treinamento'}
                </p>
              </div>
              {p.origem === 'treinamento' ? (
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    p.prioridade === 'alta' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'
                  }`}
                >
                  🎓 Treinamento
                </span>
              ) : (
                <select
                  value={p.status}
                  onChange={(e) => updateStatus(p, e.target.value as CipaPendencia['status'])}
                  className={`shrink-0 rounded-full border-0 px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[p.status]}`}
                >
                  {Object.entries(STATUS_PENDENCIA_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        ))}
        {pendencias.length === 0 && <p className="text-sm text-brand-700">Nenhuma pendência registrada.</p>}
      </div>
    </div>
  );
}
