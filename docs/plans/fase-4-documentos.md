# Fase 4 (sub-projeto A — Documentos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à empresa e ao técnico responsável um repositório real de
documentos de conformidade (PGR, PCMSO, laudo, ficha de EPI,
treinamento) — upload, listagem, download e exclusão — armazenado no
Cloudflare R2, nunca no disco da VPS.

**Architecture:** Tabela `documents` nova com uma policy de RLS mais
rica que o padrão usual (empresa vê o próprio tenant; técnico vê
qualquer tenant ao qual esteja vinculado via `tenant_technicians`,
checado por `EXISTS`). Upload passa pelo backend (valida tipo/tamanho,
então envia pro R2 via SDK S3); download usa URL pré-assinada de leitura
gerada pelo backend, mas servida direto pelo R2. Corrige uma falha de
permissão real e pré-existente (endpoint de vínculo técnico↔empresa da
Fase 1 permitia empresa se auto-vincular sem intermediação humana).
Introduz a primeira página autenticada do técnico.

**Tech Stack:** NestJS + `pg` (PoolClient), Postgres com RLS,
`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (R2 é
S3-compatible), `@nestjs/platform-express` `FileInterceptor` (mesmo
padrão já usado pra CSV na Fase 3), Next.js 14 App Router + Tailwind v4,
tudo em containers Docker reais desta VPS.

**Spec:** [`docs/specs/fase-4-documentos.md`](../specs/fase-4-documentos.md)

## Global Constraints

- Documentos NUNCA ficam no disco da VPS — sempre R2. Credenciais já
  configuradas no `.env` real desta VPS: `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
  (`montese-documentos`), `R2_ENDPOINT`.
- Categorias fixas: `pgr`, `pcmso`, `laudo`, `ficha_epi`, `treinamento`.
- Tipos de arquivo aceitos: `application/pdf`, `image/jpeg`,
  `image/png`. Tamanho máximo: 10MB (`10 * 1024 * 1024` bytes).
- Upload passa pelo backend (nunca URL pré-assinada de escrita direto do
  navegador). Download usa URL pré-assinada de leitura, validade de 300
  segundos (5 minutos).
- Só quem subiu o documento (`uploaded_by_user_id`) ou `admin` pode
  apagar.
- RLS de `documents`: `admin` vê tudo; `empresa` vê o próprio
  `tenant_id`; `tecnico` vê qualquer tenant ao qual esteja vinculado via
  `tenant_technicians` (checado por `EXISTS`, não comparação direta de
  coluna — técnico não tem `tenant_id` próprio).
- **Correção de segurança nesta mesma sub-fase:** `POST/DELETE
  /technicians/:id/assign` (já existe desde a Fase 1) tem hoje
  `@Roles('empresa', 'admin')` — permite empresa se auto-vincular a
  qualquer técnico sem intermediação humana, contradizendo o diferencial
  de atendimento humano do `docs/vision.md` e a decisão tomada no
  brainstorming desta sub-fase. Corrige pra `@Roles('admin')` apenas.
  Nunca testado antes (nenhum e2e cobria isso) — esta sub-fase adiciona
  o primeiro teste real pra esse endpoint.
- Testes: e2e reais contra Postgres real do Docker E contra o bucket R2
  real (sem mock/emulador) — mesmo padrão rigoroso de todas as fases
  anteriores. Cada teste que sobe um arquivo real apaga o que criou ao
  final (linha do Postgres E objeto do R2), confirmando a remoção via
  `HeadObjectCommand` real, não só a ausência da linha no banco. Comando
  de teste completo, mesmo formato já usado nas fases anteriores:
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
    -e R2_ACCOUNT_ID="${R2_ACCOUNT_ID}" -e R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
    -e R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" -e R2_BUCKET="${R2_BUCKET}" \
    -e R2_ENDPOINT="${R2_ENDPOINT}" \
    node:20-alpine sh -c "npm run test:e2e"
  ```
  (`PUBLIC_APP_URL="https://example.com"` — mesma ressalva já documentada
  desde a fase de pagamento, necessária só pro `subscriptions.e2e-spec.ts`
  já existente continuar passando; um flake ocasional em
  `register.e2e-spec.ts` no full-suite run, já investigado em fase
  anterior — rodar de novo se acontecer, não é regressão.)

---

### Task 1: Migration — tabela `documents` + RLS

**Files:**
- Create: `backend/db/migrations/0008_documents.sql`
- Test: `backend/test/documents-rls.e2e-spec.ts`

**Interfaces:**
- Consumes: `tenant_technicians`, `technicians` (já existem desde a Fase 1).
- Produces: tabela `documents(id, tenant_id, category, title, file_key,
  file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id,
  uploaded_by_role, created_at, updated_at)` com RLS.

- [ ] **Step 1: Escrever a migration**

`backend/db/migrations/0008_documents.sql`:

```sql
-- Fase 4 (sub-projeto A — Documentos): repositório de documentos de
-- conformidade em R2, com RLS que também cobre a visão do técnico
-- vinculado (não só do próprio tenant). Ver docs/specs/fase-4-documentos.md.

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (
    category IN ('pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento')
  ),
  title TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  expires_at DATE,
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id),
  uploaded_by_role TEXT NOT NULL CHECK (uploaded_by_role IN ('empresa', 'tecnico')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_isolation ON documents USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = documents.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
);
```

Nenhum `GRANT` extra necessário — `documents` é criada pela mesma role
(`montese_app`) que já é dona de todas as outras tabelas de aplicação.

- [ ] **Step 2: Rodar a migração contra o Postgres real do Docker**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:20-alpine npm run db:migrate
```

