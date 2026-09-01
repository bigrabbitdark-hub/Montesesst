# Fase 12b-1 — Fundação de Navegação: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sidebar reorganizada com grupos (empresa e admin) + sidebar nova pro técnico (hoje não tem nenhuma) + logout de verdade (não existe em lugar nenhum hoje).

**Architecture:** Um utilitário novo e pequeno (`frontend/src/lib/auth.ts`) centraliza leitura de token/usuário e logout — usado pelas 3 sidebars, sem tocar nas ~50 páginas existentes que já leem `localStorage` diretamente (fora de escopo, risco desnecessário). As duas sidebars existentes (`EmpresaSidebar`, `AdminSidebar`) ganham agrupamento visual sobre os MESMOS links que já têm hoje — nenhuma rota nova nesta fase. Uma sidebar nova (`TecnicoSidebar`) cobre as 3 rotas que o técnico já tem (`/tecnico/empresas`, `/tecnico/agenda`, `/tecnico/assistente`).

**Tech Stack:** Next.js (App Router) + React + Tailwind (classes já em uso no projeto). Sem lib de ícones nova — o projeto não tem nenhuma hoje (`frontend/package.json` confirmado sem `lucide-react`/`heroicons`/etc.) e o tom visual já estabelecido usa emoji simples (`🟢`/`⚠️`/`📅` no dashboard atual) — mantido aqui pelo mesmo motivo, zero dependência nova pra um risco de baixo retorno.

**Spec:** [`docs/specs/fase-12-central-cipa-nucleo.md`](../specs/fase-12-central-cipa-nucleo.md) seção 2 (fundação de navegação — sidebar unificada + logout, motivo de entrar cedo: pré-requisito direto pra CIPA aparecer na interface na Fase 12b-2).

## Global Constraints

- Sem lib de ícones nova — usar emoji, mesmo tom do dashboard atual.
- Não recriar nem reescrever as ~50 páginas que já leem `localStorage.getItem('montese_token')` diretamente — só as 3 sidebars e o novo `lib/auth.ts` usam o utilitário centralizado nesta fase.
- Sem rota nova nesta fase — só reorganização visual sobre rotas que já existem (exceção: `TecnicoSidebar` linka pras 3 rotas que o técnico já tem, nenhuma delas é criada aqui).
- Logout: limpa `montese_token`/`montese_user` do `localStorage` e redireciona pra `/` (página inicial pública) — mesmo fluxo descrito na spec seção 15 do PDF original.
- Grupos da sidebar da empresa (Global Constraint da spec, seção "Nova organização do menu lateral" do PDF original, adaptada às rotas reais que já existem): **Visão Geral** (Início/Dashboard), **Segurança** (Documentos, EPIs, Inspeções, Assistente), **Conta** (Dados da empresa, Sair). O grupo **CIPA** entra na Fase 12b-2, quando as páginas existirem — não criar aqui pra não deixar link morto.

---

## Task 1: `lib/auth.ts` — utilitário centralizado de sessão

**Files:**
- Create: `frontend/src/lib/auth.ts`

**Interfaces:**
- Produces: `getToken(): string | null`, `getUser(): { id: string; role: string; tenantId: string | null } | null`, `logout(): void` — exportadas de `frontend/src/lib/auth.ts`.
- Consumes: nada de tasks anteriores (primeira task da fase).

**Nota de ambiente:** `frontend/package.json` confirmado sem nenhum test runner (sem `jest`, `vitest`, `@testing-library/*` — só `next`/`react`/`typescript`/Tailwind nas deps). Este projeto frontend não tem suíte automatizada hoje. Verificação desta task é manual no navegador (Step 2), documentada no relatório — não é um desvio, é o estado real do projeto.

- [ ] **Step 1: Implementar `lib/auth.ts`**

Criar `frontend/src/lib/auth.ts`:

```ts
export interface SessionUser {
  id: string;
  role: 'empresa' | 'tecnico' | 'parceiro' | 'admin';
  tenantId: string | null;
}

// Único ponto de leitura/escrita de sessão pra código NOVO (sidebars,
// páginas da Fase 12b) — as páginas já existentes continuam lendo
// localStorage diretamente (ver Global Constraints do plano, não
// refatorado nesta fase, fora de escopo).
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('montese_token');
}

export function getUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('montese_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function logout(): void {
  localStorage.removeItem('montese_token');
  localStorage.removeItem('montese_user');
  window.location.href = '/';
}
```

- [ ] **Step 2: Verificar manualmente no navegador**

Subir o frontend (`docker compose up -d frontend`, ou o fluxo de dev já usado no projeto) e, no console do navegador (em qualquer página já carregada do app), rodar:
```js
localStorage.setItem('montese_token', 'abc123');
localStorage.setItem('montese_user', JSON.stringify({ id: '1', role: 'empresa', tenantId: 't1' }));
```
Depois, numa página que já importe `getToken`/`getUser` (ou temporariamente adicionando um `console.log(getToken(), getUser())` em qualquer componente client montado, revertido depois do teste), confirmar que `getToken()` retorna `'abc123'` e `getUser()` retorna `{ id: '1', role: 'empresa', tenantId: 't1' }`. Rodar `localStorage.clear()` e confirmar que ambos voltam a `null`. Documentar esse passo no relatório (não há teste automatizado — ver nota de ambiente acima).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/auth.ts
# adicionar frontend/src/lib/auth.test.ts se criado
git commit -m "feat: utilitário centralizado de sessão (getToken/getUser/logout)"
```

---

## Task 2: Sidebar da empresa — grupos + logout

**Files:**
- Modify: `frontend/src/components/EmpresaSidebar.tsx`

**Interfaces:**
- Consumes: `logout` de `frontend/src/lib/auth.ts` (Task 1).

- [ ] **Step 1: Reescrever `EmpresaSidebar.tsx` com grupos e botão de sair**

Modificar `frontend/src/components/EmpresaSidebar.tsx` — substituir o arquivo inteiro:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/lib/auth';

interface NavGroup {
  label: string;
  links: { href: string; label: string; emoji: string }[];
}

const GROUPS: NavGroup[] = [
  {
    label: 'Visão Geral',
    links: [{ href: '/empresa/dashboard', label: 'Início', emoji: '🏠' }],
  },
  {
    label: 'Segurança',
    links: [
      { href: '/empresa/assistente', label: 'Assistente', emoji: '💬' },
      { href: '/empresa/documentos', label: 'Documentos', emoji: '📄' },
      { href: '/empresa/epis', label: 'EPIs', emoji: '🦺' },
      { href: '/empresa/inspecoes', label: 'Inspeções', emoji: '📋' },
    ],
  },
  {
    label: 'Conta',
    links: [{ href: '/empresa/onboarding', label: 'Dados da empresa', emoji: '🏢' }],
  },
];

export function EmpresaSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-brand-100 px-4 py-10">
      <h1 className="px-2 text-lg font-bold text-brand-900">Montese SST</h1>
      <nav className="mt-6 flex flex-1 flex-col gap-5">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 text-xs font-bold uppercase tracking-wide text-brand-400">{group.label}</p>
            <div className="mt-1 flex flex-col gap-1">
              {group.links.map((link) => {
                const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={
                      isActive
                        ? 'flex items-center gap-2 rounded-md bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900'
                        : 'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-brand-700 hover:bg-brand-50 hover:text-brand-900'
                    }
                  >
                    <span aria-hidden="true">{link.emoji}</span>
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <button
        onClick={logout}
        className="mt-6 flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-brand-700 hover:bg-brand-50 hover:text-brand-900"
      >
        <span aria-hidden="true">🚪</span>
        Sair
      </button>
    </aside>
  );
}
```

