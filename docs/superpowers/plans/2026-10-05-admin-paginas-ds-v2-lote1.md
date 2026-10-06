# Admin DS v2 — Lote 1 (primitivos + empresas, auditoria, financeiro) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar os primitivos visuais do admin (`.adm-input`, `.adm-btn`, `.adm-btn-primary`, `.adm-table`, `.adm-link`, `AdminPageHeader`, tons de status) e aplicá-los às páginas `/admin/empresas`, `/admin/auditoria` e `/admin/financeiro`, sem mudar conteúdo, dados nem comportamento.

**Architecture:** Classes CSS por nome em `admin-theme.css` (nunca seletores genéricos), um componente `AdminPageHeader`, e um módulo `status-tone.ts` que mapeia só status confirmados no código para o `Badge` existente. Cada página troca cabeçalho, blocos (`Card`/`.adm-card`), campos, botões, tabelas e status solto; handlers, `fetch`, estados e textos ficam intactos. Os lotes 2 e 3 (outras 5 páginas) terão planos próprios e reutilizam estes primitivos.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind v4 (tokens `--color-adm-*` em `globals.css`), vitest + Testing Library, Playwright (QA visual).

**Spec:** `docs/superpowers/specs/2026-10-05-admin-paginas-ds-v2-design.md`

## Global Constraints

- Só frontend (`frontend/src`) e docs. Sem backend, migration, Docker, Nginx, RBAC, RLS ou endpoints novos. **Tema escuro mantido.**
- Todos os comandos rodam em `/opt/Montese/frontend`.
- **Sem `git commit`, `push`, `add`, `reset`, `revert`, `stash`** (AGENTS.md). Onde o skill diria "commit", faça só `git status --short <caminho>`. A árvore tem WIP de outras frentes: nunca `git add -A`, nunca tocar em `PenteFinoPanel*`, `backend/`.
- `admin-theme.css` **não usa `@layer`**: as classes `.adm-*` vencem utilitários Tailwind na mesma propriedade. **Nunca** combine `adm-card`, `adm-card-2`, `adm-input`, `adm-btn`, `adm-btn-primary` ou `adm-table` com utilitários `rounded*`, `bg-*` ou `border*` no mesmo elemento (utilitários de largura, margem, padding, `flex`, `text-*`, `disabled:*` são permitidos).
- `.adm-table` **não define cor de célula** (`td`): as páginas continuam usando `text-brand-900`/`text-brand-700` nas células.
- Conteúdo, textos visíveis, ordem dos elementos, handlers, `fetch`, estados e a lógica **não mudam**. Único desvio visual aceito: status solto vira `Badge` mostrando **o mesmo texto original** (sem parênteses), e o tom só vem de `status-tone.ts`.
- Não editar `Card.tsx`, `AdminShell`, sidebar, topbar nem testes existentes, exceto o acréscimo ao final de `admin-theme-contraste.test.ts` (Task 1).
- Comentários em PT-BR, curtos, no estilo do código vizinho.
- Resposta final aos humanos em PT-BR com VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/app/admin/admin-theme.css` | modificar | Tokens `--admin-field-border`, `--admin-on-accent` e classes `.adm-input/.adm-btn/.adm-btn-primary/.adm-table/.adm-link` |
| `src/app/admin/__tests__/admin-theme-contraste.test.ts` | modificar (só acrescentar) | Contraste e existência dos primitivos |
| `src/components/admin/PageHeader.tsx` | criar | `AdminPageHeader` (h2 + descrição + ações) |
| `src/components/admin/status-tone.ts` | criar | `subscriptionTone`, `httpStatusTone` |
| `src/components/admin/__tests__/status-tone.test.ts` | criar | Testa os mapeamentos |
| `src/app/admin/__tests__/convencoes-paginas.test.ts` | criar | Falha se houver padrão antigo ou colisão `.adm-*` × utilitários |
| `src/app/admin/empresas/page.tsx` | modificar | Aplica primitivos |
| `src/app/admin/__tests__/empresas-page.test.tsx` | criar | Render da página |
| `src/app/admin/auditoria/page.tsx` | modificar | Aplica primitivos |
| `src/app/admin/__tests__/auditoria-page.test.tsx` | criar | Render da página |
| `src/app/admin/financeiro/page.tsx` | modificar | Aplica primitivos |
| `src/app/admin/__tests__/financeiro-page.test.tsx` | criar | Render + corpo do PATCH de preço |
| `docs/operations/release-frontend-shell-empresa-2026-10-04.md` | modificar | Nova camada (Task 6) |

---

### Task 1: Primitivos CSS e testes de contraste

**Files:**
- Modify: `src/app/admin/admin-theme.css` (bloco `.admin-theme { … }` e depois de `.adm-text-faint`)
- Modify: `src/app/admin/__tests__/admin-theme-contraste.test.ts` (acrescentar ao final)

**Interfaces:**
- Consumes: tokens existentes `--admin-bg`, `--admin-surface`, `--admin-surface-2`, `--admin-border`, `--admin-text`, `--admin-muted`, `--admin-faint`, `--color-adm-brand`, `--color-adm-brand-strong`, `--color-brand-500` (remapeado em `.admin-theme`).
- Produces: tokens `--admin-field-border: #5b7094` e `--admin-on-accent: #04210f`; classes `.adm-input`, `.adm-btn`, `.adm-btn-primary` (usar junto de `.adm-btn`), `.adm-table`, `.adm-link` — todas sob `.admin-theme`.

