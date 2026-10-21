# Painel de Atuação — Fase 2 (painel `/atuacao` e carteira compartilhada) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao sócio (`socio`) uma área `/atuacao` com resumo da carteira Montese, lista de clientes e ficha do cliente com edição somente dos campos operacionais, tudo autorizado no servidor e no RLS.

**Architecture:** Policies RLS permissivas e específicas do `socio` (`SELECT` em `tenants`, `subscriptions`, `company_units`; `UPDATE` em `tenants`), todas condicionadas a `is_montese_tenant()`. Um módulo Nest `atuacao` (controller + service) com DTOs de saída explícitos e `@RequirePermission`. Frontend em `/atuacao` reaproveitando `RoleGuard`, `DashboardSidebar`, `DashboardHeader`, `DashSkin`, `KpiCard`, `PageHeader` e `AsyncBody`. A regra de "estado de assinatura" é extraída de `SubscriptionAccessService` para uma função pura reutilizada (sem duplicar a regra do ITEM 002).

**Tech Stack:** NestJS, TypeScript, PostgreSQL (`pg`), class-validator, Jest; Next.js, React, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-painel-atuacao-design.md` (Seções 3, 4, 7). **Pré-requisito:** Fases 0–1 prontas (`docs/superpowers/plans/2026-10-19-painel-atuacao-fase0-fase1.md`).

## Global Constraints

- Sem `commit`, `push`, `reset`: os passos "Checkpoint" só listam arquivos (AGENTS.md). Nada é aplicado em produção; migrations só no Postgres descartável.
- Nunca ler `.env`; é **proibido** `/opt/Montese/run-backend-tests.sh` (carrega o `.env` de produção). Unit: `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão>`. E2E: somente via runner do banco descartável (`<scratchpad>/run-e2e.sh <padrão> > <log> 2>&1`; recriar conforme a memória `reference_ensaio_descartavel_isolado` se o ambiente não existir). Nunca passar senhas a subagentes.
- Nenhum `@Roles` existente passa a incluir `socio`. Toda rota nova do `socio` usa `@Roles('socio')` **e** `@RequirePermission(...)`.
- O `socio` **nunca** altera: `cnpj`, `name` (razão social), `plan`, `status`, `logo_file_key`, nem qualquer dado de assinatura/cobrança. Campos editáveis (lista fechada): `trade_name`, `sector`, `contact_name`, `contact_role`, `contact_phone`, `notes`.
- DTOs de saída explícitos: não devolver `logo_file_key`, `mercadopago_*`, nem `SELECT *`.
- Novo chamador direto de `withTenantContext` exige entrada em `ALLOWED` de `backend/test/tenant-context-callsites.unit-spec.ts` (ITEM 008). Este plano usa `req.withTenantContext`, que não exige.
- Migration: `0092` (confirmar que está livre em todas as branches, como na Task 1 da Fase 1). Responder em português do Brasil; rotular VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
- Fora de escopo (decidido): atribuição de responsáveis por cliente (`tenant_owners`) fica para a Fase 3 (tarefas individuais); tarefas, agenda, documentos e financeiro detalhado ficam nas Fases 3–5; policy de escrita só-admin em `plans` fica para a Fase 4.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/db/migrations/0092_socio_carteira_policies.sql` (criar) | Policies do `socio` |
| `backend/src/payments/subscription-access.service.ts` (modificar) | Exporta `deriveAccessState` |
| `backend/test/subscription-access-state.unit-spec.ts` (criar) | Unit da função pura |
| `backend/src/atuacao/atuacao.module.ts` (criar) | Módulo |
| `backend/src/atuacao/atuacao.controller.ts` (criar) | Rotas `/atuacao/*` |
| `backend/src/atuacao/atuacao.service.ts` (criar) | Consultas e atualização |
| `backend/src/atuacao/dto/update-cliente-operacional.dto.ts` (criar) | Campos editáveis |
| `backend/src/app.module.ts` (modificar) | Registrar `AtuacaoModule` |
| `backend/test/atuacao-service.unit-spec.ts` (criar) | Unit do service |
| `backend/test/atuacao-carteira.e2e-spec.ts` (criar) | E2E (RLS + HTTP) |
| `frontend/src/lib/auth.ts` (modificar) | Papel `socio`, `homeFor` |
| `frontend/src/app/(site)/login/page.tsx` (modificar) | Redirecionar `socio` |
| `frontend/src/lib/dashboard/menu-atuacao.ts` (criar) | Itens do menu |
| `frontend/src/components/dashboard/AtuacaoShell.tsx` (criar) | Casca |
| `frontend/src/app/atuacao/layout.tsx`, `page.tsx` (criar) | Layout e resumo |
| `frontend/src/app/atuacao/clientes/page.tsx`, `[tenantId]/page.tsx` (criar) | Lista e ficha |
| `frontend/src/app/atuacao/__tests__/*.test.tsx` (criar) | Vitest |

