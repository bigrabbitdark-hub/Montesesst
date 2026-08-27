'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface ChecklistItem {
  id: string;
  block: 'documentacao' | 'epis' | 'instalacoes' | 'maquinas';
  item_key: string;
  item_label: string;
  status: 'C' | 'NC' | 'NA' | null;
  notes: string | null;
}

interface AiSuggestion {
  status: 'C' | 'NC' | 'NA';
  notes: string;
}

interface ActionPlan {
  id: string;
  description: string;
  status: 'pendente' | 'resolvido';
}

interface InspectionDetail {
  id: string;
  status: 'rascunho' | 'concluida';
  visited_at: string;
  company_contact: string | null;
  dds_topic: string | null;
  dds_participants_count: number | null;
  dds_notes: string | null;
  general_recommendations: string | null;
  technician_signature_name: string | null;
  company_signature_name: string | null;
  items: ChecklistItem[];
  action_plans: ActionPlan[];
}

const BLOCK_LABELS: Record<ChecklistItem['block'], string> = {
  documentacao: 'Documentação',
  epis: 'Uso de EPIs',
  instalacoes: 'Inspeção de instalações',
  maquinas: 'Riscos em máquinas e equipamentos',
};

const BLOCK_ORDER: ChecklistItem['block'][] = ['documentacao', 'epis', 'instalacoes', 'maquinas'];

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export default function InspecaoPage() {
  const router = useRouter();
  const params = useParams<{ tenantId: string; id: string }>();
  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [concluding, setConcluding] = useState(false);
  const [reportText, setReportText] = useState('');
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, AiSuggestion>>({});
  const [noSuggestionsFound, setNoSuggestionsFound] = useState(false);

  async function loadInspection() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/inspections/${params.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setInspection(await res.json());
      } else {
        setError('Não foi possível carregar a inspeção.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    loadInspection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const isDraft = inspection?.status === 'rascunho';

  async function saveHeaderField(field: string, value: string | number) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/inspections/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        const updated = await res.json();
        setInspection((prev) => (prev ? { ...prev, ...updated } : prev));
      } else {
        setError('Não foi possível salvar a alteração.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
  }

  async function saveItem(itemId: string, patch: { status?: string; notes?: string }): Promise<boolean> {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/inspections/${params.id}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const updatedItem = await res.json();
        setInspection((prev) =>
          prev
            ? { ...prev, items: prev.items.map((i) => (i.id === itemId ? updatedItem : i)) }
            : prev,
        );
        return true;
      } else {
        setError('Não foi possível salvar o item.');
        return false;
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
      return false;
    }
  }

  async function handleGenerateDraft() {
    setGeneratingDraft(true);
    setAiError('');
    setNoSuggestionsFound(false);
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/inspections/${params.id}/ai-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ report_text: reportText }),
      });
      if (res.ok) {
        const suggestions: { item_key: string; status: 'C' | 'NC' | 'NA'; notes: string }[] = await res.json();
        const byItemKey: Record<string, AiSuggestion> = {};
        for (const s of suggestions) {
          byItemKey[s.item_key] = { status: s.status, notes: s.notes };
        }
        setAiSuggestions(byItemKey);
        setNoSuggestionsFound(suggestions.length === 0);
      } else if (res.status === 503) {
        setAiError('Copiloto de IA ainda não está disponível nesta conta.');
      } else {
        setAiError('Não foi possível gerar o rascunho agora, tente novamente.');
      }
    } catch {
      setAiError('Não foi possível conectar ao servidor.');
    }
    setGeneratingDraft(false);
  }

  async function applySuggestion(item: ChecklistItem) {
    const suggestion = aiSuggestions[item.item_key];
    if (!suggestion) return;
    const saved = await saveItem(item.id, { status: suggestion.status, notes: suggestion.notes });
    if (saved) {
      setAiSuggestions((prev) => {
        const next = { ...prev };
        delete next[item.item_key];
        return next;
      });
    }
  }

  function discardSuggestion(itemKey: string) {
    setAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[itemKey];
      return next;
    });
  }

  async function handleConcluir(event: FormEvent) {
    event.preventDefault();
    setConcluding(true);
    setError('');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/inspections/${params.id}/concluir`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setInspection(await res.json());
      } else {
        setError('Não foi possível concluir a inspeção.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
    setConcluding(false);
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }
  if (!inspection) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-red-600">{error}</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-900">Inspeção — {formatDate(inspection.visited_at)}</h1>
        <span className={inspection.status === 'concluida' ? 'text-green-700' : 'text-yellow-700'}>
          {inspection.status === 'concluida' ? 'Concluída' : 'Rascunho'}
        </span>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {isDraft && (
        <section className="mt-6 rounded-lg border border-brand-100 p-6">
          <h2 className="text-lg font-bold text-brand-900">Copiloto de IA</h2>
          <p className="mt-2 text-xs text-brand-700">
            Sugestão gerada por IA — revise e confirme. Não substitui a avaliação do profissional
            habilitado.
          </p>
          <textarea
            value={reportText}
            onChange={(e) => setReportText(e.target.value)}
            placeholder="Descreva o que você observou na visita..."
            className="mt-3 w-full rounded-md border border-brand-100 px-3 py-2 text-sm"
            rows={4}
          />
          <button
            type="button"
            onClick={handleGenerateDraft}
            disabled={generatingDraft || reportText.trim() === ''}
            className="mt-3 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {generatingDraft ? 'Gerando...' : 'Gerar rascunho com IA'}
          </button>
          {aiError && <p className="mt-2 text-sm text-red-600">{aiError}</p>}
          {noSuggestionsFound && (
            <p className="mt-2 text-sm text-brand-700">
              A IA não identificou itens do checklist neste relato — descreva com mais detalhe o que
              você observou.
            </p>
          )}
        </section>
      )}

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Identificação</h2>
        <label className="mt-3 flex flex-col gap-1 text-sm text-brand-900">
          Responsável pela empresa
          <input
            defaultValue={inspection.company_contact ?? ''}
            disabled={!isDraft}
            onBlur={(e) => saveHeaderField('company_contact', e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
          />
        </label>
      </section>

      {BLOCK_ORDER.map((block) => (
        <section key={block} className="mt-6 rounded-lg border border-brand-100 p-6">
          <h2 className="text-lg font-bold text-brand-900">{BLOCK_LABELS[block]}</h2>
          <div className="mt-4 flex flex-col gap-4">
            {inspection.items
              .filter((item) => item.block === block)
              .map((item) => (
                <div key={item.id} className="border-b border-brand-100 pb-4 last:border-0 last:pb-0">
                  <p className="text-sm font-medium text-brand-900">{item.item_label}</p>
                  {aiSuggestions[item.item_key] && (
                    <div className="mt-2 rounded-md bg-brand-50 p-3 text-xs">
                      <p className="text-brand-900">
                        IA sugere: <strong>{aiSuggestions[item.item_key].status}</strong> —{' '}
                        {aiSuggestions[item.item_key].notes}
                      </p>
                      <div className="mt-2 flex gap-3">
                        <button
                          type="button"
                          onClick={() => applySuggestion(item)}
                          className="font-medium text-brand-500 hover:underline"
                        >
                          Aplicar
                        </button>
                        <button
                          type="button"
                          onClick={() => discardSuggestion(item.item_key)}
                          className="text-brand-700 hover:underline"
                        >
                          Descartar
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="mt-2 flex gap-3 text-sm">
                    {(['C', 'NC', 'NA'] as const).map((option) => (
                      <label key={option} className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`item-${item.id}`}
                          checked={item.status === option}
                          disabled={!isDraft}
                          onChange={() => saveItem(item.id, { status: option })}
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                  <textarea
                    defaultValue={item.notes ?? ''}
                    disabled={!isDraft}
                    placeholder="Observação (opcional)"
                    onBlur={(e) => saveItem(item.id, { notes: e.target.value })}
                    className="mt-2 w-full rounded-md border border-brand-100 px-3 py-2 text-sm disabled:bg-brand-50"
                  />
                </div>
              ))}
          </div>
        </section>
      ))}

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Conscientização (DDS)</h2>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tema abordado
            <input
              defaultValue={inspection.dds_topic ?? ''}
              disabled={!isDraft}
              onBlur={(e) => saveHeaderField('dds_topic', e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Número de participantes
            <input
              type="number"
              min={0}
              defaultValue={inspection.dds_participants_count ?? ''}
              disabled={!isDraft}
              onBlur={(e) => saveHeaderField('dds_participants_count', Number(e.target.value))}
              className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Pontos reforçados
            <textarea
              defaultValue={inspection.dds_notes ?? ''}
              disabled={!isDraft}
              onBlur={(e) => saveHeaderField('dds_notes', e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
            />
          </label>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Recomendações gerais</h2>
        <textarea
          defaultValue={inspection.general_recommendations ?? ''}
          disabled={!isDraft}
          onBlur={(e) => saveHeaderField('general_recommendations', e.target.value)}
          className="mt-3 w-full rounded-md border border-brand-100 px-3 py-2 text-sm disabled:bg-brand-50"
        />
      </section>

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Assinaturas</h2>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Nome do técnico
            <input
              defaultValue={inspection.technician_signature_name ?? ''}
              disabled={!isDraft}
              onBlur={(e) => saveHeaderField('technician_signature_name', e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Nome do responsável pela empresa
            <input
              defaultValue={inspection.company_signature_name ?? ''}
              disabled={!isDraft}
              onBlur={(e) => saveHeaderField('company_signature_name', e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
            />
          </label>
        </div>
      </section>

      {inspection.action_plans.length > 0 && (
        <section className="mt-6 rounded-lg border border-brand-100 p-6">
          <h2 className="text-lg font-bold text-brand-900">Planos de ação gerados</h2>
          <ul className="mt-3 flex flex-col gap-1 text-sm text-red-600">
            {inspection.action_plans.map((plan) => (
              <li key={plan.id}>{plan.description}</li>
            ))}
          </ul>
        </section>
      )}

      {isDraft && (
        <form onSubmit={handleConcluir} className="mt-8">
          <button
            type="submit"
            disabled={concluding}
            className="w-full rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {concluding ? 'Concluindo...' : 'Concluir inspeção'}
          </button>
        </form>
      )}
    </div>
  );
}
