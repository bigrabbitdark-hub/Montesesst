import { ImagePlaceholder } from './ImagePlaceholder';

export function DashboardHero() {
  return (
    <div className="relative flex h-[120px] items-center justify-between overflow-hidden rounded-[10px] px-6">
      <ImagePlaceholder label="bg-banner-montese.jpg" className="absolute inset-0" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,18,48,.94)_0%,rgba(10,22,64,.78)_38%,rgba(10,22,64,.30)_70%,rgba(10,22,64,.62)_100%)]" />
      <div className="relative z-10 max-w-[380px]">
        <p className="font-[var(--font-sans)] text-[25px] font-bold leading-tight text-white">
          Segurança de verdade
          <br />
          <span className="text-dash-brand-green-light">move grandes histórias.</span>
        </p>
        <p className="mt-1 text-[12.5px] text-[#E2E8F0]">Organize sua SST. Proteja quem faz acontecer.</p>
      </div>
      <div className="relative z-10 hidden w-[200px] text-right text-white lg:block">
        <p className="text-[15px] italic">&ldquo;O preparo de hoje evita o acidente de amanhã.&rdquo;</p>
        <p className="mt-1 text-[11px] font-bold">Montese SST</p>
      </div>
    </div>
  );
}