---

### Task 1: Migration 0092 — policies RLS do `socio`

**Files:**
- Create: `backend/db/migrations/0092_socio_carteira_policies.sql`
- Test: `backend/test/atuacao-carteira.e2e-spec.ts` (bloco RLS)

**Interfaces:**
- Consumes: `is_montese_tenant(UUID)` (0091), role `socio` (0090).
- Produces: policies `tenants_socio_select`, `tenants_socio_update`, `subscriptions_socio_select`, `company_units_socio_select`.

- [ ] **Step 1: Confirmar que 0092 está livre**

Run: `cd /opt/Montese && for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do git ls-tree --name-only "$b" backend/db/migrations/ | grep -E '/0092_' | sed "s|^|$b: |"; done; ls backend/db/migrations | grep -E '^0092_' || echo livre`
Expected: `livre`. Se colidir, usar o próximo número livre em todo o plano.

- [ ] **Step 2: Escrever o teste RLS que falha (no e2e)**

`backend/test/atuacao-carteira.e2e-spec.ts` (mesmos `beforeAll/afterAll`, envs fake de Google e override do `MercadoPagoService` de `socio-access-matrix.e2e-spec.ts`; reaproveitar `loginToken`). Bloco RLS usando uma conexão `pg` com a role da aplicação (`DATABASE_URL`) e transação com `set_config` local, como `DatabaseService.withTenantContext`:
```ts
async function comoSocio<T>(userId: string, fn: (c: any) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', '', true), set_config('app.role', 'socio', true)", [userId]);
    const out = await fn(client);
    await client.query('ROLLBACK');
    return out;
  } finally { await client.end(); }
}

it('socio vê tenant Montese (sem vínculo) e não vê tenant de técnico', async () => {
  const socio = await db.createUserWithRole('socio', 'Socio RLS');
  const montese = await db.createTenantWithUser('Cliente Montese RLS');
  const tecnico = await db.createUserWithRole('tecnico', 'Tec RLS');
  const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.id]);
  const parceiro = await db.createTenantWithUser('Cliente Parceiro RLS');
  await db.client.query("INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)", [parceiro.tenantId, tec.rows[0].id]);

  const ids = await comoSocio(socio.id, async (c) => (await c.query('SELECT id FROM tenants')).rows.map((r: any) => r.id));
  expect(ids).toContain(montese.tenantId);
  expect(ids).not.toContain(parceiro.tenantId);
});

it('socio atualiza campo de tenant Montese e NÃO atualiza tenant de técnico (0 linhas)', async () => { /* UPDATE tenants SET sector = 'X' WHERE id = $1 RETURNING id nas duas empresas; esperar rowCount 1 e 0 */ });
it('socio não faz INSERT nem DELETE em tenants', async () => { /* INSERT INTO tenants(name,cnpj) ... deve lançar; DELETE ... rowCount 0 */ });
it('socio lê subscriptions e company_units só de tenant Montese', async () => { /* inserir 1 assinatura e 1 unidade em cada tenant (via db.client, superusuário) e conferir contagens do socio */ });
```
Ajustar nomes reais de campos de `TestUserFixture` (`id`/`userId`) e colunas obrigatórias de `tenants`, `subscriptions` (precisa `plan_id` de `SELECT id FROM plans LIMIT 1`) e `company_units` (endereço completo) lendo `db-test-helper.ts` e as migrations 0006/0007.

- [ ] **Step 3: Rodar e ver falhar**

Run: `<scratchpad>/run-e2e.sh atuacao-carteira > <scratchpad>/e2e-t1.log 2>&1; grep -E "✓|✕|Tests:" <scratchpad>/e2e-t1.log`
Expected: FAIL (socio não enxerga `tenants`).

- [ ] **Step 4: Escrever a migration**

