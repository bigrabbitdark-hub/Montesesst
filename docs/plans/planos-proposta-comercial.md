# Planos — proposta comercial e reescrita da página /planos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescrever a página `/planos` (empresa) pra vender nível de acompanhamento humano em vez de quantidade de funcionários — cada plano ganha posicionamento, subtítulo e lista de entrega próprios, mais um bloco comum do Assistente e uma tabela comparativa completa.

**Architecture:** Conteúdo textual por plano (chave = `slug` real de `plans`) vira um módulo de dados novo (`plan-content.ts`), consumido pelo componente de página existente (`page.tsx`) — que mantém toda a lógica já existente (fetch de `plans`, `handleSubscribe`, roteamento por `isEnterprise`/`loggedIn`) intocada, só troca o que é renderizado.

**Tech Stack:** Next.js/React (client component já existente, sem mudança de stack), Tailwind (classes já usadas no arquivo).

**Spec:** `docs/specs/planos-proposta-comercial.md`

## Global Constraints

- Nenhuma mudança de preço, `employee_limit`, migration, ou schema de `plans` — só apresentação.
- Nenhuma mudança no fluxo de assinatura (`handleSubscribe`/`POST /subscriptions`) nem em `/tecnico/planos`.
- Sem menção a "laudos" em nenhum lugar da página.
- Sem menção a limite de uso de IA/documentos por plano (não existe).
- "Monitoramento inteligente"/alertas aparece na tabela comparativa como incluído em TODOS os planos — o que diferencia Super Premium/Enterprise é o técnico acompanhando ativamente, não o alerta em si.
- Preço do Enterprise continua "Valores a combinar" — nenhum valor fixo.
- Frontend sem suíte de teste automatizada — verificação é sempre Playwright real contra o bundle implantado em produção, deploy confirmado via grep no bundle ANTES do teste.

---

### Task 1 (única): Conteúdo por plano + reescrita da página

**Files:**
- Create: `frontend/src/app/(site)/planos/plan-content.ts`
- Modify: `frontend/src/app/(site)/planos/page.tsx` (reescrita quase completa, mantendo toda a lógica de fetch/estado/`handleSubscribe`/roteamento por CTA já existente)

**Interfaces:**
- Produces: `PlanContent { positioning: string; subtitle: string; bullets: string[]; ctaLabel: string }`, `PLAN_CONTENT: Record<string, PlanContent>` (chaveado pelos 4 slugs reais: `empresa-start`, `empresa-premium`, `empresa-super-premium`, `empresa-enterprise`); `ComparisonRow { feature: string; start: string | boolean; premium: string | boolean; superPremium: string | boolean; enterprise: string | boolean }`, `COMPARISON_TABLE: ComparisonRow[]`; `AssistantStep { title: string; description: string }`, `ASSISTANT_STEPS: AssistantStep[]`, `ASSISTANT_TECHNICIAN_STEP: AssistantStep`.

- [ ] **Step 1: Criar o módulo de conteúdo**

Cria `frontend/src/app/(site)/planos/plan-content.ts`:

