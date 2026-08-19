# Planos + Assinaturas (Mercado Pago) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empresa e técnico conseguem assinar um plano pago via Mercado Pago (Checkout Pro), com o status da assinatura rastreado de verdade no banco via webhook — sem gatear nenhuma funcionalidade existente ainda.

**Architecture:** Duas tabelas novas (`plans` — catálogo configurável sem RLS; `subscriptions` — com RLS, uma linha por tentativa de assinatura). `POST /subscriptions` (autenticado) cria uma Preapproval real na API do Mercado Pago e devolve a URL de checkout hospedada. `POST /payments/mercadopago/webhook` (público, validado por HMAC) é a fonte de verdade do que realmente aconteceu — nunca confia no corpo da notificação, sempre busca o estado real via `GET /preapproval/{id}` antes de gravar. Uma função Postgres `SECURITY DEFINER` nova (mesma técnica já usada em `auth_confirm_email`) permite o webhook, que chega sem nenhum contexto de tenant/role, atualizar `subscriptions` apesar da RLS.

**Tech Stack:** NestJS + `mercadopago` (SDK oficial Node, pacote `mercadopago` no npm) + PostgreSQL (RLS) + Next.js/Tailwind no frontend. SDK e algoritmo de assinatura do webhook verificados contra documentação/exemplos reais do Mercado Pago em 2026-08-19 (não de memória) — ver comentários nos steps de código abaixo para as fontes.

**Spec:** [`docs/specs/planos-assinaturas.md`](../specs/planos-assinaturas.md)

## Global Constraints

- **RLS em toda tabela com dado sensível** — `subscriptions` tem RLS forçada; `plans` não tem (catálogo público, mesma categoria de `tenants` que também não tem RLS própria). Qualquer escrita em `subscriptions` sem contexto de tenant/role (o webhook) precisa de função `SECURITY DEFINER` dona `montese_auth_bypass`, com `GRANT` de tabela explícito (`BYPASSRLS` não basta — lição já registrada em `docs/roadmap.md`).
- **Nunca editar migration já commitada** — a próxima migration nova é `0006` (`0001` a `0005` já existem).
- **Preço sempre vem de `plans.price_cents`** — nunca de um objeto "Plan" registrado do lado do Mercado Pago (evita duas fontes de verdade).
- **Webhook nunca confia no corpo da notificação** — sempre busca o estado real via `GET /preapproval/{id}` antes de gravar qualquer coisa.
- **Credenciais de TESTE only nesta fase** — `MERCADOPAGO_ACCESS_TOKEN`/`MERCADOPAGO_PUBLIC_KEY` já estão no `.env` real desta VPS (formato `TEST-...`). `MERCADOPAGO_WEBHOOK_SECRET` ainda não existe — só pode ser gerado depois que o endpoint do webhook existir e for configurado no painel do Mercado Pago (Task 8).
- **Sem mock apresentado como funcional** — cada task testada contra Postgres/Redis reais e, a partir da Task 3, contra a API de sandbox real do Mercado Pago (não simulação local).
- **Sem gate de funcionalidade** — nenhuma rota existente muda de comportamento por causa de plano/assinatura nesta fase.

---

### Task 1: Migration — `plans` + `subscriptions` + função do webhook

**Files:**
- Create: `backend/db/migrations/0006_plans_subscriptions.sql`

**Interfaces:**
- Consumes: nenhuma.
- Produces:
  - Tabela `plans` (colunas: `id`, `audience`, `slug`, `name`, `price_cents`, `employee_limit`, `active`) — consumida pelas Tasks 2/3/5/6.
  - Tabela `subscriptions` (colunas: `id`, `plan_id`, `tenant_id`, `technician_user_id`, `status`, `mercadopago_preapproval_id`) — consumida pela Task 3.
  - Função `payments_update_subscription_status(p_preapproval_id TEXT, p_status TEXT) RETURNS TABLE(subscription_id UUID, tenant_id UUID, plan_name TEXT)` — consumida pela Task 4.

- [ ] **Step 1: Criar a migration**

`backend/db/migrations/0006_plans_subscriptions.sql`:

```sql
-- plans: catálogo de planos, dado configurável — sem RLS própria (não é
-- dado de tenant, é catálogo público da plataforma; a página /planos
-- precisa listar preços sem autenticação, mesma categoria de `tenants`,
-- que também não tem RLS — ver comentário em 0001_init.sql).
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience TEXT NOT NULL CHECK (audience IN ('empresa', 'tecnico')),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  employee_limit INTEGER,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_plans_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Valores de exemplo (placeholder, confirmado com o fundador em
-- brainstorming de 2026-08-18/19) — faixas baseadas no esboço
-- compartilhado, não são preços finais. Ajustar depois via SQL direto ou
-- futuramente uma tela de admin (Fase 7), sem precisar mexer em código.
INSERT INTO plans (audience, slug, name, price_cents, employee_limit) VALUES
  ('empresa', 'empresa-start', 'Start', 29900, 10),
  ('empresa', 'empresa-premium', 'Premium', 79900, 50),
  ('empresa', 'empresa-super-premium', 'Super Premium', 200000, 200),
  ('empresa', 'empresa-enterprise', 'Enterprise', 500000, NULL),
  ('tecnico', 'tecnico-start', 'Start Técnico', 9900, NULL);

-- subscriptions: uma linha por tentativa/assinatura. RLS habilitada — dado
-- sensível por tenant/técnico, mesma policy-shape de `users`.
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  technician_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'authorized', 'paused', 'cancelled')),
  mercadopago_preapproval_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_subscription_subject CHECK (
    (tenant_id IS NOT NULL AND technician_user_id IS NULL) OR
    (tenant_id IS NULL AND technician_user_id IS NOT NULL)
  )
);
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX subscriptions_tenant_idx ON subscriptions (tenant_id);
CREATE INDEX subscriptions_technician_idx ON subscriptions (technician_user_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_isolation ON subscriptions USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR technician_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
);

-- payments_update_subscription_status: usado pelo webhook do Mercado Pago
-- (Task 4), que chega sem nenhum contexto de tenant/role — RLS bloquearia
-- um UPDATE anônimo em subscriptions. Mesma técnica de auth_confirm_email
-- (0004_confirm_email_function.sql). Se a assinatura vira 'authorized' e é
-- de uma empresa, também atualiza tenants.plan (campo texto já existente)
-- pra manter coerente o que já é exibido hoje — sem equivalente pro
-- técnico, não existe (nem precisa existir) campo de plano em
-- users/technicians.
CREATE FUNCTION payments_update_subscription_status(
  p_preapproval_id TEXT,
  p_status TEXT
) RETURNS TABLE(subscription_id UUID, tenant_id UUID, plan_name TEXT) AS $$
DECLARE
  v_subscription_id UUID;
  v_tenant_id UUID;
  v_plan_name TEXT;
BEGIN
  UPDATE subscriptions s SET status = p_status
  WHERE s.mercadopago_preapproval_id = p_preapproval_id
  RETURNING s.id, s.tenant_id INTO v_subscription_id, v_tenant_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT p.name INTO v_plan_name FROM plans p
    JOIN subscriptions s ON s.plan_id = p.id
    WHERE s.id = v_subscription_id;

  IF p_status = 'authorized' AND v_tenant_id IS NOT NULL THEN
    UPDATE tenants SET plan = v_plan_name WHERE id = v_tenant_id;
  END IF;

  RETURN QUERY SELECT v_subscription_id, v_tenant_id, v_plan_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION payments_update_subscription_status(TEXT, TEXT) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION payments_update_subscription_status(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payments_update_subscription_status(TEXT, TEXT) TO montese_app;

-- montese_auth_bypass já tem UPDATE em tenants desde 0004_confirm_email_function.sql
-- — só falta o que é genuinamente novo aqui: subscriptions (tabela nova)
-- e plans (tabela nova, só leitura pro JOIN acima).
GRANT SELECT, UPDATE ON subscriptions TO montese_auth_bypass;
GRANT SELECT ON plans TO montese_auth_bypass;
```

