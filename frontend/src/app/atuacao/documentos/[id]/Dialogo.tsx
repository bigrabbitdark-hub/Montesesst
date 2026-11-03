'use client';

import { useEffect, useRef } from 'react';

const FOCAVEIS = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Diálogo modal acessível: foco entra no diálogo, fica preso (Tab/Shift+Tab), Esc fecha (exceto durante o envio)
// e o foco volta ao elemento que o abriu.
export function Dialogo({ titulo, onFechar, ocupado = false, children }: {
  titulo: string; onFechar: () => void; ocupado?: boolean; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-titulo"
        tabIndex={-1}
        onKeyDown={aoTeclar}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[18px] bg-white p-6 shadow-xl"
      >
        <h2 id="dlg-titulo" className="mb-4 text-lg font-semibold text-dash-primary">{titulo}</h2>
        {children}
      </div>
    </div>
  );
}
