'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/lib/auth';

interface NavGroup {
  label: string;
  links: { href: string; label: string; emoji: string }[];
}

const GROUPS: NavGroup[] = [
  {
    label: 'Carteira',
    links: [{ href: '/tecnico/empresas', label: 'Suas empresas', emoji: '🏢' }],
  },
  {
    label: 'Trabalho',
    links: [
      { href: '/tecnico/agenda', label: 'Agenda', emoji: '📅' },
      { href: '/tecnico/consulta-ca', label: 'Consulta de CA', emoji: '🔎' },
    ],
  },
];

export function TecnicoSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col bg-brand-900 px-4 py-10">
      <h1 className="px-2 text-lg font-bold text-white">Montese SST</h1>
      <nav className="mt-6 flex flex-1 flex-col gap-5">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 text-xs font-bold uppercase tracking-wide text-white/60">{group.label}</p>
            <div className="mt-1 flex flex-col gap-1">
              {group.links.map((link) => {
                const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={
                      isActive
                        ? 'flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-brand-900'
                        : 'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10'
                    }
                  >
                    <span aria-hidden="true">{link.emoji}</span>
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <button
        onClick={logout}
        className="mt-6 flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-white/90 hover:bg-white/10"
      >
        <span aria-hidden="true">🚪</span>
        Sair
      </button>
    </aside>
  );
}