```sql
-- Painel de Atuação (Fase 2). Policies PERMISSIVAS e específicas do `socio`
-- (somem na ausência do papel; somam-se às existentes). Todas limitadas à
-- carteira Montese via is_montese_tenant() (SECURITY DEFINER, 0091), que lê os
-- vínculos sem passar por RLS — não há recursão.
-- Escrita do socio SÓ em tenants (UPDATE); a lista de colunas editáveis é
-- imposta na API (RLS não restringe colunas). subscriptions e company_units:
-- somente SELECT. Nenhum INSERT/DELETE para o socio em tabela alguma.

CREATE POLICY tenants_socio_select ON tenants FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(id));

CREATE POLICY tenants_socio_update ON tenants FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(id));

CREATE POLICY subscriptions_socio_select ON subscriptions FOR SELECT
  USING (current_setting('app.role', true) = 'socio'
         AND tenant_id IS NOT NULL AND is_montese_tenant(tenant_id));

CREATE POLICY company_units_socio_select ON company_units FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
```

- [ ] **Step 5: Aplicar só no descartável e ver passar**

Aplicar: `docker exec -i socio_ensaio_pg psql -U ensaio_su -d montese_ensaio -v ON_ERROR_STOP=1 --single-transaction -q -f - < backend/db/migrations/0092_socio_carteira_policies.sql` (somente o container descartável `socio_ensaio_pg`; **nunca** `montese_postgres`).
Run: o mesmo comando do Step 3. Expected: PASS.

- [ ] **Step 6: Checkpoint** — listar arquivos; não commitar.

---

### Task 2: Extrair `deriveAccessState` (regra única do estado de assinatura)

**Files:**
- Modify: `backend/src/payments/subscription-access.service.ts`
- Test: `backend/test/subscription-access-state.unit-spec.ts`

**Interfaces:**
- Produces: `export function deriveAccessState(row: { has_authorized: boolean; has_recent_pending: boolean; has_lapsed: boolean }): SubscriptionAccess` — mesma precedência de hoje: `ativa` > `pendente` > `inativa` > `trial`. `stateFor` passa a chamá-la; comportamento inalterado.

- [ ] **Step 1: Teste que falha**

```ts
import { deriveAccessState } from '../src/payments/subscription-access.service';

describe('deriveAccessState', () => {
  const base = { has_authorized: false, has_recent_pending: false, has_lapsed: false };
  it('ativa quando há assinatura authorized, mesmo com outras', () => {
    expect(deriveAccessState({ has_authorized: true, has_recent_pending: true, has_lapsed: true })).toBe('ativa');
  });
  it('pendente tem precedência sobre inativa', () => {
    expect(deriveAccessState({ ...base, has_recent_pending: true, has_lapsed: true })).toBe('pendente');
  });
  it('inativa quando só há cancelled/paused', () => {
    expect(deriveAccessState({ ...base, has_lapsed: true })).toBe('inativa');
  });
  it('trial quando nunca assinou', () => {
    expect(deriveAccessState(base)).toBe('trial');
  });
});
```
Run: `... jest-unit.json subscription-access-state` → FAIL (export inexistente).

- [ ] **Step 2: Implementar** — em `subscription-access.service.ts`, acima da classe:
```ts
export function deriveAccessState(row: {
  has_authorized: boolean;
  has_recent_pending: boolean;
  has_lapsed: boolean;
}): SubscriptionAccess {
  if (row.has_authorized) return 'ativa';
  if (row.has_recent_pending) return 'pendente';
  if (row.has_lapsed) return 'inativa';
  return 'trial';
}
```
e em `stateFor`, trocar as 4 linhas `if (...) return ...` finais por `return deriveAccessState(result.rows[0]);` (a `const row` deixa de ser usada).

- [ ] **Step 3: Rodar** — `subscription-access-state` e `subscription-status-guard.e2e-spec` (via runner descartável): PASS (regressão do ITEM 002). `npx tsc --noEmit -p tsconfig.json`.

- [ ] **Step 4: Checkpoint** — listar arquivos.

---

### Task 3: Módulo `atuacao` (resumo, lista, ficha e edição operacional)

