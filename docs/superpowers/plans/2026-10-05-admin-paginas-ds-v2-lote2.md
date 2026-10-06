# Admin DS v2 — Lote 2 (técnicos, parceiros, normativa, checklist-sst) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar o Design System v2 (tema escuro mantido) às páginas de formulário do admin — `/admin/tecnicos`, `/admin/parceiros`, `/admin/normativa`, `/admin/checklist-sst` — reaproveitando os primitivos do Lote 1, sem mudar conteúdo, dados nem comportamento.

**Architecture:** Mesmo padrão do Lote 1: `AdminPageHeader`, `Card`, `Badge`, classes `.adm-*`. Novidades deste lote: um primitivo `.adm-btn-danger` (ação destrutiva), um teste de convenções mais forte (padding, fonte, cor e variantes com prefixo) e testes de render que provam que cada formulário continua enviando o mesmo corpo para o mesmo endpoint.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind v4, vitest + Testing Library, Playwright (QA visual).

**Spec:** `docs/superpowers/specs/2026-10-05-admin-paginas-ds-v2-design.md` · **Lote anterior:** `docs/superpowers/plans/2026-10-05-admin-paginas-ds-v2-lote1.md` (já executado; primitivos em `admin-theme.css`, `AdminPageHeader`, `status-tone.ts`).

## Global Constraints

- Só frontend (`frontend/src`) e docs. Sem backend, migration, Docker, Nginx, RBAC, RLS ou endpoints novos. **Tema escuro mantido.**
- Todos os comandos rodam em `/opt/Montese/frontend`.
- **Sem `git commit`, `push`, `add`, `reset`, `revert`, `stash`** (AGENTS.md). Onde o skill diria "commit", faça só `git status --short <caminho>`. A árvore tem WIP de outras frentes: nunca `git add -A`, nunca tocar em `PenteFinoPanel*`, `backend/`.
- `admin-theme.css` **não usa `@layer`**: o que uma classe `.adm-*` define vence o utilitário do Tailwind na mesma propriedade. Regras (verificadas pelo teste de convenções, Task 1): `adm-card`/`adm-card-2`/`adm-input`/`adm-btn`/`adm-table` não levam `rounded*`, `bg-*` nem `border*`; `adm-input`/`adm-btn`/`adm-link` não levam padding (`p-*`, `px-*`, `py-*`…); `adm-btn` não leva tamanho/peso de fonte (`text-xs`, `text-sm`, `font-*`) nem cor de texto; `adm-link` não leva cor de texto. Larguras, margens, `flex`, `self-*`, `col-span-*`, `disabled:opacity-50` e `outline*` são permitidos.
- Lógica, `fetch`, estados, handlers, textos visíveis e ordem dos elementos **não mudam**. Desvios aceitos e declarados: status solto vira `Badge` com o **mesmo texto**, tom `neutral` (valores de status de técnico/parceiro não confirmados); botões perdem `px-*`/`text-xs` (o `.adm-btn` padroniza); links de ação deixam de ser sublinhados fixos (`.adm-link` sublinha no hover); título da página passa de `text-2xl` para o `text-xl` do `AdminPageHeader`.
- **Testes de página:** o router do mock **tem que ser estável** (`const router = vi.hoisted(() => ({ push: vi.fn() }))` e `useRouter: () => router`): as páginas têm `[router]` nas deps do efeito e um objeto novo a cada render causa loop infinito. Rodar sempre com `timeout` (ex.: `timeout 120 npx vitest run …`).
- Não editar `Card.tsx`, `AdminShell`, sidebar, topbar nem testes existentes, exceto o que cada tarefa diz.
- Comentários em PT-BR, curtos.
- Resposta final aos humanos em PT-BR com VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/app/admin/admin-theme.css` | modificar | `.adm-btn-danger` |
| `src/app/admin/__tests__/admin-theme-contraste.test.ts` | modificar (só acrescentar) | Contraste e existência do `.adm-btn-danger` |
| `src/app/admin/__tests__/convencoes-paginas.test.ts` | **reescrever** | Regras mais fortes + autoteste das regras |
| `src/app/admin/tecnicos/page.tsx` | modificar | Aplica primitivos |
| `src/app/admin/__tests__/tecnicos-page.test.tsx` | criar | Render + corpos de POST |
| `src/app/admin/parceiros/page.tsx` | modificar | Aplica primitivos |
| `src/app/admin/__tests__/parceiros-page.test.tsx` | criar | Render + corpos de POST |
| `src/app/admin/normativa/page.tsx` | modificar | Aplica primitivos |
| `src/app/admin/__tests__/normativa-page.test.tsx` | criar | Render + fluxo revisar/aprovar/rejeitar/reindexar |
| `src/app/admin/checklist-sst/page.tsx` | modificar | Aplica primitivos |
| `src/app/admin/__tests__/checklist-sst-page.test.tsx` | criar | Render + criar/editar/excluir/filtrar |
| `docs/operations/release-frontend-shell-empresa-2026-10-04.md` | modificar | Nova camada (Task 6) |

---

### Task 1: `.adm-btn-danger` e teste de convenções reforçado

**Files:**
- Modify: `src/app/admin/admin-theme.css` (depois do bloco `.adm-btn-primary:hover`)
- Modify: `src/app/admin/__tests__/admin-theme-contraste.test.ts` (acrescentar ao final)
- Rewrite: `src/app/admin/__tests__/convencoes-paginas.test.ts`

**Interfaces:**
- Consumes: tokens `--color-adm-status-crit`, `--color-adm-status-crit-bg`, `--color-adm-status-crit-text` (já em `globals.css`); helpers do teste de contraste (`valor`, `rgb`, `contraste`, `adm`, `tok`, `SUPERFICIES`, `admin`).
- Produces: classe `.admin-theme .adm-btn-danger` (usar junto de `.adm-btn`); constante `PAGINAS` no teste de convenções (as Tasks 2–5 a estendem).

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao **final** de `admin-theme-contraste.test.ts`:

```ts
describe('.adm-btn-danger (lote 2 do admin)', () => {
  it('define .admin-theme .adm-btn-danger', () => {
    expect(admin).toMatch(/\.admin-theme \.adm-btn-danger\b/);
  });
  it('texto de ação destrutiva ≥ 4,5:1 sobre a superfície, sobre o fundo e sobre o hover tingido', () => {
    const texto = rgb(tok('status-crit-text'));
    expect(contraste(texto, rgb(SUPERFICIES.surface))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(texto, rgb(SUPERFICIES.bg))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(texto, sobre(tok('status-crit-bg'), SUPERFICIES.surface))).toBeGreaterThanOrEqual(4.5);
  });
});
```

Substituir **todo** o conteúdo de `convencoes-paginas.test.ts` por:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Páginas já migradas para o DS v2 do admin. Cada lote acrescenta as suas aqui.
const PAGINAS = ['empresas/page.tsx', 'auditoria/page.tsx', 'financeiro/page.tsx'];

const BASE = join(process.cwd(), 'src/app/admin');

// admin-theme.css fora de @layer: o que a classe .adm-* define vence o utilitário do Tailwind na mesma
// propriedade. Cada regra lista o que a classe define (alvo) e o utilitário que ficaria sem efeito (proibido).
const REGRAS: { alvo: RegExp; proibido: RegExp; motivo: string }[] = [
  { alvo: /\badm-(card-2|card|input|btn|table)\b/, proibido: /^(rounded(-\S+)?|bg-\S+|border(-\S+)?)$/, motivo: 'rounded/bg/border' },
  { alvo: /\badm-(input|btn|link)\b/, proibido: /^p[xytblr]?-\S+$/, motivo: 'padding' },
  { alvo: /\badm-btn\b/, proibido: /^(text-(xs|sm|base|lg|xl|[2-9]xl)|font-\S+)$/, motivo: 'tamanho/peso da fonte' },
  { alvo: /\badm-(btn|link)\b/, proibido: /^text-(brand|red|green|yellow|white|slate|adm)\S*$/, motivo: 'cor do texto' },
];

// Ignora variantes (sm:, hover:, disabled:…): perdem do mesmo jeito.
const semVariante = (token: string) => token.split(':').pop() ?? token;

function violacoes(classes: string): string[] {
  const tokens = classes.split(/\s+/).filter(Boolean);
  return REGRAS.filter((r) => r.alvo.test(classes)).flatMap((r) =>
    tokens.filter((t) => r.proibido.test(semVariante(t))).map((t) => `${t} (${r.motivo})`),
  );
}

function classNames(fonte: string): string[] {
  return [...fonte.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? '');
}

describe('regras de convenção (autoteste)', () => {
  it.each([
    ['adm-btn px-6', 1],
    ['adm-btn sm:text-xs', 1],
    ['adm-btn text-brand-700', 1],
    ['adm-btn font-medium', 1],
    ['adm-input hover:bg-red-500', 1],
    ['adm-input rounded-md', 1],
    ['adm-link text-red-600', 1],
    ['adm-card-2 border-brand-100', 1],
    ['adm-card-2 border border-brand-100', 2],
  ])('%s é recusado', (classes, quantidade) => {
    expect(violacoes(classes)).toHaveLength(quantidade);
  });

  it.each([
    'adm-btn adm-btn-primary self-start disabled:opacity-50',
    'adm-btn adm-btn-danger disabled:opacity-50',
    'adm-input w-full min-w-0 text-sm',
    'adm-input sm:col-span-2',
    'adm-card overflow-x-auto p-2 sm:p-4',
    'adm-card-2 flex items-center justify-between px-3 py-2 text-sm',
    'adm-link',
    'adm-table',
  ])('%s é aceito', (classes) => {
    expect(violacoes(classes)).toEqual([]);
  });
});

describe.each(PAGINAS)('convenções do DS v2 do admin em %s', (pagina) => {
  const fonte = readFileSync(join(BASE, pagina), 'utf8');
  const lista = classNames(fonte);

  it('não sobra o bloco antigo (borda cinza arredondada) nem o campo antigo', () => {
    expect(fonte).not.toContain('rounded-lg border border-brand-100');
    expect(fonte).not.toContain('rounded-md border border-brand-100');
  });

  it('usa pelo menos um primitivo .adm-* em className literal (senão o teste abaixo seria vazio)', () => {
    expect(lista.some((c) => /\badm-/.test(c))).toBe(true);
  });

  it('nenhum elemento com .adm-* leva utilitário que a classe já define (e que seria ignorado)', () => {
    expect(lista.flatMap((c) => violacoes(c).map((v) => `${v} em "${c}"`))).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/frontend && timeout 120 npx vitest run src/app/admin/__tests__/admin-theme-contraste.test.ts src/app/admin/__tests__/convencoes-paginas.test.ts`
