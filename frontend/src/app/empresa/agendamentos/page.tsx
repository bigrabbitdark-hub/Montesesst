'use client';

import { useEffect, useState } from 'react';

interface Technician {
  user_id: string;
  full_name: string;
  role: 'tecnico' | 'parceiro';
}

interface CompanyUnit {
  id: string;
  name: string;
}

interface VisitRequest {
  id: string;
  status: 'solicitado' | 'confirmado' | 'concluido' | 'cancelado';
  type: 'reuniao' | 'visita';
  preferred_date: string | null;
  preferred_time: string | null;
  confirmed_date: string | null;
  confirmed_time: string | null;
  motivo: string | null;
  google_meet_link: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  solicitado: 'Aguardando confirmação',
  confirmado: 'Confirmado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

export default function EmpresaAgendamentosPage() {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [units, setUnits] = useState<CompanyUnit[]>([]);
  const [visits, setVisits] = useState<VisitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const [technicianUserId, setTechnicianUserId] = useState('');
  const [type, setType] = useState<'reuniao' | 'visita'>('reuniao');
  const [preferredDate, setPreferredDate] = useState('');
  const [preferredTime, setPreferredTime] = useState('');
  const [companyUnitId, setCompanyUnitId] = useState('');
  const [motivo, setMotivo] = useState('');

  function loadAll() {
    const token = localStorage.getItem('montese_token');
    Promise.all([
      fetch('/api/tenant-technicians/minha-empresa', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/company-units', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/visits', { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(async ([techRes, unitsRes, visitsRes]) => {
        if (techRes.ok) setTechnicians(await techRes.json());
        if (unitsRes.ok) setUnits(await unitsRes.json());
        if (visitsRes.ok) setVisits(await visitsRes.json());
        setLoading(false);
      })
      .catch(() => {
        setError('Não foi possível carregar a página.');
        setLoading(false);
      });
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSolicitar() {
    if (!technicianUserId) {
      setError('Selecione um técnico ou parceiro.');
      return;
    }
    if (type === 'visita' && !companyUnitId) {
      setError('Selecione a filial para uma visita.');
      return;
    }
    setCreating(true);
    setError('');
    const token = localStorage.getItem('montese_token');
    const res = await fetch('/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        technician_user_id: technicianUserId,
        type,
        preferred_date: preferredDate || undefined,
        preferred_time: preferredTime || undefined,
        company_unit_id: type === 'visita' ? companyUnitId : undefined,
        motivo: motivo || undefined,
      }),
    });
    if (res.ok) {
      setPreferredDate('');
      setPreferredTime('');
      setMotivo('');
      loadAll();
    } else {
      setError('Não foi possível enviar o pedido.');
    }
    setCreating(false);
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Reuniões e Visitas</h1>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Solicitar reunião ou visita</h2>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Técnico ou parceiro
            <select
              value={technicianUserId}
              onChange={(e) => setTechnicianUserId(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              <option value="">Selecione</option>
              {technicians.map((t) => (
                <option key={t.user_id} value={t.user_id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tipo
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'reuniao' | 'visita')}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              <option value="reuniao">Reunião (virtual, com Google Meet)</option>
              <option value="visita">Visita (presencial)</option>
            </select>
          </label>
          {type === 'visita' && (
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Filial
              <select
                value={companyUnitId}
                onChange={(e) => setCompanyUnitId(e.target.value)}
                className="rounded-md border border-brand-100 px-3 py-2"
              >
                <option value="">Selecione</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1 text-sm text-brand-900">
              Data preferida
              <input
                type="date"
                value={preferredDate}
                onChange={(e) => setPreferredDate(e.target.value)}
                className="rounded-md border border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm text-brand-900">
              Horário preferido
              <input
                type="time"
                value={preferredTime}
                onChange={(e) => setPreferredTime(e.target.value)}
                className="rounded-md border border-brand-100 px-3 py-2"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Motivo
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Descreva o motivo (opcional)"
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <button
            onClick={handleSolicitar}
            disabled={creating}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {creating ? 'Enviando...' : 'Solicitar'}
          </button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-brand-900">Suas solicitações</h2>
        {visits.length === 0 ? (
          <p className="mt-2 text-sm text-brand-700">Nenhuma solicitação ainda.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {visits.map((visit) => (
              <li key={visit.id} className="rounded-md border border-brand-100 p-3 text-sm text-brand-700">
                <span className="font-medium text-brand-900">{STATUS_LABELS[visit.status]}</span> —{' '}
                {visit.type === 'reuniao' ? 'Reunião' : 'Visita'} —{' '}
                {visit.confirmed_date ?? visit.preferred_date} {visit.confirmed_time ?? visit.preferred_time ?? ''}
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
