# Fase 6 (sub-projeto B — Acesso do técnico parceiro) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao papel `parceiro` (existente no banco desde a Fase 1, nunca
usado em nenhuma tela) acesso completo às mesmas telas que o técnico
responsável já usa — documentos, conformidade, agenda e inspeções — para
as empresas às quais ele está vinculado via `tenant_partners`.

**Architecture:** Três políticas de RLS existentes (`documents_isolation`,
`inspections_isolation`, `action_plans_isolation`) ganham um branch
simétrico ao de `tecnico` (que usa `tenant_technicians`/`technicians`),
agora também para `parceiro` via `tenant_partners`/`partners`, usando
`ALTER POLICY` (sem `DROP`/`CREATE`, sem janela sem RLS). Seis pontos em
três controllers que hoje checam só `role === 'tecnico'` (`@Roles` e
guards de `tenant_id`) passam a aceitar `parceiro` também. Dois métodos
de serviço que fazem `JOIN` hardcoded contra `tenant_technicians`
(`TenantTechniciansService.findMyTenants`,
`DocumentsService.getPortfolioCompliance`) ganham bifurcação por papel.
Zero rota de frontend nova — as telas `/tecnico/*` já são genéricas
(chamam endpoints, não checam `role` no cliente); só uma linha no
redirect do login muda.

**Tech Stack:** NestJS + `pg` (PoolClient), Postgres com RLS, tudo em
containers Docker reais desta VPS. Nenhuma dependência nova.

**Spec:** [`docs/specs/fase-6-acesso-parceiro.md`](../specs/fase-6-acesso-parceiro.md)

## Global Constraints

- Tabelas envolvidas, já existentes desde a Fase 1: `partners(id,
  user_id, service_region, status, created_at, updated_at)`,
  `tenant_partners(tenant_id, partner_id, assigned_at, status)` — mesmo
  shape de `technicians`/`tenant_technicians`.
- Parceiro tem as MESMAS permissões que técnico responsável tem hoje:
  ler documentos/conformidade/agenda/inspeções das empresas vinculadas,
  subir e apagar documento, criar/editar/concluir inspeção. Nenhuma
  permissão a mais, nenhuma a menos.
- RLS: cada uma das três policies ganha um branch adicional via
  `EXISTS` contra `tenant_partners`+`partners`, comparando
  `p.user_id = current_setting('app.user_id')` e `current_setting('app.role') = 'parceiro'`
  — exatamente o mesmo padrão já usado para `tecnico`, só trocando a
  tabela de vínculo. `inspection_checklist_items_isolation` não muda —
  já delega para `inspections` via `EXISTS (SELECT 1 FROM inspections ...)`
  e herda o novo branch automaticamente.
- `ALTER POLICY <nome> ON <tabela> USING (...)` substitui a expressão
  inteira sem `DROP`/`CREATE` — migration puramente aditiva.
- Nomes de tabela/coluna que variam por papel (`tenant_technicians` vs
  `tenant_partners`, `technician_id` vs `partner_id`, `technicians` vs
  `partners`) vêm de uma escolha fixa de dois literais no código
  (`role === 'tecnico' ? '...' : '...'`), nunca de entrada do usuário —
  não é o mesmo risco que `buildSafeSetClause` existe para evitar (essa
  função protege contra nome de coluna vindo do body da requisição; aqui
  o valor vem só do `role` já validado pelo JWT).
- Zero arquivo de frontend novo. O único arquivo de frontend tocado é
  `frontend/src/app/(site)/login/page.tsx` — ele está sem commit ainda
  (caminho novo, trabalho de redesign visual de outra sessão que ainda
  não foi commitado). O fundador confirmou explicitamente que o commit
  desta task PODE incluir esse arquivo inteiro, redesign junto — não é
  um problema a evitar.
