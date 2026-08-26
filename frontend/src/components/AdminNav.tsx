'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin/empresas', label: 'Empresas' },
  { href: '/admin/tecnicos', label: 'Técnicos' },
  { href: '/admin/parceiros', label: 'Parceiros' },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-4 border-b border-brand-100 pb-4">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={
            pathname === link.href
              ? 'font-semibold text-brand-900'
              : 'text-brand-700 hover:text-brand-900'
          }
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
