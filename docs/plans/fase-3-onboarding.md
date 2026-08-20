# Fase 3 (Onboarding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à empresa um jeito de completar, depois do primeiro login, os
dados que faltam desde o cadastro (setor, contato responsável, filiais com
endereço) e cadastrar seus funcionários (manual ou via CSV) — sem gatear
nada, tudo opcional e derivado dos dados reais.

**Architecture:** Dois módulos NestJS novos (`tenants`, `company-units`)
espelhando exatamente o padrão já usado por `employees`/`technicians`/
`partners` (controller + service + RLS + `buildSafeSetClause`). O módulo
`employees` ganha um campo novo (`company_unit_id`) e um endpoint de
importação em lote via CSV. No frontend, a primeira página autenticada de
verdade do app (`/empresa/onboarding`), com três blocos independentes sem
ordem obrigatória — o "progresso" nunca é armazenado à parte, é sempre
derivado checando se os dados já existem.

**Tech Stack:** NestJS + `pg` (PoolClient), Postgres com RLS, Next.js 14
App Router + Tailwind v4, `@nestjs/platform-express` `FileInterceptor`
(multer) pro upload de CSV, tudo em containers Docker reais desta VPS.

**Spec:** [`docs/specs/fase-3-onboarding.md`](../specs/fase-3-onboarding.md)

## Global Constraints

- RLS: `company_units` segue exatamente o padrão de `employees`/
  `subscriptions` — `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL
  SECURITY` + policy `admin` vê tudo, senão só `tenant_id = app.tenant_id`.
- **`tenants` NÃO tem RLS própria** (decisão histórica documentada em
  `docs/roadmap.md` — foi exatamente a ausência de RLS em `tenants` que
  tornou crítica a vulnerabilidade de SQL injection corrigida no
  sub-projeto A). `TenantsService` nunca aceita um `id` de tenant vindo do
  corpo/params da requisição — sempre usa `req.user.tenantId` (do JWT) como
  única fonte do "qual tenant", tanto pra leitura quanto escrita.
- Toda coluna nova em `UPDATE ... SET` passa por `buildSafeSetClause`
  (`backend/src/common/safe-update.util.ts`) com allowlist explícita —
  nunca montar SET a partir de `Object.entries(body)` direto (é a mesma
  classe de vulnerabilidade corrigida no sub-projeto A).
- **Checagem cross-tenant de `company_unit_id`:** uma FK do Postgres
  (`employees.company_unit_id REFERENCES company_units(id)`) sozinha NÃO
  garante que a filial referenciada pertence ao mesmo tenant do
  funcionário — a checagem de integridade referencial do Postgres roda com
  privilégio suficiente pra validar a FK e **não é filtrada pela RLS da
  tabela referenciada**. Por isso, sempre que `company_unit_id` for
  fornecido (criação ou atualização de funcionário), o service precisa
  confirmar que aquele id é visível através da query RLS-scoped
  (`SELECT id FROM company_units WHERE id = $1` rodando dentro do mesmo
  `client` de `withTenantContext` — RLS filtra sozinha, sem precisar
  repetir `tenant_id = ...` na query) antes de aceitar. Sem essa checagem
  explícita, uma empresa poderia vincular um funcionário à filial de outra
  empresa.
- Importação de CSV roda tudo numa única transação (`withTenantContext`),
  mas cada linha usa `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` antes de seguir
  pra próxima — sem isso, o primeiro erro de linha (ex: CPF duplicado)
  deixa a transação inteira em estado abortado no Postgres e todas as
  linhas seguintes falham com "current transaction is aborted", mesmo que
  o `try/catch` do lado do Node capture o erro.
- Sem class-validator/`ValidationPipe` nos DTOs de `employees` hoje (lacuna
  pré-existente, documentada — não é escopo desta fase corrigir). Os DTOs
  NOVOS desta fase (`tenants`, `company-units`) seguem o padrão mais novo
  já usado em `subscriptions.controller.ts`: decorators de `class-validator`
  + `@UsePipes(new ValidationPipe({ transform: true, whitelist: true,
  forbidNonWhitelisted: true }))` no controller.
- Testes: e2e reais contra o Postgres real do Docker (rede
  `montese_internal`), sem mock de banco — mesmo padrão rigoroso de todas
  as fases anteriores. Comando de teste completo, mesmo formato já usado
  nas fases anteriores:
  ```bash
  set -a; source /opt/Montese/.env; set +a
  docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
    -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
    -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
    -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
    -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
    -e PUBLIC_APP_URL="https://example.com" \
    -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
    -e AUTH_RATE_LIMIT_MAX=10 -e AUTH_RATE_LIMIT_WINDOW_SECONDS=900 \
    -e REGISTER_RATE_LIMIT_MAX=5 -e REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600 \
    -e CONTACT_EMAIL_TO="comercial@teste.montese.local" \
    -e CONTACT_RATE_LIMIT_MAX=10 -e CONTACT_RATE_LIMIT_WINDOW_SECONDS=3600 \
    -e MERCADOPAGO_ACCESS_TOKEN="${MERCADOPAGO_ACCESS_TOKEN}" \
    node:20-alpine sh -c "npm run test:e2e"
  ```
  (`PUBLIC_APP_URL="https://example.com"` — não o valor real de produção —
  é a mesma ressalva já documentada desde a fase de pagamento: o Mercado
  Pago rejeita o `back_url` de produção sem HTTPS/domínio real; não afeta
  nada desta fase, só é preciso pro `subscriptions.e2e-spec.ts` já
  existente continuar passando durante a suíte completa.)
- Sem unit tests isolados: este projeto não tem infraestrutura de teste
  unitário (só `test:e2e` existe, `jest-e2e.json`, sem `jest.config`
  separado pra unit) — mantendo o padrão já estabelecido, a lógica pura de
  parsing de CSV é provada através do e2e real de `POST /employees/import`
  (linhas válidas e inválidas no mesmo arquivo), não um arquivo `.spec.ts`
  novo à parte.

---

### Task 1: Migration — `tenants`, `company_units`, `employees.company_unit_id`

**Files:**
- Create: `backend/db/migrations/0007_onboarding.sql`
- Test: `backend/test/company-units-rls.e2e-spec.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: tabela `company_units(id, tenant_id, name, address_street,
  address_number, address_city, address_state, address_zip, status,
  created_at, updated_at)`; colunas novas `tenants.sector`,
  `tenants.contact_name`, `tenants.contact_phone` (todas `TEXT`,
  nullable); coluna nova `employees.company_unit_id` (`UUID`, nullable,
  `REFERENCES company_units(id) ON DELETE SET NULL`).

- [ ] **Step 1: Escrever a migration**

`backend/db/migrations/0007_onboarding.sql`:

```sql
-- Fase 3 (Onboarding): dados complementares da empresa, filiais e vínculo
-- de funcionário com filial. Ver docs/specs/fase-3-onboarding.md.

ALTER TABLE tenants ADD COLUMN sector TEXT;
ALTER TABLE tenants ADD COLUMN contact_name TEXT;
ALTER TABLE tenants ADD COLUMN contact_phone TEXT;