- Testes: e2e reais contra o Postgres real do Docker desta VPS (sem
  mock), mesmo padrão de todas as fases anteriores. Comando de teste
  completo (roda uma suíte específica; adapte o caminho no final):
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
    -e MERCADOPAGO_PUBLIC_KEY="${MERCADOPAGO_PUBLIC_KEY}" \
    -e MERCADOPAGO_WEBHOOK_SECRET="${MERCADOPAGO_WEBHOOK_SECRET}" \
    -e R2_ACCOUNT_ID="${R2_ACCOUNT_ID}" -e R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
    -e R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" -e R2_BUCKET="${R2_BUCKET}" \
    -e R2_ENDPOINT="${R2_ENDPOINT}" \
    -e RESEND_API_KEY="${RESEND_API_KEY}" -e EMAIL_FROM="${EMAIL_FROM}" \
    node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/<arquivo>.e2e-spec.ts"
  ```
- Frontend: build isolado antes de considerar a task de frontend pronta
  (nunca reconstruir o container `montese_frontend` de produção):
  ```bash
  cd /opt/Montese/frontend && docker build --target builder -t montese-frontend-test-build . \
    && docker rmi montese-frontend-test-build
  ```

---

### Task 1: Migration — RLS estendida pra `parceiro` em `documents`, `inspections`, `action_plans`

**Files:**
- Create: `backend/db/migrations/0011_partner_access.sql`
- Test: `backend/test/partner-rls.e2e-spec.ts`

**Interfaces:**
- Consumes: tabelas `partners`, `tenant_partners` (existentes desde
  `0001_init.sql`), policies `documents_isolation` (`0008_documents.sql`),
  `inspections_isolation`/`action_plans_isolation` (`0010_inspections.sql`).
- Produces: as três policies passam a aceitar `parceiro` — todas as
  tasks seguintes dependem disso pra qualquer teste de parceiro passar
  a nível de banco.

- [ ] **Step 1: Escrever a migration**

`backend/db/migrations/0011_partner_access.sql`:

```sql
-- Fase 6 (sub-projeto B — Acesso do técnico parceiro): estende as
-- policies de RLS de documents/inspections/action_plans, que já tinham
-- um branch para 'tecnico' via tenant_technicians, com um branch
-- simétrico para 'parceiro' via tenant_partners. Ver
-- docs/specs/fase-6-acesso-parceiro.md.

ALTER POLICY documents_isolation ON documents USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = documents.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = documents.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

ALTER POLICY inspections_isolation ON inspections USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = inspections.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = inspections.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

ALTER POLICY action_plans_isolation ON action_plans USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = action_plans.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = action_plans.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

-- inspection_checklist_items_isolation não muda — já delega pra
-- inspections via EXISTS (SELECT 1 FROM inspections i WHERE i.id = ...),
-- herda o branch de parceiro automaticamente.
```

- [ ] **Step 2: Rodar a migração contra o Postgres real do Docker**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:20-alpine npm run db:migrate
```

Esperado: `0011_partner_access.sql` aplicada (não `[skip]`, primeira vez).

- [ ] **Step 3: Escrever o teste de RLS (positivo e negativo, nas três tabelas)**

`backend/test/partner-rls.e2e-spec.ts`:

```typescript
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS para o papel parceiro (e2e)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let docAId: string;
  let inspectionAId: string;
  let itemAId: string;
  let actionPlanAId: string;
  let partnerLinkedUserId: string;
  let partnerLinkedId: string;
  let partnerUnlinkedUserId: string;
  let partnerUnlinkedId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Parceiro RLS A');
    const tenantB = await db.createTenantWithUser('Empresa Parceiro RLS B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const linkedPartner = await db.createUserWithRole('parceiro', 'Parceiro Vinculado RLS');
    const unlinkedPartner = await db.createUserWithRole('parceiro', 'Parceiro Nao Vinculado RLS');
    partnerLinkedUserId = linkedPartner.userId;
    partnerUnlinkedUserId = unlinkedPartner.userId;

    const linkedResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partnerLinkedUserId],
    );
    partnerLinkedId = linkedResult.rows[0].id;

    const unlinkedResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partnerUnlinkedUserId],
    );
    partnerUnlinkedId = unlinkedResult.rows[0].id;

    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantAId, partnerLinkedId],
    );

    const insertDocA = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR A', 'test-key-partner-a', 'a.pdf', 'application/pdf', 100, $2, 'empresa') RETURNING id`,
      [tenantAId, tenantA.userId],
    );
    docAId = insertDocA.rows[0].id;

    const insertInspectionA = await (db as any).client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at)
       VALUES ($1, $2, '2026-08-25') RETURNING id`,
      [tenantAId, tenantA.userId],
    );
    inspectionAId = insertInspectionA.rows[0].id;

    const insertItemA = await (db as any).client.query(
      `INSERT INTO inspection_checklist_items (inspection_id, block, item_key, item_label)
       VALUES ($1, 'documentacao', 'fichas_epi', 'Fichas de EPI em dia') RETURNING id`,
      [inspectionAId],
    );
    itemAId = insertItemA.rows[0].id;

    const insertActionPlanA = await (db as any).client.query(
      `INSERT INTO action_plans (tenant_id, inspection_id, checklist_item_id, description)
       VALUES ($1, $2, $3, 'Fichas de EPI em dia') RETURNING id`,
      [tenantAId, inspectionAId, itemAId],
    );
    actionPlanAId = insertActionPlanA.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM action_plans WHERE id = $1', [actionPlanAId]);
    await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [inspectionAId]);
    await (db as any).client.query('DELETE FROM documents WHERE id = $1', [docAId]);
    await (db as any).client.query('DELETE FROM partners WHERE id = ANY($1)', [
      [partnerLinkedId, partnerUnlinkedId],
    ]);
    await db.cleanup();
    await db.disconnect();
  });

  async function queryAsContext(
    role: string,
    tenantId: string | null,
    userId: string,
    table: 'documents' | 'inspections' | 'action_plans',
  ): Promise<string[]> {
    const appClient = new Client({ connectionString: process.env.DATABASE_URL });
    await appClient.connect();
    try {
      await appClient.query('BEGIN');
      await appClient.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId ?? '']);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.role', role]);
      const result = await appClient.query(`SELECT id FROM ${table}`);
      await appClient.query('ROLLBACK');
      return result.rows.map((r) => r.id);
    } finally {
      await appClient.end();
    }
  }

  it('parceiro vinculado à empresa A vê documents/inspections/action_plans dela', async () => {
    expect(await queryAsContext('parceiro', null, partnerLinkedUserId, 'documents')).toContain(docAId);
    expect(await queryAsContext('parceiro', null, partnerLinkedUserId, 'inspections')).toContain(
      inspectionAId,
    );
    expect(await queryAsContext('parceiro', null, partnerLinkedUserId, 'action_plans')).toContain(
      actionPlanAId,
    );
  });

  it('parceiro NÃO vinculado a nenhuma empresa não vê nada nas três tabelas', async () => {
    expect(await queryAsContext('parceiro', null, partnerUnlinkedUserId, 'documents')).not.toContain(
      docAId,
    );
    expect(await queryAsContext('parceiro', null, partnerUnlinkedUserId, 'inspections')).not.toContain(
      inspectionAId,
    );
    expect(await queryAsContext('parceiro', null, partnerUnlinkedUserId, 'action_plans')).not.toContain(
      actionPlanAId,
    );
  });

  it('vínculo de parceiro não dá acesso via a policy de técnico (papel errado não enxerga)', async () => {
    // Mesmo usuário/vínculo de parceiro, mas contexto de role='tecnico' —
    // não deve enxergar nada, prova que os dois branches são independentes.
    expect(await queryAsContext('tecnico', null, partnerLinkedUserId, 'documents')).not.toContain(docAId);
  });
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/partner-rls.e2e-spec.ts"
```

