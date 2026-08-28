'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin/overview', label: 'Visão Geral' },
  { href: '/admin/empresas', label: 'Empresas' },
  { href: '/admin/tecnicos', label: 'Técnicos' },
  { href: '/admin/parceiros', label: 'Parceiros' },
  { href: '/admin/auditoria', label: 'Auditoria' },
  { href: '/admin/financeiro', label: 'Financeiro' },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-brand-100 px-4 py-10">
      <h1 className="px-2 text-lg font-bold text-brand-900">Painel administrativo</h1>
      <nav className="mt-6 flex flex-col gap-1">
        {LINKS.map((link) => {
          const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={
                isActive
                  ? 'rounded-md bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900'
                  : 'rounded-md px-3 py-2 text-sm text-brand-700 hover:bg-brand-50 hover:text-brand-900'
              }
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
