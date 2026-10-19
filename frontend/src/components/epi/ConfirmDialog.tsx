'use client';

import { useEffect, useId, useRef } from 'react';

interface Props {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string; // texto explícito da ação (ex.: "Estornar movimentação"), nunca só "OK"
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  open, title, description, confirmLabel, cancelLabel = 'Cancelar', destructive = false, busy = false, onConfirm, onCancel, children,
}: Props) {
  const titleId = useId();
  const descId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Foco: vai para o primeiro botão (Cancelar, a opção segura) ao abrir e volta ao acionador ao fechar.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => previous?.focus?.();
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!busy) onCancel();
      return;
    }
    if (e.key !== 'Tab' || !boxRef.current) return;
    const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (active === boxRef.current) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const base = 'min-h-[44px] rounded-lg px-4 text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dash-brand-green-dark aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/50 p-4 pb-24" onKeyDown={onKeyDown}>
      <div
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className="w-full max-w-md rounded-[18px] bg-dash-card p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-dash-primary">{title}</h2>
        {description && <p id={descId} className="mt-2 text-base text-dash-muted">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" aria-disabled={busy} onClick={() => { if (!busy) onCancel(); }} className={`${base} border border-dash-border-input bg-dash-card text-dash-primary hover:bg-dash-page`}>
            {cancelLabel}
          </button>
          <button
            type="button"
            aria-disabled={busy}
            onClick={() => { if (!busy) onConfirm(); }}
            className={`${base} ${destructive ? 'bg-red-700 text-white hover:bg-red-800' : 'bg-dash-brand-green-dark text-white hover:opacity-90'}`}
          >
            {busy ? 'Aguarde...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