Esperado: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/0011_partner_access.sql backend/test/partner-rls.e2e-spec.ts
git commit -m "feat: estende RLS de documents/inspections/action_plans pro papel parceiro"
```

---

### Task 2: `tenant-technicians/me` reconhece `parceiro`

**Files:**
- Modify: `backend/src/tenant-technicians/tenant-technicians.service.ts`
- Modify: `backend/src/tenant-technicians/tenant-technicians.controller.ts`
- Test: `backend/test/tenant-technicians-partner.e2e-spec.ts`

**Interfaces:**
- Consumes: RLS estendida (Task 1) — não é estritamente necessária pra
  esta query específica (ela já filtra por `user_id` explícito, não
  depende de RLS pra restringir), mas roda depois por ordem lógica do
  plano.
- Produces: `TenantTechniciansService.findMyTenants(client, userId,
  role)` — assinatura muda (novo terceiro parâmetro obrigatório); usado
  só pelo controller desta task, nenhuma task seguinte depende do nome
  do parâmetro.

- [ ] **Step 1: Atualizar o service pra bifurcar por papel**

Reescrever `backend/src/tenant-technicians/tenant-technicians.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface LinkedTenant {
  tenant_id: string;
  tenant_name: string;
  tenant_cnpj: string;
}

@Injectable()
export class TenantTechniciansService {
  async findMyTenants(
    client: PoolClient,
    userId: string,
    role: 'tecnico' | 'parceiro',
  ): Promise<LinkedTenant[]> {
    const linkTable = role === 'tecnico' ? 'tenant_technicians' : 'tenant_partners';
    const linkColumn = role === 'tecnico' ? 'technician_id' : 'partner_id';
    const personTable = role === 'tecnico' ? 'technicians' : 'partners';

    const result = await client.query<LinkedTenant>(
      `SELECT t.id AS tenant_id, t.name AS tenant_name, t.cnpj AS tenant_cnpj
       FROM ${linkTable} lt
       JOIN ${personTable} p ON p.id = lt.${linkColumn}
       JOIN tenants t ON t.id = lt.tenant_id
       WHERE p.user_id = $1
       ORDER BY t.name`,
      [userId],
    );
    return result.rows;
  }
}
```

Os nomes interpolados (`linkTable`/`linkColumn`/`personTable`) só podem
assumir um de dois valores fixos escritos no próprio código — nunca vêm
do `body`/`query` da requisição, então não é o caso que
`buildSafeSetClause` existe pra evitar (essa função protege contra nome
de coluna vindo de fora; aqui a única entrada externa é `role`, que já
passou pela validação do JWT antes de chegar aqui).

- [ ] **Step 2: Atualizar o controller**

Em `backend/src/tenant-technicians/tenant-technicians.controller.ts`:

```typescript
import { Controller, Get, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantTechniciansService } from './tenant-technicians.service';

@Controller('tenant-technicians')
export class TenantTechniciansController {
  constructor(private readonly tenantTechnicians: TenantTechniciansService) {}