**Files:**
- Create: `backend/src/atuacao/atuacao.module.ts`, `atuacao.controller.ts`, `atuacao.service.ts`, `dto/update-cliente-operacional.dto.ts`
- Modify: `backend/src/app.module.ts` (importar `AtuacaoModule`)
- Test: `backend/test/atuacao-service.unit-spec.ts`; ampliar `backend/test/atuacao-carteira.e2e-spec.ts`

**Interfaces:**
- Consumes: `deriveAccessState` (Task 2); `buildSafeSetClause(data, allowed, startIndex)`; `req.withTenantContext(fn)`; `AuditService.log`.
- Produces (HTTP, todas `@Roles('socio')`):
  - `GET /atuacao/resumo` (`clients.read`) → `{ total, ativos, trial, pendentes, inativos }`
  - `GET /atuacao/clientes?q=&situacao=` (`clients.read`; `situacao` ∈ `ativa|trial|pendente|inativa`) → `ClienteResumo[]` (máx. 200)
  - `GET /atuacao/clientes/:tenantId` (`clients.read`; `ParseUUIDPipe`) → `ClienteFicha`
  - `PATCH /atuacao/clientes/:tenantId` (`clients.update_operational`) → `ClienteFicha`
- Tipos: `ClienteResumo { id, name, trade_name, cnpj, sector, contact_name, contact_phone, status, situacao }`; `ClienteFicha = ClienteResumo & { contact_role, notes, plan, created_at, units: { id, name, address_city, address_state, status }[] }`.

- [ ] **Step 1: Testes unitários que falham** (`atuacao-service.unit-spec.ts`, client `pg` mockado como em `normative-monitor-guard.unit-spec.ts`):
```ts
import { AtuacaoService, CAMPOS_OPERACIONAIS } from '../src/atuacao/atuacao.service';

function montar(rows: Record<string, any[]>) {
  const consultas: { sql: string; params: any[] }[] = [];
  const client: any = {
    query: jest.fn(async (sql: string, params: any[] = []) => {
      consultas.push({ sql, params });
      const chave = Object.keys(rows).find((k) => sql.includes(k));
      return { rows: chave ? rows[chave] : [], rowCount: chave ? rows[chave].length : 0 };
    }),
  };
  return { service: new AtuacaoService(), client, consultas };
}

describe('AtuacaoService', () => {
  it('só permite os 6 campos operacionais', () => {
    expect([...CAMPOS_OPERACIONAIS].sort()).toEqual(
      ['contact_name', 'contact_phone', 'contact_role', 'notes', 'sector', 'trade_name'],
    );
  });

  it('classifica situação via deriveAccessState e filtra por situacao', async () => {
    const { service, client } = montar({
      'FROM tenants t': [
        { id: 'a', name: 'A', has_authorized: true, has_recent_pending: false, has_lapsed: false },
        { id: 'b', name: 'B', has_authorized: false, has_recent_pending: false, has_lapsed: true },
      ],
    });
    const todos = await service.listar(client, {});
    expect(todos.map((c) => [c.id, c.situacao])).toEqual([['a', 'ativa'], ['b', 'inativa']]);
    const inativos = await service.listar(client, { situacao: 'inativa' });
    expect(inativos.map((c) => c.id)).toEqual(['b']);
  });

  it('resumo conta cada situação', async () => {
    const { service, client } = montar({
      'FROM tenants t': [
        { id: 'a', has_authorized: true, has_recent_pending: false, has_lapsed: false },
        { id: 'b', has_authorized: false, has_recent_pending: true, has_lapsed: false },
        { id: 'c', has_authorized: false, has_recent_pending: false, has_lapsed: false },
      ],
    });
    expect(await service.resumo(client)).toEqual({ total: 3, ativos: 1, trial: 1, pendentes: 1, inativos: 0 });
  });

  it('atualizar ignora campos fora da lista e nunca grava cnpj/plan/status/name', async () => {
    const { service, client, consultas } = montar({ 'UPDATE tenants': [{ id: 't1' }], 'FROM tenants t': [{ id: 't1', has_authorized: false, has_recent_pending: false, has_lapsed: false }] });
    await service.atualizarOperacional(client, 't1', { sector: 'Metal', cnpj: '1', plan: 'x', status: 'ativo', name: 'N' } as any);
    const update = consultas.find((c) => c.sql.includes('UPDATE tenants'))!;
    expect(update.sql).toContain('sector = $2');
    for (const proibido of ['cnpj', 'plan', 'status', 'name =']) expect(update.sql).not.toContain(proibido);
  });

  it('atualizar devolve NotFound quando o RLS esconde o tenant (0 linhas)', async () => {
    const { service, client } = montar({});
    await expect(service.atualizarOperacional(client, 't9', { sector: 'X' })).rejects.toThrow('Cliente não encontrado');
  });
});
```
Run → FAIL (módulo inexistente).

