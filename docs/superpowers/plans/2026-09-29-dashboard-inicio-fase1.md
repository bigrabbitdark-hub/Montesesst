# Dashboard "Início" (Empresa) — Fase 1: Fundação Visual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o "casco" visual do novo dashboard "Início" da área Empresa (tokens de design, fontes, ícones, layout de sidebar/header/rodapé/grade, componentes de UI genéricos) na grade exata 1440×960 descrita na especificação, com blocos de conteúdo ainda vazios — sem dados reais (isso é Fase 3) e sem os componentes de conteúdo (KPIs, gráficos, tabelas — isso é Fase 2).

**Architecture:** Extende o Tailwind v4 `@theme` existente (`globals.css`) com os tokens semânticos da spec, sem remover os tokens `brand-*`/`accent-*` atuais (evita quebrar páginas fora do escopo). Generaliza o design system que hoje só existe em `components/admin/` (Card/Badge/Skeleton/AsyncBody) para uma versão neutra em `components/ui/`, reutilizável por Empresa e Admin. A sidebar/header/rodapé novos substituem o `EmpresaSidebar` atual em `frontend/src/app/empresa/layout.tsx` — isso afeta todas as páginas de Empresa (não só "Início"), porque a sidebar é compartilhada; é uma decisão estrutural inevitável do redesenho, não scope creep (ver nota de escopo abaixo).

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript 5.6, Tailwind CSS v4 (`@theme`, sem `tailwind.config.js`), `next/font/google` (Poppins já carregada; Inter precisa ser adicionada), `lucide-react` (ícones, novo), `recharts` (gráficos, novo — usado só nas Fases 2+, mas instalado aqui), ESLint (`eslint-config-next`, novo), Playwright (`@playwright/test`, novo, só para o comparativo visual).

**Spec:** especificação colada pelo usuário na conversa (não é um arquivo no repo) — seções 4 (tokens), 5 (grade/layout), 6.1–6.3 e 6.12 (sidebar/header/hero/rodapé), 10 (comparativo visual). Relatório de exploração da Fase 0 (achados) e as decisões já confirmadas com o usuário estão resumidos na seção "Decisões desta sessão" abaixo.

## Decisões já confirmadas com o usuário (não reabrir sem motivo novo)

- **Escopo Admin:** `/admin/overview` mantém o conteúdo atual (financeiro/infra/clientes) — só receberá os tokens/componentes visuais novos numa fase futura, fora deste plano. Este plano cobre **só a área Empresa**.
- **Paleta de cores:** a paleta da spec é adotada como a nova oficial. Os tokens `--color-brand-*`/`--color-accent-*` **continuam existindo** (para não quebrar páginas fora do escopo) — os tokens novos da spec entram com nomes próprios.
- **Ícones/gráficos:** `lucide-react` + `recharts` (não SVG à mão).
- **Infra de teste:** ESLint + Playwright entram nesta fase.
- **Itens de menu sem rota hoje** (Cadastros, Treinamentos, Calendário SST, eSocial, Conformidade, Solicitações Técnicas, Relatórios, Configurações): usam o padrão "Em construção" (mesmo do admin) — página `em-construcao/page.tsx` compartilhada, não 8 páginas novas.

## Bloqueio conhecido, não resolvido ainda

Os arquivos reais de `docs/dashboard-v2/{reference,fixtures,assets}/` (HTML de referência, `dashboard.sample.json`, 4 imagens) **não existem no repositório** — o usuário colou só o texto da especificação. Este plano constrói o layout inteiro a partir das medidas/cores/textos exatos do texto da spec (que são muito detalhados), com:
- As 4 imagens (`logo-montese-horizontal.png`, `bg-banner-montese.jpg`, `bg-menu-tecnicas.jpg`, `bg-coluna-rh-tecnico.jpg`) como retângulos coloridos com o texto do nome do arquivo, claramente marcados — trocar por `next/image` real quando os arquivos chegarem (Task 7).
- O comparativo de screenshot pixel-a-pixel (Task 8, Playwright) fica com o baseline **pendente** até o HTML de referência chegar — a task já monta a estrutura do teste, mas ele começa `test.skip` com um comentário explicando o motivo, para não mascarar uma suíte "verde" que não está testando nada.

## Global Constraints