- [ ] **Step 2: Aplicar a migration no Postgres real**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:20-alpine npm run db:migrate
```

Esperado: `[apply] 0006_plans_subscriptions.sql` seguido de `[ok]`.

- [ ] **Step 3: Confirmar via `psql` real — planos seedados e função funcionando**

```bash
set -a; source /opt/Montese/.env; set +a

docker exec -e PGPASSWORD="${POSTGRES_APP_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_APP_USER}" -d "${POSTGRES_DB}" -c \
  "SELECT audience, slug, name, price_cents FROM plans ORDER BY audience, price_cents;"
```

Esperado: 5 linhas (4 `empresa`, 1 `tecnico`).

Testar a função do webhook diretamente — criar uma assinatura de teste,
confirmar, e checar que `tenants.plan` foi atualizado:

```bash
docker exec -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" -c \
  "INSERT INTO tenants (name, cnpj, status, plan) VALUES ('Empresa Teste Migration', '11222333000181', 'ativo', 'trial') RETURNING id;"
```

Anotar o `id` retornado, depois (substituindo `<TENANT_ID>`):

```bash
docker exec -e PGPASSWORD="${POSTGRES_APP_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_APP_USER}" -d "${POSTGRES_DB}" -c \
  "INSERT INTO subscriptions (plan_id, tenant_id, mercadopago_preapproval_id)
   SELECT id, '<TENANT_ID>', 'teste-preapproval-migration' FROM plans WHERE slug = 'empresa-premium'
   RETURNING id;"

docker exec -e PGPASSWORD="${POSTGRES_APP_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_APP_USER}" -d "${POSTGRES_DB}" -c \
  "SELECT * FROM payments_update_subscription_status('teste-preapproval-migration', 'authorized');"

docker exec -e PGPASSWORD="${POSTGRES_APP_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_APP_USER}" -d "${POSTGRES_DB}" -c \
  "SELECT plan FROM tenants WHERE id = '<TENANT_ID>';"
```

Esperado: a última query devolve `Premium` (o `tenants.plan` foi
atualizado pela função). Limpar os dados de teste:

```bash
docker exec -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" -c \
  "DELETE FROM tenants WHERE cnpj = '11222333000181';"
```

- [ ] **Step 4: Commit**

```bash
git add backend/db/migrations/0006_plans_subscriptions.sql
git commit -m "feat: migration de plans + subscriptions + função do webhook de pagamento"
```

---

### Task 2: `MercadoPagoService` + `PlansController` (`GET /plans`)

**Files:**
- Modify: `backend/package.json` (dependência `mercadopago`)
- Create: `backend/src/payments/mercadopago.service.ts`
- Create: `backend/src/payments/payments.module.ts`
- Create: `backend/src/payments/plans.controller.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/plans.e2e-spec.ts`

**Interfaces:**
- Consumes: `DatabaseService.withoutTenantContext` (existente).
- Produces:
  - `MercadoPagoService.createPreapproval(input: { reason: string; payerEmail: string; transactionAmountCents: number; backUrl: string; externalReference: string }): Promise<{ id: string; initPoint: string; status: string }>` — consumido pela Task 3.
  - `MercadoPagoService.getPreapproval(id: string): Promise<{ id: string; status: string }>` — consumido pela Task 4.
  - `GET /plans?audience=empresa|tecnico` (público) — consumido pelas Tasks 5/6.

**Nota sobre o SDK:** verificado contra a wiki/exemplos oficiais do
`mercadopago/sdk-nodejs` em 2026-08-19 — API de classes
(`MercadoPagoConfig` + `new PreApproval(client)` + `.create({body})`/
`.get({id})`), não a API antiga baseada em callback. O SDK lança
`MercadoPagoError` em erro de API (diferente do SDK do Resend, que devolve
`{data, error}` sem lançar — lição da Fase 2 não se repete aqui, mas
`try/catch` continua sendo a forma certa de tratar falha).

- [ ] **Step 1: Instalar o SDK**

```bash
docker run --rm -v "$(pwd)/backend:/app" -w /app node:20-alpine npm install mercadopago
```

- [ ] **Step 2: Criar o `MercadoPagoService`**

`backend/src/payments/mercadopago.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { MercadoPagoConfig, PreApproval } from 'mercadopago';