Esperado: `0008_documents.sql` aplicada (não `[skip]`, primeira vez).

- [ ] **Step 3: Escrever o teste de RLS (positivo e negativo, nos dois sentidos)**

`backend/test/documents-rls.e2e-spec.ts`:

```typescript
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS em documents (e2e)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let docAId: string;
  let docBId: string;
  let technicianLinkedUserId: string;
  let technicianLinkedId: string;
  let technicianUnlinkedUserId: string;
  let technicianUnlinkedId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Doc RLS A');
    const tenantB = await db.createTenantWithUser('Empresa Doc RLS B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const linkedTech = await db.createUserWithRole('tecnico', 'Tecnico Vinculado RLS');
    const unlinkedTech = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado RLS');
    technicianLinkedUserId = linkedTech.userId;
    technicianUnlinkedUserId = unlinkedTech.userId;

    const linkedResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [technicianLinkedUserId],
    );
    technicianLinkedId = linkedResult.rows[0].id;

    const unlinkedResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [technicianUnlinkedUserId],
    );
    technicianUnlinkedId = unlinkedResult.rows[0].id;

    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantAId, technicianLinkedId],
    );

    const insertDocA = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR A', 'test-key-a', 'a.pdf', 'application/pdf', 100, $2, 'empresa') RETURNING id`,
      [tenantAId, tenantA.userId],
    );
    docAId = insertDocA.rows[0].id;

    const insertDocB = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR B', 'test-key-b', 'b.pdf', 'application/pdf', 100, $2, 'empresa') RETURNING id`,
      [tenantBId, tenantB.userId],
    );
    docBId = insertDocB.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM documents WHERE id = ANY($1)', [[docAId, docBId]]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = ANY($1)', [
      [technicianLinkedId, technicianUnlinkedId],
    ]);
    await db.cleanup();
    await db.disconnect();
  });

  async function queryAsContext(role: string, tenantId: string | null, userId: string): Promise<string[]> {
    const appClient = new Client({ connectionString: process.env.DATABASE_URL });
    await appClient.connect();
    try {
      await appClient.query('BEGIN');
      await appClient.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId ?? '']);
      await appClient.query('SELECT set_config($1, $2, true)', ['app.role', role]);
      const result = await appClient.query('SELECT id FROM documents');
      await appClient.query('ROLLBACK');
      return result.rows.map((r) => r.id);
    } finally {
      await appClient.end();
    }
  }

  it('empresa A só vê o próprio documento via RLS, nunca o de empresa B', async () => {
    const ids = await queryAsContext('empresa', tenantAId, randomUUID());
    expect(ids).toContain(docAId);
    expect(ids).not.toContain(docBId);
  });

  it('técnico vinculado à empresa A vê o documento dela', async () => {
    const ids = await queryAsContext('tecnico', null, technicianLinkedUserId);
    expect(ids).toContain(docAId);
  });

  it('técnico NÃO vinculado a nenhuma empresa não vê documento nenhum', async () => {
    const ids = await queryAsContext('tecnico', null, technicianUnlinkedUserId);
    expect(ids).not.toContain(docAId);
    expect(ids).not.toContain(docBId);
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
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/documents-rls.e2e-spec.ts"
```

Esperado: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/0008_documents.sql backend/test/documents-rls.e2e-spec.ts
git commit -m "feat: migration de documents com RLS (tenant direto + tecnico vinculado)"
```

---

### Task 2: Corrige `POST/DELETE /technicians/:id/assign` pra admin-only

**Files:**
- Modify: `backend/src/technicians/technicians.controller.ts`
- Test: `backend/test/technicians-assign.e2e-spec.ts`

**Interfaces:**
- Consumes: `TechniciansService.assign`/`unassign` (já existem, não mudam).
- Produces: nenhuma interface nova — só corrige uma permissão.

- [ ] **Step 1: Corrigir os decorators**

Em `backend/src/technicians/technicians.controller.ts`, trocar as duas
linhas (o resto do arquivo não muda):

```typescript
  @Roles('admin')
  @Post(':id/assign')
```

```typescript
  @Roles('admin')
  @Delete(':id/assign')
```

(eram `@Roles('empresa', 'admin')` nos dois — remove `'empresa'`.)

- [ ] **Step 2: Escrever o teste**

`backend/test/technicians-assign.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/DELETE /technicians/:id/assign (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenEmpresa: string;
  let tokenAdmin: string;
  let tenantId: string;
  let technicianId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Assign Teste');
    tenantId = tenant.tenantId;
    const admin = await db.createUserWithRole('admin', 'Admin Assign Teste');
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Assign Teste');

    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('rejeita empresa tentando se auto-vincular a um técnico (403)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/technicians/${technicianId}/assign`)
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('admin consegue vincular técnico a uma empresa', async () => {
    const res = await request(app.getHttpServer())
      .post(`/technicians/${technicianId}/assign`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tenant_id: tenantId });

    expect(res.status).toBe(201);

    const linkResult = await (db as any).client.query(
      'SELECT * FROM tenant_technicians WHERE tenant_id = $1 AND technician_id = $2',
      [tenantId, technicianId],
    );
    expect(linkResult.rowCount).toBe(1);
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/technicians-assign.e2e-spec.ts"
```

Esperado: PASS, 2/2.

- [ ] **Step 4: Commit**

```bash
git add backend/src/technicians/technicians.controller.ts backend/test/technicians-assign.e2e-spec.ts
git commit -m "fix: restringe vinculo tecnico-empresa a admin-only (era empresa+admin desde Fase 1)"
```

---

### Task 3: `GET /tenant-technicians/me` — listagem pro técnico

**Files:**
- Create: `backend/src/tenant-technicians/tenant-technicians.module.ts`
- Create: `backend/src/tenant-technicians/tenant-technicians.controller.ts`
- Create: `backend/src/tenant-technicians/tenant-technicians.service.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/tenant-technicians.e2e-spec.ts`

**Interfaces:**
- Consumes: `tenant_technicians`, `technicians`, `tenants` (existentes).
- Produces: `GET /tenant-technicians/me` → `LinkedTenant[]`
  (`{tenant_id, tenant_name, tenant_cnpj}[]`) — Task 7 (frontend, página
  `/tecnico/empresas`) consome exatamente esse shape.

- [ ] **Step 1: Escrever o service**

`backend/src/tenant-technicians/tenant-technicians.service.ts`:

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
  async findMyTenants(client: PoolClient, userId: string): Promise<LinkedTenant[]> {
    const result = await client.query<LinkedTenant>(
      `SELECT t.id AS tenant_id, t.name AS tenant_name, t.cnpj AS tenant_cnpj
       FROM tenant_technicians tt
       JOIN technicians tech ON tech.id = tt.technician_id
       JOIN tenants t ON t.id = tt.tenant_id
       WHERE tech.user_id = $1
       ORDER BY t.name`,
      [userId],
    );
    return result.rows;
  }
}
```

- [ ] **Step 2: Escrever o controller**

`backend/src/tenant-technicians/tenant-technicians.controller.ts`:

```typescript
import { Controller, Get, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantTechniciansService } from './tenant-technicians.service';

@Controller('tenant-technicians')
export class TenantTechniciansController {
  constructor(private readonly tenantTechnicians: TenantTechniciansService) {}

  @Roles('tecnico')
  @Get('me')
  findMyTenants(@Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.tenantTechnicians.findMyTenants(client, req.user.id),
    );
  }
}
```

- [ ] **Step 3: Registrar o módulo**

`backend/src/tenant-technicians/tenant-technicians.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TenantTechniciansController } from './tenant-technicians.controller';
import { TenantTechniciansService } from './tenant-technicians.service';

@Module({
  controllers: [TenantTechniciansController],
  providers: [TenantTechniciansService],
})
export class TenantTechniciansModule {}
```

Em `backend/src/app.module.ts`: adicionar
`import { TenantTechniciansModule } from './tenant-technicians/tenant-technicians.module';`
e `TenantTechniciansModule` no array `imports`.

- [ ] **Step 4: Escrever o teste**

`backend/test/tenant-technicians.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /tenant-technicians/me (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let technicianId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa TenantTech Teste');
    tenantId = tenant.tenantId;
    const tech = await db.createUserWithRole('tecnico', 'Tecnico TenantTech Teste');

    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('lista as empresas vinculadas ao técnico autenticado', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenant-technicians/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].tenant_id).toBe(tenantId);
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
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/tenant-technicians.e2e-spec.ts"
```

Esperado: PASS, 1/1.

- [ ] **Step 6: Commit**

```bash
git add backend/src/tenant-technicians backend/src/app.module.ts backend/test/tenant-technicians.e2e-spec.ts
git commit -m "feat: adiciona GET /tenant-technicians/me"
```

---

### Task 4: R2Service + `POST /documents` (upload) + `GET /documents` (listagem)

**Files:**
- Create: `backend/src/documents/r2.service.ts`
- Create: `backend/src/documents/documents.module.ts`
- Create: `backend/src/documents/documents.controller.ts`
- Create: `backend/src/documents/documents.service.ts`
- Create: `backend/src/documents/dto/create-document.dto.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/package.json` (novas dependências)
- Test: `backend/test/documents-upload.e2e-spec.ts`

**Interfaces:**
- Consumes: `documents` (Task 1), credenciais R2 do `.env`.
- Produces: `R2Service.putObject/getPresignedDownloadUrl/deleteObject` —
  Task 5 injeta e usa `getPresignedDownloadUrl`/`deleteObject` no mesmo
  `DocumentsService`; `DocumentsService.upload/findAll/findOne` — Task 5
  adiciona `getDownloadUrl`/`remove` ao mesmo service, reaproveitando
  `findOne`.

- [ ] **Step 1: Instalar as dependências do SDK S3**

```bash
docker run --rm -v "$(pwd)/backend:/app" -w /app node:20-alpine \
  npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

(R2 é compatível com a API S3 — funciona com o SDK oficial da AWS
apontando pro endpoint do R2, sem biblioteca própria da Cloudflare.)

- [ ] **Step 2: Escrever o cliente R2**

`backend/src/documents/r2.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Mesmo padrão de fallback já usado em EmailService/MercadoPagoService —
// não deixa a ausência de credencial derrubar o boot da aplicação, a
// falha real acontece na chamada, não na configuração.
@Injectable()
export class R2Service {
  private readonly client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT || 'https://missing-r2-endpoint.example.com',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || 'missing-access-key',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || 'missing-secret-key',
    },
  });

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getPresignedDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: 300 });
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  }
}
```

- [ ] **Step 3: Escrever o DTO**

`backend/src/documents/dto/create-document.dto.ts`:

```typescript
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDocumentDto {
  @IsIn(['pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento'])
  category: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsISO8601()
  expires_at?: string;

  // Só é lido quando quem envia é role 'tecnico' (empresa sempre usa o
  // próprio tenant_id do token).
  @IsOptional()
  @IsString()
  tenant_id?: string;
}
```

- [ ] **Step 4: Escrever o service**

`backend/src/documents/documents.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { R2Service } from './r2.service';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const ALLOWED_CATEGORIES = ['pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento'];