- Português do Brasil em toda a interface (datas `dd/mm/aaaa`).
- Não alterar nenhuma página fora de `frontend/src/app/empresa/` e `frontend/src/components/` (nada de `admin/`, `tecnico/`, `(site)/`).
- Não hospedar imagens em CDN de terceiros.
- Todo elemento interativo é `<a>`/`<button>` real, com foco visível — nenhuma `<div onClick>`.
- Cor nunca é o único indicador de estado (isto vale a partir da Fase 2, quando os selos de status aparecem — sem efeito nesta fase, mas os componentes `Badge`/`AsyncBody` desta fase já precisam suportar texto ao lado da cor).

---

## Task 1: Instalar dependências novas e configurar ESLint

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/eslint.config.mjs`
- Create: `frontend/.eslintignore` (se o formato flat config do Next 14 precisar — verificar no Step 3)

**Interfaces:**
- Produces: comando `npm run lint` funcional em `frontend/package.json` scripts.

- [ ] **Step 1: Instalar as dependências**

```bash
cd frontend && npm install lucide-react@^0.460.0 recharts@^2.13.0 && npm install -D eslint@^8.57.0 eslint-config-next@^14.2.18 @playwright/test@^1.48.0
```

- [ ] **Step 2: Adicionar o script `lint` e `typecheck` em `frontend/package.json`**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start -p 3000",
  "lint": "eslint . --max-warnings=0",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 3: Criar `frontend/eslint.config.mjs`**

```js
import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  { ignores: ['.next/**', 'node_modules/**'] },
];
```

Se `next/core-web-vitals` exigir `@eslint/eslintrc` como dependência direta (Next 14 costuma trazer via `eslint-config-next`, mas confirme): `npm install -D @eslint/eslintrc`.

- [ ] **Step 4: Rodar lint e typecheck, confirmar que passam no código já existente**

Run: `cd frontend && npm run lint && npm run typecheck`
Expected: sem erros (avisos pré-existentes, se houver, ficam registrados aqui — não são desta task para corrigir, a menos que bloqueiem `--max-warnings=0`; se bloquearem, trocar para `--max-warnings=<N atual>` e registrar no relatório final).

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/eslint.config.mjs
git commit -m "chore(frontend): instala lucide-react, recharts, eslint e playwright"
```

---

## Task 2: Tokens de design da spec (cores + fonte Inter)

