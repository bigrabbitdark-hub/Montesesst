'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashSkin } from '@/components/dashboard/DashSkin';
import { BlankTemplateButton } from '@/components/inspecoes/BlankTemplateButton';
import {
  InspectionAttachmentsList,
  type InspectionAnexo,
} from '@/components/inspecoes/InspectionAttachmentsList';
import {
  InspectionHistoryTimeline,
  type InspectionHistoryItem,
} from '@/components/inspecoes/InspectionHistoryTimeline';
import {
  InspectionUploadModal,
  type InspectionOption,
} from '@/components/inspecoes/InspectionUploadModal';

// Etapa 1 do Relatório de Visita Técnica: tipos alinhados com a
// resposta do backend.
// - InspectionRow inclui documentos_count (subquery em
//   InspectionsService.findAll).
// - InspectionDetail inclui documentos_anexos[] (projeção reduzida
//   de DocumentsService.findByInspection via InspectionsService.findOne).
interface InspectionRow {
  id: string;
  status: 'rascunho' | 'concluida';
  visited_at: string;
  company_unit_id: string | null;
  documentos_count: number;
}

interface ChecklistItem {
  id: string;
  block: 'documentacao' | 'epis' | 'instalacoes' | 'maquinas';
  item_label: string;
  status: 'C' | 'NC' | 'NA' | null;
  notes: string | null;
}

interface ActionPlan {
  id: string;
  description: string;
  status: 'pendente' | 'resolvido';
  inspection_id: string;
}

