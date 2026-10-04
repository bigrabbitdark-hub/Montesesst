'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getToken } from '@/lib/auth';
import { CipaCommittee, CipaMeeting, formatDateBR, getSelectedCompanyUnitId } from '@/lib/cipa-types';
import { NovaExtraordinariaForm } from './NovaExtraordinariaForm';

const STATUS_LABEL: Record<CipaMeeting['status'], string> = {
  planejada: 'Planejada',
  agendada: 'Agendada',
  realizada: 'Realizada',
  cancelada: 'Cancelada',
  reagendada: 'Reagendada',
};

const STATUS_CLASS: Record<CipaMeeting['status'], string> = {
  planejada: 'bg-brand-50 text-brand-700',
  agendada: 'bg-amber-50 text-amber-800',
  realizada: 'bg-green-50 text-green-800',
  cancelada: 'bg-red-50 text-red-800',
  reagendada: 'bg-amber-50 text-amber-800',
};

type View = 'lista' | 'mensal' | 'anual';

const MES_LABEL = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// Achado da revisão final (Fix 3 — Important): calendários da CIPA não são
// alinhados ao ano civil — suggestedMeetingDates (committees.service.ts)
// gera 12 meses consecutivos a partir de data_inicio, que pode cair em
// qualquer mês (ex.: começando maio/2026, termina abril/2027). Formata uma
// chave 'YYYY-MM' como "Maio de 2026".
function formatMesAno(key: string): string {
  const mes = Number(key.slice(5, 7)) - 1;
  const ano = key.slice(0, 4);
  return `${MES_LABEL[mes]} de ${ano}`;
}

export default function ReunioesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [committee, setCommittee] = useState<CipaCommittee | null>(null);
  const [meetings, setMeetings] = useState<CipaMeeting[]>([]);
  const [view, setView] = useState<View>('lista');
  const [showForm, setShowForm] = useState(false);

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
    const headers = { Authorization: `Bearer ${token}` };
    const committees = await fetch(`/api/cipa/committees?company_unit_id=${unitId}`, { headers }).then((r) =>
      r.ok ? r.json() : [],
    );
    const active: CipaCommittee | null = committees.find((c: CipaCommittee) => c.status === 'ativa') ?? committees[0] ?? null;
    setCommittee(active);
    if (active) {
      const meetingsData = await fetch(`/api/cipa/meetings?committee_id=${active.id}`, { headers }).then((r) =>
        r.ok ? r.json() : [],
      );
      setMeetings(meetingsData);
    }
    setReady(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) {
    return <div className="px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  if (!committee) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-brand-700">
          Nenhuma gestão da CIPA ainda.{' '}
          <Link href="/empresa/cipa/nova-gestao" className="font-semibold text-brand-900 underline">
            Criar calendário
          </Link>
        </p>
      </div>
    );
  }

  const ordinarias = [...meetings].filter((m) => m.tipo === 'ordinaria').sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));
  const extraordinarias = meetings.filter((m) => m.tipo === 'extraordinaria');
  // Achado da revisão final (Fix 3 — Important): a chave era o número do
  // mês (1-12) sem o ano, então um calendário que atravessa a virada do
  // ano (ex.: maio/2026 a abril/2027) misturava dois anos diferentes sob o
  // mesmo rótulo "Mês N" e ordenava numericamente — jan/2027 (chave 1)
  // aparecia ANTES de mai/2026 (chave 5). Chave 'YYYY-MM' ordena
  // corretamente como string e mantém o ano visível no rótulo.
  const porMes: Record<string, CipaMeeting[]> = {};
  for (const m of meetings) {
    if (!m.data) continue;
    const chave = m.data.slice(0, 7);
    porMes[chave] = [...(porMes[chave] ?? []), m];
  }

  function MeetingRow({ m }: { m: CipaMeeting }) {
    const titulo = m.tipo === 'ordinaria' ? `${m.numero}ª Reunião Ordinária` : m.titulo;
    return (
      <Link
        href={`/empresa/cipa/reunioes/${m.id}`}
        className="flex items-center justify-between gap-4 rounded-md border border-brand-100 px-4 py-3 hover:border-brand-500"
      >
        <div>
          <p className="text-sm font-medium text-brand-900">{titulo}</p>
          <p className="mt-0.5 text-xs text-brand-700">{m.data ? formatDateBR(m.data) : 'Sem data definida'}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[m.status]}`}>
          {STATUS_LABEL[m.status]}
        </span>
      </Link>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-900">📅 Reuniões da CIPA</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          ⚠️ Reunião extraordinária
        </button>
      </div>

      {showForm && (
        <NovaExtraordinariaForm
          committeeId={committee.id}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="mt-6 flex gap-2">
        {(['lista', 'mensal', 'anual'] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={
              view === v
                ? 'rounded-md bg-brand-50 px-3 py-1.5 text-sm font-semibold text-brand-900'
                : 'rounded-md px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50'
            }
          >
            {v === 'lista' ? 'Lista' : v === 'mensal' ? 'Mensal' : 'Anual'}
          </button>
        ))}
      </div>

      {view === 'lista' && (
        <div className="mt-6 flex flex-col gap-2">
          {[...ordinarias, ...extraordinarias]
            .sort((a, b) => (a.data ?? '9999') < (b.data ?? '9999') ? -1 : 1)
            .map((m) => (
              <MeetingRow key={m.id} m={m} />
            ))}
        </div>
      )}

      {view === 'anual' && (
        <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {ordinarias.map((m) => (
            <MeetingRow key={m.id} m={m} />
          ))}
        </div>
      )}

      {view === 'mensal' && (
        <div className="mt-6 flex flex-col gap-6">
          {Object.entries(porMes)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([chave, ms]) => (
              <div key={chave}>
                <p className="text-xs font-bold uppercase tracking-wide text-brand-500">{formatMesAno(chave)}</p>
                <div className="mt-2 flex flex-col gap-2">
                  {ms.map((m) => (
                    <MeetingRow key={m.id} m={m} />
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
