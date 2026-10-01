'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface InspectionRow {
  id: string;
  status: 'rascunho' | 'concluida';
  visited_at: string;
}

interface ChecklistItem {
  id: string;
  block: 'documentacao' | 'epis' | 'instalacoes' | 'maquinas';
  item_label: string;
  status: 'C' | 'NC' | 'NA' | null;
  notes: string | null;
}

interface InspectionDetail extends InspectionRow {
  company_contact: string | null;
  general_recommendations: string | null;
  items: ChecklistItem[];
}

interface ActionPlan {
  id: string;
  description: string;
  status: 'pendente' | 'resolvido';
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

export default function EmpresaInspecoesPage() {
  const router = useRouter();
  const [inspections, setInspections] = useState<InspectionRow[]>([]);
  const [actionPlans, setActionPlans] = useState<ActionPlan[]>([]);
  const [selected, setSelected] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }

    Promise.all([
      fetch('/api/inspections', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/action-plans', { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(async ([inspectionsRes, actionPlansRes]) => {
        if (!inspectionsRes.ok || !actionPlansRes.ok) {
          setError('Não foi possível carregar as inspeções.');
          setLoading(false);
          return;
        }
        setInspections(await inspectionsRes.json());
        setActionPlans((await actionPlansRes.json()).filter((p: ActionPlan) => p.status === 'pendente'));
        setLoading(false);
      })
      .catch(() => {
        setError('Não foi possível conectar ao servidor.');
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openInspection(id: string) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/inspections/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setSelected(await res.json());
      } else {
        setError('Não foi possível carregar o relatório.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  if (selected) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <button onClick={() => setSelected(null)} className="text-sm text-brand-500 hover:underline">
          ← Voltar
        </button>
        <div className="mt-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">
            Inspeção — {formatDate(selected.visited_at)}
          </h1>
          <span className={selected.status === 'concluida' ? 'text-green-700' : 'text-yellow-700'}>
            {selected.status === 'concluida' ? 'Concluída' : 'Rascunho'}
          </span>
        </div>
        {selected.company_contact && (
          <p className="mt-2 text-sm text-brand-700">Responsável: {selected.company_contact}</p>
        )}
        {BLOCK_ORDER.map((block) => (
          <section key={block} className="mt-6 rounded-lg border border-brand-100 p-6">
            <h2 className="text-lg font-bold text-brand-900">{BLOCK_LABELS[block]}</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {selected.items
                .filter((item) => item.block === block)
                .map((item) => (
                  <li key={item.id} className="text-brand-900">
                    {item.item_label} —{' '}
                    <span className={item.status === 'NC' ? 'font-bold text-red-600' : 'text-brand-700'}>
                      {item.status ?? 'Não avaliado'}
                    </span>
                    {item.notes && <span className="text-brand-700"> — {item.notes}</span>}
                  </li>
                ))}
            </ul>
          </section>
        ))}
        {selected.general_recommendations && (
          <section className="mt-6 rounded-lg border border-brand-100 p-6">
            <h2 className="text-lg font-bold text-brand-900">Recomendações gerais</h2>
            <p className="mt-2 text-sm text-brand-700">{selected.general_recommendations}</p>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Relatório de visita técnica</h1>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Planos de ação pendentes</h2>
        {actionPlans.length === 0 ? (
          <p className="mt-2 text-sm text-brand-700">Nenhum plano de ação pendente.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-red-600">
            {actionPlans.map((plan) => (
              <li key={plan.id}>{plan.description}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Relatórios</h2>
        {inspections.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhuma inspeção registrada ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {inspections.map((inspection) => (
              <li key={inspection.id}>
                <button
                  onClick={() => openInspection(inspection.id)}
                  className="flex w-full items-center justify-between rounded-md border border-brand-100 px-4 py-3 text-sm hover:bg-brand-100"
                >
                  <span className="text-brand-900">{formatDate(inspection.visited_at)}</span>
                  <span className={inspection.status === 'concluida' ? 'text-green-700' : 'text-yellow-700'}>
                    {inspection.status === 'concluida' ? 'Concluída' : 'Rascunho'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
