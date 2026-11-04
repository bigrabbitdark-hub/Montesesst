import { Mail, MessageCircle } from 'lucide-react';
import { MENSAGEM_DIAGNOSTICO_WHATSAPP, diagnosticoMailtoUrl, whatsappUrl } from '@/lib/company';

// Chamada compacta para o diagnóstico inicial gratuito, logo abaixo do hero principal.
export function DiagnosticoHero() {
  return (
    <section aria-labelledby="diagnostico-titulo" className="bg-brand-100 text-brand-900">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-10 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
        <div className="max-w-2xl lg:flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-700">
            Diagnóstico gratuito para empresas
          </p>
          <h2 id="diagnostico-titulo" className="mt-1.5 text-balance text-2xl font-bold leading-tight sm:text-[28px]">
            Sua empresa está em dia com a Segurança do Trabalho?
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-brand-900/85">
            Revisamos gratuitamente as informações de SST que você enviar e entregamos um relatório com pendências e
            recomendações. Diagnóstico inicial, sem custo.
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
          <a
            href={whatsappUrl(MENSAGEM_DIAGNOSTICO_WHATSAPP)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            <MessageCircle size={20} aria-hidden="true" />
            <span>
              Falar com a Montese pelo WhatsApp
              <span className="sr-only"> (abre em nova aba)</span>
            </span>
          </a>
          <a
            href={diagnosticoMailtoUrl()}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border-[1.5px] border-brand-500 px-5 py-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            <Mail size={20} aria-hidden="true" />
            Solicitar diagnóstico por e-mail
          </a>
        </div>
      </div>
    </section>
  );
}
