# Admin DS v2 — Lote 3 (`/admin/empresas/[id]`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar o Design System v2 (tema escuro mantido) à última página do admin que falta, `/admin/empresas/[id]` (detalhe da empresa), e fechar a pendência de testes das ações de assinatura (Pausar, Reativar, Cancelar com confirmação, histórico) também em `/admin/financeiro`.

**Architecture:** Mesmo padrão dos lotes 1 e 2 (`AdminPageHeader`, `Card`, `Badge`, `.adm-*`, `status-tone`). A página tem 5 blocos (dados, assinaturas, documentos, EPIs, inspeções, auditoria) e 4 tabelas. O nome da empresa continua sendo o `h2` da página (via `AdminPageHeader`); as seções viram `Card` (`h3`). As correções de layout mobile aprendidas no QA do lote 2 já entram aqui.

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind v4, vitest + Testing Library, Playwright (QA visual).

**Spec:** `docs/superpowers/specs/2026-10-05-admin-paginas-ds-v2-design.md` · **Lotes anteriores:** `…-lote1.md` e `…-lote2.md` (já executados; primitivos, `AdminPageHeader`, `status-tone.ts`, `.adm-btn-danger` e o teste de convenções reforçado existem).

## Global Constraints

- Só frontend (`frontend/src`) e docs. Sem backend, migration, Docker, Nginx, RBAC, RLS ou endpoints novos. **Tema escuro mantido.**
- Todos os comandos rodam em `/opt/Montese/frontend`. Sempre com `timeout` (ex.: `timeout 120 npx vitest run …`).
- **Sem `git commit`, `push`, `add`, `reset`, `revert`, `stash`** (AGENTS.md). Onde o skill diria "commit", faça só `git status --short <caminho>`. A árvore tem WIP de outras frentes: nunca `git add -A`, nunca tocar em `PenteFinoPanel*`, `backend/`.
- `admin-theme.css` não usa `@layer`: regras de convenção (verificadas por `src/app/admin/__tests__/convencoes-paginas.test.ts`): `adm-card`/`adm-card-2`/`adm-input`/`adm-btn`/`adm-table` não levam `rounded*`/`bg-*`/`border*`; `adm-input`/`adm-btn`/`adm-link` não levam padding; `adm-btn` não leva tamanho/peso de fonte nem cor de texto; `adm-link` não leva cor de texto. Permitidos: larguras, margens, `flex*`, `shrink-0`, `whitespace-nowrap`, `min-w-0`, `break-words`, `text-sm` (em `adm-link`/`adm-input`), `disabled:opacity-50`.
- `.adm-table` **não define cor de `td`**: as células mantêm `text-brand-900`/`text-brand-700`.
- Lógica, `fetch`, estados, handlers, textos visíveis e ordem **não mudam**. Desvios aceitos: status solto vira `Badge` com o **mesmo texto** (assinatura: `subscriptionTone`; status da empresa e da inspeção: `neutral`, valores não confirmados; status HTTP da auditoria: `httpStatusTone`); o status da assinatura perde os parênteses; seções `h2` viram `Card` (`h3`); o nome da empresa continua `h2`, agora via `AdminPageHeader`; ações em verde viram `.adm-link`.
- **Testes de página:** router **estável** (`vi.hoisted`) e `useParams` estável também; um objeto novo a cada render faz o efeito com `[router]` entrar em loop.
- Não editar `Card.tsx`, `AdminShell`, sidebar, topbar nem testes existentes, exceto o que cada tarefa diz.
- Comentários em PT-BR, curtos. Resposta final aos humanos em PT-BR com VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/app/admin/empresas/[id]/page.tsx` | modificar | Aplica primitivos |
| `src/app/admin/__tests__/empresas-detalhe-page.test.tsx` | criar | Render + ações de assinatura + histórico + 404 |
| `src/app/admin/__tests__/convencoes-paginas.test.ts` | modificar (só a lista `PAGINAS`) | Inclui a página |
| `src/app/admin/__tests__/financeiro-page.test.tsx` | modificar (só acrescentar) | Cobertura de Pausar/Reativar/Cancelar |
| `docs/operations/release-frontend-shell-empresa-2026-10-04.md` | modificar | Nova camada (Task 3) |

---

### Task 1: Página `/admin/empresas/[id]`

**Files:**
- Modify: `src/app/admin/empresas/[id]/page.tsx`
- Modify: `src/app/admin/__tests__/convencoes-paginas.test.ts` (linha `PAGINAS`)
- Create: `src/app/admin/__tests__/empresas-detalhe-page.test.tsx`

**Interfaces:**
- Consumes: `AdminPageHeader` (`@/components/admin/PageHeader`), `Card` e `Badge` (`@/components/admin/Card`), `httpStatusTone` e `subscriptionTone` (`@/components/admin/status-tone`), classes `.adm-card`, `.adm-card-2`, `.adm-table`, `.adm-link`.
- Produces: nada novo.

- [ ] **Step 1: Escrever os testes que falham**

Em `convencoes-paginas.test.ts`, acrescentar `'empresas/[id]/page.tsx'` ao fim da lista `PAGINAS` (mantendo as anteriores; nada mais muda no arquivo).

`src/app/admin/__tests__/empresas-detalhe-page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Router e params estáveis (como os reais do Next): a página tem `[router, tenantId]` nas deps do efeito
// de carga, e um objeto novo a cada render causaria loop infinito de fetch + setState.
const router = vi.hoisted(() => ({ push: vi.fn() }));
const params = vi.hoisted(() => ({ id: 't1' }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => params }));

