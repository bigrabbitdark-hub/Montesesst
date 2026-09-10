'use client';

import { FormEvent, useEffect, useState } from 'react';

interface EmployeeOption {
  id: string;
  full_name: string;
  status: string;
}

interface CompanyUnitOption {
  id: string;
  name: string;
}

interface DrillSummary {
  id: string;
  company_unit_id: string;
  data_realizacao: string;
}

interface DrillReport extends DrillSummary {
  horario: string | null;
  tempo_evacuacao_segundos: number | null;
  participantes_total: number;
  participantes_ausentes: number;
  brigadistas_presentes: number;
  nao_conformidades: number;
}

interface CorrectiveAction {
  id: string;
  drill_id: string | null;
  description: string;
  status: 'pendente' | 'resolvido';
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function formatSeconds(totalSeconds: number | null): string {
  if (totalSeconds === null) return '—';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}min${seconds.toString().padStart(2, '0')}s`;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

export function EmergencyDrillPanel() {
  const [drills, setDrills] = useState<DrillSummary[]>([]);
  const [selectedReport, setSelectedReport] = useState<DrillReport | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [units, setUnits] = useState<CompanyUnitOption[]>([]);
  const [correctiveActions, setCorrectiveActions] = useState<CorrectiveAction[]>([]);

  const [companyUnitId, setCompanyUnitId] = useState('');
  const [dataRealizacao, setDataRealizacao] = useState('');
  const [horario, setHorario] = useState('');
  const [tempoEvacuacao, setTempoEvacuacao] = useState('');
  const [pontoEncontroAdequado, setPontoEncontroAdequado] = useState(true);
  const [falhasSinalizacao, setFalhasSinalizacao] = useState(false);
  const [falhasIluminacao, setFalhasIluminacao] = useState(false);
  const [portasBloqueadas, setPortasBloqueadas] = useState(false);
  const [extintoresObstruidos, setExtintoresObstruidos] = useState(false);
  const [observacoes, setObservacoes] = useState('');
  const [presenca, setPresenca] = useState<Record<string, boolean>>({});
  const [createError, setCreateError] = useState('');

  async function loadDrills() {
    const res = await fetch('/api/emergency-drills', { headers: authHeaders() });
    if (res.ok) setDrills(await res.json());
  }

  async function loadEmployees() {
    const res = await fetch('/api/employees', { headers: authHeaders() });
    if (res.ok) {
      const all: EmployeeOption[] = await res.json();
      const active = all.filter((e) => e.status === 'ativo');
      setEmployees(active);
      setPresenca(Object.fromEntries(active.map((e) => [e.id, true])));
    }
  }

  async function loadUnits() {
    const res = await fetch('/api/company-units', { headers: authHeaders() });
    if (res.ok) setUnits(await res.json());
  }

  async function loadCorrectiveActions() {
    const res = await fetch('/api/prevention-corrective-actions', { headers: authHeaders() });
    if (res.ok) setCorrectiveActions(await res.json());
  }

  async function loadReport(id: string) {
    const res = await fetch(`/api/emergency-drills/${id}`, { headers: authHeaders() });
    if (res.ok) setSelectedReport(await res.json());
  }

  useEffect(() => {
    loadDrills();
    loadEmployees();
    loadUnits();
    loadCorrectiveActions();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError('');
    const res = await fetch('/api/emergency-drills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        company_unit_id: companyUnitId,
        data_realizacao: dataRealizacao,
        horario: horario || undefined,
        tempo_evacuacao_segundos: tempoEvacuacao ? parseInt(tempoEvacuacao, 10) : undefined,
        ponto_encontro_adequado: pontoEncontroAdequado,
        falhas_sinalizacao: falhasSinalizacao,
        falhas_iluminacao: falhasIluminacao,
        portas_bloqueadas: portasBloqueadas,
        extintores_obstruidos: extintoresObstruidos,
        observacoes: observacoes || undefined,
        participants: employees.map((emp) => ({ employee_id: emp.id, presente: presenca[emp.id] ?? true })),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setCreateError(body?.message ?? 'Não foi possível registrar o simulado.');
      return;
    }
    setCompanyUnitId('');
    setDataRealizacao('');
    setHorario('');
    setTempoEvacuacao('');
    setObservacoes('');
    setFalhasSinalizacao(false);
    setFalhasIluminacao(false);
    setPortasBloqueadas(false);
    setExtintoresObstruidos(false);
    loadDrills();
    loadCorrectiveActions();
  }

  async function handleResolve(actionId: string) {
    await fetch(`/api/prevention-corrective-actions/${actionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ status: 'resolvido' }),
    });
    loadCorrectiveActions();
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-md border border-brand-100 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Filial
            <select
              value={companyUnitId}
              onChange={(e) => setCompanyUnitId(e.target.value)}
              required
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
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Data
            <input
              type="date"
              value={dataRealizacao}
              onChange={(e) => setDataRealizacao(e.target.value)}
              required
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Horário
            <input
              type="time"
              value={horario}
              onChange={(e) => setHorario(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tempo de evacuação (segundos)
            <input
              type="number"
              min={0}
              value={tempoEvacuacao}
              onChange={(e) => setTempoEvacuacao(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-brand-900">
          <input
            type="checkbox"
            checked={pontoEncontroAdequado}
            onChange={(e) => setPontoEncontroAdequado(e.target.checked)}
          />
          Ponto de encontro adequado
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-brand-900">Problemas encontrados</span>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input type="checkbox" checked={falhasSinalizacao} onChange={(e) => setFalhasSinalizacao(e.target.checked)} />
            Falha de sinalização
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input type="checkbox" checked={falhasIluminacao} onChange={(e) => setFalhasIluminacao(e.target.checked)} />
            Falha de iluminação de emergência
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input type="checkbox" checked={portasBloqueadas} onChange={(e) => setPortasBloqueadas(e.target.checked)} />
            Porta de emergência bloqueada
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input
              type="checkbox"
              checked={extintoresObstruidos}
              onChange={(e) => setExtintoresObstruidos(e.target.checked)}
            />
            Extintor obstruído
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Observações
          <textarea
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-brand-900">Lista de presença</span>
          <div className="max-h-64 overflow-y-auto rounded-md border border-brand-100">
            {employees.map((emp) => (
              <label key={emp.id} className="flex items-center gap-2 border-b border-brand-50 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={presenca[emp.id] ?? true}
                  onChange={(e) => setPresenca({ ...presenca, [emp.id]: e.target.checked })}
                />
                {emp.full_name}
              </label>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700"
        >
          Registrar simulado
        </button>
        {createError && <p className="text-sm text-red-600">{createError}</p>}
      </form>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-brand-700">
            <th className="px-2 py-1">Data</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {drills.map((drill) => (
            <tr key={drill.id} className="border-t border-brand-50">
              <td className="px-2 py-1 font-medium text-brand-900">{formatDate(drill.data_realizacao)}</td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => loadReport(drill.id)}
                  className="text-xs text-brand-700 underline"
                >
                  Ver relatório
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedReport && (
        <div className="rounded-md border border-brand-100 p-4">
          <h2 className="text-lg font-semibold text-brand-900">
            Relatório do simulado de {formatDate(selectedReport.data_realizacao)}
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-brand-900">
                {formatSeconds(selectedReport.tempo_evacuacao_segundos)}
              </div>
              <div className="text-xs text-brand-700">Tempo de evacuação</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-brand-900">{selectedReport.participantes_total}</div>
              <div className="text-xs text-brand-700">Participantes</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-brand-900">{selectedReport.brigadistas_presentes}</div>
              <div className="text-xs text-brand-700">Brigadistas</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{selectedReport.nao_conformidades}</div>
              <div className="text-xs text-brand-700">Não conformidades</div>
            </div>
          </div>
        </div>
      )}

      {correctiveActions.filter((a) => a.drill_id).length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-brand-900">Ações corretivas de simulados</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {correctiveActions
              .filter((a) => a.drill_id)
              .map((action) => (
                <li key={action.id} className="flex items-center justify-between text-sm">
                  <span>{action.description}</span>
                  {action.status === 'pendente' ? (
                    <button
                      type="button"
                      onClick={() => handleResolve(action.id)}
                      className="text-xs text-brand-700 underline"
                    >
                      Marcar resolvido
                    </button>
                  ) : (
                    <span className="text-xs text-green-700">Resolvido</span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
