'use client';

import { useEffect, useId, useRef } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: React.ReactNode;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Diálogo modal acessível para formulários: role dialog, título associado, Esc fecha (exceto durante o envio),
// Tab fica preso dentro, foco vai ao primeiro campo e volta ao acionador ao fechar.
export function Modal({ title, onClose, busy = false, children }: Props) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = boxRef.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    (first ?? boxRef.current)?.focus();
    return () => previous?.focus?.();
  }, []);

  // Esc fecha mesmo com o foco no corpo da página ou no fundo (fora do diálogo); durante o envio não fecha.
  useEffect(() => {
    function onDocKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', onDocKey);
    return () => document.removeEventListener('keydown', onDocKey);
  }, [busy, onClose]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'Tab' || !boxRef.current) return;
    const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (document.activeElement === boxRef.current) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pb-24" onKeyDown={onKeyDown}>
      <div
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="my-4 w-full max-w-2xl rounded-[18px] bg-dash-card p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-dash-primary">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
