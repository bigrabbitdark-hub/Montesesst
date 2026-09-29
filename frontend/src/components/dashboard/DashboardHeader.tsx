import { Search, Bell } from 'lucide-react';

export function DashboardHeader({
  primeiroNome,
  empresaNome,
  cnpj,
  papel,
}: {
  primeiroNome: string;
  empresaNome: string;
  cnpj: string;
  papel: string;
}) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-dash-border-soft bg-dash-card px-3">
      <div>
        <h1 className="font-[var(--font-sans)] text-xl font-bold text-dash-primary">Bem-vindo, {primeiroNome}!</h1>
        <p className="text-xs text-dash-muted">
          {empresaNome} | CNPJ {cnpj}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-60">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dash-muted" aria-hidden />
          <input
            type="search"
            placeholder="Buscar no sistema..."
            className="h-full w-full rounded-[10px] border border-dash-border-input pl-9 pr-3 text-sm"
          />
        </div>
        <button aria-label="Notificações" className="relative rounded-full p-2 hover:bg-dash-page">
          <Bell size={20} className="text-dash-muted" />
        </button>
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#0F2A6B] text-xs font-bold text-white">
          {primeiroNome.slice(0, 2).toUpperCase()}
        </div>
        <div className="text-xs">
          <p className="font-semibold text-dash-primary">{primeiroNome}</p>
          <p className="text-dash-muted">{papel}</p>
        </div>
      </div>
    </header>
  );
}
