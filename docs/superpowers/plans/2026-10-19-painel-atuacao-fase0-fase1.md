# Painel de Atuação — Fases 0 e 1 (auditoria + papel `socio` e permissões) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auditar o que existe (Fase 0) e criar o papel `socio` com permissões granulares, negação por padrão e auditoria de negações (Fase 1), sem dar a ele acesso a nenhum dado ainda.

**Architecture:** `socio` entra como valor do enum Postgres `user_role` e do tipo `UserRole`. O `RolesGuard` global passa a negar `socio` em qualquer rota que não o liste em `@Roles` nem exija `@RequirePermission`. Um `PermissionsGuard` global lê `socio_permissions` no servidor (nunca do token). Nenhuma policy RLS dá acesso ao `socio` nesta fase; as policies `SELECT` vêm na Fase 2.

**Tech Stack:** NestJS, TypeScript, PostgreSQL (`pg`), Jest (`test:unit`, `test:e2e`), migrations SQL em `backend/db/migrations`.

**Spec:** `docs/superpowers/specs/2026-10-19-painel-atuacao-design.md`

## Global Constraints

- Sem `commit`, `push`, `reset` ou alteração de histórico: quem decide é o proprietário. Os passos "Commit" abaixo são **checkpoints para o proprietário** (listar arquivos e parar), não execução automática (AGENTS.md).
- Nunca ler nem imprimir `.env`, chaves ou certificados. Nunca `docker compose down -v`. Não mexer em Docker, Nginx, banco de produção, Redis, TLS, DNS, backups ou secrets.
- Os e2e do projeto apontam para o Postgres de **produção**: rodá-los **só** no container descartável (memória `reference_running_tests_in_throwaway_container` e `reference_ensaio_descartavel_isolado`), com envs fake. Nunca contra produção.
- Migrations: nunca aplicar em produção sem autorização do proprietário. `ALTER TYPE ... ADD VALUE` e o uso do novo valor ficam em migrations **separadas** (o runner abre `BEGIN/COMMIT` por arquivo).
- Numeração: usar `0090` e `0091`. O `main` da árvore vai até `0080` e há `0081–0083` (EPI) e outras em worktrees; a Task 1 confirma que `0090+` está livre antes de criar.
- Responder e documentar em português do Brasil. Rotular afirmações: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
- `finance.write`, `billing.manage`, `users.manage` e `settings.manage` **não podem existir** como permissão.
- Nenhum `@Roles` existente passa a incluir `socio`, exceto os itens listados na Task 3.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `docs/superpowers/audits/2026-10-19-painel-atuacao-fase0.md` (criar) | Relatório da auditoria (Task 1) |
| `backend/db/migrations/0090_user_role_socio.sql` (criar) | Só adiciona `socio` ao enum |
| `backend/db/migrations/0091_socio_permissions.sql` (criar) | Tabela `socio_permissions`, `chk_tenant_role`, `is_montese_tenant()` |
| `backend/src/common/types.ts` (modificar) | `USER_ROLES` inclui `socio` |
| `backend/src/common/permissions.ts` (criar) | Lista fechada `PERMISSIONS` e tipo `Permission` |
| `backend/src/common/decorators/require-permission.decorator.ts` (criar) | `@RequirePermission(...)` |
| `backend/src/common/guards/roles.guard.ts` (modificar) | Negar `socio` por padrão |
| `backend/src/common/guards/permissions.guard.ts` (criar) | Checa permissão no servidor e audita negação |
| `backend/src/app.module.ts` (modificar) | Registrar `PermissionsGuard` após `RolesGuard` |
| `backend/src/auth/auth.controller.ts` (modificar) | `GET /auth/me` acessível ao `socio` |
| `backend/test/db-test-helper.ts` (modificar) | `createUserWithRole` aceita `socio`; helper de permissão |
| `backend/test/roles-guard-socio.unit-spec.ts` (criar) | Unit do `RolesGuard` |
| `backend/test/permissions-guard.unit-spec.ts` (criar) | Unit do `PermissionsGuard` |
| `backend/test/socio-controller-sweep.unit-spec.ts` (criar) | Varredura dos controllers |
| `backend/test/socio-access-matrix.e2e-spec.ts` (criar) | Matriz positivo/negativo + RLS (e2e) |

---

### Task 1: Fase 0 — auditoria somente leitura

**Files:**
- Create: `docs/superpowers/audits/2026-10-19-painel-atuacao-fase0.md`

**Interfaces:**
- Produces: respostas VERIFICADAS às 5 perguntas abaixo, que condicionam as Fases 2–6. Nenhum código, banco ou configuração é alterado.

