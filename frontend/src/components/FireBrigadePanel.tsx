'use client';

import { Fragment, FormEvent, useEffect, useState } from 'react';

interface Member {
  id: string;
  employee_id: string;
  employee_full_name: string;
  position_name: string | null;
  company_unit_id: string;
  funcao_brigada: string;
  turno: string | null;
  telefone: string | null;
  status: string;
  training_status: 'vencido' | 'vencendo' | 'treinado';
}

interface EmployeeOption {
  id: string;
  full_name: string;
  status: string;
}

interface CompanyUnitOption {
  id: string;
  name: string;
  is_matriz: boolean;
}

interface Coverage {
  necessarios: number;
  ativos: number;
  treinados: number;
  vencendo: number;
  vencido: number;
  vagas_necessarias: number;
}

const FUNCAO_LABEL: Record<string, string> = {
  lider: 'Líder',
  vice_lider: 'Vice-líder',
  brigadista: 'Brigadista',
};

const TRAINING_STATUS_LABEL: Record<Member['training_status'], { emoji: string; text: string; className: string }> = {
  treinado: { emoji: '🟢', text: 'Treinado', className: 'text-green-700' },
  vencendo: { emoji: '🟡', text: 'Vencendo', className: 'text-amber-700' },
  vencido: { emoji: '🔴', text: 'Vencido', className: 'text-red-600' },
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

export function FireBrigadePanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [units, setUnits] = useState<CompanyUnitOption[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [targetInput, setTargetInput] = useState('');

  const [employeeId, setEmployeeId] = useState('');
  const [companyUnitId, setCompanyUnitId] = useState('');
  const [funcaoBrigada, setFuncaoBrigada] = useState('brigadista');
  const [turno, setTurno] = useState('');
  const [telefone, setTelefone] = useState('');
  const [createError, setCreateError] = useState('');

  const [trainingFormMemberId, setTrainingFormMemberId] = useState<string | null>(null);
  const [trainingDataRealizacao, setTrainingDataRealizacao] = useState('');
  const [trainingDataValidade, setTrainingDataValidade] = useState('');
  const [trainingCargaHoraria, setTrainingCargaHoraria] = useState('');
  const [trainingFile, setTrainingFile] = useState<File | null>(null);
  const [trainingError, setTrainingError] = useState('');

  async function loadMembers() {
    const res = await fetch('/api/fire-brigade/members', { headers: authHeaders() });
    if (res.ok) setMembers(await res.json());
  }

  async function loadEmployees() {
    const res = await fetch('/api/employees', { headers: authHeaders() });
    if (res.ok) {
      const all: EmployeeOption[] = await res.json();
      setEmployees(all.filter((e) => e.status === 'ativo'));
    }
  }

  async function loadUnits() {
    const res = await fetch('/api/company-units', { headers: authHeaders() });
    if (res.ok) setUnits(await res.json());
  }

  async function loadCoverage(unitId: string) {
    if (!unitId) {
      setCoverage(null);
      return;
    }
    const res = await fetch(`/api/fire-brigade/coverage?company_unit_id=${unitId}`, { headers: authHeaders() });
    if (res.ok) setCoverage(await res.json());
  }

  useEffect(() => {
    loadMembers();
    loadEmployees();
    loadUnits();
  }, []);

  useEffect(() => {
    loadCoverage(selectedUnitId);
  }, [selectedUnitId]);

  useEffect(() => {
    if (!selectedUnitId && units.length > 0) {
      setSelectedUnitId(units[0].id);
    }
  }, [units, selectedUnitId]);

  function unitName(id: string): string {
    return units.find((u) => u.id === id)?.name ?? '—';
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError('');
    const res = await fetch('/api/fire-brigade/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        employee_id: employeeId,
        company_unit_id: companyUnitId,
        funcao_brigada: funcaoBrigada,
        turno: turno || undefined,
        telefone: telefone || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setCreateError(body?.message ?? 'Não foi possível cadastrar o brigadista.');
      return;
    }
    setEmployeeId('');
    setCompanyUnitId('');
    setTurno('');
    setTelefone('');
    loadMembers();
    loadCoverage(selectedUnitId);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/fire-brigade/members/${id}`, { method: 'DELETE', headers: authHeaders() });
    loadMembers();
    loadCoverage(selectedUnitId);
  }

  function openTrainingForm(memberId: string) {
    setTrainingFormMemberId(memberId);
    setTrainingDataRealizacao('');
    setTrainingDataValidade('');
    setTrainingCargaHoraria('');
    setTrainingFile(null);
    setTrainingError('');
  }

  async function handleRegisterTraining(e: FormEvent) {
    e.preventDefault();
    if (!trainingFormMemberId) return;
    setTrainingError('');

    const formData = new FormData();
    formData.append('data_realizacao', trainingDataRealizacao);
    formData.append('data_validade', trainingDataValidade);
    if (trainingCargaHoraria) formData.append('carga_horaria', trainingCargaHoraria);
    if (trainingFile) formData.append('certificado', trainingFile);

    const res = await fetch(`/api/fire-brigade/members/${trainingFormMemberId}/trainings`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setTrainingError(body?.message ?? 'Não foi possível registrar o treinamento.');
      return;
    }
    setTrainingFormMemberId(null);
    loadMembers();
    loadCoverage(selectedUnitId);
  }

  async function handleSaveTarget(e: FormEvent) {
    e.preventDefault();
    if (!selectedUnitId || !targetInput) return;
    await fetch('/api/fire-brigade/coverage-target', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ company_unit_id: selectedUnitId, quantidade_necessaria: parseInt(targetInput, 10) }),
    });
    setTargetInput('');
    loadCoverage(selectedUnitId);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-md border border-brand-100 p-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Filial
          <select
            value={selectedUnitId}
            onChange={(e) => setSelectedUnitId(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          >
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>

        {coverage && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="text-center">
              <div className="text-2xl font-bold text-brand-900">{coverage.necessarios}</div>
              <div className="text-xs text-brand-700">Necessários</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-700">{coverage.ativos}</div>
              <div className="text-xs text-brand-700">Ativos</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-700">{coverage.treinados}</div>
              <div className="text-xs text-brand-700">Treinados</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-700">{coverage.vencendo}</div>
              <div className="text-xs text-brand-700">Vencendo</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{coverage.vagas_necessarias}</div>
              <div className="text-xs text-brand-700">Vagas necessárias</div>
            </div>
          </div>
        )}

        <form onSubmit={handleSaveTarget} className="mt-4 flex items-end gap-2">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Meta de brigadistas necessários nesta filial
            <input
              type="number"
              min={0}
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="w-32 rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <button type="submit" className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Salvar meta
          </button>
        </form>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-md border border-brand-100 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Funcionário
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              required
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              <option value="">Selecione</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name}
                </option>
              ))}
            </select>
          </label>
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
            Função na brigada
            <select
              value={funcaoBrigada}
              onChange={(e) => setFuncaoBrigada(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              <option value="lider">Líder</option>
              <option value="vice_lider">Vice-líder</option>
              <option value="brigadista">Brigadista</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Turno
            <input
              value={turno}
              onChange={(e) => setTurno(e.target.value)}
              placeholder="Ex.: Manhã"
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Telefone
            <input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
        </div>
        <button
          type="submit"
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700"
        >
          Cadastrar brigadista
        </button>
        {createError && <p className="text-sm text-red-600">{createError}</p>}
      </form>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-brand-700">
            <th className="px-2 py-1">Nome</th>
            <th className="px-2 py-1">Função</th>
            <th className="px-2 py-1">Filial</th>
            <th className="px-2 py-1">Turno</th>
            <th className="px-2 py-1">Telefone</th>
            <th className="px-2 py-1">Treinamento</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <Fragment key={member.id}>
              <tr className="border-t border-brand-50">
                <td className="px-2 py-1 font-medium text-brand-900">{member.employee_full_name}</td>
                <td className="px-2 py-1">{FUNCAO_LABEL[member.funcao_brigada] ?? member.funcao_brigada}</td>
                <td className="px-2 py-1">{unitName(member.company_unit_id)}</td>
                <td className="px-2 py-1">{member.turno ?? '—'}</td>
                <td className="px-2 py-1">{member.telefone ?? '—'}</td>
                <td className={`px-2 py-1 ${TRAINING_STATUS_LABEL[member.training_status].className}`}>
                  {TRAINING_STATUS_LABEL[member.training_status].emoji} {TRAINING_STATUS_LABEL[member.training_status].text}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => openTrainingForm(member.id)}
                    className="mr-2 text-xs text-brand-700 underline"
                  >
                    Registrar treinamento
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(member.id)}
                    className="text-xs text-red-600 underline"
                  >
                    Excluir
                  </button>
                </td>
              </tr>
              {trainingFormMemberId === member.id && (
                <tr className="border-t border-brand-50 bg-brand-50/40">
                  <td colSpan={7} className="px-2 py-3">
                    <form onSubmit={handleRegisterTraining} className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1 text-sm text-brand-900">
                        Data de realização
                        <input
                          type="date"
                          required
                          value={trainingDataRealizacao}
                          onChange={(e) => setTrainingDataRealizacao(e.target.value)}
                          className="rounded-md border border-brand-100 px-3 py-2"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm text-brand-900">
                        Validade
                        <input
                          type="date"
                          required
                          value={trainingDataValidade}
                          onChange={(e) => setTrainingDataValidade(e.target.value)}
                          className="rounded-md border border-brand-100 px-3 py-2"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm text-brand-900">
                        Carga horária
                        <input
                          type="number"
                          min={0}
                          value={trainingCargaHoraria}
                          onChange={(e) => setTrainingCargaHoraria(e.target.value)}
                          className="w-24 rounded-md border border-brand-100 px-3 py-2"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm text-brand-900">
                        Certificado (opcional)
                        <input
                          type="file"
                          accept="application/pdf,image/jpeg,image/png"
                          onChange={(e) => setTrainingFile(e.target.files?.[0] ?? null)}
                        />
                      </label>
                      <button
                        type="submit"
                        className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={() => setTrainingFormMemberId(null)}
                        className="text-sm text-brand-700 underline"
                      >
                        Cancelar
                      </button>
                      {trainingError && <p className="w-full text-sm text-red-600">{trainingError}</p>}
                    </form>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
