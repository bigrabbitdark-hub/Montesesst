'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AdminFooter } from './AdminFooter';
import { AdminSidebar } from './AdminSidebar';
import { AdminStatusProvider } from './AdminStatusProvider';
import { AdminTopbar } from './AdminTopbar';
import { CommandPalette } from './CommandPalette';

export function AdminShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="admin-theme min-h-screen">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-emerald-700 focus:px-3 focus:py-2 focus:text-white"
      >
        Pular para o conteúdo
      </a>
      <AdminStatusProvider>
        <div className="flex min-h-screen">
          <AdminSidebar open={menuOpen} onClose={closeMenu} />
          <div className="flex min-w-0 flex-1 flex-col">
            <AdminTopbar menuOpen={menuOpen} onMenu={() => setMenuOpen(true)} onSearch={() => setPaletteOpen(true)} />
            <main id="conteudo" className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 lg:px-8">
              <h1 className="sr-only">Painel administrativo — Montese Control</h1>
              {children}
            </main>
            <AdminFooter />
          </div>
        </div>
        <CommandPalette open={paletteOpen} onClose={closePalette} />
      </AdminStatusProvider>
    </div>
  );
}