export interface CreatePreapprovalInput {
  reason: string;
  payerEmail: string;
  transactionAmountCents: number;
  backUrl: string;
  externalReference: string;
}

export interface PreapprovalResult {
  id: string;
  initPoint: string;
  status: string;
}

// Única porta de saída pra API do Mercado Pago. Preço sempre chega já
// calculado (transactionAmountCents) de fora — este serviço nunca decide
// preço sozinho, só traduz centavos (nosso formato) pra reais (formato
// que o Mercado Pago espera).
@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);
  // Fallback evita o mesmo erro já visto no EmailService (Fase 2): não dá
  // pra deixar a ausência da credencial derrubar o boot da aplicação
  // inteira — a falha real acontece na chamada, não na configuração.
  private readonly client = new MercadoPagoConfig({
    accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN || 'missing-access-token',
  });

  async createPreapproval(input: CreatePreapprovalInput): Promise<PreapprovalResult> {
    try {
      const preapproval = new PreApproval(this.client);
      const result = await preapproval.create({
        body: {
          reason: input.reason,
          external_reference: input.externalReference,
          payer_email: input.payerEmail,
          back_url: input.backUrl,
          status: 'pending',
          auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: input.transactionAmountCents / 100,
            currency_id: 'BRL',
          },
        },
      });
      if (!result.id || !result.init_point) {
        throw new Error('Resposta inesperada do Mercado Pago ao criar assinatura (sem id ou init_point)');
      }
      return { id: result.id, initPoint: result.init_point, status: result.status ?? 'pending' };
    } catch (err) {
      this.logger.error('Falha ao criar assinatura no Mercado Pago', (err as Error).stack);
      throw err;
    }
  }

  async getPreapproval(id: string): Promise<{ id: string; status: string }> {
    try {
      const preapproval = new PreApproval(this.client);
      const result = await preapproval.get({ id });
      return { id: result.id as string, status: result.status as string };
    } catch (err) {
      this.logger.error(`Falha ao buscar assinatura ${id} no Mercado Pago`, (err as Error).stack);
      throw err;
    }
  }
}
```

- [ ] **Step 3: Criar o `PlansController`**

`backend/src/payments/plans.controller.ts`:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { Public } from '../common/decorators/public.decorator';

interface PlanRow {
  id: string;
  audience: string;
  slug: string;
  name: string;
  price_cents: number;
  employee_limit: number | null;
}

@Controller('plans')
export class PlansController {
  constructor(private readonly db: DatabaseService) {}

  @Public()
  @Get()
  async findAll(@Query('audience') audience?: string) {
    return this.db.withoutTenantContext(async (client) => {
      const result = audience
        ? await client.query<PlanRow>(
            'SELECT id, audience, slug, name, price_cents, employee_limit FROM plans WHERE active = true AND audience = $1 ORDER BY price_cents',
            [audience],
          )
        : await client.query<PlanRow>(
            'SELECT id, audience, slug, name, price_cents, employee_limit FROM plans WHERE active = true ORDER BY audience, price_cents',
          );
      return result.rows;
    });
  }
}
```

- [ ] **Step 4: Criar o `PaymentsModule`**

`backend/src/payments/payments.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MercadoPagoService } from './mercadopago.service';
import { PlansController } from './plans.controller';

@Module({
  controllers: [PlansController],
  providers: [MercadoPagoService],
  exports: [MercadoPagoService],
})
export class PaymentsModule {}
```

- [ ] **Step 5: Registrar no `AppModule`**

Editar `backend/src/app.module.ts` — adicionar o import e incluir
`PaymentsModule` no array `imports`, junto dos outros módulos de domínio:

```typescript
import { PaymentsModule } from './payments/payments.module';
```

```typescript
  imports: [
    DatabaseModule,
    RedisModule,
    EmailModule,
    AuditModule,
    HealthModule,
    AuthModule,
    ContactModule,
    PaymentsModule,
    EmployeesModule,
    TechniciansModule,
    PartnersModule,
  ],
```

- [ ] **Step 6: Escrever o teste e2e**

`backend/test/plans.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('GET /plans (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lista todos os planos ativos sem autenticação', async () => {
    const res = await request(app.getHttpServer()).get('/plans');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(5);
    expect(res.body.some((p: { slug: string }) => p.slug === 'empresa-start')).toBe(true);
  });

  it('filtra por audience', async () => {
    const res = await request(app.getHttpServer()).get('/plans').query({ audience: 'tecnico' });
    expect(res.status).toBe(200);
    expect(res.body.every((p: { audience: string }) => p.audience === 'tecnico')).toBe(true);
    expect(res.body.some((p: { slug: string }) => p.slug === 'tecnico-start')).toBe(true);
  });
});
```

- [ ] **Step 7: Rodar o teste e o build**

```bash
docker run --rm -v "$(pwd)/backend:/app" -w /app node:20-alpine npm run build
```

Esperado: build sem erros.

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/plans.e2e-spec.ts"
```

Esperado: 2/2 testes passando.

- [ ] **Step 8: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/payments backend/src/app.module.ts backend/test/plans.e2e-spec.ts
git commit -m "feat: adiciona MercadoPagoService e GET /plans"
```

---

### Task 3: `POST /subscriptions`

**Files:**
- Create: `backend/src/payments/dto/create-subscription.dto.ts`
- Create: `backend/src/payments/subscriptions.service.ts`
- Create: `backend/src/payments/subscriptions.controller.ts`
- Modify: `backend/src/payments/payments.module.ts`
- Test: `backend/test/subscriptions.e2e-spec.ts`

**Interfaces:**
- Consumes: `MercadoPagoService.createPreapproval(...)` (Task 2); `plans`/`subscriptions` tabelas (Task 1); `req.withTenantContext` (padrão já existente, ver `employees.controller.ts`).
- Produces: `SubscriptionsService.create(client, planId: string, ctx: { tenantId?: string; technicianUserId?: string; payerEmail: string; audience: 'empresa' | 'tecnico' }): Promise<{ initPoint: string }>` — sem outro consumidor nesta spec além do controller.

