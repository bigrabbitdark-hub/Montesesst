'use client';

import { FormEvent, useEffect, useState } from 'react';

interface PositionSummary {
  id: string;
  name: string;
  employee_count: number;
  epi_requirement_count: number;
  training_requirement_count: number;
  divergence_count: number;
}

interface LinkSuggestion {
  suggested_name: string;
  employees: { id: string; full_name: string }[];
}

interface EpiCatalogItem {
  id: string;
  category: string;
  code: string;
  equipment_group: string;
  description: string;
}

interface PositionDetail {
  id: string;
  name: string;
  epi_requirement_ids: string[];
  training_requirement_tipos: string[];
  employees: {
    id: string;
    full_name: string;
    divergences: { categoria: 'epi' | 'treinamento'; requisito: string; empresa_tem_no_catalogo?: boolean }[];
  }[];
}

const TRAINING_TYPES = ['nr-05', 'nr-06', 'nr-10', 'nr-11', 'nr-12', 'nr-18', 'nr-20', 'nr-33', 'nr-35', 'outro'] as const;
const TRAINING_TYPE_LABEL: Record<string, string> = {
  'nr-05': 'NR-05 — Membro da CIPA',
  'nr-06': 'NR-06 — Uso de EPI',
  'nr-10': 'NR-10 — Segurança em eletricidade',
  'nr-11': 'NR-11 — Transporte/movimentação de materiais',
  'nr-12': 'NR-12 — Segurança em máquinas e equipamentos',
  'nr-18': 'NR-18 — Condições de segurança na construção civil',
  'nr-20': 'NR-20 — Inflamáveis e combustíveis',
  'nr-33': 'NR-33 — Espaço confinado',
  'nr-35': 'NR-35 — Trabalho em altura',
  outro: 'Outro',
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

export function MapaSstPanel() {
  const [positions, setPositions] = useState<PositionSummary[]>([]);
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  const [showLinkReview, setShowLinkReview] = useState(false);
  const [newPositionName, setNewPositionName] = useState('');
  const [createError, setCreateError] = useState('');
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PositionDetail | null>(null);
  const [catalogItems, setCatalogItems] = useState<EpiCatalogItem[]>([]);
  const [epiSelection, setEpiSelection] = useState<Set<string>>(new Set());
  const [trainingSelection, setTrainingSelection] = useState<Set<string>>(new Set());
  const [linkError, setLinkError] = useState('');
  const [epiError, setEpiError] = useState('');
  const [trainingError, setTrainingError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [excludedEmployeeIds, setExcludedEmployeeIds] = useState<Set<string>>(new Set());

  async function loadPositions() {
    const res = await fetch('/api/positions', { headers: authHeaders() });
    if (res.ok) setPositions(await res.json());
  }

  async function loadSuggestions() {
    const res = await fetch('/api/positions/link-suggestions', { headers: authHeaders() });
    if (res.ok) setSuggestions(await res.json());
  }

  useEffect(() => {
    loadPositions();
    loadSuggestions();
    fetch('/api/epi-catalog-items', { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : []))
      .then(setCatalogItems);
  }, []);

  async function handleCreatePosition(e: FormEvent) {
    e.preventDefault();
    setCreateError('');
    const res = await fetch('/api/positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name: newPositionName }),
    });
    if (!res.ok) {
      setCreateError(res.status === 409 ? 'Já existe um cargo com esse nome' : 'Erro ao criar cargo');
      return;
    }
    setNewPositionName('');
    loadPositions();
  }

  async function handleConfirmLinks() {
    setLinkError('');
    // Deriva employee_ids dos funcionários ainda marcados — quem foi
    // desmarcado fica de fora desta rodada (continua sem position_id, some
    // do payload). Grupo que fica sem nenhum marcado não entra na
    // confirmação (não faz sentido criar um cargo vazio).
    const groups = suggestions
      .map((s) => ({
        suggested_name: s.suggested_name,
        employee_ids: s.employees.filter((e) => !excludedEmployeeIds.has(e.id)).map((e) => e.id),
      }))
      .filter((g) => g.employee_ids.length > 0);
    const res = await fetch('/api/positions/confirm-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ groups }),
    });
    if (!res.ok) {
      setLinkError('Erro ao confirmar vínculos');
      return;
    }
    setShowLinkReview(false);
    setExcludedEmployeeIds(new Set());
    loadPositions();
    loadSuggestions();
  }

  function updateSuggestionName(index: number, name: string) {
    setSuggestions((prev) => prev.map((s, i) => (i === index ? { ...s, suggested_name: name } : s)));
  }

  function toggleEmployeeExclusion(id: string) {
    setExcludedEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleRename(id: string) {
    setRenameError('');
    const res = await fetch(`/api/positions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name: renameValue }),
    });
    if (!res.ok) {
      setRenameError(res.status === 409 ? 'Já existe um cargo com esse nome' : 'Erro ao renomear cargo');
      return;
    }
    setRenamingId(null);
    loadPositions();
  }

  async function openDetail(positionId: string) {
    const res = await fetch(`/api/positions/${positionId}`, { headers: authHeaders() });
    if (!res.ok) return;
    const data: PositionDetail = await res.json();
    // `selectedPositionId` só é atualizado depois que o GET resolve com
    // sucesso — se atualizássemos antes (fire-and-forget) e o GET falhasse,
    // `detail`/`epiSelection`/`trainingSelection` ficariam presos no cargo
    // anterior enquanto `selectedPositionId` já apontaria pro cargo novo, e
    // um "Salvar" subsequente gravaria a seleção errada no ID errado.
    setSelectedPositionId(positionId);
    setDetail(data);
    setEpiSelection(new Set(data.epi_requirement_ids));
    setTrainingSelection(new Set(data.training_requirement_tipos));
    setEpiError('');
    setTrainingError('');
  }

  async function saveEpiRequirements() {
    if (!selectedPositionId) return;
    setEpiError('');
    const res = await fetch(`/api/positions/${selectedPositionId}/epi-requirements`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ epi_catalog_item_ids: Array.from(epiSelection) }),
    });
    if (!res.ok) {
      setEpiError('Erro ao salvar EPI exigido');
      return;
    }
    openDetail(selectedPositionId);
    loadPositions();
  }

  async function saveTrainingRequirements() {
    if (!selectedPositionId) return;
    setTrainingError('');
    const res = await fetch(`/api/positions/${selectedPositionId}/training-requirements`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ tipos: Array.from(trainingSelection) }),
    });
    if (!res.ok) {
      setTrainingError('Erro ao salvar treinamento exigido');
      return;
    }
    openDetail(selectedPositionId);
    loadPositions();
  }

  function toggleEpi(id: string) {
    setEpiSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTraining(tipo: string) {
    setTrainingSelection((prev) => {
      const next = new Set(prev);
      if (next.has(tipo)) next.delete(tipo);
      else next.add(tipo);
      return next;
    });
  }

  const catalogByCategory = catalogItems.reduce<Record<string, EpiCatalogItem[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      {suggestions.length > 0 && !showLinkReview && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            {suggestions.reduce((sum, s) => sum + s.employees.length, 0)} funcionário(s) sem cargo vinculado.
          </p>
          <button
            type="button"
            onClick={() => setShowLinkReview(true)}
            className="mt-2 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Revisar
          </button>
        </div>
      )}

      {showLinkReview && (
        <div className="flex flex-col gap-3 rounded-md border border-brand-100 p-4">
          <p className="text-sm text-brand-700">
            Grafias parecidas foram agrupadas automaticamente. Edite o nome do cargo se quiser antes de confirmar.
          </p>
          {suggestions.map((s, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-md border border-brand-50 p-3">
              <div className="flex items-center gap-3">
                <input
                  value={s.suggested_name}
                  onChange={(e) => updateSuggestionName(i, e.target.value)}
                  className="flex-1 rounded-md border border-brand-100 px-3 py-2 text-sm"
                />
                <span className="text-xs text-brand-700">{s.employees.length} funcionário(s)</span>
              </div>
              <div className="flex flex-col gap-1 pl-1">
                {s.employees.map((employee) => (
                  <label key={employee.id} className="flex items-center gap-2 text-xs text-brand-900">
                    <input
                      type="checkbox"
                      checked={!excludedEmployeeIds.has(employee.id)}
                      onChange={() => toggleEmployeeExclusion(employee.id)}
                    />
                    {employee.full_name}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={handleConfirmLinks}
            className="self-start rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Confirmar vínculos
          </button>
          {linkError && <p className="text-sm text-red-600">{linkError}</p>}
        </div>
      )}

      <form onSubmit={handleCreatePosition} className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm text-brand-900">
          Novo cargo
          <input
            value={newPositionName}
            onChange={(e) => setNewPositionName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
            required
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Criar
        </button>
      </form>
      {createError && <p className="text-sm text-red-600">{createError}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-brand-700">
            <th className="px-2 py-1">Cargo</th>
            <th className="px-2 py-1">Funcionários</th>
            <th className="px-2 py-1">Requisitos</th>
            <th className="px-2 py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.id} className="cursor-pointer hover:bg-brand-50" onClick={() => openDetail(p.id)}>
              <td className="px-2 py-1 font-medium text-brand-900">
                {renamingId === p.id ? (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="rounded-md border border-brand-100 px-2 py-1 text-sm"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => handleRename(p.id)}
                      className="text-xs text-brand-700 underline"
                    >
                      Salvar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingId(null);
                        setRenameError('');
                      }}
                      className="text-xs text-brand-700 underline"
                    >
                      Cancelar
                    </button>
                    {renameError && <p className="text-xs text-red-600">{renameError}</p>}
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    {p.name}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(p.id);
                        setRenameValue(p.name);
                        setRenameError('');
                      }}
                      className="text-xs text-brand-400 hover:text-brand-700"
                      aria-label="Renomear cargo"
                    >
                      ✏️
                    </button>
                  </span>
                )}
              </td>
              <td className="px-2 py-1">{p.employee_count}</td>
              <td className="px-2 py-1">{p.epi_requirement_count + p.training_requirement_count}</td>
              <td className="px-2 py-1">
                {p.divergence_count > 0 ? (
                  <span className="text-red-600">{p.divergence_count} pendência(s)</span>
                ) : (
                  <span className="text-green-700">Em dia</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <div className="flex flex-col gap-4 rounded-md border border-brand-100 p-4">
          <h2 className="text-lg font-bold text-brand-900">{detail.name}</h2>

          <div>
            <h3 className="text-sm font-medium text-brand-900">EPI exigido</h3>
            {Object.entries(catalogByCategory).map(([category, items]) => (
              <div key={category} className="mt-2">
                <p className="text-xs font-medium text-brand-700">Categoria {category}</p>
                {items.map((item) => (
                  <label key={item.id} className="flex items-center gap-2 text-sm text-brand-900">
                    <input
                      type="checkbox"
                      checked={epiSelection.has(item.id)}
                      onChange={() => toggleEpi(item.id)}
                    />
                    {item.description}
                  </label>
                ))}
              </div>
            ))}
            <button
              type="button"
              onClick={saveEpiRequirements}
              className="mt-2 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Salvar EPI exigido
            </button>
            {epiError && <p className="mt-1 text-sm text-red-600">{epiError}</p>}
          </div>

          <div>
            <h3 className="text-sm font-medium text-brand-900">Treinamento exigido</h3>
            {TRAINING_TYPES.map((tipo) => (
              <label key={tipo} className="flex items-center gap-2 text-sm text-brand-900">
                <input type="checkbox" checked={trainingSelection.has(tipo)} onChange={() => toggleTraining(tipo)} />
                {TRAINING_TYPE_LABEL[tipo]}
              </label>
            ))}
            <button
              type="button"
              onClick={saveTrainingRequirements}
              className="mt-2 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Salvar treinamento exigido
            </button>
            {trainingError && <p className="mt-1 text-sm text-red-600">{trainingError}</p>}
          </div>

          <div>
            <h3 className="text-sm font-medium text-brand-900">Funcionários</h3>
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left">Nome</th>
                  <th className="px-2 py-1 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {detail.employees.map((employee) => (
                  <tr key={employee.id}>
                    <td className="px-2 py-1 text-brand-900">{employee.full_name}</td>
                    <td className="px-2 py-1">
                      {employee.divergences.length === 0 ? (
                        <span className="text-green-700">✓ Em dia</span>
                      ) : (
                        employee.divergences.map((d, i) => (
                          <div key={i} className="text-red-600">
                            ⚠{' '}
                            {d.categoria === 'epi'
                              ? `${d.empresa_tem_no_catalogo ? 'EPI não entregue' : 'EPI não cadastrado no catálogo'}: ${d.requisito}`
                              : `Treinamento pendente/vencido: ${TRAINING_TYPE_LABEL[d.requisito] ?? d.requisito}`}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