CREATE TABLE company_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address_street TEXT NOT NULL,
  address_number TEXT,
  address_city TEXT NOT NULL,
  address_state VARCHAR(2) NOT NULL,
  address_zip VARCHAR(8) NOT NULL,
  status record_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_company_units_updated_at BEFORE UPDATE ON company_units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE company_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_units FORCE ROW LEVEL SECURITY;
CREATE POLICY company_units_isolation ON company_units USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
);

ALTER TABLE employees ADD COLUMN company_unit_id UUID
  REFERENCES company_units(id) ON DELETE SET NULL;
```

Nenhum `GRANT` extra necessário — `company_units` é criada pela mesma role
(`montese_app`, via `DATABASE_URL`) que já é dona de `employees`/`tenants`,
diferente das funções `SECURITY DEFINER` que usam `montese_auth_bypass`.

- [ ] **Step 2: Rodar a migração contra o Postgres real do Docker**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:20-alpine npm run db:migrate
```

Esperado: `0007_onboarding.sql` aplicada (não `[skip]`, é a primeira vez).

- [ ] **Step 3: Escrever o teste de isolamento RLS de `company_units`**

`backend/test/company-units-rls.e2e-spec.ts` — mesmo formato de
`backend/test/subscriptions-rls.e2e-spec.ts` (conexão de superuser só pra
montar fixture cross-tenant, conexão separada com `DATABASE_URL` — a role
da aplicação, que sofre RLS de verdade — pra fazer a asserção):

```typescript
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS em company_units (e2e)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let unitAId: string;
  let unitBId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Filial A');
    const tenantB = await db.createTenantWithUser('Empresa Filial B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const insertA = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Sede A', 'Rua A', 'Criciúma', 'SC', '88801000') RETURNING id`,
      [tenantAId],
    );
    unitAId = insertA.rows[0].id;

    const insertB = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Sede B', 'Rua B', 'Criciúma', 'SC', '88802000') RETURNING id`,
      [tenantBId],
    );
    unitBId = insertB.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM company_units WHERE id = ANY($1)', [
      [unitAId, unitBId],
    ]);
    await db.cleanup();
    await db.disconnect();
  });

  it('empresa A só vê a própria filial via RLS, nunca a de empresa B', async () => {
    const appClient = new Client({ connectionString: process.env.DATABASE_URL });
    await appClient.connect();
    try {
      await appClient.query('BEGIN');
      await appClient.query('SELECT set_config($1, $2, true)', ['app.user_id', randomUUID()]);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantAId]);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.role', 'empresa']);

      const result = await appClient.query('SELECT id, tenant_id FROM company_units');
      const ids = result.rows.map((r) => r.id);
      expect(ids).toContain(unitAId);
      expect(ids).not.toContain(unitBId);

      await appClient.query('ROLLBACK');
    } finally {
      await appClient.end();
    }
  });
});
```

`TestDb` não expõe o client de superuser publicamente (é `private` em
`db-test-helper.ts`) — usar `(db as any).client` pra acessá-lo direto
neste teste é o mesmo padrão que seria necessário em qualquer teste que
precise inserir fixture fora do CRUD normal; não alterar
`db-test-helper.ts` nesta task.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/company-units-rls.e2e-spec.ts"
```

Esperado: PASS, 1/1.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/0007_onboarding.sql backend/test/company-units-rls.e2e-spec.ts
git commit -m "feat: migration de onboarding (tenants, company_units, employees.company_unit_id)"
```

---

### Task 2: Módulo `tenants` — `GET/PATCH /tenants/me`

**Files:**
- Create: `backend/src/tenants/tenants.module.ts`
- Create: `backend/src/tenants/tenants.controller.ts`
- Create: `backend/src/tenants/tenants.service.ts`
- Create: `backend/src/tenants/dto/update-tenant.dto.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/tenants.e2e-spec.ts`

**Interfaces:**
- Consumes: `req.user.tenantId`/`req.user.role` (JWT, já populado pelo
  `JwtAuthGuard`); `req.withTenantContext` (já anexado pelo
  `TenantContextInterceptor`); `buildSafeSetClause` (Task 1 do
  sub-projeto A, `backend/src/common/safe-update.util.ts`).
- Produces: `GET /tenants/me` → `Tenant` (`{id, name, cnpj, plan, status,
  sector, contact_name, contact_phone, created_at, updated_at}`);
  `PATCH /tenants/me` → mesmo shape, atualizado. Tasks 6/7/8 (frontend)
  consomem esse shape pra derivar se o onboarding está completo
  (`sector` preenchido).

- [ ] **Step 1: Escrever o DTO**

`backend/src/tenants/dto/update-tenant.dto.ts`:

```typescript
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sector?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contact_phone?: string;
}
```

- [ ] **Step 2: Escrever o service**

`backend/src/tenants/tenants.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';

const UPDATABLE_FIELDS = ['sector', 'contact_name', 'contact_phone'] as const;

export interface Tenant {
  id: string;
  name: string;
  cnpj: string;
  plan: string;
  status: string;
  sector: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

interface UpdateTenantData {
  sector?: string;
  contact_name?: string;
  contact_phone?: string;
}

// tenants NÃO tem RLS própria (ver Global Constraints do plano) — este
// service nunca aceita um id vindo de fora, só o tenantId já resolvido
// do JWT pelo controller (req.user.tenantId).
@Injectable()
export class TenantsService {
  async findOne(client: PoolClient, id: string): Promise<Tenant> {
    const result = await client.query<Tenant>('SELECT * FROM tenants WHERE id = $1', [id]);
    const tenant = result.rows[0];
    if (!tenant) throw new NotFoundException('Empresa não encontrada');
    return tenant;
  }