export interface Document {
  id: string;
  tenant_id: string;
  category: string;
  title: string;
  file_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  expires_at: string | null;
  uploaded_by_user_id: string;
  uploaded_by_role: string;
  created_at: string;
  updated_at: string;
}

interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

interface UploadData {
  tenantId: string;
  category: string;
  title: string;
  expiresAt?: string;
  file: UploadFile;
  uploadedByUserId: string;
  uploadedByRole: 'empresa' | 'tecnico';
}

@Injectable()
export class DocumentsService {
  constructor(private readonly r2: R2Service) {}

  async upload(client: PoolClient, data: UploadData): Promise<Document> {
    if (!ALLOWED_MIME_TYPES.includes(data.file.mimetype)) {
      throw new BadRequestException('Tipo de arquivo não permitido (só PDF, JPG ou PNG)');
    }
    if (!ALLOWED_CATEGORIES.includes(data.category)) {
      throw new BadRequestException('Categoria inválida');
    }

    const id = randomUUID();
    const fileKey = `tenants/${data.tenantId}/documents/${id}/${data.file.originalname}`;
    await this.r2.putObject(fileKey, data.file.buffer, data.file.mimetype);

    const result = await client.query<Document>(
      `INSERT INTO documents (id, tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        id,
        data.tenantId,
        data.category,
        data.title,
        fileKey,
        data.file.originalname,
        data.file.mimetype,
        data.file.size,
        data.expiresAt ?? null,
        data.uploadedByUserId,
        data.uploadedByRole,
      ],
    );
    return result.rows[0];
  }

  async findAll(client: PoolClient, tenantId?: string): Promise<Document[]> {
    if (tenantId) {
      const result = await client.query<Document>(
        'SELECT * FROM documents WHERE tenant_id = $1 ORDER BY created_at DESC',
        [tenantId],
      );
      return result.rows;
    }
    // Sem filtro: RLS já restringe (admin vê tudo, empresa vê o próprio
    // tenant, técnico vê tenants vinculados via EXISTS).
    const result = await client.query<Document>('SELECT * FROM documents ORDER BY created_at DESC');
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<Document> {
    const result = await client.query<Document>('SELECT * FROM documents WHERE id = $1', [id]);
    const document = result.rows[0];
    if (!document) throw new NotFoundException('Documento não encontrado');
    return document;
  }
}
```

- [ ] **Step 5: Escrever o controller (só upload + listagem por enquanto)**

`backend/src/documents/documents.controller.ts`:

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Roles('empresa', 'tecnico')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File, @Body() dto: CreateDocumentDto, @Req() req: any) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    const user = req.user;
    const tenantId = user.role === 'tecnico' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.documents.upload(client, {
        tenantId,
        category: dto.category,
        title: dto.title,
        expiresAt: dto.expires_at,
        file: {
          buffer: file.buffer,
          mimetype: file.mimetype,
          originalname: file.originalname,
          size: file.size,
        },
        uploadedByUserId: user.id,
        uploadedByRole: user.role,
      }),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if (req.user.role === 'tecnico' && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.documents.findAll(client, tenantId));
  }
}
```

- [ ] **Step 6: Registrar o módulo**

`backend/src/documents/documents.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { R2Service } from './r2.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, R2Service],
})
export class DocumentsModule {}
```

Em `backend/src/app.module.ts`: adicionar
`import { DocumentsModule } from './documents/documents.module';` e
`DocumentsModule` no array `imports`.

- [ ] **Step 7: Escrever o teste (upload real no R2, listagem, rejeição de tipo inválido)**

`backend/test/documents-upload.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/GET /documents — upload e listagem (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let s3: S3Client;
  let uploadedFileKey: string | undefined;
  let uploadedDocumentId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Documentos Upload Teste');
    tenantId = tenant.tenantId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

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
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: uploadedFileKey }));
    }
    if (uploadedDocumentId) {
      await (db as any).client.query('DELETE FROM documents WHERE id = $1', [uploadedDocumentId]);
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('faz upload real de um PDF, salva no R2 de verdade, e aparece na listagem', async () => {
    const fakePdf = Buffer.from('%PDF-1.4 conteudo de teste', 'utf-8');

    const uploadRes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'pgr')
      .field('title', 'PGR de teste')
      .attach('file', fakePdf, { filename: 'pgr-teste.pdf', contentType: 'application/pdf' });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.category).toBe('pgr');
    uploadedFileKey = uploadRes.body.file_key;
    uploadedDocumentId = uploadRes.body.id;

    // Confirma que o objeto existe de verdade no R2, não só que o Postgres tem a linha
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: uploadedFileKey }),
    );
    expect(head.ContentLength).toBe(fakePdf.length);

    const listRes = await request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(
      listRes.body.find((d: { file_key: string }) => d.file_key === uploadedFileKey),
    ).toBeDefined();
  });

  it('rejeita tipo de arquivo não permitido antes de tocar no R2', async () => {
    const res = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'pgr')
      .field('title', 'Arquivo ruim')
      .attach('file', Buffer.from('conteudo'), {
        filename: 'malware.exe',
        contentType: 'application/x-msdownload',
      });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 8: Rodar o teste e confirmar que passa**

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
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/documents-upload.e2e-spec.ts"
```

Esperado: PASS, 2/2. Confirma no console que o `HeadObjectCommand` real
retornou o tamanho certo (prova de upload real no R2, não simulado).

- [ ] **Step 9: Commit**

```bash
git add backend/src/documents backend/src/app.module.ts backend/package.json backend/package-lock.json backend/test/documents-upload.e2e-spec.ts
git commit -m "feat: adiciona upload e listagem de documentos (R2 real)"
```

---

### Task 5: `GET /documents/:id/download` + `DELETE /documents/:id`

**Files:**
- Modify: `backend/src/documents/documents.service.ts`
- Modify: `backend/src/documents/documents.controller.ts`
- Test: `backend/test/documents-download-delete.e2e-spec.ts`

**Interfaces:**
- Consumes: `DocumentsService.findOne` (Task 4), `R2Service.getPresignedDownloadUrl`/`deleteObject` (Task 4).
- Produces: `GET /documents/:id/download` → `{url: string, file_name: string}`
  — Task 6 (frontend) consome esse shape (`data.url` pra abrir o
  download); `DELETE /documents/:id` → 200 sem corpo relevante.

- [ ] **Step 1: Adicionar os métodos ao service**

Em `backend/src/documents/documents.service.ts` — adicionar
`ForbiddenException` ao import de `@nestjs/common` (já importa
`BadRequestException, Injectable, NotFoundException` — só acrescenta
`ForbiddenException` à mesma linha), e os dois métodos novos na classe
(depois de `findOne`, mantém tudo que já existe do Task 4 intacto):

```typescript
  async getDownloadUrl(client: PoolClient, id: string): Promise<{ url: string; file_name: string }> {
    const document = await this.findOne(client, id);
    const url = await this.r2.getPresignedDownloadUrl(document.file_key);
    return { url, file_name: document.file_name };
  }

  async remove(client: PoolClient, id: string, userId: string, isAdmin: boolean): Promise<void> {
    const document = await this.findOne(client, id);
    if (!isAdmin && document.uploaded_by_user_id !== userId) {
      throw new ForbiddenException('Só quem subiu o documento pode apagá-lo');
    }
    await this.r2.deleteObject(document.file_key);
    const result = await client.query('DELETE FROM documents WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Documento não encontrado');
  }
```

- [ ] **Step 2: Adicionar os endpoints ao controller**

Em `backend/src/documents/documents.controller.ts` — adicionar
`Delete, Param` ao import de `@nestjs/common` (junto dos já existentes),
e os dois métodos novos na classe (depois de `findAll`):

```typescript
  @Get(':id/download')
  download(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.documents.getDownloadUrl(client, id));
  }

  @Roles('empresa', 'tecnico', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    const user = req.user;
    return req.withTenantContext((client: any) =>
      this.documents.remove(client, id, user.id, user.role === 'admin'),
    );
  }