- [ ] **Step 1: Criar o DTO**

`backend/src/payments/dto/create-subscription.dto.ts`:

```typescript
import { IsUUID } from 'class-validator';

export class CreateSubscriptionDto {
  @IsUUID()
  plan_id: string;
}
```

- [ ] **Step 2: Criar o `SubscriptionsService`**

`backend/src/payments/subscriptions.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { MercadoPagoService } from './mercadopago.service';
import { mapPgError } from '../common/pg-error.util';

interface PlanRow {
  id: string;
  audience: string;
  name: string;
  price_cents: number;
}

export interface SubscribeContext {
  tenantId?: string;
  technicianUserId?: string;
  payerEmail: string;
  audience: 'empresa' | 'tecnico';
}

@Injectable()
export class SubscriptionsService {
  constructor(private readonly mercadoPago: MercadoPagoService) {}

  async create(client: PoolClient, planId: string, ctx: SubscribeContext): Promise<{ initPoint: string }> {
    const planResult = await client.query<PlanRow>(
      'SELECT id, audience, name, price_cents FROM plans WHERE id = $1 AND active = true',
      [planId],
    );
    const plan = planResult.rows[0];
    if (!plan) throw new NotFoundException('Plano não encontrado');
    if (plan.audience !== ctx.audience) {
      throw new BadRequestException('Este plano não está disponível para o seu tipo de conta');
    }

    const preapproval = await this.mercadoPago.createPreapproval({
      reason: `Montese SST — ${plan.name}`,
      payerEmail: ctx.payerEmail,
      transactionAmountCents: plan.price_cents,
      backUrl: `${process.env.PUBLIC_APP_URL}/planos/assinatura-concluida`,
      externalReference: plan.id,
    });

    try {
      await client.query(
        `INSERT INTO subscriptions (plan_id, tenant_id, technician_user_id, status, mercadopago_preapproval_id)
         VALUES ($1, $2, $3, 'pending', $4)`,
        [plan.id, ctx.tenantId ?? null, ctx.technicianUserId ?? null, preapproval.id],
      );
    } catch (err) {
      mapPgError(err);
    }

    return { initPoint: preapproval.initPoint };
  }
}
```

- [ ] **Step 3: Criar o `SubscriptionsController`**

`req.user` hoje carrega só `{ id, tenantId, role }` (ver `common/types.ts`)
— não tem `email`, que é necessário pra montar o `payer_email` do Mercado
Pago. Adicionar `email` ao payload do JWT está fora do escopo mínimo desta
task; em vez disso, o controller busca o e-mail pelo `id` do usuário
dentro do mesmo `withTenantContext` já usado pra chamar o service (RLS já
permite ver a própria linha via `users_isolation`, `id = app.user_id`).

`backend/src/payments/subscriptions.controller.ts`:

```typescript
import { Body, Controller, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Roles('empresa', 'tecnico')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateSubscriptionDto, @Req() req: any) {
    const user = req.user;
    return req.withTenantContext(async (client: any) => {
      const emailResult = await client.query('SELECT email FROM users WHERE id = $1', [user.id]);
      const payerEmail = emailResult.rows[0]?.email;
      return this.subscriptions.create(client, dto.plan_id, {
        tenantId: user.role === 'empresa' ? user.tenantId : undefined,
        technicianUserId: user.role === 'tecnico' ? user.id : undefined,
        payerEmail,
        audience: user.role,
      });
    });
  }
}
```

- [ ] **Step 4: Atualizar o `PaymentsModule`**

Editar `backend/src/payments/payments.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MercadoPagoService } from './mercadopago.service';
import { PlansController } from './plans.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';

@Module({
  controllers: [PlansController, SubscriptionsController],
  providers: [MercadoPagoService, SubscriptionsService],
  exports: [MercadoPagoService],
})
export class PaymentsModule {}
```

- [ ] **Step 5: Escrever o teste e2e**

`backend/test/subscriptions.e2e-spec.ts` — usa uma empresa real
(`db.createTenantWithUser`, já existente em `db-test-helper.ts`) e faz uma
chamada real à API de sandbox do Mercado Pago (não mock — mesma régua já
aplicada ao Resend). Precisa de `MERCADOPAGO_ACCESS_TOKEN` de teste válido
no ambiente (já está no `.env` real desta VPS):

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { TestDb, TestTenantFixture, TestUserFixture } from './db-test-helper';

const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;