  @Roles('tecnico', 'parceiro')
  @Get('me')
  findMyTenants(@Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.tenantTechnicians.findMyTenants(client, req.user.id, req.user.role),
    );
  }
}
```

- [ ] **Step 3: Escrever o teste**

`backend/test/tenant-technicians-partner.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /tenant-technicians/me para o papel parceiro (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let partnerId: string;
  let partnerToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa TenantPartner Teste');
    tenantId = tenant.tenantId;
    const partner = await db.createUserWithRole('parceiro', 'Parceiro TenantPartner Teste');

    const partnerResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partner.userId],
    );
    partnerId = partnerResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantId, partnerId],
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: partner.email, password: partner.password });
    partnerToken = loginRes.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM tenant_partners WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM partners WHERE id = $1', [partnerId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('lista as empresas vinculadas ao parceiro autenticado, via tenant_partners', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenant-technicians/me')
      .set('Authorization', `Bearer ${partnerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].tenant_id).toBe(tenantId);
  });
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/tenant-technicians-partner.e2e-spec.ts"
```

Esperado: PASS, 1/1. Rode também `test/tenant-technicians.e2e-spec.ts` (já existente, cobre o caminho de técnico) pra confirmar que a bifurcação não quebrou o comportamento anterior:

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/tenant-technicians.e2e-spec.ts"
```

Esperado: PASS, 1/1 (continua passando — prova que a mudança de assinatura não quebrou o caminho de técnico).

- [ ] **Step 5: Commit**

```bash
git add backend/src/tenant-technicians backend/test/tenant-technicians-partner.e2e-spec.ts
git commit -m "feat: GET /tenant-technicians/me reconhece o papel parceiro"
```

---

### Task 3: `documents` reconhece `parceiro`

**Files:**
- Modify: `backend/src/documents/documents.controller.ts`
- Modify: `backend/src/documents/documents.service.ts`
- Modify: `backend/src/documents/dto/create-document.dto.ts`
- Test: `backend/test/documents-partner.e2e-spec.ts`

**Interfaces:**
- Consumes: RLS estendida (Task 1).
- Produces: `DocumentsService.getPortfolioCompliance(client, userId,
  role)` — assinatura muda (novo terceiro parâmetro); usado só pelo
  controller desta task.

- [ ] **Step 1: Atualizar o controller**

Em `backend/src/documents/documents.controller.ts`, três mudanças
pontuais (o resto do arquivo não muda):

Linha do `@Roles` do `upload` (era `@Roles('empresa', 'tecnico')`):

```typescript
  @Roles('empresa', 'tecnico', 'parceiro')
```

Dentro de `upload`, a linha que deriva `tenantId` (era `const tenantId =
user.role === 'tecnico' ? dto.tenant_id : user.tenantId;`):

```typescript
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
```

Dentro de `compliance`, o guard (era `if (req.user.role === 'tecnico' &&
!tenantId)`):

```typescript
  compliance(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if ((req.user.role === 'tecnico' || req.user.role === 'parceiro') && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.documents.getCompliance(client, tenantId));
  }
```

O `@Roles` de `portfolioCompliance` (era `@Roles('tecnico')`), e a
chamada ao service ganha `req.user.role`:

```typescript
  @Roles('tecnico', 'parceiro')
  @Get('compliance/portfolio')
  portfolioCompliance(@Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.documents.getPortfolioCompliance(client, req.user.id, req.user.role),
    );
  }