- [ ] **Step 1: Confirmar que 0090/0091 estão livres em todas as branches e worktrees**

Run:
```bash
cd /opt/Montese && git worktree list && for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do git ls-tree --name-only "$b" backend/db/migrations/ 2>/dev/null | grep -E '/009[0-9]_' | sed "s|^|$b: |"; done; ls backend/db/migrations | grep -E '^009[0-9]_' || echo "livre na árvore atual"
```
Expected: nenhuma linha `009x`. Se houver colisão, usar o próximo número livre e ajustar as Tasks 2 e 4 e a tabela de arquivos.

- [ ] **Step 2: Cadastro pelo técnico — tenant e vínculo na mesma transação?**

Run:
```bash
cd /opt/Montese/backend && grep -n "tenant_technicians\|INSERT INTO tenants\|withTenantContext\|withoutTenantContext\|BEGIN\|COMMIT" src/technicians/technicians.service.ts src/tenant-technicians/tenant-technicians.service.ts src/tenants/*.ts src/auth/registration.service.ts | head -60
```
Registrar no relatório: arquivo:linha onde o tenant é criado, onde o vínculo é criado e se estão na mesma transação (VERIFICADO) ou não (risco da Seção 4 da spec).

- [ ] **Step 3: Listar todo endpoint `@Roles('admin')` e os sem `@Roles`**

Run:
```bash
cd /opt/Montese/backend && grep -rn -B1 -A3 "@Roles('admin')" src --include=*.controller.ts | grep -E "@(Get|Post|Put|Patch|Delete)" | sed 's/^\(.*\):\([0-9]*\)[-:].*@\(Get\|Post\|Put\|Patch\|Delete\)(\(.*\)).*/\1:\2 \3 \4/' | sort | head -80
grep -rLn "@Roles" src --include=*.controller.ts
```
Registrar: (a) os controllers/rotas com mutação financeira (`payments/`, `admin-dashboard`) e (b) os controllers **sem nenhum `@Roles`** (hoje abertos a qualquer autenticado; ao `socio` serão negados pela Task 3).

- [ ] **Step 4: Tabelas com RLS que referenciam `app.role = 'admin'` e dados financeiros**

Run:
```bash
cd /opt/Montese/backend && grep -ln "app.role" db/migrations/*.sql | wc -l && grep -n "CREATE POLICY" db/migrations/0006_plans_subscriptions.sql db/migrations/0015_payment_events.sql && grep -rn "api_key\|access_token\|payload" db/migrations/0015_payment_events.sql | head
```
Registrar quais colunas de `payment_events`/`subscriptions` não podem sair em DTO ao `socio` (tokens, payload bruto).

- [ ] **Step 5: Reutilização de agenda/ações corretivas e `documents`**

Run:
```bash
cd /opt/Montese/backend && sed -n 1,40p db/migrations/0022_visit_requests.sql && ls src/prevention-corrective-actions src/visits src/documents && grep -n "CREATE TABLE" db/migrations/0008_documents.sql
```
Registrar colunas de `visit_requests` e `documents` relevantes às Fases 3 e 5 (status existente, versionamento ausente — confirmar).

- [ ] **Step 6: Escrever o relatório e parar**

Criar o arquivo com seções: 1) numeração de migrations, 2) transação do cadastro do técnico, 3) endpoints admin/financeiros e controllers sem `@Roles`, 4) tabelas/colunas financeiras, 5) reutilização para Fases 3 e 5, 6) lacunas e decisões. Cada afirmação com rótulo VERIFICADO/INFERIDO e `arquivo:linha`.

- [ ] **Step 7: Checkpoint para o proprietário**

Informar o relatório gerado e os arquivos tocados (`git status --short docs/superpowers/audits`). Não executar commit. **Não iniciar a Task 2 antes do proprietário revisar o relatório** (se a auditoria mudar algo da spec, atualizar a spec primeiro).

---

### Task 2: Valor `socio` no enum e no tipo `UserRole`

**Files:**
- Create: `backend/db/migrations/0090_user_role_socio.sql`
- Modify: `backend/src/common/types.ts:1`
- Modify: `backend/test/db-test-helper.ts:102`
- Test: `backend/test/roles-guard-socio.unit-spec.ts` (parte inicial)

**Interfaces:**
- Produces: `USER_ROLES` contendo `'socio'`; `UserRole` incluindo `'socio'`; `TestDb.createUserWithRole('socio', prefix)`.

- [ ] **Step 1: Escrever o teste que falha**

