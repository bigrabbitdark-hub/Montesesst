'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { MENU_ITEMS, EXTRA_MENU_ITEMS, type MenuItem } from '@/lib/dashboard/menu';
import { ASSET_PATHS } from '@/lib/dashboard/assets';

function NavItem({ item, pathname }: { item: MenuItem; pathname: string }) {
  const { href, label, icon: Icon, implemented } = item;
  const active = pathname === href;
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={`flex h-[42px] items-center gap-3 rounded-xl px-3.5 text-[15px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${
          active ? 'bg-dash-brand-green text-white' : 'text-slate-300 hover:bg-dash-sidebar-hover'
        } ${!implemented ? 'opacity-70' : ''}`}
      >
        <Icon size={18} strokeWidth={2} aria-hidden />
        {label}
      </Link>
    </li>
  );
}

export function DashboardSidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname() ?? '';
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden" onClick={onClose} aria-hidden />}
      <nav
        id="menu-principal"
        aria-label="Menu principal"
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-[280px] flex-none flex-col bg-dash-sidebar px-4 py-5 transition-transform lg:sticky lg:top-0 lg:z-auto lg:visible lg:translate-x-0 ${
          open ? 'visible translate-x-0' : 'invisible -translate-x-full'
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar menu"
          className="absolute -right-12 top-5 rounded-xl bg-dash-sidebar p-2.5 text-white lg:hidden"
        >
          <X size={20} aria-hidden />
        </button>
      <div className="mb-4 flex h-[72px] items-center justify-center rounded-xl bg-white">
        <Image src={ASSET_PATHS.logo} alt="Montese SST" width={1224} height={270} priority className="h-auto w-[200px]" />
      </div>
      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {MENU_ITEMS.map((item) => (
          <NavItem key={item.label} item={item} pathname={pathname} />
        ))}
        <li aria-hidden className="mt-3 px-3.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Mais ferramentas
        </li>
        {EXTRA_MENU_ITEMS.map((item) => (
          <NavItem key={item.label} item={item} pathname={pathname} />
        ))}
      </ul>
        {/* Só em telas altas: em alturas menores o espaço é da lista de ferramentas. */}
        <div className="relative mt-2 hidden h-[150px] flex-none overflow-hidden rounded-xl [@media(min-height:1100px)]:block">
          <Image src={ASSET_PATHS.sidebarFooter} alt="" aria-hidden fill sizes="248px" className="object-cover object-[50%_30%]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,#0F172A_0%,rgba(15,23,42,.45)_35%,rgba(15,23,42,.25)_100%)]" />
          <p className="absolute bottom-3 left-3 right-3 text-[12.5px] font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.85)]">
            Tecnologia organiza.
            <br />
            Pessoas protegem.
          </p>
        </div>
      </nav>
    </>
  );
}