**Files:**
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/src/app/layout.tsx`

**Interfaces:**
- Produces: classes utilitárias Tailwind `bg-dash-*`/`text-dash-*` (ex.: `bg-dash-sidebar`, `text-dash-primary`) e a variável `--font-inter`.

- [ ] **Step 1: Adicionar os tokens da spec em `globals.css`, dentro do `@theme` existente, sem remover os tokens `brand-*`/`accent-*`**

```css
@theme {
  --color-brand-50: #f0f9f4;
  --color-brand-100: #dbf0e3;
  --color-brand-300: #7fcf9d;
  --color-brand-500: #2f9e5c;
  --color-brand-700: #1f6e40;
  --color-brand-900: #123822;

  --color-accent-400: #fbbf24;
  --color-accent-500: #f59e0b;
  --color-accent-700: #b45309;

  /* Dashboard "Início" (Fase 1, 2026-09-29) — paleta oficial nova, nomes
     próprios pra não colidir com brand-*/accent-* enquanto o resto do app
     não migra. Valores exatos da especificação do dashboard v2. */
  --color-dash-page: #eef3fa;
  --color-dash-sidebar: #0a1640;
  --color-dash-card: #ffffff;
  --color-dash-primary: #0b1b4d;
  --color-dash-muted: #475569;
  --color-dash-border-soft: #e5eaf3;
  --color-dash-border-input: #cbd5e1;
  --color-dash-blue-action: #1d5cff;
  --color-dash-blue-link: #1d4ed8;
  --color-dash-brand-green: #1e7d32;
  --color-dash-brand-green-dark: #0f4d28;
  --color-dash-brand-green-light: #66bb6a;
  --color-dash-hero-bg: #0a1230;

  --color-dash-status-ok: #16a34a;
  --color-dash-status-ok-bg: #dcfce7;
  --color-dash-status-ok-text: #166534;
  --color-dash-status-warn: #f59e0b;
  --color-dash-status-warn-bg: #fef3c7;
  --color-dash-status-warn-text: #92400e;
  --color-dash-status-crit: #dc2626;
  --color-dash-status-crit-bg: #fee2e2;
  --color-dash-status-crit-text: #991b1b;
  --color-dash-status-info: #1d4ed8;
  --color-dash-status-info-bg: #dbeafe;
  --color-dash-status-info-text: #1e40af;
  --color-dash-status-epi: #7c3aed;
  --color-dash-status-epi-text: #6d28d9;

  --font-sans: var(--font-poppins), system-ui, sans-serif;
  --font-body: var(--font-inter), system-ui, sans-serif;
}
```

- [ ] **Step 2: Carregar a fonte Inter em `frontend/src/app/layout.tsx`, ao lado da Poppins já existente**

Leia o arquivo primeiro para pegar a estrutura exata do import atual de Poppins (linhas 1-22 do relatório da Fase 0) e replique o padrão para Inter, expondo `--font-inter` e aplicando `inter.variable` no mesmo elemento que já recebe `poppins.variable`.

- [ ] **Step 3: Verificar que as classes Tailwind foram geradas**

Run: `cd frontend && npm run build 2>&1 | tail -30`
Expected: build sem erro; confirme visualmente (grep) que `bg-dash-sidebar`/`text-dash-primary` etc. funcionam num componente de teste rápido (pode ser um `console.log` temporário removido depois, ou inspecionar o CSS gerado em `.next/static/css/*.css` com `grep dash-sidebar`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/globals.css frontend/src/app/layout.tsx
git commit -m "feat(frontend): tokens de design e fonte Inter do dashboard novo"
```

---

## Task 3: Componentes de UI genéricos (`components/ui/`)

**Files:**
- Create: `frontend/src/components/ui/Card.tsx`
- Create: `frontend/src/components/ui/Badge.tsx`
- Create: `frontend/src/components/ui/Skeleton.tsx`
- Create: `frontend/src/components/ui/AsyncBody.tsx`
- Test: `frontend/src/components/ui/__tests__/Badge.test.tsx` (ver nota sobre runner no Step 1)

**Interfaces:**
- Produces:
  - `Card({ title?, className?, children }): JSX.Element` — container branco, raio 10px, sombra `0 1px 3px rgba(15,23,42,0.08)`.
  - `Badge({ tone, children }): JSX.Element`, `type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'epi'`.
  - `Skeleton({ className }): JSX.Element` — bloco `animate-pulse` com as dimensões passadas via `className`.
  - `AsyncBody<T>({ data, error, loading, onRetry, render }): JSX.Element` — mostra `Skeleton` se `loading`, mensagem+"Tentar novamente" se `error`, `render(data)` senão.

- [ ] **Step 0: Não há runner de teste no frontend (achado da Fase 0) — decisão desta task: instalar Vitest, o menor runner pra testar componente puro sem depender de navegador.**

```bash
cd frontend && npm install -D vitest@^2.1.0 @testing-library/react@^16.0.0 @testing-library/jest-dom@^6.6.0 jsdom@^25.0.0
```

Adicionar em `frontend/package.json` scripts: `"test": "vitest run"`.

Criar `frontend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'jsdom', globals: true },
});
```

- [ ] **Step 1: Escrever o teste de `Badge` (falha primeiro — o componente ainda não existe)**

```tsx
// frontend/src/components/ui/__tests__/Badge.test.tsx
import { render, screen } from '@testing-library/react';
import { Badge } from '../Badge';

describe('Badge', () => {
  it('renderiza o texto e aplica a cor do tone "crit"', () => {
    render(<Badge tone="crit">Vencido</Badge>);
    const el = screen.getByText('Vencido');
    expect(el.className).toContain('bg-dash-status-crit-bg');
    expect(el.className).toContain('text-dash-status-crit-text');
  });

  it('nunca depende só da cor — o texto do selo é sempre visível', () => {
    render(<Badge tone="ok">Válido</Badge>);
    expect(screen.getByText('Válido')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha (módulo `../Badge` não existe)**

Run: `cd frontend && npx vitest run src/components/ui/__tests__/Badge.test.tsx`
Expected: FAIL — `Cannot find module '../Badge'`.

- [ ] **Step 3: Implementar `Badge.tsx`**

```tsx
// frontend/src/components/ui/Badge.tsx
export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'epi';

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'bg-dash-status-ok-bg text-dash-status-ok-text',
  warn: 'bg-dash-status-warn-bg text-dash-status-warn-text',
  crit: 'bg-dash-status-crit-bg text-dash-status-crit-text',
  info: 'bg-dash-status-info-bg text-dash-status-info-text',
  epi: 'bg-violet-100 text-dash-status-epi-text',
};

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-[5px] px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Rodar de novo, confirmar GREEN**

Run: `cd frontend && npx vitest run src/components/ui/__tests__/Badge.test.tsx`
Expected: PASS, 2/2.

- [ ] **Step 5: Implementar `Card.tsx`, `Skeleton.tsx`, `AsyncBody.tsx` (sem teste unitário próprio — são visuais/estruturais, cobertos pelo Playwright da Task 8)**

```tsx
// frontend/src/components/ui/Card.tsx
export function Card({ title, className = '', children }: { title?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-[10px] bg-dash-card shadow-[0_1px_3px_rgba(15,23,42,0.08)] ${className}`}>
      {title && <h3 className="border-b border-dash-border-soft px-4 py-3 text-sm font-bold text-dash-primary">{title}</h3>}
      <div className="p-4">{children}</div>
    </div>
  );
}
```

```tsx
// frontend/src/components/ui/Skeleton.tsx
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-dash-border-soft ${className}`} />;
}
```

```tsx
// frontend/src/components/ui/AsyncBody.tsx
export function AsyncBody<T>({
  data,
  error,
  loading,
  onRetry,
  render,
  skeletonClassName = 'h-24 w-full',
}: {
  data: T | null;
  error: string | null;
  loading: boolean;
  onRetry?: () => void;
  render: (data: T) => React.ReactNode;
  skeletonClassName?: string;
}) {
  if (loading) return <Skeleton className={skeletonClassName} />;
  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm text-dash-status-crit-text">
        <span>{error}</span>
        {onRetry && (
          <button onClick={onRetry} className="rounded border border-dash-border-input px-2 py-1 text-xs font-semibold">
            Tentar novamente
          </button>
        )}
      </div>
    );
  }
  if (data === null) return <p className="text-sm text-dash-muted">Nenhum dado disponível.</p>;
  return <>{render(data)}</>;
}
```

Import que falta em `Skeleton.tsx`/`Card.tsx`/`AsyncBody.tsx`: nenhum — são componentes puros sem dependência externa além de `react` (já global via JSX).

- [ ] **Step 6: Typecheck + lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/vitest.config.ts frontend/src/components/ui/
git commit -m "feat(frontend): componentes de UI genéricos (Card, Badge, Skeleton, AsyncBody)"
```

---

## Task 4: Placeholders de imagem (até os arquivos reais chegarem)

**Files:**
- Create: `frontend/src/components/dashboard/ImagePlaceholder.tsx`
- Create: `frontend/src/lib/dashboard/assets.ts`

**Interfaces:**
- Produces: `ASSET_PATHS: Record<'logo' | 'bannerHero' | 'sidebarFooter' | 'columnFooter', string>` e `ImagePlaceholder({ label, className }): JSX.Element`.

- [ ] **Step 1: Criar o arquivo central de caminhos de imagem (fácil de trocar quando os arquivos chegarem, conforme pede a seção 8 da spec)**

```ts
// frontend/src/lib/dashboard/assets.ts
export const ASSET_PATHS = {
  logo: '/dashboard-v2/logo-montese-horizontal.png',
  bannerHero: '/dashboard-v2/bg-banner-montese.jpg',
  sidebarFooter: '/dashboard-v2/bg-menu-tecnicas.jpg',
  columnFooter: '/dashboard-v2/bg-coluna-rh-tecnico.jpg',
} as const;

// Achado da Fase 0 (2026-09-29): nenhum destes arquivos existe em
// /opt/Montese/frontend/public/dashboard-v2/ ainda — a especificação só
// chegou como texto. ImagePlaceholder (ver componente ao lado) renderiza um
// retângulo com o nome do arquivo até os arquivos reais serem adicionados
// nesse caminho.
export const ASSETS_ARE_PLACEHOLDERS = true;
```

- [ ] **Step 2: Criar o componente de placeholder**

```tsx
// frontend/src/components/dashboard/ImagePlaceholder.tsx
export function ImagePlaceholder({ label, className = '' }: { label: string; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center bg-[repeating-linear-gradient(45deg,#1a2550,#1a2550_10px,#0a1640_10px,#0a1640_20px)] text-center text-[10px] font-semibold text-white/70 ${className}`}
      role="img"
      aria-label={`Imagem pendente: ${label}`}
    >
      IMAGEM PENDENTE
      <br />
      {label}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/dashboard/assets.ts frontend/src/components/dashboard/ImagePlaceholder.tsx
git commit -m "feat(frontend): placeholder de imagem até os assets reais do dashboard chegarem"
```

---

## Task 5: Sidebar nova (212px, navy, 17 itens)

**Files:**
- Create: `frontend/src/components/dashboard/DashboardSidebar.tsx`
- Create: `frontend/src/lib/dashboard/menu.ts`
- Create: `frontend/src/app/empresa/em-construcao/page.tsx`

**Interfaces:**
- Consumes: `ImagePlaceholder` (Task 4), `ASSET_PATHS` (Task 4).
- Produces: `MENU_ITEMS: MenuItem[]` (`{ href: string; label: string; icon: LucideIcon; implemented: boolean }`), `DashboardSidebar(): JSX.Element`.

- [ ] **Step 1: Definir o menu com o mapeamento de rotas reais achado na Fase 0**

```ts
// frontend/src/lib/dashboard/menu.ts
import {
  Home, Bot, Users, FileText, ShieldCheck, ClipboardCheck, Flame, CircleCheck,
  GraduationCap, Calendar, Globe, ShieldCheck as ComplianceIcon, Coins,
  ClipboardList, Building2, FileBarChart2, Settings, type LucideIcon,
} from 'lucide-react';

export interface MenuItem {
  href: string;
  label: string;
  icon: LucideIcon;
  implemented: boolean;
}

// Rotas reais confirmadas na exploração da Fase 0 (2026-09-29); os itens
// implemented:false apontam para /empresa/em-construcao?item=<label>.
export const MENU_ITEMS: MenuItem[] = [
  { href: '/empresa/dashboard', label: 'Início', icon: Home, implemented: true },
  { href: '/empresa/assistente', label: 'Assistente Montese', icon: Bot, implemented: true },
  { href: '/empresa/em-construcao?item=Cadastros', label: 'Cadastros', icon: Users, implemented: false },
  { href: '/empresa/documentos', label: 'Documentos', icon: FileText, implemented: true },
  { href: '/empresa/epis', label: 'EPIs', icon: ShieldCheck, implemented: true },
  { href: '/empresa/inspecoes', label: 'Inspeções', icon: ClipboardCheck, implemented: true },
  { href: '/empresa/brigada', label: 'Brigada de Incêndio', icon: Flame, implemented: true },
  { href: '/empresa/cipa', label: 'CIPA', icon: CircleCheck, implemented: true },
  { href: '/empresa/em-construcao?item=Treinamentos', label: 'Treinamentos', icon: GraduationCap, implemented: false },
  { href: '/empresa/em-construcao?item=Calendário SST', label: 'Calendário SST', icon: Calendar, implemented: false },
  { href: '/empresa/em-construcao?item=eSocial', label: 'eSocial', icon: Globe, implemented: false },
  { href: '/empresa/em-construcao?item=Conformidade', label: 'Conformidade', icon: ComplianceIcon, implemented: false },
  { href: '/empresa/em-construcao?item=Financeiro', label: 'Financeiro', icon: Coins, implemented: false },
  { href: '/empresa/em-construcao?item=Solicitações Técnicas', label: 'Solicitações Técnicas', icon: ClipboardList, implemented: false },
  { href: '/empresa/onboarding', label: 'Filiais', icon: Building2, implemented: true },
  { href: '/empresa/em-construcao?item=Relatórios', label: 'Relatórios', icon: FileBarChart2, implemented: false },
  { href: '/empresa/em-construcao?item=Configurações', label: 'Configurações', icon: Settings, implemented: false },
];
```

- [ ] **Step 2: Criar a página "Em construção" compartilhada**

```tsx
// frontend/src/app/empresa/em-construcao/page.tsx
'use client';
import { useSearchParams } from 'next/navigation';

export default function EmConstrucaoPage() {
  const params = useSearchParams();
  const item = params.get('item') ?? 'Este módulo';
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-12 text-center">
      <h1 className="text-lg font-bold text-dash-primary">{item} está em construção</h1>
      <p className="text-sm text-dash-muted">Esta área ainda não está disponível. Volte em breve.</p>
    </div>
  );
}
```

- [ ] **Step 3: Criar a sidebar**

```tsx
// frontend/src/components/dashboard/DashboardSidebar.tsx
'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MENU_ITEMS } from '@/lib/dashboard/menu';
import { ASSET_PATHS } from '@/lib/dashboard/assets';
import { ImagePlaceholder } from './ImagePlaceholder';

export function DashboardSidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex h-screen w-[212px] flex-none flex-col bg-dash-sidebar px-2 py-3" aria-label="Menu principal">
      <div className="mb-3.5 flex h-[58px] items-center justify-center rounded-[10px] bg-white">
        <Image src={ASSET_PATHS.logo} alt="Montese SST" width={176} height={40} />
      </div>
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {MENU_ITEMS.map(({ href, label, icon: Icon, implemented }) => {
          const active = pathname === href;
          return (
            <li key={label}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-[34px] items-center gap-2 rounded-lg px-2.5 text-[13.5px] font-semibold ${
                  active ? 'bg-dash-brand-green text-white' : 'text-[#DCE6FF] hover:bg-white/5'
                } ${!implemented ? 'opacity-70' : ''}`}
              >
                <Icon size={17} strokeWidth={2} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="relative mt-2 h-[150px] overflow-hidden rounded-[10px]">
        <ImagePlaceholder label="bg-menu-tecnicas.jpg" className="absolute inset-0" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#0A1640_0%,rgba(10,22,64,.55)_30%,rgba(10,22,64,.10)_100%)]" />
        <p className="absolute bottom-3 left-3 right-3 text-[12.5px] font-semibold text-white">
          Tecnologia organiza.
          <br />
          Pessoas protegem.
        </p>
        <div className="absolute bottom-1 left-3 h-[3px] w-12 bg-[linear-gradient(90deg,#16A34A_33%,white_33%,white_66%,#E23B3B_66%)]" />
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: sem erros. Se `@/lib/...` não resolver, confirme o alias `paths` em `frontend/tsconfig.json` (deve já existir, projeto usa `@/` em outros arquivos — se não existir, adicionar `"paths": { "@/*": ["./src/*"] }`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/dashboard/menu.ts frontend/src/components/dashboard/DashboardSidebar.tsx frontend/src/app/empresa/em-construcao/
git commit -m "feat(frontend): sidebar nova do dashboard com os 17 itens e página Em construção"
```

---

## Task 6: Header, Hero e Rodapé

**Files:**
- Create: `frontend/src/components/dashboard/DashboardHeader.tsx`
- Create: `frontend/src/components/dashboard/DashboardHero.tsx`
- Create: `frontend/src/components/dashboard/DashboardFooterNew.tsx`

**Interfaces:**
- Consumes: `ImagePlaceholder`, `ASSET_PATHS` (Task 4), `getUser()` de `frontend/src/lib/auth.ts` (já existe — `SessionUser`).
- Produces: `DashboardHeader({ user, empresaNome, cnpj }): JSX.Element`, `DashboardHero(): JSX.Element`, `DashboardFooterNew(): JSX.Element`.

- [ ] **Step 1: Header (64px)**

```tsx
// frontend/src/components/dashboard/DashboardHeader.tsx
import { Search, Bell } from 'lucide-react';

export function DashboardHeader({
  primeiroNome,
  empresaNome,
  cnpj,
  papel,
}: {
  primeiroNome: string;
  empresaNome: string;
  cnpj: string;
  papel: string;
}) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-dash-border-soft bg-dash-card px-3">
      <div>
        <h1 className="font-[var(--font-sans)] text-xl font-bold text-dash-primary">Bem-vindo, {primeiroNome}!</h1>
        <p className="text-xs text-dash-muted">
          {empresaNome} | CNPJ {cnpj}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-60">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dash-muted" aria-hidden />
          <input
            type="search"
            placeholder="Buscar no sistema..."
            className="h-full w-full rounded-[10px] border border-dash-border-input pl-9 pr-3 text-sm"
          />
        </div>
        <button aria-label="Notificações" className="relative rounded-full p-2 hover:bg-dash-page">
          <Bell size={20} className="text-dash-muted" />
        </button>
        <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#0F2A6B] text-xs font-bold text-white">
          {primeiroNome.slice(0, 2).toUpperCase()}
        </div>
        <div className="text-xs">
          <p className="font-semibold text-dash-primary">{primeiroNome}</p>
          <p className="text-dash-muted">{papel}</p>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Hero (993×120)**

```tsx
// frontend/src/components/dashboard/DashboardHero.tsx
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
```

- [ ] **Step 3: Rodapé (39px)**

```tsx
// frontend/src/components/dashboard/DashboardFooterNew.tsx
import Image from 'next/image';
import { ASSET_PATHS } from '@/lib/dashboard/assets';

export function DashboardFooterNew({ version }: { version: string }) {
  return (
    <footer className="flex h-[39px] items-center justify-between border-t border-[#DDE5F1] px-3 text-[11px] text-dash-muted">
      <div className="flex items-center gap-2">
        <Image src={ASSET_PATHS.logo} alt="" aria-hidden height={24} width={106} />
        <span>Segurança do Trabalho organizada, acompanhada e acessível.</span>
      </div>
      <div className="flex items-center gap-3">
        <a href="/ajuda" className="hover:underline">Ajuda</a>
        <a href="/termos" className="hover:underline">Termos de uso</a>
        <a href="/privacidade" className="hover:underline">Política de privacidade</a>
        <span>v{version}</span>
      </div>
    </footer>
  );
}
```

`version` vem de `frontend/package.json` (`"version": "0.1.0"` — confirmado no relatório da Fase 0). Ler no `page.tsx` (Task 7) via `import pkg from '../../../package.json'` ou expor por variável de ambiente de build — decidir na Task 7 conforme o que o projeto já faz em outro lugar (verificar rapidamente antes de escolher).

- [ ] **Step 4: Typecheck + lint**

Run: `cd frontend && npm run typecheck && npm run lint`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/dashboard/DashboardHeader.tsx frontend/src/components/dashboard/DashboardHero.tsx frontend/src/components/dashboard/DashboardFooterNew.tsx
git commit -m "feat(frontend): header, hero e rodapé novos do dashboard"
```

---

## Task 7: Grade da página e substituição do layout de Empresa

**Files:**
- Modify: `frontend/src/app/empresa/layout.tsx`
- Modify: `frontend/src/app/empresa/dashboard/page.tsx`
- Create: `frontend/public/dashboard-v2/` (pasta vazia com `.gitkeep`, para receber os assets reais depois)

**Interfaces:**
- Consumes: `DashboardSidebar` (Task 5), `DashboardHeader`/`DashboardHero`/`DashboardFooterNew` (Task 6), `Card` (Task 3).

- [ ] **Step 1: Ler o `empresa/layout.tsx` e `empresa/dashboard/page.tsx` atuais por completo antes de editar** (não reproduzido aqui — leitura obrigatória do executor, arquivos pequenos segundo a Fase 0).

- [ ] **Step 2: Substituir a sidebar antiga (`EmpresaSidebar`) pela nova no layout**

Trocar o import e o uso de `EmpresaSidebar` por `DashboardSidebar` em `frontend/src/app/empresa/layout.tsx`, mantendo `RoleGuard` e `WhatsAppButton`/`SubscriptionNotice` como estão. `DashboardFooter` (antigo) é substituído por `DashboardFooterNew` só dentro da página `dashboard/`, não no layout — o rodapé da spec é específico desta tela; confirmar com o usuário antes da Fase 2 se as outras páginas de empresa devem ganhar o mesmo rodapé (fora de escopo desta task).

- [ ] **Step 3: Montar a grade vazia em `empresa/dashboard/page.tsx`**

```tsx
// estrutura da grade — blocos de conteúdo real entram na Fase 2
<div className="flex min-h-screen bg-dash-page">
  <DashboardSidebar />
  <div className="flex flex-1 flex-col">
    <DashboardHeader primeiroNome={...} empresaNome={...} cnpj={...} papel={...} />
    <main className="flex flex-1 gap-3 p-3">
      <div className="flex flex-[993] flex-col gap-3">
        <DashboardHero />
        <div className="h-[91px] rounded-[10px] border border-dash-border-soft bg-dash-card" /> {/* KPIs — Fase 2 */}
        <div className="flex h-[288px] gap-2.5">
          <div className="w-[340px] rounded-[10px] border border-dash-border-soft bg-dash-card" /> {/* Avisos — Fase 2 */}
          <div className="w-[347px] rounded-[10px] border border-dash-border-soft bg-dash-card" /> {/* Evolução — Fase 2 */}
          <div className="flex-1 rounded-[10px] border border-dash-border-soft bg-dash-card" /> {/* Próximas atividades — Fase 2 */}
        </div>
        <div className="h-[120px] rounded-[10px] border border-dash-border-soft bg-dash-card" /> {/* Conformidade por área — Fase 2 */}
        <div className="flex h-[190px] gap-2.5">
          <div className="w-[547px] rounded-[10px] border border-dash-border-soft bg-dash-card" /> {/* Documentos — Fase 2 */}
          <div className="flex-1 rounded-[10px] border border-dash-border-soft bg-dash-card" /> {/* Colaboradores — Fase 2 */}
        </div>
      </div>
      <div className="flex w-[200px] flex-col gap-3">
        <div className="h-[329px] rounded-[10px] border border-dash-border-soft bg-dash-card" /> {/* Assistente — Fase 2 */}
        <div className="h-[124px] rounded-[10px] border border-dash-border-soft bg-dash-card" /> {/* Plano — Fase 2 */}
        <div className="h-[148px] rounded-[10px] border border-dash-border-soft bg-dash-card" /> {/* Técnico — Fase 2 */}
        <div className="h-[88px] rounded-[10px] border border-dash-border-soft bg-dash-card" /> {/* Banner — Fase 2 */}
      </div>
    </main>
    <DashboardFooterNew version="0.1.0" />
  </div>