`backend/test/roles-guard-socio.unit-spec.ts`:
```ts
import { USER_ROLES } from '../src/common/types';

describe('tipos de papel', () => {
  it('inclui o papel socio', () => {
    expect(USER_ROLES).toContain('socio');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/backend && npx jest --config ./test/jest-unit.json roles-guard-socio`
Expected: FAIL (`socio` não está em `USER_ROLES`).

- [ ] **Step 3: Implementar**

`backend/db/migrations/0090_user_role_socio.sql`:
```sql
-- Papel `socio` (Painel de Atuação Montese). Sozinho nesta migration: o runner
-- abre BEGIN/COMMIT por arquivo e um valor novo de enum não pode ser usado na
-- mesma transação em que foi criado. O uso (constraint, tabela) fica na 0091.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'socio';
```
`backend/src/common/types.ts` linha 1:
```ts
export const USER_ROLES = ['empresa', 'tecnico', 'parceiro', 'admin', 'socio'] as const;
```
`backend/test/db-test-helper.ts` (assinatura de `createUserWithRole`):
```ts
  async createUserWithRole(role: 'tecnico' | 'parceiro' | 'admin' | 'socio', namePrefix: string): Promise<TestUserFixture> {
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /opt/Montese/backend && npx jest --config ./test/jest-unit.json roles-guard-socio && npx tsc --noEmit -p tsconfig.json`
Expected: PASS e sem erros de tipo. Se o `tsc` apontar `switch`/mapas exaustivos sobre `UserRole`, tratar cada ocorrência (listar com `grep -rn "UserRole" src`) sem dar acesso ao `socio`.

- [ ] **Step 5: Checkpoint** — listar arquivos alterados para o proprietário; não commitar. A migration **não** é aplicada em produção; ela roda só no container descartável (Task 7).

---

### Task 3: `RolesGuard` nega `socio` por padrão

**Files:**
- Modify: `backend/src/common/guards/roles.guard.ts`
- Modify: `backend/src/common/decorators/require-permission.decorator.ts` (criar)
- Create: `backend/src/common/permissions.ts`
- Modify: `backend/src/auth/auth.controller.ts:142`
- Test: `backend/test/roles-guard-socio.unit-spec.ts`

**Interfaces:**
- Produces:
  - `PERMISSIONS` (readonly tuple) e `type Permission` em `common/permissions.ts`.
  - `REQUIRE_PERMISSION_KEY = 'requirePermission'` e `RequirePermission(...perms: Permission[])` em `common/decorators/require-permission.decorator.ts`.
  - `RolesGuard.canActivate`: com `user.role === 'socio'`, retorna `true` somente se o handler/classe lista `socio` em `@Roles` **ou** tem `@RequirePermission`; caso contrário `false`. Comportamento dos demais papéis inalterado.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao `roles-guard-socio.unit-spec.ts`:
```ts
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { Roles } from '../src/common/decorators/roles.decorator';
import { RequirePermission } from '../src/common/decorators/require-permission.decorator';

class Fake {
  semDecorator() {}
  @Roles('admin') soAdmin() {}
  @Roles('empresa', 'socio') comSocio() {}
  @RequirePermission('clients.read') comPermissao() {}
}

function ctx(handler: Function, role: string | null): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Fake,
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { id: 'u', role } : undefined }) }),
  } as any;
}

describe('RolesGuard — socio nega por padrão', () => {
  const guard = new RolesGuard(new Reflector());
  const p = Fake.prototype;

  it('nega socio em rota sem @Roles', () => {
    expect(guard.canActivate(ctx(p.semDecorator, 'socio'))).toBe(false);
  });
  it('nega socio em rota @Roles(admin)', () => {
    expect(guard.canActivate(ctx(p.soAdmin, 'socio'))).toBe(false);
  });
  it('libera socio quando listado em @Roles', () => {
    expect(guard.canActivate(ctx(p.comSocio, 'socio'))).toBe(true);
  });
  it('libera socio quando a rota exige permissão (a PermissionsGuard decide depois)', () => {
    expect(guard.canActivate(ctx(p.comPermissao, 'socio'))).toBe(true);
  });
  it('mantém o comportamento antigo: empresa em rota sem @Roles continua liberada', () => {
    expect(guard.canActivate(ctx(p.semDecorator, 'empresa'))).toBe(true);
  });
  it('mantém o comportamento antigo: empresa em @Roles(admin) continua negada', () => {
    expect(guard.canActivate(ctx(p.soAdmin, 'empresa'))).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/backend && npx jest --config ./test/jest-unit.json roles-guard-socio`
