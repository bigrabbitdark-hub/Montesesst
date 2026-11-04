'use client';

import Image from 'next/image';
import { ChevronLeft, ChevronRight, Mail, MessageCircle, Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { MENSAGEM_DIAGNOSTICO_WHATSAPP, diagnosticoMailtoUrl, whatsappUrl } from '@/lib/company';

// Área de um botão desenhado na imagem, em pixels da arte original (1672×941).
interface Area {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

interface Slide {
  src: string;
  alt: string;
  email: Area;
  whatsapp: Area;
}

const ARTE_W = 1672;
const ARTE_H = 941;

const SLIDES: Slide[] = [
  {
    src: '/banners/diagnostico-gratuito.webp',
    alt: 'Diagnóstico gratuito para empresas: sua empresa está em dia com a Segurança do Trabalho? A Montese SST revisa gratuitamente as informações de SST da sua empresa e entrega um relatório de melhorias. Solicite por e-mail, eng.evelynsouza@montesesst.com.br, ou pelo WhatsApp (48) 99205-0516.',
    email: { x1: 44, x2: 745, y1: 772, y2: 888 },
    whatsapp: { x1: 836, x2: 1516, y1: 772, y2: 888 },
  },
  {
    src: '/banners/diagnostico-tributario.webp',
    alt: 'Diagnóstico tributário gratuito: sua empresa pode estar pagando mais impostos do que deveria? Uma análise estratégica da SST pode revelar inconsistências e possibilidades legais de redução de custos. Avalia RAT/SAT, FAP, CNAE e grau de risco, folha de pagamento, eSocial SST, LTCAT e PPP. Solicite por e-mail, eng.evelynsouza@montesesst.com.br, ou pelo WhatsApp (48) 99205-0516.',
    email: { x1: 28, x2: 688, y1: 778, y2: 897 },
    whatsapp: { x1: 710, x2: 1268, y1: 778, y2: 897 },
  },
];

function areaStyle(a: Area) {
  return {
    left: `${(a.x1 / ARTE_W) * 100}%`,
    top: `${(a.y1 / ARTE_H) * 100}%`,
    width: `${((a.x2 - a.x1) / ARTE_W) * 100}%`,
    height: `${((a.y2 - a.y1) / ARTE_H) * 100}%`,
  };
}

const linkArea =
  'absolute rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

const INTERVALO_MS = 6000;

const ctrl =
  'inline-flex h-12 w-12 items-center justify-center rounded-full border-[1.5px] border-brand-500 bg-white text-brand-700 transition-colors hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';

export function BannerCarousel() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hover, setHover] = useState(false);
  const [focusDentro, setFocusDentro] = useState(false);
  const [toqueX, setToqueX] = useState<number | null>(null);
  const n = SLIDES.length;

  const step = useCallback((delta: number) => setIndex((i) => (i + delta + n) % n), [n]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing || hover || focusDentro) return;
    const id = setInterval(() => step(1), INTERVALO_MS);
    return () => clearInterval(id);
  }, [playing, hover, focusDentro, step]);

  return (
    <section aria-roledescription="carrossel" aria-label="Destaques da Montese SST" className="bg-brand-50">
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-10 sm:pb-14 sm:pt-14">
        <h2 className="sr-only">Destaques da Montese SST</h2>

        <div
          className="overflow-hidden rounded-2xl bg-brand-900 shadow-xl shadow-brand-900/25"
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onFocus={() => setFocusDentro(true)}
          onBlur={() => setFocusDentro(false)}
          onTouchStart={(e) => setToqueX(e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (toqueX === null) return;
            const dx = e.changedTouches[0].clientX - toqueX;
            if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
            setToqueX(null);
          }}
        >
          <div
            className="flex transition-transform duration-700 ease-out motion-reduce:transition-none"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {SLIDES.map((s, i) => (
              <div
                key={s.src}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} de ${n}`}
                aria-hidden={i !== index}
                className="relative aspect-video w-full shrink-0"
              >
                <Image
                  src={s.src}
                  alt={s.alt}
                  fill
                  sizes="(min-width: 1152px) 1072px, 100vw"
                  className="object-cover"
                />
                <a
                  href={diagnosticoMailtoUrl()}
                  aria-label="Solicitar diagnóstico por e-mail"
                  tabIndex={i === index ? 0 : -1}
                  className={linkArea}
                  style={areaStyle(s.email)}
                />
                <a
                  href={whatsappUrl(MENSAGEM_DIAGNOSTICO_WHATSAPP)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Falar com a Montese pelo WhatsApp (abre em nova aba)"
                  tabIndex={i === index ? 0 : -1}
                  className={linkArea}
                  style={areaStyle(s.whatsapp)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={() => step(-1)} aria-label="Banner anterior" className={ctrl}>
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <div className="flex items-center">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Ir para o banner ${i + 1} de ${n}`}
                aria-current={i === index}
                className="inline-flex h-11 w-11 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              >
                <span
                  className={`block h-2.5 rounded-full transition-all ${i === index ? 'w-7 bg-brand-700' : 'w-2.5 bg-brand-300'}`}
                />
              </button>
            ))}
          </div>
          <button type="button" onClick={() => step(1)} aria-label="Próximo banner" className={ctrl}>
            <ChevronRight size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? 'Pausar a rotação automática dos banners' : 'Retomar a rotação automática dos banners'}
            className="ml-3 inline-flex min-h-12 items-center gap-2 rounded-full border-[1.5px] border-brand-500 bg-white px-5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            {playing ? 'Pausar' : 'Reproduzir'}
          </button>
        </div>
        {/* Em telas pequenas os botões desenhados na imagem ficam minúsculos: botões reais, grandes, abaixo. */}
        <div className="mt-5 flex flex-col gap-3 sm:hidden">
          <a
            href={whatsappUrl(MENSAGEM_DIAGNOSTICO_WHATSAPP)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 text-sm font-bold text-white transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            <MessageCircle size={20} aria-hidden="true" />
            Falar com a Montese pelo WhatsApp
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
          <a
            href={diagnosticoMailtoUrl()}
            className="inline-flex min-h-[52px] items-center justify-center gap-2 rounded-xl border-[1.5px] border-brand-500 bg-white px-5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            <Mail size={20} aria-hidden="true" />
            Solicitar diagnóstico por e-mail
          </a>
        </div>
        <div className="mx-auto mt-3 min-h-[3.25rem] max-w-3xl text-center">
          {index === 1 && (
            <p className="text-[13px] leading-relaxed text-brand-900/80">
              Diagnóstico feito a partir do cruzamento dos documentos da empresa. A redução legal de custos depende de
              a documentação estar em ordem e da legislação aplicável a cada caso.
            </p>
          )}
        </div>
        <p className="sr-only" aria-live="polite">{`Banner ${index + 1} de ${n}`}</p>
      </div>
    </section>
  );
}
