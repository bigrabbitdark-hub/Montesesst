'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AdminIcon } from './icons';
import { ADMIN_NAV_FLAT } from './nav';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Paleta de NAVEGAÇÃO entre as páginas do admin. Não busca empresa/técnico
// (fora do escopo do SP1) — o texto do campo diz exatamente isso.
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = norm(query.trim());
    return ADMIN_NAV_FLAT.filter((item) => !q || norm(`${item.label} ${item.keywords ?? ''}`).includes(q));
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const previous = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      previous?.focus();
    };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      go(results[active].href);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ir para uma página do painel"
        className="adm-card w-full max-w-lg overflow-hidden"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-brand-100 px-3">
          <AdminIcon name="search" className="h-4 w-4 text-brand-700" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={results[active] ? `palette-item-${active}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ir para… (Visão Geral, Empresas, Financeiro)"
            className="w-full bg-transparent py-3 text-sm text-brand-900 placeholder:text-brand-700"
          />
        </div>
        <ul id="palette-list" role="listbox" aria-label="Páginas" className="max-h-72 overflow-y-auto p-1">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-brand-700">Nenhuma página encontrada.</li>
          )}
          {results.map((item, i) => (
            <li
              key={item.href}
              id={`palette-item-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item.href)}
              className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm ${
                i === active ? 'bg-emerald-500/15 text-brand-900' : 'text-brand-700'
              }`}
            >
              <AdminIcon name={item.icon} className="h-4 w-4" />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