  async update(client: PoolClient, id: string, data: UpdateTenantData): Promise<Tenant> {
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

    const result = await client.query<Tenant>(
      `UPDATE tenants SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const tenant = result.rows[0];
    if (!tenant) throw new NotFoundException('Empresa não encontrada');
    return tenant;
  }
}
```

- [ ] **Step 3: Escrever o controller**

`backend/src/tenants/tenants.controller.ts`:

```typescript
import { Body, Controller, Get, Patch, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantsService } from './tenants.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  // Só 'empresa' — 'admin' não tem um tenant "próprio" (req.user.tenantId
  // é null pra admin), gerenciar tenant arbitrário fica pra Fase 7
  // (Dashboard Admin), fora de escopo aqui.
  @Roles('empresa')
  @Get('me')
  findMe(@Req() req: any) {
    return req.withTenantContext((client: any) => this.tenants.findOne(client, req.user.tenantId));
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch('me')
  updateMe(@Body() dto: UpdateTenantDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.tenants.update(client, req.user.tenantId, dto),
    );
  }
}
```

- [ ] **Step 4: Registrar o módulo**

`backend/src/tenants/tenants.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
```

Em `backend/src/app.module.ts`: adicionar
`import { TenantsModule } from './tenants/tenants.module';` e
`TenantsModule` no array `imports` (junto de `PaymentsModule`,
`EmployeesModule` etc — mesmo padrão, só duas linhas).

- [ ] **Step 5: Escrever o teste e2e**

`backend/test/tenants.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET/PATCH /tenants/me (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Onboarding');
    tenantId = tenant.tenantId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('retorna o próprio tenant com sector/contact ainda vazios', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenants/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(tenantId);
    expect(res.body.sector).toBeNull();
  });

  it('atualiza sector/contact_name/contact_phone', async () => {
    const res = await request(app.getHttpServer())
      .patch('/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ sector: 'Indústria', contact_name: 'Ana RH', contact_phone: '48999990000' });

    expect(res.status).toBe(200);
    expect(res.body.sector).toBe('Indústria');
    expect(res.body.contact_name).toBe('Ana RH');
    expect(res.body.contact_phone).toBe('48999990000');
  });

  it('rejeita campos fora da allowlist (ex: tentar mudar plan/cnpj)', async () => {
    const res = await request(app.getHttpServer())
      .patch('/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'enterprise', cnpj: '00000000000000' });

    // forbidNonWhitelisted: true rejeita a requisição inteira (400) —
    // não existe um "ignora silenciosamente e aplica o resto".
    expect(res.status).toBe(400);
  });

  it('bloqueia role sem permissão (tecnico) com 403', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Onboarding');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });

    const res = await request(app.getHttpServer())
      .get('/tenants/me')
      .set('Authorization', `Bearer ${loginRes.body.access_token}`);

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/tenants.e2e-spec.ts"
```

Esperado: PASS, 4/4.

- [ ] **Step 7: Commit**

```bash
git add backend/src/tenants backend/src/app.module.ts backend/test/tenants.e2e-spec.ts
git commit -m "feat: adiciona GET/PATCH /tenants/me"
```

---

### Task 3: Módulo `company-units` — CRUD de filiais

**Files:**
- Create: `backend/src/company-units/company-units.module.ts`
- Create: `backend/src/company-units/company-units.controller.ts`
- Create: `backend/src/company-units/company-units.service.ts`
- Create: `backend/src/company-units/dto/create-company-unit.dto.ts`
- Create: `backend/src/company-units/dto/update-company-unit.dto.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/company-units.e2e-spec.ts`

**Interfaces:**
- Consumes: `buildSafeSetClause`; `req.withTenantContext`.
- Produces: `CompanyUnitsService.create/findAll/findOne/update/remove` —
  mesma assinatura de `EmployeesService` (Task 1 do sub-projeto A), pra
  Task 4 e o frontend (Tasks 6-8) consumirem um shape já conhecido:
  `{id, tenant_id, name, address_street, address_number, address_city,
  address_state, address_zip, status, created_at, updated_at}`.

- [ ] **Step 1: Escrever os DTOs**

`backend/src/company-units/dto/create-company-unit.dto.ts`:

```typescript
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCompanyUnitDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsString()
  @MaxLength(300)
  address_street: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  address_number?: string;

  @IsString()
  @MaxLength(200)
  address_city: string;

  @IsString()
  @MaxLength(2)
  address_state: string;

  @IsString()
  @MaxLength(8)
  address_zip: string;

  // Só é lido quando quem cria é role admin (empresa usa sempre o
  // próprio tenant_id do token) — mesmo padrão de CreateEmployeeDto.
  @IsOptional()
  @IsString()
  tenant_id?: string;
}
```

`backend/src/company-units/dto/update-company-unit.dto.ts`:

```typescript
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCompanyUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address_street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  address_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address_city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  address_state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  address_zip?: string;

  @IsOptional()
  @IsIn(['ativo', 'inativo', 'pendente'])
  status?: string;
}
```

- [ ] **Step 2: Escrever o service**

`backend/src/company-units/company-units.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';

const UPDATABLE_FIELDS = [
  'name',
  'address_street',
  'address_number',
  'address_city',
  'address_state',
  'address_zip',
  'status',
] as const;

export interface CompanyUnit {
  id: string;
  tenant_id: string;
  name: string;
  address_street: string;
  address_number: string | null;
  address_city: string;
  address_state: string;
  address_zip: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CreateCompanyUnitData {
  name: string;
  address_street: string;
  address_number?: string;
  address_city: string;
  address_state: string;
  address_zip: string;
}

interface UpdateCompanyUnitData {
  name?: string;
  address_street?: string;
  address_number?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  status?: string;
}

@Injectable()
export class CompanyUnitsService {
  async create(client: PoolClient, tenantId: string, data: CreateCompanyUnitData): Promise<CompanyUnit> {
    const result = await client.query<CompanyUnit>(
      `INSERT INTO company_units (tenant_id, name, address_street, address_number, address_city, address_state, address_zip)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        tenantId,
        data.name,
        data.address_street,
        data.address_number ?? null,
        data.address_city,
        data.address_state,
        data.address_zip,
      ],
    );
    return result.rows[0];
  }

  async findAll(client: PoolClient): Promise<CompanyUnit[]> {
    // Sem WHERE tenant_id: RLS já filtra pelo contexto (app.tenant_id/app.role).
    const result = await client.query<CompanyUnit>('SELECT * FROM company_units ORDER BY name');
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<CompanyUnit> {
    const result = await client.query<CompanyUnit>('SELECT * FROM company_units WHERE id = $1', [id]);
    const unit = result.rows[0];
    if (!unit) throw new NotFoundException('Filial não encontrada');
    return unit;
  }

  async update(client: PoolClient, id: string, data: UpdateCompanyUnitData): Promise<CompanyUnit> {
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

    const result = await client.query<CompanyUnit>(
      `UPDATE company_units SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const unit = result.rows[0];
    if (!unit) throw new NotFoundException('Filial não encontrada');
    return unit;
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    const result = await client.query('DELETE FROM company_units WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Filial não encontrada');
  }
}
```

- [ ] **Step 3: Escrever o controller**

`backend/src/company-units/company-units.controller.ts`:

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CompanyUnitsService } from './company-units.service';
import { CreateCompanyUnitDto } from './dto/create-company-unit.dto';
import { UpdateCompanyUnitDto } from './dto/update-company-unit.dto';

@Controller('company-units')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class CompanyUnitsController {
  constructor(private readonly companyUnits: CompanyUnitsService) {}

  @Roles('empresa', 'admin')
  @Post()
  create(@Body() dto: CreateCompanyUnitDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'admin' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.companyUnits.create(client, tenantId, {
        name: dto.name,
        address_street: dto.address_street,
        address_number: dto.address_number,
        address_city: dto.address_city,
        address_state: dto.address_state,
        address_zip: dto.address_zip,
      }),
    );
  }

  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.companyUnits.findAll(client));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.companyUnits.findOne(client, id));
  }

  @Roles('empresa', 'admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCompanyUnitDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.companyUnits.update(client, id, dto));
  }

  @Roles('empresa', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.companyUnits.remove(client, id));
  }
}
```

- [ ] **Step 4: Registrar o módulo**

`backend/src/company-units/company-units.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { CompanyUnitsController } from './company-units.controller';
import { CompanyUnitsService } from './company-units.service';

