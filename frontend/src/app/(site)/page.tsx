import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  Building2,
  Check,
  ClipboardList,
  FolderOpen,
  Gauge,
  History,
  Lock,
  MessageCircle,
  Scale,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { getAllPosts } from '@/lib/noticias';
import { DashboardPreview } from '@/components/DashboardPreview';
import { EcosystemFlow } from '@/components/EcosystemFlow';
import { HomeHeroCTA } from './HomeHeroCTA';
import { FAQAccordion } from '@/components/FAQAccordion';

const WHATSAPP_URL = 'https://wa.me/5548920031245';

const FATOS = [
  {
    icon: ShieldCheck,
    title: 'Fontes oficiais acompanhadas',
    text: 'NRs, eSocial, INSS e Diário Oficial monitorados para manter sua gestão atualizada.',
  },
  {
    icon: Lock,
    title: 'Dados isolados por empresa',
    text: 'Cada empresa enxerga apenas o que é seu, com isolamento aplicado no próprio banco de dados.',
  },
  {
    icon: ClipboardList,
    title: 'Catálogo de EPI da NR-06',
    text: '93 itens do Anexo I, com registro de entrega a cada funcionário.',
  },
  {
    icon: History,
    title: 'Histórico auditável',
    text: 'Quem fez o quê e quando, do jeito que uma auditoria exige.',
  },
];

const DIFERENCIAIS = [
  {
    icon: Users,
    title: 'Rede de técnicos parceiros',
    description: 'Profissionais reais acompanhando sua empresa — não um chatbot genérico no lugar de gente.',
  },
  {
    icon: Scale,
    title: 'Atualizados com a legislação',
    description: 'NRs, eSocial e exigências dos órgãos reguladores acompanhadas e refletidas na plataforma.',
  },
  {
    icon: Gauge,
    title: 'Score de conformidade',
    description: 'Pendências, vencimentos e documentos num único painel, em tempo real.',
  },
  {
    icon: History,
    title: 'Rastreabilidade completa',
    description: 'Histórico de tudo o que acontece na conta, pronto para uma auditoria.',
  },
  {
    icon: FolderOpen,
    title: 'Documentos centralizados',
    description: 'PGR, PCMSO, laudos e fichas de EPI guardados com segurança, sem depender de e-mail ou pasta solta.',
  },
  {
    icon: Building2,
    title: 'Multi-filiais',
    description: 'Empresas com mais de uma unidade acompanham funcionários e conformidade por filial, num só lugar.',
  },
];

const FONTES = ['Ministério do Trabalho e Emprego (MTE)', 'eSocial', 'INSS', 'Diário Oficial da União', 'Normas Regulamentadoras (NRs)'];

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-7 py-4 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700';
const btnOutlineDark =
  'inline-flex items-center justify-center gap-2 rounded-xl border-[1.5px] border-brand-500 px-6 py-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50';

