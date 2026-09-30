import Image from 'next/image';
import Link from 'next/link';
import { ASSET_PATHS } from '@/lib/dashboard/assets';

// Atalho para a página existente de Reuniões e Visitas (/empresa/agendamentos).
export function ApoioTecnicoCard() {
  return (
    <section
      aria-label="Apoio técnico"
      className="flex flex-col overflow-hidden rounded-[18px] bg-dash-card shadow-[0_4px_12px_rgba(15,23,42,0.08)] md:flex-row"
    >
      <div className="flex flex-1 flex-col justify-center gap-3 p-6">
        <h2 className="text-base font-semibold text-dash-primary">Precisa de apoio técnico?</h2>
        <p className="max-w-[460px] text-sm text-dash-muted">
          Agende uma reunião ou visita com um técnico de segurança do trabalho para tirar dúvidas e resolver pendências com o RH.
        </p>
        <Link
          href="/empresa/agendamentos"
          className="w-fit rounded-xl bg-dash-brand-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-dash-brand-green-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dash-brand-green"
        >
          Agendar reunião ou visita
        </Link>
      </div>
      <div className="relative h-[180px] w-full md:h-auto md:min-h-[180px] md:w-[340px]">
        <Image
          src={ASSET_PATHS.columnFooter}
          alt="Profissional de RH e técnico de segurança do trabalho se cumprimentando em um ambiente industrial"
          fill
          sizes="(min-width: 768px) 340px, 100vw"
          className="object-cover"
        />
      </div>
    </section>
  );
}