@Module({
  controllers: [CompanyUnitsController],
  providers: [CompanyUnitsService],
})
export class CompanyUnitsModule {}
```

Em `backend/src/app.module.ts`: adicionar
`import { CompanyUnitsModule } from './company-units/company-units.module';`
e `CompanyUnitsModule` no array `imports`.

- [ ] **Step 5: Escrever o teste e2e**

`backend/test/company-units.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CRUD /company-units (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let unitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Filial CRUD');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cria uma filial', async () => {
    const res = await request(app.getHttpServer())
      .post('/company-units')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Sede',
        address_street: 'Rua das Flores',
        address_number: '100',
        address_city: 'Criciúma',
        address_state: 'SC',
        address_zip: '88801000',
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Sede');
    unitId = res.body.id;
  });

  it('lista as filiais do próprio tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/company-units')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.map((u: { id: string }) => u.id)).toContain(unitId);
  });

  it('atualiza uma filial', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/company-units/${unitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sede Renomeada' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Sede Renomeada');
  });

  it('remove uma filial', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/company-units/${unitId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const getRes = await request(app.getHttpServer())
      .get(`/company-units/${unitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(404);
  });
});
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/company-units.e2e-spec.ts"
```

Esperado: PASS, 4/4.

- [ ] **Step 7: Commit**

```bash
git add backend/src/company-units backend/src/app.module.ts backend/test/company-units.e2e-spec.ts
git commit -m "feat: adiciona CRUD de company-units (filiais)"
```

---

### Task 4: `employees.company_unit_id` — vínculo funcionário↔filial

**Files:**
- Modify: `backend/src/employees/dto/create-employee.dto.ts`
- Modify: `backend/src/employees/dto/update-employee.dto.ts`
- Modify: `backend/src/employees/employees.service.ts`
- Modify: `backend/src/employees/employees.controller.ts`
- Test: `backend/test/employees-company-unit.e2e-spec.ts`

**Interfaces:**
- Consumes: `company_units` (Task 3) — a checagem cross-tenant depende da
  RLS de `company_units` já estar ativa (Task 1).
- Produces: `EmployeesService.create`/`update` passam a aceitar
  `company_unit_id?: string` nos dados, validado via um helper privado
  `assertCompanyUnitBelongsToTenant`. Task 5 (importação CSV) NÃO chama
  esse helper — ela resolve o nome da filial com uma query já
  explicitamente filtrada por `tenant_id` (`SELECT id, name FROM
  company_units WHERE tenant_id = $1`), então a garantia cross-tenant ali
  vem da própria query, não deste método. Mudar a assinatura deste helper
  não afeta a Task 5.

- [ ] **Step 1: Atualizar os DTOs**

`backend/src/employees/dto/create-employee.dto.ts` — adicionar o campo
(mantém o resto do arquivo idêntico):

```typescript
export class CreateEmployeeDto {
  full_name: string;
  cpf: string;
  birth_date?: string;
  position?: string;
  admission_date?: string;
  company_unit_id?: string;
  // Só é lido quando quem cria é role admin (empresa usa sempre o próprio tenant_id do token).
  tenant_id?: string;
}
```

`backend/src/employees/dto/update-employee.dto.ts` — mesma coisa:

```typescript
export class UpdateEmployeeDto {
  full_name?: string;
  cpf?: string;
  birth_date?: string;
  position?: string;
  admission_date?: string;
  company_unit_id?: string;
  status?: 'ativo' | 'inativo' | 'pendente';
}
```

- [ ] **Step 2: Atualizar o service — allowlist, insert, e checagem cross-tenant**

`backend/src/employees/employees.service.ts` — substituir o arquivo
inteiro por esta versão (adiciona `company_unit_id` à allowlist, ao
INSERT, e o helper de checagem cross-tenant chamado por `create`/`update`
sempre que `company_unit_id` vier preenchido):

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';

// Únicas colunas que update() pode alterar — nunca confiar nas chaves do
// body pra montar o SET (ver common/safe-update.util.ts).
const UPDATABLE_FIELDS = [
  'full_name',
  'cpf',
  'birth_date',
  'position',
  'admission_date',
  'company_unit_id',
  'status',
] as const;

export interface Employee {
  id: string;
  tenant_id: string;
  user_id: string | null;
  full_name: string;
  cpf: string;
  birth_date: string | null;
  position: string | null;
  admission_date: string | null;
  company_unit_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface CreateEmployeeData {
  full_name: string;
  cpf: string;
  birth_date?: string;
  position?: string;
  admission_date?: string;
  company_unit_id?: string;
}

interface UpdateEmployeeData {
  full_name?: string;
  cpf?: string;
  birth_date?: string;
  position?: string;
  admission_date?: string;
  company_unit_id?: string;
  status?: string;
}

@Injectable()
export class EmployeesService {
  // Uma FK do Postgres sozinha não garante que a filial referenciada
  // pertence ao mesmo tenant do funcionário (checagem de FK roda sem
  // filtrar pela RLS da tabela referenciada) — por isso esta checagem
  // explícita roda dentro do mesmo client com contexto de tenant já
  // setado: a query já vem filtrada pela RLS de company_units sozinha,
  // sem precisar repetir tenant_id aqui.
  private async assertCompanyUnitBelongsToTenant(client: PoolClient, companyUnitId: string): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1', [companyUnitId]);
    if (result.rowCount === 0) throw new BadRequestException('Filial não encontrada');
  }

  async create(client: PoolClient, tenantId: string, data: CreateEmployeeData): Promise<Employee> {
    if (data.company_unit_id) {
      await this.assertCompanyUnitBelongsToTenant(client, data.company_unit_id);
    }
    const result = await client.query<Employee>(
      `INSERT INTO employees (tenant_id, full_name, cpf, birth_date, position, admission_date, company_unit_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        tenantId,
        data.full_name,
        data.cpf,
        data.birth_date ?? null,
        data.position ?? null,
        data.admission_date ?? null,
        data.company_unit_id ?? null,
      ],
    );
    return result.rows[0];
  }

  async findAll(client: PoolClient): Promise<Employee[]> {
    // Sem WHERE tenant_id: a RLS já filtra pelo contexto (app.tenant_id / app.role)
    // populado pelo TenantContextInterceptor.
    const result = await client.query<Employee>('SELECT * FROM employees ORDER BY full_name');
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<Employee> {
    const result = await client.query<Employee>('SELECT * FROM employees WHERE id = $1', [id]);
    const employee = result.rows[0];
    if (!employee) throw new NotFoundException('Funcionário não encontrado');
    return employee;
  }

  async update(client: PoolClient, id: string, data: UpdateEmployeeData): Promise<Employee> {
    if (data.company_unit_id) {
      await this.assertCompanyUnitBelongsToTenant(client, data.company_unit_id);
    }
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

    const result = await client.query<Employee>(
      `UPDATE employees SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const employee = result.rows[0];
    if (!employee) throw new NotFoundException('Funcionário não encontrado');
    return employee;
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    const result = await client.query('DELETE FROM employees WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Funcionário não encontrado');
  }
}
```

- [ ] **Step 3: Atualizar o controller — passar `company_unit_id` adiante**

`backend/src/employees/employees.controller.ts` — só o método `create`
muda (o resto do arquivo continua idêntico):

```typescript
  @Roles('empresa', 'admin')
  @Post()
  create(@Body() dto: CreateEmployeeDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'admin' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.employees.create(client, tenantId, {
        full_name: dto.full_name,
        cpf: dto.cpf,
        birth_date: dto.birth_date,
        position: dto.position,
        admission_date: dto.admission_date,
        company_unit_id: dto.company_unit_id,
      }),
    );
  }
```

(`update`/`findAll`/`findOne`/`remove` não mudam — `update` já repassa
`dto` inteiro pro service, que agora sabe lidar com `company_unit_id`.)

- [ ] **Step 4: Escrever o teste e2e (incluindo a rejeição cross-tenant)**

`backend/test/employees-company-unit.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('employees.company_unit_id (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let unitAId: string;
  let unitBId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Vinculo A');
    const tenantB = await db.createTenantWithUser('Empresa Vinculo B');

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    tokenA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.email, password: tenantB.password });
    tokenB = loginB.body.access_token;

    const unitA = await request(app.getHttpServer())
      .post('/company-units')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Sede A',
        address_street: 'Rua A',
        address_city: 'Criciúma',
        address_state: 'SC',
        address_zip: '88801000',
      });
    unitAId = unitA.body.id;

    const unitB = await request(app.getHttpServer())
      .post('/company-units')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        name: 'Sede B',
        address_street: 'Rua B',
        address_city: 'Criciúma',
        address_state: 'SC',
        address_zip: '88802000',
      });
    unitBId = unitB.body.id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('vincula um funcionário à própria filial com sucesso', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ full_name: 'Func A', cpf: '11122233344', company_unit_id: unitAId });

    expect(res.status).toBe(201);
    expect(res.body.company_unit_id).toBe(unitAId);
  });

  it('rejeita vincular funcionário à filial de outro tenant', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ full_name: 'Func Malicioso', cpf: '55566677788', company_unit_id: unitBId });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/employees-company-unit.e2e-spec.ts"
