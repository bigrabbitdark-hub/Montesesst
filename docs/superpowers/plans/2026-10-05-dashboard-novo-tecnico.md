# Dashboard novo na área do técnico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar o shell e o skin do Design System v2 para `/tecnico/*` (técnico/parceiro) e aplicar o skin no `onboarding` da empresa.

**Architecture:** `DashboardSidebar` e `DashboardHeader` passam a aceitar o menu e o link de IA por props (defaults = empresa, nada muda lá). Um novo `TecnicoShell` os compõe com o menu do técnico. O layout do técnico envolve as páginas em `<DashSkin>`, então elas herdam os tokens novos sem reescrever JSX.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind, lucide-react, vitest + Testing Library, Playwright (QA visual).

**Spec:** `docs/superpowers/specs/2026-10-05-dashboard-novo-tecnico-design.md`

## Global Constraints

- Só frontend (`frontend/src`). Sem backend, migration, Docker, Nginx, RLS ou autenticação.
- Todos os comandos rodam em `/opt/Montese/frontend`.
- **Sem `git commit`, `git push`, reset ou revert** (AGENTS.md). Onde o plano diria "commit", há um *checkpoint* só com `git status`. Nunca `git add -A`: a árvore tem WIP de outras frentes.
- **Não tocar** em `PenteFinoPanel.tsx` (nem seu teste), `app/empresa/pente-fino/`, nem nos arquivos de backend/docs já modificados.
- Defaults das props novas = comportamento atual da empresa; `shell.test.tsx`, `menu.test.ts` e `skin-paginas.test.tsx` passam **sem edição**.
- Não criar endpoint nem campo de sessão novo: o header do técnico mostra o papel, não o nome.
- Não adicionar elementos visuais sem função (pesquisa e sino do header ficam como estão; pendência registrada na spec).
- Comunicação final com os marcadores VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO; resposta em português BR.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/lib/dashboard/menu-tecnico.ts` | criar | Itens do menu do técnico (dados) |
| `src/lib/dashboard/__tests__/menu-tecnico.test.ts` | criar | Testa o menu e o item ativo |
| `src/components/dashboard/DashboardSidebar.tsx` | modificar | Props `items`, `extraItems`, `extraLabel` |
| `src/components/dashboard/DashboardHeader.tsx` | modificar | Prop `iaHref` |
| `src/components/dashboard/TecnicoShell.tsx` | criar | Sidebar + header + aviso + rodapé do técnico |
| `src/components/dashboard/__tests__/tecnico-shell.test.tsx` | criar | Testa sidebar parametrizada, header e shell |
| `src/app/tecnico/layout.tsx` | modificar | Usa `TecnicoShell` + `DashSkin` |
| `src/app/tecnico/__tests__/layout.test.tsx` | criar | Testa que o conteúdo fica dentro de `.skin-dash` |
| `src/components/TecnicoSidebar.tsx` | remover | Sem uso após o layout (conferir `grep`) |
| `src/app/empresa/onboarding/page.tsx` | modificar | Envolve a página em `<DashSkin>` |
| `src/app/empresa/__tests__/onboarding-skin.test.tsx` | criar | Testa o escopo do skin |
| `docs/operations/release-frontend-shell-empresa-2026-10-04.md` | modificar | Nova camada no plano de release |

---

### Task 1: Menu do técnico

**Files:**
- Create: `src/lib/dashboard/menu-tecnico.ts`
- Test: `src/lib/dashboard/__tests__/menu-tecnico.test.ts`

**Interfaces:**
- Consumes: `MenuItem`, `itemAtivo` de `@/lib/dashboard/menu`.
- Produces: `export const TECNICO_MENU_ITEMS: MenuItem[]` (5 itens, todos `implemented: true`).

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { itemAtivo } from '../menu';
import { TECNICO_MENU_ITEMS } from '../menu-tecnico';

describe('menu do técnico', () => {
  it('mantém as rotas existentes, na ordem do menu antigo', () => {
    expect(TECNICO_MENU_ITEMS.map((i) => [i.label, i.href])).toEqual([
      ['Suas empresas', '/tecnico/empresas'],
      ['Agenda', '/tecnico/agendamentos'],
      ['Vencimentos', '/tecnico/agenda'],
      ['Consulta de CA', '/tecnico/consulta-ca'],
      ['Configurações', '/tecnico/configuracoes'],
    ]);
    expect(TECNICO_MENU_ITEMS.every((i) => i.implemented)).toBe(true);
  });
  it('não tem hrefs duplicados nem rotas da empresa (o RoleGuard barraria)', () => {
    const hrefs = TECNICO_MENU_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs.every((h) => h.startsWith('/tecnico/'))).toBe(true);
  });
});

describe('itemAtivo com o menu do técnico', () => {
  it('subrota da empresa vinculada mantém "Suas empresas" ativo', () => {
    expect(itemAtivo('/tecnico/empresas/abc/inspecoes/1', TECNICO_MENU_ITEMS)).toBe('/tecnico/empresas');
  });
  it('Agenda e Vencimentos não se confundem (prefixo parecido)', () => {
    expect(itemAtivo('/tecnico/agendamentos', TECNICO_MENU_ITEMS)).toBe('/tecnico/agendamentos');
    expect(itemAtivo('/tecnico/agenda', TECNICO_MENU_ITEMS)).toBe('/tecnico/agenda');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/frontend && npx vitest run src/lib/dashboard/__tests__/menu-tecnico.test.ts`