```

O `@Roles` de `remove` (era `@Roles('empresa', 'tecnico', 'admin')`):

```typescript
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
```

(`findAll` e `download` não têm `@Roles` nem checagem de papel hoje —
não precisam de nenhuma mudança, RLS já decide sozinha.)

- [ ] **Step 2: Corrigir o comentário do DTO, que agora está impreciso**

Em `backend/src/documents/dto/create-document.dto.ts`, o comentário
acima de `tenant_id` diz hoje "Só é lido quando quem envia é role
'tecnico'" — imprecisão que esta task introduz. Trocar:

```typescript
  // Só é lido quando quem envia é role 'tecnico' (empresa sempre usa o
  // próprio tenant_id do token).
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
```

por:

```typescript
  // Só é lido quando quem envia é role 'tecnico' ou 'parceiro' (empresa
  // sempre usa o próprio tenant_id do token).
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
```

- [ ] **Step 3: Atualizar `getPortfolioCompliance` pra bifurcar por papel**

Em `backend/src/documents/documents.service.ts`, o método
`getPortfolioCompliance` (mantém toda a lógica de agrupamento/score
intacta, só muda a assinatura e o `FROM`/`JOIN` da query):

```typescript
  async getPortfolioCompliance(
    client: PoolClient,
    userId: string,
    role: 'tecnico' | 'parceiro',
  ): Promise<PortfolioComplianceItem[]> {
    const linkTable = role === 'tecnico' ? 'tenant_technicians' : 'tenant_partners';
    const linkColumn = role === 'tecnico' ? 'technician_id' : 'partner_id';
    const personTable = role === 'tecnico' ? 'technicians' : 'partners';

    const result = await client.query<{
      tenant_id: string;
      tenant_name: string;
      document_id: string | null;
      expires_at: string | null;
    }>(
      `SELECT t.id AS tenant_id, t.name AS tenant_name, d.id AS document_id, d.expires_at
       FROM ${linkTable} lt
       JOIN ${personTable} p ON p.id = lt.${linkColumn}
       JOIN tenants t ON t.id = lt.tenant_id
       LEFT JOIN documents d ON d.tenant_id = t.id AND d.expires_at IS NOT NULL
       WHERE p.user_id = $1
       ORDER BY t.name`,
      [userId],
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const order: string[] = [];
    const groups = new Map<
      string,
      { tenant_name: string; total: number; emDia: number; pendencias: number; avisos: number }
    >();

    for (const row of result.rows) {
      if (!groups.has(row.tenant_id)) {
        groups.set(row.tenant_id, { tenant_name: row.tenant_name, total: 0, emDia: 0, pendencias: 0, avisos: 0 });
        order.push(row.tenant_id);
      }
      if (!row.expires_at) continue;

      const group = groups.get(row.tenant_id)!;
      group.total++;
      const expiresAt = new Date(row.expires_at);
      expiresAt.setHours(0, 0, 0, 0);
      const diffDays = Math.round((expiresAt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        group.pendencias++;
      } else if (diffDays <= 30) {
        group.avisos++;
        group.emDia++;
      } else {
        group.emDia++;
      }
    }

    return order.map((tenantId) => {
      const g = groups.get(tenantId)!;
      return {
        tenant_id: tenantId,
        tenant_name: g.tenant_name,
        score: g.total === 0 ? null : Math.round((g.emDia / g.total) * 100),
        pendencias_count: g.pendencias,
        avisos_count: g.avisos,
      };
    });
  }
```

Mesmo raciocínio de segurança do Task 2 (Step 1) sobre os nomes
interpolados — só dois valores fixos, nunca vindos de fora.

- [ ] **Step 4: Escrever o teste**

`backend/test/documents-partner.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('documents reconhece o papel parceiro (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let partnerId: string;
  let partnerToken: string;
  let s3: S3Client;
  let uploadedFileKey: string | undefined;
  let uploadedDocumentId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Documents Partner Teste');
    tenantId = tenant.tenantId;
    const partner = await db.createUserWithRole('parceiro', 'Parceiro Documents Teste');

    const partnerResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partner.userId],
    );
    partnerId = partnerResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantId, partnerId],
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: partner.email, password: partner.password });
    partnerToken = loginRes.body.access_token;

    s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  });

  afterAll(async () => {
    if (uploadedFileKey) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: uploadedFileKey }));
      } catch {
        // já apagado pelo próprio teste — esperado no caminho feliz
      }
    }
    if (uploadedDocumentId) {
      await (db as any).client.query('DELETE FROM documents WHERE id = $1', [uploadedDocumentId]);
    }
    await (db as any).client.query('DELETE FROM tenant_partners WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM partners WHERE id = $1', [partnerId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('parceiro faz upload real de um documento pra empresa vinculada, aparece na listagem', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 conteudo de teste parceiro', 'utf-8');

    const uploadRes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${partnerToken}`)
      .field('category', 'pgr')
      .field('title', 'PGR de teste parceiro')
      .field('tenant_id', tenantId)
      .attach('file', fakePdf, { filename: 'pgr-parceiro.pdf', contentType: 'application/pdf' });

    expect(uploadRes.status).toBe(201);
    uploadedFileKey = uploadRes.body.file_key;
    uploadedDocumentId = uploadRes.body.id;

    const head = await s3.send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: uploadedFileKey }),
    );
    expect(head.ContentLength).toBe(fakePdf.length);
  });

  it('parceiro vê o portfólio de conformidade (score por empresa vinculada)', async () => {
    const res = await request(app.getHttpServer())
      .get('/documents/compliance/portfolio')
      .set('Authorization', `Bearer ${partnerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.some((item: { tenant_id: string }) => item.tenant_id === tenantId)).toBe(true);
  });

  it('parceiro consegue apagar o documento que ele mesmo subiu', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/documents/${uploadedDocumentId}`)
      .set('Authorization', `Bearer ${partnerToken}`);

    expect(res.status).toBe(200);
    await expect(
      s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: uploadedFileKey })),
    ).rejects.toThrow();
    uploadedFileKey = undefined;
    uploadedDocumentId = undefined;
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
  -e R2_ACCOUNT_ID="${R2_ACCOUNT_ID}" -e R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
  -e R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" -e R2_BUCKET="${R2_BUCKET}" \
  -e R2_ENDPOINT="${R2_ENDPOINT}" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/documents-partner.e2e-spec.ts"
```

Esperado: PASS, 3/3. Rode também as suítes já existentes de `documents`
(`documents-upload.e2e-spec.ts`, `documents-compliance.e2e-spec.ts`,
`documents-download-delete.e2e-spec.ts`, `documents-rls.e2e-spec.ts`,
`documents-portfolio.e2e-spec.ts`) pra confirmar que nada do caminho de
técnico/empresa quebrou:

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  -e R2_ACCOUNT_ID="${R2_ACCOUNT_ID}" -e R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
  -e R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" -e R2_BUCKET="${R2_BUCKET}" \
  -e R2_ENDPOINT="${R2_ENDPOINT}" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand --testPathPattern documents"
```

Esperado: todas as suítes de `documents` passando.

- [ ] **Step 6: Commit**

```bash
git add backend/src/documents backend/test/documents-partner.e2e-spec.ts
git commit -m "feat: documents reconhece o papel parceiro (upload, conformidade, exclusao)"
```

---

### Task 4: `inspections`/`action-plans` reconhecem `parceiro`

**Files:**
- Modify: `backend/src/inspections/inspections.controller.ts`
- Modify: `backend/src/inspections/action-plans.controller.ts`
- Test: `backend/test/inspections-partner.e2e-spec.ts`

**Interfaces:**
- Consumes: RLS estendida (Task 1).
- Produces: nenhuma interface nova — só extensão de `@Roles`/guard.

- [ ] **Step 1: Atualizar `inspections.controller.ts`**

Quatro `@Roles('tecnico')` (em `create`, `update`, `updateItem`,
`conclude`) viram `@Roles('tecnico', 'parceiro')`. O guard de `tenant_id`
em `findAll` (era `if (req.user.role === 'tecnico' && !tenantId)`):

```typescript
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if ((req.user.role === 'tecnico' || req.user.role === 'parceiro') && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.inspections.findAll(client, tenantId));
  }
```

(`findOne` não tem `@Roles` nem checagem de papel — não muda.)

- [ ] **Step 2: Atualizar `action-plans.controller.ts`**

Mesmo guard de `tenant_id` (era `if (req.user.role === 'tecnico' &&
!tenantId)`):

```typescript
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if ((req.user.role === 'tecnico' || req.user.role === 'parceiro') && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.inspections.findActionPlans(client, tenantId));
  }
