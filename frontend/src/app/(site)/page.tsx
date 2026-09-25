import Link from 'next/link';
import Image from 'next/image';
import { getAllPosts } from '@/lib/noticias';
import { DashboardPreview } from '@/components/DashboardPreview';
import { MountainDivider } from '@/components/MountainDivider';
import { HomeHeroCTA } from './HomeHeroCTA';
import { FAQAccordion } from '@/components/FAQAccordion';

const DIFERENCIAIS = [
  {
    title: 'Rede de técnicos parceiros',
    description: 'Profissionais reais acompanhando sua empresa — não um chatbot genérico no lugar de gente.',
    icon: (
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    ),
  },
  {
    title: 'Atualizados com a legislação',
    description: 'NRs, eSocial e exigências dos órgãos reguladores acompanhadas e refletidas na plataforma.',
    icon: <path d="M12 3v18M5 8l-3 5a5 5 0 0 0 10 0zM19 8l-3 5a5 5 0 0 0 10 0zM5 8h14M3 21h18" />,
  },
  {
    title: 'Score de conformidade',
    description: 'Pendências, vencimentos e documentos num único painel, em tempo real.',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.2 2" />
      </>
    ),
  },
  {
    title: 'Rastreabilidade completa',
    description: 'Histórico auditável de tudo — quem fez o quê, e quando, do jeito que uma auditoria exige.',
    icon: (
      <>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </>
    ),
  },
  {
    title: 'Documentos centralizados',
    description: 'PGR, PCMSO, laudos e fichas de EPI guardados com segurança, sem depender de e-mail ou pasta solta.',
    icon: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M9 13h6M9 17h6" />
      </>
    ),
  },
  {
    title: 'Multi-filiais',
    description: 'Empresas com mais de uma unidade acompanham funcionários e conformidade por filial, num só lugar.',
    icon: (
      <>
        <path d="M3 21h18M6 21V8l6-4 6 4v13M10 21v-6h4v6" />
      </>
    ),
  },
];

const FONTES = ['Ministério do Trabalho e Emprego (MTE)', 'eSocial', 'INSS', 'Diário Oficial da União', 'Normas Regulamentadoras (NRs)'];

