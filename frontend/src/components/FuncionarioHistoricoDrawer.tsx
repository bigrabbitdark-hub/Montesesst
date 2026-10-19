'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FIELD_LABELS,
  formatChangedAt,
  formatHistoryValue,
  roleLabel,
  sourceLabel,
  type HistoryItem,
} from '@/lib/employees-history';

const PAGE_SIZE = 50;

export function FuncionarioHistoricoDrawer({
  employeeId,
  employeeName,
  onClose,
}: {
  employeeId: string;
  employeeName: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<'carregando' | 'ok' | 'erro'>('carregando');
  const seq = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(
    async (offset: number) => {
      const mine = ++seq.current;
      setState('carregando');
      try {
        const res = await fetch(`/api/employees/${employeeId}/history?limit=${PAGE_SIZE}&offset=${offset}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('montese_token')}` },
        });
        const body = await res.json().catch(() => ({}));
        if (mine !== seq.current) return; // resposta superada
        if (!res.ok) return setState('erro');
        const next: HistoryItem[] = body.items ?? [];
        setItems((prev) => (offset === 0 ? next : [...prev, ...next]));
        setTotal(body.total ?? 0);
        setState('ok');
      } catch {
        if (mine === seq.current) setState('erro');
      }
    },
    [employeeId],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  // onClose pode mudar de identidade a cada render do pai; a ref evita refocar o botão a cada vez.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    // Devolve o foco a quem abriu a gaveta (se ainda estiver no DOM) ao fechar.
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  // Trap de foco: com aria-modal, Tab/Shift+Tab ciclam dentro do diálogo.
  const dialogRef = useRef<HTMLDivElement>(null);
  function onDialogKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!nodes || nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Histórico de ${employeeName}`}
      onKeyDown={onDialogKeyDown}
      className="fixed inset-0 z-50"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside className="absolute inset-y-0 right-0 flex w-full flex-col gap-4 overflow-y-auto bg-dash-card p-4 shadow-xl sm:max-w-md">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-dash-primary">Histórico</h2>
            <p className="break-words text-sm text-dash-muted">{employeeName}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md border border-dash-border-soft px-3 py-1.5 text-sm font-semibold text-dash-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-dash-primary"
          >
            Fechar
          </button>
        </header>

        {state === 'erro' && (
          <div role="alert" className="rounded-md bg-dash-status-crit-bg px-3 py-2 text-sm text-dash-status-crit-text">
            Não foi possível carregar o histórico.
          </div>
        )}
        {state === 'carregando' && (
          <p role="status" aria-live="polite" className="text-sm text-dash-muted">
            {items.length === 0 ? 'Carregando histórico...' : 'Carregando mais...'}
          </p>
        )}
        {state === 'ok' && items.length === 0 && (
          <p className="text-sm text-dash-muted">Nenhuma alteração registrada para este funcionário.</p>
        )}

        {items.length > 0 && (
          <ol className="flex flex-col gap-3">
            {items.map((it) => (
              <li key={it.id} className="rounded-lg border border-dash-border-soft p-3">
                <p className="font-semibold text-dash-primary">{FIELD_LABELS[it.field] ?? it.field}</p>
                <p className="mt-1 break-words text-sm text-dash-primary">
                  <span className="sr-only">de </span>
                  <span className="text-dash-muted">{formatHistoryValue(it.field, it.old_value)}</span>
                  <span aria-hidden="true">{' → '}</span>
                  <span className="sr-only">para </span>
                  <span className="font-semibold">{formatHistoryValue(it.field, it.new_value)}</span>
                </p>
                <p className="mt-1 text-xs text-dash-muted">
                  {`${roleLabel(it.actor_role)} · ${sourceLabel(it.source)} · ${formatChangedAt(it.changed_at)}`}
                </p>
              </li>
            ))}
          </ol>
        )}

        {(items.length < total || (state === 'erro' && items.length > 0)) && items.length > 0 && (
          <button
            type="button"
            onClick={() => void load(items.length)}
            disabled={state === 'carregando'}
            className="rounded-md border border-dash-border-soft px-4 py-2 text-sm font-semibold text-dash-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-dash-primary disabled:opacity-50"
          >
            {state === 'erro' ? 'Tentar novamente' : 'Carregar mais'}
          </button>
        )}
        {state === 'erro' && items.length === 0 && (
          <button
            type="button"
            onClick={() => void load(0)}
            className="rounded-md border border-dash-border-soft px-4 py-2 text-sm font-semibold text-dash-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-dash-primary"
          >
            Tentar novamente
          </button>
        )}
      </aside>
    </div>
  );
}
