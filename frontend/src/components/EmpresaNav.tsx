'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/empresa/dashboard', label: 'Início' },
  { href: '/empresa/documentos', label: 'Documentos' },
  { href: '/empresa/epis', label: 'EPIs' },
  { href: '/empresa/inspecoes', label: 'Inspeções' },
  { href: '/empresa/onboarding', label: 'Dados da empresa' },
];

export function EmpresaNav() {
  const pathname = usePathname();

  return (
    <nav className="mx-auto flex max-w-2xl flex-wrap gap-4 border-b border-brand-100 px-4 pb-4 pt-8">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={
            pathname === link.href
              ? 'text-sm font-semibold text-brand-900'
              : 'text-sm text-brand-700 hover:text-brand-900'
          }
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