</div>
```

Preencher `primeiroNome`/`empresaNome`/`cnpj`/`papel` a partir do que a página atual já busca (`GET /api/tenants/me`) — reaproveitar, não duplicar a chamada.

- [ ] **Step 4: `mkdir -p frontend/public/dashboard-v2 && touch frontend/public/dashboard-v2/.gitkeep`**

- [ ] **Step 5: Rodar o app localmente e conferir visualmente a grade em 1440px**

Run: `cd frontend && npm run dev` (em background) e abrir `http://localhost:3000/empresa/dashboard` numa janela de 1440px de largura, logado como empresa.
Expected: sidebar navy 212px, header, hero com placeholder listrado, blocos vazios na grade descrita na seção 5 da spec, rodapé.

- [ ] **Step 6: Typecheck + lint + build**

Run: `cd frontend && npm run typecheck && npm run lint && npm run build`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/empresa/layout.tsx frontend/src/app/empresa/dashboard/page.tsx frontend/public/dashboard-v2/.gitkeep
git commit -m "feat(frontend): grade do dashboard Início com blocos vazios na medida exata da spec"
```

---

## Task 8: Scaffold do comparativo visual (Playwright) — baseline pendente

**Files:**
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/dashboard-visual.spec.ts`

**Interfaces:**
- Nenhuma — teste fim-a-fim, sem importar código de produção.

