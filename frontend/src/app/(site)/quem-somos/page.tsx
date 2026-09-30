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
  HeartHandshake,
  Linkedin,
  Puzzle,
  RefreshCw,
  Scale,
  SearchCheck,
  ShieldCheck,
  Target,
  Timer,
  User,
  Users,
} from 'lucide-react';
import { TEAM } from '@/lib/team';

export const metadata: Metadata = {
  title: 'Quem somos — Montese SST',
  description:
    'Missão, visão e valores da Montese SST: tecnologia para organizar, inteligência para identificar e pessoas para proteger.',
};

const MARCOS = [
  {
    quando: 'Abril de 1945',
    titulo: 'A Batalha de Montese',
    texto: 'Soldados da Força Expedicionária Brasileira conquistam, na Itália, um terreno hostil degrau por degrau.',
  },
  {
    quando: 'O nome',
    titulo: 'Uma lembrança de preparo',
    texto: 'Escolhemos Montese para lembrar o que significa cuidado e preparo com quem está na linha de frente.',
  },
  {
    quando: 'Hoje',
    titulo: 'Plataforma em operação',
    texto: 'Empresas, técnicos responsáveis e técnicos parceiros conectados, com foco inicial no Sul de Santa Catarina.',
  },
  {
    quando: 'Em construção',
    titulo: 'Agentes e Universidade Montese',
    texto: 'Orientação normativa a qualquer hora e capacitação dentro da plataforma. Ainda não disponíveis.',
  },
];

const VALORES = [
  {
    icon: ShieldCheck,
    title: 'Prevenção acima da reação',
    paragraphs: ['Acreditamos que o melhor problema de SST é aquele que conseguimos identificar e prevenir antes que aconteça.'],
  },
  {
    icon: SearchCheck,
    title: 'Evidência acima da suposição',
    paragraphs: [
      'A Montese não deve inventar respostas.',
      'Informações importantes precisam estar apoiadas em documentos, registros, medições, fontes oficiais ou evidências identificáveis.',
    ],
  },
  {
    icon: BookOpen,
    title: 'Conhecimento técnico',
    paragraphs: [
      'SST exige responsabilidade técnica.',
      'Por isso, buscamos trabalhar com legislação, normas, referências oficiais e conhecimento especializado, reconhecendo os limites da tecnologia e a importância dos profissionais habilitados.',
    ],
  },
  {
    icon: Bot,
    title: 'Tecnologia a serviço das pessoas',
    paragraphs: [
      'A inteligência artificial deve facilitar o trabalho dos profissionais, organizar informações e encontrar padrões que poderiam passar despercebidos.',
      'A tecnologia apoia. O profissional decide.',
    ],
  },
  {
    icon: Handshake,
    title: 'Parceria com o cliente',
    paragraphs: [
      'Não queremos ser apenas uma empresa que entrega documentos.',
      'Queremos acompanhar a realidade da empresa, entender seus desafios e ajudar a construir uma cultura permanente de prevenção.',
    ],
  },
  {
    icon: HardHat,
    title: 'Segurança começa pelas pessoas',
    paragraphs: [
      'Por trás de cada documento, risco ou indicador existe uma pessoa.',
      'Nosso trabalho tem como finalidade contribuir para ambientes de trabalho mais seguros e saudáveis.',
    ],
  },
  {
    icon: RefreshCw,
    title: 'Melhoria contínua',
    paragraphs: [
      'SST não é um projeto que termina.',
      'Riscos mudam, equipes mudam, processos mudam e a legislação evolui. A Montese deve acompanhar essas mudanças continuamente.',
    ],
  },
  {
    icon: Puzzle,
    title: 'Integração',
    paragraphs: [
      'Segurança do Trabalho não funciona isoladamente.',
      'Por isso, aproximamos SST, RH, gestão, saúde ocupacional e tecnologia, criando uma visão integrada da empresa.',
    ],
  },
  {
    icon: BarChart3,
    title: 'Transparência',
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
    title: 'Responsabilidade',
    paragraphs: [
      'A Montese reconhece que Segurança e Saúde no Trabalho envolve consequências humanas, técnicas, legais e previdenciárias.',
      'Por isso, nossas soluções devem priorizar responsabilidade, rastreabilidade e segurança das informações.',
    ],
  },
];