```

- [ ] **Step 3: Escrever o teste**

`backend/test/documents-download-delete.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /documents/:id/download, DELETE /documents/:id (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let s3: S3Client;
  let documentId: string;
  let fileKey: string;
  const fileContent = '%PDF-1.4 conteudo de teste download';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Download Delete Teste');
    tenantId = tenant.tenantId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });

    const uploadRes = await request(app.getHttpServer())
      .post('/documents')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'laudo')
      .field('title', 'Laudo de teste download')
      .attach('file', Buffer.from(fileContent, 'utf-8'), {
        filename: 'laudo.pdf',
        contentType: 'application/pdf',
      });
    documentId = uploadRes.body.id;
    fileKey = uploadRes.body.file_key;
  });

  afterAll(async () => {
    // Se o teste de delete não rodou/falhou antes de apagar, garante limpeza mesmo assim.
    try {
      await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: fileKey }));
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: fileKey }));
      await (db as any).client.query('DELETE FROM documents WHERE id = $1', [documentId]);
    } catch {
      // já foi apagado pelo próprio teste — esperado no caminho feliz
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('gera uma URL assinada real que baixa o conteúdo correto', async () => {
    const res = await request(app.getHttpServer())
      .get(`/documents/${documentId}/download`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toContain(process.env.R2_ACCOUNT_ID);

    const downloadRes = await fetch(res.body.url);
    const downloadedContent = await downloadRes.text();
    expect(downloadedContent).toBe(fileContent);
  });

  it('rejeita exclusão por quem não subiu o documento (mesmo tenant, outro usuário)', async () => {
    const otherPassword = 'senha-teste-123';
    const passwordHash = await bcrypt.hash(otherPassword, 10);
    const otherEmail = `outro-usuario-${randomUUID()}@teste.montese.local`;
    await (db as any).client.query(
      `INSERT INTO users (tenant_id, role, email, password_hash, full_name, status)
       VALUES ($1, 'empresa', $2, $3, 'Outro Usuario Empresa', 'ativo')`,
      [tenantId, otherEmail, passwordHash],
    );

    const loginOther = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: otherEmail, password: otherPassword });

    const res = await request(app.getHttpServer())
      .delete(`/documents/${documentId}`)
      .set('Authorization', `Bearer ${loginOther.body.access_token}`);

    expect(res.status).toBe(403);

    await (db as any).client.query('DELETE FROM users WHERE email = $1', [otherEmail]);
  });

  it('quem subiu consegue apagar, e o objeto some do R2 de verdade', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/documents/${documentId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    await expect(
      s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: fileKey })),
    ).rejects.toThrow();
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
  -e R2_ACCOUNT_ID="${R2_ACCOUNT_ID}" -e R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
  -e R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" -e R2_BUCKET="${R2_BUCKET}" \
  -e R2_ENDPOINT="${R2_ENDPOINT}" \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/documents-download-delete.e2e-spec.ts"