- [ ] **Step 2: DTO**

`dto/update-cliente-operacional.dto.ts`:
```ts
import { IsOptional, IsString, MaxLength } from 'class-validator';

// Lista FECHADA de campos que o sócio pode editar. O ValidationPipe global
// (whitelist + forbidNonWhitelisted) devolve 400 para qualquer outra propriedade
// (cnpj, name, plan, status...).
export class UpdateClienteOperacionalDto {
  @IsOptional() @IsString() @MaxLength(200) trade_name?: string;
  @IsOptional() @IsString() @MaxLength(200) sector?: string;
  @IsOptional() @IsString() @MaxLength(200) contact_name?: string;
  @IsOptional() @IsString() @MaxLength(100) contact_role?: string;
  @IsOptional() @IsString() @MaxLength(30) contact_phone?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
```

- [ ] **Step 3: Service**

`atuacao.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';
import { deriveAccessState, SubscriptionAccess } from '../payments/subscription-access.service';

export const CAMPOS_OPERACIONAIS = ['trade_name', 'sector', 'contact_name', 'contact_role', 'contact_phone', 'notes'] as const;

export interface ClienteResumo {
  id: string; name: string; trade_name: string | null; cnpj: string; sector: string | null;
  contact_name: string | null; contact_phone: string | null; status: string; situacao: SubscriptionAccess;
}
export interface ClienteFicha extends ClienteResumo {
  contact_role: string | null; notes: string | null; plan: string; created_at: string;
  units: { id: string; name: string; address_city: string; address_state: string; status: string }[];
}

const SELECT_BASE = `
  SELECT t.id, t.name, t.trade_name, t.cnpj, t.sector, t.contact_name, t.contact_phone, t.status,
         t.contact_role, t.notes, t.plan, t.created_at,
         EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.status = 'authorized') AS has_authorized,
         EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.status = 'pending'
                 AND s.created_at > now() - interval '3 days') AS has_recent_pending,
         EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.status IN ('cancelled','paused')) AS has_lapsed
  FROM tenants t`;

function paraResumo(r: any): ClienteResumo {
  return {
    id: r.id, name: r.name, trade_name: r.trade_name ?? null, cnpj: r.cnpj, sector: r.sector ?? null,
    contact_name: r.contact_name ?? null, contact_phone: r.contact_phone ?? null, status: r.status,
    situacao: deriveAccessState(r),
  };
}

@Injectable()
export class AtuacaoService {
  // Sem filtro de carteira no SQL: o RLS (tenants_socio_select + is_montese_tenant)
  // já restringe a empresas Montese, mesma convenção do resto do código.
  async listar(client: PoolClient, f: { q?: string; situacao?: SubscriptionAccess }): Promise<ClienteResumo[]> {
    const like = f.q ? `%${f.q.replace(/[\\%_]/g, '\\$&')}%` : null;
    const res = await client.query(
      `${SELECT_BASE}
       WHERE ($1::text IS NULL OR t.name ILIKE $1 OR t.trade_name ILIKE $1 OR t.cnpj LIKE $1)
       ORDER BY t.name LIMIT 200`,
      [like],
    );
    const todos = res.rows.map(paraResumo);
    return f.situacao ? todos.filter((c) => c.situacao === f.situacao) : todos;
  }

  async resumo(client: PoolClient) {
    const res = await client.query(`${SELECT_BASE} ORDER BY t.name`);
    const lista = res.rows.map(paraResumo);
    const n = (s: SubscriptionAccess) => lista.filter((c) => c.situacao === s).length;
    return { total: lista.length, ativos: n('ativa'), trial: n('trial'), pendentes: n('pendente'), inativos: n('inativa') };
  }

  async ficha(client: PoolClient, tenantId: string): Promise<ClienteFicha> {
    const res = await client.query(`${SELECT_BASE} WHERE t.id = $1`, [tenantId]);
    const r = res.rows[0];
    if (!r) throw new NotFoundException('Cliente não encontrado');
    const units = await client.query(
      'SELECT id, name, address_city, address_state, status FROM company_units WHERE tenant_id = $1 ORDER BY name',
      [tenantId],
    );
    return { ...paraResumo(r), contact_role: r.contact_role ?? null, notes: r.notes ?? null, plan: r.plan, created_at: r.created_at, units: units.rows };
  }

  async atualizarOperacional(client: PoolClient, tenantId: string, data: Partial<Record<(typeof CAMPOS_OPERACIONAIS)[number], string>>): Promise<ClienteFicha> {
    const { setClauses, values } = buildSafeSetClause(data, CAMPOS_OPERACIONAIS, 2);
    if (setClauses.length > 0) {
      const upd = await client.query(`UPDATE tenants SET ${setClauses.join(', ')} WHERE id = $1 RETURNING id`, [tenantId, ...values]);
      if (upd.rowCount === 0) throw new NotFoundException('Cliente não encontrado');
    }
    return this.ficha(client, tenantId);
  }
}
```
No teste "NotFound quando RLS esconde", `montar({})` devolve `rowCount: 0` para o UPDATE — o service lança como esperado.