export default function HomePage() {
  const posts = getAllPosts().slice(0, 3);

  return (
    <div>
      {/* HERO */}
      <section className="relative overflow-hidden bg-brand-900">
        <Image
          src="/photos/mountain-hero.jpg"
          alt=""
          fill
          priority
          className="object-cover object-bottom [filter:grayscale(0.4)_brightness(0.95)]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-brand-900/60 via-brand-900/35 to-brand-900/85" />
        <div className="absolute inset-0 bg-gradient-to-r from-brand-900/70 via-brand-900/15 to-transparent" />

        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-14 px-4 pb-16 pt-16 sm:px-10 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[13px] font-semibold text-brand-100 backdrop-blur">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Plataforma de gestão de SST
            </div>

            <h1 className="text-[40px] font-extrabold leading-[1.12] tracking-tight text-white sm:text-5xl">
              Chegue no topo
              <br />
              com <span className="text-brand-300">segurança</span>.
            </h1>

            <p className="mt-5 max-w-[480px] text-lg leading-relaxed text-brand-100">
              A plataforma que conecta sua empresa, o técnico responsável e a rede de técnicos parceiros num só
              lugar — com histórico e rastreabilidade completos, sempre alinhados com a legislação de Segurança e
              Saúde do Trabalho.
            </p>

            <div className="mt-8">
              <HomeHeroCTA />
            </div>

            <div className="mt-9 flex flex-wrap gap-4.5 gap-y-3">
              {['Atualizado com as NRs', 'Conformidade com a LGPD', 'Auditoria de ponta a ponta'].map((item) => (
                <div key={item} className="flex items-center gap-2 text-[13.5px] font-medium text-brand-100">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-300)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {item}
                </div>
              ))}
            </div>
          </div>

          <DashboardPreview />
        </div>
      </section>

      {/* DIFERENCIAL */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-10 sm:py-20">
        <div className="mx-auto max-w-xl text-center">
          <div className="text-[13px] font-bold uppercase tracking-wider text-brand-500">Nosso diferencial</div>
          <h2 className="mt-2.5 text-[28px] font-extrabold leading-tight text-brand-900 sm:text-[32px]">
            Tecnologia não substitui gente. Ela fortalece sua rede.
          </h2>
          <p className="mt-3.5 text-base leading-relaxed text-brand-700">
            Nosso diferencial não é a tecnologia isolada — é o atendimento humano combinado com uma rede de
            técnicos parceiros de verdade, apoiada por um sistema que organiza tudo.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {DIFERENCIAIS.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-brand-100 bg-white p-7 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-900/10"
            >
              <div className="flex h-[46px] w-[46px] items-center justify-center rounded-xl bg-brand-50">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-700)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {item.icon}
                </svg>
              </div>
              <h3 className="mt-4.5 text-base font-bold text-brand-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-brand-700">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* SEGURANÇA DE VERDADE (foto) */}
      <section className="relative bg-brand-50">
        <MountainDivider className="rotate-180" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-10 lg:grid-cols-[1fr_1.1fr]">
          <div className="overflow-hidden rounded-3xl shadow-xl shadow-brand-900/15">
            <Image
              src="/photos/trabalhador-epi.jpg"
              alt="Trabalhador de EPI em obra"
              width={1400}
              height={2103}
              className="h-[380px] w-full object-cover sm:h-[460px]"
            />
          </div>
          <div>
            <div className="text-[13px] font-bold uppercase tracking-wider text-brand-500">Segurança de verdade</div>
            <h2 className="mt-2.5 text-[28px] font-extrabold leading-tight text-brand-900 sm:text-[32px]">
              Por trás de cada score de conformidade, tem gente de verdade usando EPI.
            </h2>
            <p className="mt-3.5 max-w-md text-[15.5px] leading-relaxed text-brand-700">
              A Montese existe pra apoiar quem protege quem trabalha — do escritório ao canteiro de obras. Tecnologia
              organiza; quem chega no topo com segurança são as pessoas.
            </p>
          </div>
        </div>
        <MountainDivider />
      </section>

      {/* AGENTES ESPECIALIZADOS (roadmap) */}
      <section className="relative overflow-hidden bg-[#06131b] py-16 sm:py-20">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]">
          <svg viewBox="0 0 400 400" className="h-full w-full">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M40 0H0V40" fill="none" stroke="white" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="400" height="400" fill="url(#grid)" />
          </svg>
        </div>

        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-10 lg:grid-cols-[1fr_1fr]">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-500/15 px-3 py-1 text-xs font-bold text-accent-400">
              EM CONSTRUÇÃO
            </div>
            <h2 className="mt-4 text-[26px] font-extrabold leading-tight text-white sm:text-[30px]">
              Agentes especializados em Segurança do Trabalho, disponíveis 24 horas
            </h2>
            <p className="mt-3.5 text-[15px] leading-relaxed text-brand-100">
              Estamos desenvolvendo agentes especializados nas Normas Regulamentadoras para orientar sua empresa a
              qualquer hora. No eSocial, vão ajudar o RH a cumprir prazos — gerando questionários, documentação,
              integração com serviços públicos, certificado digital e XML dentro das normas.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-brand-300">
              Prévia ilustrativa — funcionalidade em desenvolvimento
            </p>
            <div className="flex flex-col gap-2.5">
              <div className="ml-auto max-w-[85%] rounded-xl rounded-tr-sm bg-brand-500 px-4 py-2.5 text-[13.5px] text-white">
                Tive um acidente de trabalho. O que devo fazer?
              </div>
              <div className="max-w-[85%] rounded-xl rounded-tl-sm bg-white/10 px-4 py-2.5 text-[13.5px] text-brand-50">
                <p className="font-semibold text-white">Agente Montese</p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                  <li>Emitir CAT</li>
                  <li>Registrar ocorrência</li>
                  <li>Enviar S-2210 dentro do prazo</li>
                  <li>Iniciar investigação</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TECNOLOGIA + PESSOAS (fluxo real) */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-10 sm:py-20">
        <div className="max-w-xl">
          <h2 className="text-[26px] font-extrabold leading-tight text-brand-900 sm:text-[30px]">
            Tecnologia + Pessoas
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-brand-700">
            A plataforma organiza; quem resolve é gente de verdade. Sua empresa tem um técnico
            responsável remoto e, quando precisa de presença física, uma rede de técnicos parceiros.
          </p>
        </div>

        <div className="mt-12 flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-5">
          {[
            {
              label: 'Empresa',
              icon: <path d="M3 21h18M6 21V9l6-5 6 5v12M10 21v-6h4v6" />,
            },
            {
              label: 'IA SST',
              soon: true,
              icon: (
                <>
                  <path d="M12 3l1.8 4.9L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.1L12 3z" />
                  <path d="M19 15l.8 2.2 2.2.8-2.2.9-.8 2.1-.8-2.1-2.2-.9 2.2-.8z" />
                </>
              ),
            },
            {
              label: 'Técnico responsável',
              icon: (
                <>
                  <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
                  <circle cx="10" cy="7" r="4" />
                  <path d="M21 8l-2 2-1-1" />
                </>
              ),
            },
            {
              label: 'Rede de técnicos parceiros',
              icon: (
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              ),
            },
          ].map((step, index, arr) => (
            <div key={step.label} className="flex flex-col items-center gap-3 sm:flex-row sm:gap-5">
              <div className="flex flex-col items-center gap-2.5 text-center">
                <div
                  className={`relative flex h-16 w-16 items-center justify-center rounded-2xl ${
                    step.soon ? 'border-2 border-dashed border-brand-200 bg-white' : 'bg-brand-50'
                  }`}
                >
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={step.soon ? 'var(--color-brand-300)' : 'var(--color-brand-500)'}
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {step.icon}
                  </svg>
                  {step.soon && (
                    <span className="absolute -bottom-2 rounded-full bg-accent-500 px-1.5 py-0.5 text-[8.5px] font-bold text-white">
                      EM BREVE
                    </span>
                  )}
                </div>
                <p className={`max-w-[110px] text-[13px] font-semibold ${step.soon ? 'text-brand-300' : 'text-brand-900'}`}>
                  {step.label}
                </p>
              </div>
              {index < arr.length - 1 && (
                <svg width="28" height="16" viewBox="0 0 28 16" fill="none" className="shrink-0 rotate-90 text-brand-300 sm:rotate-0">
                  <path d="M1 8h24M20 2l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* TRUST / GOVERNMENT BAND */}
      <section className="relative overflow-hidden bg-brand-900">
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none" className="absolute inset-0 h-full w-full opacity-50">
          <polygon
            points="0,320 100,200 220,270 340,160 480,240 620,180 760,260 900,190 1040,250 1180,200 1320,255 1440,220 1440,320"
            fill="var(--color-brand-700)"
          />
        </svg>
        <div className="relative z-10 mx-auto max-w-6xl px-4 py-16 sm:px-10 sm:py-20">
          <div className="max-w-2xl">
            <div className="text-[13px] font-bold uppercase tracking-wider text-brand-300">
              Sempre em dia com quem regula a segurança do trabalho
            </div>
            <h2 className="mt-3 text-[26px] font-extrabold leading-tight text-white sm:text-[30px]">
              Acompanhamos as fontes oficiais para sua empresa nunca ser pega de surpresa.
            </h2>
            <p className="mt-3.5 text-[15.5px] leading-relaxed text-brand-100">
              Monitoramos publicações de Normas Regulamentadoras, eSocial e legislação trabalhista para manter sua
              gestão de SST sempre atualizada — sem depender de você acompanhar o Diário Oficial.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {FONTES.map((fonte) => (
              <span
                key={fonte}
                className="rounded-full border border-white/20 bg-white/10 px-4.5 py-2 text-[13.5px] font-semibold text-white"
              >
                {fonte}
              </span>
            ))}
          </div>
          <p className="mt-4 text-xs text-brand-300">
            Fontes oficiais que monitoramos — não somos vinculados a nenhum desses órgãos.
          </p>
        </div>
      </section>

      {/* UNIVERSIDADE MONTESE (roadmap) */}
      <section className="bg-brand-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-10">
          <div className="grid items-end gap-10 lg:grid-cols-[1fr_auto]">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-500/15 px-3 py-1 text-xs font-bold text-accent-700">
                EM CONSTRUÇÃO
              </div>
              <h2 className="mt-4 text-[26px] font-extrabold leading-tight text-brand-900 sm:text-[32px]">
                Universidade Montese: capacitação sem sair da plataforma
              </h2>
              <p className="mt-3.5 max-w-xl text-[15px] leading-relaxed text-brand-700">
                Vídeo-aulas, material em PDF e certificado emitido por um técnico especialista, cobrindo as Normas
                Regulamentadoras — pra capacitar seu time sem depender de treinamento presencial avulso.
              </p>
            </div>
            <Link
              href="/cursos"
              className="whitespace-nowrap rounded-[9px] bg-brand-500 px-6 py-3.5 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Entrar na lista de espera →
            </Link>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {[
              {
                title: 'Vídeo-aulas',
                description: 'Conteúdo gravado com nossa equipe técnica, direto ao ponto, no ritmo da sua empresa.',
                icon: <path d="M23 7l-7 5 7 5V7zM14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" />,
              },
              {
                title: 'Material em PDF',
                description: 'Apostilas e resumos por Norma Regulamentadora, pra consultar sempre que precisar.',
                icon: (
                  <>
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </>
                ),
              },
              {
                title: 'Certificado por técnico especialista',
                description: 'Emitido por um profissional habilitado, dentro das normas — não um certificado automático.',
                icon: (
                  <>
                    <circle cx="12" cy="8" r="6" />
                    <path d="M15.5 13.5L17 22l-5-3-5 3 1.5-8.5" />
                  </>
                ),
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-brand-100 bg-white p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-700)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {item.icon}
                  </svg>
                </div>
                <h3 className="mt-4 text-[15px] font-bold text-brand-900">{item.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-brand-700">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* QUEM SOMOS — a história do nome */}
      <section className="relative overflow-hidden bg-brand-900 py-16 sm:py-20">
        <svg viewBox="0 0 1440 500" preserveAspectRatio="xMidYMax slice" className="pointer-events-none absolute inset-0 h-full w-full opacity-40">
          <polygon points="0,340 140,220 260,300 400,160 540,280 680,190 820,300 960,200 1100,290 1240,210 1380,300 1440,260 1440,500 0,500" fill="var(--color-brand-700)" />
          <polygon points="0,400 180,280 340,370 500,240 660,360 820,260 980,370 1140,270 1300,370 1440,320 1440,500 0,500" fill="var(--color-brand-500)" opacity="0.6" />
        </svg>

        <div className="relative z-10 mx-auto max-w-3xl px-4 text-center sm:px-10">
          <div className="text-[13px] font-bold uppercase tracking-wider text-brand-300">Nossa história</div>
          <h2 className="mt-2.5 text-[28px] font-extrabold leading-tight text-white sm:text-[32px]">
            De onde vem o nome Montese
          </h2>
          <div className="mx-auto mt-6 max-w-2xl text-left text-[15.5px] leading-relaxed text-brand-100">
            <p>
              O nome Montese vem de um lugar real: uma comuna nos Apeninos, no norte da Itália. Entre 14 e 17 de
              abril de 1945, soldados da Força Expedicionária Brasileira enfrentaram ali um dos combates mais duros
              de toda a campanha da Itália — dezenas de brasileiros morreram, centenas ficaram feridos, na reta
              final da Segunda Guerra Mundial na Europa. Foi uma vitória conquistada num terreno hostil, degrau por
              degrau, até o topo.
            </p>
            <p className="mt-4">
              Escolhemos esse nome como lembrança do que significa preparo e cuidado com quem está na linha de
              frente. Não comparamos o risco de um escritório ou canteiro de obras ao de um campo de batalha — mas
              acreditamos que a mesma ideia vale: quem está exposto ao risco merece ser protegido por gente
              preparada, pronta pra agir antes que o pior aconteça.
            </p>
          </div>
          <p className="mt-6 text-xs text-brand-300">Fonte histórica: Batalha de Montese, abril de 1945.</p>

          <div className="mx-auto mt-14 max-w-2xl border-t border-white/10 pt-14">
            <div className="text-[13px] font-bold uppercase tracking-wider text-brand-300">Missão</div>
            <p className="mt-3 text-[19px] font-semibold leading-snug text-white sm:text-[21px]">
              Tornar a segurança do trabalho simples, acessível e presente em cada empresa brasileira — unindo
              tecnologia, gente e conhecimento técnico para que nenhum trabalhador fique desprotegido por falta de
              estrutura, processo ou informação.
            </p>
          </div>
        </div>

        <div className="relative z-10 mx-auto mt-14 max-w-5xl border-t border-white/10 px-4 pt-14 sm:px-10">
          <div className="text-center text-[13px] font-bold uppercase tracking-wider text-brand-300">
            Nossos valores
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {[
              {
                title: 'Preparo antes da urgência',
                description:
                  'Assim como uma tropa não vence terreno hostil sem preparo, uma empresa não protege seus trabalhadores apagando incêndio. Antecipamos riscos, treinamentos e prazos antes que virem problema.',
                icon: (
                  <>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3.2 2" />
                  </>
                ),
              },
              {
                title: 'Ninguém sobe sozinho',
                description:
                  'A conquista de Montese não foi feita por um homem só — foi tropa, apoio e comando juntos. Por isso unimos tecnologia, técnicos e rede presencial: a tecnologia nunca substitui quem precisa estar lá fisicamente quando importa.',
                icon: (
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                ),
              },
              {
                title: 'Cuidado com quem está na linha de frente',
                description:
                  'O trabalhador que sobe no andaime, entra na obra ou opera a máquina é quem mais depende de que os processos estejam certos. Toda decisão de produto parte dessa pessoa, não da planilha.',
                icon: (
                  <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z" />
                ),
              },
              {
                title: 'Rigor técnico sem burocracia',
                description:
                  'Conformidade com eSocial, NRs e auditorias não pode ser um fardo. Automatizamos o que é processo pra sobrar tempo pro que exige julgamento humano.',
                icon: (
                  <>
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </>
                ),
              },
            ].map((value) => (
              <div key={value.title} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-300)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    {value.icon}
                  </svg>
                </div>
                <h3 className="mt-4 text-[15px] font-bold text-white">{value.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-brand-100">{value.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PARA TÉCNICOS */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-10 lg:grid-cols-[0.8fr_1fr_1fr]">
          <div className="hidden overflow-hidden rounded-3xl shadow-xl shadow-brand-900/15 lg:block">
            <Image
              src="/photos/tecnico-campo.jpg"
              alt="Técnica de segurança revisando documentação em campo"
              width={1600}
              height={900}
              className="h-[380px] w-full object-cover"
            />
          </div>

          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">
              PARA TÉCNICOS
            </div>
            <h2 className="mt-4 text-[26px] font-extrabold leading-tight text-brand-900 sm:text-[30px]">
              Sua carteira de empresas, num painel só seu
            </h2>
            <p className="mt-3.5 text-[15px] leading-relaxed text-brand-700">
              Técnico responsável ou parceiro, você acompanha as empresas vinculadas, documentos, inspeções e
              vencimentos num único painel — atuação remota ou presencial, sempre com histórico completo.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              {['Carteira de empresas vinculadas', 'Documentos e conformidade', 'Inspeções e planos de ação', 'Catálogo de EPI e agenda de vencimentos'].map((item) => (
                <div key={item} className="flex items-center gap-2.5 text-[13.5px] font-medium text-brand-700">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-500)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  {item}
                </div>
              ))}
            </div>
            <Link
              href="/tecnico/cadastro"
              className="mt-7 inline-block rounded-[9px] bg-brand-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
            >
              Você é técnico? Comece grátis →
            </Link>
          </div>

          <div className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
            <p className="mb-3.5 text-[11px] font-semibold uppercase tracking-wide text-brand-300">
              Prévia ilustrativa do painel do técnico
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: 'Empresas vinculadas', value: '12' },
                { label: 'Documentos pendentes', value: '3' },
                { label: 'Inspeções no mês', value: '5' },
                { label: 'Vencimentos em 30 dias', value: '4' },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-3">
                  <p className="text-[20px] font-extrabold leading-none text-brand-900">{stat.value}</p>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-brand-700">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PLANOS */}
      <section className="border-t border-brand-100 bg-brand-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-10">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-[28px] font-extrabold leading-tight text-brand-900 sm:text-[32px]">
              Planos que se adaptam à sua empresa
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-brand-700">
              Todo plano começa com um período de teste gratuito. Sem taxa de adesão.
            </p>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { name: 'Start', price: 397, limit: 'Até 10 funcionários' },
              { name: 'Premium', price: 797, limit: 'Até 50 funcionários', recommended: true },
              { name: 'Super Premium', price: 1297, limit: 'Até 200 funcionários' },
              { name: 'Enterprise', price: null, limit: 'Redes e multi-filiais' },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`relative flex flex-col rounded-2xl p-6 ${
                  plan.recommended
                    ? 'border-2 border-brand-500 bg-white shadow-xl shadow-brand-500/15'
                    : 'border border-brand-100 bg-white'
                }`}
              >
                {plan.recommended && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand-500 px-3 py-1 text-[10.5px] font-bold tracking-wide text-white">
                    RECOMENDADO
                  </span>
                )}
                <h3 className="text-[16px] font-bold text-brand-900">{plan.name}</h3>
                <p className="mt-1 text-[12.5px] text-brand-700">{plan.limit}</p>
                <div className="mt-5">
                  {plan.price ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm font-semibold text-brand-700">R$</span>
                      <span className="text-[32px] font-extrabold text-brand-900">{plan.price}</span>
                      <span className="text-[12.5px] text-brand-700">/mês</span>
                    </div>
                  ) : (
                    <span className="text-[18px] font-extrabold text-brand-900">Sob consulta</span>
                  )}
                </div>
                <div className="flex-1" />
                <Link
                  href={plan.price ? '/cadastro' : '/contato'}
                  className={`mt-6 rounded-[9px] px-4 py-3 text-center text-sm font-semibold transition-colors ${
                    plan.recommended
                      ? 'bg-brand-500 text-white hover:bg-brand-700'
                      : 'border-[1.5px] border-brand-500 text-brand-700 hover:bg-brand-50'
                  }`}
                >
                  {plan.price ? 'Comece grátis' : 'Fale com vendas'}
                </Link>
              </div>
            ))}
          </div>

          <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] leading-relaxed text-brand-700">
            Incluído em todos os planos: dashboard de conformidade, documentos centralizados, catálogo de EPI e
            rede de técnicos parceiros.
          </p>
          <div className="mt-6 text-center">
            <Link href="/planos" className="text-sm font-semibold text-brand-700 hover:text-brand-500">
              Ver todos os detalhes dos planos →
            </Link>
          </div>
        </div>
      </section>

      {/* NEWS TEASER */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-10 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[13px] font-bold uppercase tracking-wider text-brand-500">Notícias</div>
            <h2 className="mt-2.5 text-[28px] font-extrabold text-brand-900 sm:text-[32px]">
              Direto do mundo da Segurança do Trabalho
            </h2>
            <p className="mt-2.5 max-w-[560px] text-[15.5px] leading-relaxed text-brand-700">
              Atualizado com base em fontes oficiais — leis novas, prazos e mudanças que afetam sua empresa.
            </p>
          </div>
          <Link
            href="/noticias"
            className="whitespace-nowrap rounded-[9px] border-[1.5px] border-brand-500 px-5.5 py-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
          >
            Ver todas as notícias →
          </Link>
        </div>

        {posts.length > 0 ? (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/noticias/${post.slug}`}
                className="overflow-hidden rounded-2xl border border-brand-100 bg-white transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-brand-900/10"
              >
                <div className="flex h-[130px] items-center justify-center bg-gradient-to-br from-brand-100 to-brand-300">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-700)" strokeWidth="1.8">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                </div>
                <div className="p-5">
                  <h3 className="text-[15.5px] font-bold leading-snug text-brand-900">{post.title}</h3>
                  <p className="mt-2.5 text-xs text-slate-500">{post.date}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-brand-700">{post.excerpt}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-10 text-brand-700">Novas notícias em breve.</p>
        )}
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-10 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-[13px] font-bold uppercase tracking-wider text-brand-500">Dúvidas frequentes</div>
          <h2 className="mt-2.5 text-[28px] font-extrabold text-brand-900 sm:text-[32px]">
            Perguntas frequentes sobre SST
          </h2>
        </div>
        <FAQAccordion />
      </section>

      {/* FINAL CTA */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-700 to-brand-500">
        <Image
          src="/brand/logo-icon.jpg"
          alt=""
          width={340}
          height={340}
          className="pointer-events-none absolute -right-16 -top-16 opacity-[0.08] mix-blend-luminosity"
        />
        <div className="relative z-10 mx-auto max-w-6xl px-4 py-20 text-center sm:px-10">
          <h2 className="text-[28px] font-extrabold text-white sm:text-[32px]">
            Pronto para organizar a SST da sua empresa?
          </h2>
          <p className="mt-3 text-base text-brand-100">Comece grátis. Sem cartão de crédito, sem compromisso.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3.5">
            <Link href="/cadastro" className="rounded-[9px] bg-white px-7 py-4 text-[15px] font-bold text-brand-700 hover:bg-brand-50">
              Comece grátis
            </Link>
            <Link
              href="/contato"
              className="rounded-[9px] border-[1.5px] border-white/65 px-7 py-4 text-[15px] font-semibold text-white hover:bg-white/10"
            >
              Fale com a gente
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
