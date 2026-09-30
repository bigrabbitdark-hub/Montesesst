import Image from 'next/image';
import { ASSET_PATHS } from '@/lib/dashboard/assets';

// Foto: Macribo71, CC BY-SA 4.0 — a atribuição abaixo é obrigatória
// (docs/specs/dashboard-v2-assets.md). O título da página fica dentro do banner.
export function DashboardBanner({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  return (
    <div className="relative flex min-h-[132px] items-center overflow-hidden rounded-[18px] px-6 py-5 sm:px-8">
      <Image
        src={ASSET_PATHS.bannerHero}
        alt=""
        aria-hidden
        fill
        priority
        sizes="(min-width: 1024px) 1100px, 100vw"
        className="object-cover object-[70%_50%]"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,.92)_0%,rgba(15,23,42,.72)_45%,rgba(15,23,42,.25)_100%)]" />
      <div className="relative z-10">
        <h1 className="text-[28px] font-bold tracking-tight text-white sm:text-[32px]">{titulo}</h1>
        <p className="mt-1 text-sm text-slate-200">{subtitulo}</p>
      </div>
      <a
        href="https://commons.wikimedia.org/wiki/File:Montese_-_Appennino_Modenese_foto_2.jpg"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-1.5 right-3 z-10 text-[10px] text-white/80 hover:text-white hover:underline"
      >
        Foto: Macribo71 · CC BY-SA 4.0
      </a>
    </div>
  );
}