describe('POST /subscriptions (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let rawDb: Client;
  let tenant: TestTenantFixture;
  let technician: TestUserFixture;
  let empresaToken: string;
  let tecnicoToken: string;
  let empresaPlanId: string;
  let tecnicoPlanId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    tenant = await db.createTenantWithUser('Empresa Assinatura');
    technician = await db.createUserWithRole('tecnico', 'Técnico Assinatura');

    rawDb = new Client({ connectionString: SUPERUSER_URL });
    await rawDb.connect();
    const plansResult = await rawDb.query(
      `SELECT id, audience FROM plans WHERE slug IN ('empresa-start', 'tecnico-start')`,
    );
    empresaPlanId = plansResult.rows.find((r) => r.audience === 'empresa').id;
    tecnicoPlanId = plansResult.rows.find((r) => r.audience === 'tecnico').id;

    const empresaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = empresaLogin.body.access_token;

    const tecnicoLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: technician.email, password: technician.password });
    tecnicoToken = tecnicoLogin.body.access_token;
  });

  afterAll(async () => {
    await rawDb.query('DELETE FROM subscriptions WHERE tenant_id = $1 OR technician_user_id = $2', [
      tenant.tenantId,
      technician.userId,
    ]);
    await rawDb.end();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa assina um plano de empresa e recebe a URL de checkout real do Mercado Pago', async () => {
    const res = await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ plan_id: empresaPlanId });

    expect(res.status).toBe(201);
    expect(res.body.initPoint).toContain('mercadopago.com');

    const row = await rawDb.query('SELECT status, tenant_id FROM subscriptions WHERE plan_id = $1 AND tenant_id = $2', [
      empresaPlanId,
      tenant.tenantId,
    ]);
    expect(row.rows[0]).toMatchObject({ status: 'pending', tenant_id: tenant.tenantId });
  });

  it('técnico assina um plano de técnico e recebe a URL de checkout real do Mercado Pago', async () => {
    const res = await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${tecnicoToken}`)
      .send({ plan_id: tecnicoPlanId });

    expect(res.status).toBe(201);
    expect(res.body.initPoint).toContain('mercadopago.com');
  });

  it('rejeita empresa tentando assinar plano de técnico com 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ plan_id: tecnicoPlanId });

    expect(res.status).toBe(400);
  });

  it('rejeita sem autenticação com 401', async () => {
    const res = await request(app.getHttpServer()).post('/subscriptions').send({ plan_id: empresaPlanId });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 6: Rodar os testes contra Postgres/Redis/Mercado Pago sandbox reais**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e PUBLIC_APP_URL="http://localhost" \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  -e AUTH_RATE_LIMIT_MAX=10 -e AUTH_RATE_LIMIT_WINDOW_SECONDS=900 \
  -e MERCADOPAGO_ACCESS_TOKEN="${MERCADOPAGO_ACCESS_TOKEN}" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/subscriptions.e2e-spec.ts"
```

Esperado: 4/4 testes passando. Se as duas primeiras falharem com erro do
Mercado Pago (não erro do nosso código), confirmar que
`MERCADOPAGO_ACCESS_TOKEN` no `.env` real é mesmo a credencial de teste
válida antes de investigar mais.

- [ ] **Step 7: Rodar a suíte e2e completa (regressão)**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e PUBLIC_APP_URL="http://localhost" \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  -e AUTH_RATE_LIMIT_MAX=10 -e AUTH_RATE_LIMIT_WINDOW_SECONDS=900 \
  -e REGISTER_RATE_LIMIT_MAX=5 -e REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600 \
  -e CONTACT_EMAIL_TO="comercial@teste.montese.local" \
  -e CONTACT_RATE_LIMIT_MAX=10 -e CONTACT_RATE_LIMIT_WINDOW_SECONDS=3600 \
  -e MERCADOPAGO_ACCESS_TOKEN="${MERCADOPAGO_ACCESS_TOKEN}" \
  node:20-alpine sh -c "npm run test:e2e"
```

Esperado: todos os testes passando (34 = 28 anteriores + 2 de `/plans` +
4 de `/subscriptions`).

- [ ] **Step 8: Commit**

```bash
git add backend/src/payments backend/test/subscriptions.e2e-spec.ts
git commit -m "feat: adiciona POST /subscriptions (cria assinatura real via Mercado Pago)"
```

---

### Task 4: Webhook do Mercado Pago

**Files:**
- Create: `backend/src/payments/mercadopago-signature.util.ts`
- Create: `backend/src/payments/webhook.controller.ts`
- Modify: `backend/src/payments/payments.module.ts`
- Test: `backend/test/mercadopago-webhook.e2e-spec.ts`

**Interfaces:**
- Consumes: `MercadoPagoService.getPreapproval(id)` (Task 2); `payments_update_subscription_status` (Task 1).
- Produces: `verifyMercadoPagoSignature(input: { xSignature?: string; xRequestId?: string; dataId?: string; secret: string }): boolean` — usado só pelo `WebhookController` nesta spec.

**Algoritmo verificado contra exemplos oficiais/comunidade do Mercado
Pago em 2026-08-19** (não escrito de memória): o header `x-signature` vem
no formato `ts=<timestamp>,v1=<hash>`; o manifest a assinar é
`id:<data.id em minúsculas>;request-id:<x-request-id>;ts:<ts>;`; o hash
esperado é HMAC-SHA256 (hex) desse manifest usando o segredo do webhook;
comparação em tempo constante (`crypto.timingSafeEqual`).

- [ ] **Step 1: Criar o utilitário de validação de assinatura**

`backend/src/payments/mercadopago-signature.util.ts`:

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

export interface VerifySignatureInput {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
  secret: string;
}

// Formato verificado contra documentação/exemplos oficiais do Mercado
// Pago (2026-08-19): x-signature vem como "ts=<ts>,v1=<hash>"; o manifest
// assinado é "id:<data.id minúsculo>;request-id:<x-request-id>;ts:<ts>;".
// Nunca pular a validação — sem isso, qualquer um poderia bater no
// webhook fingindo que uma assinatura foi aprovada.
export function verifyMercadoPagoSignature(input: VerifySignatureInput): boolean {
  if (!input.xSignature || !input.xRequestId || !input.dataId || !input.secret) return false;

  const parts: Record<string, string> = {};
  for (const part of input.xSignature.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    parts[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1) return false;

  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.xRequestId};ts:${ts};`;
  const expected = createHmac('sha256', input.secret).update(manifest).digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(v1, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
```

- [ ] **Step 2: Criar o `WebhookController`**

`backend/src/payments/webhook.controller.ts`:

```typescript
import { Body, Controller, Headers, Post, Query, UnauthorizedException } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { DatabaseService } from '../common/database/database.service';
import { MercadoPagoService } from './mercadopago.service';
import { verifyMercadoPagoSignature } from './mercadopago-signature.util';

@Controller('payments')
export class WebhookController {
  constructor(
    private readonly mercadoPago: MercadoPagoService,
    private readonly db: DatabaseService,
  ) {}

  @Public()
  @Post('mercadopago/webhook')
  async handleWebhook(
    @Query('data.id') queryDataId: string | undefined,
    @Query('type') queryType: string | undefined,
    @Body() body: any,
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
  ) {
    const dataId = queryDataId ?? body?.data?.id;
    const type = queryType ?? body?.type;

    const valid = verifyMercadoPagoSignature({
      xSignature,
      xRequestId,
      dataId,
      secret: process.env.MERCADOPAGO_WEBHOOK_SECRET || '',
    });
    if (!valid) throw new UnauthorizedException('Assinatura inválida');

    // Só tratamos eventos de assinatura — outros tipos (pagamento avulso,
    // etc.) o Mercado Pago também pode notificar na mesma URL se
    // configurado; devolver 200 evita retry infinito pra evento que não
    // vamos processar.
    if (type !== 'subscription_preapproval') {
      return { message: 'ignorado' };
    }

    // Nunca confia no corpo da notificação pro status em si — busca o
    // estado real (prática recomendada pelo próprio Mercado Pago).
    const preapproval = await this.mercadoPago.getPreapproval(dataId);

    await this.db.withoutTenantContext((client) =>
      client.query('SELECT * FROM payments_update_subscription_status($1, $2)', [
        preapproval.id,
        preapproval.status,
      ]),
    );

    return { message: 'ok' };
  }
}
```

- [ ] **Step 3: Atualizar o `PaymentsModule`**

Editar `backend/src/payments/payments.module.ts` — adicionar
`WebhookController` ao array `controllers`:

```typescript
import { Module } from '@nestjs/common';
import { MercadoPagoService } from './mercadopago.service';
import { PlansController } from './plans.controller';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { WebhookController } from './webhook.controller';

@Module({
  controllers: [PlansController, SubscriptionsController, WebhookController],
  providers: [MercadoPagoService, SubscriptionsService],
  exports: [MercadoPagoService],
})
export class PaymentsModule {}
```

- [ ] **Step 4: Escrever o teste e2e**

`backend/test/mercadopago-webhook.e2e-spec.ts` — usa um segredo de teste
fixo (`MERCADOPAGO_WEBHOOK_SECRET=teste-segredo-webhook` no ambiente do
teste) pra construir uma assinatura HMAC válida com o mesmo algoritmo do
util, e mocka `MercadoPagoService.getPreapproval` (única chamada de rede
real que faria sentido mockar aqui — testar contra o sandbox de verdade
exigiria uma preapproval real já criada só pra isso; a chamada real à API
já é exercitada pela Task 3):

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createHmac } from 'crypto';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { MercadoPagoService } from '../src/payments/mercadopago.service';

const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;
const WEBHOOK_SECRET = 'teste-segredo-webhook';

function buildSignature(dataId: string, requestId: string, ts: string, secret: string): string {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const hash = createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${ts},v1=${hash}`;
}

describe('POST /payments/mercadopago/webhook (e2e)', () => {
  let app: INestApplication;
  let db: Client;
  let tenantId: string;
  let planId: string;
  const fakeMercadoPago = { getPreapproval: jest.fn(), createPreapproval: jest.fn() };

  beforeAll(async () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue(fakeMercadoPago)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new Client({ connectionString: SUPERUSER_URL });
    await db.connect();

    const tenantResult = await db.query(
      `INSERT INTO tenants (name, cnpj, status, plan) VALUES ('Empresa Webhook Teste', '63025866000135', 'ativo', 'trial') RETURNING id`,
    );
    tenantId = tenantResult.rows[0].id;

    const planResult = await db.query(`SELECT id FROM plans WHERE slug = 'empresa-premium'`);
    planId = planResult.rows[0].id;

    await db.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'pending', 'preapproval-webhook-teste')`,
      [planId, tenantId],
    );
  });

  afterAll(async () => {
    await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await db.end();
    await app.close();
  });

  it('rejeita com 401 quando a assinatura HMAC não bate', async () => {
    const res = await request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': 'preapproval-webhook-teste', type: 'subscription_preapproval' })
      .set('x-signature', 'ts=123,v1=assinatura-forjada')
      .set('x-request-id', 'req-teste')
      .send({});

    expect(res.status).toBe(401);
    expect(fakeMercadoPago.getPreapproval).not.toHaveBeenCalled();
  });

  it('ativa a assinatura e atualiza tenants.plan quando a assinatura HMAC é válida', async () => {
    fakeMercadoPago.getPreapproval.mockResolvedValueOnce({
      id: 'preapproval-webhook-teste',
      status: 'authorized',
    });

    const ts = String(Date.now());
    const requestId = 'req-valido';
    const signature = buildSignature('preapproval-webhook-teste', requestId, ts, WEBHOOK_SECRET);

    const res = await request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': 'preapproval-webhook-teste', type: 'subscription_preapproval' })
      .set('x-signature', signature)
      .set('x-request-id', requestId)
      .send({});

    expect(res.status).toBe(201);
    expect(fakeMercadoPago.getPreapproval).toHaveBeenCalledWith('preapproval-webhook-teste');

    const row = await db.query('SELECT status FROM subscriptions WHERE mercadopago_preapproval_id = $1', [
      'preapproval-webhook-teste',
    ]);
    expect(row.rows[0].status).toBe('authorized');

    const tenantRow = await db.query('SELECT plan FROM tenants WHERE id = $1', [tenantId]);
    expect(tenantRow.rows[0].plan).toBe('Premium');
  });

  it('ignora eventos de tipo diferente de subscription_preapproval sem chamar o Mercado Pago', async () => {
    const ts = String(Date.now());
    const requestId = 'req-outro-tipo';
    const signature = buildSignature('id-qualquer', requestId, ts, WEBHOOK_SECRET);

    const res = await request(app.getHttpServer())
      .post('/payments/mercadopago/webhook')
      .query({ 'data.id': 'id-qualquer', type: 'payment' })
      .set('x-signature', signature)
      .set('x-request-id', requestId)
      .send({});

    expect(res.status).toBe(201);
    expect(fakeMercadoPago.getPreapproval).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Rodar os testes contra Postgres real**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/mercadopago-webhook.e2e-spec.ts"
```

Esperado: 3/3 testes passando.

- [ ] **Step 6: Rodar a suíte e2e completa (regressão)**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e PUBLIC_APP_URL="http://localhost" \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  -e AUTH_RATE_LIMIT_MAX=10 -e AUTH_RATE_LIMIT_WINDOW_SECONDS=900 \
  -e REGISTER_RATE_LIMIT_MAX=5 -e REGISTER_RATE_LIMIT_WINDOW_SECONDS=3600 \
  -e CONTACT_EMAIL_TO="comercial@teste.montese.local" \
  -e CONTACT_RATE_LIMIT_MAX=10 -e CONTACT_RATE_LIMIT_WINDOW_SECONDS=3600 \
  -e MERCADOPAGO_ACCESS_TOKEN="${MERCADOPAGO_ACCESS_TOKEN}" \
  node:20-alpine sh -c "npm run test:e2e"
```

Esperado: todos passando (37 = 34 anteriores + 3 do webhook).

- [ ] **Step 7: Commit**

```bash
git add backend/src/payments/mercadopago-signature.util.ts backend/src/payments/webhook.controller.ts backend/src/payments/payments.module.ts backend/test/mercadopago-webhook.e2e-spec.ts
git commit -m "feat: adiciona webhook do Mercado Pago (fonte de verdade real das assinaturas)"
```

---

### Task 5: Página `/planos` — planos reais + botão Assinar

**Files:**
- Modify: `frontend/src/app/(site)/planos/page.tsx`

**Interfaces:**
- Consumes: `GET /api/plans?audience=empresa` (Task 2), `POST /api/subscriptions` (Task 3).
- Produces: nenhuma.

- [ ] **Step 1: Reescrever a página**

`frontend/src/app/(site)/planos/page.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Plan {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  employee_limit: number | null;
}

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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
    <div className="mx-auto max-w-5xl px-4 py-16">
      <h1 className="text-center text-3xl font-bold text-brand-900">Planos</h1>
      <p className="mx-auto mt-4 max-w-2xl text-center text-brand-700">
        Cada empresa começa com um período de teste (trial) sem custo. Assine quando fizer
        sentido pro seu time.
      </p>

      {error && <p className="mt-6 text-center text-sm text-red-600">{error}</p>}

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => (
          <div key={plan.id} className="flex flex-col rounded-lg border border-brand-100 p-6">
            <h2 className="text-lg font-semibold text-brand-900">{plan.name}</h2>
            <p className="mt-2 text-2xl font-bold text-brand-700">
              {formatPrice(plan.price_cents)}
              <span className="text-sm font-normal text-brand-700">/mês</span>
            </p>
            {plan.employee_limit && (
              <p className="mt-1 text-sm text-brand-700">Até {plan.employee_limit} funcionários</p>
            )}
            {loggedIn ? (
              <button
                onClick={() => handleSubscribe(plan.id)}
                disabled={subscribingPlanId === plan.id}
                className="mt-6 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {subscribingPlanId === plan.id ? 'Redirecionando...' : 'Assinar'}
              </button>
            ) : (
              <Link
                href="/login"
                className="mt-6 rounded-md border border-brand-500 px-4 py-2 text-center text-sm font-medium text-brand-700 hover:bg-brand-50"
              >
                Entrar para assinar
              </Link>
            )}
          </div>
        ))}
      </div>

      <div className="mt-10 flex justify-center gap-4">
        <Link
          href="/cadastro"
          className="rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700"
        >
          Ainda não é cliente? Comece grátis
        </Link>
        <Link
          href="/contato"
          className="rounded-md border border-brand-500 px-6 py-3 font-medium text-brand-700 hover:bg-brand-50"
        >
          Fale com vendas
        </Link>
      </div>
    </div>
  );
}
```

(Remove o `export const metadata` da versão anterior — a página virou
`'use client'`, que não pode exportar `metadata` diretamente; o `<title>`
da aba volta a ser o padrão do layout raiz. Não é regressão funcional,
só um detalhe de metadata que pode ser resolvido depois com
`generateMetadata` num `layout.tsx` dedicado, se importar.)

- [ ] **Step 2: Build de produção**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
```