- [ ] **Step 1: Escrever os testes que falham** — acrescentar ao **final** de `admin-theme-contraste.test.ts` (reaproveita `valor`, `rgb`, `contraste`, `adm`, `tok`, `SUPERFICIES`, `admin`):

```ts
describe('primitivos .adm-* do admin (lote 1)', () => {
  const bg = rgb(SUPERFICIES.bg);
  const surface = rgb(SUPERFICIES.surface);

  it.each(['adm-input', 'adm-btn', 'adm-btn-primary', 'adm-table', 'adm-link'])('define .admin-theme .%s', (classe) => {
    expect(admin).toMatch(new RegExp(`\\.admin-theme \\.${classe}\\b`));
  });

  it('borda de campo ≥ 3:1 sobre o fundo da página e sobre a superfície', () => {
    const borda = rgb(adm('field-border'));
    expect(contraste(borda, bg)).toBeGreaterThanOrEqual(3);
    expect(contraste(borda, surface)).toBeGreaterThanOrEqual(3);
  });

  it('texto do botão primário ≥ 4,5:1 sobre o verde da marca e sobre a versão forte (hover)', () => {
    const texto = rgb(adm('on-accent'));
    expect(contraste(texto, rgb(tok('brand')))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(texto, rgb(tok('brand-strong')))).toBeGreaterThanOrEqual(4.5);
  });

  it('verde da marca (links .adm-link) ≥ 4,5:1 sobre a superfície e sobre o fundo', () => {
    expect(contraste(rgb(tok('brand')), surface)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(rgb(tok('brand')), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('brand-500 remapeado (ações antigas ainda em texto) ≥ 4,5:1 sobre a superfície e sobre o fundo', () => {
    const verde = rgb(valor(admin, 'color-brand-500'));
    expect(contraste(verde, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(verde, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/frontend && npx vitest run src/app/admin/__tests__/admin-theme-contraste.test.ts`
Expected: FAIL (classes ausentes; `token --admin-field-border ausente`).

- [ ] **Step 3: Implementar — tokens**

Em `admin-theme.css`, logo depois da linha `--admin-accent-hover: #3bb56c;` acrescentar:

```css
  --admin-field-border: #5b7094; /* borda de campo: ≥ 3:1 sobre o fundo e a superfície */
  --admin-on-accent: #04210f; /* texto sobre o verde da marca (botão primário) */
```

- [ ] **Step 4: Implementar — classes**

Em `admin-theme.css`, logo depois do bloco `.admin-theme .adm-text-faint { … }`, acrescentar:

```css
/* Primitivos do admin (DS v2). Por classe, nunca por seletor de tag. Fora de @layer: não combinar
 * com rounded/bg/border do Tailwind no mesmo elemento. */
.admin-theme .adm-input {
  background: var(--admin-bg);
  border: 1px solid var(--admin-field-border);
  border-radius: 0.75rem; /* 12px */
  color: var(--admin-text);
  padding: 0.5rem 0.75rem;
}
.admin-theme .adm-input::placeholder {
  color: var(--admin-faint);
}

.admin-theme .adm-btn {
  background: transparent;
  border: 1px solid var(--admin-border);
  border-radius: 0.75rem;
  color: var(--admin-text);
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  padding: 0.5rem 1rem;
}
.admin-theme .adm-btn:hover:not(:disabled) {
  background: var(--admin-surface-2);
}
.admin-theme .adm-btn:disabled {
  cursor: not-allowed;
}
/* usar junto de .adm-btn */
.admin-theme .adm-btn-primary {
  background: var(--color-adm-brand);
  border-color: transparent;
  color: var(--admin-on-accent);
}
.admin-theme .adm-btn-primary:hover:not(:disabled) {
  background: var(--color-adm-brand-strong);
}

/* Tabela: não define cor de célula (td) — as páginas usam text-brand-900/700 nas células. */
.admin-theme .adm-table {
  border-collapse: collapse;
  font-size: 0.875rem;
  text-align: left;
  width: 100%;
}
.admin-theme .adm-table thead th {
  border-bottom: 1px solid var(--admin-border);
  color: var(--admin-muted);
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.625rem 0.75rem;
}
.admin-theme .adm-table tbody td {
  border-bottom: 1px solid var(--admin-border);
  padding: 0.625rem 0.75rem;
}
.admin-theme .adm-table tbody tr:last-child td {
  border-bottom: 0;
}
.admin-theme .adm-table tbody tr:hover {
  background: color-mix(in srgb, var(--admin-surface-2) 60%, transparent);
}

/* Ação em texto (botão ou link): verde da marca, sublinha no hover. */
.admin-theme .adm-link {
  background: none;
  border: 0;
  color: var(--color-adm-brand);
  cursor: pointer;
  padding: 0;
}
.admin-theme .adm-link:hover {
  text-decoration: underline;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/app/admin/__tests__/admin-theme-contraste.test.ts`