import AdminEmpresaDetailPage from '../empresas/[id]/page';

const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
const DETALHE = {
  tenant: {
    id: 't1', name: 'Acme Ltda', cnpj: '00.000.000/0001-00', plan: 'Pro', status: 'ativo', sector: 'Indústria',
    contact_name: 'Carla', contact_phone: '48 99999-0000', technicians: [{ id: 'x', name: 'Ana' }], partners: [],
  },
  documents: [{ id: 'd1', category: 'PGR', title: 'PGR 2026', expires_at: '2026-12-31', created_at: '2026-01-01T00:00:00Z' }],
  epis: [{ id: 'p1', ca_number: '12345', ca_valid_until: '2027-01-31', category: 'cabeça', code: 'C1', description: 'Capacete' }],
  inspections: [{ id: 'i1', status: 'concluida', visited_at: '2026-09-01', concluded_at: '2026-09-02T10:00:00Z' }],
  subscriptions: [{ id: 's1', status: 'authorized', created_at: '2026-10-01T00:00:00Z', plan_name: 'Plano Pro', price_cents: 9900 }],
};
const AUDITORIA = [{ id: 'a1', occurred_at: '2026-10-05T12:00:00Z', actor_full_name: 'Ana', actor_role: 'admin', action: 'login', resource_type: 'users', status_code: 403 }];
const EVENTOS = [{ id: 'e1', amount_cents: 9900, status: 'approved', occurred_at: '2026-10-02T12:00:00Z' }];

