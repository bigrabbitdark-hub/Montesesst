'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Logo } from './Logo';

const NAV_LINKS = [
  { href: '/planos', label: 'Planos' },
  { href: '/tecnico/cadastro', label: 'Para Técnicos' },
  { href: '/cursos', label: 'Universidade SST', badge: 'EM BREVE' },
  { href: '/noticias', label: 'Notícias' },
  { href: '/contato', label: 'Contato' },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-brand-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-10">
        <Logo />
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-900 transition-colors hover:text-brand-500"
            >
              {link.label}
              {link.badge && (
                <span className="rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
                  {link.badge}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 sm:gap-4">
          <Link href="/login" className="hidden text-sm font-medium text-brand-900 hover:text-brand-500 sm:inline">
            Entrar
          </Link>
          <Link
            href="/cadastro"
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 sm:px-5"
          >
            Comece grátis
          </Link>
          <button
            type="button"
            aria-label={open ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-900 md:hidden"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav className="flex flex-col gap-1 border-t border-brand-100 px-4 py-3 md:hidden">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-2 py-2.5 text-[15px] font-medium text-brand-900 hover:bg-brand-50"
            >
              {link.label}
              {link.badge && (
                <span className="rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
                  {link.badge}
                </span>
              )}
            </Link>
          ))}
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="rounded-lg px-2 py-2.5 text-[15px] font-medium text-brand-900 hover:bg-brand-50"
          >
            Entrar
          </Link>
        </nav>
      )}
    </header>
  );
}
