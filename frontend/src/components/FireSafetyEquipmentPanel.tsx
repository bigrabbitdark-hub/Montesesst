'use client';

import { FormEvent, useEffect, useState } from 'react';

interface Equipment {
  id: string;
  tipo: string;
  codigo: string;
  company_unit_id: string | null;
  localizacao: string | null;
  proxima_manutencao: string | null;
  agente_extintor: string | null;
  capacidade: string | null;
  classe_fogo: string | null;
  status: 'regular' | 'vencendo' | 'vencido';
  foto_r2_key: string | null;
}

interface CompanyUnitOption {
  id: string;
  name: string;
  is_matriz: boolean;
}

const EQUIPMENT_TYPES = [
  'extintor', 'hidrante', 'mangueira', 'alarme', 'detector',
  'iluminacao_emergencia', 'saida_emergencia', 'porta_corta_fogo',
  'sprinkler', 'central_alarme', 'outro',
] as const;

const EQUIPMENT_TYPE_LABEL: Record<string, string> = {
  extintor: 'Extintor',
  hidrante: 'Hidrante',
  mangueira: 'Mangueira',
  alarme: 'Alarme',
  detector: 'Detector',
  iluminacao_emergencia: 'Iluminação de emergência',
  saida_emergencia: 'Saída de emergência',
  porta_corta_fogo: 'Porta corta-fogo',
  sprinkler: 'Sprinkler',
  central_alarme: 'Central de alarme',
  outro: 'Outro',
};

const STATUS_LABEL: Record<Equipment['status'], { emoji: string; text: string; className: string }> = {
  regular: { emoji: '🟢', text: 'Regular', className: 'text-green-700' },
  vencendo: { emoji: '🟡', text: 'Vencendo', className: 'text-amber-700' },
  vencido: { emoji: '🔴', text: 'Vencido', className: 'text-red-600' },
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function FireSafetyEquipmentPanel() {
  const [items, setItems] = useState<Equipment[]>([]);
  const [units, setUnits] = useState<CompanyUnitOption[]>([]);
  const [tipo, setTipo] = useState<string>('extintor');
  const [codigo, setCodigo] = useState('');
  const [companyUnitId, setCompanyUnitId] = useState('');
  const [localizacao, setLocalizacao] = useState('');
  const [proximaManutencao, setProximaManutencao] = useState('');
  const [agenteExtintor, setAgenteExtintor] = useState('');
  const [capacidade, setCapacidade] = useState('');
  const [classeFogo, setClasseFogo] = useState('');
  const [createError, setCreateError] = useState('');
  const [filterTipo, setFilterTipo] = useState('');

  async function loadItems() {
    const res = await fetch('/api/fire-safety-equipment', { headers: authHeaders() });
    if (res.ok) setItems(await res.json());
  }

  async function loadUnits() {
    const res = await fetch('/api/company-units', { headers: authHeaders() });
    if (res.ok) setUnits(await res.json());
  }

  useEffect(() => {
    loadItems();
    loadUnits();
  }, []);

  function unitName(companyUnitIdValue: string | null): string {
    if (!companyUnitIdValue) return '—';
    return units.find((unit) => unit.id === companyUnitIdValue)?.name ?? '—';
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError('');
    const res = await fetch('/api/fire-safety-equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        tipo,
        codigo,
        company_unit_id: companyUnitId || undefined,
        localizacao: localizacao || undefined,
        proxima_manutencao: proximaManutencao || undefined,
        agente_extintor: tipo === 'extintor' ? agenteExtintor || undefined : undefined,
        capacidade: tipo === 'extintor' ? capacidade || undefined : undefined,
        classe_fogo: tipo === 'extintor' ? classeFogo || undefined : undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setCreateError(body?.message ?? 'Não foi possível cadastrar o equipamento.');
      return;
    }
    setCodigo('');
    setCompanyUnitId('');
    setLocalizacao('');
    setProximaManutencao('');
    setAgenteExtintor('');
    setCapacidade('');
    setClasseFogo('');
    loadItems();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/fire-safety-equipment/${id}`, { method: 'DELETE', headers: authHeaders() });
    loadItems();
  }

  const visibleItems = filterTipo ? items.filter((item) => item.tipo === filterTipo) : items;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-md border border-brand-100 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tipo
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              {EQUIPMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EQUIPMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Código/ID
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              required
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Filial
            <select
              value={companyUnitId}
              onChange={(e) => setCompanyUnitId(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              <option value="">Selecione (opcional)</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Localização
            <input
              value={localizacao}
              onChange={(e) => setLocalizacao(e.target.value)}
              placeholder="Ex.: 2º andar, corredor B"
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Próxima manutenção
            <input
              type="date"
              value={proximaManutencao}
              onChange={(e) => setProximaManutencao(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
        </div>
        {tipo === 'extintor' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Agente extintor
              <input
                value={agenteExtintor}
                onChange={(e) => setAgenteExtintor(e.target.value)}
                className="rounded-md border border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Capacidade
              <input
                value={capacidade}
                onChange={(e) => setCapacidade(e.target.value)}
                className="rounded-md border border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Classe de fogo
              <input
                value={classeFogo}
                onChange={(e) => setClasseFogo(e.target.value)}
                className="rounded-md border border-brand-100 px-3 py-2"
              />
            </label>
          </div>
        )}
        <button
          type="submit"
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700"
        >
          Cadastrar equipamento
        </button>
        {createError && <p className="text-sm text-red-600">{createError}</p>}
      </form>

      <div className="flex items-center gap-2">
        <label className="text-sm text-brand-900">Filtrar por tipo:</label>
        <select
          value={filterTipo}
          onChange={(e) => setFilterTipo(e.target.value)}
          className="rounded-md border border-brand-100 px-3 py-2 text-sm"
        >
          <option value="">Todos</option>
          {EQUIPMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EQUIPMENT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-brand-700">
            <th className="px-2 py-1">Código</th>
            <th className="px-2 py-1">Tipo</th>
            <th className="px-2 py-1">Filial</th>
            <th className="px-2 py-1">Localização</th>
            <th className="px-2 py-1">Próxima manutenção</th>
            <th className="px-2 py-1">Status</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {visibleItems.map((item) => (
            <tr key={item.id} className="border-t border-brand-50">
              <td className="px-2 py-1 font-medium text-brand-900">{item.codigo}</td>
              <td className="px-2 py-1">{EQUIPMENT_TYPE_LABEL[item.tipo] ?? item.tipo}</td>
              <td className="px-2 py-1">{unitName(item.company_unit_id)}</td>
              <td className="px-2 py-1">{item.localizacao ?? '—'}</td>
              <td className="px-2 py-1">{item.proxima_manutencao ? formatDate(item.proxima_manutencao) : '—'}</td>
              <td className={`px-2 py-1 ${STATUS_LABEL[item.status].className}`}>
                {STATUS_LABEL[item.status].emoji} {STATUS_LABEL[item.status].text}
              </td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  className="text-xs text-red-600 underline"
                >
                  Excluir
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