```

Esperado: PASS, 3/3. Confirma no console que o download real trouxe o
conteúdo exato do arquivo, e que o `HeadObjectCommand` depois do delete
realmente rejeitou (objeto sumiu do R2 de verdade).

- [ ] **Step 5: Commit**

```bash
git add backend/src/documents backend/test/documents-download-delete.e2e-spec.ts
git commit -m "feat: adiciona download (url assinada) e exclusao de documentos"
```

---

### Task 6: Frontend — `DocumentsPanel` (componente compartilhado) + página da empresa

**Files:**
- Create: `frontend/src/components/DocumentsPanel.tsx`
- Create: `frontend/src/app/empresa/documentos/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/documents`, `GET /api/documents/:id/download`,
  `DELETE /api/documents/:id` (Tasks 4/5).
- Produces: componente `DocumentsPanel({ tenantId?: string })` — Task 7
  (frontend do técnico) importa e usa o mesmo componente passando
  `tenantId`, sem duplicar a UI.

- [ ] **Step 1: Criar o componente compartilhado**

`frontend/src/components/DocumentsPanel.tsx`:

```tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';

interface DocumentRow {
  id: string;
  category: string;
  title: string;
  file_name: string;
  expires_at: string | null;
  uploaded_by_user_id: string;
  created_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  pgr: 'PGR',
  pcmso: 'PCMSO',
  laudo: 'Laudo',
  ficha_epi: 'Ficha de EPI',
  treinamento: 'Treinamento',
};