```

Esperado: PASS, 2/2.

- [ ] **Step 6: Commit**

```bash
git add backend/src/employees backend/test/employees-company-unit.e2e-spec.ts
git commit -m "feat: vincula funcionario a company_unit com checagem cross-tenant"
```

---

### Task 5: Importação de funcionários via CSV

**Files:**
- Create: `backend/src/employees/csv-import.util.ts`
- Modify: `backend/src/employees/employees.service.ts`
- Modify: `backend/src/employees/employees.controller.ts`
- Modify: `backend/package.json` (dev dependency `@types/multer`)
- Test: `backend/test/employees-import.e2e-spec.ts`

**Interfaces:**
- Consumes: `company_units` (Task 3, pra resolver nome→id da filial).
- Produces: `parseEmployeesCsv(content: string): { rows: ParsedCsvRow[];
  formatError?: string }` — função pura, sem I/O; `EmployeesService.importCsv(client,
  tenantId, csvContent): Promise<{ importados: number; erros: {linha:
  number; motivo: string}[] }>` — Task 8 (frontend) consome exatamente
  esse shape de resposta (`importados`/`erros[].linha`/`erros[].motivo`),
  mesmo nome de campo (`linha`, não `line`) já usado no exemplo JSON da
  spec (`docs/specs/fase-3-onboarding.md`, seção 3.3).

- [ ] **Step 1: Instalar `@types/multer`**

```bash
docker run --rm -v "$(pwd)/backend:/app" -w /app node:20-alpine npm install --save-dev @types/multer
```

`multer` em si já está disponível via `@nestjs/platform-express`
(confirmado: `node_modules/multer` já existe, só falta o pacote de tipos
pra `Express.Multer.File` tipar certo).

- [ ] **Step 2: Escrever o parser puro de CSV**

`backend/src/employees/csv-import.util.ts`:

```typescript
export interface ParsedCsvRow {
  line: number;
  full_name: string;
  cpf: string;
  position: string;
  company_unit_name: string;
}

export interface CsvParseResult {
  rows: ParsedCsvRow[];
  formatError?: string;
}

const EXPECTED_HEADER = ['nome', 'cpf', 'cargo', 'filial'];
export const MAX_IMPORT_ROWS = 2000;

// Split simples respeitando campos entre aspas (pra nome/endereço com
// vírgula) — não é um parser de CSV completo (não lida com aspas
// aninhadas em edge cases exóticos), mas cobre o formato de 4 colunas
// fixas desta importação, que é tudo que este endpoint precisa.
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

export function parseEmployeesCsv(content: string): CsvParseResult {
  const lines = content.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
  if (lines.length === 0) return { rows: [], formatError: 'Arquivo vazio' };

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const headerMatches = EXPECTED_HEADER.every((col, idx) => header[idx] === col);
  if (!headerMatches) {
    return {
      rows: [],
      formatError: `Cabeçalho inválido — esperado "nome,cpf,cargo,filial", recebido "${lines[0]}"`,
    };
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_IMPORT_ROWS) {
    return {
      rows: [],
      formatError: `Arquivo tem ${dataLines.length} linhas, o máximo permitido é ${MAX_IMPORT_ROWS}`,
    };
  }

  const rows: ParsedCsvRow[] = dataLines.map((line, idx) => {
    const fields = splitCsvLine(line);
    return {
      line: idx + 2, // +1 pro índice 0-based, +1 pela linha de cabeçalho
      full_name: fields[0] ?? '',
      cpf: fields[1] ?? '',
      position: fields[2] ?? '',
      company_unit_name: fields[3] ?? '',
    };
  });

  return { rows };
}
```

- [ ] **Step 3: Adicionar `importCsv` ao service**

Em `backend/src/employees/employees.service.ts`: adicionar o import no
topo e o método à classe `EmployeesService` (mantém tudo que já existe do
Task 4 intacto, só acrescenta):

```typescript
import { parseEmployeesCsv } from './csv-import.util';
```

```typescript
  export interface ImportRowError {
    linha: number;
    motivo: string;
  }

  export interface ImportResult {
    importados: number;
    erros: ImportRowError[];
  }