Expected: PASS (testes antigos + 9 novos). Se um contraste falhar, ajustar **só** o valor do token novo (`--admin-field-border` ou `--admin-on-accent`) e repetir; não mexer em tokens existentes.

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `git status --short src/app/admin`
Expected: `M` em `admin-theme.css` e em `admin-theme-contraste.test.ts`.

---

### Task 2: `AdminPageHeader` e tons de status

**Files:**
- Create: `src/components/admin/PageHeader.tsx`
- Create: `src/components/admin/status-tone.ts`
- Test: `src/components/admin/__tests__/status-tone.test.ts`

**Interfaces:**
- Consumes: `type Tone` de `./Card` (`'ok' | 'warn' | 'bad' | 'info' | 'neutral'`).
- Produces:
  - `AdminPageHeader({ title: string; description?: string; actions?: ReactNode })` — `h2` + `p` + ações.
  - `subscriptionTone(status: string): Tone` — `authorized`→`ok`, `paused`→`warn`, qualquer outro (inclui `cancelled`) → `neutral`.
  - `httpStatusTone(code: number): Tone` — 2xx→`ok`, 4xx→`warn`, ≥500→`bad`, resto→`neutral` (mesma semântica de cores da auditoria atual).

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, it, expect } from 'vitest';
import { httpStatusTone, subscriptionTone } from '../status-tone';

describe('subscriptionTone', () => {
  it('mapeia só os status confirmados no código (authorized, paused)', () => {
    expect(subscriptionTone('authorized')).toBe('ok');
    expect(subscriptionTone('paused')).toBe('warn');
  });
  it('cancelled e valores desconhecidos ficam neutros (não inventa semântica)', () => {
    expect(subscriptionTone('cancelled')).toBe('neutral');
    expect(subscriptionTone('qualquer-coisa')).toBe('neutral');
  });
});