```typescript
export interface PlanContent {
  positioning: string;
  subtitle: string;
  bullets: string[];
  ctaLabel: string;
}

export const PLAN_CONTENT: Record<string, PlanContent> = {
  'empresa-start': {
    positioning: 'A base inteligente para organizar sua SST.',
    subtitle:
      'Para pequenas empresas que querem estruturar a rotina de Segurança do Trabalho sem manter um técnico dedicado internamente.',
    bullets: [
      'Assistente Montese SST (dúvidas, análise de documentos, localização de pendências, acompanhamento de prazos)',
      'Central de documentos (upload, organização, histórico)',
      'Cadastro de funcionários, cargos e filiais',
      'Gestão de EPIs (registro e entrega)',
      'Inspeções com checklist e plano de ação',
      'Calendário SST e central de pendências',
      'Atendimento técnico avulso sob consulta (online ou presencial, conforme disponibilidade e região)',
    ],
    ctaLabel: 'Começar gratuitamente',
  },
  'empresa-premium': {
    positioning: 'Plataforma + técnico SST online.',
    subtitle:
      'Para empresas que precisam de acompanhamento profissional sem manter um técnico de segurança contratado em tempo integral.',
    bullets: [
      'Tudo do Start, mais:',
      'Técnico responsável acompanhando sua empresa, atendimento remoto',
      'A inteligência organiza. O técnico avalia. A empresa decide.',
      'Atendimento online (videochamada, histórico de solicitações)',
      'Técnico com visão completa de pendências, inspeções, documentos, EPIs e treinamentos',
    ],
    ctaLabel: 'Quero SST + técnico',
  },
  'empresa-super-premium': {
    positioning: 'Acompanhamento contínuo de SST.',
    subtitle: 'Para empresas que precisam de uma atuação mais próxima e estruturada de Segurança do Trabalho.',
    bullets: [
      'Tudo do Premium, mais:',
      'O técnico acompanha ativamente os alertas e pendências da plataforma — não só responde quando chamado',
      'Gestão ativa: revisão de ações, acompanhamento de inspeções e treinamentos, reuniões periódicas',
      'Visitas presenciais incluídas conforme modalidade contratada e região',
    ],
    ctaLabel: 'Quero acompanhamento completo',
  },
  'empresa-enterprise': {
    positioning: 'SST estruturada para operações maiores e redes de empresas.',
    subtitle:
      'Para empresas com múltiplas unidades, operações complexas ou necessidade de estrutura personalizada de SST.',
    bullets: [
      'Tudo do Super Premium, mais:',
      'Gestão multiunidade (matriz, filiais, obras)',
      'Acesso à rede de técnicos parceiros da Montese (visitas presenciais em múltiplas unidades/regiões)',
      'Atendimento e relatórios personalizados conforme contrato',
    ],
    ctaLabel: 'Falar com especialista',
  },
};

export interface ComparisonRow {
  feature: string;
  start: string | boolean;
  premium: string | boolean;
  superPremium: string | boolean;
  enterprise: string | boolean;
}

export const COMPARISON_TABLE: ComparisonRow[] = [
  {
    feature: 'Plataforma + Assistente Montese SST + base normativa',
    start: true,
    premium: true,
    superPremium: true,
    enterprise: true,
  },
  {
    feature: 'Documentos, funcionários, EPIs, inspeções',
    start: true,
    premium: true,
    superPremium: true,
    enterprise: true,
  },
  {
    feature: 'Calendário SST e alertas de pendência',
    start: true,
    premium: true,
    superPremium: true,
    enterprise: true,
  },
  {
    feature: 'Diagnóstico Inicial (upload em lote, importação de funcionários, Mapa SST)',
    start: true,
    premium: true,
    superPremium: true,
    enterprise: true,
  },
  {
    feature: 'Atendimento técnico',
    start: 'Avulso, sob consulta',
    premium: 'Online incluído',
    superPremium: 'Acompanhamento ativo',
    enterprise: 'Rede completa',
  },
  {
    feature: 'Técnico acompanha alertas ativamente',
    start: false,
    premium: false,
    superPremium: true,
    enterprise: true,
  },
  { feature: 'Reuniões periódicas', start: false, premium: false, superPremium: true, enterprise: true },
  {
    feature: 'Visitas presenciais',
    start: 'Sob consulta',
    premium: false,
    superPremium: 'Conforme contrato',
    enterprise: 'Multiunidade',
  },
  { feature: 'Gestão multiunidade', start: false, premium: false, superPremium: false, enterprise: true },
  { feature: 'Rede de técnicos parceiros', start: false, premium: false, superPremium: false, enterprise: true },
  { feature: 'Integrações / customização', start: false, premium: false, superPremium: false, enterprise: true },
];

export interface AssistantStep {
  title: string;
  description: string;
}

export const ASSISTANT_STEPS: AssistantStep[] = [
  { title: 'Você envia', description: 'Documentos, planilhas, fotos, certificados, registros.' },
  {
    title: 'Montese organiza',
    description: 'Identifica informações, classifica, relaciona funcionário/cargo/setor, encontra pendências.',
  },
  { title: 'Montese acompanha', description: 'Alertas, tarefas, vencimentos, pontos de atenção.' },
];

export const ASSISTANT_TECHNICIAN_STEP: AssistantStep = {
  title: 'Técnico analisa e orienta',
  description: 'Nos planos com técnico incluído (Premium, Super Premium, Enterprise).',
};
```

- [ ] **Step 2: Reescrever a página**

Substitui o conteúdo INTEIRO de `frontend/src/app/(site)/planos/page.tsx` por:

```typescript
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MountainDivider } from '@/components/MountainDivider';
import { ASSISTANT_STEPS, ASSISTANT_TECHNICIAN_STEP, COMPARISON_TABLE, PLAN_CONTENT } from './plan-content';

interface Plan {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  employee_limit: number | null;
}

const ENTERPRISE_SLUG = 'empresa-enterprise';
const RECOMMENDED_SLUG = 'empresa-premium';

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function renderCell(value: string | boolean) {
  if (value === true) return <span className="text-brand-500">✓</span>;
  if (value === false) return <span className="text-brand-200">—</span>;
  return <span className="text-brand-700">{value}</span>;
}

export default function PlanosPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(!!localStorage.getItem('montese_token'));
    fetch('/api/plans?audience=empresa')
      .then((res) => res.json())
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

  async function handleSubscribe(planId: string) {
    setError(null);
    setSubscribingPlanId(planId);
    try {
      const token = localStorage.getItem('montese_token');
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan_id: planId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.message ?? 'Não foi possível iniciar a assinatura.');
        setSubscribingPlanId(null);
        return;
      }
      const data = await res.json();
      window.location.href = data.initPoint;
    } catch {
      setError('Não foi possível conectar ao servidor.');
      setSubscribingPlanId(null);
    }
  }

  return (
    <div>
      <section className="bg-gradient-to-b from-brand-50 to-white px-4 pb-2 pt-16 sm:px-10 sm:pt-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-[36px] font-extrabold text-brand-900 sm:text-[40px]">
            Segurança do Trabalho organizada, acompanhada e acessível.
          </h1>
          <p className="mt-3.5 text-[16.5px] leading-relaxed text-brand-700">
            O Montese SST combina plataforma, inteligência artificial especializada e suporte profissional
            para ajudar sua empresa e o RH a manter a rotina de SST organizada.
          </p>
          <div className="mx-auto mt-6 grid max-w-xl grid-cols-1 gap-x-6 gap-y-2 text-left text-[13.5px] text-brand-700 sm:grid-cols-2">
            <p>
              🤖 <strong>Assistente Montese SST</strong> — organiza informações, documentos e alertas.
            </p>
            <p>
              📚 <strong>Base normativa</strong> — fundamentada em fontes oficiais de SST.
            </p>
            <p>
              📊 <strong>Gestão operacional</strong> — funcionários, documentos, EPIs, inspeções, treinamentos.
            </p>
            <p>
              🔔 <strong>Alertas e acompanhamento</strong> — datas, pendências e pontos de atenção.
            </p>
          </div>
          <p className="mt-6 text-[15px] font-semibold text-brand-900">
            Qual nível de acompanhamento sua empresa precisa?
          </p>
        </div>

        {error && <p className="mt-6 text-center text-sm text-red-600">{error}</p>}

        <div className="mx-auto mt-12 grid max-w-6xl gap-5 pb-16 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const isEnterprise = plan.slug === ENTERPRISE_SLUG;
            const isRecommended = plan.slug === RECOMMENDED_SLUG;
            const content = PLAN_CONTENT[plan.slug];

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-2xl p-7 transition-all ${
                  isEnterprise
                    ? 'bg-brand-900'
                    : isRecommended
                      ? 'border-2 border-brand-500 bg-white shadow-xl shadow-brand-500/15'
                      : 'border border-brand-100 bg-white hover:-translate-y-1 hover:shadow-lg'
                }`}
              >
                {isRecommended && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand-500 px-3.5 py-1 text-[11px] font-bold tracking-wide text-white">
                    RECOMENDADO
                  </span>
                )}

                <h2 className={`text-[17px] font-bold ${isEnterprise ? 'text-white' : 'text-brand-900'}`}>
                  {plan.name}
                </h2>
                {content && (
                  <>
                    <p
                      className={`mt-1 text-[13px] font-semibold italic ${
                        isEnterprise ? 'text-brand-300' : 'text-brand-600'
                      }`}
                    >
                      {content.positioning}
                    </p>
                    <p className={`mt-1.5 text-[13px] ${isEnterprise ? 'text-brand-300' : 'text-brand-700'}`}>
                      {content.subtitle}
                    </p>
                  </>
                )}

                <div className="mt-6">
                  {isEnterprise ? (
                    <span className="text-[22px] font-extrabold text-white">Valores a combinar</span>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="text-sm font-semibold text-brand-700">R$</span>
                      <span
                        className={`text-[38px] font-extrabold ${isEnterprise ? 'text-white' : 'text-brand-900'}`}
                      >
                        {(plan.price_cents / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                      </span>
                      <span className="text-[13px] text-brand-700">/mês</span>
                    </div>
                  )}
                </div>

                {content && (
                  <ul className="mt-6 flex flex-col gap-2.5">
                    {content.bullets.map((bullet, i) => (
                      <li
                        key={i}
                        className={`flex items-start gap-2 text-[13px] leading-snug ${
                          isEnterprise ? 'text-brand-100' : 'text-brand-700'
                        }`}
                      >
                        <span className={`mt-0.5 ${isEnterprise ? 'text-brand-300' : 'text-brand-500'}`}>
                          <CheckIcon />
                        </span>
                        {bullet}
                      </li>
                    ))}
                  </ul>
                )}

                {plan.employee_limit && (
                  <p className={`mt-4 text-[11.5px] ${isEnterprise ? 'text-brand-400' : 'text-brand-400'}`}>
                    Até {plan.employee_limit} funcionários
                  </p>
                )}

                <div className="flex-1" />

                {isEnterprise ? (
                  <Link
                    href="/contato"
                    className="mt-7 rounded-[9px] bg-white px-4 py-3 text-center text-sm font-semibold text-brand-900 hover:bg-brand-50"
                  >
                    {content?.ctaLabel ?? 'Falar com especialista'}
                  </Link>
                ) : loggedIn ? (
                  <button
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={subscribingPlanId === plan.id}
                    className={`mt-7 rounded-[9px] px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50 ${
                      isRecommended
                        ? 'bg-brand-500 text-white hover:bg-brand-700'
                        : 'border-[1.5px] border-brand-500 text-brand-700 hover:bg-brand-50'
                    }`}
                  >
                    {subscribingPlanId === plan.id ? 'Redirecionando...' : (content?.ctaLabel ?? 'Assinar')}
                  </button>
                ) : (
                  <Link
                    href="/login"
                    className={`mt-7 rounded-[9px] px-4 py-3 text-center text-sm font-semibold transition-colors ${
                      isRecommended
                        ? 'bg-brand-500 text-white hover:bg-brand-700'
                        : 'border-[1.5px] border-brand-500 text-brand-700 hover:bg-brand-50'
                    }`}
                  >
                    {content?.ctaLabel ?? 'Entrar para assinar'}
                  </Link>
                )}
              </div>
            );
          })}
        </div>

        <div className="mx-auto max-w-4xl px-4 pb-12">
          <h2 className="text-center text-[24px] font-extrabold text-brand-900">
            O Assistente Montese SST está em todos os planos.
          </h2>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-4">
            {ASSISTANT_STEPS.map((step) => (
              <div key={step.title} className="rounded-xl border border-brand-100 bg-white p-4 text-center">
                <p className="text-[14px] font-bold text-brand-900">{step.title}</p>
                <p className="mt-1.5 text-[12.5px] text-brand-700">{step.description}</p>
              </div>
            ))}
            <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50 p-4 text-center opacity-80">
              <p className="text-[14px] font-bold text-brand-700">{ASSISTANT_TECHNICIAN_STEP.title}</p>
              <p className="mt-1.5 text-[12.5px] text-brand-600">{ASSISTANT_TECHNICIAN_STEP.description}</p>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-5xl px-4 pb-16">
          <h2 className="text-center text-[24px] font-extrabold text-brand-900">
            Compare o que sua empresa terá
          </h2>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-brand-100 text-left text-brand-900">
                  <th className="py-3 pr-4 font-semibold">Recurso</th>
                  <th className="px-4 py-3 text-center font-semibold">Start</th>
                  <th className="px-4 py-3 text-center font-semibold">Premium</th>
                  <th className="px-4 py-3 text-center font-semibold">Super Premium</th>
                  <th className="px-4 py-3 text-center font-semibold">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_TABLE.map((row) => (
                  <tr key={row.feature} className="border-b border-brand-50">
                    <td className="py-3 pr-4 text-brand-700">{row.feature}</td>
                    <td className="px-4 py-3 text-center">{renderCell(row.start)}</td>
                    <td className="px-4 py-3 text-center">{renderCell(row.premium)}</td>
                    <td className="px-4 py-3 text-center">{renderCell(row.superPremium)}</td>
                    <td className="px-4 py-3 text-center">{renderCell(row.enterprise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mx-auto max-w-2xl px-4 pb-6 text-center">
          <p className="text-[15px] leading-relaxed text-brand-700">
            Comece gratuitamente e conheça o Montese SST na prática. Organize sua empresa, conheça o
            Assistente Montese e descubra como a tecnologia pode reduzir o trabalho operacional do RH e
            melhorar o acompanhamento de SST. Sem compromisso durante o período de teste.
          </p>
        </div>

        <div className="mx-auto flex max-w-2xl flex-wrap justify-center gap-3.5 pb-16">
          <Link
            href="/cadastro"
            className="rounded-[9px] bg-brand-500 px-7 py-3.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Ainda não é cliente? Comece grátis
          </Link>
          <Link
            href="/contato"
            className="rounded-[9px] border-[1.5px] border-brand-500 px-7 py-3.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
          >
            Fale com vendas
          </Link>
        </div>

        <MountainDivider />
      </section>
    </div>
  );
}
```

**Nota sobre mudanças em relação ao arquivo atual**: `formatPrice` foi removida — confirmado por grep (`grep -n "formatPrice" frontend/src/app/\(site\)/planos/page.tsx`) que a única ocorrência no arquivo original é a própria definição da função, nunca chamada (o preço já é formatado inline com `toLocaleString` na JSX) — código morto pré-existente, seguro remover. O restante (`handleSubscribe`, estados, fetch, roteamento de CTA por `isEnterprise`/`loggedIn`) é idêntico ao arquivo atual, só a parte de apresentação (JSX) muda.

- [ ] **Step 3: Build**

Run: `docker compose build frontend`
Expected: build limpo, sem erros de TypeScript (confere principalmente que `PLAN_CONTENT`/`COMPARISON_TABLE`/`ASSISTANT_STEPS`/`ASSISTANT_TECHNICIAN_STEP` importam certo e que os tipos de `ComparisonRow`/`renderCell` batem).

- [ ] **Step 4: Deploy e confirmação do bundle real**

```bash
docker compose up -d frontend
```

Confirmar via grep dentro do container que o bundle novo está de pé antes de qualquer teste Playwright (disciplina já estabelecida neste projeto — um build sozinho não garante que o container rodando já serve o código novo):

```bash
docker compose exec frontend sh -c "grep -rl 'Qual nível de acompanhamento' .next/server/app 2>/dev/null || grep -rl 'Qual nível de acompanhamento' .next/static/chunks 2>/dev/null"
```

Expected: pelo menos um arquivo encontrado.

- [ ] **Step 5: Verificação Playwright real**

Escreva um script Playwright (Node, scratchpad) que abre `https://montesesst.com.br/planos`, mocka `GET /api/plans?audience=empresa` com os 4 planos reais (`empresa-start` 39700/10, `empresa-premium` 79700/50, `empresa-super-premium` 129700/200, `empresa-enterprise` 500000/null — mesmos preços reais de hoje, não precisa mudar), e confirma:

1. O título novo "Segurança do Trabalho organizada, acompanhada e acessível." aparece.
2. A frase "Qual nível de acompanhamento sua empresa precisa?" aparece.
3. Cada um dos 4 cards mostra o `positioning` certo do seu plano (ex.: "A base inteligente para organizar sua SST." pro Start).
4. O card Start mostra o bullet "Atendimento técnico avulso sob consulta..." e o botão "Começar gratuitamente".
5. O card Enterprise continua mostrando "Valores a combinar" (sem preço fixo) e o botão agora diz "Falar com especialista", apontando pra `/contato`.
6. O bloco "O Assistente Montese SST está em todos os planos." aparece com os 3 passos + o 4º step "Técnico analisa e orienta" com a legenda "Nos planos com técnico incluído...".
7. A tabela comparativa renderiza — confirme pelo menos 1 linha 100% ✓ (ex.: "Plataforma + Assistente...") e a linha "Atendimento técnico" mostrando os 4 textos diferentes (não ✓/—).
8. A frase de trial nova ("Comece gratuitamente e conheça o Montese SST na prática...") aparece perto do final da página.
9. Testando com `loggedIn=true` (mock de `montese_token` no localStorage) + `handleSubscribe` mockado: clicar no botão do card Premium ("Quero SST + técnico") dispara `POST /api/subscriptions` com o `plan_id` certo (mesma verificação de sempre, sem mudança de comportamento — só o texto do botão mudou).

Run: script Playwright real contra a URL de produção.
Expected: todas as asserções passam.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/\(site\)/planos/plan-content.ts frontend/src/app/\(site\)/planos/page.tsx
git commit -m "feat: reescreve /planos com proposta comercial por nível de suporte"
```