- [ ] **Step 4: Controller e módulo**

`atuacao.controller.ts`:
```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { AuditService } from '../common/audit/audit.service';
import { AtuacaoService } from './atuacao.service';
import { UpdateClienteOperacionalDto } from './dto/update-cliente-operacional.dto';
import type { SubscriptionAccess } from '../payments/subscription-access.service';

class ListarClientesQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(['ativa', 'trial', 'pendente', 'inativa']) situacao?: SubscriptionAccess;
}

@Controller('atuacao')
@Roles('socio')
export class AtuacaoController {
  constructor(private readonly atuacao: AtuacaoService, private readonly audit: AuditService) {}

  @RequirePermission('clients.read')
  @Get('resumo')
  resumo(@Req() req: any) {
    return req.withTenantContext((c: any) => this.atuacao.resumo(c));
  }

  @RequirePermission('clients.read')
  @Get('clientes')
  listar(@Query() q: ListarClientesQuery, @Req() req: any) {
    return req.withTenantContext((c: any) => this.atuacao.listar(c, q));
  }

  @RequirePermission('clients.read')
  @Get('clientes/:tenantId')
  ficha(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Req() req: any) {
    return req.withTenantContext((c: any) => this.atuacao.ficha(c, tenantId));
  }

  @RequirePermission('clients.update_operational')
  @Patch('clientes/:tenantId')
  async atualizar(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: UpdateClienteOperacionalDto, @Req() req: any) {
    const ficha = await req.withTenantContext((c: any) => this.atuacao.atualizarOperacional(c, tenantId, dto));
    // Auditoria: só os NOMES dos campos alterados (nunca os valores).
    await this.audit.log({
      actorUserId: req.user.id, actorRole: req.user.role, action: 'client.update_operational',
      resourceType: 'tenant', resourceId: tenantId, method: req.method, path: req.url, statusCode: 200,
      ipAddress: req.ip, detail: `campos: ${Object.keys(dto).join(', ')}`,
    });
    return ficha;
  }
}
```
`atuacao.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AtuacaoController } from './atuacao.controller';
import { AtuacaoService } from './atuacao.service';

@Module({ controllers: [AtuacaoController], providers: [AtuacaoService] })
export class AtuacaoModule {}
```
Em `app.module.ts`: `import { AtuacaoModule } from './atuacao/atuacao.module';` e `AtuacaoModule` em `imports`.

- [ ] **Step 5: Unit + tipos**

Run: `... jest-unit.json atuacao-service socio-controller-sweep roles-guard-socio permissions-guard tenant-context-callsites` e `npx tsc --noEmit -p tsconfig.json`.
Expected: PASS. A varredura da Fase 1 deve continuar verde (o `AtuacaoController` lista `socio` **com** `@RequirePermission` em todas as rotas); se a regra "só auth/me lista socio sem permissão" acusar o controller por `@Roles` na classe sem permissão por rota, corrigir a rota, não a regra.

- [ ] **Step 6: E2E HTTP (ampliar `atuacao-carteira.e2e-spec.ts`)**

