import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  BarChart3,
  Bot,
  BookOpen,
  Eye,
  Handshake,
  HardHat,
  ClipboardCheck,
  FileSearch,
  MapPin,
  Puzzle,
  RefreshCw,
  Scale,
  SearchCheck,
  ShieldCheck,
  Target,
} from 'lucide-react';
import { TEAM } from '@/lib/team';
import { TeamCard } from '@/components/TeamCard';

export const metadata: Metadata = {
  title: 'Quem somos — Montese SST',
  description:
    'A Montese SST cuida do depois: confere a documentação de SST da sua empresa, avisa o que está vencendo e acompanha o plano de ação, com um técnico de verdade ao seu lado.',
};

const PASSOS = [
  {
    icon: FileSearch,
    title: 'Diagnóstico',
    description: 'Analisamos os documentos que a sua empresa já tem.',
  },
  {
    icon: ClipboardCheck,
    title: 'Organização',
    description: 'Tudo entra na plataforma, com score de conformidade e lista de pendências.',
  },
  {
    icon: RefreshCw,
    title: 'Acompanhamento',
    description: 'O técnico responsável monitora vencimentos, plano de ação e mudanças na empresa.',
  },
  {
    icon: MapPin,
    title: 'Visitas presenciais',
    description: 'Quando necessário, feitas pela rede de técnicos parceiros.',
  },
];

const VALORES = [
  {
    icon: ShieldCheck,
    title: 'Prevenimos antes de reagir',
    paragraphs: ['Acreditamos que o melhor problema de SST é aquele que conseguimos identificar e prevenir antes que aconteça.'],
  },
  {
    icon: SearchCheck,
    title: 'Só afirmamos o que conseguimos comprovar',
    paragraphs: [
      'A Montese não deve inventar respostas.',
      'Informações importantes precisam estar apoiadas em documentos, registros, medições, fontes oficiais ou evidências identificáveis.',
    ],
  },
  {
    icon: BookOpen,
    title: 'Respeitamos o limite da tecnologia e a responsabilidade do profissional',
    paragraphs: [
      'SST exige responsabilidade técnica.',
      'Por isso, buscamos trabalhar com legislação, normas, referências oficiais e conhecimento especializado, reconhecendo os limites da tecnologia e a importância dos profissionais habilitados.',
    ],
  },
  {
    icon: Bot,
    title: 'Tecnologia organiza, gente protege',
    paragraphs: [
      'A inteligência artificial deve facilitar o trabalho dos profissionais, organizar informações e encontrar padrões que poderiam passar despercebidos.',
      'A tecnologia apoia. O profissional decide.',
    ],
  },
  {
    icon: Handshake,
    title: 'Nenhum documento fica esquecido numa pasta',
    paragraphs: [
      'Não queremos ser apenas uma empresa que entrega documentos.',
      'Queremos acompanhar a realidade da empresa, entender seus desafios e ajudar a construir uma cultura permanente de prevenção.',
    ],
  },
  {
    icon: HardHat,
    title: 'Lembramos que por trás de cada risco existe uma pessoa',
    paragraphs: [
      'Por trás de cada documento, risco ou indicador existe uma pessoa.',
      'Nosso trabalho tem como finalidade contribuir para ambientes de trabalho mais seguros e saudáveis.',
    ],
  },
  {
    icon: RefreshCw,
    title: 'Acompanhamos as mudanças, porque a SST não termina',
    paragraphs: [
      'SST não é um projeto que termina.',
      'Riscos mudam, equipes mudam, processos mudam e a legislação evolui. A Montese deve acompanhar essas mudanças continuamente.',
    ],
  },
  {
    icon: Puzzle,
    title: 'Juntamos SST, RH e gestão numa só visão',
    paragraphs: [
      'Segurança do Trabalho não funciona isoladamente.',
      'Por isso, aproximamos SST, RH, gestão, saúde ocupacional e tecnologia, criando uma visão integrada da empresa.',
    ],
  },
  {
    icon: BarChart3,
    title: 'Mostramos o que fazemos e quem fez',
    paragraphs: ['O cliente deve conseguir entender:'],
    list: [
      'o que foi identificado;',
      'onde foi identificado;',
      'qual documento comprova;',
      'qual norma está relacionada;',
      'o que precisa ser corrigido;',
      'o que ainda precisa ser confirmado.',
    ],
  },
  {
    icon: Scale,
    title: 'Falamos a verdade sobre o risco, mesmo quando não é o que o cliente quer ouvir',
    paragraphs: [
      'A Montese reconhece que Segurança e Saúde no Trabalho envolve consequências humanas, técnicas, legais e previdenciárias.',
      'Por isso, nossas soluções devem priorizar responsabilidade, rastreabilidade e segurança das informações.',
    ],
  },
];