- [ ] **Step 2: Verificar manualmente no navegador**

Run: subir o frontend (dev server), logar como usuário `empresa` real (ou fixture de teste já existente no seed), navegar por `/empresa/dashboard`.
Expected: sidebar mostra 3 grupos com cabeçalho ("Visão Geral", "Segurança", "Conta"), item ativo destacado corretamente ao navegar entre páginas, clicar em "Sair" limpa a sessão e redireciona pra `/`. Confirmar no DevTools (Application → Local Storage) que `montese_token`/`montese_user` somem depois do clique.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/EmpresaSidebar.tsx
git commit -m "feat: sidebar da empresa com grupos e logout"
```

---

## Task 3: Sidebar do admin — grupos + logout

**Files:**
- Modify: `frontend/src/components/AdminSidebar.tsx`

**Interfaces:**
- Consumes: `logout` de `frontend/src/lib/auth.ts` (Task 1).

- [ ] **Step 1: Reescrever `AdminSidebar.tsx` com grupos e botão de sair**

Modificar `frontend/src/components/AdminSidebar.tsx` — substituir o arquivo inteiro:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/lib/auth';

interface NavGroup {
  label: string;
  links: { href: string; label: string; emoji: string }[];
}

const GROUPS: NavGroup[] = [
  {
    label: 'Visão Geral',
    links: [{ href: '/admin/overview', label: 'Visão Geral', emoji: '📊' }],
  },
  {
    label: 'Gestão',
    links: [
      { href: '/admin/empresas', label: 'Empresas', emoji: '🏢' },
      { href: '/admin/tecnicos', label: 'Técnicos', emoji: '👷' },
      { href: '/admin/parceiros', label: 'Parceiros', emoji: '🤝' },
    ],
  },
  {
    label: 'Sistema',
    links: [
      { href: '/admin/normativa', label: 'Base normativa', emoji: '📚' },
      { href: '/admin/auditoria', label: 'Auditoria', emoji: '🔍' },
      { href: '/admin/financeiro', label: 'Financeiro', emoji: '💳' },
    ],
  },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-brand-100 px-4 py-10">
      <h1 className="px-2 text-lg font-bold text-brand-900">Painel administrativo</h1>
      <nav className="mt-6 flex flex-1 flex-col gap-5">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 text-xs font-bold uppercase tracking-wide text-brand-400">{group.label}</p>
            <div className="mt-1 flex flex-col gap-1">
              {group.links.map((link) => {
                const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={
                      isActive
                        ? 'flex items-center gap-2 rounded-md bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900'
                        : 'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-brand-700 hover:bg-brand-50 hover:text-brand-900'
                    }
                  >
                    <span aria-hidden="true">{link.emoji}</span>
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <button
        onClick={logout}
        className="mt-6 flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-brand-700 hover:bg-brand-50 hover:text-brand-900"
      >
        <span aria-hidden="true">🚪</span>
        Sair
      </button>
    </aside>
  );
}
```

- [ ] **Step 2: Verificar manualmente no navegador**

