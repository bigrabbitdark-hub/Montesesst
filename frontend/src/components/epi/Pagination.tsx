interface Props {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

const BTN =
  'min-h-[44px] min-w-[44px] rounded-lg border border-dash-border-input bg-dash-card px-4 text-base font-medium text-dash-primary ' +
  'hover:bg-dash-page focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dash-brand-green-dark ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

export function Pagination({ page, pageSize, total, onChange }: Props) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const current = Math.min(Math.max(1, page), pages);
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-base text-dash-muted" aria-live="polite">
        Página {current} de {pages} · {total} {total === 1 ? 'registro' : 'registros'}
      </p>
      <div className="flex gap-2">
        <button type="button" className={BTN} aria-label="Página anterior" disabled={current <= 1} onClick={() => onChange(current - 1)}>
          Anterior
        </button>
        <button type="button" className={BTN} aria-label="Próxima página" disabled={current >= pages} onClick={() => onChange(current + 1)}>
          Próxima
        </button>
      </div>
    </nav>
  );
}