Expected: FAIL só no `.adm-btn-danger` ("define .admin-theme .adm-btn-danger"); o teste de convenções deve **passar** nas 3 páginas do Lote 1 (as regras novas já são respeitadas por elas). Se uma página do Lote 1 for recusada, **parar e reportar** o que foi recusado (não afrouxar a regra nem editar a página sem decisão do controlador).

- [ ] **Step 3: Implementar `.adm-btn-danger`**

Em `admin-theme.css`, logo depois do bloco `.admin-theme .adm-btn-primary:hover:not(:disabled) { … }`, acrescentar:

```css
/* Ação destrutiva (ex.: Rejeitar); usar junto de .adm-btn. */
.admin-theme .adm-btn-danger {
  border-color: color-mix(in srgb, var(--color-adm-status-crit) 40%, transparent);
  color: var(--color-adm-status-crit-text);
}
.admin-theme .adm-btn-danger:hover:not(:disabled) {
  background: var(--color-adm-status-crit-bg);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `timeout 120 npx vitest run src/app/admin/__tests__/admin-theme-contraste.test.ts src/app/admin/__tests__/convencoes-paginas.test.ts`
Expected: PASS (contraste: 23 + 9 − … todos verdes; convenções: autoteste + 3 páginas × 3).

- [ ] **Step 5: Checkpoint (sem commit)**

Run: `git status --short src/app/admin`
Expected: `M` em `admin-theme.css`, `admin-theme-contraste.test.ts` e `convencoes-paginas.test.ts` (este já constava como novo da frente anterior).

---

### Task 2: Página `/admin/tecnicos`

**Files:**
- Modify: `src/app/admin/tecnicos/page.tsx`
- Modify: `src/app/admin/__tests__/convencoes-paginas.test.ts` (linha `PAGINAS`)
- Create: `src/app/admin/__tests__/tecnicos-page.test.tsx`

**Interfaces:**
- Consumes: `AdminPageHeader` (`@/components/admin/PageHeader`), `Card` e `Badge` (`@/components/admin/Card`), classes `.adm-card-2`, `.adm-input`, `.adm-btn`, `.adm-btn-primary`, `.adm-link`.
- Produces: nada novo.

- [ ] **Step 1: Escrever os testes que falham**

Em `convencoes-paginas.test.ts`:

```ts
const PAGINAS = ['empresas/page.tsx', 'auditoria/page.tsx', 'financeiro/page.tsx', 'tecnicos/page.tsx'];
```

`src/app/admin/__tests__/tecnicos-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Router estável (como o real do Next): a página tem `[router]` nas deps do efeito de carga,
// e um objeto novo a cada render causaria loop infinito de fetch + setState.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminTecnicosPage from '../tecnicos/page';

