'use client';

import { useEffect, useState } from 'react';

interface VisitRequest {
  id: string;
  tenant_id: string;
  status: 'solicitado' | 'confirmado' | 'concluido' | 'cancelado';
  type: 'reuniao' | 'visita';
  preferred_date: string | null;
  preferred_time: string | null;
  confirmed_date: string | null;
  confirmed_time: string | null;
  motivo: string | null;
  google_meet_link: string | null;
}

interface MyDayResult {
  visitas: {
    proximas: VisitRequest[];
    pendentes_de_confirmar: VisitRequest[];
  };
}

const TYPE_LABELS: Record<string, string> = { reuniao: 'Reunião', visita: 'Visita' };

export default function TecnicoAgendamentosPage() {
  const [data, setData] = useState<MyDayResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDates, setConfirmDates] = useState<Record<string, string>>({});
  const [confirmTimes, setConfirmTimes] = useState<Record<string, string>>({});

  function load() {
    const token = localStorage.getItem('montese_token');
    fetch('/api/visits/me/day', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        setError('Não foi possível carregar a agenda.');
        setLoading(false);
      });
  }

  useEffect(() => {
    load();
  }, []);

  async function handleConfirmar(visitId: string) {
    const token = localStorage.getItem('montese_token');
    const res = await fetch(`/api/visits/${visitId}/confirmar`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        confirmed_date: confirmDates[visitId],
        confirmed_time: confirmTimes[visitId] || undefined,
      }),
    });
    if (res.ok) {
      load();
    } else {
      setError('Não foi possível confirmar.');
    }
  }

  async function handleCancelar(visitId: string) {
    const token = localStorage.getItem('montese_token');
    const res = await fetch(`/api/visits/${visitId}/cancelar`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) load();
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Agenda</h1>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <section className="mt-6">
        <h2 className="text-lg font-bold text-brand-900">Pedidos pendentes de confirmar</h2>
        {data?.visitas.pendentes_de_confirmar.length === 0 ? (
          <p className="mt-2 text-sm text-brand-700">Nenhum pedido pendente.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {data?.visitas.pendentes_de_confirmar.map((visit) => (
              <li key={visit.id} className="rounded-md border border-brand-100 p-4">
                <p className="text-sm font-medium text-brand-900">
                  {TYPE_LABELS[visit.type]} — sugerido: {visit.preferred_date} {visit.preferred_time ?? ''}
                </p>
                {visit.motivo && <p className="mt-1 text-sm text-brand-700">{visit.motivo}</p>}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="flex flex-col gap-1 text-xs text-brand-900">
                    Confirmar data
                    <input
                      type="date"
                      defaultValue={visit.preferred_date ?? ''}
                      onChange={(e) => setConfirmDates((prev) => ({ ...prev, [visit.id]: e.target.value }))}
                      className="rounded-md border border-brand-100 px-3 py-2"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-brand-900">
                    Horário
                    <input
                      type="time"
                      defaultValue={visit.preferred_time ?? ''}
                      onChange={(e) => setConfirmTimes((prev) => ({ ...prev, [visit.id]: e.target.value }))}
                      className="rounded-md border border-brand-100 px-3 py-2"
                    />
                  </label>
                  <button
                    onClick={() => handleConfirmar(visit.id)}
                    className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    Confirmar
                  </button>
                  <button
                    onClick={() => handleCancelar(visit.id)}
                    className="text-sm font-medium text-red-600 hover:underline"
                  >
                    Recusar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-brand-900">Próximos compromissos</h2>
        {data?.visitas.proximas.length === 0 ? (
          <p className="mt-2 text-sm text-brand-700">Nada nos próximos 7 dias.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-sm text-brand-700">
            {data?.visitas.proximas.map((visit) => (
              <li key={visit.id} className="rounded-md border border-brand-100 p-3">
                <span className="font-medium text-brand-900">{TYPE_LABELS[visit.type]}</span> —{' '}
                {visit.confirmed_date} {visit.confirmed_time ?? ''}
                {visit.motivo ? ` — ${visit.motivo}` : ''}
                {visit.google_meet_link && (
                  <a
                    href={visit.google_meet_link}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 font-medium text-brand-500 hover:underline"
                  >
                    Entrar no Meet
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