Esperado: build sem erros.

- [ ] **Step 3: Subir o frontend real e conferir via `curl`**

```bash
docker compose up -d --build frontend
sleep 3
curl -s http://localhost/planos | grep -o "Planos</h1>"
```

Esperado: encontra o trecho (a listagem de planos em si só aparece depois
de hidratar no navegador, já que a busca é client-side — confirmar
visualmente depois, mesma ressalva já registrada pras páginas anteriores
sem browser disponível neste ambiente).

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(site)/planos/page.tsx"
git commit -m "feat: página Planos mostra planos reais e permite assinar"
```

---

### Task 6: Página `/tecnico/planos`

**Files:**
- Create: `frontend/src/app/(site)/tecnico/planos/page.tsx`

**Interfaces:**
- Consumes: `GET /api/plans?audience=tecnico` (Task 2), `POST /api/subscriptions` (Task 3).
- Produces: nenhuma.

- [ ] **Step 1: Criar a página**

`frontend/src/app/(site)/tecnico/planos/page.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Plan {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
}

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function PlanosTecnicoPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(!!localStorage.getItem('montese_token'));
    fetch('/api/plans?audience=tecnico')
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
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-center text-3xl font-bold text-brand-900">Plano para técnico</h1>
      <p className="mx-auto mt-4 max-w-xl text-center text-brand-700">
        Tenha sua carteira de clientes organizada na plataforma.
      </p>

      {error && <p className="mt-6 text-center text-sm text-red-600">{error}</p>}

      <div className="mt-10 grid gap-6 sm:grid-cols-1">
        {plans.map((plan) => (
          <div key={plan.id} className="flex flex-col items-center rounded-lg border border-brand-100 p-8">
            <h2 className="text-lg font-semibold text-brand-900">{plan.name}</h2>
            <p className="mt-2 text-2xl font-bold text-brand-700">
              {formatPrice(plan.price_cents)}
              <span className="text-sm font-normal text-brand-700">/mês</span>
            </p>
            {loggedIn ? (
              <button
                onClick={() => handleSubscribe(plan.id)}
                disabled={subscribingPlanId === plan.id}
                className="mt-6 rounded-md bg-brand-500 px-6 py-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {subscribingPlanId === plan.id ? 'Redirecionando...' : 'Assinar'}
              </button>
            ) : (
              <Link
                href="/login"
                className="mt-6 rounded-md border border-brand-500 px-6 py-3 text-center text-sm font-medium text-brand-700 hover:bg-brand-50"
              >
                Entrar para assinar
              </Link>
            )}
          </div>
        ))}
      </div>

      <p className="mt-10 text-center text-sm text-brand-700">
        Ainda não tem conta de técnico?{' '}
        <Link href="/tecnico/cadastro" className="font-medium text-brand-900 hover:underline">
          Cadastre-se
        </Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Build de produção**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
