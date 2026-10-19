'use client';

import { useEffect, useRef, useState } from 'react';

export interface EpiTab { id: string; label: string }

interface Props {
  tabs: EpiTab[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  // Prefixo dos ids: o painel de cada aba deve ter id `${idPrefix}-panel-${tab.id}` e aria-labelledby `${idPrefix}-tab-${tab.id}`.
  idPrefix: string;
}

// Abas acessíveis (padrão WAI-ARIA): setas, Home e End movem o foco e ativam a aba; só a aba ativa entra na ordem de Tab.
export function EpiTabs({ tabs, value, onChange, ariaLabel, idPrefix }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  // aria-controls só aponta para painéis que existem no DOM (quem usa pode montar só o painel ativo).
  const [withPanel, setWithPanel] = useState<string>('');
  useEffect(() => {
    const ids = tabs.filter((t) => document.getElementById(`${idPrefix}-panel-${t.id}`)).map((t) => t.id).join('|');
    if (ids !== withPanel) setWithPanel(ids);
  }, [tabs, withPanel, idPrefix, value]);

  function go(i: number) {
    const t = tabs[(i + tabs.length) % tabs.length];
    onChange(t.id);
    refs.current[t.id]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(tabs.length - 1); }
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className="flex gap-1 overflow-x-auto border-b border-dash-border-soft">
      {tabs.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={active}
            aria-controls={withPanel.split('|').includes(t.id) ? `${idPrefix}-panel-${t.id}` : undefined}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`min-h-[44px] whitespace-nowrap border-b-2 px-4 text-base font-medium focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-dash-brand-green-dark ${
              active ? 'border-dash-brand-green-dark text-dash-primary' : 'border-transparent text-dash-muted hover:text-dash-primary'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
