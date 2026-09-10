'use client';

import { useEffect, useState } from 'react';

interface ChecklistItem {
  id: string;
  item_key: string;
  item_label: string;
  status: 'C' | 'NC' | 'NA' | null;
  observacoes: string | null;
  foto_r2_key: string | null;
}

interface Checklist {
  id: string;
  company_unit_id: string;
  status: 'rascunho' | 'concluida';
  data_realizacao: string;
  concluded_at: string | null;
}

interface ChecklistDetail extends Checklist {
  items: ChecklistItem[];
}

interface CorrectiveAction {
  id: string;
  checklist_item_id: string | null;
  drill_id: string | null;
  description: string;
  status: 'pendente' | 'resolvido';
}

const STATUS_LABEL: Record<NonNullable<ChecklistItem['status']>, { emoji: string; text: string; className: string }> = {
  C: { emoji: '🟢', text: 'Conforme', className: 'text-green-700' },
  NC: { emoji: '🔴', text: 'Não conforme', className: 'text-red-600' },
  NA: { emoji: '⚪', text: 'Não se aplica', className: 'text-brand-500' },
};

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

export function PreventionChecklistPanel() {
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChecklistDetail | null>(null);
  const [correctiveActions, setCorrectiveActions] = useState<CorrectiveAction[]>([]);

  async function loadChecklists() {
    const res = await fetch('/api/prevention-checklists', { headers: authHeaders() });
    if (res.ok) setChecklists(await res.json());
  }

  async function loadCorrectiveActions() {
    const res = await fetch('/api/prevention-corrective-actions', { headers: authHeaders() });
    if (res.ok) setCorrectiveActions(await res.json());
  }

  async function loadDetail(id: string) {
    const res = await fetch(`/api/prevention-checklists/${id}`, { headers: authHeaders() });
    if (res.ok) setDetail(await res.json());
  }

  useEffect(() => {
    loadChecklists();
    loadCorrectiveActions();
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]);

  async function handleResolve(actionId: string) {
    await fetch(`/api/prevention-corrective-actions/${actionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ status: 'resolvido' }),
    });
    loadCorrectiveActions();
  }

  const actionsForChecklist = (itemIds: string[]) =>
    correctiveActions.filter((a) => a.checklist_item_id && itemIds.includes(a.checklist_item_id));

  return (
    <div className="flex flex-col gap-6">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-brand-700">
            <th className="px-2 py-1">Data</th>
            <th className="px-2 py-1">Status</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {checklists.map((checklist) => (
            <tr key={checklist.id} className="border-t border-brand-50">
              <td className="px-2 py-1 font-medium text-brand-900">{formatDate(checklist.data_realizacao)}</td>
              <td className="px-2 py-1">{checklist.status === 'concluida' ? 'Concluído' : 'Em andamento'}</td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => setSelectedId(checklist.id)}
                  className="text-xs text-brand-700 underline"
                >
                  Ver detalhes
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <div className="rounded-md border border-brand-100 p-4">
          <h2 className="text-lg font-semibold text-brand-900">
            Checklist de {formatDate(detail.data_realizacao)}
          </h2>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-brand-700">
                <th className="px-2 py-1">Item</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Observações</th>
                <th className="px-2 py-1">Foto</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item) => (
                <tr key={item.id} className="border-t border-brand-50">
                  <td className="px-2 py-1">{item.item_label}</td>
                  <td className={`px-2 py-1 ${item.status ? STATUS_LABEL[item.status].className : ''}`}>
                    {item.status ? `${STATUS_LABEL[item.status].emoji} ${STATUS_LABEL[item.status].text}` : '—'}
                  </td>
                  <td className="px-2 py-1">{item.observacoes ?? '—'}</td>
                  <td className="px-2 py-1">{item.foto_r2_key ? '📷' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {actionsForChecklist(detail.items.map((i) => i.id)).length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-brand-900">Ações corretivas</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {actionsForChecklist(detail.items.map((i) => i.id)).map((action) => (
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
      )}
    </div>
  );
}