```

- [ ] **Step 3: Escrever o teste**

`backend/test/inspections-partner.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('inspections/action-plans reconhecem o papel parceiro (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let partnerId: string;
  let partnerToken: string;
  let inspectionId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection Partner Teste');
    tenantId = tenant.tenantId;
    const partner = await db.createUserWithRole('parceiro', 'Parceiro Inspection Teste');

    const partnerResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partner.userId],
    );
    partnerId = partnerResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantId, partnerId],
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: partner.email, password: partner.password });
    partnerToken = loginRes.body.access_token;
  });

  afterAll(async () => {
    if (inspectionId) {
      await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [inspectionId]);
    }
    await (db as any).client.query('DELETE FROM tenant_partners WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM partners WHERE id = $1', [partnerId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('parceiro cria, edita, marca item NC e conclui uma inspeção, gerando plano de ação', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25' });
    expect(createRes.status).toBe(201);
    inspectionId = createRes.body.id;
    const itemId = createRes.body.items[0].id;

    const updateRes = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ company_contact: 'Contato via parceiro' });
    expect(updateRes.status).toBe(200);

    const itemRes = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${itemId}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ status: 'NC' });
    expect(itemRes.status).toBe(200);

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${partnerToken}`);
    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.action_plans).toHaveLength(1);
  });

  it('parceiro lista os planos de ação da empresa vinculada', async () => {
    const res = await request(app.getHttpServer())
      .get(`/action-plans?tenant_id=${tenantId}`)
      .set('Authorization', `Bearer ${partnerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('parceiro sem tenant_id em /inspections e /action-plans recebe 400', async () => {
    const inspectionsRes = await request(app.getHttpServer())
      .get('/inspections')
      .set('Authorization', `Bearer ${partnerToken}`);
    expect(inspectionsRes.status).toBe(400);

    const actionPlansRes = await request(app.getHttpServer())
      .get('/action-plans')
      .set('Authorization', `Bearer ${partnerToken}`);
    expect(actionPlansRes.status).toBe(400);
  });
});
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/inspections-partner.e2e-spec.ts"
```

Esperado: PASS, 3/3. Rode também as suítes já existentes de
`inspections`/`action-plans` (`inspections-create-list`,
`inspections-update`, `inspections-conclude`, `inspections-rls`,
`action-plans-list`) pra confirmar que o caminho de técnico não quebrou:

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand --testPathPattern 'inspections|action-plans'"
```

