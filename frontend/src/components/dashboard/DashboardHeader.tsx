import Link from 'next/link';
import { Search, Bell, Sparkles, Menu } from 'lucide-react';

export function DashboardHeader({
  nomeUsuario,
  papel,
  logoSrc,
  menuAberto = false,
  onMenuClick,
  iaHref = '/empresa/assistente',
  comBuscaENotificacoes = true,
}: {
  nomeUsuario: string;
  papel: string;
  logoSrc?: string;
  menuAberto?: boolean;
  onMenuClick?: () => void;
  iaHref?: string | null;
  // Busca e sino ainda são decorativos; ficam só onde já existiam (empresa).
  comBuscaENotificacoes?: boolean;
}) {
  return (
    <header className="flex h-[72px] items-center justify-between border-b border-dash-border-soft bg-dash-card px-4 sm:px-8">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Abrir menu"
        aria-expanded={menuAberto}
        aria-controls="menu-principal"
        className="mr-3 flex h-[42px] w-[42px] flex-none items-center justify-center rounded-xl border border-dash-border-soft hover:bg-dash-page lg:hidden"
      >
        <Menu size={18} className="text-dash-muted" aria-hidden />
      </button>
      {comBuscaENotificacoes && (
        <div className="relative hidden h-[42px] min-w-0 flex-1 sm:block lg:w-[380px] lg:flex-none">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-dash-faint" aria-hidden />
          <input
            type="search"
            aria-label="Pesquisar no sistema"
            placeholder="Pesquisar no sistema…"
            className="h-full w-full rounded-xl border border-dash-border-soft bg-dash-page pl-10 pr-4 text-sm text-dash-primary placeholder:text-dash-faint"
          />
        </div>
      )}
      <div className="ml-auto flex items-center gap-3 sm:gap-4">
        {iaHref && (
          <Link
            href={iaHref}
            className="flex flex-none items-center gap-2 whitespace-nowrap rounded-xl bg-dash-brand-green-light px-4 py-2.5 text-sm font-semibold text-dash-status-ok-text hover:brightness-95"
          >
            <Sparkles size={16} aria-hidden />
            IA SST
          </Link>
        )}
        {comBuscaENotificacoes && (
          <button
            type="button"
            aria-label="Notificações"
            className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-dash-border-soft hover:bg-dash-page"
          >
            <Bell size={18} className="text-dash-muted" aria-hidden />
          </button>
        )}
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoSrc} alt="" aria-hidden className="h-[42px] w-[42px] flex-none rounded-full border border-dash-border-soft object-cover" />
        ) : (
          <div
            aria-hidden
            className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-dash-sidebar text-sm font-bold text-white"
          >
            {nomeUsuario.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="hidden text-sm leading-tight md:block">
          <p className="font-semibold text-dash-primary">{nomeUsuario}</p>
          <p className="text-xs text-dash-muted">{papel}</p>
        </div>
      </div>
    </header>
  );
}
