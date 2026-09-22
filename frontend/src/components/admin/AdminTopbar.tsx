'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { logout } from '@/lib/auth';
import { AdminBrand } from './AdminBrand';
import { useAdminStatus } from './AdminStatusProvider';
import { AdminIcon } from './icons';
import { alertBadgeCount, deriveSystemState, SYSTEM_STATE_LABEL } from './status-state';
import type { SystemState } from './status-state';

const PILL: Record<SystemState, { dot: string; text: string; box: string }> = {
  carregando: { dot: 'bg-slate-400', text: 'text-slate-300', box: 'border-slate-500/40 bg-slate-500/10' },
  online: { dot: 'bg-emerald-400', text: 'text-emerald-300', box: 'border-emerald-400/30 bg-emerald-400/10' },
  degradado: { dot: 'bg-red-400', text: 'text-red-300', box: 'border-red-400/30 bg-red-400/10' },
  'sem-resposta': { dot: 'bg-slate-400', text: 'text-slate-300', box: 'border-slate-500/40 bg-slate-500/10' },
};

// O texto é o que comunica o estado; o ponto colorido é só reforço visual.
function StatusPill() {
  const { system } = useAdminStatus();
  const state = deriveSystemState(system);
  const s = PILL[state];
  return (
    <span role="status" className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-medium ${s.box} ${s.text}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${s.dot}`} />
      <span className="sr-only sm:not-sr-only">{SYSTEM_STATE_LABEL[state]}</span>
    </span>
  );
}

function AlertBell() {
  const { alertas } = useAdminStatus();
  const count = alertBadgeCount(alertas);
  // Sem leitura ainda (carregando ou falha) não é o mesmo que "sem alertas":
  // só afirmamos "nenhum alerta" quando `alertas.data` de fato chegou.
  const label = alertas.data
    ? count > 0
      ? `${count} ${count === 1 ? 'alerta precisa' : 'alertas precisam'} de atenção`
      : 'Nenhum alerta que precise de atenção'
    : alertas.error
      ? 'Alertas indisponíveis'
      : 'Verificando alertas…';
  return (
    <Link
      href="/admin/overview#alertas"
      aria-label={label}
      title={label}
      className="relative rounded-lg p-2 text-brand-700 hover:bg-brand-50 hover:text-brand-900"
    >
      <AdminIcon name="bell" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-800 px-1 text-[10px] font-bold text-white"
        >
          {count}
        </span>
      )}
    </Link>
  );
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        // Fechar por Esc não pode deixar o foco cair no <body>: devolve ao gatilho.
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // O token só carrega id/role/tenantId — sem nome nem e-mail (spec §3, item 1).
  // Padrão disclosure (não menu): um único item, sem navegação por setas nem
  // foco automático — role="menu"/aria-haspopup="menu" prometeriam isso.
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-controls="admin-user-menu-panel"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-brand-900 hover:bg-brand-50"
      >
        <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
          <AdminIcon name="user" className="h-4 w-4" />
        </span>
        <span className="hidden text-left leading-tight lg:block">
          <span className="block text-[13px] font-semibold">Administrador</span>
          <span className="block text-[11px] text-brand-700">Montese Control</span>
        </span>
        <AdminIcon name="chevron" className="hidden h-4 w-4 text-brand-700 lg:block" />
      </button>
      {open && (
        <div id="admin-user-menu-panel" className="adm-card absolute right-0 top-full z-50 mt-2 w-48 p-1">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-brand-900 hover:bg-brand-50"
          >
            <AdminIcon name="logout" className="h-4 w-4" />
            Sair
          </button>
        </div>
      )}
    </div>
  );
}

export function AdminTopbar({
  menuOpen,
  onMenu,
  onSearch,
}: {
  menuOpen: boolean;
  onMenu: () => void;
  onSearch: () => void;
}) {
  return (
    <header className="adm-topbar sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-brand-100 px-4 lg:px-8">
      <button
        type="button"
        aria-label="Abrir menu"
        aria-controls="admin-sidebar"
        aria-expanded={menuOpen}
        onClick={onMenu}
        className="rounded-md p-2 text-brand-900 hover:bg-brand-50 lg:hidden"
      >
        <AdminIcon name="menu" />
      </button>
      {/* Abaixo de sm só o ícone da marca: a marca completa não cabe ao lado dos demais controles. */}
      <div className="lg:hidden [&_a>span]:hidden sm:[&_a>span]:flex">
        <AdminBrand compact />
      </div>

      <button
        type="button"
        onClick={onSearch}
        aria-label="Ir para uma página (Ctrl+K)"
        className="hidden max-w-md flex-1 items-center gap-2 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 text-left text-sm text-brand-700 hover:border-emerald-400/40 lg:flex"
      >
        <AdminIcon name="search" className="h-4 w-4" />
        <span className="flex-1 whitespace-nowrap">Ir para… (Ctrl+K)</span>
      </button>

      <div className="flex-1 lg:hidden" />
      <button
        type="button"
        onClick={onSearch}
        aria-label="Ir para uma página"
        className="rounded-lg p-2 text-brand-700 hover:bg-brand-50 hover:text-brand-900 lg:hidden"
      >
        <AdminIcon name="search" />
      </button>

      <div className="hidden flex-1 lg:block" />
      <StatusPill />
      <AlertBell />
      <UserMenu />
    </header>
  );
}