Esperado: todas as suítes passando.

- [ ] **Step 5: Commit**

```bash
git add backend/src/inspections backend/test/inspections-partner.e2e-spec.ts
git commit -m "feat: inspections e action-plans reconhecem o papel parceiro"
```

---

### Task 5: Frontend — redirect do login inclui `parceiro`

**Files:**
- Modify: `frontend/src/app/(site)/login/page.tsx`

**Interfaces:**
- Consumes: nenhuma nova.
- Produces: nenhuma nova — última task do plano.

- [ ] **Step 1: Atualizar a linha de redirect**

Em `frontend/src/app/(site)/login/page.tsx`, dentro de `handleSubmit`,
trocar:

```typescript
      router.push(
        role === 'empresa' ? '/empresa/onboarding' : role === 'tecnico' ? '/tecnico/empresas' : '/',
      );
```

por:

```typescript
      router.push(
        role === 'empresa'
          ? '/empresa/onboarding'
          : role === 'tecnico' || role === 'parceiro'
            ? '/tecnico/empresas'
            : '/',
      );
```

Nenhuma outra linha do arquivo muda.

- [ ] **Step 2: Build isolado**

```bash
cd /opt/Montese/frontend && docker build --target builder -t montese-frontend-test-build . \
  && docker rmi montese-frontend-test-build
```

Esperado: `Compiled successfully`, sem erro de tipo.

- [ ] **Step 3: Commit**

Este arquivo está sem histórico git ainda (caminho novo de outra
sessão, redesign visual não commitado) — o commit vai incluir o arquivo
inteiro, não só a linha alterada. O fundador confirmou explicitamente
que isso é esperado e aceitável para esta task (ver Global Constraints).

```bash
git add "frontend/src/app/(site)/login/page.tsx"
git commit -m "feat: redirect de login inclui o papel parceiro"
```

---

## Depois de todas as tasks

Rodar a suíte e2e completa mais uma vez (mesmo comando usado nos Steps
de regressão das Tasks 3/4, mas sem `--testPathPattern`, cobrindo tudo)
e confirmar 0 regressões. Atualizar `docs/roadmap.md` com o fechamento
da Fase 6 sub-projeto B, seguindo o mesmo formato usado nas fases
anteriores (tabela de tasks, evidência de verificação, pendências
explícitas: catálogo de EPI continua como único item pendente da Fase
6).
