'use client';

import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { AdminBrand } from './AdminBrand';
import { AdminFooter } from './AdminFooter';
import { AdminSidebar } from './AdminSidebar';
import { AdminIcon } from './icons';

export function AdminShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div className="admin-theme min-h-screen">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-emerald-600 focus:px-3 focus:py-2 focus:text-white"
      >
        Pular para o conteúdo
      </a>
      <div className="flex min-h-screen">
        <AdminSidebar open={menuOpen} onClose={closeMenu} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="adm-topbar sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-brand-100 px-4 lg:hidden">
            <button
              type="button"
              aria-label="Abrir menu"
              aria-controls="admin-sidebar"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              className="rounded-md p-2 text-brand-900 hover:bg-brand-50"
            >
              <AdminIcon name="menu" />
            </button>
            <AdminBrand compact />
          </header>
          <main id="conteudo" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 lg:px-8">
            {children}
          </main>
          <AdminFooter />
        </div>
      </div>
    </div>
  );
}