export default function HomePage() {
  const posts = getAllPosts().slice(0, 3);

  return (
    <div>
      {/* HERO */}
      <section className="relative isolate overflow-hidden bg-brand-900">
        <Image
          src="/photos/mountain-hero.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="-z-10 object-cover object-[50%_35%] opacity-90 [filter:saturate(0.7)]"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-brand-900/95 via-brand-900/60 to-brand-700/10" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-brand-900/70 via-transparent to-transparent" />

        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-10 sm:pt-24 lg:min-h-[640px] lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rise">
            <h1 className="max-w-2xl text-balance text-[40px] font-bold leading-[1.1] tracking-tight text-white sm:text-[52px]">
              Segurança que conecta pessoas, processos e resultados.
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-brand-100">
              A plataforma que integra sua empresa, o técnico responsável e a rede de técnicos parceiros em um só
              lugar — com histórico e rastreabilidade de ponta a ponta.
            </p>

            <div className="mt-9">
              <HomeHeroCTA />
            </div>

            <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-3">
              {['Atualizado com as NRs', 'Conformidade com a LGPD', 'Auditoria de ponta a ponta'].map((item) => (
                <li key={item} className="flex items-center gap-2 text-[13.5px] font-medium text-brand-100">
                  <Check size={16} strokeWidth={2.4} className="text-brand-300" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rise [animation-delay:150ms]">
            <DashboardPreview />
            <p className="mt-2 text-center text-[11.5px] text-brand-100/80">Prévia ilustrativa do painel da empresa</p>
          </div>
        </div>
      </section>

      {/* FATOS REAIS */}
      <section className="bg-brand-900 text-white">
        <ul className="mx-auto grid max-w-6xl gap-px bg-white/10 px-0 sm:grid-cols-2 lg:grid-cols-4">
          {FATOS.map((fato) => (
            <li key={fato.title} className="flex gap-4 bg-brand-900 px-6 py-8 sm:px-8">
              <fato.icon size={26} strokeWidth={1.6} className="mt-0.5 shrink-0 text-brand-300" aria-hidden="true" />
              <div>
                <h2 className="text-[15px] font-semibold">{fato.title}</h2>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-brand-100">{fato.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ECOSSISTEMA */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-10 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-[30px] font-bold leading-tight text-brand-900 sm:text-[38px]">
            Um ecossistema completo para a SST da sua empresa
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink/80">
            A plataforma organiza; quem resolve é gente de verdade. Sua empresa conta com um técnico responsável
            remoto e, quando precisa de presença física, com uma rede de técnicos parceiros.
          </p>
        </div>
        <div className="mt-16">
          <EcosystemFlow />
        </div>
      </section>

      {/* DIFERENCIAIS */}
      <section className="bg-brand-50">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-20 sm:px-10 sm:py-28 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="relative overflow-hidden rounded-3xl shadow-xl shadow-brand-900/15">
            <Image
              src="/photos/trabalhador-epi.jpg"
              alt="Trabalhador de capacete em obra, manuseando vergalhões"
              width={1400}
              height={2103}
              sizes="(min-width: 1024px) 40vw, 100vw"
              className="h-[420px] w-full object-cover object-[35%_30%] lg:h-[640px]"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-brand-900/85 to-transparent p-6 pt-20">
              <p className="text-[15px] font-medium leading-snug text-white">
                Por trás de cada score de conformidade, tem gente de verdade usando EPI.
              </p>
            </div>
          </div>

          <div>
            <h2 className="max-w-xl text-balance text-[30px] font-bold leading-tight text-brand-900 sm:text-[38px]">
              Tecnologia não substitui gente. Ela fortalece sua rede.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-ink/80">
              Nosso diferencial não é a tecnologia isolada — é o atendimento humano combinado com técnicos
              parceiros de verdade, apoiados por um sistema que organiza tudo.
            </p>

            <ul className="mt-10 divide-y divide-brand-100 border-y border-brand-100">
              {DIFERENCIAIS.map((item) => (
                <li key={item.title} className="flex gap-5 py-5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm shadow-brand-900/10">
                    <item.icon size={22} strokeWidth={1.75} className="text-brand-500" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-brand-900">{item.title}</h3>
                    <p className="mt-1 text-[14.5px] leading-relaxed text-ink/75">{item.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* HISTÓRIA */}
      <section className="relative overflow-hidden bg-brand-900">
        <svg
          viewBox="0 0 1440 500"
          preserveAspectRatio="xMidYMax slice"
          className="pointer-events-none absolute inset-0 h-full w-full opacity-40"
          aria-hidden="true"
        >
          <polygon points="0,340 140,220 260,300 400,160 540,280 680,190 820,300 960,200 1100,290 1240,210 1380,300 1440,260 1440,500 0,500" fill="var(--color-brand-700)" />
          <polygon points="0,400 180,280 340,370 500,240 660,360 820,260 980,370 1140,270 1300,370 1440,320 1440,500 0,500" fill="var(--color-brand-500)" opacity="0.6" />
        </svg>
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-10 sm:py-28 lg:grid-cols-2">
          <p className="text-[96px] font-bold leading-none tracking-tight text-white/95 sm:text-[152px]" aria-label="1945">
            1945
          </p>
          <div>
            <h2 className="text-balance text-[30px] font-bold leading-tight text-white sm:text-[38px]">
              Inspirados pela coragem. Movidos pela proteção.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-brand-100">
              O nome Montese vem da comuna italiana onde, em abril de 1945, soldados da Força Expedicionária
              Brasileira conquistaram um terreno hostil, degrau por degrau, até o topo. É a nossa lembrança do que
              significa preparo e cuidado com quem está na linha de frente.
            </p>
            <Link
              href="/quem-somos"
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-100"
            >
              Conheça nossa história
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* PARA TÉCNICOS */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-10 sm:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="overflow-hidden rounded-3xl shadow-xl shadow-brand-900/15">
            <Image
              src="/photos/tecnico-campo.jpg"
              alt="Técnica de capacete branco segurando uma planta de obra contra o céu"
              width={1600}
              height={900}
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="h-[320px] w-full object-cover sm:h-[420px]"
            />
          </div>
          <div>
            <h2 className="text-balance text-[30px] font-bold leading-tight text-brand-900 sm:text-[38px]">
              Você é técnico de SST? Sua carteira de empresas, num painel só seu.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-ink/80">
              Técnico responsável ou parceiro, você acompanha empresas vinculadas, documentos, inspeções e
              vencimentos num único lugar — atuação remota ou presencial, sempre com histórico completo.
            </p>
            <ul className="mt-6 flex flex-col gap-3">
              {['Carteira de empresas vinculadas', 'Documentos e conformidade', 'Inspeções e planos de ação', 'Catálogo de EPI e agenda de vencimentos'].map((item) => (
                <li key={item} className="flex items-center gap-3 text-[15px] font-medium text-brand-900">
                  <Check size={18} strokeWidth={2.4} className="shrink-0 text-brand-500" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
            <Link href="/tecnico/cadastro" className={`${btnPrimary} mt-8`}>
              Comece grátis como técnico
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* EM CONSTRUÇÃO (roadmap, rotulado) */}
      <section className="bg-brand-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-10 sm:py-20">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-accent-500/15 px-3 py-1 text-xs font-bold text-accent-700">EM CONSTRUÇÃO</span>
            <p className="text-sm text-muted">O que estamos desenvolvendo — ainda não disponível.</p>
          </div>
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <div className="rounded-3xl border border-brand-100 bg-white p-8">
              <h2 className="text-xl font-semibold leading-snug text-brand-900">
                Agentes especializados em Segurança do Trabalho, disponíveis 24 horas
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink/80">
                Estamos desenvolvendo agentes especializados nas Normas Regulamentadoras para orientar sua empresa
                a qualquer hora. A norma, o artigo e o prazo sempre virão de fonte oficial.
              </p>
            </div>
            <div className="rounded-3xl border border-brand-100 bg-white p-8">
              <h2 className="text-xl font-semibold leading-snug text-brand-900">
                Universidade Montese: capacitação sem sair da plataforma
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink/80">
                Vídeo-aulas, material em PDF e certificado emitido por um técnico especialista, cobrindo as Normas
                Regulamentadoras.
              </p>
              <Link href="/cursos" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:text-brand-500">
                Entrar na lista de espera
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FONTES OFICIAIS */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-10 sm:py-24">
        <div className="max-w-2xl">
          <h2 className="text-balance text-[28px] font-bold leading-tight text-brand-900 sm:text-[34px]">
            Acompanhamos as fontes oficiais para sua empresa nunca ser pega de surpresa.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-ink/80">
            Monitoramos publicações de Normas Regulamentadoras, eSocial e legislação trabalhista — sem depender de
            você acompanhar o Diário Oficial.
          </p>
        </div>
        <ul className="mt-8 flex flex-wrap gap-3">
          {FONTES.map((fonte) => (
            <li key={fonte} className="rounded-full border border-brand-100 bg-brand-50 px-4 py-2 text-[13.5px] font-semibold text-brand-700">
              {fonte}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">Fontes oficiais que monitoramos — não somos vinculados a nenhum desses órgãos.</p>
      </section>

      {/* PLANOS */}
      <section className="border-t border-brand-100 bg-brand-50 py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-10">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-[30px] font-bold leading-tight text-brand-900 sm:text-[36px]">
              Planos que se adaptam à sua empresa
            </h2>
            <p className="mt-3 text-base leading-relaxed text-ink/80">
              Todo plano começa com um período de teste gratuito. Sem taxa de adesão.
            </p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { name: 'Start', price: 397, limit: 'Até 10 funcionários' },
              { name: 'Premium', price: 797, limit: 'Até 50 funcionários', recommended: true },
              { name: 'Super Premium', price: 1297, limit: 'Até 200 funcionários' },
              { name: 'Enterprise', price: null, limit: 'Redes e multi-filiais' },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`relative flex flex-col rounded-2xl bg-white p-6 ${
                  plan.recommended ? 'border-2 border-brand-500 shadow-xl shadow-brand-500/15' : 'border border-brand-100'
                }`}
              >
                {plan.recommended && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand-500 px-3 py-1 text-[10.5px] font-bold tracking-wide text-white">
                    RECOMENDADO
                  </span>
                )}
                <h3 className="text-base font-semibold text-brand-900">{plan.name}</h3>
                <p className="mt-1 text-[13px] text-muted">{plan.limit}</p>
                <div className="mt-5">
                  {plan.price ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm font-semibold text-brand-700">R$</span>
                      <span className="text-[32px] font-bold text-brand-900">{plan.price}</span>
                      <span className="text-[13px] text-muted">/mês</span>
                    </div>
                  ) : (
                    <span className="text-lg font-bold text-brand-900">Sob consulta</span>
                  )}
                </div>
                <div className="flex-1" />
                <Link
                  href={plan.price ? '/cadastro' : '/contato'}
                  className={`mt-6 rounded-xl px-4 py-3 text-center text-sm font-semibold transition-colors ${
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

          <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] leading-relaxed text-ink/75">
            Incluído em todos os planos: dashboard de conformidade, documentos centralizados, catálogo de EPI e
            rede de técnicos parceiros.
          </p>
          <div className="mt-6 text-center">
            <Link href="/planos" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:text-brand-500">
              Ver todos os detalhes dos planos
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* NOTÍCIAS */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-10 sm:py-24">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[30px] font-bold leading-tight text-brand-900 sm:text-[36px]">
              Direto do mundo da Segurança do Trabalho
            </h2>
            <p className="mt-3 max-w-[560px] text-base leading-relaxed text-ink/80">
              Atualizado com base em fontes oficiais — leis novas, prazos e mudanças que afetam sua empresa.
            </p>
          </div>
          <Link href="/noticias" className={btnOutlineDark}>
            Ver todas as notícias
            <ArrowRight size={15} aria-hidden="true" />
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
                  <ClipboardList size={36} strokeWidth={1.6} className="text-brand-700" aria-hidden="true" />
                </div>
                <div className="p-5">
                  <h3 className="text-[15.5px] font-semibold leading-snug text-brand-900">{post.title}</h3>
                  <p className="mt-2.5 text-xs text-muted">{post.date}</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-ink/75">{post.excerpt}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-10 text-ink/75">Novas notícias em breve.</p>
        )}
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-10 sm:pb-24">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-[30px] font-bold text-brand-900 sm:text-[36px]">Perguntas frequentes sobre SST</h2>
        </div>
        <FAQAccordion />
      </section>

      {/* CTA FINAL */}
      <section className="relative overflow-hidden bg-brand-700">
        <Image
          src="/brand/logo-icon-mark.png"
          alt=""
          width={320}
          height={153}
          className="pointer-events-none absolute -right-10 -top-6 w-[420px] opacity-[0.07] brightness-0 invert"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-20 text-center sm:px-10 sm:py-24">
          <h2 className="mx-auto max-w-2xl text-balance text-[30px] font-bold leading-tight text-white sm:text-[38px]">
            Vamos construir um ambiente de trabalho mais seguro?
          </h2>
          <p className="mt-4 text-base text-brand-100">Comece grátis. Sem cartão de crédito, sem compromisso.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3.5">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-7 py-4 text-[15px] font-semibold text-brand-700 transition-colors hover:bg-brand-100"
            >
              <MessageCircle size={18} aria-hidden="true" />
              Falar no WhatsApp
            </a>
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
