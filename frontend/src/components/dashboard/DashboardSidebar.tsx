'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MENU_ITEMS } from '@/lib/dashboard/menu';
import { ASSET_PATHS } from '@/lib/dashboard/assets';
import { ImagePlaceholder } from './ImagePlaceholder';

export function DashboardSidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex h-screen w-[212px] flex-none flex-col bg-dash-sidebar px-2 py-3" aria-label="Menu principal">
      <div className="mb-3.5 flex h-[58px] items-center justify-center rounded-[10px] bg-white">
        <Image src={ASSET_PATHS.logo} alt="Montese SST" width={176} height={40} />
      </div>
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {MENU_ITEMS.map(({ href, label, icon: Icon, implemented }) => {
          const active = pathname === href;
          return (
            <li key={label}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-[34px] items-center gap-2 rounded-lg px-2.5 text-[13.5px] font-semibold ${
                  active ? 'bg-dash-brand-green text-white' : 'text-[#DCE6FF] hover:bg-white/5'
                } ${!implemented ? 'opacity-70' : ''}`}
              >
                <Icon size={17} strokeWidth={2} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="relative mt-2 h-[150px] overflow-hidden rounded-[10px]">
        <ImagePlaceholder label="bg-menu-tecnicas.jpg" className="absolute inset-0" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#0A1640_0%,rgba(10,22,64,.55)_30%,rgba(10,22,64,.10)_100%)]" />
        <p className="absolute bottom-3 left-3 right-3 text-[12.5px] font-semibold text-white">
          Tecnologia organiza.
          <br />
          Pessoas protegem.
        </p>
        <div className="absolute bottom-1 left-3 h-[3px] w-12 bg-[linear-gradient(90deg,#16A34A_33%,white_33%,white_66%,#E23B3B_66%)]" />
      </div>
    </nav>
  );
}