Casos (login real via `/auth/login`, tenant Montese e tenant de técnico criados como na Task 1; conceder `clients.read` com `db.grantSocioPermission`):
```ts
it('socio sem permissão recebe 403 PERMISSION_DENIED e a negação é auditada', async () => { /* GET /atuacao/clientes sem grant -> 403; SELECT count(*) FROM audit_log WHERE action='permission.denied' AND actor_user_id=$1 -> >= 1 */ });
it('com clients.read lista só clientes Montese', async () => { /* contém o Montese, não contém o do técnico */ });
it('ficha de tenant de técnico retorna 404 (não 403) e a de Montese 200 com units', async () => {});
it('resumo bate com a contagem real: cria assinatura authorized num tenant e confere ativos', async () => {});
it('PATCH altera sector, e cnpj/plan/name/status no corpo retornam 400 e o dado NÃO muda', async () => { /* conferir SELECT depois */ });
it('PATCH sem clients.update_operational retorna 403 e o dado NÃO muda', async () => {});
it('PATCH grava auditoria com nomes de campos e sem valores', async () => {});
it('empresa, técnico e admin recebem 403 em /atuacao/*', async () => {});
```
Cada caso afirma o dado correto retornado ou o dado intacto (spec §7). Rodar com o runner descartável; Expected: PASS.

- [ ] **Step 7: Regressão** — via runner: `socio-access-matrix auth admin-dashboard-financeiro tenant-isolation-sweep subscription-status-guard`. `npm run build`.

- [ ] **Step 8: Checkpoint** — listar arquivos; não commitar.

---

### Task 4: Frontend `/atuacao`

**Files:**
- Modify: `frontend/src/lib/auth.ts` (`SessionUser.role` inclui `'socio'`; `homeFor('socio')` → `/atuacao`), `frontend/src/app/(site)/login/page.tsx` (redirect do `socio` → `/atuacao`)
- Create: `frontend/src/lib/dashboard/menu-atuacao.ts`, `frontend/src/components/dashboard/AtuacaoShell.tsx`, `frontend/src/app/atuacao/layout.tsx`, `page.tsx`, `clientes/page.tsx`, `clientes/[tenantId]/page.tsx`
- Test: `frontend/src/app/atuacao/__tests__/layout.test.tsx`, `clientes.test.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /atuacao/*` (Task 3); `RoleGuard`, `DashboardSidebar`, `DashboardHeader`, `DashSkin`, `KpiCard`, `PageHeader`, `AsyncBody`, `MenuItem`.
- Produces: rotas `/atuacao`, `/atuacao/clientes`, `/atuacao/clientes/[tenantId]`.

- [ ] **Step 1: Testes que falham (Vitest)**

Seguir o padrão de `frontend/src/app/tecnico/__tests__/layout.test.tsx` (ler antes: mocks de `next/navigation` e de `localStorage`). Casos:
- `homeFor('socio')` retorna `/atuacao`; `homeFor` dos outros papéis inalterado.
- O layout de `/atuacao` renderiza o conteúdo para `socio` e redireciona `empresa`/`tecnico`/`admin` (via `RoleGuard allow={['socio']}`).
- Página de clientes: mostra os clientes retornados, filtra por busca/situação (chama `fetch` com `q`/`situacao`), mostra o estado de erro com "Tentar novamente" e, em 403, a mensagem "Você não tem permissão para esta ação.".
- Ficha: submete só os 6 campos editáveis; ao receber 400/403 exibe mensagem clara e mantém o formulário.
Run: `cd /opt/Montese/frontend && npx vitest run src/app/atuacao` → FAIL.

- [ ] **Step 2: Implementar auth e login**

`lib/auth.ts`: `role: 'empresa' | 'tecnico' | 'parceiro' | 'admin' | 'socio'`; em `homeFor`, antes do `return '/'`: `if (role === 'socio') return '/atuacao';`. `login/page.tsx`: acrescentar `: role === 'socio' ? '/atuacao'` antes do `: '/'` final do ternário (VERIFICAR os arquivos e manter o estilo existente).

- [ ] **Step 3: Menu, casca, layout**

`menu-atuacao.ts` (mesmo tipo `MenuItem` de `menu-tecnico.ts`; ícones lucide `LayoutDashboard`, `Building2`): `/atuacao` "Painel" e `/atuacao/clientes` "Clientes Montese", ambos `implemented: true`. **Só rotas que existem** (nada de itens futuros: Tarefas, Agenda, Documentação e Financeiro entram nas Fases 3–5). `AtuacaoShell.tsx`: cópia estrutural de `TecnicoShell` com `items={ATUACAO_MENU_ITEMS}`, rótulo `'Sócio'`, `papel="Montese SST"`. `app/atuacao/layout.tsx`: igual ao do técnico com `<RoleGuard allow={['socio']}>`, `AtuacaoShell`, `DashSkin`.

