'use client';

// Etapa 1 do Relatório de Visita Técnica: timeline de visitas
// técnicas. Mostra cada inspeção (rascunho ou concluída) na ordem
// cronológica inversa (mais recente primeiro) com contagem de
// anexos. Click em um item abre o detalhe da inspeção na página
// pai (a navegação real é responsabilidade do pai, aqui só
// emitimos o callback).
export interface InspectionHistoryItem {
  id: string;
  visited_at: string;
  status: 'rascunho' | 'concluida';
  documentos_count: number;
}

export function InspectionHistoryTimeline({
  items,
  onSelect,
}: {
  items: InspectionHistoryItem[];
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return <p className="mt-2 text-sm text-brand-700">Nenhuma visita registrada ainda.</p>;
  }

  function formatDate(iso: string): string {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }

  return (
    <ol className="mt-3 flex flex-col gap-0">
      {items.map((item, idx) => (
        <li key={item.id} className="relative pl-6">
          {/* bolinha da timeline */}
          <span
            aria-hidden
            className={`absolute left-1 top-3 h-2.5 w-2.5 rounded-full ${
              item.status === 'concluida' ? 'bg-green-600' : 'bg-yellow-500'
            }`}
          />
          {/* linha conectora (esconde no último) */}
          {idx < items.length - 1 && (
            <span aria-hidden className="absolute left-[7px] top-6 bottom-0 w-px bg-brand-100" />
          )}
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            className="mb-2 flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-brand-50"
          >
            <span className="text-brand-900">{formatDate(item.visited_at)}</span>
            <span className="flex items-center gap-3 text-xs">
              <span
                className={
                  item.status === 'concluida' ? 'font-medium text-green-700' : 'font-medium text-yellow-700'
                }
              >
                {item.status === 'concluida' ? 'Concluída' : 'Rascunho'}
              </span>
              <span className="rounded-full bg-brand-100 px-2 py-0.5 text-brand-700">
                {item.documentos_count} {item.documentos_count === 1 ? 'anexo' : 'anexos'}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
