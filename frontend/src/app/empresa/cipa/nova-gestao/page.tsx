'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import { getSelectedCompanyUnitId } from '@/lib/cipa-types';

const DIAS_SEMANA = [
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
];

export default function NovaGestaoPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [ano, setAno] = useState(new Date().getFullYear());
  const [dataInicio, setDataInicio] = useState('');
  const [dataTermino, setDataTermino] = useState('');

  const [diaSemana, setDiaSemana] = useState<number | ''>('');
  const [horario, setHorario] = useState('');
  const [local, setLocal] = useState('');
  const [skipSugestao, setSkipSugestao] = useState(false);

  async function handleStep1(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const token = getToken();
    const user = getUser();
    const unitId = getSelectedCompanyUnitId();
    if (!token || !user || !unitId) {
      setError('Sessão inválida — recarregue a página.');
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/cipa/committees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          company_unit_id: unitId,
          ano,
          data_inicio: dataInicio,
          data_termino: dataTermino,
          responsavel_user_id: user.id,
        }),
      });
      if (!res.ok) {
        setError('Não foi possível criar a gestão. Confira as datas informadas.');
        return;
      }
      const data = await res.json();
      setCommitteeId(data.id);
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const token = getToken();
    try {
      const res = await fetch(`/api/cipa/committees/${committeeId}/generate-meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          dia_semana_preferido: skipSugestao || diaSemana === '' ? undefined : diaSemana,
          horario: horario || undefined,
          local: local || undefined,
        }),
      });
      if (!res.ok) {
        setError('Não foi possível gerar as reuniões.');
        return;
      }
      router.push('/empresa/cipa/reunioes');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">📅 Criar Calendário da CIPA</h1>
      <p className="mt-1 text-sm text-brand-700">Passo {step} de 2</p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {step === 1 && (
        <form onSubmit={handleStep1} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Ano
            <input
              type="number"
              required
              value={ano}
              onChange={(e) => setAno(Number(e.target.value))}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Data de início da gestão
            <input
              type="date"
              required
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Data de término da gestão
            <input
              type="date"
              required
              value={dataTermino}
              onChange={(e) => setDataTermino(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-[9px] bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Salvando...' : 'Continuar'}
          </button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={handleStep2} className="mt-6 flex flex-col gap-4">
          <p className="text-sm text-brand-700">
            As 12 reuniões ordinárias serão criadas. Você pode sugerir um padrão de data agora, ou pular e
            preencher cada data manualmente depois — nenhuma data fica definitiva sem sua confirmação.
          </p>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input type="checkbox" checked={skipSugestao} onChange={(e) => setSkipSugestao(e.target.checked)} />
            Pular sugestão de data (preencher cada reunião manualmente depois)
          </label>
          {!skipSugestao && (
            <>
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                Dia da semana preferido
                <select
                  value={diaSemana}
                  onChange={(e) => setDiaSemana(e.target.value === '' ? '' : Number(e.target.value))}
                  className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
                >
                  <option value="">Selecione...</option>
                  {DIAS_SEMANA.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                Horário
                <input
                  type="time"
                  value={horario}
                  onChange={(e) => setHorario(e.target.value)}
                  className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-brand-900">
                Local
                <input
                  type="text"
                  value={local}
                  onChange={(e) => setLocal(e.target.value)}
                  className="rounded-[9px] border-[1.5px] border-brand-100 px-4 py-3"
                />
              </label>
            </>
          )}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 rounded-[9px] bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? 'Gerando...' : 'Gerar as 12 reuniões'}
          </button>
        </form>
      )}
    </div>
  );
}