let fetchMock: ReturnType<typeof vi.fn>;
const chamadas = (url: string, metodo: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === metodo);

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/tenants/t1/detail') return ok(DETALHE);
    if (String(url).startsWith('/api/audit-log')) return ok(AUDITORIA);
    if (url === '/api/subscriptions/s1/payment-events') return ok(EVENTOS);
    if (url === '/api/subscriptions/s1/status' && init?.method === 'PATCH') {
      const { status } = JSON.parse(init.body as string);
      return ok({ id: 's1', status, plan_name: 'Plano Pro', price_cents: 9900, created_at: '2026-10-01T00:00:00Z' });
    }
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/empresas/[id] (DS v2)', () => {
  it('mostra o nome da empresa como título, o link de voltar e os dados cadastrais', async () => {
    render(<AdminEmpresaDetailPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Acme Ltda' })).toBeInTheDocument();
    const voltar = screen.getByRole('link', { name: /Voltar para empresas/ });
    expect(voltar).toHaveAttribute('href', '/admin/empresas');
    expect(voltar).toHaveClass('adm-link');
    expect(screen.getByText('00.000.000/0001-00')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('ativo')).toHaveClass('rounded-full');
  });

  it('as 5 seções são cartões .adm-card e as 4 tabelas usam .adm-table', async () => {
    render(<AdminEmpresaDetailPage />);
    for (const nome of ['Assinaturas', 'Documentos', 'EPIs', 'Inspeções', 'Auditoria (últimos 20 eventos)']) {
      const titulo = await screen.findByRole('heading', { level: 3, name: nome });
      expect(titulo.closest('section')).toHaveClass('adm-card');
    }
    const tabelas = screen.getAllByRole('table');
    expect(tabelas).toHaveLength(4);
    tabelas.forEach((t) => expect(t).toHaveClass('adm-table'));
  });

  it('status viram Badge com o texto original: assinatura (verde), inspeção (neutro) e HTTP da auditoria (amarelo)', async () => {
    render(<AdminEmpresaDetailPage />);
    const assinatura = await screen.findByText('authorized');
    expect(assinatura).toHaveClass('rounded-full');
    expect(assinatura.className).toContain('text-adm-status-ok-text');
    expect(screen.getByText('concluida')).toHaveClass('rounded-full');
    const http = screen.getByText('403');
    expect(http).toHaveClass('rounded-full');
    expect(http.className).toContain('text-adm-status-warn-text');
  });

  it('Pausar envia PATCH /status {status:"paused"} e a linha passa a oferecer Reativar', async () => {
    render(<AdminEmpresaDetailPage />);
    const pausar = await screen.findByRole('button', { name: 'Pausar' });
    expect(pausar).toHaveClass('adm-link');
    fireEvent.click(pausar);
    await waitFor(() => expect(chamadas('/api/subscriptions/s1/status', 'PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/subscriptions/s1/status', 'PATCH')[0][1].body)).toEqual({ status: 'paused' });
    expect(await screen.findByRole('button', { name: 'Reativar' })).toBeInTheDocument();
    expect(screen.getByText('paused').className).toContain('text-adm-status-warn-text');
  });

  it('Cancelar pede confirmação: "Não" desiste sem requisição; "Sim, cancelar" envia {status:"cancelled"}', async () => {
    render(<AdminEmpresaDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('Cancelar de vez?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Não' }));
    expect(chamadas('/api/subscriptions/s1/status', 'PATCH')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }));
    await waitFor(() => expect(chamadas('/api/subscriptions/s1/status', 'PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/subscriptions/s1/status', 'PATCH')[0][1].body)).toEqual({ status: 'cancelled' });
    expect(await screen.findByText('cancelled')).toHaveClass('rounded-full');
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
  });

  it('Ver histórico busca as cobranças e alterna para "Ocultar histórico"', async () => {
    render(<AdminEmpresaDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver histórico' }));
    expect(await screen.findByText(/approved/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/subscriptions/s1/payment-events')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar histórico' }));
    expect(screen.queryByText(/approved/)).toBeNull();
  });

  it('empresa inexistente (404) mostra a mensagem e nenhuma seção', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/tenants/t1/detail' ? { ok: false, status: 404, json: async () => ({}) } : ok([]),
    );
    render(<AdminEmpresaDetailPage />);
    expect(await screen.findByText('Empresa não encontrada.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Assinaturas' })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/frontend && timeout 120 npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/empresas-detalhe-page.test.tsx`
Expected: FAIL (página ainda no estilo antigo; `h3`/`adm-card`/`adm-table`/`Badge` ausentes).

- [ ] **Step 3: Implementar — imports**

Em `empresas/[id]/page.tsx`, depois de `import Link from 'next/link';`:

```tsx
import { AdminPageHeader } from '@/components/admin/PageHeader';
import { Badge, Card } from '@/components/admin/Card';
import { httpStatusTone, subscriptionTone } from '@/components/admin/status-tone';
```

- [ ] **Step 4: Implementar — o `return` final**

Substituir **todo o `return ( … );` final** (de `<div>\n      <Link href="/admin/empresas" …` até o fim) por **este bloco, que inclui a `}` que fecha o componente** (mantenha uma única `}`; o `if (!ready)` e tudo acima do `return` **não mudam**):

```tsx
  return (
    <div>
      <Link href="/admin/empresas" className="adm-link text-sm">
        ← Voltar para empresas
      </Link>

      {loadError && <p className="mt-4 text-sm text-red-600">{loadError}</p>}

      {detail && (
        <>
          <div className="mt-6">
            <AdminPageHeader title={detail.tenant.name} />
          </div>
          <section className="adm-card mt-4 p-5 sm:p-6">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <dt className="text-brand-700">CNPJ</dt>
              <dd className="min-w-0 break-words text-brand-900">{detail.tenant.cnpj}</dd>
              <dt className="text-brand-700">Plano</dt>
              <dd className="min-w-0 break-words text-brand-900">{detail.tenant.plan}</dd>
              <dt className="text-brand-700">Status</dt>
              <dd className="min-w-0 break-words">
                <Badge tone="neutral">{detail.tenant.status}</Badge>
              </dd>
              <dt className="text-brand-700">Setor</dt>
              <dd className="min-w-0 break-words text-brand-900">{detail.tenant.sector ?? '—'}</dd>
              <dt className="text-brand-700">Contato</dt>
              <dd className="min-w-0 break-words text-brand-900">
                {detail.tenant.contact_name ?? '—'} {detail.tenant.contact_phone ? `— ${detail.tenant.contact_phone}` : ''}
              </dd>
              <dt className="text-brand-700">Técnicos vinculados</dt>
              <dd className="min-w-0 break-words text-brand-900">
                {detail.tenant.technicians.length === 0
                  ? '—'
                  : detail.tenant.technicians.map((t) => t.name).join(', ')}
              </dd>
              <dt className="text-brand-700">Parceiros vinculados</dt>
              <dd className="min-w-0 break-words text-brand-900">
                {detail.tenant.partners.length === 0 ? '—' : detail.tenant.partners.map((p) => p.name).join(', ')}
              </dd>
            </dl>
          </section>

          <Card title="Assinaturas" className="mt-8">
            {detail.subscriptions.length === 0 ? (
              <p className="text-sm text-brand-700">Nenhuma assinatura ainda.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {detail.subscriptions.map((sub) => (
                  <li key={sub.id} className="adm-card-2 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <div className="min-w-0 break-words">
                        <span className="font-medium text-brand-900">{sub.plan_name}</span>
                        <span className="ml-2 text-brand-700">{formatCents(sub.price_cents)}</span>
                        <span className="ml-2">
                          <Badge tone={subscriptionTone(sub.status)}>{sub.status}</Badge>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        {sub.status === 'authorized' && (
                          <button
                            onClick={() => handleUpdateStatus(sub.id, 'paused')}
                            disabled={statusUpdateState[sub.id] === 'loading'}
                            className="adm-link shrink-0 whitespace-nowrap disabled:opacity-50"
                          >
                            Pausar
                          </button>
                        )}
                        {sub.status === 'paused' && (
                          <button
                            onClick={() => handleUpdateStatus(sub.id, 'authorized')}
                            disabled={statusUpdateState[sub.id] === 'loading'}
                            className="adm-link shrink-0 whitespace-nowrap disabled:opacity-50"
                          >
                            Reativar
                          </button>
                        )}
                        {(sub.status === 'authorized' || sub.status === 'paused') &&
                          confirmingCancelId !== sub.id && (
                            <button
                              onClick={() => setConfirmingCancelId(sub.id)}
                              disabled={statusUpdateState[sub.id] === 'loading'}
                              className="text-red-600 hover:underline disabled:opacity-50"
                            >
                              Cancelar
                            </button>
                          )}
                        {confirmingCancelId === sub.id && (
                          <span className="flex items-center gap-2 text-xs">
                            <span className="text-brand-700">Cancelar de vez?</span>
                            <button
                              onClick={() => handleUpdateStatus(sub.id, 'cancelled')}
                              disabled={statusUpdateState[sub.id] === 'loading'}
                              className="font-medium text-red-600 hover:underline disabled:opacity-50"
                            >
                              Sim, cancelar
                            </button>
                            <button
                              onClick={() => setConfirmingCancelId(null)}
                              className="text-brand-700 hover:underline"
                            >
                              Não
                            </button>
                          </span>
                        )}
                        <button onClick={() => toggleHistory(sub.id)} className="adm-link shrink-0 whitespace-nowrap">
                          {expandedSubscriptionId === sub.id ? 'Ocultar histórico' : 'Ver histórico'}
                        </button>
                      </div>
                    </div>

                    {statusUpdateState[sub.id] === 'erro' && (
                      <p className="mt-2 text-xs text-red-600">Não foi possível atualizar o status da assinatura.</p>
                    )}

                    {expandedSubscriptionId === sub.id && (
                      <div className="mt-3 border-t border-brand-100 pt-3">
                        {(paymentEventsBySubscription[sub.id]?.length ?? 0) === 0 ? (
                          <p className="text-xs text-brand-700">Nenhuma cobrança registrada ainda.</p>
                        ) : (
                          <ul className="flex flex-col gap-1 text-xs text-brand-700">
                            {paymentEventsBySubscription[sub.id].map((event) => (
                              <li key={event.id}>
                                {formatDateTime(event.occurred_at)} — {formatCents(event.amount_cents)} —{' '}
                                {event.status}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Documentos" className="mt-8">
            {detail.documents.length === 0 ? (
              <p className="text-sm text-brand-700">Nenhum documento ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Título</th>
                      <th>Vencimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.documents.map((doc) => (
                      <tr key={doc.id}>
                        <td className="text-brand-700">{doc.category}</td>
                        <td className="text-brand-900">{doc.title}</td>
                        <td className="text-brand-700">{formatDate(doc.expires_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="EPIs" className="mt-8">
            {detail.epis.length === 0 ? (
              <p className="text-sm text-brand-700">Nenhum EPI cadastrado ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Equipamento</th>
                      <th>CA</th>
                      <th>Validade do CA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.epis.map((epi) => (
                      <tr key={epi.id}>
                        <td className="text-brand-700">{epi.category}</td>
                        <td className="text-brand-900">{epi.description}</td>
                        <td className="text-brand-700">{epi.ca_number}</td>
                        <td className="text-brand-700">{formatDate(epi.ca_valid_until)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Inspeções" className="mt-8">
            {detail.inspections.length === 0 ? (
              <p className="text-sm text-brand-700">Nenhuma inspeção ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Visita</th>
                      <th>Status</th>
                      <th>Concluída em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.inspections.map((inspection) => (
                      <tr key={inspection.id}>
                        <td className="text-brand-700">{formatDate(inspection.visited_at)}</td>
                        <td>
                          <Badge tone="neutral">{inspection.status}</Badge>
                        </td>
                        <td className="text-brand-700">
                          {inspection.concluded_at ? formatDateTime(inspection.concluded_at) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Auditoria (últimos 20 eventos)" className="mt-8">
            {auditLog.length === 0 ? (
              <p className="text-sm text-brand-700">Nenhum evento de auditoria encontrado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Quem</th>
                      <th>Ação</th>
                      <th>Recurso</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((row) => (
                      <tr key={row.id}>
                        <td className="text-brand-700">{formatDateTime(row.occurred_at)}</td>
                        <td className="text-brand-700">
                          {row.actor_full_name ?? '—'} {row.actor_role ? `(${row.actor_role})` : ''}
                        </td>
                        <td className="text-brand-900">{row.action}</td>
                        <td className="text-brand-700">{row.resource_type}</td>
                        <td>
                          <Badge tone={httpStatusTone(row.status_code)}>{row.status_code}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `timeout 120 npx vitest run src/app/admin/__tests__/convencoes-paginas.test.ts src/app/admin/__tests__/empresas-detalhe-page.test.tsx && npx tsc --noEmit && timeout 120 npx eslint "src/app/admin/empresas/[id]/page.tsx" --max-warnings=0`
Expected: PASS (convenções + 7 testes de render); `tsc` e eslint limpos. Conferir com `grep` que não sobrou `rounded-lg`, `rounded-md border border-brand-100`, `<section className="mt-` nem `py-2` na página (o único `border-brand-100` restante é o divisor `border-t border-brand-100 pt-3` do histórico). Conferir também (`git diff HEAD -- "src/app/admin/empresas/[id]/page.tsx"`, somente leitura) que o diff só toca imports e o `return`.

- [ ] **Step 6: Checkpoint (sem commit)**

Run: `git diff --stat "src/app/admin/empresas/[id]/page.tsx" && git status --short src/app/admin/__tests__`
Expected: só essa página modificada nesta tarefa; o teste novo como `??`.

---

### Task 2: Testes das ações de assinatura em `/admin/financeiro` (pendência dos lotes 1 e 2)

**Files:**
- Modify: `src/app/admin/__tests__/financeiro-page.test.tsx` (só acrescentar ao final)
- Sem alteração de código de produção.

**Interfaces:**
- Consumes: as constantes e o `fetchMock` já definidos no topo desse arquivo (`PLANO`, `ASSINATURA`, `fetchMock`, `chamadas`-equivalente — conferir os nomes reais no arquivo antes de acrescentar; o arquivo já define `PLANO`, `ASSINATURA` e `let fetchMock`).
- Produces: cobertura de Pausar, Reativar, Cancelar (com e sem confirmação) e do erro de atualização.

- [ ] **Step 1: Escrever os testes (devem passar de primeira: o código não muda)**

Acrescentar ao **final** de `financeiro-page.test.tsx`:

```tsx
describe('/admin/financeiro — ações de status da assinatura', () => {
  const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
  const patchs = () => fetchMock.mock.calls.filter(([u, init]) => u === '/api/subscriptions/s1/status' && init?.method === 'PATCH');

  // O PATCH devolve a assinatura inteira atualizada; a página substitui a linha por ela.
  function simular(statusInicial: string, falhar = false) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/plans') return ok([PLANO]);
      if (url === '/api/subscriptions' && !init?.method) return ok([{ ...ASSINATURA, status: statusInicial }]);
      if (url === '/api/subscriptions/s1/status' && init?.method === 'PATCH') {
        if (falhar) return { ok: false, json: async () => ({}) };
        return ok({ ...ASSINATURA, status: JSON.parse(init.body as string).status });
      }
      return ok({});
    });
  }

  it('Pausar envia PATCH {status:"paused"} e a linha passa a oferecer Reativar', async () => {
    simular('authorized');
    render(<AdminFinanceiroPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pausar' }));
    await waitFor(() => expect(patchs()).toHaveLength(1));
    expect(JSON.parse(patchs()[0][1].body)).toEqual({ status: 'paused' });
    expect(await screen.findByRole('button', { name: 'Reativar' })).toBeInTheDocument();
    expect(screen.getByText('paused').className).toContain('text-adm-status-warn-text');
  });

  it('Reativar envia PATCH {status:"authorized"}', async () => {
    simular('paused');
    render(<AdminFinanceiroPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reativar' }));
    await waitFor(() => expect(patchs()).toHaveLength(1));
    expect(JSON.parse(patchs()[0][1].body)).toEqual({ status: 'authorized' });
    expect(await screen.findByRole('button', { name: 'Pausar' })).toBeInTheDocument();
  });

  it('Cancelar pede confirmação: "Não" desiste sem requisição; "Sim, cancelar" envia {status:"cancelled"}', async () => {
    simular('authorized');
    render(<AdminFinanceiroPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('Cancelar de vez?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Não' }));
    expect(patchs()).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }));
    await waitFor(() => expect(patchs()).toHaveLength(1));
    expect(JSON.parse(patchs()[0][1].body)).toEqual({ status: 'cancelled' });
    expect(await screen.findByText('cancelled')).toHaveClass('rounded-full');
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
  });

  it('falha no PATCH mostra a mensagem de erro e mantém o status anterior', async () => {
    simular('authorized', true);
    render(<AdminFinanceiroPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pausar' }));
    expect(await screen.findByText('Não foi possível atualizar o status da assinatura.')).toBeInTheDocument();
    expect(screen.getByText('authorized')).toBeInTheDocument();
  });
});
```

(`render`, `screen`, `fireEvent`, `waitFor`, `fetchMock`, `PLANO`, `ASSINATURA` e `AdminFinanceiroPage` já existem no topo do arquivo. Se algum nome for diferente, ajustar **só o teste** ao que o arquivo define.)

- [ ] **Step 2: Rodar**

Run: `timeout 120 npx vitest run src/app/admin/__tests__/financeiro-page.test.tsx`
Expected: PASS (os 4 testes antigos + 4 novos). Se algum falhar por **comportamento real da página** (não por nome ou mock), **parar e reportar**: é um achado, não algo para "ajustar o teste até passar".

- [ ] **Step 3: Checkpoint (sem commit)**

Run: `git status --short src/app/admin/__tests__/financeiro-page.test.tsx`
Expected: arquivo ainda como `??` (novo na árvore desta frente) e nenhum arquivo de página tocado nesta tarefa.

---

### Task 3: Verificação do lote, QA visual e doc de release

**Files:**
- Modify: `docs/operations/release-frontend-shell-empresa-2026-10-04.md` (nova camada)
- Sem código de produção novo (correção só se o QA achar defeito, e reportado).

**Interfaces:**
- Consumes: Tasks 1–2.
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
Expected: vitest tudo verde (242 + novos); `tsc` limpo; eslint 0 erros (o aviso preexistente em `components/admin/AdminBrand.tsx:13` é conhecido e não é desta frente); `next build` compila todas as rotas. Falha ⇒ parar e usar `superpowers:systematic-debugging`.

- [ ] **Step 2: QA visual com Playwright (API simulada)**

Seguir a memória `project_visual_qa_tooling`. Servir o build local na porta 3100 (livre), **sem Docker, sem produção, sem credenciais reais**; guardar o PID e encerrar **só** o servidor próprio no fim — **nunca** o `next-server` com `cwd=/app` (é a PRODUÇÃO); usar `timeout`. Sessão falsa: `montese_token` = JWT fake com `exp` futuro; `montese_user` = `{"id":"u1","role":"admin","tenantId":null}`. Interceptar `/api/**` com dados fictícios: `/api/tenants/<id>/detail` (empresa com **nome, e-mail de técnico, setor e contato LONGOS**, 2 assinaturas `authorized` e `paused`, 3 documentos, 2 EPIs, 2 inspeções), `/api/audit-log?…` (linhas com 200, 403, 500), `/api/subscriptions/<id>/payment-events`, `PATCH /api/subscriptions/<id>/status` (devolve a assinatura atualizada); a casca e o overview com objetos mínimos que não a quebrem.
Rotas: `/admin/empresas/<id>` em 1440×900 e 390×844, mais `/admin/empresas` e `/admin/financeiro` como controle.
Por viewport: 0 erros de console/pageerror; `scrollWidth <= innerWidth` (**sem overflow da página**; atenção aos nomes longos, ao botão "Vincular…"-equivalente "Ver histórico"/"Ocultar histórico" e ao `dl` em 2 colunas); as 4 tabelas rolam dentro do cartão no mobile; **ler os screenshots** (nome da empresa como título, cartão de dados, Badges de status — assinatura verde/amarelo/neutro, inspeção neutro, HTTP 200 verde/403 amarelo/500 vermelho —, links verdes, "Cancelar" vermelho, nada cortado). Teclado: Tab chega às ações com foco visível.
Fluxos (conferir corpo/URL): Pausar → `PATCH {status:"paused"}` e o botão vira Reativar; Cancelar → confirmação → `PATCH {status:"cancelled"}`; Ver histórico mostra as cobranças.
Relatório em `/tmp/claude-0/-opt-Montese/6e630aed-15f7-43bf-8128-f2a5a86ad3a7/scratchpad/qa-admin-lote3/relatorio.md`: tabela rota × viewport (OK ou defeito + severidade + screenshot) e o que NÃO foi verificado.

- [ ] **Step 3: Atualizar o doc de release**

Em `docs/operations/release-frontend-shell-empresa-2026-10-04.md`, acrescentar depois da seção `## 0.3` uma seção `## 0.4 Camada 7 — admin DS v2, lote 3 (2026-10-05) — NÃO COMMITADA` com: spec e plano (caminhos), arquivos tocados (a tabela *File Structure* deste plano), resultados do Step 1 e do Step 2 com os marcadores, desvios aceitos (os da seção Global Constraints), a nota "**Não commitado**; depende das camadas 5 e 6 (mesmo commit ou `git add -p`); build de worktree limpa", defeitos e **pendências** (campos de `normativa` só com `placeholder`; `li` com nome de arquivo longo em `normativa`/`checklist-sst` sem `flex-wrap`/`min-w-0`; "Excluir" do checklist fora do `.adm-link`; `pente-fino` da empresa sem skin). Marcar que **com este lote todas as páginas do admin usam os primitivos** (exceto `/admin/overview`, que tem componentes próprios). Não executar nenhum passo 🔒.
Atualizar também a memória `project_dashboard_novo_todas_telas.md` (estado das camadas e pendências restantes).

- [ ] **Step 4: Checkpoint final (sem commit)**

Run: `git status --short`
Expected: os arquivos desta frente (File Structure) mais o WIP alheio que já existia, sem arquivo inesperado. Reportar ao proprietário e **parar**: commit e release são dele.

---

## Self-Review

- **Cobertura da spec (lote 3):** `empresas/[id]` com cartões, 4 tabelas, Badges, links e botões (T1); pendência de testes de `/status` dos lotes 1–2 fechada em `/admin/financeiro` (T2); QA, doc e memória (T3). Correções de layout mobile do QA do lote 2 já incorporadas (`shrink-0 whitespace-nowrap`, `min-w-0 break-words`).
- **Placeholders:** nenhum; o `return` completo está no plano **com a `}` do componente** (defeito dos lotes 1–2 não se repete); os testes são completos.
- **Consistência de nomes:** `AdminPageHeader`, `Card`, `Badge`, `httpStatusTone`, `subscriptionTone` existem (lotes 1–2) com as assinaturas usadas aqui; `PAGINAS` só cresce; router e `useParams` estáveis via `vi.hoisted`.
- **Desvios declarados:** seções `h2`→`Card` (`h3`) com o nome da empresa mantido como `h2`; o cartão de dados cadastrais é um `section.adm-card` sem título novo (o nome da empresa, logo acima, o nomeia); status de empresa/inspeção `neutral`; status HTTP da auditoria como `Badge` só com o código (a tabela não tem o método); status da assinatura sem parênteses.
