'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, getUser } from '@/lib/auth';
import {
  CipaTraining,
  Employee,
  TRAINING_TYPE_LABEL,
  TRAINING_TYPES,
  TRAINING_VALIDITY_MONTHS,
  TrainingType,
  formatDateBR,
} from '@/lib/cipa-types';

const STATUS_CLASS: Record<CipaTraining['status'], string> = {
  valido: 'bg-green-50 text-green-800',
  vencendo: 'bg-amber-50 text-amber-800',
  vencido: 'bg-red-50 text-red-800',
};

const STATUS_LABEL: Record<CipaTraining['status'], string> = {
  valido: 'Válido',
  vencendo: 'Vencendo',
  vencido: 'Vencido',
};

export default function TreinamentosTab() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [trainings, setTrainings] = useState<CipaTraining[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [employeeId, setEmployeeId] = useState('');
  const [tipo, setTipo] = useState<TrainingType>('nr-05');
  const [tipoOutro, setTipoOutro] = useState('');
  const [dataRealizacao, setDataRealizacao] = useState('');
  const [dataValidade, setDataValidade] = useState('');
  const [cargaHoraria, setCargaHoraria] = useState('');
  const [certificado, setCertificado] = useState<File | null>(null);

  async function load() {
    const token = getToken();
    const user = getUser();
    if (!token || !user) {
      router.push('/login');
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const params = new URLSearchParams();
    if (filterEmployeeId) params.set('employee_id', filterEmployeeId);
    if (filterTipo) params.set('tipo', filterTipo);
    if (filterStatus) params.set('status', filterStatus);
    const [trainingsData, employeesData] = await Promise.all([
      fetch(`/api/cipa/trainings?${params.toString()}`, { headers }).then((r) => (r.ok ? r.json() : [])),
      fetch(`/api/employees?tenant_id=${user.tenantId}`, { headers }).then((r) => (r.ok ? r.json() : [])),
    ]);
    setTrainings(trainingsData);
    setEmployees(employeesData.filter((e: Employee) => e.status === 'ativo'));
    setReady(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterEmployeeId, filterTipo, filterStatus]);

  function suggestValidade(realizacao: string, tipoSelecionado: TrainingType) {
    if (!realizacao || tipoSelecionado === 'outro') return;
    const months = TRAINING_VALIDITY_MONTHS[tipoSelecionado];
    const d = new Date(`${realizacao}T00:00:00`);
    d.setMonth(d.getMonth() + months);
    setDataValidade(d.toISOString().slice(0, 10));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const token = getToken();
    try {
      const formData = new FormData();
      formData.set('employee_id', employeeId);
      formData.set('tipo', tipo);
      if (tipo === 'outro') formData.set('tipo_outro', tipoOutro);
      formData.set('data_realizacao', dataRealizacao);
      formData.set('data_validade', dataValidade);
      if (cargaHoraria) formData.set('carga_horaria', cargaHoraria);
      if (certificado) formData.set('certificado', certificado);

      const res = await fetch('/api/cipa/trainings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        setError('Não foi possível registrar o treinamento. Confira os campos.');
        return;
      }
      setShowForm(false);
      setEmployeeId('');
      setTipoOutro('');
      setDataRealizacao('');
      setDataValidade('');
      setCargaHoraria('');
      setCertificado(null);
      await load();
    } catch {
      setError('Falha de conexão ao enviar o treinamento.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Apagar este registro de treinamento?')) return;
    const token = getToken();
    const res = await fetch(`/api/cipa/trainings/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      await load();
    } else {
      setError('Não foi possível apagar o registro.');
    }
  }

  async function handleDownload(documentId: string) {
    const token = getToken();
    const res = await fetch(`/api/documents/${documentId}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setError('Não foi possível gerar o link do certificado.');
      return;
    }
    const { url } = await res.json();
    window.open(url, '_blank');
  }

  if (!ready) {
    return <div className="py-8 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <select
            value={filterEmployeeId}
            onChange={(e) => setFilterEmployeeId(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2 text-sm"
          >
            <option value="">Todos os funcionários</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.full_name}
              </option>
            ))}
          </select>
          <select
            value={filterTipo}
            onChange={(e) => setFilterTipo(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2 text-sm"
          >
            <option value="">Todos os tipos</option>
            {TRAINING_TYPES.map((t) => (
              <option key={t} value={t}>
                {TRAINING_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2 text-sm"
          >
            <option value="">Todos os status</option>
            <option value="valido">Válido</option>
            <option value="vencendo">Vencendo</option>
            <option value="vencido">Vencido</option>
          </select>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + Novo treinamento
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {showForm && (
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-3 rounded-lg border border-brand-100 p-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Funcionário
            <select
              required
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            >
              <option value="">Selecione...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tipo
            <select
              value={tipo}
              onChange={(e) => {
                const value = e.target.value as TrainingType;
                setTipo(value);
                suggestValidade(dataRealizacao, value);
              }}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            >
              {TRAINING_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TRAINING_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          {tipo === 'outro' && (
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Nome do treinamento
              <input
                required
                value={tipoOutro}
                onChange={(e) => setTipoOutro(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Data de realização
              <input
                type="date"
                required
                value={dataRealizacao}
                onChange={(e) => {
                  setDataRealizacao(e.target.value);
                  suggestValidade(e.target.value, tipo);
                }}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Válido até
              <input
                type="date"
                required
                value={dataValidade}
                onChange={(e) => setDataValidade(e.target.value)}
                className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Carga horária (opcional)
            <input
              type="number"
              min={0}
              value={cargaHoraria}
              onChange={(e) => setCargaHoraria(e.target.value)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Certificado (opcional, PDF/JPG/PNG)
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => setCertificado(e.target.files?.[0] ?? null)}
              className="rounded-[9px] border-[1.5px] border-brand-100 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="self-start rounded-[9px] bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Registrar treinamento'}
          </button>
        </form>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {trainings.map((t) => (
          <div key={t.id} className="rounded-md border border-brand-100 px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-brand-900">
                  {t.tipo === 'outro' ? t.tipo_outro : TRAINING_TYPE_LABEL[t.tipo]} — {t.employee_full_name}
                </p>
                <p className="mt-0.5 text-xs text-brand-700">
                  Realizado em {formatDateBR(t.data_realizacao)} · Válido até {formatDateBR(t.data_validade)}
                  {t.carga_horaria ? ` · ${t.carga_horaria}h` : ''}
                </p>
                {t.certificado_document_id && (
                  <button
                    onClick={() => handleDownload(t.certificado_document_id as string)}
                    className="mt-1 text-xs font-semibold text-brand-500 hover:underline"
                  >
                    📎 Ver certificado
                  </button>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[t.status]}`}>
                  {STATUS_LABEL[t.status]}
                </span>
                <button onClick={() => handleDelete(t.id)} className="text-xs text-red-600 hover:underline">
                  Apagar
                </button>
              </div>
            </div>
          </div>
        ))}
        {trainings.length === 0 && <p className="text-sm text-brand-700">Nenhum treinamento registrado.</p>}
      </div>
    </div>
  );
}