export function DocumentsPanel({ tenantId }: { tenantId?: string }) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('pgr');
  const [title, setTitle] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  function currentUserId(): string | null {
    const raw = localStorage.getItem('montese_user');
    if (!raw) return null;
    return JSON.parse(raw).id;
  }

  function listUrl(): string {
    return tenantId ? `/api/documents?tenant_id=${tenantId}` : '/api/documents';
  }

  async function loadDocuments() {
    const token = localStorage.getItem('montese_token');
    const res = await fetch(listUrl(), { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setDocuments(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setStatus('loading');
    setErrorMessage('');
    const token = localStorage.getItem('montese_token');
    const formData = new FormData();
    formData.append('category', category);
    formData.append('title', title);
    if (expiresAt) formData.append('expires_at', expiresAt);
    if (tenantId) formData.append('tenant_id', tenantId);
    formData.append('file', file);

    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        setTitle('');
        setExpiresAt('');
        setFile(null);
        setStatus('idle');
        loadDocuments();
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(body?.message ?? 'Não foi possível enviar o documento.');
      setStatus('erro');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setStatus('erro');
    }
  }

  async function handleDownload(id: string) {
    const token = localStorage.getItem('montese_token');
    const res = await fetch(`/api/documents/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const { url } = await res.json();
      window.open(url, '_blank');
    }
  }

  async function handleDelete(id: string) {
    const token = localStorage.getItem('montese_token');
    const res = await fetch(`/api/documents/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) loadDocuments();
  }

  const userId = currentUserId();

  if (loading) {
    return <p className="text-brand-700">Carregando documentos...</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Enviar documento</h2>
        <form onSubmit={handleUpload} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Categoria
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Título
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Vencimento (opcional)
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Arquivo (PDF, JPG ou PNG, até 10MB)
            <input
              type="file"
              required
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-brand-900"
            />
          </label>
          {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={status === 'loading'}
            className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {status === 'loading' ? 'Enviando...' : 'Enviar documento'}
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Documentos</h2>
        {documents.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhum documento enviado ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between rounded-md border border-brand-100 px-4 py-3 text-sm"
              >
                <div>
                  <strong className="text-brand-900">{CATEGORY_LABELS[doc.category]}</strong>{' '}
                  <span className="text-brand-700">— {doc.title}</span>
                  {doc.expires_at && (
                    <span className="ml-2 text-brand-700">
                      (vence em {new Date(doc.expires_at).toLocaleDateString('pt-BR')})
                    </span>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => handleDownload(doc.id)} className="text-brand-500 hover:underline">
                    Baixar
                  </button>
                  {doc.uploaded_by_user_id === userId && (
                    <button onClick={() => handleDelete(doc.id)} className="text-red-600 hover:underline">
                      Apagar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Criar a página da empresa**

`frontend/src/app/empresa/documentos/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DocumentsPanel } from '@/components/DocumentsPanel';

export default function EmpresaDocumentosPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Documentos</h1>
      <p className="mt-2 text-brand-700">
        PGR, PCMSO, laudos, fichas de EPI e treinamentos da sua empresa.
      </p>
      <div className="mt-8">
        <DocumentsPanel />
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

Testar manualmente no navegador: logar como empresa, ir em
`/empresa/documentos`, subir um PDF real, confirmar que aparece na
lista, baixar, apagar.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/DocumentsPanel.tsx frontend/src/app/empresa/documentos
git commit -m "feat: pagina de documentos da empresa"
```

---

### Task 7: Frontend — páginas do técnico + redirecionamento por role

**Files:**
- Modify: `frontend/src/app/login/page.tsx`
- Create: `frontend/src/app/tecnico/empresas/page.tsx`
- Create: `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/tenant-technicians/me` (Task 3), `DocumentsPanel`
  (Task 6).
- Produces: nenhuma — última peça de frontend desta sub-fase.

- [ ] **Step 1: Atualizar o redirecionamento do login**

`frontend/src/app/login/page.tsx` — trocar a linha (dentro de
`handleSubmit`, depois dos dois `localStorage.setItem`):

```typescript
      router.push(data.user.role === 'empresa' ? '/empresa/onboarding' : '/');
```

por:

```typescript
      const role = data.user.role;
      router.push(
        role === 'empresa' ? '/empresa/onboarding' : role === 'tecnico' ? '/tecnico/empresas' : '/',
      );
```

- [ ] **Step 2: Criar a página de listagem de empresas do técnico**

`frontend/src/app/tecnico/empresas/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface LinkedTenant {
  tenant_id: string;
  tenant_name: string;
  tenant_cnpj: string;
}

export default function TecnicoEmpresasPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<LinkedTenant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    fetch('/api/tenant-technicians/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        setTenants(data);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Suas empresas</h1>
      {tenants.length === 0 ? (
        <p className="mt-4 text-brand-700">
          Você ainda não está vinculado a nenhuma empresa. Fale com a Montese.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {tenants.map((tenant) => (
            <li key={tenant.tenant_id}>
              <Link
                href={`/tecnico/empresas/${tenant.tenant_id}`}
                className="block rounded-md border border-brand-100 px-4 py-3 text-brand-900 hover:bg-brand-100"
              >
                {tenant.tenant_name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Criar a página de documentos de uma empresa (visão do técnico)**

`frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DocumentsPanel } from '@/components/DocumentsPanel';

export default function TecnicoEmpresaDocumentosPage() {
  const router = useRouter();
  const params = useParams<{ tenantId: string }>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Documentos da empresa</h1>
      <div className="mt-8">
        <DocumentsPanel tenantId={params.tenantId} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build de produção e verificação real**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
docker compose up -d --build frontend
sleep 3
```

Testar manualmente no navegador: usar as credenciais do técnico
vinculado (criado via `POST /technicians/:id/assign` como admin, ou um
técnico existente já vinculado), confirmar que login leva pra
`/tecnico/empresas`, que a empresa vinculada aparece na lista, e que
entrar nela mostra os documentos dela (mesma UI da empresa).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/login/page.tsx frontend/src/app/tecnico
git commit -m "feat: paginas do tecnico (empresas vinculadas + documentos) e redirecionamento por role"
```

---

### Task 8: Integração final, deploy real e documentação

**Files:**
- Modify: `docs/roadmap.md`

**Interfaces:**
- Consumes: tudo das Tasks 1-7.
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

Esperado: `0008_documents.sql` já aplicada (`[skip]`, se alguma task
anterior já rodou isso) ou aplicada agora.

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
  -e R2_ACCOUNT_ID="${R2_ACCOUNT_ID}" -e R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
  -e R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" -e R2_BUCKET="${R2_BUCKET}" \
  -e R2_ENDPOINT="${R2_ENDPOINT}" \
  node:20-alpine sh -c "npm run test:e2e"
```

Esperado: todas as suites `PASS`, incluindo as 6 novas desta sub-fase.
Se `register.e2e-spec.ts` falhar isolado nesse full-suite run, rodar de
novo — é o flake já investigado e documentado em fase anterior, não uma
regressão desta sub-fase.

- [ ] **Step 4: Smoke test real via `curl`**

```bash
for path in / /login /empresa/documentos /tecnico/empresas; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost${path}")
  echo "${path} -> ${code}"
done
curl -s -o /dev/null -w "GET /api/documents sem token -> %{http_code}\n" http://localhost/api/documents
```

Esperado: `200` nas 4 páginas; `401` no `/api/documents` sem token.

- [ ] **Step 5: Atualizar `docs/roadmap.md`**

Adicionar uma seção "Fase 4 (sub-projeto A — Documentos): status", mesmo
formato de tabela já usado nas fases anteriores, listando as 7 tasks de
código, a evidência real do smoke test, e destacando a correção de
segurança da Task 2 (mesmo padrão de transparência já usado nas fases
anteriores — nunca esconder uma vulnerabilidade encontrada e corrigida).
Marcar como fechada — não depende de nenhuma ação externa do fundador
(R2 já configurado, vínculo técnico↔empresa é ação pontual via API que
a própria Montese já sabe fazer).

- [ ] **Step 6: Commit final**

```bash
git add docs/roadmap.md
git commit -m "docs: fecha Fase 4 sub-projeto A (Documentos)"
```
