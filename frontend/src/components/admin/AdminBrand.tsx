import Link from 'next/link';

// Marca do painel: ícone da Montese (montanha + escudo, fundo transparente) +
// texto em Poppins. Não altera components/Logo.tsx (mudanças do site em andamento).
// <img> simples: o next.config usa images.unoptimized, então next/image não traria ganho.
export function AdminBrand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/admin/overview"
      aria-label="Montese Control — Visão Geral"
      className="flex items-center gap-3 rounded-lg outline-offset-4 focus-visible:outline-2 focus-visible:outline-emerald-400"
    >
      <img src="/brand/logo-icon-mark.png" alt="" height={32} className="h-8 w-auto shrink-0" />
      <span className="flex flex-col leading-none">
        <span className="text-[17px] font-extrabold tracking-wide text-white">MONTESE</span>
        <span className="mt-1 text-[10px] font-semibold tracking-[0.42em] text-adm-brand">CONTROL</span>
        {!compact && <span className="adm-text-faint mt-1.5 text-[9px]">Centro de comando da Montese</span>}
      </span>
    </Link>
  );
}