```

(essas duas interfaces ficam no nível do módulo, junto de `Employee` —
não dentro da classe)

```typescript
  async importCsv(client: PoolClient, tenantId: string, csvContent: string): Promise<ImportResult> {
    const { rows, formatError } = parseEmployeesCsv(csvContent);
    if (formatError) throw new BadRequestException(formatError);

    const unitsResult = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM company_units WHERE tenant_id = $1',
      [tenantId],
    );
    const unitsByName = new Map(unitsResult.rows.map((u) => [u.name, u.id]));

    const erros: ImportRowError[] = [];
    let importados = 0;

    for (const row of rows) {
      if (!row.full_name) {
        erros.push({ linha: row.line, motivo: 'Nome é obrigatório' });
        continue;
      }
      if (!/^\d{11}$/.test(row.cpf)) {
        erros.push({ linha: row.line, motivo: 'CPF inválido (precisa ter 11 dígitos)' });
        continue;
      }
      const unitId = unitsByName.get(row.company_unit_name);
      if (!unitId) {
        erros.push({ linha: row.line, motivo: `Filial "${row.company_unit_name}" não encontrada` });
        continue;
      }

      // SAVEPOINT por linha: sem isso, o primeiro erro de INSERT (ex: CPF
      // duplicado) deixa a transação inteira "aborted" no Postgres, e
      // toda linha seguinte falharia com "current transaction is
      // aborted", mesmo capturada pelo catch do lado do Node.
      await client.query('SAVEPOINT import_row');
      try {
        await client.query(
          `INSERT INTO employees (tenant_id, full_name, cpf, position, company_unit_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, row.full_name, row.cpf, row.position || null, unitId],
        );
        await client.query('RELEASE SAVEPOINT import_row');
        importados++;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT import_row');
        const pgErr = err as { code?: string };
        if (pgErr.code === '23505') {
          erros.push({ linha: row.line, motivo: 'CPF já cadastrado nesta empresa' });
        } else {
          erros.push({ linha: row.line, motivo: 'Erro ao importar esta linha' });
        }
      }
    }

    return { importados, erros };
  }
```

- [ ] **Step 4: Adicionar o endpoint ao controller**

Em `backend/src/employees/employees.controller.ts` — adicionar aos
imports:

```typescript
import { FileInterceptor } from '@nestjs/platform-express';
import { Query, UploadedFile, UseInterceptors } from '@nestjs/common';
```

(`Query`/`UploadedFile`/`UseInterceptors` somam aos imports de
`@nestjs/common` já existentes na primeira linha do arquivo — não duplicar
o import, só adicionar aos nomes já importados de lá.)

E o método novo na classe (ordem não importa, mas colocar depois de
`create`):

```typescript
  @Roles('empresa', 'admin')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importCsv(
    @UploadedFile() file: Express.Multer.File,
    @Query('tenant_id') tenantIdParam: string | undefined,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    const tenantId = req.user.role === 'admin' ? tenantIdParam : req.user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.employees.importCsv(client, tenantId, file.buffer.toString('utf-8')),
    );
  }
```

- [ ] **Step 5: Escrever o teste e2e (linhas válidas e inválidas no mesmo arquivo)**

`backend/test/employees-import.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /employees/import (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Import CSV');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    await request(app.getHttpServer())
      .post('/company-units')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Sede',
        address_street: 'Rua Import',
        address_city: 'Criciúma',
        address_state: 'SC',
        address_zip: '88801000',
      });
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('importa linhas válidas e reporta erro por linha nas inválidas, sem travar as demais', async () => {
    const csv = [
      'nome,cpf,cargo,filial',
      'Funcionário Um,11122233301,Operador,Sede',
      'Sem CPF Válido,123,Operador,Sede',
      'Filial Errada,11122233302,Operador,Filial Que Não Existe',
      'Funcionário Dois,11122233303,Técnico,Sede',
    ].join('\n');

    const res = await request(app.getHttpServer())
      .post('/employees/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'funcionarios.csv');

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(2);
    expect(res.body.erros).toHaveLength(2);
    expect(res.body.erros.find((e: { linha: number }) => e.linha === 3).motivo).toMatch(/CPF inválido/);
    expect(res.body.erros.find((e: { linha: number }) => e.linha === 4).motivo).toMatch(/não encontrada/);
  });

  it('CPF duplicado numa linha não trava as linhas seguintes (prova do SAVEPOINT)', async () => {
    const csv = [
      'nome,cpf,cargo,filial',
      'Duplicado,11122233301,Operador,Sede', // já existe do teste anterior
      'Depois Do Duplicado,11122233304,Operador,Sede',
    ].join('\n');

    const res = await request(app.getHttpServer())
      .post('/employees/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'funcionarios2.csv');

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(1);
    expect(res.body.erros[0].motivo).toMatch(/já cadastrado/);
  });

  it('rejeita cabeçalho inválido', async () => {
    const csv = 'nome,cpf\nFulano,11122233305';

    const res = await request(app.getHttpServer())
      .post('/employees/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf-8'), 'ruim.csv');

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/employees-import.e2e-spec.ts"
```

Esperado: PASS, 3/3.

- [ ] **Step 7: Commit**

```bash
git add backend/src/employees backend/package.json backend/package-lock.json backend/test/employees-import.e2e-spec.ts
git commit -m "feat: adiciona importacao de funcionarios via CSV"
```

---

### Task 6: Frontend — redirecionamento por role + bloco "Dados da empresa"

**Files:**
- Modify: `frontend/src/app/login/page.tsx`
- Create: `frontend/src/app/empresa/onboarding/page.tsx`
- Create: `frontend/src/app/empresa/onboarding/DadosEmpresaForm.tsx`

**Interfaces:**
- Consumes: `GET /tenants/me`, `PATCH /tenants/me` (Task 2).
- Produces: `TenantData` interface (`{id, name, cnpj, sector,
  contact_name, contact_phone}`) — Tasks 7/8 importam esse mesmo tipo de
  `DadosEmpresaForm.tsx` em vez de redefinir.

- [ ] **Step 1: Mudar o redirecionamento do login por role**

`frontend/src/app/login/page.tsx` — trocar só a linha
`router.push('/');` (dentro de `handleSubmit`, depois dos dois
`localStorage.setItem`) por:

```typescript
      router.push(data.user.role === 'empresa' ? '/empresa/onboarding' : '/');
```

- [ ] **Step 2: Criar o componente do bloco "Dados da empresa"**

`frontend/src/app/empresa/onboarding/DadosEmpresaForm.tsx`:

```tsx
'use client';

import { FormEvent, useState } from 'react';

export interface TenantData {
  id: string;
  name: string;
  cnpj: string;
  sector: string | null;
  contact_name: string | null;
  contact_phone: string | null;
}

export function DadosEmpresaForm({ tenant, onSaved }: { tenant: TenantData; onSaved: () => void }) {
  const [sector, setSector] = useState(tenant.sector ?? '');
  const [contactName, setContactName] = useState(tenant.contact_name ?? '');
  const [contactPhone, setContactPhone] = useState(tenant.contact_phone ?? '');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'erro'>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/tenants/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sector: sector || undefined,
          contact_name: contactName || undefined,
          contact_phone: contactPhone || undefined,
        }),
      });
      setStatus(res.ok ? 'ok' : 'erro');
      if (res.ok) onSaved();
    } catch {
      setStatus('erro');
    }
  }

  return (
    <section className="rounded-lg border border-brand-100 p-6">
      <h2 className="text-lg font-bold text-brand-900">Dados da empresa</h2>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Setor/atividade
          <input
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome do contato responsável
          <input
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Telefone do contato
          <input
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        {status === 'erro' && <p className="text-sm text-red-600">Não foi possível salvar. Tente de novo.</p>}
        {status === 'ok' && <p className="text-sm text-green-700">Salvo.</p>}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Salvando...' : 'Salvar'}
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 3: Criar a página de onboarding (com só o bloco 1 por enquanto)**

`frontend/src/app/empresa/onboarding/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DadosEmpresaForm, TenantData } from './DadosEmpresaForm';

export default function OnboardingPage() {
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const tenantRes = await fetch('/api/tenants/me', { headers });
    if (tenantRes.ok) setTenant(await tenantRes.json());
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  const isComplete = !!tenant?.sector;

  if (isComplete) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-brand-900">Cadastro em dia</h1>
        <p className="mt-4 text-brand-700">
          Seus dados estão completos. O Dashboard da empresa está sendo construído — em breve
          você vai poder acompanhar tudo por aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Complete o cadastro da sua empresa</h1>
      <p className="mt-2 text-brand-700">
        Você pode preencher em qualquer ordem, e voltar quando quiser — nada aqui é obrigatório
        agora.
      </p>
      <div className="mt-8 flex flex-col gap-8">
        {tenant && <DadosEmpresaForm tenant={tenant} onSaved={loadAll} />}
      </div>
    </div>
  );
}
```

(`isComplete` aqui só olha `sector` — Tasks 7/8 estendem essa condição
pra incluir filiais e funcionários; até lá, a tela "cadastro em dia"
aparece cedo demais de propósito, corrigido nas próximas duas tasks, não
é regressão a corrigir nesta.)

- [ ] **Step 4: Build de produção e verificação real**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
docker compose up -d --build frontend
sleep 3
```

Login real (via `curl`, empresa de teste já existente ou criada via
`/cadastro`) confirmando o redirecionamento pro onboarding e que
`PATCH /api/tenants/me` funciona pela UI (verificação manual no
navegador desta etapa — é a primeira página autenticada do frontend,
vale abrir e testar o fluxo de verdade, não só via `curl`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/login/page.tsx frontend/src/app/empresa/onboarding
git commit -m "feat: primeira pagina autenticada do frontend, redireciona empresa por role, bloco dados da empresa"
```

---

### Task 7: Frontend — bloco "Filiais"

**Files:**
- Create: `frontend/src/app/empresa/onboarding/FiliaisForm.tsx`
- Modify: `frontend/src/app/empresa/onboarding/page.tsx`

**Interfaces:**
- Consumes: `POST/GET /company-units` (Task 3).
- Produces: `CompanyUnit` interface (`{id, name, address_street,
  address_number, address_city, address_state}`) — Task 8 importa esse
  tipo de `FiliaisForm.tsx` (não redefine).

- [ ] **Step 1: Criar o componente**

`frontend/src/app/empresa/onboarding/FiliaisForm.tsx`:

```tsx
'use client';

import { FormEvent, useState } from 'react';

export interface CompanyUnit {
  id: string;
  name: string;
  address_street: string;
  address_number: string | null;
  address_city: string;
  address_state: string;
  address_zip: string;
}

export function FiliaisForm({ units, onChanged }: { units: CompanyUnit[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'erro'>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/company-units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name,
          address_street: street,
          address_number: number || undefined,
          address_city: city,
          address_state: state,
          address_zip: zip,
        }),
      });
      if (res.ok) {
        setName('');
        setStreet('');
        setNumber('');
        setCity('');
        setState('');
        setZip('');
        setStatus('ok');
        onChanged();
        return;
      }
      setStatus('erro');
    } catch {
      setStatus('erro');
    }
  }

  return (
    <section className="rounded-lg border border-brand-100 p-6">
      <h2 className="text-lg font-bold text-brand-900">Filiais</h2>
      {units.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2">
          {units.map((unit) => (
            <li key={unit.id} className="text-sm text-brand-700">
              <strong className="text-brand-900">{unit.name}</strong> — {unit.address_street}
              {unit.address_number ? `, ${unit.address_number}` : ''}, {unit.address_city}/
              {unit.address_state}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome da filial
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sede"
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Rua
          <input
            required
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Número
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Cidade
          <input
            required
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          UF
          <input
            required
            maxLength={2}
            value={state}
            onChange={(e) => setState(e.target.value.toUpperCase())}
            className="rounded-md border border-brand-100 px-3 py-2 uppercase"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          CEP
          <input
            required
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        {status === 'erro' && <p className="text-sm text-red-600">Não foi possível salvar. Tente de novo.</p>}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Salvando...' : 'Adicionar filial'}
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Integrar na página de onboarding**

`frontend/src/app/empresa/onboarding/page.tsx` — substituir o arquivo
inteiro por esta versão (adiciona busca de `company-units` e o bloco):

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DadosEmpresaForm, TenantData } from './DadosEmpresaForm';
import { FiliaisForm, CompanyUnit } from './FiliaisForm';

export default function OnboardingPage() {
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [units, setUnits] = useState<CompanyUnit[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const [tenantRes, unitsRes] = await Promise.all([
      fetch('/api/tenants/me', { headers }),
      fetch('/api/company-units', { headers }),
    ]);
    if (tenantRes.ok) setTenant(await tenantRes.json());
    if (unitsRes.ok) setUnits(await unitsRes.json());
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  const isComplete = !!tenant?.sector && units.length > 0;

  if (isComplete) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-brand-900">Cadastro em dia</h1>
        <p className="mt-4 text-brand-700">
          Seus dados estão completos. O Dashboard da empresa está sendo construído — em breve
          você vai poder acompanhar tudo por aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Complete o cadastro da sua empresa</h1>
      <p className="mt-2 text-brand-700">
        Você pode preencher em qualquer ordem, e voltar quando quiser — nada aqui é obrigatório
        agora.
      </p>
      <div className="mt-8 flex flex-col gap-8">
        {tenant && <DadosEmpresaForm tenant={tenant} onSaved={loadAll} />}
        <FiliaisForm units={units} onChanged={loadAll} />
      </div>
    </div>
  );
}
```

(`isComplete` ainda não inclui funcionários — Task 8 estende de novo;
mesma nota da Task 6, não é regressão.)

- [ ] **Step 3: Build de produção e verificação real**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
docker compose up -d --build frontend
sleep 3
```

Testar manualmente no navegador: criar uma filial pela UI, confirmar que
aparece na lista.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/empresa/onboarding
git commit -m "feat: bloco de filiais no onboarding"
```

---

### Task 8: Frontend — bloco "Funcionários" (manual + CSV)

**Files:**
- Create: `frontend/src/app/empresa/onboarding/FuncionariosForm.tsx`
- Modify: `frontend/src/app/empresa/onboarding/page.tsx`

**Interfaces:**
- Consumes: `POST /employees` (com `company_unit_id`, Task 4),
  `POST /employees/import` (Task 5, resposta `{importados, erros:
  [{linha, motivo}]}`), `GET /employees` (já existente desde a Fase 1, pra
  derivar se já existe algum funcionário).
- Produces: nenhuma (última peça consumida pela página).

- [ ] **Step 1: Criar o componente**

`frontend/src/app/empresa/onboarding/FuncionariosForm.tsx`:

```tsx
'use client';

import { FormEvent, useState } from 'react';
import { CompanyUnit } from './FiliaisForm';

interface ImportRowError {
  linha: number;
  motivo: string;
}

interface ImportResult {
  importados: number;
  erros: ImportRowError[];
}

export function FuncionariosForm({ units, onChanged }: { units: CompanyUnit[]; onChanged: () => void }) {
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [position, setPosition] = useState('');
  const [unitId, setUnitId] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'erro'>('idle');

  const [file, setFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'erro'>('idle');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          full_name: fullName,
          cpf,
          position: position || undefined,
          company_unit_id: unitId,
        }),
      });
      if (res.ok) {
        setFullName('');
        setCpf('');
        setPosition('');
        setStatus('ok');
        onChanged();
        return;
      }
      setStatus('erro');
    } catch {
      setStatus('erro');
    }
  }

  async function handleImport(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setImportStatus('loading');
    setImportResult(null);
    const token = localStorage.getItem('montese_token');
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/employees/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        setImportResult(await res.json());
        setImportStatus('idle');
        onChanged();
        return;
      }
      setImportStatus('erro');
    } catch {
      setImportStatus('erro');
    }
  }

  if (units.length === 0) {
    return (
      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Funcionários</h2>
        <p className="mt-4 text-sm text-brand-700">
          Cadastre uma filial primeiro — cada funcionário precisa estar vinculado a uma.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-brand-100 p-6">
      <h2 className="text-lg font-bold text-brand-900">Funcionários</h2>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Nome completo
          <input
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          CPF
          <input
            required
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Cargo
          <input
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Filial
          <select
            required
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          >
            <option value="">Selecione</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>
        {status === 'erro' && <p className="text-sm text-red-600">Não foi possível salvar. Tente de novo.</p>}
        <button
          type="submit"
          disabled={status === 'loading'}
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Salvando...' : 'Adicionar outro'}
        </button>
      </form>

      <div className="mt-6 border-t border-brand-100 pt-6">
        <h3 className="text-sm font-bold text-brand-900">Importar em massa (CSV)</h3>
        <p className="mt-1 text-sm text-brand-700">
          Cabeçalho obrigatório: <code>nome,cpf,cargo,filial</code> — o nome da filial precisa
          bater com uma das já cadastradas acima.
        </p>
        <form onSubmit={handleImport} className="mt-3 flex flex-col gap-3">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm text-brand-900"
          />
          {importStatus === 'erro' && (
            <p className="text-sm text-red-600">Não foi possível importar. Tente de novo.</p>
          )}
          <button
            type="submit"
            disabled={!file || importStatus === 'loading'}
            className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {importStatus === 'loading' ? 'Importando...' : 'Importar CSV'}
          </button>
        </form>
        {importResult && (
          <div className="mt-4 text-sm">
            <p className="text-green-700">{importResult.importados} funcionário(s) importado(s).</p>
            {importResult.erros.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-red-600">
                {importResult.erros.map((erro) => (
                  <li key={erro.linha}>
                    Linha {erro.linha}: {erro.motivo}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Integrar na página de onboarding (versão final)**

`frontend/src/app/empresa/onboarding/page.tsx` — substituir o arquivo
inteiro por esta versão final (adiciona busca de `employees` e o bloco,
completa a condição `isComplete`):

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DadosEmpresaForm, TenantData } from './DadosEmpresaForm';
import { FiliaisForm, CompanyUnit } from './FiliaisForm';
import { FuncionariosForm } from './FuncionariosForm';

export default function OnboardingPage() {
  const router = useRouter();
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [units, setUnits] = useState<CompanyUnit[]>([]);
  const [hasEmployees, setHasEmployees] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    const headers = { Authorization: `Bearer ${token}` };
    const [tenantRes, unitsRes, employeesRes] = await Promise.all([
      fetch('/api/tenants/me', { headers }),
      fetch('/api/company-units', { headers }),
      fetch('/api/employees', { headers }),
    ]);
    if (tenantRes.ok) setTenant(await tenantRes.json());
    if (unitsRes.ok) setUnits(await unitsRes.json());
    if (employeesRes.ok) {
      const employees = await employeesRes.json();
      setHasEmployees(Array.isArray(employees) && employees.length > 0);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  const isComplete = !!tenant?.sector && units.length > 0 && hasEmployees;

  if (isComplete) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-brand-900">Cadastro em dia</h1>
        <p className="mt-4 text-brand-700">
          Seus dados estão completos. O Dashboard da empresa está sendo construído — em breve
          você vai poder acompanhar tudo por aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Complete o cadastro da sua empresa</h1>
      <p className="mt-2 text-brand-700">
        Você pode preencher em qualquer ordem, e voltar quando quiser — nada aqui é obrigatório
        agora.
      </p>
      <div className="mt-8 flex flex-col gap-8">
        {tenant && <DadosEmpresaForm tenant={tenant} onSaved={loadAll} />}
        <FiliaisForm units={units} onChanged={loadAll} />
        <FuncionariosForm units={units} onChanged={loadAll} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build de produção e verificação real**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
docker compose up -d --build frontend
sleep 3
```

Testar manualmente no navegador o fluxo completo: cadastrar um
funcionário manual, depois importar um CSV com uma linha válida e uma
inválida, confirmar que o relatório aparece certo e que a tela "cadastro
em dia" aparece só depois dos três blocos preenchidos.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/empresa/onboarding
git commit -m "feat: bloco de funcionarios (manual + CSV) e tela final do onboarding"
```

---

### Task 9: Integração final, deploy real e documentação

**Files:**
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: tudo das Tasks 1-8.
- Produces: nenhuma — task de fechamento.

- [ ] **Step 1: Rebuild e deploy dos containers reais desta VPS**

```bash
docker compose build backend frontend
docker compose up -d backend frontend
sleep 3
docker compose ps
```

Esperado: `montese_backend` e `montese_frontend` com status `Up`.

- [ ] **Step 2: Confirmar a migração aplicada em produção**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:20-alpine npm run db:migrate
```

Esperado: `0007_onboarding.sql` já aplicada (`[skip]`, se alguma task
anterior já rodou isso contra este mesmo Postgres) ou aplicada agora.

- [ ] **Step 3: Suíte e2e completa, sem regressão**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e PUBLIC_APP_URL="https://example.com" \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  -e AUTH_RATE_LIMIT_MAX=10 -e AUTH_RATE_LIMIT_WINDOW_SECONDS=900 \
  -e REGISTER_RATE_LIMIT_MAX=5 -e REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600 \
  -e CONTACT_EMAIL_TO="comercial@teste.montese.local" \
  -e CONTACT_RATE_LIMIT_MAX=10 -e CONTACT_RATE_LIMIT_WINDOW_SECONDS=3600 \
  -e MERCADOPAGO_ACCESS_TOKEN="${MERCADOPAGO_ACCESS_TOKEN}" \
  node:20-alpine sh -c "npm run test:e2e"
```

Esperado: todas as suites `PASS`, incluindo as 5 novas desta fase.

- [ ] **Step 4: Smoke test real via `curl`**

```bash
for path in / /login /empresa/onboarding; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost${path}")
  echo "${path} -> ${code}"
done
curl -s -o /dev/null -w "GET /api/tenants/me sem token -> %{http_code}\n" http://localhost/api/tenants/me
```

Esperado: `200` nas 3 páginas; `401` no `/api/tenants/me` sem token
(rota protegida).

- [ ] **Step 5: Atualizar `docs/roadmap.md`**

Adicionar uma seção "Fase 3 — Onboarding: status", mesmo formato de
tabela já usado nas fases anteriores, listando as 8 tasks de código e a
evidência real do smoke test. Marcar como fechada — diferente da fase de
pagamento, esta fase não tem nenhuma pendência bloqueante externa (não
depende do fundador pra nada).

- [ ] **Step 6: Commit final**

```bash
git add docs/roadmap.md
git commit -m "docs: fecha Fase 3 (Onboarding)"
```