describe('httpStatusTone', () => {
  it.each([
    [200, 'ok'], [201, 'ok'], [299, 'ok'],
    [400, 'warn'], [403, 'warn'], [429, 'warn'],
    [500, 'bad'], [503, 'bad'],
    [302, 'neutral'], [100, 'neutral'],
  ])('%i → %s', (codigo, tom) => {
    expect(httpStatusTone(codigo)).toBe(tom);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/components/admin/__tests__/status-tone.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `status-tone.ts`**

```ts
import type { Tone } from './Card';

// Tom do Badge por status. O TEXTO do badge é sempre o valor original; aqui só se escolhe a cor, e só
// para valores cuja semântica está confirmada no código. Desconhecido = neutro.
export function subscriptionTone(status: string): Tone {
  if (status === 'authorized') return 'ok';
  if (status === 'paused') return 'warn';
  return 'neutral';
}

// Mesma faixa de cores que a página de auditoria já usava (2xx verde, 4xx amarelo, 5xx vermelho).
export function httpStatusTone(code: number): Tone {
  if (code >= 200 && code < 300) return 'ok';
  if (code >= 400 && code < 500) return 'warn';
  if (code >= 500) return 'bad';
  return 'neutral';
}
```

- [ ] **Step 4: Implementar `PageHeader.tsx`**

```tsx
import type { ReactNode } from 'react';

// Cabeçalho padrão das páginas do admin (o h1 da casca é sr-only; o título visível é este h2).
export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl font-bold text-brand-900">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-sm text-brand-700">{description}</p>}
      </div>
      {actions}
    </header>
  );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/components/admin/__tests__/status-tone.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` sem erros.

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `git status --short src/components/admin`
Expected: 3 arquivos novos (`PageHeader.tsx`, `status-tone.ts`, `__tests__/status-tone.test.ts`).

---

### Task 3: Página `/admin/empresas` + teste de convenções

**Files:**
- Modify: `src/app/admin/empresas/page.tsx`
- Create: `src/app/admin/__tests__/convencoes-paginas.test.ts`
- Create: `src/app/admin/__tests__/empresas-page.test.tsx`

**Interfaces:**
- Consumes: `AdminPageHeader`, `Badge` (de `@/components/admin/Card`), classes `.adm-card`, `.adm-table`, `.adm-link` (Task 1).
- Produces: `convencoes-paginas.test.ts` com a constante `PAGINAS` (lista de caminhos relativos a `src/app/admin`) que as Tasks 4 e 5 estendem.

- [ ] **Step 1: Escrever os testes que falham**

`src/app/admin/__tests__/convencoes-paginas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Páginas já migradas para o DS v2 do admin. Cada lote acrescenta as suas aqui.
const PAGINAS = ['empresas/page.tsx'];

const BASE = join(process.cwd(), 'src/app/admin');
// admin-theme.css fora de @layer: .adm-* não pode dividir o elemento com rounded/bg/border do Tailwind.
const COMPONENTE_ADM = /\badm-(card-2|card|input|btn-primary|btn|table)\b/;
const UTILITARIO_PROIBIDO = /(^|\s)(rounded(-\S+)?|bg-\S+|border(-\S+)?)(?=\s|$)/;

function classNames(fonte: string): string[] {
  return [...fonte.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? '');
}

describe.each(PAGINAS)('convenções do DS v2 do admin em %s', (pagina) => {
  const fonte = readFileSync(join(BASE, pagina), 'utf8');

  it('não sobra o bloco antigo (borda cinza arredondada) nem o campo antigo', () => {
    expect(fonte).not.toContain('rounded-lg border border-brand-100');
    expect(fonte).not.toContain('rounded-md border border-brand-100');
  });

  it('nenhum elemento com .adm-* usa também rounded/bg/border do Tailwind', () => {
    const colisoes = classNames(fonte).filter((c) => COMPONENTE_ADM.test(c) && UTILITARIO_PROIBIDO.test(c));
    expect(colisoes).toEqual([]);
  });
});
```

`src/app/admin/__tests__/empresas-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import AdminEmpresasPage from '../empresas/page';

const EMPRESA = {
  id: 't1',
  name: 'Acme Ltda',
  cnpj: '00.000.000/0001-00',
  plan: 'Pro',
  status: 'ativo',
  technicians: [{ id: 'x', name: 'Ana' }],
  partners: [],
};

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [EMPRESA] })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/empresas (DS v2)', () => {
  it('mostra o título, a tabela com o primitivo .adm-table dentro de um .adm-card e o link de detalhes', async () => {
    render(<AdminEmpresasPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Empresas' })).toBeInTheDocument();
    const tabela = screen.getByRole('table');
    expect(tabela).toHaveClass('adm-table');
    expect(tabela.closest('.adm-card')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Ver detalhes' })).toHaveAttribute('href', '/admin/empresas/t1');
    expect(screen.getByRole('link', { name: 'Ver detalhes' })).toHaveClass('adm-link');
  });

  it('o status aparece num Badge com o texto original, e os demais dados continuam na tabela', async () => {
    render(<AdminEmpresasPage />);
    const status = await screen.findByText('ativo');
    expect(status).toHaveClass('rounded-full');
    expect(screen.getByText('Acme Ltda')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('00.000.000/0001-00')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/empresas-page.test.tsx`
Expected: FAIL (a página ainda tem `rounded-md border…`? — no mínimo `adm-table`/`Badge` ausentes).

- [ ] **Step 3: Implementar — imports**

Em `empresas/page.tsx`, acrescentar depois de `import Link from 'next/link';`:

```tsx
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/admin/Card';
```

- [ ] **Step 4: Implementar — o `return` final**

Substituir **todo o `return ( … );` final** (o que começa em `return (\n    <div>\n      <h2 className="text-xl font-bold text-brand-900">Empresas</h2>`) por:

```tsx
  return (
    <div>
      <AdminPageHeader title="Empresas" />
      <div className="mt-6">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {tenants.length === 0 && !error ? (
          <p className="text-sm text-brand-700">Nenhuma empresa cadastrada ainda.</p>
        ) : (
          <div className="adm-card overflow-x-auto p-2 sm:p-4">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>CNPJ</th>
                  <th>Plano</th>
                  <th>Status</th>
                  <th>Técnicos</th>
                  <th>Parceiros</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tenant) => (
                  <tr key={tenant.id}>
                    <td className="font-medium text-brand-900">{tenant.name}</td>
                    <td className="text-brand-700">{tenant.cnpj}</td>
                    <td className="text-brand-700">{tenant.plan}</td>
                    <td>
                      <Badge tone="neutral">{tenant.status}</Badge>
                    </td>
                    <td className="text-brand-700">
                      {tenant.technicians.length === 0
                        ? '—'
                        : tenant.technicians.map((t) => t.name).join(', ')}
                    </td>
                    <td className="text-brand-700">
                      {tenant.partners.length === 0
                        ? '—'
                        : tenant.partners.map((p) => p.name).join(', ')}
                    </td>
                    <td>
                      <Link href={`/admin/empresas/${tenant.id}`} className="adm-link">
                        Ver detalhes
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
```

(O status de empresa fica `neutral`: os valores possíveis não estão confirmados nesta página. O `if (!ready) …` acima do `return` não muda.)

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/empresas-page.test.tsx && npx tsc --noEmit`
Expected: PASS (4 testes de convenção + 2 de render); `tsc` limpo.

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `git diff --stat src/app/admin/empresas/page.tsx && git status --short src/app/admin/__tests__`
Expected: só `empresas/page.tsx` modificado; 2 testes novos.

---

### Task 4: Página `/admin/auditoria`

**Files:**
- Modify: `src/app/admin/auditoria/page.tsx`
- Modify: `src/app/admin/__tests__/convencoes-paginas.test.ts` (acrescentar a página à lista)
- Create: `src/app/admin/__tests__/auditoria-page.test.tsx`

**Interfaces:**
- Consumes: `AdminPageHeader`, `Badge`, `httpStatusTone`, classes `.adm-card`, `.adm-card-2`, `.adm-input`, `.adm-btn`, `.adm-btn-primary`, `.adm-table`.
- Produces: nada novo.

- [ ] **Step 1: Escrever os testes que falham**

Em `convencoes-paginas.test.ts` trocar a linha de `PAGINAS` por:

```ts
const PAGINAS = ['empresas/page.tsx', 'auditoria/page.tsx'];
```

`src/app/admin/__tests__/auditoria-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import AdminAuditoriaPage from '../auditoria/page';

const LINHA = {
  id: '1',
  occurred_at: '2026-10-05T12:00:00Z',
  actor_full_name: 'Ana',
  actor_role: 'admin',
  actor_tenant_name: null,
  action: 'login',
  resource_type: 'users',
  resource_id: null,
  method: 'GET',
  path: '/x',
  status_code: 200,
};

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [LINHA] })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/auditoria (DS v2)', () => {
  it('mostra o título e a descrição, com o filtro usando os primitivos de campo e botão', async () => {
    render(<AdminAuditoriaPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Auditoria' })).toBeInTheDocument();
    expect(screen.getByText(/Registro de ações realizadas no sistema/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ex: technicians/)).toHaveClass('adm-input');
    const filtrar = screen.getByRole('button', { name: 'Filtrar' });
    expect(filtrar).toHaveClass('adm-btn');
    expect(filtrar).toHaveClass('adm-btn-primary');
  });

  it('a tabela usa .adm-table dentro de um .adm-card', async () => {
    render(<AdminAuditoriaPage />);
    const tabela = await screen.findByRole('table');
    expect(tabela).toHaveClass('adm-table');
    expect(tabela.closest('.adm-card')).not.toBeNull();
  });

  it('o status HTTP vira Badge verde (2xx) mantendo o texto "GET 200" e o title explicativo', async () => {
    render(<AdminAuditoriaPage />);
    const rotulo = await screen.findByTitle('Sucesso');
    expect(rotulo).toHaveTextContent('GET 200');
    const badge = rotulo.closest('span.rounded-full');
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain('text-adm-status-ok-text');
  });

  it('a legenda dos códigos continua visível e usa os tokens de status', async () => {
    render(<AdminAuditoriaPage />);
    const legenda = await screen.findByText('200/201');
    expect(legenda.className).toContain('text-adm-status-ok-text');
    expect(screen.getByText('400/401/403/404').className).toContain('text-adm-status-warn-text');
    expect(screen.getByText('500/502/503').className).toContain('text-adm-status-crit-text');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/auditoria-page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar — imports e helper**

Em `auditoria/page.tsx`, acrescentar depois de `import { useRouter } from 'next/navigation';`:

```tsx
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Badge } from '@/components/admin/Card';
import { httpStatusTone } from '@/components/admin/status-tone';
```

**Apagar** a função `statusColorClass` inteira (a que devolve `'text-green-700'` etc.); o tom agora vem de `httpStatusTone`. Manter `statusLabel` e `STATUS_LABELS`.

- [ ] **Step 4: Implementar — o `return` final**

Substituir o `return ( … );` final (de `<div>\n      <h2 className="text-xl font-bold text-brand-900">Auditoria</h2>` até o fim) por:

```tsx
  return (
    <div>
      <AdminPageHeader
        title="Auditoria"
        description={`Registro de ações realizadas no sistema — quem fez o quê, quando, e o resultado (coluna "Status"). Passe o mouse sobre o número do status pra ver o que significa em termos simples.`}
      />

      <form onSubmit={handleFilterSubmit} className="mt-6 flex items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-brand-900">
          Filtrar por tipo de recurso
          <input
            value={resourceTypeFilter}
            onChange={(e) => setResourceTypeFilter(e.target.value)}
            placeholder="ex: technicians, documents, inspections"
            className="adm-input w-full min-w-0"
          />
        </label>
        <button type="submit" className="adm-btn adm-btn-primary">
          Filtrar
        </button>
        {appliedFilter && (
          <button
            type="button"
            onClick={() => {
              setResourceTypeFilter('');
              setAppliedFilter('');
              loadPage(0, '', false);
            }}
            className="adm-btn"
          >
            Limpar
          </button>
        )}
      </form>

      <div className="mt-8">
        {listError && <p className="text-sm text-red-600">{listError}</p>}
        {rows.length === 0 && !listError ? (
          <p className="text-sm text-brand-700">Nenhum evento de auditoria encontrado.</p>
        ) : (
          <div className="adm-card overflow-x-auto p-2 sm:p-4">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>Empresa</th>
                  <th>Ação</th>
                  <th>Recurso</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="text-brand-700">{formatDateTime(row.occurred_at)}</td>
                    <td className="text-brand-700">
                      {row.actor_full_name ?? '—'} {row.actor_role ? `(${row.actor_role})` : ''}
                    </td>
                    <td className="text-brand-700">{row.actor_tenant_name ?? '—'}</td>
                    <td className="text-brand-900">{row.action}</td>
                    <td className="text-brand-700">{row.resource_type}</td>
                    <td>
                      <Badge tone={httpStatusTone(row.status_code)}>
                        <span title={statusLabel(row.status_code)}>
                          {row.method} {row.status_code}
                        </span>
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && (
          <div className="adm-card-2 mt-4 flex flex-wrap gap-x-6 gap-y-1 p-3 text-xs text-brand-700">
            <span>
              <strong className="text-adm-status-ok-text">200/201</strong> — deu certo
            </span>
            <span>
              <strong className="text-adm-status-warn-text">400/401/403/404</strong> — algo no pedido não foi
              aceito (dado errado, sem permissão, ou não existe)
            </span>
            <span>
              <strong className="text-adm-status-warn-text">429</strong> — muitas tentativas seguidas, bloqueado
              temporariamente
            </span>
            <span>
              <strong className="text-adm-status-crit-text">500/502/503</strong> — erro do sistema, não do usuário
            </span>
          </div>
        )}
        {hasMore && rows.length > 0 && (
          <button
            onClick={() => loadPage(offset, appliedFilter, true)}
            disabled={loadingMore}
            className="adm-btn mt-4 disabled:opacity-50"
          >
            {loadingMore ? 'Carregando...' : 'Carregar mais'}
          </button>
        )}
      </div>
    </div>
  );
```

(O `if (!ready) …`, o estado, `loadPage`, o filtro e o `useEffect` não mudam.)

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/auditoria-page.test.tsx && npx tsc --noEmit`
Expected: PASS; `tsc` limpo (sem uso restante de `statusColorClass`).

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `git diff --stat src/app/admin/auditoria/page.tsx`
Expected: só esse arquivo de página modificado nesta tarefa.

---

### Task 5: Página `/admin/financeiro`

**Files:**
- Modify: `src/app/admin/financeiro/page.tsx`
- Modify: `src/app/admin/__tests__/convencoes-paginas.test.ts`
- Create: `src/app/admin/__tests__/financeiro-page.test.tsx`

**Interfaces:**
- Consumes: `AdminPageHeader`, `Card`, `Badge` (de `@/components/admin/Card`), `subscriptionTone`, classes `.adm-card-2`, `.adm-input`, `.adm-table`, `.adm-link`.
- Produces: nada novo.

- [ ] **Step 1: Escrever os testes que falham**

Em `convencoes-paginas.test.ts`:

```ts
const PAGINAS = ['empresas/page.tsx', 'auditoria/page.tsx', 'financeiro/page.tsx'];
```

`src/app/admin/__tests__/financeiro-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import AdminFinanceiroPage from '../financeiro/page';

const PLANO = { id: 'p1', audience: 'empresa', slug: 'pro', name: 'Plano Pro', price_cents: 9900, employee_limit: 50 };
const ASSINATURA = {
  id: 's1',
  status: 'authorized',
  created_at: '2026-10-01T00:00:00Z',
  plan_name: 'Plano Pro',
  price_cents: 9900,
  tenant_name: 'Acme Ltda',
  technician_name: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (url === '/api/plans' ? [PLANO] : url === '/api/subscriptions' ? [ASSINATURA] : {}),
  }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/financeiro (DS v2)', () => {
  it('mostra título, recebedor e as duas seções dentro de cartões .adm-card', async () => {
    render(<AdminFinanceiroPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Financeiro' })).toBeInTheDocument();
    expect(screen.getByText(/Recebedor:/)).toBeInTheDocument();
    for (const nome of ['Planos', 'Assinaturas']) {
      const titulo = screen.getByRole('heading', { level: 3, name: nome });
      expect(titulo.closest('section')).toHaveClass('adm-card');
    }
  });

  it('a tabela de planos usa .adm-table e as ações em texto usam .adm-link', async () => {
    render(<AdminFinanceiroPage />);
    const tabela = await screen.findByRole('table');
    expect(tabela).toHaveClass('adm-table');
    expect(screen.getByRole('button', { name: 'Editar preço' })).toHaveClass('adm-link');
    expect(await screen.findByRole('button', { name: 'Pausar' })).toHaveClass('adm-link');
    expect(screen.getByRole('button', { name: 'Ver histórico' })).toHaveClass('adm-link');
  });

  it('o status da assinatura vira Badge verde com o texto original "authorized"', async () => {
    render(<AdminFinanceiroPage />);
    const badge = await screen.findByText('authorized');
    expect(badge).toHaveClass('rounded-full');
    expect(badge.className).toContain('text-adm-status-ok-text');
  });

  it('editar o preço usa .adm-input e continua enviando o mesmo PATCH (price_cents em centavos)', async () => {
    render(<AdminFinanceiroPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar preço' }));
    const campo = screen.getByPlaceholderText('0,00');
    expect(campo).toHaveClass('adm-input');
    fireEvent.change(campo, { target: { value: '10,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find(([url, init]) => url === '/api/plans/p1' && init?.method === 'PATCH');
      expect(chamada).toBeDefined();
      expect(JSON.parse(chamada![1].body)).toEqual({ price_cents: 1050 });
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/financeiro-page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar — imports**

Em `financeiro/page.tsx`, acrescentar depois de `import { company } from '@/lib/company';`:

```tsx
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Badge, Card } from '@/components/admin/Card';
import { subscriptionTone } from '@/components/admin/status-tone';
```

- [ ] **Step 4: Implementar — trocas em massa (replace_all, nesta ordem)**

Aplicar com `Edit` + `replace_all: true` no arquivo `financeiro/page.tsx`:

| old_string | new_string |
|---|---|
| `<tr className="border-b border-brand-100 text-brand-700">` | `<tr>` |
| `<tr className="border-b border-brand-100">` | `<tr>` |
| `<th className="py-2"></th>` | `<th></th>` |
| `<th className="py-2">` | `<th>` |
| `<td className="py-2 font-medium text-brand-900">` | `<td className="font-medium text-brand-900">` |
| `<td className="py-2 text-brand-700">` | `<td className="text-brand-700">` |
| `<td className="py-2">` | `<td>` |
| `text-brand-500 hover:underline` | `adm-link` |

(A última linha também cobre `… hover:underline disabled:opacity-50`, que vira `adm-link disabled:opacity-50`. `text-brand-700 hover:underline` do "Cancelar"/"Não" **não** é tocado.)

- [ ] **Step 5: Implementar — trocas pontuais (uma a uma)**

1. Cabeçalho. Trocar
```tsx
      <h2 className="text-xl font-bold text-brand-900">Financeiro</h2>
      <p className="mt-1 text-sm text-brand-700">{`Recebedor: ${company.nomeFantasia} · CNPJ ${company.cnpj}`}</p>
```
por
```tsx
      <AdminPageHeader
        title="Financeiro"
        description={`Recebedor: ${company.nomeFantasia} · CNPJ ${company.cnpj}`}
      />
```
2. Seção Planos. Trocar
```tsx
      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h3 className="text-lg font-bold text-brand-900">Planos</h3>
```
por
```tsx
      <Card title="Planos" className="mt-6">
```
e trocar o `</section>` que fecha essa seção (o que vem logo depois de `{editStatus === 'erro' && <p className="mt-2 text-sm text-red-600">Não foi possível salvar o preço.</p>}`) por `</Card>`.
3. Seção Assinaturas. Trocar
```tsx
      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h3 className="text-lg font-bold text-brand-900">Assinaturas</h3>
```
por
```tsx
      <Card title="Assinaturas" className="mt-8">
```
e o `</section>` final (o último do componente) por `</Card>`.
4. Tabela de planos: trocar `<table className="mt-4 w-full text-left text-sm">` por `<table className="adm-table">`.
5. Campo do preço: trocar `className="w-24 rounded-md border border-brand-100 px-2 py-1"` por `className="adm-input w-24"`.
6. Item de assinatura: trocar `<li key={sub.id} className="rounded-md border border-brand-100 px-4 py-3 text-sm">` por `<li key={sub.id} className="adm-card-2 px-4 py-3 text-sm">`.
7. Status solto: trocar `<span className="ml-2 text-brand-700">({sub.status})</span>` por
```tsx
                    <span className="ml-2">
                      <Badge tone={subscriptionTone(sub.status)}>{sub.status}</Badge>
                    </span>
```
8. Estados vazios/erro (`mt-2 text-sm text-red-600`, `mt-4 text-sm text-brand-700`) e o bloco do histórico (`border-t border-brand-100 pt-3`, `text-xs text-brand-700`) **não mudam** (divisor/ texto remapeados pelo tema; não é o padrão "bloco antigo").

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/financeiro-page.test.tsx && npx tsc --noEmit`
Expected: PASS (convenção ×3 páginas; 4 testes de render, incluindo o corpo do PATCH `{"price_cents":1050}`); `tsc` limpo. Se o teste de convenção acusar `rounded-lg border border-brand-100` restante, é um bloco que escapou das trocas: corrigir, não afrouxar o teste.

- [ ] **Step 7: Checkpoint (sem commit)**

Run: `git diff --stat src/app/admin/financeiro/page.tsx`
Expected: só esse arquivo de página modificado nesta tarefa.

---

### Task 6: Verificação do lote, QA visual e doc de release

**Files:**
- Modify: `docs/operations/release-frontend-shell-empresa-2026-10-04.md` (nova camada)
- Sem código de produção novo (correção só se o QA achar defeito, e reportado).

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: relatório com VERIFICADO / NÃO VERIFICADO; seção nova no doc de release; lista de pendências para os lotes 2 e 3.

- [ ] **Step 1: Suíte, tipos, lint, build**

Run:
```bash
cd /opt/Montese/frontend
npx vitest run
npx tsc --noEmit
npx eslint src/app/admin src/components/admin --max-warnings=0
NODE_OPTIONS=--max-old-space-size=2048 npx next build
```
Expected: vitest tudo verde (os 152 anteriores + os novos; nenhum teste existente editado); `tsc` limpo; eslint 0 avisos (se um aviso preexistente de arquivo **não tocado** aparecer, registrá-lo e conferir com `git status` que o arquivo não é desta frente); `next build` compila todas as rotas. Falha ⇒ parar e usar `superpowers:systematic-debugging`.

- [ ] **Step 2: QA visual com Playwright (API simulada)**

Seguir a memória `project_visual_qa_tooling`. Servir o build local numa porta livre (ex.: 3100), **sem Docker, sem produção, sem credenciais reais**, e encerrar o servidor no fim. Sessão falsa: `montese_token` = JWT fake com `exp` futuro; `montese_user` = `{"id":"u1","role":"admin","tenantId":null}`. Interceptar `/api/**` com dados fictícios no formato que cada página espera (`/api/tenants` lista de empresas; `/api/audit-log` lista de linhas; `/api/plans` e `/api/subscriptions`; `/api/system-status`, `/api/overview` e demais chamadas da casca com objetos mínimos plausíveis; o que não importa → `[]`/`{}` sem quebrar o shell).
Rotas: `/admin/empresas`, `/admin/auditoria`, `/admin/financeiro` em 1440×900 e 390×844, mais `/admin/overview` como controle (não deve mudar).
Por rota/viewport: 0 erros de console/pageerror; sem overflow horizontal da **página**; tabela larga rola dentro do `.adm-card`; foco por Tab visível nos campos/botões/links novos; **ler os screenshots** (texto legível, cartão com raio/sombra, Badge legível, botão primário verde com texto escuro, nada colado ou cortado).
Financeiro: clicar "Editar preço", digitar e salvar com API simulada e conferir o corpo do PATCH; clicar "Ver histórico".
Auditoria: aplicar o filtro e conferir a query `resource_type`.
Salvar relatório em `/tmp/claude-0/-opt-Montese/6e630aed-15f7-43bf-8128-f2a5a86ad3a7/scratchpad/qa-admin-lote1/relatorio.md` com tabela rota × viewport (OK ou defeito + screenshot) e o que NÃO foi verificado.

- [ ] **Step 3: Atualizar o doc de release**

Em `docs/operations/release-frontend-shell-empresa-2026-10-04.md`, acrescentar depois da seção `## 0.1` uma seção `## 0.2 Camada 5 — admin DS v2, lote 1 (2026-10-05) — NÃO COMMITADA` com: spec e plano (caminhos), arquivos tocados (a tabela *File Structure* deste plano), resultados do Step 1 e do Step 2 com os marcadores, a nota "**Não commitado**; commitar só estes arquivos; build de worktree limpa", defeitos encontrados e **pendências**: lote 2 (`tecnicos`, `parceiros`, `normativa`, `checklist-sst`) e lote 3 (`empresas/[id]`) com plano próprio. Não executar nenhum passo 🔒.

- [ ] **Step 4: Checkpoint final (sem commit)**

Run: `git status --short`
Expected: os arquivos desta frente (File Structure) mais o WIP alheio que já existia (backend, `PenteFinoPanel`, frente do técnico ainda não commitada), sem arquivo inesperado. Reportar ao proprietário e **parar**: commit e release são dele.

---

## Self-Review

- **Cobertura da spec:** primitivos `.adm-input/.adm-btn/.adm-table/.adm-link` (T1); `AdminPageHeader` e `Badge` com tom só de status confirmados (T2); lote 1 `empresas`/`auditoria`/`financeiro` (T3–T5); teste que falha com `.adm-*` + `rounded/bg/border` (T3, estendido em T4–T5); contraste incl. `brand-500` remapeado (T1); render por página, corpo do PATCH preservado (T5); QA e doc (T6). Lotes 2 e 3 **fora deste plano de propósito**, com planos próprios após a verificação do lote 1 (como a spec pede).
- **Placeholders:** nenhum; trocas de página têm `old → new` exatos; os únicos pontos condicionais (ajuste de token em T1, bloco que escapou em T5) têm ação explícita.
- **Consistência de tipos/nomes:** `Tone`, `Badge`, `Card` vêm de `components/admin/Card.tsx` (existentes); `AdminPageHeader`, `subscriptionTone`, `httpStatusTone` definidos em T2 e usados em T3–T5 com as mesmas assinaturas; `PAGINAS` criada em T3 e estendida em T4/T5; classes `.adm-*` definidas em T1 e as mesmas nos testes.
- **Desvios declarados da spec:** (1) `empresas` e `auditoria` não têm bloco `rounded-lg … p-6`; a tabela é envolvida por `div.adm-card` (sem título novo), e `Card` com título só entra em `financeiro`, onde já existiam os títulos "Planos"/"Assinaturas"; (2) status de empresa em `/admin/empresas` fica `neutral` (valores não confirmados); (3) o status de assinatura perde os parênteses ao virar `Badge` (texto igual).