Run: logar como `admin`, navegar por `/admin/overview`.
Expected: mesma verificação da Task 2 — grupos visíveis, item ativo destacado, logout funcional.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AdminSidebar.tsx
git commit -m "feat: sidebar do admin com grupos e logout"
```

---

## Task 4: Sidebar do técnico (nova) + logout

**Files:**
- Create: `frontend/src/components/TecnicoSidebar.tsx`
- Modify: `frontend/src/app/tecnico/layout.tsx`

**Interfaces:**
- Consumes: `logout` de `frontend/src/lib/auth.ts` (Task 1).

- [ ] **Step 1: Criar `TecnicoSidebar.tsx`**

Criar `frontend/src/components/TecnicoSidebar.tsx` — mesmo padrão das outras duas, mas técnico não tinha NENHUMA sidebar antes (navegação só por link solto dentro de cada página, conforme diagnóstico da spec):

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/lib/auth';

interface NavGroup {
  label: string;
  links: { href: string; label: string; emoji: string }[];
}

const GROUPS: NavGroup[] = [
  {
    label: 'Carteira',
    links: [{ href: '/tecnico/empresas', label: 'Suas empresas', emoji: '🏢' }],
  },
  {
    label: 'Trabalho',
    links: [
      { href: '/tecnico/agenda', label: 'Agenda', emoji: '📅' },
      { href: '/tecnico/assistente', label: 'Assistente', emoji: '💬' },
    ],
  },
];

export function TecnicoSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-brand-100 px-4 py-10">
      <h1 className="px-2 text-lg font-bold text-brand-900">Montese SST</h1>
      <nav className="mt-6 flex flex-1 flex-col gap-5">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 text-xs font-bold uppercase tracking-wide text-brand-400">{group.label}</p>
            <div className="mt-1 flex flex-col gap-1">
              {group.links.map((link) => {
                const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={
                      isActive
                        ? 'flex items-center gap-2 rounded-md bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900'
                        : 'flex items-center gap-2 rounded-md px-3 py-2 text-sm text-brand-700 hover:bg-brand-50 hover:text-brand-900'
                    }
                  >
                    <span aria-hidden="true">{link.emoji}</span>
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <button
        onClick={logout}
        className="mt-6 flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-brand-700 hover:bg-brand-50 hover:text-brand-900"
      >
        <span aria-hidden="true">🚪</span>
        Sair
      </button>
    </aside>
  );
}
```

- [ ] **Step 2: Renderizar a sidebar no layout do técnico**

Modificar `frontend/src/app/tecnico/layout.tsx` — substituir o arquivo inteiro (mesmo padrão de composição de `frontend/src/app/empresa/layout.tsx`, que já envolve `EmpresaSidebar` + `main` + rodapé + botão de WhatsApp):

```tsx
import { TecnicoSidebar } from '@/components/TecnicoSidebar';
import { DashboardFooter } from '@/components/DashboardFooter';
import { WhatsAppButton } from '@/components/WhatsAppButton';

export default function TecnicoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1">
        <TecnicoSidebar />
        <main className="flex-1">{children}</main>
      </div>
      <DashboardFooter />
      <WhatsAppButton />
    </div>
  );
}
```

- [ ] **Step 3: Verificar manualmente no navegador**

Run: logar como `tecnico` (ou `parceiro`), navegar por `/tecnico/empresas`, `/tecnico/agenda`, `/tecnico/assistente`.
Expected: sidebar nova aparece em todas as páginas do técnico (antes não tinha nenhuma), navegação funciona, item ativo destacado, logout funcional. Confirmar que o layout não quebrou nada visualmente nas 3 páginas existentes (elas ficam com menos largura disponível agora que há uma sidebar — checar que não há overflow horizontal ou quebra de layout).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TecnicoSidebar.tsx frontend/src/app/tecnico/layout.tsx
git commit -m "feat: primeira sidebar do técnico + logout"
```

---

## Depois da última task

1. Rodar build de produção do frontend (`docker compose build frontend`) pra confirmar que não há erro de TypeScript/lint nas 3 sidebars novas/modificadas.
2. Fazer uma passada visual final nas 3 áreas autenticadas (empresa/admin/técnico) no navegador, confirmando que nada quebrou nas páginas existentes por causa da mudança de sidebar.
3. Seguir com `superpowers:finishing-a-development-branch` — mesmo fluxo das fases anteriores (branch é `main` direto, sem remote configurado — o "finish" aqui é só confirmar e reportar, sem menu de merge/PR).
4. Próximo passo da frente maior: `docs/plans/fase-12b2-central-cipa-telas.md` (calendário/wizard, reuniões/ata, membros, pendências, dashboard da CIPA) — essa sim adiciona o grupo "CIPA" nesta sidebar, quando as páginas existirem.
