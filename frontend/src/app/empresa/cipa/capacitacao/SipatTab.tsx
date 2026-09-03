'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';
import { CipaSipatActivity, CipaSipatEdition, formatDateBR, getSelectedCompanyUnitId } from '@/lib/cipa-types';

const STATUS_LABEL: Record<CipaSipatActivity['status'], string> = {
  planejada: 'Planejada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
};

const STATUS_CLASS: Record<CipaSipatActivity['status'], string> = {
  planejada: 'bg-brand-50 text-brand-700',
  realizada: 'bg-green-50 text-green-800',
  cancelada: 'bg-red-50 text-red-800',
};

export default function SipatTab() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [editions, setEditions] = useState<CipaSipatEdition[]>([]);
  const [selectedEditionId, setSelectedEditionId] = useState('');
  const [activities, setActivities] = useState<CipaSipatActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showEditionForm, setShowEditionForm] = useState(false);
  const [ano, setAno] = useState(new Date().getFullYear());
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFim, setPeriodoFim] = useState('');
  const [tema, setTema] = useState('');

  const [showActivityForm, setShowActivityForm] = useState(false);
  const [atividadeData, setAtividadeData] = useState('');
  const [titulo, setTitulo] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [publicoAlvo, setPublicoAlvo] = useState('');

  async function loadEditions() {
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
    const result: CipaSipatEdition[] = await fetch(`/api/cipa/sipat/editions?company_unit_id=${unitId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : []));
    setEditions(result);
    setReady(true);
    return result;
  }

  async function loadActivities(editionId: string) {
    const token = getToken();
    const result: CipaSipatActivity[] = await fetch(`/api/cipa/sipat/editions/${editionId}/activities`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : []));
    setActivities(result);
  }

  useEffect(() => {
    loadEditions().then((result) => {
      if (result && result.length > 0) {
        setSelectedEditionId(result[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedEditionId) {
      loadActivities(selectedEditionId);
    } else {
      setActivities([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEditionId]);

  async function handleCreateEdition(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const token = getToken();
    const unitId = getSelectedCompanyUnitId();
    try {
      const res = await fetch('/api/cipa/sipat/editions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_unit_id: unitId,
          ano,
          periodo_inicio: periodoInicio,
          periodo_fim: periodoFim,
          tema: tema || undefined,
        }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          setError('Já existe uma edição de SIPAT para este ano neste estabelecimento.');
        } else {
          setError('Não foi possível criar a edição de SIPAT.');
        }
        return;
      }
      const created: CipaSipatEdition = await res.json();
      setShowEditionForm(false);
      setPeriodoInicio('');
      setPeriodoFim('');
      setTema('');
      await loadEditions();
      setSelectedEditionId(created.id);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEdition(id: string) {
    if (!confirm('Apagar esta edição de SIPAT e todas as suas atividades? Não pode ser desfeito.')) return;
    const token = getToken();
    const res = await fetch(`/api/cipa/sipat/editions/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setSelectedEditionId('');
      await loadEditions();
    } else {
      setError('Não foi possível apagar a edição.');
    }
  }

  async function handleAddActivity(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const token = getToken();
    const res = await fetch(`/api/cipa/sipat/editions/${selectedEditionId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        data: atividadeData,
        titulo,
        responsavel: responsavel || undefined,
        publico_alvo: publicoAlvo || undefined,
      }),
    });
    if (res.ok) {
      setShowActivityForm(false);
      setAtividadeData('');
      setTitulo('');
      setResponsavel('');
      setPublicoAlvo('');
      await loadActivities(selectedEditionId);
    } else {
      setError('Não foi possível adicionar a atividade.');
    }
  }

  async function updateActivity(activityId: string, data: Record<string, unknown>) {
    const token = getToken();
    const res = await fetch(`/api/cipa/sipat/editions/${selectedEditionId}/activities/${activityId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setError(null);
      await loadActivities(selectedEditionId);
    } else {
      setError('Não foi possível atualizar a atividade.');
    }
  }

  if (!ready) {
    return <div className="py-8 text-center text-brand-700">Carregando...</div>;
  }

  if (!getSelectedCompanyUnitId()) {
    return <p className="text-sm text-brand-700">Selecione um estabelecimento pra ver a SIPAT.</p>;
  }

  const selectedEdition = editions.find((ed) => ed.id === selectedEditionId) ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Edição
          <select
            value={selectedEditionId}
            onChange={(e) => setSelectedEditionId(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
          >
            <option value="">Selecione...</option>
            {editions.map((ed) => (
              <option key={ed.id} value={ed.id}>
                SIPAT {ed.ano}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => setShowEditionForm(!showEditionForm)}
          className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + Nova edição
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {showEditionForm && (
        <form onSubmit={handleCreateEdition} className="mt-4 flex flex-col gap-3 rounded-lg border border-brand-100 p-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Ano
            <input
              type="number"
              required
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Início do período
              <input
                type="date"
                required
                value={periodoInicio}
                onChange={(e) => setPeriodoInicio(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Fim do período
              <input
                type="date"
                required
                value={periodoFim}
                onChange={(e) => setPeriodoFim(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tema (opcional)
            <input
              value={tema}
              onChange={(e) => setTema(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Criando...' : 'Criar edição'}
          </button>
        </form>
      )}

      {selectedEdition && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-brand-700">
              {formatDateBR(selectedEdition.periodo_inicio)} a {formatDateBR(selectedEdition.periodo_fim)}
              {selectedEdition.tema && ` · ${selectedEdition.tema}`}
            </p>
            <button onClick={() => handleDeleteEdition(selectedEdition.id)} className="text-xs text-red-600 hover:underline">
              Apagar edição
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {activities.map((a) => (
              <div key={a.id} className="rounded-md border border-brand-100 px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-brand-900">{a.titulo}</p>
                    <p className="mt-0.5 text-xs text-brand-700">
                      {formatDateBR(a.data)}
                      {a.responsavel && ` · ${a.responsavel}`}
                      {a.publico_alvo && ` · ${a.publico_alvo}`}
                      {a.numero_participantes !== null && ` · ${a.numero_participantes} participantes`}
                    </p>
                  </div>
                  <select
                    value={a.status}
                    onChange={(e) => updateActivity(a.id, { status: e.target.value })}
                    className={`shrink-0 rounded-full border-0 px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[a.status]}`}
                  >
                    {Object.entries(STATUS_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                {a.status === 'realizada' && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-brand-700">
                    Participantes:
                    <input
                      type="number"
                      min={0}
                      defaultValue={a.numero_participantes ?? ''}
                      onBlur={(e) => {
                        if (e.target.value !== String(a.numero_participantes ?? '')) {
                          updateActivity(a.id, { numero_participantes: Number(e.target.value) });
                        }
                      }}
                      className="w-20 rounded-[9px] border-[1.5px] border-brand-100 px-2 py-1"
                    />
                  </label>
                )}
              </div>
            ))}
            {activities.length === 0 && <p className="text-sm text-brand-700">Nenhuma atividade cadastrada.</p>}
          </div>

          <button
            onClick={() => setShowActivityForm(!showActivityForm)}
            className="mt-4 rounded-[9px] border border-brand-100 px-4 py-2 text-sm font-semibold text-brand-900 hover:bg-brand-50"
          >
            + Adicionar atividade
          </button>

          {showActivityForm && (
            <form onSubmit={handleAddActivity} className="mt-3 flex flex-col gap-3 rounded-lg border border-brand-100 p-4">
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                Data
                <input
                  type="date"
                  required
                  value={atividadeData}
                  onChange={(e) => setAtividadeData(e.target.value)}
                  className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                Título
                <input
                  required
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm text-brand-900">
                  Responsável (opcional)
                  <input
                    value={responsavel}
                    onChange={(e) => setResponsavel(e.target.value)}
                    className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-brand-900">
                  Público-alvo (opcional)
                  <input
                    value={publicoAlvo}
                    onChange={(e) => setPublicoAlvo(e.target.value)}
                    className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
                  />
                </label>
              </div>
              <button
                type="submit"
                className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Adicionar
              </button>
            </form>
          )}
        </div>
      )}

      {!selectedEdition && editions.length === 0 && (
        <p className="mt-6 text-sm text-brand-700">Nenhuma edição de SIPAT criada ainda.</p>
      )}
    </div>
  );
}
