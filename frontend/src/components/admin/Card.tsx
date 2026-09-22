'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FetchState } from './useAdminFetch';

// `.adm-card` define fundo, borda e raio — não some `rounded-*`/`bg-*` aqui.
export function Card({
  id,
  title,
  subtitle,
  action,
  className = '',
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const titleId = id ? `${id}-titulo` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={`adm-card flex min-w-0 scroll-mt-20 flex-col p-4 sm:p-5 ${className}`}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="text-[15px] font-semibold text-brand-900">
            {title}
          </h3>
          {subtitle && <p className="mt-0.5 text-xs text-brand-700">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="shrink-0 text-xs font-medium text-emerald-400 hover:underline">
      {children}
    </Link>
  );
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Carregando" className="flex animate-pulse flex-col gap-2.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="adm-card-2 h-4" style={{ width: `${90 - i * 14}%` }} />
      ))}
    </div>
  );
}

export function CardError({
  onRetry,
  message = 'Não foi possível carregar este card.',
}: {
  onRetry: () => void;
  message?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm text-red-300">
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-red-400/40 px-3 py-1 text-xs font-medium text-red-200 hover:bg-red-400/10"
      >
        Tentar novamente
      </button>
    </div>
  );
}

export function CardEmpty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-brand-700">{children}</p>;
}

export function UnderConstructionBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
      Em construção
    </span>
  );
}

// Moldura de um widget da referência que ainda não tem fonte de dados: mesmo
// visual dos demais, selo explícito e NENHUM número.
export function UnderConstructionCard({
  id,
  title,
  description,
  className = '',
}: {
  id?: string;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <Card id={id} title={title} action={<UnderConstructionBadge />} className={className}>
      <p className="text-sm text-brand-700">{description}</p>
    </Card>
  );
}

// Mostra o dado se houver (mesmo enquanto recarrega); senão erro com retry; senão skeleton.
export function AsyncBody<T>({
  state,
  rows = 3,
  children,
}: {
  state: FetchState<T>;
  rows?: number;
  children: (data: T) => ReactNode;
}) {
  if (state.data !== null) return <>{children(state.data)}</>;
  if (state.error) return <CardError onRetry={state.reload} />;
  return <CardSkeleton rows={rows} />;
}

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

const TONES: Record<Tone, string> = {
  ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  warn: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  bad: 'border-red-400/30 bg-red-400/10 text-red-300',
  info: 'border-blue-400/30 bg-blue-400/10 text-blue-300',
  neutral: 'border-slate-400/30 bg-slate-400/10 text-slate-300',
};

// Estado é sempre o TEXTO do badge; a cor é só reforço.
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONES[tone]}`}>
      {children}
    </span>
  );
}
