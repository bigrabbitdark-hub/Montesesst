'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { logout } from '@/lib/auth';
import { AdminBrand } from './AdminBrand';
import { AdminIcon } from './icons';
import { ADMIN_NAV, isNavActive } from './nav';

// Fixa e visível em ≥ 1024 px; abaixo disso vira drawer (foco preso enquanto
// aberto, Esc fecha, fecha ao navegar e devolve o foco a quem abriu).
export function AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);

  // Fecha ao navegar. Só `pathname` nas deps de propósito: `onClose` é estável
  // no AdminShell (useCallback), mas não queremos re-disparar por isso.
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(ref.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open, onClose]);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" aria-hidden="true" onClick={onClose} />}
      <aside
        ref={ref}
        id="admin-sidebar"
        aria-label="Menu do painel"
        className={`adm-sidebar fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-brand-100 px-4 py-5 transition-transform duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 ${
          open ? 'translate-x-0' : 'invisible -translate-x-full lg:visible'
        }`}
      >
        <div className="flex items-start justify-between gap-2 px-1">
          <AdminBrand />
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={onClose}
            className="rounded-md p-1.5 text-brand-700 hover:bg-brand-50 hover:text-brand-900 lg:hidden"
          >
            <AdminIcon name="close" className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Seções do painel" className="-mx-2 mt-7 flex flex-1 flex-col gap-5 overflow-y-auto px-2 py-1">
          {ADMIN_NAV.map((group, index) => (
            <div key={group.label ?? `grupo-${index}`}>
              {group.label && (
                <p className="adm-text-faint px-3 text-[11px] font-semibold uppercase tracking-wider">{group.label}</p>
              )}
              <ul className="mt-1 flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = isNavActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                          active
                            ? 'bg-emerald-500/15 font-semibold text-brand-900'
                            : 'text-brand-700 hover:bg-brand-50 hover:text-brand-900'
                        }`}
                      >
                        {active && (
                          <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-emerald-400" />
                        )}
                        <AdminIcon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={logout}
          className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-brand-700 hover:bg-brand-50 hover:text-brand-900"
        >
          <AdminIcon name="logout" className="h-[18px] w-[18px] shrink-0" />
          Sair
        </button>
      </aside>
    </>
  );
}