const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
const TECNICO = { id: 't1', full_name: 'Ana Souza', email: 'ana@exemplo.com', registration_number: null, specialization: 'Higiene', status: 'active' };
const EMPRESAS = [{ id: 'e1', name: 'Acme' }, { id: 'e2', name: 'Beta' }];

let fetchMock: ReturnType<typeof vi.fn>;
const chamadas = (url: string, metodo: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === metodo);

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/technicians' && !init?.method) return ok([TECNICO]);
    if (url === '/api/tenants') return ok(EMPRESAS);
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/tecnicos (DS v2)', () => {
  it('mostra o título e as duas seções em cartões .adm-card', async () => {
    render(<AdminTecnicosPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Técnicos' })).toBeInTheDocument();
    for (const nome of ['Criar técnico', 'Técnicos cadastrados']) {
      expect(screen.getByRole('heading', { level: 3, name: nome }).closest('section')).toHaveClass('adm-card');
    }
  });

  it('campos e botões usam os primitivos; o status vira Badge com o texto original', async () => {
    render(<AdminTecnicosPage />);
    expect(await screen.findByLabelText('E-mail')).toHaveClass('adm-input');
    expect(screen.getByRole('button', { name: 'Criar técnico' })).toHaveClass('adm-btn', 'adm-btn-primary');
    expect(screen.getByRole('button', { name: 'Vincular a empresa' })).toHaveClass('adm-link');
    expect(await screen.findByText('active')).toHaveClass('rounded-full');
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
  });

  it('criar técnico continua enviando o mesmo POST (campos opcionais vazios ficam de fora)', async () => {
    render(<AdminTecnicosPage />);
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'novo@exemplo.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-de-teste' } });
    fireEvent.change(screen.getByLabelText('Nome completo'), { target: { value: 'Nova Pessoa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar técnico' }));
    await waitFor(() => expect(chamadas('/api/technicians', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/technicians', 'POST')[0][1].body)).toEqual({
      email: 'novo@exemplo.com',
      password: 'senha-de-teste',
      full_name: 'Nova Pessoa',
    });
  });

  it('vincular a empresas: lista de checkboxes com .adm-input e um POST por empresa marcada, em ordem', async () => {
    render(<AdminTecnicosPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a empresa' }));
    const acme = screen.getByLabelText('Acme');
    expect(acme.closest('div')).toHaveClass('adm-input');
    fireEvent.click(acme);
    fireEvent.click(screen.getByLabelText('Beta'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar vínculo' }));
    await waitFor(() => expect(chamadas('/api/technicians/t1/assign', 'POST')).toHaveLength(2));
    const corpos = chamadas('/api/technicians/t1/assign', 'POST').map(([, init]) => JSON.parse(init.body));
    expect(corpos).toEqual([{ tenant_id: 'e1' }, { tenant_id: 'e2' }]);
    expect(await screen.findByText('Vinculado com sucesso.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `timeout 120 npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/tecnicos-page.test.tsx`
Expected: FAIL (página ainda no estilo antigo).

- [ ] **Step 3: Implementar — imports**

Em `tecnicos/page.tsx`, depois de `import { useRouter } from 'next/navigation';`:

```tsx
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Badge, Card } from '@/components/admin/Card';
```

- [ ] **Step 4: Implementar — trocas (com `Edit`, nesta ordem)**

1. `replace_all` — `className="rounded-md border border-brand-100 px-3 py-2"` → `className="adm-input"` (6 campos do formulário).
2. Cabeçalho — `<h2 className="text-xl font-bold text-brand-900">Técnicos</h2>` → `<AdminPageHeader title="Técnicos" />`.
3. Abertura do cartão "Criar técnico":
```tsx
      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h3 className="text-lg font-bold text-brand-900">Criar técnico</h3>
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-4">
```
→
```tsx
      <Card title="Criar técnico" className="mt-6">
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
```
4. Botão de criar — `className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"` → `className="adm-btn adm-btn-primary self-start disabled:opacity-50"`.
5. Fecho do primeiro cartão e abertura do segundo:
```tsx
        </form>
      </section>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h3 className="text-lg font-bold text-brand-900">Técnicos cadastrados</h3>
        {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}
        {technicians.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhum técnico cadastrado ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
```
→
```tsx
        </form>
      </Card>

      <Card title="Técnicos cadastrados" className="mt-8">
        {listError && <p className="mb-2 text-sm text-red-600">{listError}</p>}
        {technicians.length === 0 ? (
          <p className="text-sm text-brand-700">Nenhum técnico cadastrado ainda.</p>
        ) : (
          <ul className="flex flex-col gap-4">
```
6. Fecho do segundo cartão — `      </section>\n    </div>\n  );\n}` → `      </Card>\n    </div>\n  );\n}`.
7. Item da lista — `<li key={tech.id} className="rounded-md border border-brand-100 px-4 py-3 text-sm">` → `<li key={tech.id} className="adm-card-2 px-4 py-3 text-sm">`.
8. Status — `<span className="ml-2 text-brand-700">{tech.status}</span>` →
```tsx
                    <span className="ml-2">
                      <Badge tone="neutral">{tech.status}</Badge>
                    </span>
```
9. Ação "Vincular a empresa" — `className="text-brand-500 hover:underline"` → `className="adm-link"`.
10. Caixa de checkboxes — `className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-brand-100 p-2"` → `className="adm-input flex max-h-40 flex-col gap-1 overflow-y-auto"` (a `div` ganha o aspecto de campo; o padding vem do `.adm-input`).
11. Botão "Confirmar vínculo" — `className="self-start rounded-md bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"` → `className="adm-btn adm-btn-primary self-start disabled:opacity-50"`.
12. Botão "Fechar" — `className="self-start rounded-md border border-brand-100 px-4 py-2 text-xs font-medium text-brand-700"` → `className="adm-btn self-start"`.

O divisor `border-t border-brand-100 pt-3` do formulário de vínculo, os textos de erro/sucesso e todo o resto **não mudam**.

- [ ] **Step 5: Rodar e ver passar**

Run: `timeout 120 npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/tecnicos-page.test.tsx && npx tsc --noEmit`
Expected: PASS; `tsc` limpo. Conferir que não sobrou `rounded-md border border-brand-100`, `rounded-lg`, `<section` nem `</section>` na página (`grep`).

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `git diff --stat src/app/admin/tecnicos/page.tsx`
Expected: só esse arquivo de página modificado nesta tarefa.

---

### Task 3: Página `/admin/parceiros`

**Files:**
- Modify: `src/app/admin/parceiros/page.tsx`
- Modify: `src/app/admin/__tests__/convencoes-paginas.test.ts` (linha `PAGINAS`)
- Create: `src/app/admin/__tests__/parceiros-page.test.tsx`

**Interfaces:**
- Consumes: igual à Task 2.
- Produces: nada novo.

- [ ] **Step 1: Escrever os testes que falham**

Em `convencoes-paginas.test.ts`, acrescentar `'parceiros/page.tsx'` ao fim da lista `PAGINAS` (mantendo as anteriores).

`src/app/admin/__tests__/parceiros-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Router estável (como o real do Next): a página tem `[router]` nas deps do efeito de carga,
// e um objeto novo a cada render causaria loop infinito de fetch + setState.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminParceirosPage from '../parceiros/page';

const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
const PARCEIRO = { id: 'p1', full_name: 'Bruno Lima', email: 'bruno@exemplo.com', service_region: 'Grande Florianópolis', status: 'active' };
const EMPRESAS = [{ id: 'e1', name: 'Acme' }];

let fetchMock: ReturnType<typeof vi.fn>;
const chamadas = (url: string, metodo: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === metodo);

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/partners' && !init?.method) return ok([PARCEIRO]);
    if (url === '/api/tenants') return ok(EMPRESAS);
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/parceiros (DS v2)', () => {
  it('mostra o título e as duas seções em cartões .adm-card', async () => {
    render(<AdminParceirosPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Parceiros' })).toBeInTheDocument();
    for (const nome of ['Criar parceiro', 'Parceiros cadastrados']) {
      expect(screen.getByRole('heading', { level: 3, name: nome }).closest('section')).toHaveClass('adm-card');
    }
  });

  it('campos e botões usam os primitivos; o status vira Badge com o texto original', async () => {
    render(<AdminParceirosPage />);
    expect(await screen.findByLabelText('Região de atendimento')).toHaveClass('adm-input');
    expect(screen.getByRole('button', { name: 'Criar parceiro' })).toHaveClass('adm-btn', 'adm-btn-primary');
    expect(screen.getByRole('button', { name: 'Vincular a empresa' })).toHaveClass('adm-link');
    expect(await screen.findByText('active')).toHaveClass('rounded-full');
    expect(screen.getByText('(Grande Florianópolis)')).toBeInTheDocument();
  });

  it('criar parceiro continua enviando o mesmo POST (telefone vazio fica de fora)', async () => {
    render(<AdminParceirosPage />);
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'novo@exemplo.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-de-teste' } });
    fireEvent.change(screen.getByLabelText('Nome completo'), { target: { value: 'Nova Pessoa' } });
    fireEvent.change(screen.getByLabelText('Região de atendimento'), { target: { value: 'Sul' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar parceiro' }));
    await waitFor(() => expect(chamadas('/api/partners', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/partners', 'POST')[0][1].body)).toEqual({
      email: 'novo@exemplo.com',
      password: 'senha-de-teste',
      full_name: 'Nova Pessoa',
      service_region: 'Sul',
    });
  });

  it('vincular a empresa: select com .adm-input e POST com o tenant escolhido', async () => {
    render(<AdminParceirosPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a empresa' }));
    const seletor = screen.getByRole('combobox');
    expect(seletor).toHaveClass('adm-input');
    fireEvent.change(seletor, { target: { value: 'e1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar vínculo' }));
    await waitFor(() => expect(chamadas('/api/partners/p1/assign', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/partners/p1/assign', 'POST')[0][1].body)).toEqual({ tenant_id: 'e1' });
    expect(await screen.findByText('Vinculado com sucesso.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `timeout 120 npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/parceiros-page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar — imports**

Em `parceiros/page.tsx`, depois de `import { useRouter } from 'next/navigation';`:

```tsx
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Badge, Card } from '@/components/admin/Card';
```

- [ ] **Step 4: Implementar — trocas (com `Edit`, nesta ordem)**

1. `replace_all` — `className="rounded-md border border-brand-100 px-3 py-2"` → `className="adm-input"` (5 campos + o `select` de empresa; todos têm essa mesma string).
2. `<h2 className="text-xl font-bold text-brand-900">Parceiros</h2>` → `<AdminPageHeader title="Parceiros" />`.
3. Abertura do primeiro cartão:
```tsx
      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h3 className="text-lg font-bold text-brand-900">Criar parceiro</h3>
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-4">
```
→
```tsx
      <Card title="Criar parceiro" className="mt-6">
        <form onSubmit={handleCreate} className="flex flex-col gap-4">
```
4. Botão de criar — `className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"` → `className="adm-btn adm-btn-primary self-start disabled:opacity-50"`.
5. Fecho do primeiro cartão e abertura do segundo:
```tsx
        </form>
      </section>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h3 className="text-lg font-bold text-brand-900">Parceiros cadastrados</h3>
        {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}
        {partners.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhum parceiro cadastrado ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
```
→
```tsx
        </form>
      </Card>

      <Card title="Parceiros cadastrados" className="mt-8">
        {listError && <p className="mb-2 text-sm text-red-600">{listError}</p>}
        {partners.length === 0 ? (
          <p className="text-sm text-brand-700">Nenhum parceiro cadastrado ainda.</p>
        ) : (
          <ul className="flex flex-col gap-4">
```
6. Fecho — `      </section>\n    </div>\n  );\n}` → `      </Card>\n    </div>\n  );\n}`.
7. `<li key={partner.id} className="rounded-md border border-brand-100 px-4 py-3 text-sm">` → `<li key={partner.id} className="adm-card-2 px-4 py-3 text-sm">`.
8. `<span className="ml-2 text-brand-700">{partner.status}</span>` →
```tsx
                    <span className="ml-2">
                      <Badge tone="neutral">{partner.status}</Badge>
                    </span>
```
9. `className="text-brand-500 hover:underline"` → `className="adm-link"`.
10. Botão "Confirmar vínculo" — `className="self-start rounded-md bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-700"` → `className="adm-btn adm-btn-primary self-start"`.
11. Botão "Fechar" — `className="self-start rounded-md border border-brand-100 px-4 py-2 text-xs font-medium text-brand-700"` → `className="adm-btn self-start"`.

O divisor `border-t border-brand-100 pt-3` e o resto **não mudam**.

- [ ] **Step 5: Rodar e ver passar**

Run: `timeout 120 npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/parceiros-page.test.tsx && npx tsc --noEmit`
Expected: PASS; `tsc` limpo; `grep` sem `rounded-md border border-brand-100`, `rounded-lg`, `<section`, `</section>` na página.

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `git diff --stat src/app/admin/parceiros/page.tsx`
Expected: só esse arquivo de página modificado nesta tarefa.

---

### Task 4: Página `/admin/normativa`

**Files:**
- Modify: `src/app/admin/normativa/page.tsx`
- Modify: `src/app/admin/__tests__/convencoes-paginas.test.ts` (linha `PAGINAS`)
- Create: `src/app/admin/__tests__/normativa-page.test.tsx`

**Interfaces:**
- Consumes: `AdminPageHeader`, `Card`, `Badge`; classes `.adm-card-2`, `.adm-input`, `.adm-btn`, `.adm-btn-primary`, `.adm-btn-danger`, `.adm-link` (Task 1).
- Produces: nada novo.

- [ ] **Step 1: Escrever os testes que falham**

Em `convencoes-paginas.test.ts`, acrescentar `'normativa/page.tsx'` ao fim de `PAGINAS`.

`src/app/admin/__tests__/normativa-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Router estável (como o real do Next): a página tem `[router]` nas deps do efeito de carga,
// e um objeto novo a cada render causaria loop infinito de fetch + setState.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminNormativaPage from '../normativa/page';

const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
const FONTE = {
  id: 's1', entity: 'MTE', code: 'NR-06', title: 'Equipamento de Proteção Individual', official_url: 'https://exemplo.gov.br/nr06',
  active: true, last_checked_at: null, last_check_status: 'erro' as const, last_error: 'timeout', consecutive_failures: 2,
};
const DOC_PENDENTE = { id: 'd1', source_id: 's1', status: 'aguardando_validacao', file_name: 'nr06-v2.pdf', detected_at: '2026-10-01T00:00:00Z', indexed_at: null, rejection_reason: null };
const DOC_VIGENTE = { id: 'd2', source_id: 's1', status: 'vigente', file_name: 'nr06-v1.pdf', detected_at: '2026-09-01T00:00:00Z', indexed_at: null, rejection_reason: null };

let fetchMock: ReturnType<typeof vi.fn>;
const chamadas = (url: string, metodo: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === metodo);

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/normative-sources' && !init?.method) return ok([FONTE]);
    if (url === '/api/normative-documents?status=aguardando_validacao') return ok([DOC_PENDENTE]);
    if (url === '/api/normative-documents?status=vigente') return ok([DOC_VIGENTE]);
    if (url === '/api/normative-documents/d1') return ok({ document: { ...DOC_PENDENTE, raw_text: 'Texto novo da NR' }, previous_text: null });
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/normativa (DS v2)', () => {
  it('mostra o título e os cartões Fontes, Aguardando validação e Vigentes', async () => {
    render(<AdminNormativaPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Base normativa' })).toBeInTheDocument();
    for (const nome of ['Fontes monitoradas', 'Aguardando validação (1)', 'Vigentes (1)']) {
      expect((await screen.findByRole('heading', { level: 3, name: nome })).closest('section')).toHaveClass('adm-card');
    }
  });

  it('a fonte com falhas mostra um Badge "bad" com o texto original; campos e botão usam os primitivos', async () => {
    render(<AdminNormativaPage />);
    const falha = await screen.findByText('Falhando (2) — timeout');
    expect(falha.closest('span.rounded-full')).not.toBeNull();
    expect(falha.closest('span.rounded-full')!.className).toContain('text-adm-status-crit-text');
    expect(screen.getByPlaceholderText('Entidade (ex: MTE)')).toHaveClass('adm-input');
    expect(screen.getByRole('button', { name: 'Cadastrar fonte' })).toHaveClass('adm-btn', 'adm-btn-primary');
  });

  it('cadastrar fonte continua enviando o mesmo POST (código vazio fica de fora)', async () => {
    render(<AdminNormativaPage />);
    fireEvent.change(await screen.findByPlaceholderText('Entidade (ex: MTE)'), { target: { value: 'MTE' } });
    fireEvent.change(screen.getByPlaceholderText('Título'), { target: { value: 'NR de teste' } });
    fireEvent.change(screen.getByPlaceholderText('URL oficial'), { target: { value: 'https://exemplo.gov.br/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar fonte' }));
    await waitFor(() => expect(chamadas('/api/normative-sources', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-sources', 'POST')[0][1].body)).toEqual({
      entity: 'MTE',
      title: 'NR de teste',
      official_url: 'https://exemplo.gov.br/x',
    });
  });

  it('revisar: o painel abre em destaque, Aprovar envia POST /approve e Rejeitar só habilita com motivo', async () => {
    render(<AdminNormativaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar' }));
    const painel = (await screen.findByRole('heading', { level: 3, name: 'Revisar versão' })).closest('section');
    expect(painel).toHaveClass('adm-card');
    expect(screen.getByText('Texto novo da NR')).toBeInTheDocument();

    const rejeitar = screen.getByRole('button', { name: 'Rejeitar' });
    expect(rejeitar).toHaveClass('adm-btn', 'adm-btn-danger');
    expect(rejeitar).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Motivo da rejeição'), { target: { value: 'Texto incompleto' } });
    expect(rejeitar).toBeEnabled();
    fireEvent.click(rejeitar);
    await waitFor(() => expect(chamadas('/api/normative-documents/d1/reject', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-documents/d1/reject', 'POST')[0][1].body)).toEqual({ reason: 'Texto incompleto' });
  });

  it('aprovar envia POST /approve do documento aberto', async () => {
    render(<AdminNormativaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(chamadas('/api/normative-documents/d1/approve', 'POST')).toHaveLength(1));
  });

  it('documento vigente sem indexação mostra "Reindexar" e envia POST /reindex', async () => {
    render(<AdminNormativaPage />);
    const botao = await screen.findByRole('button', { name: 'Reindexar' });
    expect(botao).toHaveClass('adm-link');
    fireEvent.click(botao);
    await waitFor(() => expect(chamadas('/api/normative-documents/d2/reindex', 'POST')).toHaveLength(1));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `timeout 120 npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/normativa-page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar — imports**

Em `normativa/page.tsx`, depois de `import { useRouter } from 'next/navigation';`:

```tsx
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Badge, Card } from '@/components/admin/Card';
```

- [ ] **Step 4: Implementar — o `return` final**

Substituir **todo o `return ( … );` final** (de `<div>\n      <h2 className="text-2xl font-bold text-brand-900">Base normativa</h2>` até o fim do componente) por:

```tsx
  return (
    <div>
      <AdminPageHeader title="Base normativa" />
      {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}

      <Card title="Fontes monitoradas" className="mt-8">
        <form onSubmit={handleCreateSource} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input placeholder="Entidade (ex: MTE)" value={entity} onChange={(e) => setEntity(e.target.value)} required className="adm-input" />
          <input placeholder="Código (ex: NR-06)" value={code} onChange={(e) => setCode(e.target.value)} className="adm-input" />
          <input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} required className="adm-input sm:col-span-2" />
          <input placeholder="URL oficial" value={officialUrl} onChange={(e) => setOfficialUrl(e.target.value)} required className="adm-input sm:col-span-2" />
          {createStatus === 'erro' && <p className="text-sm text-red-600 sm:col-span-2">Não foi possível cadastrar. Confira a URL.</p>}
          <button type="submit" disabled={createStatus === 'loading'} className="adm-btn adm-btn-primary self-start disabled:opacity-50 sm:col-span-2">
            Cadastrar fonte
          </button>
        </form>
        <ul className="mt-4 flex flex-col gap-1 text-sm text-brand-700">
          {sources.map((s) => (
            <li key={s.id}>
              {s.entity} {s.code ? `— ${s.code}` : ''} — {s.title}
              <span className="ml-2 text-xs text-brand-500">{formatChecked(s.last_checked_at)}</span>
              {s.consecutive_failures > 0 && (
                <span className="ml-2">
                  <Badge tone="bad">
                    Falhando ({s.consecutive_failures}){s.last_error ? ` — ${s.last_error}` : ''}
                  </Badge>
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={`Aguardando validação (${pending.length})`} className="mt-8">
        <ul className="flex flex-col gap-2">
          {pending.map((doc) => (
            <li key={doc.id} className="adm-card-2 flex items-center justify-between px-3 py-2 text-sm">
              <span>{doc.file_name} — detectado em {new Date(doc.detected_at).toLocaleDateString('pt-BR')}</span>
              <button onClick={() => openDetail(doc.id)} className="adm-link">Revisar</button>
            </li>
          ))}
          {pending.length === 0 && <p className="text-sm text-brand-700">Nada pendente.</p>}
        </ul>
      </Card>

      <Card title={`Vigentes (${vigentes.length})`} className="mt-8">
        <ul className="flex flex-col gap-2">
          {vigentes.map((doc) => (
            <li key={doc.id} className="adm-card-2 flex items-center justify-between px-3 py-2 text-sm">
              <span>{doc.file_name} — {doc.indexed_at ? 'indexado' : 'aprovado, indexação pendente'}</span>
              {!doc.indexed_at && (
                <button onClick={() => handleReindex(doc.id)} className="adm-link">Reindexar</button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {detail && (
        // O destaque (antes borda verde) vira outline: .adm-card já define a borda e vence border-*.
        <Card title="Revisar versão" className="mt-8 outline outline-2 outline-adm-brand">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h4 className="text-sm font-bold text-brand-700">Texto anterior</h4>
              <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-brand-700">
                {detail.previous_text || '(nenhuma versão vigente anterior)'}
              </p>
            </div>
            <div>
              <h4 className="text-sm font-bold text-brand-700">Texto novo</h4>
              <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-brand-900">
                {detail.document.raw_text}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button onClick={() => handleApprove(detail.document.id)} className="adm-btn adm-btn-primary">
              Aprovar
            </button>
            <input
              placeholder="Motivo da rejeição"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="adm-input flex-1 text-sm"
            />
            <button onClick={() => handleReject(detail.document.id)} disabled={!rejectReason} className="adm-btn adm-btn-danger disabled:opacity-50">
              Rejeitar
            </button>
          </div>
        </Card>
      )}
    </div>
  );
```

(O estado, `loadAll`, os handlers e o `if (!ready)` **não mudam**. O comentário JSX dentro de `detail && ( … )` é o único comentário novo; se o `tsc`/lint reclamar de comentário em posição de expressão, mova-o para a linha acima de `{detail && (`.)

- [ ] **Step 5: Rodar e ver passar**

Run: `timeout 120 npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/normativa-page.test.tsx && npx tsc --noEmit`
Expected: PASS; `tsc` limpo. Se o seletor `outline-adm-brand` não for gerado pelo Tailwind (conferir no QA da Task 6), é aceitável cair para `outline-emerald-400`; registrar.

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `git diff --stat src/app/admin/normativa/page.tsx`
Expected: só esse arquivo de página modificado nesta tarefa.

---

### Task 5: Página `/admin/checklist-sst`

**Files:**
- Modify: `src/app/admin/checklist-sst/page.tsx`
- Modify: `src/app/admin/__tests__/convencoes-paginas.test.ts` (linha `PAGINAS`)
- Create: `src/app/admin/__tests__/checklist-sst-page.test.tsx`

**Interfaces:**
- Consumes: `AdminPageHeader`, `Card`; classes `.adm-card`, `.adm-card-2`, `.adm-input`, `.adm-btn`, `.adm-btn-primary`, `.adm-link`.
- Produces: nada novo.

- [ ] **Step 1: Escrever os testes que falham**

Em `convencoes-paginas.test.ts`, acrescentar `'checklist-sst/page.tsx'` ao fim de `PAGINAS`.

`src/app/admin/__tests__/checklist-sst-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Router estável (como o real do Next): a página tem `[router]` nas deps do efeito de carga,
// e um objeto novo a cada render causaria loop infinito de fetch + setState.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminChecklistSstPage from '../checklist-sst/page';

const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
const ITEM = {
  id: 'i1', nr_code: 'NR-13', nr_title: 'Caldeiras', nr_category: 'especial', document_name: 'Prontuário de caldeira',
  description: 'Descrição', legal_requirement: 'Requisito', infraction_index: 2, is_fine_validated: false,
};

let fetchMock: ReturnType<typeof vi.fn>;
let rolar: ReturnType<typeof vi.fn>;
const chamadas = (url: string, metodo: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === metodo);

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  rolar = vi.fn();
  Element.prototype.scrollIntoView = rolar; // jsdom não implementa
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/sst-checklist') && !init?.method) return ok([ITEM]);
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/checklist-sst (DS v2)', () => {
  it('mostra título, descrição e os cartões "Novo item" e a lista, com campos e botões nos primitivos', async () => {
    render(<AdminChecklistSstPage />);
    expect(await screen.findByRole('heading', { level: 2, name: /Checklist SST/ })).toBeInTheDocument();
    expect(screen.getByText(/Curadoria interna da Montese/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Novo item' }).closest('section')).toHaveClass('adm-card');
    expect((await screen.findByRole('heading', { level: 3, name: 'Itens (1)' })).closest('section')).toHaveClass('adm-card');
    expect(screen.getByLabelText('Código da NR')).toHaveClass('adm-input');
    expect(screen.getByLabelText('Categoria')).toHaveClass('adm-input');
    expect(screen.getByLabelText('Descrição')).toHaveClass('adm-input');
    expect(screen.getByRole('button', { name: 'Criar item' })).toHaveClass('adm-btn', 'adm-btn-primary');
    expect(screen.getByLabelText('Filtrar por NR')).toHaveClass('adm-input');
    expect(screen.getByRole('button', { name: 'Filtrar' })).toHaveClass('adm-btn');
    expect(await screen.findByRole('button', { name: 'Editar' })).toHaveClass('adm-link');
  });

  it('criar item continua enviando o mesmo POST (índice vazio vira null)', async () => {
    render(<AdminChecklistSstPage />);
    fireEvent.change(await screen.findByLabelText('Código da NR'), { target: { value: 'NR-06' } });
    fireEvent.change(screen.getByLabelText('Título da NR'), { target: { value: 'EPI' } });
    fireEvent.change(screen.getByLabelText('Nome do documento'), { target: { value: 'Ficha de EPI' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Descrição do documento' } });
    fireEvent.change(screen.getByLabelText('Requisito legal'), { target: { value: 'Requisito do documento' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar item' }));
    await waitFor(() => expect(chamadas('/api/sst-checklist', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/sst-checklist', 'POST')[0][1].body)).toEqual({
      nr_code: 'NR-06',
      nr_title: 'EPI',
      nr_category: 'geral',
      document_name: 'Ficha de EPI',
      description: 'Descrição do documento',
      legal_requirement: 'Requisito do documento',
      infraction_index: null,
    });
  });

  it('editar: preenche o formulário, rola até ele e envia PATCH com o corpo atualizado', async () => {
    render(<AdminChecklistSstPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Editar item' })).toBeInTheDocument();
    expect(screen.getByLabelText('Código da NR')).toHaveValue('NR-13');
    expect(rolar).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Nome do documento'), { target: { value: 'Prontuário atualizado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));
    await waitFor(() => expect(chamadas('/api/sst-checklist/i1', 'PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/sst-checklist/i1', 'PATCH')[0][1].body)).toMatchObject({
      nr_code: 'NR-13',
      document_name: 'Prontuário atualizado',
      infraction_index: 2,
    });
  });

  it('excluir pede confirmação e envia DELETE', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<AdminChecklistSstPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(chamadas('/api/sst-checklist/i1', 'DELETE')).toHaveLength(1));
  });

  it('filtrar por NR consulta /api/sst-checklist?nr_code=…', async () => {
    render(<AdminChecklistSstPage />);
    fireEvent.change(await screen.findByLabelText('Filtrar por NR'), { target: { value: 'NR-13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => u === '/api/sst-checklist?nr_code=NR-13')).toBe(true),
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `timeout 120 npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/checklist-sst-page.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar — imports e o tipo do ref**

Em `checklist-sst/page.tsx`, depois de `import { useRouter } from 'next/navigation';`:

```tsx
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Card } from '@/components/admin/Card';
```

E trocar `const formSectionRef = useRef<HTMLElement>(null);` por `const formSectionRef = useRef<HTMLDivElement>(null);` (o `Card` não repassa `ref`; o ref passa a ficar num `div` que o envolve, e `scrollIntoView` continua levando ao mesmo lugar).

- [ ] **Step 4: Implementar — o `return` final**

Substituir **todo o `return ( … );` final** (de `<div>\n      <h2 className="text-2xl font-bold text-brand-900">Checklist SST — catálogo de referência</h2>` até o fim) por:

```tsx
  return (
    <div>
      <AdminPageHeader
        title="Checklist SST — catálogo de referência"
        description="Curadoria interna da Montese sobre quais documentos uma empresa costuma precisar por NR — não é o texto oficial da norma. Usado pelo Assistente como uma fonte de citação rotulada como tal."
      />
      {actionError && <p className="mt-2 text-sm text-red-600">{actionError}</p>}

      <div ref={formSectionRef} className="mt-8">
        <Card title={editingId ? 'Editar item' : 'Novo item'}>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm text-brand-700">
              <span>Código da NR</span>
              <input
                placeholder="ex: NR-13"
                ref={firstFieldRef}
                value={form.nr_code}
                onChange={(e) => setForm({ ...form, nr_code: e.target.value })}
                required
                className="adm-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-700">
              <span>Título da NR</span>
              <input
                placeholder="ex: Segurança em Caldeiras"
                value={form.nr_title}
                onChange={(e) => setForm({ ...form, nr_title: e.target.value })}
                required
                className="adm-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-700">
              <span>Categoria</span>
              <select
                value={form.nr_category}
                onChange={(e) => setForm({ ...form, nr_category: e.target.value })}
                className="adm-input"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-700">
              <span>Índice de infração (0 a 4, opcional)</span>
              <input
                placeholder="ex: 2"
                type="number"
                min={0}
                max={4}
                value={form.infraction_index}
                onChange={(e) => setForm({ ...form, infraction_index: e.target.value })}
                className="adm-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-700 sm:col-span-2">
              <span>Nome do documento</span>
              <input
                placeholder="ex: Prontuário de caldeira"
                value={form.document_name}
                onChange={(e) => setForm({ ...form, document_name: e.target.value })}
                required
                className="adm-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-700 sm:col-span-2">
              <span>Descrição</span>
              <textarea
                placeholder="Descreva o documento e sua importância"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                required
                rows={3}
                className="adm-input"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-700 sm:col-span-2">
              <span>Requisito legal</span>
              <textarea
                placeholder="Qual é o requisito legal associado"
                value={form.legal_requirement}
                onChange={(e) => setForm({ ...form, legal_requirement: e.target.value })}
                required
                rows={3}
                className="adm-input"
              />
            </label>
            {saveStatus === 'erro' && (
              <p className="text-sm text-red-600 sm:col-span-2">Não foi possível salvar. Confira os campos.</p>
            )}
            <div className="flex gap-3 sm:col-span-2">
              <button
                type="submit"
                disabled={saveStatus === 'loading'}
                className="adm-btn adm-btn-primary self-start disabled:opacity-50"
              >
                {editingId ? 'Salvar edição' : 'Criar item'}
              </button>
              {editingId && (
                <button type="button" onClick={resetForm} className="adm-btn self-start">
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </Card>
      </div>

      <section className="adm-card mt-8 p-5 sm:p-6">
        <form onSubmit={handleFilter} className="flex gap-3">
          <input
            placeholder="Filtrar por NR (ex: NR-13)"
            aria-label="Filtrar por NR"
            value={filterNrCode}
            onChange={(e) => setFilterNrCode(e.target.value)}
            className="adm-input min-w-0 flex-1 text-sm"
          />
          <button type="submit" className="adm-btn">
            Filtrar
          </button>
        </form>

        <h3 className="mt-4 text-[15px] font-semibold text-brand-900">Itens ({items.length})</h3>
        <ul className="mt-4 flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="adm-card-2 flex items-center justify-between px-3 py-2 text-sm">
              <span>
                <strong>{item.nr_code}</strong> ({item.nr_category}) — {item.document_name}
              </span>
              <span className="flex gap-3">
                <button onClick={() => startEdit(item)} className="adm-link">
                  Editar
                </button>
                <button onClick={() => handleDelete(item.id)} className="text-red-600 underline">
                  Excluir
                </button>
              </span>
            </li>
          ))}
          {items.length === 0 && <p className="text-sm text-brand-700">Nenhum item encontrado.</p>}
        </ul>
      </section>
    </div>
  );
```

(Estado, `loadAll`, `startEdit`, `handleSubmit`, `handleDelete`, `handleFilter` e o `if (!ready)` **não mudam**.)

- [ ] **Step 5: Rodar e ver passar**

Run: `timeout 120 npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/checklist-sst-page.test.tsx && npx tsc --noEmit`
Expected: PASS; `tsc` limpo (o `useRef<HTMLDivElement>` combina com `ref={formSectionRef}` no `div`).

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `git diff --stat src/app/admin/checklist-sst/page.tsx`
Expected: só esse arquivo de página modificado nesta tarefa.

---

### Task 6: Verificação do lote, QA visual e doc de release

**Files:**
- Modify: `docs/operations/release-frontend-shell-empresa-2026-10-04.md` (nova camada)
- Sem código de produção novo (correção só se o QA achar defeito, e reportado).

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: relatório com VERIFICADO / NÃO VERIFICADO; seção nova no doc de release.

- [ ] **Step 1: Suíte, tipos, lint, build**

Run:
```bash
cd /opt/Montese/frontend
timeout 300 npx vitest run
npx tsc --noEmit
npx eslint src/app/admin src/components/admin --max-warnings=0
NODE_OPTIONS=--max-old-space-size=2048 timeout 540 npx next build
```
Expected: vitest tudo verde (189 + novos); `tsc` limpo; eslint 0 erros (o aviso preexistente em `components/admin/AdminBrand.tsx:13` é conhecido e não é desta frente); `next build` compila todas as rotas. Falha ⇒ parar e usar `superpowers:systematic-debugging`.

- [ ] **Step 2: QA visual com Playwright (API simulada)**

Seguir a memória `project_visual_qa_tooling`. Servir o build local numa porta livre (ex.: 3100), **sem Docker, sem produção, sem credenciais reais**, e encerrar o servidor no fim; usar `timeout` em comandos que possam travar. Sessão falsa: `montese_token` = JWT fake com `exp` futuro; `montese_user` = `{"id":"u1","role":"admin","tenantId":null}`. Interceptar `/api/**` com dados fictícios no formato que cada página espera (`/api/technicians`, `/api/partners`, `/api/tenants`, `/api/normative-sources`, `/api/normative-documents?status=…`, `/api/normative-documents/<id>`, `/api/sst-checklist`; a casca e o overview com objetos mínimos que não a quebrem).
Rotas: `/admin/tecnicos`, `/admin/parceiros`, `/admin/normativa`, `/admin/checklist-sst` em 1440×900 e 390×844, mais `/admin/empresas` como controle do Lote 1.
Por rota/viewport: 0 erros de console/pageerror; sem overflow horizontal da **página**; **ler os screenshots** (cartões, campos com borda visível sobre fundo escuro, selects e textareas legíveis, botão primário verde com texto escuro, "Rejeitar" vermelho legível, Badges, painel "Revisar versão" com contorno verde — confirmar que o `outline-adm-brand` realmente aparece —, listas em `adm-card-2`, nada cortado). Teclado: Tab chega aos campos/botões/links novos com foco visível.
Fluxos (conferir o corpo/URL da requisição): técnicos — criar e vincular a 2 empresas (2 POST); parceiros — criar e vincular; normativa — cadastrar fonte, abrir "Revisar", aprovar, rejeitar com motivo, reindexar; checklist — criar, editar (a tela rola até o formulário), excluir (com `confirm` aceito), filtrar.
Relatório em `/tmp/claude-0/-opt-Montese/6e630aed-15f7-43bf-8128-f2a5a86ad3a7/scratchpad/qa-admin-lote2/relatorio.md`: tabela rota × viewport (OK ou defeito + severidade + screenshot) e o que NÃO foi verificado.

- [ ] **Step 3: Atualizar o doc de release**

Em `docs/operations/release-frontend-shell-empresa-2026-10-04.md`, acrescentar depois da seção `## 0.2` uma seção `## 0.3 Camada 6 — admin DS v2, lote 2 (2026-10-05) — NÃO COMMITADA` com: spec e plano (caminhos), arquivos tocados (a tabela *File Structure* deste plano), resultados do Step 1 e do Step 2 com os marcadores, desvios aceitos (os da seção Global Constraints), a nota "**Não commitado**; commitar só estes arquivos; build de worktree limpa", defeitos e **pendências** (lote 3: `empresas/[id]`; busca por `placeholder` sem `label` em `normativa`, anterior a este lote; testes de `/status` do financeiro). Não executar nenhum passo 🔒.

- [ ] **Step 4: Checkpoint final (sem commit)**

Run: `git status --short`
Expected: os arquivos desta frente (File Structure) mais o WIP alheio que já existia, sem arquivo inesperado. Reportar ao proprietário e **parar**: commit e release são dele.

---

## Self-Review

- **Cobertura da spec (lote 2):** `tecnicos`, `parceiros`, `normativa`, `checklist-sst` (T2–T5); primitivo novo para ação destrutiva e teste de convenções mais forte, recomendado pela revisão final do Lote 1 (T1); render + corpos de requisição por formulário (T2–T5); QA e doc (T6). Lote 3 (`empresas/[id]`) fica para plano próprio.
- **Placeholders:** nenhum; trocas têm `old → new` exatos e os `return` de `normativa`/`checklist-sst` estão completos. Os condicionais (`outline-adm-brand`, comentário JSX) têm ação explícita.
- **Consistência de nomes:** `.adm-btn-danger` definido em T1 e usado em T4; `PAGINAS` só cresce (T2–T5); `AdminPageHeader`/`Card`/`Badge` com as mesmas assinaturas do Lote 1; todos os testes de página usam `vi.hoisted` para o router.
- **Desvios declarados:** botões sem `px-*`/`text-xs`; links sem sublinhado fixo; título `text-xl`; `div` com `ref` envolvendo o `Card` do checklist (`useRef<HTMLDivElement>`) porque o `Card` não repassa `ref`; destaque do painel "Revisar versão" via `outline` (o `.adm-card` vence `border-*`); caixa de checkboxes do vínculo de técnico usa `.adm-input` numa `div`; status de técnico/parceiro `neutral`.
