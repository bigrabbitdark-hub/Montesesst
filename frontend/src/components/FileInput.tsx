'use client';

import { useRef } from 'react';

// Substitui o <input type="file"> nativo (que em muitos navegadores
// renderiza só um texto tipo "Escolher ficheiro / Nenhum ficheiro
// selecionado", sem parecer clicável) por um botão de verdade — feedback
// real de teste, 2026-08-28.
export function FileInput({
  file,
  onChange,
  accept,
  disabled,
  label = 'Escolher arquivo',
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
  disabled?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="rounded-md border border-brand-500 px-4 py-2 text-sm font-medium text-brand-500 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {label}
      </button>
      <span className="text-sm text-brand-700">{file ? file.name : 'Nenhum arquivo selecionado'}</span>
    </div>
  );
}