const PRINCIPIOS_MONTESE = [
  {
    icon: Timer,
    title: 'Preparo antes da urgência',
    description:
      'Assim como uma tropa não vence terreno hostil sem preparo, uma empresa não protege seus trabalhadores apagando incêndio. Antecipamos riscos, treinamentos e prazos antes que virem problema.',
  },
  {
    icon: Users,
    title: 'Ninguém sobe sozinho',
    description:
      'A conquista de Montese não foi feita por um homem só — foi tropa, apoio e comando juntos. Por isso unimos tecnologia, técnicos e rede presencial: a tecnologia nunca substitui quem precisa estar lá fisicamente quando importa.',
  },
  {
    icon: HeartHandshake,
    title: 'Cuidado com quem está na linha de frente',
    description:
      'O trabalhador que sobe no andaime, entra na obra ou opera a máquina é quem mais depende de que os processos estejam certos. Toda decisão de produto parte dessa pessoa, não da planilha.',
  },
  {
    icon: ShieldCheck,
    title: 'Rigor técnico sem burocracia',
    description:
      'Conformidade com eSocial, NRs e auditorias não pode ser um fardo. Automatizamos o que é processo para sobrar tempo ao que exige julgamento humano.',
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
              Somos a Montese SST.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-brand-100">
              Tecnologia para organizar, inteligência para identificar e pessoas para proteger.
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

      {/* MISSÃO E VISÃO */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-10 sm:py-28">
        <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
          <div className="rounded-3xl bg-brand-700 p-8 text-white shadow-xl shadow-brand-900/15 sm:p-10">
            <Target size={28} strokeWidth={1.75} className="text-brand-300" aria-hidden="true" />
            <h2 className="mt-5 text-lg font-semibold text-brand-100">Nossa missão</h2>
            <p className="mt-3 text-balance text-[24px] font-semibold leading-snug sm:text-[28px]">
              Transformar a Segurança e Saúde no Trabalho em uma prática contínua, inteligente e acessível para
              empresas de todos os portes.
            </p>
            <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-brand-100">
              <p>
                A Montese SST existe para ajudar empresas a cuidar das pessoas, cumprir suas responsabilidades e
                antecipar riscos antes que eles se transformem em acidentes, afastamentos, prejuízos ou problemas
                legais.
              </p>
              <p>
                Unimos tecnologia, inteligência artificial, conhecimento técnico e acompanhamento humano para
                organizar documentos, acompanhar prazos e, cada vez mais, identificar riscos e cruzar
                informações para apoiar profissionais de RH, gestores e técnicos de Segurança do Trabalho na
                tomada de decisões.
              </p>
              <p>
                Não queremos que a SST seja lembrada apenas quando um documento vence ou quando uma fiscalização
                acontece.
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
              continuamente o ambiente de trabalho.
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

      {/* HISTÓRIA */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-10 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <h2 className="text-balance text-[30px] font-bold leading-tight text-brand-900 sm:text-[38px]">
            De onde vem o nome Montese
          </h2>
          <div className="max-w-prose space-y-5 text-[16px] leading-relaxed text-ink/85">
            <p>
              O nome Montese vem de um lugar real: uma comuna nos Apeninos, no norte da Itália. Entre 14 e 17 de
              abril de 1945, soldados da Força Expedicionária Brasileira enfrentaram ali um dos combates mais duros
              de toda a campanha da Itália — dezenas de brasileiros morreram, centenas ficaram feridos, na reta
              final da Segunda Guerra Mundial na Europa. Foi uma vitória conquistada num terreno hostil, degrau por
              degrau, até o topo.
            </p>
            <p>
              Escolhemos esse nome como lembrança do que significa preparo e cuidado com quem está na linha de
              frente. Não comparamos o risco de um escritório ou canteiro de obras ao de um campo de batalha — mas
              acreditamos que a mesma ideia vale: quem está exposto ao risco merece ser protegido por gente
              preparada, pronta para agir antes que o pior aconteça.
            </p>
            <p className="text-xs text-muted">Fonte histórica: Batalha de Montese, abril de 1945.</p>
          </div>
        </div>

        {/* Linha do tempo — apenas marcos reais */}
        <ol className="mt-16 grid gap-8 md:grid-cols-4 md:gap-6">
          {MARCOS.map((marco, i) => (
            <li key={marco.titulo} className="relative md:pt-8">
              <span
                className="absolute left-0 top-0 hidden h-3 w-3 rounded-full bg-brand-500 ring-4 ring-brand-100 md:block"
                aria-hidden="true"
              />
              {i < MARCOS.length - 1 && (
                <span className="absolute left-4 top-1.5 hidden h-px w-[calc(100%-0.5rem)] bg-brand-300 md:block" aria-hidden="true" />
              )}
              <p className="text-sm font-semibold text-brand-500">{marco.quando}</p>
              <h3 className="mt-1 text-base font-semibold text-brand-900">{marco.titulo}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink/75">{marco.texto}</p>
            </li>
          ))}
        </ol>

        <h3 className="mt-20 text-xl font-semibold text-brand-900">O que Montese nos ensina</h3>
        <ul className="mt-8 grid gap-x-12 gap-y-10 sm:grid-cols-2">
          {PRINCIPIOS_MONTESE.map((item) => (
            <li key={item.title} className="flex gap-5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-100">
                <item.icon size={24} strokeWidth={1.75} className="text-brand-700" aria-hidden="true" />
              </span>
              <div>
                <h4 className="text-base font-semibold text-brand-900">{item.title}</h4>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink/75">{item.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* EQUIPE */}
      <section className="border-t border-brand-100 bg-brand-50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-10 sm:py-28">
          <h2 className="max-w-2xl text-balance text-[30px] font-bold leading-tight text-brand-900 sm:text-[38px]">
            Nossa equipe
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-ink/80">
            Pessoas que unem conhecimento técnico de Segurança do Trabalho e tecnologia para proteger quem trabalha.
          </p>
          <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {TEAM.map((member) => (
              <li
                key={member.id}
                className="group overflow-hidden rounded-3xl border border-brand-100 bg-white transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-900/10"
              >
                <div className="relative flex h-64 items-center justify-center bg-gradient-to-br from-brand-100 to-brand-50">
                  {member.photo ? (
                    <Image
                      src={member.photo}
                      alt={member.name ? `Foto de ${member.name}` : ''}
                      fill
                      sizes="(min-width: 1024px) 30vw, 100vw"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-brand-500/70">
                      <User size={64} strokeWidth={1.25} aria-hidden="true" />
                      <span className="text-xs font-medium">Foto em breve</span>
                    </div>
                  )}
                </div>
                <div className="flex items-start justify-between gap-3 p-6">
                  <div>
                    <h3 className={`text-lg font-semibold ${member.name ? 'text-brand-900' : 'text-muted'}`}>
                      {member.name ?? 'Nome em breve'}
                    </h3>
                    <p className="mt-1 text-[14px] leading-snug text-ink/75">{member.role}</p>
                  </div>
                  {member.linkedin ? (
                    <a
                      href={member.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`LinkedIn de ${member.name ?? 'membro da equipe'}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-brand-100 text-brand-700 transition-colors hover:bg-brand-700 hover:text-white"
                    >
                      <Linkedin size={16} aria-hidden="true" />
                    </a>
                  ) : (
                    <span
                      role="img"
                      aria-label="LinkedIn (em breve)"
                      title="LinkedIn — em breve"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-brand-100 text-brand-700 opacity-40"
                    >
                      <Linkedin size={16} aria-hidden="true" />
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
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