```

Esperado: build sem erros.

- [ ] **Step 3: Subir o frontend real e conferir via `curl`**

```bash
docker compose up -d --build frontend
sleep 3
curl -s http://localhost/tecnico/planos | grep -o "Plano para técnico</h1>"
```

Esperado: encontra o trecho.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(site)/tecnico/planos"
git commit -m "feat: adiciona página /tecnico/planos"
```

---

### Task 7: Página de resultado — `/planos/assinatura-concluida`

**Files:**
- Create: `frontend/src/app/(site)/planos/assinatura-concluida/page.tsx`

**Interfaces:**
- Consumes: nenhuma (página estática, o Mercado Pago só redireciona o navegador pra cá — a ativação real já aconteceu via webhook, Task 4).
- Produces: nenhuma.

- [ ] **Step 1: Criar a página**

`frontend/src/app/(site)/planos/assinatura-concluida/page.tsx`:

```tsx
import Link from 'next/link';

export default function AssinaturaConcluidaPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-brand-900">Assinatura em processamento</h1>
      <p className="mt-4 text-brand-700">
        Recebemos sua assinatura e estamos confirmando o pagamento com o Mercado Pago — isso
        pode levar alguns instantes.
      </p>
      <Link
        href="/login"
        className="mt-8 inline-block rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700"
      >
        Entrar
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Build de produção**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
```