Expected: FAIL (módulos `require-permission.decorator` inexistente).

- [ ] **Step 3: Implementar**

`backend/src/common/permissions.ts`:
```ts
// Lista FECHADA de permissões do papel `socio`. Não existem (e não devem ser
// criadas) permissões de escrita financeira, cobrança, usuários ou configurações.
export const PERMISSIONS = [
  'clients.read',
  'clients.update_operational',
  'tasks.read',
  'tasks.write',
  'appointments.manage',
  'documents.create_draft',
  'documents.review',
  'documents.sign',
  'finance.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
```
`backend/src/common/decorators/require-permission.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';
import { Permission } from '../permissions';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';
// A rota exige TODAS as permissões listadas (papel `socio`).
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
```
`backend/src/common/guards/roles.guard.ts` (substituir `canActivate`):
```ts
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // `socio` nega por padrão: só passa se a rota o lista em @Roles ou exige
    // @RequirePermission (a PermissionsGuard decide em seguida). Rota sem
    // @Roles continua aberta aos demais papéis, como antes.
    if (user?.role === 'socio') {
      const permissions = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSION_KEY, targets);
      const listed = !!required && required.includes('socio');
      return listed || (!!permissions && permissions.length > 0);
    }

    if (!required || required.length === 0) return true;
    return !!user && required.includes(user.role);
  }
```
`backend/src/auth/auth.controller.ts` na rota `me` (linha ~141):
```ts
  @Roles('empresa', 'tecnico', 'parceiro', 'admin', 'socio')
  @SkipSubscriptionCheck()
  @Get('me')
```
(adicionar `import { Roles } from '../common/decorators/roles.decorator';` se ainda não existir; como a rota agora tem `@Roles`, os papéis antigos continuam liberados por estarem na lista).

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /opt/Montese/backend && npx jest --config ./test/jest-unit.json roles-guard-socio && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — listar arquivos; não commitar. Se a Task 1 listou outros controllers sem `@Roles` que o `socio` precisa (ex.: logout/alterar senha), listá-los ao proprietário em vez de liberar por conta própria.

---

### Task 4: Migration `socio_permissions` + `is_montese_tenant()`

**Files:**
- Create: `backend/db/migrations/0091_socio_permissions.sql`
- Test: `backend/test/socio-access-matrix.e2e-spec.ts` (parte de banco, Task 7)

**Interfaces:**
- Produces:
  - Tabela `socio_permissions(user_id UUID, permission TEXT, granted_by UUID, created_at)`, PK `(user_id, permission)`, `CHECK` com a lista fechada da Task 3, RLS + FORCE RLS.
  - Função `is_montese_tenant(p_tenant_id UUID) RETURNS boolean` (`SECURITY DEFINER`, `search_path = public, pg_temp`).
  - `chk_tenant_role` aceitando `socio` com `tenant_id IS NULL`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Painel de Atuação (Fase 1). O valor `socio` do enum foi criado na 0090.

ALTER TABLE users DROP CONSTRAINT chk_tenant_role;
ALTER TABLE users ADD CONSTRAINT chk_tenant_role CHECK (
  (role = 'empresa' AND tenant_id IS NOT NULL)
  OR (role IN ('tecnico','parceiro','admin','socio') AND tenant_id IS NULL)
);

CREATE TABLE socio_permissions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN (
    'clients.read','clients.update_operational','tasks.read','tasks.write',
    'appointments.manage','documents.create_draft','documents.review',
    'documents.sign','finance.read'
  )),
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);

ALTER TABLE socio_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE socio_permissions FORCE ROW LEVEL SECURITY;

