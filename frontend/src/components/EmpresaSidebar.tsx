'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getToken, logout } from '@/lib/auth';

interface NavGroup {
  label: string;
  links: { href: string; label: string; emoji: string }[];
}

interface TenantBranding {
  id: string;
  name: string;
  trade_name: string | null;
  has_logo: boolean;
}

const GROUPS: NavGroup[] = [
  {
    label: 'Visão Geral',
    links: [{ href: '/empresa/dashboard', label: 'Início', emoji: '🏠' }],
  },
  {
    label: 'Segurança',
    links: [
      { href: '/empresa/assistente', label: 'Assistente', emoji: '💬' },
      { href: '/empresa/documentos', label: 'Documentos', emoji: '📄' },
      { href: '/empresa/epis', label: 'EPIs', emoji: '🦺' },
      { href: '/empresa/consulta-ca', label: 'Consulta de CA', emoji: '🔎' },
      { href: '/empresa/inspecoes', label: 'Inspeções', emoji: '📋' },
    ],
  },
  {
    label: 'CIPA',
    links: [
      { href: '/empresa/cipa', label: 'Central da CIPA', emoji: '🦺' },
      { href: '/empresa/cipa/reunioes', label: 'Reuniões', emoji: '📅' },
      { href: '/empresa/cipa/membros', label: 'Membros', emoji: '👥' },
      { href: '/empresa/cipa/eleicao', label: 'Eleição', emoji: '🗳️' },
      { href: '/empresa/cipa/pendencias', label: 'Pendências', emoji: '📌' },
      { href: '/empresa/cipa/capacitacao', label: 'Capacitação', emoji: '🎓' },
    ],
  },
  {
    label: 'Conta',
    links: [{ href: '/empresa/onboarding', label: 'Dados da empresa', emoji: '🏢' }],
  },
];

export function EmpresaSidebar() {
  const pathname = usePathname();
  const [tenant, setTenant] = useState<TenantBranding | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch('/api/tenants/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then(setTenant)
      .catch(() => {});
  }, []);

  return (
    <aside className="flex w-56 shrink-0 flex-col bg-brand-900 px-4 py-10">
      {tenant?.has_logo ? (
        <div className="flex items-center gap-2 px-2">
          <img
            src={`/api/tenants/${tenant.id}/logo`}
            alt="Logo da empresa"
            className="h-9 w-9 shrink-0 rounded-lg object-cover"
          />
          <span className="truncate text-sm font-bold text-white">{tenant.trade_name ?? tenant.name}</span>
        </div>
      ) : (
        <h1 className="px-2 text-lg font-bold text-white">Montese SST</h1>
      )}
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
