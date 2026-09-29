import Image from 'next/image';
import { ASSET_PATHS } from '@/lib/dashboard/assets';

export function DashboardFooterNew({ version }: { version: string }) {
  return (
    <footer className="flex h-[39px] items-center justify-between border-t border-[#DDE5F1] px-3 text-[11px] text-dash-muted">
      <div className="flex items-center gap-2">
        <Image src={ASSET_PATHS.logo} alt="" aria-hidden height={24} width={106} />
        <span>Segurança do Trabalho organizada, acompanhada e acessível.</span>
      </div>
      <div className="flex items-center gap-3">
        <a href="/ajuda" className="hover:underline">Ajuda</a>
        <a href="/termos" className="hover:underline">Termos de uso</a>
        <a href="/privacidade" className="hover:underline">Política de privacidade</a>
        <span>v{version}</span>
      </div>
    </footer>
  );
}