- [ ] **Step 1: Config do Playwright**

```ts
// frontend/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { viewport: { width: 1440, height: 960 }, baseURL: 'http://localhost:3000' },
  webServer: { command: 'npm run dev', port: 3000, reuseExistingServer: true },
});
```

- [ ] **Step 2: Teste de comparativo, com skip explícito até o HTML de referência existir**

```ts
// frontend/e2e/dashboard-visual.spec.ts
import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';

// Bloqueio conhecido (ver plano Fase 1, seção "Bloqueio conhecido"): o HTML
// de referência (docs/dashboard-v2/reference/dashboard-referencia.html)
// ainda não foi adicionado ao repositório. Este teste fica skip até lá —
// de propósito, para não reportar uma suíde "verde" que não compara nada.
const REFERENCE_PATH = '../docs/dashboard-v2/reference/dashboard-referencia.html';
const hasReference = existsSync(new URL(REFERENCE_PATH, import.meta.url));

test.describe('Comparativo visual — dashboard Início', () => {
  test.skip(!hasReference, 'HTML de referência ainda não está no repositório (docs/dashboard-v2/reference/)');

  test('grade do dashboard bate com a referência em 1440x960', async ({ page }) => {
    await page.goto(`file://${new URL(REFERENCE_PATH, import.meta.url).pathname}`);
    await expect(page).toHaveScreenshot('reference.png');

    // login real de teste precisa existir antes desta task rodar de
    // verdade — depende de fixture de usuário empresa, fora do escopo
    // desta Fase 1 (a task cria a estrutura, não o dado de teste).
    await page.goto('/empresa/dashboard');
    await expect(page).toHaveScreenshot('implementado.png');
  });
});
```

- [ ] **Step 3: Rodar e confirmar que o teste aparece como SKIPPED (não como falha, nem como verde falso)**

Run: `cd frontend && npx playwright test`
Expected: `1 skipped` — com o motivo do skip visível na saída.

- [ ] **Step 4: Commit**

```bash
git add frontend/playwright.config.ts frontend/e2e/dashboard-visual.spec.ts
git commit -m "test(frontend): scaffold do comparativo visual Playwright (skip até o HTML de referência chegar)"
```

---

## Self-Review desta Fase 1 (já aplicado ao escrever, registrado para o executor)

- **Cobertura da spec (Fase 1 = seção 11 da spec do usuário):** tokens ✅ (Task 2), fontes ✅ (Task 2), ícones ✅ (Task 1/5), layout casco (sidebar+header+rodapé+grade) ✅ (Tasks 5-7), imagens ✅ como placeholder rastreável (Task 4), cartão do logo ✅ (Task 5 Step 3). "Tela com blocos vazios na grade exata" ✅ (Task 7).
- **Fora desta Fase 1, de propósito:** conteúdo real dos blocos (Fase 2), dados reais/regras de cálculo (Fase 3 — depende das respostas ainda pendentes da seção 12 da spec), permissões/isolamento (Fase 4, já coberto pelo padrão RLS existente), Lighthouse/acessibilidade fina (Fase 5).
- **Placeholder scan:** nenhum "TBD"/"implementar depois" — os únicos placeholders são as 4 imagens (Task 4) e o baseline do Playwright (Task 8), ambos rastreados explicitamente com o motivo, não escondidos.