-- O próprio sócio lê só as suas permissões; só admin concede/revoga.
CREATE POLICY socio_permissions_select ON socio_permissions FOR SELECT USING (
  current_setting('app.role', true) = 'admin'
  OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY socio_permissions_admin_write ON socio_permissions
  FOR ALL USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');

-- Cliente Montese = tenant SEM nenhuma linha (qualquer status) em
-- tenant_technicians/tenant_partners. Usada nas policies SELECT do `socio`
-- (Fase 2). SECURITY DEFINER para enxergar os vínculos independentemente do RLS.
CREATE FUNCTION is_montese_tenant(p_tenant_id UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM tenant_technicians WHERE tenant_id = p_tenant_id)
     AND NOT EXISTS (SELECT 1 FROM tenant_partners WHERE tenant_id = p_tenant_id);
$$;
REVOKE ALL ON FUNCTION is_montese_tenant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_montese_tenant(UUID) TO montese_app;
```
Antes de gravar, conferir o nome real da role da aplicação (`montese_app`, citada em `db-test-helper.ts`) com `grep -rn "montese_app" backend/db/migrations | head -3` e como as migrations anteriores concedem permissão em tabelas novas (`GRANT`/`ALTER DEFAULT PRIVILEGES`); seguir o mesmo padrão, incluindo `GRANT SELECT` em `socio_permissions` à role da aplicação se for o caso.

- [ ] **Step 2: Aplicar só no banco descartável**

Run (no container descartável, conforme a memória de ensaio isolado; **nunca** `npm run db:migrate` contra produção):
`cd /opt/Montese/backend && DATABASE_URL=<url-do-banco-descartavel> npm run db:migrate`
Expected: `0090` e `0091` aplicadas sem erro. Se a `0091` falhar por `montese_app` inexistente no descartável, criar a role no descartável e repetir.

- [ ] **Step 3: Checkpoint** — listar o arquivo; não commitar.

---

### Task 5: `PermissionsGuard` global com auditoria de negação

**Files:**
- Create: `backend/src/common/guards/permissions.guard.ts`
- Modify: `backend/src/app.module.ts:111`
- Test: `backend/test/permissions-guard.unit-spec.ts`

**Interfaces:**
- Consumes: `REQUIRE_PERMISSION_KEY`, `Permission` (Task 3); `DatabaseService.withTenantContext({userId, tenantId, role}, fn)`; `AuditService.log(entry)`.
- Produces: `PermissionsGuard`. Rotas sem `@RequirePermission` ou com usuário que não é `socio`: passa. `socio`: carrega suas permissões em `socio_permissions` e exige **todas**; falta → `ForbiddenException` (código `PERMISSION_DENIED`) e uma linha em `audit_log` com `action = 'permission.denied'`.

- [ ] **Step 1: Escrever os testes que falham**

`backend/test/permissions-guard.unit-spec.ts`:
```ts
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../src/common/guards/permissions.guard';
import { RequirePermission } from '../src/common/decorators/require-permission.decorator';

class Fake {
  @RequirePermission('finance.read') financeiro() {}
  @RequirePermission('clients.read', 'tasks.read') duas() {}
  livre() {}
}

function montar(concedidas: string[]) {
  const db: any = {
    withTenantContext: jest.fn(async (_ctx: any, cb: any) =>
      cb({ query: jest.fn(async () => ({ rows: concedidas.map((permission) => ({ permission })) })) }),
    ),
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  const guard = new PermissionsGuard(new Reflector(), db, audit);
  const ctx = (handler: Function, role: string) =>
    ({
      getHandler: () => handler,
      getClass: () => Fake,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'u1', tenantId: null, role }, method: 'GET', url: '/x', ip: '1.1.1.1' }),
      }),
    }) as any;
  return { guard, audit, ctx };
}