interface InspectionDetail extends InspectionRow {
  company_contact: string | null;
  general_recommendations: string | null;
  items: ChecklistItem[];
  action_plans: ActionPlan[];
  documentos_anexos: InspectionAnexo[];
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

function EmpresaInspecoesPageContent() {
  const router = useRouter();
  const [inspections, setInspections] = useState<InspectionRow[]>([]);
  const [allActionPlans, setAllActionPlans] = useState<ActionPlan[]>([]);
  const [selected, setSelected] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  async function loadAll() {
    const token = localStorage.getItem('montese_token');
    const [inspRes, plansRes] = await Promise.all([
      fetch('/api/inspections', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/action-plans', { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (!inspRes.ok) throw new Error('inspections');
    if (!plansRes.ok) throw new Error('action-plans');
    setInspections(await inspRes.json());
    setAllActionPlans(await plansRes.json());
  }

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setLoading(true);
    loadAll()
      .catch(() => setError('Não foi possível carregar as inspeções.'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Última visita CONCLUÍDA (não rascunho) usada no card de
  // resumo no topo. Se não houver nenhuma, cai pra inspeção mais
  // recente (rascunho) só pra não ficar vazio.
  const lastVisit = useMemo<InspectionRow | null>(() => {
    const concluidas = inspections.filter((i) => i.status === 'concluida');
    return (concluidas[0] ?? inspections[0]) ?? null;
  }, [inspections]);

  // Planos pendentes RELACIONADOS à última visita. Filtra a lista
  // completa de action_plans por inspection_id = lastVisit.id.
  // Sem isso, o card mostraria planos de outras inspeções e o
  // resumo ficaria enganoso.
  const pendingPlansLastVisit = useMemo<ActionPlan[]>(() => {
    if (!lastVisit) return [];
    return allActionPlans.filter((p) => p.inspection_id === lastVisit.id && p.status === 'pendente');
  }, [allActionPlans, lastVisit]);

  // Pontos de atenção da última visita = itens NC do checklist.
  // Só lê do detalhe carregado sob demanda (openInspection).
  // Mantém um cache leve por id pra não rebuscar a cada render.
  const [ncCache, setNcCache] = useState<Record<string, ChecklistItem[]>>({});

  async function openInspection(id: string) {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/inspections/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const detail: InspectionDetail = await res.json();
        setSelected(detail);
        // guarda os itens NC no cache (já que podem ser
        // referenciados depois via getInspectionNcs(id)).
        setNcCache((prev) => ({ ...prev, [id]: detail.items.filter((i) => i.status === 'NC') }));
      } else if (res.status === 404) {
        setError('Esta inspeção não está disponível para a sua empresa.');
      } else {
        setError('Não foi possível carregar o relatório.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
  }

  // Recarrega a lista de inspeções e o detalhe depois de upload
  // bem-sucedido. O modal chama este callback via prop.
  async function handleUploaded() {
    try {
      await loadAll();
      if (selected) {
        // Reabre o detalhe com a lista atualizada de anexos.
        const token = localStorage.getItem('montese_token');
        const res = await fetch(`/api/inspections/${selected.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setSelected(await res.json());
      }
    } catch {
      // silencioso — o usuário ainda pode ver a próxima visita
    }
  }

  // Lista de opções pro select do modal: todas as inspeções da
  // empresa, ordem cronológica inversa (mesma do backend).
  const inspectionOptions: InspectionOption[] = useMemo(
    () => inspections.map((i) => ({ id: i.id, visited_at: i.visited_at, status: i.status })),
    [inspections],
  );

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  // Tela de detalhe: cabeçalho + anexos + checklist. Botão de
  // upload continua disponível pra vincular mais PDFs à mesma
  // inspeção (ex.: versão assinada).
  if (selected) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
        <button onClick={() => setSelected(null)} className="text-sm text-brand-500 hover:underline">
          ← Voltar
        </button>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-brand-900">Relatório de visita — {formatDate(selected.visited_at)}</h1>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              selected.status === 'concluida' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
            }`}
          >
            {selected.status === 'concluida' ? 'Concluída' : 'Rascunho'}
          </span>
        </div>
        {selected.company_contact && (
          <p className="mt-2 text-sm text-brand-700">Responsável: {selected.company_contact}</p>
        )}

        <section className="mt-6 rounded-lg border border-brand-100 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-brand-900">Relatórios anexos</h2>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            >
              Anexar relatório
            </button>
          </div>
          <InspectionAttachmentsList anexos={selected.documentos_anexos ?? []} />
        </section>

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

        {selected.action_plans.length > 0 && (
          <section className="mt-6 rounded-lg border border-brand-100 p-6">
            <h2 className="text-lg font-bold text-brand-900">Planos de ação desta visita</h2>
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {selected.action_plans.map((plan) => (
                <li
                  key={plan.id}
                  className={plan.status === 'pendente' ? 'text-red-600' : 'text-brand-700 line-through'}
                >
                  {plan.description}
                </li>
              ))}
            </ul>
          </section>
        )}

        {selected.general_recommendations && (
          <section className="mt-6 rounded-lg border border-brand-100 p-6">
            <h2 className="text-lg font-bold text-brand-900">Recomendações gerais</h2>
            <p className="mt-2 text-sm text-brand-700">{selected.general_recommendations}</p>
          </section>
        )}

        <InspectionUploadModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onUploaded={handleUploaded}
          inspections={inspectionOptions}
          defaultInspectionId={selected.id}
        />
      </div>
    );
  }

  // Tela principal: header + botão de upload + resumo da última
  // visita + pontos de atenção + planos pendentes + histórico.
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-brand-900">Relatório de visita técnica</h1>
        <div className="flex flex-wrap items-start gap-2">
          <BlankTemplateButton />
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Anexar relatório
          </button>
        </div>
      </div>
      <p className="mt-2 text-sm text-brand-700">
        O técnico registra a visita no sistema e o relatório em PDF é gerado ao concluir. Se a visita foi feita em
        papel, baixe o modelo, preencha e anexe o PDF preenchido à visita correspondente.
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Resumo da última visita</h2>
        {lastVisit ? (
          <div className="mt-3 space-y-1 text-sm text-brand-700">
            <p>
              <span className="font-medium text-brand-900">Data:</span> {formatDate(lastVisit.visited_at)}
            </p>
            <p>
              <span className="font-medium text-brand-900">Status:</span>{' '}
              {lastVisit.status === 'concluida' ? 'Concluída' : 'Rascunho'}
            </p>
            <p>
              <span className="font-medium text-brand-900">PDFs anexos:</span> {lastVisit.documentos_count}
            </p>
            {lastVisit.status === 'concluida' && (
              <button
                type="button"
                onClick={() => openInspection(lastVisit.id)}
                className="mt-2 text-sm font-medium text-brand-500 hover:underline"
              >
                Ver relatório completo
              </button>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-brand-700">Nenhuma visita registrada ainda.</p>
        )}
      </section>

      {lastVisit && (pendingPlansLastVisit.length > 0 || (ncCache[lastVisit.id]?.length ?? 0) > 0) && (
        <section className="mt-6 rounded-lg border border-brand-100 p-6">
          <h2 className="text-lg font-bold text-brand-900">Pontos de atenção da última visita</h2>
          {(ncCache[lastVisit.id]?.length ?? 0) > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium text-brand-900">Itens não conformes</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-red-600">
                {ncCache[lastVisit.id]!.map((item) => (
                  <li key={item.id}>{item.item_label}</li>
                ))}
              </ul>
            </div>
          )}
          {pendingPlansLastVisit.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium text-brand-900">Planos de ação pendentes</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-red-600">
                {pendingPlansLastVisit.map((plan) => (
                  <li key={plan.id}>{plan.description}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Histórico de visitas</h2>
        <InspectionHistoryTimeline
          items={inspections as InspectionHistoryItem[]}
          onSelect={openInspection}
        />
      </section>

      <p className="mt-4 text-xs text-brand-700">
        PDFs gerados antes desta atualização não estão vinculados à inspeção e continuam disponíveis em
        Documentos.
      </p>

      <InspectionUploadModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onUploaded={handleUploaded}
        inspections={inspectionOptions}
      />
    </div>
  );
}

export default function EmpresaInspecoesPage() {
  return (
    <DashSkin>
      <EmpresaInspecoesPageContent />
    </DashSkin>
  );
}