Esperado: build sem erros.

- [ ] **Step 3: Subir o frontend real e conferir via `curl`**

```bash
docker compose up -d --build frontend
sleep 3
curl -s http://localhost/planos/assinatura-concluida | grep -o "Assinatura em processamento</h1>"
```

Esperado: encontra o trecho.

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(site)/planos/assinatura-concluida"
git commit -m "feat: adiciona página de resultado da assinatura"
```

---

### Task 8: Integração final, deploy real e documentação

**Files:**
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: tudo das Tasks 1–7.
- Produces: nenhuma — task de fechamento.

- [ ] **Step 1: Rebuild e deploy dos containers reais desta VPS**

```bash
docker compose build backend frontend
docker compose up -d backend frontend
sleep 3
docker compose ps
```

Esperado: `montese_backend` e `montese_frontend` com status `Up`.

- [ ] **Step 2: Rodar a migração no Postgres de produção**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:20-alpine npm run db:migrate
```

Esperado: `0006_plans_subscriptions.sql` aplicada (ou `[skip]` se alguma
task anterior já rodou isso contra este mesmo Postgres).

- [ ] **Step 3: Smoke test real de todas as páginas via `curl`**

```bash
for path in / /planos /tecnico/planos /planos/assinatura-concluida /cadastro /tecnico/cadastro /login; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost${path}")
  echo "${path} -> ${code}"
done
curl -s http://localhost/api/plans | head -c 200
echo
```

Esperado: `200` em todas as páginas; a chamada a `/api/plans` devolve os
5 planos reais em JSON.

- [ ] **Step 4: Configurar o webhook no painel do Mercado Pago**

Esta etapa não pode ser automatizada — pedir ao fundador que, no painel
do Mercado Pago (Suas integrações → aplicação de teste → Webhooks →
Configurar notificações), aponte pra
`http://<endereço público desta VPS>/api/payments/mercadopago/webhook`,
selecionando o evento "Assinaturas" (`subscription_preapproval`). Isso
gera o segredo (`MERCADOPAGO_WEBHOOK_SECRET`) — adicionar no `.env` real
desta VPS e reiniciar o backend:

```bash
# depois de adicionar MERCADOPAGO_WEBHOOK_SECRET=<segredo real> ao .env
docker compose up -d backend
```

**Esta etapa é uma pendência bloqueante pra fechar 100% a fase** — sem o
segredo real, o teste de ponta a ponta do Step 5 não pode acontecer.

- [ ] **Step 5: Teste real de ponta a ponta com cartão de teste do Mercado Pago**

Só depois do Step 4 estar resolvido. Fazer login como uma empresa de
teste real (ou criar uma via `/cadastro` + confirmação de e-mail, já
testado na Fase 2), ir em `/planos`, clicar "Assinar" num plano, e
completar o checkout com um [cartão de teste do Mercado
Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-api/additional-content/your-integrations/test/cards)
(eles fornecem números fictícios específicos pra sandbox, com CVV/validade
de teste documentados). Confirmar depois, via `psql` real:

```bash
set -a; source /opt/Montese/.env; set +a
docker exec -e PGPASSWORD="${POSTGRES_SUPERUSER_PASSWORD}" montese_postgres \
  psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" -c \
  "SELECT s.status, s.mercadopago_preapproval_id, p.name AS plan_name, t.plan AS tenant_plan
   FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN tenants t ON t.id = s.tenant_id
   ORDER BY s.created_at DESC LIMIT 1;"
```

Esperado: `status = 'authorized'` e `tenant_plan` igual ao nome do plano
assinado — prova que o webhook chegou e a função `payments_update_subscription_status`
funcionou de verdade, não só que o checkout redirecionou.
**Este smoke test não pode ser marcado como concluído sem essa evidência
real** — mesma régua já aplicada ao e-mail (Fase 2, sub-projeto A).

- [ ] **Step 6: Atualizar `docs/roadmap.md`**

Adicionar uma seção "Planos + Assinaturas (Mercado Pago): status",
mesmo formato de tabela já usado nas fases anteriores, marcando o item
como fechado com a data e a evidência do smoke test real (assinatura
`authorized`, `tenants.plan` atualizado). Se o Step 4/5 não puderam
acontecer ainda (segredo do webhook pendente), registrar isso
explicitamente como pendência bloqueante, sem fingir que fechou.

- [ ] **Step 7: Commit final**

```bash
git add docs/roadmap.md
git commit -m "docs: fecha Planos + Assinaturas (Mercado Pago)"
```