Expected: FAIL (módulo `../menu-tecnico` não existe).

- [ ] **Step 3: Implementar**

```ts
import { Building2, CalendarClock, AlarmClock, Search, Settings } from 'lucide-react';
import type { MenuItem } from './menu';

// Menu do técnico/parceiro (mesmas rotas e ordem da TecnicoSidebar antiga, ícones no lugar dos emojis).
// Só rotas /tecnico/*: o RoleGuard de /empresa/* barra esses papéis.
export const TECNICO_MENU_ITEMS: MenuItem[] = [
  { href: '/tecnico/empresas', label: 'Suas empresas', icon: Building2, implemented: true },
  { href: '/tecnico/agendamentos', label: 'Agenda', icon: CalendarClock, implemented: true },
  { href: '/tecnico/agenda', label: 'Vencimentos', icon: AlarmClock, implemented: true },
  { href: '/tecnico/consulta-ca', label: 'Consulta de CA', icon: Search, implemented: true },
  { href: '/tecnico/configuracoes', label: 'Configurações', icon: Settings, implemented: true },
];
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/dashboard/__tests__/menu-tecnico.test.ts`
Expected: PASS (4 testes). Se `AlarmClock` não existir na versão do lucide (^0.460), trocar por `Clock` e repetir.

- [ ] **Step 5: Checkpoint (sem commit)**

Run: `git status --short src/lib/dashboard`
Expected: só os 2 arquivos novos desta tarefa.

---

### Task 2: Sidebar e header parametrizáveis

**Files:**
- Modify: `src/components/dashboard/DashboardSidebar.tsx` (assinatura e bloco da lista, linhas ~37-67)
- Modify: `src/components/dashboard/DashboardHeader.tsx` (props e botão IA, linhas ~4-45)
- Test: `src/components/dashboard/__tests__/tecnico-shell.test.tsx` (criado aqui, ampliado na Task 3)

**Interfaces:**
- Consumes: `TECNICO_MENU_ITEMS` (Task 1); `MENU_ITEMS`, `EXTRA_MENU_ITEMS`, `itemAtivo`.
- Produces:
  - `DashboardSidebar({ open?, onClose?, items?: MenuItem[], extraItems?: MenuItem[], extraLabel?: string })` — defaults `MENU_ITEMS`, `EXTRA_MENU_ITEMS`, `'Mais ferramentas'`. Sem `extraItems`, o rótulo da seção some.
  - `DashboardHeader({ nomeUsuario, papel, logoSrc?, menuAberto?, onMenuClick?, iaHref?: string | null })` — default `'/empresa/assistente'`; `null` esconde o botão "IA SST".

