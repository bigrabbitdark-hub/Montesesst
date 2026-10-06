import type { ReactNode } from 'react';

// Cabeçalho padrão das páginas do admin (o h1 da casca é sr-only; o título visível é este h2).
export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-bold text-brand-900">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-sm text-brand-700">{description}</p>}
      </div>
      {actions}
    </header>
  );
}
