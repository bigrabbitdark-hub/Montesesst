'use client';

import { useEffect, useId, useRef } from 'react';

const FOCAVEIS = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Diálogo modal acessível: o foco entra, fica preso (Tab/Shift+Tab), Esc fecha (exceto durante o envio)
// e o foco volta ao elemento que o abriu. O primeiro foco vai ao primeiro botão (o seguro: Cancelar).
export function Dialogo({ titulo, onFechar, ocupado = false, children }: {
  titulo: string; onFechar: () => void; ocupado?: boolean; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tituloId = useId();
  const aoFechar = useRef(onFechar);
  aoFechar.current = onFechar;
  const bloqueado = useRef(ocupado);
  bloqueado.current = ocupado;

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const primeiro = ref.current?.querySelector<HTMLElement>(FOCAVEIS);
    (primeiro ?? ref.current)?.focus();
    return () => { anterior?.focus?.(); };
  }, []);

  function aoTeclar(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!bloqueado.current) aoFechar.current();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const itens = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCAVEIS));
    if (itens.length === 0) { e.preventDefault(); return; }
    const primeiro = itens[0];
    const ultimo = itens[itens.length - 1];
    const ativo = document.activeElement;
    if (e.shiftKey && (ativo === primeiro || !ref.current.contains(ativo))) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && (ativo === ultimo || !ref.current.contains(ativo))) { e.preventDefault(); primeiro.focus(); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
        tabIndex={-1}
        onKeyDown={aoTeclar}
        className="adm-card max-h-[90vh] w-full max-w-lg overflow-y-auto p-6"
      >
        <h3 id={tituloId} className="mb-3 text-lg font-semibold text-brand-900">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}