export default function QuemSomosPage() {
  return (
    <div>
      {/* HERO */}
      <section className="relative isolate overflow-hidden bg-brand-900">
        <svg
          viewBox="0 0 1440 500"
          preserveAspectRatio="xMidYMax slice"
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-40"
          aria-hidden="true"
        >
          <polygon points="0,340 140,220 260,300 400,160 540,280 680,190 820,300 960,200 1100,290 1240,210 1380,300 1440,260 1440,500 0,500" fill="var(--color-brand-700)" />
          <polygon points="0,400 180,280 340,370 500,240 660,360 820,260 980,370 1140,270 1300,370 1440,320 1440,500 0,500" fill="var(--color-brand-500)" opacity="0.6" />
        </svg>
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-10 sm:py-24 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rise">
            <h1 className="text-balance text-[40px] font-bold leading-[1.1] tracking-tight text-white sm:text-[56px]">
              A Montese SST cuida do que vem depois do documento.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-brand-100">
              A maioria das empresas faz o PGR e o PCMSO, guarda numa pasta e só lembra deles quando chega uma
              fiscalização ou um acidente. A consultoria entrega o documento e vai embora. A Montese SST confere se
              a sua documentação está correta e coerente, avisa o que está vencendo, acompanha o plano de ação e
              mantém tudo organizado numa plataforma, com um técnico de verdade acompanhando a sua empresa.
            </p>
          </div>
          <div className="rise overflow-hidden rounded-3xl shadow-2xl shadow-black/30 [animation-delay:150ms]">
            <Image
              src="/photos/tecnico-campo.jpg"
              alt="Técnica de capacete branco segurando uma planta de obra contra o céu"
              width={1600}
              height={900}
              priority
              sizes="(min-width: 1024px) 40vw, 100vw"
              className="h-[300px] w-full object-cover sm:h-[360px]"
            />
          </div>
        </div>
      </section>

      {/* COMO TRABALHAMOS */}
      <section className="bg-brand-50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-10 sm:py-24">
          <h2 className="max-w-2xl text-balance text-[30px] font-bold leading-tight text-brand-900 sm:text-[38px]">
            Como trabalhamos
          </h2>
          <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PASSOS.map((passo, i) => (
              <li key={passo.title} className="rounded-2xl border border-brand-100 bg-white p-6">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100">
                  <passo.icon size={24} strokeWidth={1.75} className="text-brand-700" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-brand-900">
                  {i + 1}. {passo.title}
                </h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink/80">{passo.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* MISSÃO E VISÃO */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-10 sm:py-28">
        <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
          <div className="rounded-3xl bg-brand-700 p-8 text-white shadow-xl shadow-brand-900/15 sm:p-10">
            <Target size={28} strokeWidth={1.75} className="text-brand-300" aria-hidden="true" />
            <h2 className="mt-5 text-lg font-semibold text-brand-100">Nossa missão</h2>
            <p className="mt-3 text-balance text-[24px] font-semibold leading-snug sm:text-[28px]">
              Garantir que a segurança do trabalho das empresas não termine na entrega do documento, unindo
              tecnologia e acompanhamento técnico próximo.
            </p>
            <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-brand-100">
              <p>
                Ajudamos empresas a cuidar das pessoas, cumprir suas responsabilidades e antecipar riscos antes que
                eles se transformem em acidentes, afastamentos, prejuízos ou problemas legais.
              </p>
              <p className="font-semibold text-white">Queremos fazer da Segurança do Trabalho uma parte viva da gestão da empresa.</p>
            </div>
          </div>

          <div className="rounded-3xl border border-brand-100 bg-brand-50 p-8 sm:p-10">
            <Eye size={28} strokeWidth={1.75} className="text-brand-500" aria-hidden="true" />
            <h2 className="mt-5 text-lg font-semibold text-brand-700">Nossa visão</h2>
            <p className="mt-3 text-balance text-[22px] font-semibold leading-snug text-brand-900 sm:text-[24px]">
              Ser uma das principais plataformas de Segurança e Saúde no Trabalho do Brasil, tornando a gestão de SST
              mais simples, preventiva, transparente e inteligente.
            </p>
            <p className="mt-6 text-[15px] leading-relaxed text-ink/80">
              Queremos construir um ecossistema em que empresas, profissionais de SST, RH e trabalhadores tenham
              acesso às informações necessárias para identificar riscos, acompanhar obrigações e melhorar
              continuamente o ambiente de trabalho, reconhecida por cuidar do que os outros deixam para trás.
            </p>
          </div>
        </div>
      </section>

      {/* VALORES */}
      <section className="bg-brand-50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-10 sm:py-28">
          <h2 className="max-w-2xl text-balance text-[30px] font-bold leading-tight text-brand-900 sm:text-[38px]">
            Nossos valores
          </h2>
          <ul className="mt-12 grid gap-5 md:grid-cols-2">
            {VALORES.map((valor) => (
              <li key={valor.title} className="flex gap-5 rounded-2xl border border-brand-100 bg-white p-6">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-100">
                  <valor.icon size={24} strokeWidth={1.75} className="text-brand-700" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-brand-900">{valor.title}</h3>
                  <div className="mt-2 space-y-2 text-[14.5px] leading-relaxed text-ink/80">
                    {valor.paragraphs.map((text) => (
                      <p key={text}>{text}</p>
                    ))}
                    {'list' in valor && valor.list && (
                      <ul className="list-disc space-y-0.5 pl-5 marker:text-brand-400">
                        {valor.list.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* EQUIPE */}
      <section className="border-t border-brand-100 bg-brand-50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-10 sm:py-28">
          <h2 className="max-w-2xl text-balance text-[30px] font-bold leading-tight text-brand-900 sm:text-[38px]">
            Nossa equipe
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-ink/80">
            Pessoas reais, com responsabilidade técnica, acompanhando a sua empresa de perto.
          </p>
          <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {TEAM.map((member) => (
              <TeamCard key={member.id} member={member} />
            ))}
          </ul>
        </div>
      </section>

      {/* POR QUE ESSE NOME */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-10 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <h2 className="text-balance text-[30px] font-bold leading-tight text-brand-900 sm:text-[38px]">
            Por que esse nome
          </h2>
          <div className="max-w-prose space-y-5 text-[16px] leading-relaxed text-ink/85">
            <p>
              Montese é uma comuna nos Apeninos, no norte da Itália, onde soldados da Força Expedicionária
              Brasileira conquistaram, entre 14 e 17 de abril de 1945, um terreno hostil degrau por degrau.
              Escolhemos o nome como lembrança do que significa preparo e cuidado com quem está na linha de frente.
              Não comparamos o risco de um escritório ou canteiro de obras ao de um campo de batalha, mas a ideia
              vale: quem está exposto ao risco merece ser protegido por gente preparada.
            </p>
            <p className="text-xs text-muted">Fonte histórica: Batalha de Montese, abril de 1945.</p>
          </div>
        </div>
      </section>

      {/* COMPROMISSO */}
      <section className="bg-brand-900">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-10 sm:py-28">
          <h2 className="text-lg font-semibold text-brand-300">Nosso compromisso</h2>
          <p className="mt-5 text-balance text-[24px] font-semibold leading-snug text-white sm:text-[30px]">
            Não queremos apenas ajudar empresas a cumprir obrigações. Queremos ajudá-las a entender seus riscos,
            organizar sua gestão, acompanhar suas responsabilidades e construir ambientes de trabalho cada vez mais
            seguros.
          </p>
          <p className="mt-8 text-base text-brand-100">
            Montese SST — tecnologia para organizar, inteligência para identificar e pessoas para proteger.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-brand-700">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-10 sm:py-24">
          <h2 className="mx-auto max-w-2xl text-balance text-[30px] font-bold leading-tight text-white sm:text-[38px]">
            Vamos conversar sobre a SST da sua empresa?
          </h2>
          <div className="mt-8 flex flex-wrap justify-center gap-3.5">
            <Link
              href="/contato"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-7 py-4 text-[15px] font-semibold text-brand-700 transition-colors hover:bg-brand-100"
            >
              Fale com a gente
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
            <Link
              href="/cadastro"
              className="inline-flex items-center rounded-xl border-[1.5px] border-white/70 px-7 py-4 text-[15px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              Comece grátis
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