describe('PermissionsGuard', () => {
  const p = Fake.prototype;

  it('libera socio que tem a permissão', async () => {
    const { guard, ctx } = montar(['finance.read']);
    await expect(guard.canActivate(ctx(p.financeiro, 'socio'))).resolves.toBe(true);
  });

  it('nega socio sem a permissão e audita a negação', async () => {
    const { guard, ctx, audit } = montar([]);
    await expect(guard.canActivate(ctx(p.financeiro, 'socio'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'permission.denied', actorUserId: 'u1', actorRole: 'socio', statusCode: 403 }),
    );
  });

  it('exige TODAS as permissões', async () => {
    const { guard, ctx } = montar(['clients.read']);
    await expect(guard.canActivate(ctx(p.duas, 'socio'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('não interfere em rota sem @RequirePermission', async () => {
    const { guard, ctx } = montar([]);
    await expect(guard.canActivate(ctx(p.livre, 'socio'))).resolves.toBe(true);
  });

  it('não interfere em outros papéis', async () => {
    const { guard, ctx } = montar([]);
    await expect(guard.canActivate(ctx(p.financeiro, 'admin'))).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /opt/Montese/backend && npx jest --config ./test/jest-unit.json permissions-guard`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

`backend/src/common/guards/permissions.guard.ts`:
```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

// Roda DEPOIS do RolesGuard. Só atua sobre o papel `socio`; as permissões vêm do
// banco (socio_permissions), nunca do token. Exige todas as listadas.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!required || required.length === 0 || user?.role !== 'socio') return true;

    const granted = await this.db.withTenantContext(
      { userId: user.id, tenantId: undefined, role: user.role },
      async (client) => {
        const res = await client.query<{ permission: string }>(
          'SELECT permission FROM socio_permissions WHERE user_id = $1',
          [user.id],
        );
        return new Set(res.rows.map((r) => r.permission));
      },
    );

    const missing = required.filter((p) => !granted.has(p));
    if (missing.length === 0) return true;

    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'permission.denied',
      resourceType: 'route',
      method: request.method,
      path: request.url,
      statusCode: 403,
      ipAddress: request.ip,
      detail: `faltando: ${missing.join(', ')}`,
    });
    throw new ForbiddenException({
      statusCode: 403,
      message: 'Você não tem permissão para esta ação.',
      code: 'PERMISSION_DENIED',
    });
  }
}
```
`backend/src/app.module.ts`, logo após o `RolesGuard` (linha ~111) e com o `import` correspondente:
```ts
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
```
Se `DatabaseService` não estiver exportado globalmente para o `AppModule`, seguir como `TenantContextInterceptor` o recebe (mesmo escopo de providers).

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /opt/Montese/backend && npx jest --config ./test/jest-unit.json permissions-guard roles-guard-socio && npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — listar arquivos; não commitar.

---

### Task 6: Varredura dos controllers (nega por padrão, sem escrita financeira)

**Files:**
- Test: `backend/test/socio-controller-sweep.unit-spec.ts`

**Interfaces:**
- Consumes: `ROLES_KEY`, `REQUIRE_PERMISSION_KEY`, `PERMISSIONS`.
- Produces: teste que falha se (a) algum handler listar `socio` em `@Roles` sem `@RequirePermission`, exceto `auth/me`; (b) algum handler com `@RequirePermission` for `POST/PUT/PATCH/DELETE` em `payments/` ou `admin-dashboard` ou exigir permissão fora de `PERMISSIONS`.

- [ ] **Step 1: Escrever o teste**

```ts
import 'reflect-metadata';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { REQUIRE_PERMISSION_KEY } from '../src/common/decorators/require-permission.decorator';
import { PERMISSIONS } from '../src/common/permissions';

const SRC = join(__dirname, '..', 'src');
const METHODS: Record<number, string> = { 0: 'GET', 1: 'POST', 2: 'PUT', 3: 'DELETE', 4: 'PATCH' };

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? controllerFiles(p) : p.endsWith('.controller.ts') ? [p] : [];
  });
}

interface Rota { file: string; handler: string; roles: string[]; perms: string[]; method: string }

function rotas(): Rota[] {
  const out: Rota[] = [];
  for (const file of controllerFiles(SRC)) {
    const mod = require(file);
    for (const exp of Object.values<any>(mod)) {
      if (typeof exp !== 'function' || !Reflect.getMetadata('path', exp)) continue;
      for (const name of Object.getOwnPropertyNames(exp.prototype)) {
        const h = exp.prototype[name];
        if (name === 'constructor' || typeof h !== 'function') continue;
        const reqMethod = Reflect.getMetadata('method', h);
        if (reqMethod === undefined) continue;
        out.push({
          file: file.replace(SRC + '/', ''),
          handler: `${exp.name}.${name}`,
          method: METHODS[reqMethod] ?? String(reqMethod),
          roles: Reflect.getMetadata(ROLES_KEY, h) ?? Reflect.getMetadata(ROLES_KEY, exp) ?? [],
          perms: Reflect.getMetadata(REQUIRE_PERMISSION_KEY, h) ?? Reflect.getMetadata(REQUIRE_PERMISSION_KEY, exp) ?? [],
        });
      }
    }
  }
  return out;
}

describe('varredura de controllers — papel socio', () => {
  const todas = rotas();

  it('encontra rotas (a varredura não está vazia)', () => {
    expect(todas.length).toBeGreaterThan(100);
  });

  it('só auth/me lista socio em @Roles sem exigir permissão', () => {
    const fora = todas.filter((r) => r.roles.includes('socio') && r.perms.length === 0 && r.handler !== 'AuthController.me');
    expect(fora.map((r) => r.handler)).toEqual([]);
  });

  it('toda permissão exigida existe na lista fechada', () => {
    const invalidas = todas.flatMap((r) => r.perms.filter((p) => !(PERMISSIONS as readonly string[]).includes(p)).map((p) => `${r.handler}:${p}`));
    expect(invalidas).toEqual([]);
  });

  it('nenhuma rota de escrita em payments/ ou admin-dashboard exige permissão de socio', () => {
    const escritaFinanceira = todas.filter(
      (r) => r.method !== 'GET' && (r.file.startsWith('payments/') || r.file.startsWith('admin-dashboard/')) && (r.perms.length > 0 || r.roles.includes('socio')),
    );
    expect(escritaFinanceira.map((r) => `${r.method} ${r.handler}`)).toEqual([]);
  });

  it('nenhuma rota exige permissão de escrita financeira (inexistente por desenho)', () => {
    const proibidas = ['finance.write', 'billing.manage', 'payments.refund', 'users.manage', 'settings.manage'];
    expect((PERMISSIONS as readonly string[]).filter((p) => proibidas.includes(p))).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar**

Run: `cd /opt/Montese/backend && npx jest --config ./test/jest-unit.json socio-controller-sweep`
Expected: PASS. Se `require` dos controllers falhar por dependência de ambiente (envs obrigatórias), definir envs fake no topo do teste, como os demais specs (`GOOGLE_*`, `JWT_*`), sem ler `.env`. O número mínimo de rotas (100) é um piso de sanidade; ajustar ao valor real medido (VERIFICADO) se a contagem for menor.

- [ ] **Step 3: Provar que o teste detecta o problema (mutação)**

Adicionar temporariamente `'socio'` a um `@Roles('admin')` de `payments/subscriptions.controller.ts` (rota `PATCH :id/status`), rodar o teste, ver **FALHAR** na regra de escrita financeira, e **reverter** a alteração. Registrar o resultado no relatório da Task 7.

- [ ] **Step 4: Checkpoint** — confirmar `git diff --stat` sem alteração residual em `payments/`; listar arquivos; não commitar.

---

### Task 7: Matriz positivo/negativo e RLS (e2e no banco descartável)

**Files:**
- Create: `backend/test/socio-access-matrix.e2e-spec.ts`
- Modify: `backend/test/db-test-helper.ts` (helper `grantSocioPermission`)

**Interfaces:**
- Consumes: `TestDb.createUserWithRole('socio', prefix)`, `TestDb.createTenantWithUser`, `TestDb.client`, `loginToken` (copiar o padrão do `subscription-status-guard.e2e-spec.ts`).
- Produces: prova HTTP e SQL de que o `socio` autentica, é negado no resto e não escreve em tabelas financeiras.

- [ ] **Step 1: Helper para conceder permissão em teste**

Em `backend/test/db-test-helper.ts`, dentro da classe `TestDb`:
```ts
  async grantSocioPermission(userId: string, permission: string): Promise<void> {
    await this.client.query(
      'INSERT INTO socio_permissions (user_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, permission],
    );
  }
```
(O `cleanup()` já remove usuários criados pelo helper; `socio_permissions` cai por `ON DELETE CASCADE`. Confirmar lendo `cleanup()`.)

- [ ] **Step 2: Escrever o e2e**

Mesmo `beforeAll/afterAll` e mocks do `subscription-status-guard.e2e-spec.ts` (envs fake de Google, `overrideProvider(MercadoPagoService)`), mais:
```ts
describe('papel socio — matriz de acesso (e2e)', () => {
  let socio: any;
  let token: string;

  beforeAll(async () => {
    socio = await db.createUserWithRole('socio', 'Socio Teste');
    token = await loginToken(app, socio.email, socio.password);
  });

  it('autentica e /auth/me devolve role socio', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('socio');
  });

  it.each([
    ['GET', '/admin/dashboard/financeiro'],
    ['GET', '/admin/dashboard/alertas'],
    ['GET', '/admin/dashboard/clientes-recentes'],
  ])('nega %s %s (admin-only)', async (method, path) => {
    const res = await (request(app.getHttpServer()) as any)[method.toLowerCase()](path).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('nega alterar status de assinatura e plano e NÃO muda o dado', async () => {
    const plano = await db.client.query('SELECT id, price_cents FROM plans LIMIT 1');
    const antes = plano.rows[0];
    const patchPlano = await request(app.getHttpServer())
      .patch(`/plans/${antes.id}`).set('Authorization', `Bearer ${token}`).send({ price_cents: 1 });
    expect(patchPlano.status).toBe(403);
    const depois = await db.client.query('SELECT price_cents FROM plans WHERE id = $1', [antes.id]);
    expect(depois.rows[0].price_cents).toBe(antes.price_cents);

    const patchSub = await request(app.getHttpServer())
      .patch('/subscriptions/00000000-0000-0000-0000-000000000000/status')
      .set('Authorization', `Bearer ${token}`).send({ status: 'cancelled' });
    expect(patchSub.status).toBe(403);
  });

  it('nega rota de empresa (sem @Roles socio) mesmo autenticado', async () => {
    const res = await request(app.getHttpServer()).get('/employees').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('is_montese_tenant: verdadeiro sem vínculo, falso com vínculo a técnico', async () => {
    const livre = await db.createTenantWithUser('Cliente Montese Teste');
    const r1 = await db.client.query('SELECT is_montese_tenant($1) AS v', [livre.tenantId]);
    expect(r1.rows[0].v).toBe(true);

    const tecnico = await db.createUserWithRole('tecnico', 'Tec Teste');
    const tecRow = await db.client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId ?? tecnico.id]);
    const vinculado = await db.createTenantWithUser('Cliente Parceiro Teste');
    await db.client.query(
      "INSERT INTO tenant_technicians (tenant_id, technician_id, status) VALUES ($1, $2, 'inativo')",
      [vinculado.tenantId, tecRow.rows[0].id]);
    const r2 = await db.client.query('SELECT is_montese_tenant($1) AS v', [vinculado.tenantId]);
    expect(r2.rows[0].v).toBe(false); // vínculo inativo continua excluindo (regra conservadora)
  });

  it('permissão vem do banco: sem linha em socio_permissions a PermissionsGuard nega; com linha, libera', async () => {
    // Nenhuma rota usa @RequirePermission nesta fase; a decisão é provada em unit
    // (permissions-guard.unit-spec) e aqui só garantimos o CHECK da lista fechada:
    await expect(
      db.client.query("INSERT INTO socio_permissions (user_id, permission) VALUES ($1, 'finance.write')", [socio.userId ?? socio.id]),
    ).rejects.toThrow();
    await db.grantSocioPermission(socio.userId ?? socio.id, 'finance.read');
    const ok = await db.client.query('SELECT count(*)::int AS n FROM socio_permissions WHERE user_id = $1', [socio.userId ?? socio.id]);
    expect(ok.rows[0].n).toBe(1);
  });
});
```
Ajustes obrigatórios ao ler `TestUserFixture` (`db-test-helper.ts:~20-45`): usar os nomes reais dos campos (`id`/`userId`, `email`, `password`) e as colunas reais de `plans` e `technicians` (`price_cents`, `NOT NULL` extras). Se a rota `/employees` ou `/plans/:id` tiver outro caminho, usar o do controller (VERIFICAR com `grep -n "@Controller" src/employees/employees.controller.ts src/payments/plans.controller.ts`).

- [ ] **Step 3: Rodar no ambiente descartável**

Seguir a memória `reference_running_tests_in_throwaway_container`: container `node:20-alpine` na rede `montese_internal`, `NODE_OPTIONS` e envs fake, Postgres **descartável** com as migrations 0001–0091 aplicadas. Run:
`npx jest --config ./test/jest-e2e.json --runInBand socio-access-matrix`
Expected: PASS em todos os casos. **NÃO** apontar `DATABASE_URL` para produção. Se o único banco alcançável for o de produção, parar e pedir ao proprietário um banco descartável.

- [ ] **Step 4: Regressão**

Run (mesmo ambiente descartável): `npm run test:unit` e `npx jest --config ./test/jest-e2e.json --runInBand auth admin-dashboard-financeiro subscription-status-guard tenant-isolation-sweep`
Expected: PASS; qualquer falha é regressão a investigar antes de seguir.

- [ ] **Step 5: Relatório e checkpoint**

Anexar ao relatório da Fase 0 um bloco "Fase 1 — evidências" com: comandos executados, contagem de testes aprovados, resultado da mutação (Task 6, Step 3). Listar os arquivos de toda a Fase 1 (`git status --short`) e **parar** para o proprietário decidir sobre commit e sobre aplicar `0090/0091` em produção (migration só com autorização).

---

## Auto-revisão contra a spec

- **Spec §3 (papel, permissões, guard, varredura, auditoria de negação):** Tasks 2, 3, 5, 6, 7. Auditoria de alterações sensíveis (campos operacionais) entra na Fase 2, quando existir escrita.
- **Spec §4 (`is_montese_tenant`, RLS):** função na Task 4 e teste na Task 7. Policies `SELECT` do `socio` ficam na Fase 2 por desenho (nesta fase o `socio` não lê dado nenhum, o que o teste de `/employees` e o `403` do admin comprovam).
- **Spec §2 (verificação do código atual):** Task 1.
- **Fora deste plano (planos próprios, após a Task 1):** Fase 2 (painel/carteira), 3 (tarefas), 4 (financeiro leitura), 5 (documentos), 6 (homologação).
- **Risco declarado:** `ALTER TYPE ADD VALUE` é irreversível sem recriar o enum. Rollback prático: não conceder `socio` a ninguém e manter o valor sem uso.