- [ ] **Step 1: Escrever o teste que falha**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let pathname = '/tecnico/empresas/abc/inspecoes/1';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));
vi.mock('@/lib/auth', () => ({ logout: vi.fn(), getToken: () => null, getUser: () => null }));

import { DashboardSidebar } from '../DashboardSidebar';
import { DashboardHeader } from '../DashboardHeader';
import { TECNICO_MENU_ITEMS } from '@/lib/dashboard/menu-tecnico';

beforeEach(() => {
  pathname = '/tecnico/empresas/abc/inspecoes/1';
  Element.prototype.scrollIntoView = vi.fn();
});

describe('DashboardSidebar parametrizada', () => {
  it('com o menu do técnico, lista só rotas /tecnico e marca "Suas empresas" em subrota', () => {
    render(<DashboardSidebar items={TECNICO_MENU_ITEMS} extraItems={[]} />);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(TECNICO_MENU_ITEMS.map((i) => i.href));
    const atual = links.filter((a) => a.getAttribute('aria-current') === 'page');
    expect(atual).toHaveLength(1);
    expect(atual[0]).toHaveTextContent('Suas empresas');
  });
  it('sem itens extras, não mostra o rótulo "Mais ferramentas"', () => {
    render(<DashboardSidebar items={TECNICO_MENU_ITEMS} extraItems={[]} />);
    expect(screen.queryByText('Mais ferramentas')).toBeNull();
  });
  it('sem props continua sendo o menu da empresa (default)', () => {
    pathname = '/empresa/documentos';
    render(<DashboardSidebar />);
    expect(screen.getByText('Mais ferramentas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Documentos/ })).toHaveAttribute('href', '/empresa/documentos');
  });
});

describe('DashboardHeader iaHref', () => {
  it('por padrão aponta o botão IA SST para o assistente da empresa', () => {
    render(<DashboardHeader nomeUsuario="Ana" papel="Empresa" />);
    expect(screen.getByRole('link', { name: /IA SST/ })).toHaveAttribute('href', '/empresa/assistente');
  });
  it('com iaHref=null não mostra o botão IA SST', () => {
    render(<DashboardHeader nomeUsuario="Técnico" papel="Montese SST" iaHref={null} />);
    expect(screen.queryByRole('link', { name: /IA SST/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/components/dashboard/__tests__/tecnico-shell.test.tsx`
Expected: FAIL (props `items`/`extraItems`/`iaHref` ignoradas: o link do menu da empresa aparece, botão IA continua).

- [ ] **Step 3: Implementar a sidebar**

Em `DashboardSidebar.tsx`, trocar a assinatura e o `ativo`:

```tsx
export function DashboardSidebar({
  open = false,
  onClose,
  items = MENU_ITEMS,
  extraItems = EXTRA_MENU_ITEMS,
  extraLabel = 'Mais ferramentas',
}: {
  open?: boolean;
  onClose?: () => void;
  items?: MenuItem[];
  extraItems?: MenuItem[];
  extraLabel?: string;
}) {
  const pathname = usePathname() ?? '';
  const ativo = itemAtivo(pathname, [...items, ...extraItems]);
```

e substituir o miolo da `<ul>` (hoje `MENU_ITEMS.map` + `<li aria-hidden …>Mais ferramentas</li>` + `EXTRA_MENU_ITEMS.map`) por:

```tsx
        {items.map((item) => (
          <NavItem key={item.label} item={item} ativo={ativo} />
        ))}
        {extraItems.length > 0 && (
          <>
            <li aria-hidden className="mt-3 px-3.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {extraLabel}
            </li>
            {extraItems.map((item) => (
              <NavItem key={item.label} item={item} ativo={ativo} />
            ))}
          </>
        )}
```

- [ ] **Step 4: Implementar o header**

Em `DashboardHeader.tsx`: adicionar `iaHref = '/empresa/assistente'` à desestruturação, `iaHref?: string | null;` ao tipo, e envolver o `<Link href="/empresa/assistente" …>IA SST</Link>` em `{iaHref && ( … )}` trocando o `href` por `{iaHref}`:

```tsx
        {iaHref && (
          <Link
            href={iaHref}
            className="flex flex-none items-center gap-2 whitespace-nowrap rounded-xl bg-dash-brand-green-light px-4 py-2.5 text-sm font-semibold text-dash-status-ok-text hover:brightness-95"
          >
            <Sparkles size={16} aria-hidden />
            IA SST
          </Link>
        )}
```

- [ ] **Step 5: Rodar e ver passar (incluindo os testes que já existiam)**

Run: `npx vitest run src/components/dashboard src/lib/dashboard`
Expected: PASS em tudo, com `shell.test.tsx`, `blocos.test.tsx` e `menu.test.ts` sem edição.

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `git status --short src/components/dashboard`
Expected: `M` em `DashboardSidebar.tsx` e `DashboardHeader.tsx`, `??` no teste novo.

---

### Task 3: TecnicoShell

**Files:**
- Create: `src/components/dashboard/TecnicoShell.tsx`
- Modify: `src/components/dashboard/__tests__/tecnico-shell.test.tsx` (acrescentar `describe`)

**Interfaces:**
- Consumes: `DashboardSidebar` e `DashboardHeader` com as props da Task 2; `TECNICO_MENU_ITEMS`; `getUser` de `@/lib/auth` (`SessionUser | null`, `role: 'empresa'|'tecnico'|'parceiro'|'admin'`); `SubscriptionNotice`; `DashboardFooter`.
- Produces: `export function TecnicoShell({ children }: { children: React.ReactNode })`.

- [ ] **Step 1: Escrever o teste que falha**

No mesmo arquivo da Task 2, trocar o mock de auth por uma versão controlável e acrescentar:

```tsx
// no topo, substituir o vi.mock('@/lib/auth', …) por:
let user: { id: string; role: string; tenantId: string | null } | null = null;
vi.mock('@/lib/auth', () => ({ logout: vi.fn(), getToken: () => null, getUser: () => user }));
vi.mock('@/components/SubscriptionNotice', () => ({ SubscriptionNotice: () => <div data-testid="aviso-assinatura" /> }));

import { fireEvent } from '@testing-library/react';
import { TecnicoShell } from '../TecnicoShell';

describe('TecnicoShell', () => {
  beforeEach(() => {
    user = { id: 'u1', role: 'tecnico', tenantId: null };
  });
  it('mostra o miolo, o aviso de assinatura e a sidebar do técnico', () => {
    render(<TecnicoShell><p>conteúdo</p></TecnicoShell>);
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
    expect(screen.getByTestId('aviso-assinatura')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Suas empresas/ })).toHaveAttribute('href', '/tecnico/empresas');
  });
  it('identifica o papel Técnico e Parceiro no header', () => {
    const { unmount } = render(<TecnicoShell>x</TecnicoShell>);
    expect(screen.getByText('Técnico')).toBeInTheDocument();
    unmount();
    user = { id: 'u2', role: 'parceiro', tenantId: null };
    render(<TecnicoShell>x</TecnicoShell>);
    expect(screen.getByText('Parceiro')).toBeInTheDocument();
  });
  it('não tem botão IA SST nem nenhum link para /empresa/*', () => {
    render(<TecnicoShell>x</TecnicoShell>);
    expect(screen.queryByRole('link', { name: /IA SST/ })).toBeNull();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.startsWith('/empresa/'))).toBe(false);
  });
  it('o botão de menu abre a gaveta (aria-expanded)', () => {
    render(<TecnicoShell>x</TecnicoShell>);
    const botao = screen.getByRole('button', { name: 'Abrir menu' });
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(botao);
    expect(botao).toHaveAttribute('aria-expanded', 'true');
  });
});
```

(`import { render, screen }` do topo passa a incluir `fireEvent`; remover o import duplicado.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/components/dashboard/__tests__/tecnico-shell.test.tsx`
Expected: FAIL (`../TecnicoShell` não existe).

- [ ] **Step 3: Implementar**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { DashboardFooter } from '@/components/DashboardFooter';
import { SubscriptionNotice } from '@/components/SubscriptionNotice';
import { TECNICO_MENU_ITEMS } from '@/lib/dashboard/menu-tecnico';
import { getUser } from '@/lib/auth';

// Casca da área do técnico/parceiro (mesmo DS v2 da empresa). A sessão não guarda o nome, então o header
// mostra o papel; o botão IA SST fica de fora porque o assistente da empresa é barrado para estes papéis.
export function TecnicoShell({ children }: { children: React.ReactNode }) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [rotulo, setRotulo] = useState('Técnico');

  useEffect(() => {
    setRotulo(getUser()?.role === 'parceiro' ? 'Parceiro' : 'Técnico');
  }, []);

  return (
    <div className="flex min-h-screen bg-dash-page font-[family-name:var(--font-body)]">
      <DashboardSidebar
        open={menuAberto}
        onClose={() => setMenuAberto(false)}
        items={TECNICO_MENU_ITEMS}
        extraItems={[]}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardHeader
          nomeUsuario={rotulo}
          papel="Montese SST"
          iaHref={null}
          menuAberto={menuAberto}
          onMenuClick={() => setMenuAberto((v) => !v)}
        />
        <main className="flex-1 overflow-x-auto">
          <SubscriptionNotice />
          {children}
        </main>
        <DashboardFooter />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/components/dashboard`
Expected: PASS.

- [ ] **Step 5: Checkpoint (sem commit)**

Run: `git status --short src/components/dashboard`
Expected: `TecnicoShell.tsx` e o teste como `??`.

---

### Task 4: Layout do técnico com shell e skin; remover a sidebar antiga

**Files:**
- Modify: `src/app/tecnico/layout.tsx` (reescrever)
- Test: `src/app/tecnico/__tests__/layout.test.tsx`
- Delete: `src/components/TecnicoSidebar.tsx`

**Interfaces:**
- Consumes: `TecnicoShell` (Task 3), `DashSkin`, `RoleGuard`, `WhatsAppButton`.
- Produces: `default export TecnicoLayout({ children })` — `RoleGuard allow={['tecnico','parceiro']}` > `TecnicoShell` > `DashSkin` > `div.mx-auto.max-w-6xl` > children.

- [ ] **Step 1: Escrever o teste que falha**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/RoleGuard', () => ({ RoleGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/dashboard/TecnicoShell', () => ({
  TecnicoShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock('@/components/WhatsAppButton', () => ({ WhatsAppButton: () => <div data-testid="whatsapp" /> }));

import TecnicoLayout from '../layout';

describe('layout do técnico', () => {
  it('põe o conteúdo dentro do shell novo e do escopo .skin-dash, com o botão do WhatsApp', () => {
    render(<TecnicoLayout><p>página</p></TecnicoLayout>);
    const pagina = screen.getByText('página');
    expect(pagina.closest('[data-testid="shell"]')).not.toBeNull();
    expect(pagina.closest('.skin-dash')).not.toBeNull();
    expect(screen.getByTestId('whatsapp')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/app/tecnico/__tests__/layout.test.tsx`
Expected: FAIL (layout atual usa `TecnicoSidebar`, sem `shell` nem `.skin-dash`).

- [ ] **Step 3: Reescrever o layout**

```tsx
import { TecnicoShell } from '@/components/dashboard/TecnicoShell';
import { DashSkin } from '@/components/dashboard/DashSkin';
import { WhatsAppButton } from '@/components/WhatsAppButton';
import { RoleGuard } from '@/components/RoleGuard';

export default function TecnicoLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allow={['tecnico', 'parceiro']}>
      <TecnicoShell>
        {/* O skin remapeia os tokens brand-* das páginas do técnico para o DS v2, sem mexer no JSX delas. */}
        <DashSkin>
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </DashSkin>
      </TecnicoShell>
      <WhatsAppButton />
    </RoleGuard>
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/app/tecnico/__tests__/layout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Remover a sidebar antiga (só se ninguém a usa)**

Run: `grep -rn "TecnicoSidebar" src`
Expected: apenas o próprio `src/components/TecnicoSidebar.tsx`. Então: `rm src/components/TecnicoSidebar.tsx` e repetir o `grep` (esperado: nenhuma linha). Se aparecer outra referência, não remover e reportar.

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `npx tsc --noEmit && git status --short src/app/tecnico src/components`
Expected: `tsc` sem erros; `M layout.tsx`, `D TecnicoSidebar.tsx`, `?? __tests__`.

---

### Task 5: Skin no onboarding da empresa

**Files:**
- Modify: `src/app/empresa/onboarding/page.tsx` (import + `return` final, linhas ~80-165)
- Test: `src/app/empresa/__tests__/onboarding-skin.test.tsx`

**Interfaces:**
- Consumes: `DashSkin` de `@/components/dashboard/DashSkin`.
- Produces: a página renderiza todo o conteúdo dentro de um único `.skin-dash`. Desvio consciente da spec: aqui o título e o miolo ficam no mesmo bloco de JSX, então o skin envolve a página toda (o `h1` com `text-brand-900` passa a usar a cor primária do DS por remapeamento).

- [ ] **Step 1: Escrever o teste que falha**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../onboarding/MatrizForm', () => ({ MatrizForm: () => <div data-testid="painel" /> }));
vi.mock('../onboarding/FiliaisForm', () => ({ FiliaisForm: () => <div /> }));
vi.mock('../onboarding/FuncionariosForm', () => ({ FuncionariosForm: () => <div /> }));
vi.mock('@/components/DocumentsPanel', () => ({ DocumentsPanel: () => <div /> }));

import Onboarding from '../onboarding/page';

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

describe('onboarding (skin)', () => {
  it('mostra o título e o formulário dentro de um único escopo .skin-dash', async () => {
    const { container } = render(<Onboarding />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Complete o cadastro da sua empresa' })).toBeInTheDocument(),
    );
    expect(screen.getByTestId('painel').closest('.skin-dash')).not.toBeNull();
    expect(container.querySelectorAll('.skin-dash')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/app/empresa/__tests__/onboarding-skin.test.tsx`
Expected: FAIL em `.closest('.skin-dash')` (null). Se falhar antes, por causa dos `fetch`/`loadAll` da página, ajustar o stub de `fetch` do teste (a página faz `/api/tenants/me` e a lista de filiais) até o `h1` aparecer, sem alterar a página.

- [ ] **Step 3: Implementar**

Em `page.tsx`: adicionar `import { DashSkin } from '@/components/dashboard/DashSkin';` junto dos imports e, no `return` final (não no de "Carregando..."), trocar a `<div className="mx-auto max-w-2xl px-4 py-16">` externa por:

```tsx
    <DashSkin>
      <div className="mx-auto max-w-2xl px-4 py-16">
        {/* …conteúdo atual, sem alteração… */}
      </div>
    </DashSkin>
```

Mexer só nisso: abrir `<DashSkin>` antes da `<div>` externa e fechar `</DashSkin>` depois do `</div>` final. O `Carregando...` pode ficar como está.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/app/empresa`
Expected: PASS, inclusive `skin-paginas.test.tsx` sem edição.

- [ ] **Step 5: Checkpoint (sem commit)**

Run: `git diff --stat src/app/empresa/onboarding/page.tsx`
Expected: poucas linhas (import + 2 de wrapper + reindentação).

---

### Task 6: Verificação completa e QA visual

**Files:**
- Modify: `docs/operations/release-frontend-shell-empresa-2026-10-04.md` (nova camada)
- Sem código de produção novo (correções de QA só se um defeito for encontrado e reportado).

**Interfaces:**
- Consumes: tudo das Tasks 1-5.
- Produces: relatório com VERIFICADO / NÃO VERIFICADO; seção nova no doc de release.

- [ ] **Step 1: Suíte, tipos, lint, build**

Run:
```bash
cd /opt/Montese/frontend
npx vitest run
npx tsc --noEmit
npx eslint src/components/dashboard src/lib/dashboard src/app/tecnico src/app/empresa/onboarding src/app/empresa/__tests__ --max-warnings=0
NODE_OPTIONS=--max-old-space-size=2048 npx next build
```
Expected: vitest todo verde (hoje 105 + os novos); `tsc` limpo; eslint 0 avisos; `next build` compila todas as rotas, 0 erro. Se algum falhar: parar, usar `superpowers:systematic-debugging`, não "consertar" por tentativa.

- [ ] **Step 2: QA visual com Playwright (API simulada)**

Seguir a memória `project_visual_qa_tooling` (versões compatíveis com Node 18 e armadilhas de screenshot). Servir o build de produção local numa porta livre (ex.: 3100), com sessão falsa (`montese_token` JWT com `exp` futuro e `montese_user` com `role: 'tecnico'`) e rotas `/api/*` interceptadas com dados simulados. Percorrer, em 1440 px e 390 px: `/tecnico/empresas`, `/tecnico/agendamentos`, `/tecnico/agenda`, `/tecnico/consulta-ca`, `/tecnico/configuracoes`, `/tecnico/empresas/ID`, `…/pente-fino`, `…/assistente`, `…/inspecoes/ID`, `…/checklist-prevencao/ID`, mais `/empresa/onboarding` com `role: 'empresa'`.
Para cada rota, registrar: sidebar nova presente e sem sidebar antiga (`bg-brand-900`/emojis); item certo ativo; 0 erros de console/JS; `document.documentElement.scrollWidth <= innerWidth` (sem overflow da página); botão de menu mobile abre a gaveta; texto legível (sem texto claro sobre fundo claro nem o inverso). Repetir 1× com `role: 'parceiro'` (header mostra "Parceiro").
Expected: tabela rota × desktop/mobile com OK ou o defeito observado. Defeito de contraste/layout ⇒ listar com screenshot, corrigir só o necessário (ajuste mínimo na página afetada) e repetir a rota.

- [ ] **Step 3: Atualizar o doc de release**

Em `docs/operations/release-frontend-shell-empresa-2026-10-04.md`, acrescentar após a seção 0 uma seção "Camada 4 — shell do técnico e skin do onboarding (2026-10-05)" com: arquivos tocados (tabela da File Structure), resultados do Step 1 e do Step 2 com os marcadores, e a nota "**Não commitado**: a árvore mistura outras frentes; commitar só estes arquivos". Não alterar mais nada do doc. Não executar nenhum passo 🔒.

- [ ] **Step 4: Checkpoint final (sem commit)**

Run: `git status --short`
Expected: os arquivos desta frente (ver File Structure) mais o WIP alheio que já existia no início (listado no `gitStatus` da sessão), sem nenhum arquivo inesperado. Reportar ao proprietário e **parar**: commit e release são dele.

---

## Self-Review

- **Cobertura da spec:** menu do técnico (T1), sidebar/header parametrizados (T2), `TecnicoShell` (T3), layout + skin + remoção da sidebar antiga (T4), onboarding (T5), verificação + QA + doc de release (T6). Fora do escopo respeitado (admin, site, `pente-fino`, `PenteFinoPanel`). Sem commit/deploy.
- **Placeholders:** nenhum. O único ponto condicional (ícone `AlarmClock` e stub de `fetch`) tem ação explícita no próprio passo.
- **Consistência de tipos:** `items`/`extraItems`/`extraLabel` (T2) são as mesmas props usadas em T2 e T3; `iaHref: string | null` idem; `TECNICO_MENU_ITEMS` (T1) usado em T2 e T3; `TecnicoShell({ children })` (T3) é o que o teste de T4 mocka.
- **Desvios da spec, declarados:** (1) header do técnico usa `nomeUsuario` = "Técnico"/"Parceiro" e `papel` = "Montese SST" (evita "Técnico / Técnico" repetido); (2) no onboarding o skin envolve a página toda, não só o miolo (T5).