- [ ] **Step 4: Páginas**

- `page.tsx` ("Painel"): `PageHeader` + 4 `KpiCard` (Clientes Montese, Ativos, Em teste, Inativos) vindos de `GET /atuacao/resumo` dentro de `AsyncBody`; link "Ver clientes". Sem números fictícios; erro e carregamento tratados.
- `clientes/page.tsx`: campo de busca, seletor de situação (`Todas`, `Ativa`, `Em teste`, `Pendente`, `Inativa`), tabela responsiva (nome/fantasia, CNPJ, setor, contato, `Badge` da situação), cada linha leva a `/atuacao/clientes/{id}`; estado vazio "Nenhum cliente encontrado.".
- `clientes/[tenantId]/page.tsx`: ficha (dados, unidades, situação, plano apenas leitura) e formulário com os 6 campos editáveis; `PATCH`; sucesso → "Dados atualizados."; 400/403/404 → mensagem clara do servidor/padrão. CNPJ, razão social, plano e situação aparecem como texto, nunca como input.
Chamadas com `Authorization: Bearer ${getToken()}` e a base de API usada pelas outras páginas (ler `app/tecnico/empresas/page.tsx` e copiar o padrão de `fetch`/URL).

- [ ] **Step 5: Rodar** — `npx vitest run src/app/atuacao` PASS; `npx vitest run` completo (regressão); `npx tsc --noEmit`; `npm run build` (frontend). Expected: sem erros.

- [ ] **Step 6: QA visual** — se o ambiente permitir (memória `project_visual_qa_tooling`), conferir desktop e mobile com dados do banco descartável; senão registrar NÃO VERIFICADO.

- [ ] **Step 7: Checkpoint** — listar arquivos; não commitar.

---

### Task 5: Verificação final da Fase 2

**Files:** nenhum novo.

- [ ] **Step 1:** `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json` (esperado: só `r2-get-object` falhando, pré-existente), `npx tsc --noEmit -p tsconfig.json`, `npm run build`.
- [ ] **Step 2:** via runner descartável: `atuacao-carteira socio-access-matrix subscription-status-guard tenant-isolation-sweep admin-dashboard-financeiro auth`.
- [ ] **Step 3:** `cd /opt/Montese/frontend && npx vitest run && npx tsc --noEmit`.
- [ ] **Step 4:** Atualizar `docs/superpowers/audits/2026-10-19-painel-atuacao-fase0.md` com um bloco "Fase 2 — evidências" (comandos e contagens) e a memória `project_painel_atuacao_socios.md`.
- [ ] **Step 5:** Parar para o proprietário: commit, aplicação das migrations `0090–0092` em produção (backup + autorização), criação das contas dos sócios (senha lida de variável de ambiente, nunca gravada) e concessão de `clients.read` / `clients.update_operational`.

---

## Auto-revisão contra a spec

- **§4 (RLS):** policies `SELECT` do `socio` em `tenants`/`subscriptions`/`company_units`, escrita só em `tenants` — Task 1; tenant de parceiro invisível testado no banco e via HTTP (404).
- **§3/§2.2 (campos operacionais; CNPJ/plano/status fora):** lista fechada no DTO + `CAMPOS_OPERACIONAIS` + testes de 400 e de dado intacto — Task 3.
- **§7 (interface, "cliente ativo" via estado de assinatura, sem dados fictícios):** `deriveAccessState` reutilizado (Task 2), indicadores vindos de `/atuacao/resumo` (Tasks 3–4).
- **§6/Auditoria:** edição auditada (nomes de campos), negações auditadas (Fase 1).
- **Fora desta fase (por desenho):** tarefas, agenda, documentos, financeiro, `tenant_owners`, policy admin-only em `plans`.
- **Riscos declarados:** (1) RLS não restringe colunas — a restrição é da API (mitigação: DTO + `buildSafeSetClause` + testes); (2) `is_montese_tenant` é INFERIDO (tenant sem vínculo); (3) a lista é limitada a 200 clientes (paginação fica para quando houver mais).
