# Fase 19 — Logo da Empresa no Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que a empresa cliente suba a própria logo (na tela "Dados da empresa") e a veja no lugar do texto "Montese SST" no topo do menu lateral.

**Architecture:** Coluna nova `logo_file_key` em `tenants`; upload/remoção via `POST`/`DELETE /tenants/me/logo` (multipart, JPG/PNG até 2MB, espelhando o rollback já usado em `DocumentsService.upload`); exibição via rota pública `GET /tenants/:id/logo` (redirect 302 pra uma URL assinada do R2, sem autenticação); `R2Service` — hoje só usado por `documents`/`normative`, cada um com sua própria instância na injeção de dependência — é relocado pra um módulo `@Global()` compartilhado (`common/r2/`), reaproveitado pelas duas fases já existentes e pela nova.

**Tech Stack:** NestJS + `pg` (backend), Next.js App Router + Tailwind (frontend), Cloudflare R2 via `@aws-sdk/client-s3` (já em uso).

**Spec:** `docs/specs/fase-19-logo-empresa.md`

## Global Constraints

- `logo_file_key` em `tenants` é nullable, sem RLS própria (`tenants` já não tem RLS — barreira é só `@Roles`).
- Upload aceita só `image/jpeg`/`image/png`, limite 2MB (`FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } })`, mesmo padrão de `documents.controller.ts`).
- `GET /tenants/:id/logo` é `@Public()` — rota sem autenticação, de propósito (não é dado sensível). Usa `DatabaseService.withoutTenantContext` (não `req.withTenantContext`, que depende de `req.user` inexistente numa rota pública).
- Backend tem suíte e2e real (Postgres real, R2 real, sem mock) — rodar via `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- <filtro>"`, container efêmero com `docker-compose.override.yml` temporário (bind mount `./backend:/app` + volume anônimo em `/app/node_modules` + `NODE_ENV: development` + `TEST_SUPERUSER_DATABASE_URL` a partir de `${POSTGRES_SUPERUSER}`/`${POSTGRES_SUPERUSER_PASSWORD}`/`${POSTGRES_DB}` do `.env` do projeto) — **apagar o override imediatamente depois de cada uso, antes de qualquer outro comando `docker compose`** (lição registrada após um incidente real na Fase 17: um override esquecido fez `docker compose up -d <outro serviço>` recriar o container de produção do backend com config de dev).
- Frontend sem test runner automatizado (`frontend/package.json` sem jest/vitest/testing-library) — verificação de frontend é manual, Playwright (`playwright@1.48`, Node 18.19.1 neste ambiente) com sessão sintética via `page.evaluate` em `localStorage` numa navegação inicial (nunca `page.addInitScript`), `page.route()` mockando `/api/*`, contra a build de produção real (`docker compose build frontend` + `docker compose up -d frontend`, confirmando com `docker compose ps` que a stack inteira está de pé antes de testar contra `https://montesesst.com.br`).
- `R2Service` já é usado por `DocumentsService` e `NormativeDocumentsService`, cada um com sua própria instância registrada no módulo (`DocumentsModule`/`NormativeModule`) — a relocação pra `common/r2/` com `@Global()` consolida isso numa instância só, reaproveitada também pela Fase 19. Task 2 deste plano cobre essa relocação e precisa confirmar que os testes já existentes de `documents`/`normative` continuam passando — não é uma mudança de comportamento, só de onde o provider mora.

---

## Task 1: Migration — coluna `logo_file_key` em `tenants`

**Files:**
- Create: `backend/db/migrations/0033_tenant_logo.sql`

**Interfaces:**
- Produces: coluna `tenants.logo_file_key TEXT` (nullable), consumida pela Task 3.

- [ ] **Step 1: Criar a migration**

```sql
-- Fase 19 — Logo da empresa no menu: coluna nova em `tenants`, mesmo
-- padrão de toda coluna simples já adicionada nessa tabela (ver
-- 0018_tenants_full_address.sql). Nullable, sem valor padrão — nem
-- toda empresa vai subir uma logo. Sem tabela nova, sem índice, sem
-- RLS própria (tenants já não tem RLS hoje).
ALTER TABLE tenants ADD COLUMN logo_file_key TEXT;
```

- [ ] **Step 2: Aplicar a migration**

Run: `docker compose exec backend npm run db:migrate` (ou `docker compose run --rm backend npm run db:migrate` se o container não estiver de pé)
Expected: `[apply] 0033_tenant_logo.sql` / `[ok] 0033_tenant_logo.sql` / `Migrations concluídas.`

- [ ] **Step 3: Confirmar a coluna no Postgres real**

Run (dentro do container `postgres`, só leitura):
```bash
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d tenants" | grep logo_file_key
```
Expected: uma linha mostrando `logo_file_key | text |` (nullable, sem `not null`).

- [ ] **Step 4: Commit**

```bash
git add backend/db/migrations/0033_tenant_logo.sql
git commit -m "feat: migration da coluna logo_file_key em tenants"
```

---

## Task 2: Compartilhar `R2Service` num módulo global (`common/r2/`)

**Files:**
- Create: `backend/src/common/r2/r2.service.ts`
- Create: `backend/src/common/r2/r2.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/documents/documents.module.ts`
- Modify: `backend/src/documents/documents.service.ts`
- Modify: `backend/src/normative/normative.module.ts`
- Modify: `backend/src/normative/normative-documents.service.ts`
- Delete: `backend/src/documents/r2.service.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `R2Service` (mesma interface pública de sempre — `putObject`/`getPresignedDownloadUrl`/`deleteObject` — só muda de onde é importado) disponível globalmente via DI, sem precisar listar em `providers`/`imports` de nenhum módulo. Consumido pela Task 3.

Este é um refactor puro — nenhum comportamento muda, só a localização do provider. Hoje `R2Service` é registrado duas vezes de forma independente (`DocumentsModule` e `NormativeModule`, cada um com sua própria instância) — a relocação consolida numa instância global só, seguindo o mesmo padrão já usado por `DatabaseModule`/`EmailModule`/`RedisModule` (`@Global()`, registrado uma vez em `AppModule`).

- [ ] **Step 1: Rodar a suíte e2e de documents/normative ANTES de mexer, pra ter uma baseline**

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- documents"` e depois `-- normative`
Expected: todos os testes de `documents-*.e2e-spec.ts` e `normative-*.e2e-spec.ts` passando (baseline antes do refactor).

- [ ] **Step 2: Criar `backend/src/common/r2/r2.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Mesmo padrão de fallback já usado em EmailService/MercadoPagoService —
// não deixa a ausência de credencial derrubar o boot da aplicação, a
// falha real acontece na chamada, não na configuração.
//
// Global (registrado em R2Module) — usado por documents, normative, e
// desde a Fase 19 também por tenants (logo da empresa). Não tem lógica
// específica de nenhum desses módulos, é só um wrapper fino sobre o S3
// Client apontando pro R2.
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

(Conteúdo idêntico ao arquivo antigo — só a localização muda.)

- [ ] **Step 3: Criar `backend/src/common/r2/r2.module.ts`**

```ts
import { Global, Module } from '@nestjs/common';
import { R2Service } from './r2.service';

@Global()
@Module({
  providers: [R2Service],
  exports: [R2Service],
})
export class R2Module {}
```

- [ ] **Step 4: Apagar o arquivo antigo**

```bash
rm backend/src/documents/r2.service.ts
```

- [ ] **Step 5: Atualizar `backend/src/app.module.ts`**

Adicionar o import logo depois de `EmailModule` (agrupamento de módulos de infraestrutura global, mesmo lugar de `RedisModule`/`EmailModule`):

```ts
import { R2Module } from './common/r2/r2.module';
```

E no array `imports`, logo depois de `EmailModule`:

```ts
    DatabaseModule,
    ScheduleModule.forRoot(),
    RedisModule,
    EmailModule,
    R2Module,
    AuditModule,
```

- [ ] **Step 6: Atualizar `backend/src/documents/documents.module.ts`**

Antes:
```ts
import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { R2Service } from './r2.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, R2Service],
  exports: [DocumentsService],
})
export class DocumentsModule {}
```

Depois (remove o import e o provider de `R2Service` — `R2Module` é `@Global()`, `DocumentsService` recebe a instância automaticamente):
```ts
import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
```

- [ ] **Step 7: Atualizar o import em `backend/src/documents/documents.service.ts`**

Trocar (linha 4):
```ts
import { R2Service } from './r2.service';
```
por:
```ts
import { R2Service } from '../common/r2/r2.service';
```

(Nenhuma outra linha do arquivo muda — o construtor `constructor(private readonly r2: R2Service) {}` continua igual.)

- [ ] **Step 8: Atualizar `backend/src/normative/normative.module.ts`**

Trocar o import (linha 9):
```ts
import { R2Service } from '../documents/r2.service';
```
por:
```ts
import { R2Service } from '../common/r2/r2.service';
```

E remover `R2Service` do array `providers` (linha 27) — fica:
```ts
  providers: [
    OfficialSourcesService,
    NormativeDocumentsService,
    NormativeMonitorService,
    NormativeAssistantService,
    OpenRouterEmbeddingService,
    { provide: EMBEDDING_PROVIDER, useClass: OpenRouterEmbeddingService },
    OpenRouterNormativeAnswerService,
    { provide: NORMATIVE_ANSWER_PROVIDER, useClass: OpenRouterNormativeAnswerService },
  ],
```

- [ ] **Step 9: Atualizar o import em `backend/src/normative/normative-documents.service.ts`**

Trocar (linha 4):
```ts
import { R2Service } from '../documents/r2.service';
```
por:
```ts
import { R2Service } from '../common/r2/r2.service';
```

- [ ] **Step 10: Build + rodar a suíte e2e de documents/normative de novo, confirmar que continua verde**

Run: `docker compose build backend` — zero erros de TypeScript (confirma que nenhum import ficou quebrado).
Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- documents"` e depois `-- normative`
Expected: mesmos testes passando que no Step 1 — nenhuma mudança de resultado, só confirma que o refactor não quebrou nada.

- [ ] **Step 11: Commit**

```bash
git add backend/src/common/r2/r2.service.ts backend/src/common/r2/r2.module.ts backend/src/app.module.ts backend/src/documents/documents.module.ts backend/src/documents/documents.service.ts backend/src/normative/normative.module.ts backend/src/normative/normative-documents.service.ts
git rm backend/src/documents/r2.service.ts
git commit -m "refactor: move R2Service pra módulo global compartilhado (common/r2)"
```

---

## Task 3: Backend — endpoints de logo do tenant

**Files:**
- Modify: `backend/src/tenants/tenants.service.ts`
- Modify: `backend/src/tenants/tenants.controller.ts`
- Test: `backend/test/tenants-logo.e2e-spec.ts`

**Interfaces:**
- Consumes: `R2Service` (Task 2, global), coluna `tenants.logo_file_key` (Task 1).
- Produces: `POST /tenants/me/logo` → `{ has_logo: true }`; `DELETE /tenants/me/logo` → `{ has_logo: false }`; `GET /tenants/:id/logo` → redirect 302; `GET /tenants/me`/`PATCH /tenants/me` (já existentes) ganham `has_logo: boolean` na resposta. Consumido pelas Tasks 4 e 5.

- [ ] **Step 1: Escrever o teste e2e (falhando)**

Criar `backend/test/tenants-logo.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/DELETE /tenants/me/logo, GET /tenants/:id/logo (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let s3: S3Client;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Logo Teste');
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
    // Limpeza defensiva — o teste de remoção já deveria ter zerado a
    // coluna, mas garante que nenhum logo_file_key sobra caso algum
    // teste falhe no meio.
    await (db as any).client.query('UPDATE tenants SET logo_file_key = NULL WHERE id = $1', [tenantId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('rejeita tipo de arquivo não permitido (PDF)', async () => {
    const res = await request(app.getHttpServer())
      .post('/tenants/me/logo')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.4 conteudo'), { filename: 'logo.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });

  it('faz upload real de PNG, GET /tenants/me passa a devolver has_logo true', async () => {
    const fakePng = Buffer.from('fake png bytes');
    const uploadRes = await request(app.getHttpServer())
      .post('/tenants/me/logo')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', fakePng, { filename: 'logo.png', contentType: 'image/png' });

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.has_logo).toBe(true);

    const meRes = await request(app.getHttpServer())
      .get('/tenants/me')
      .set('Authorization', `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.has_logo).toBe(true);
  });

  it('GET /tenants/:id/logo (sem autenticação nenhuma) redireciona pra uma URL real do R2', async () => {
    const res = await request(app.getHttpServer()).get(`/tenants/${tenantId}/logo`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(process.env.R2_ENDPOINT?.replace('https://', '') ?? '');
  });

  it('GET /tenants/:id/logo devolve 404 pra tenant sem logo', async () => {
    const otherTenant = await db.createTenantWithUser('Empresa Sem Logo Teste');

    const res = await request(app.getHttpServer()).get(`/tenants/${otherTenant.tenantId}/logo`);

    expect(res.status).toBe(404);

    await (db as any).client.query('DELETE FROM tenants WHERE id = $1', [otherTenant.tenantId]);
    await (db as any).client.query('DELETE FROM users WHERE id = $1', [otherTenant.userId]);
  });

  it('trocar a logo apaga o objeto antigo do R2 de verdade, não só substitui a referência', async () => {
    const beforeKey = (
      await (db as any).client.query('SELECT logo_file_key FROM tenants WHERE id = $1', [tenantId])
    ).rows[0].logo_file_key;
    expect(beforeKey).not.toBeNull();

    // Confirma que o objeto ANTIGO existe de verdade no R2 antes de trocar.
    await expect(s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: beforeKey }))).resolves.toBeDefined();

    const secondPng = Buffer.from('outra imagem fake');
    const res = await request(app.getHttpServer())
      .post('/tenants/me/logo')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', secondPng, { filename: 'logo2.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(res.body.has_logo).toBe(true);

    const afterKey = (
      await (db as any).client.query('SELECT logo_file_key FROM tenants WHERE id = $1', [tenantId])
    ).rows[0].logo_file_key;
    expect(afterKey).not.toBe(beforeKey);

    const getRes = await request(app.getHttpServer()).get(`/tenants/${tenantId}/logo`);
    expect(getRes.status).toBe(302);

    // O objeto ANTIGO precisa ter sido apagado de verdade do R2 — não só
    // desreferenciado na coluna. HeadObjectCommand rejeita (404/NotFound)
    // pra um objeto que não existe mais.
    await expect(s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: beforeKey }))).rejects.toThrow();
  });

  it('DELETE /tenants/me/logo remove a logo — GET /tenants/me volta a devolver has_logo false', async () => {
    const deleteRes = await request(app.getHttpServer())
      .delete('/tenants/me/logo')
      .set('Authorization', `Bearer ${token}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.has_logo).toBe(false);

    const meRes = await request(app.getHttpServer())
      .get('/tenants/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meRes.body.has_logo).toBe(false);

    const getRes = await request(app.getHttpServer()).get(`/tenants/${tenantId}/logo`);
    expect(getRes.status).toBe(404);
  });

  it('DELETE /tenants/me/logo sem logo nenhuma é um no-op (200, não erro)', async () => {
    const res = await request(app.getHttpServer())
      .delete('/tenants/me/logo')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.has_logo).toBe(false);
  });

  it('bloqueia role sem permissão (tecnico) no upload/remoção com 403', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Logo Teste');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });
    const tecnicoToken = loginRes.body.access_token;

    const uploadRes = await request(app.getHttpServer())
      .post('/tenants/me/logo')
      .set('Authorization', `Bearer ${tecnicoToken}`)
      .attach('file', Buffer.from('fake'), { filename: 'logo.png', contentType: 'image/png' });
    expect(uploadRes.status).toBe(403);

    const deleteRes = await request(app.getHttpServer())
      .delete('/tenants/me/logo')
      .set('Authorization', `Bearer ${tecnicoToken}`);
    expect(deleteRes.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha (rotas ainda não existem)**

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- tenants-logo"`
Expected: FAIL — `404 Not Found` nos `POST/DELETE /tenants/me/logo` e no `GET /tenants/:id/logo` (rotas não implementadas ainda).

- [ ] **Step 3: Adicionar os métodos em `backend/src/tenants/tenants.service.ts`**

No topo do arquivo, adicionar os imports novos e a constante de mimetypes (logo depois dos imports existentes):

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { buildSafeSetClause } from '../common/safe-update.util';
import { R2Service } from '../common/r2/r2.service';

const ALLOWED_LOGO_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
```

(nota: `BadRequestException` e `NotFoundException` já eram importados juntos de `@nestjs/common` — só `BadRequestException` é novo nesse import; `NotFoundException` já existia.)

Adicionar `logo_file_key: string | null;` na interface `Tenant` (logo depois de `address_zip`):

```ts
export interface Tenant {
  id: string;
  name: string;
  cnpj: string;
  plan: string;
  status: string;
  sector: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  trade_name: string | null;
  contact_role: string | null;
  address_street: string | null;
  address_number: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  logo_file_key: string | null;
  created_at: string;
  updated_at: string;
}
```

Trocar a declaração da classe pra injetar `R2Service`:

```ts
@Injectable()
export class TenantsService {
  constructor(private readonly r2: R2Service) {}

  async findAllWithLinks(client: PoolClient): Promise<TenantWithLinks[]> {
```

(o resto dos métodos existentes — `findAllWithLinks`, `findDetail`, `findOne`, `update` — não muda nada.)

No final da classe, antes do `}` de fechamento, adicionar os 3 métodos novos:

```ts
  async uploadLogo(
    client: PoolClient,
    tenantId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<{ has_logo: true }> {
    const ext = ALLOWED_LOGO_MIME_TYPES[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Tipo de arquivo não permitido (só JPG ou PNG)');
    }

    const existing = await client.query<{ logo_file_key: string | null }>(
      'SELECT logo_file_key FROM tenants WHERE id = $1',
      [tenantId],
    );
    const oldKey = existing.rows[0]?.logo_file_key ?? null;

    const newKey = `tenants/${tenantId}/branding/logo-${randomUUID()}.${ext}`;
    await this.r2.putObject(newKey, file.buffer, file.mimetype);

    try {
      await client.query('UPDATE tenants SET logo_file_key = $1 WHERE id = $2', [newKey, tenantId]);
    } catch (err) {
      // O objeto já foi gravado no R2 real antes do UPDATE — se o UPDATE
      // falhar, sem isso o objeto ficaria órfão no bucket pra sempre.
      // Mesmo padrão de DocumentsService.upload.
      try {
        await this.r2.deleteObject(newKey);
      } catch {
        // Best-effort: não mascara o erro real do UPDATE.
      }
      throw err;
    }

    if (oldKey) {
      // Best-effort — uma falha aqui não derruba a resposta de sucesso,
      // só deixaria um objeto órfão (aceitável, não é dado sensível).
      try {
        await this.r2.deleteObject(oldKey);
      } catch {
        // Ignorado de propósito.
      }
    }

    return { has_logo: true };
  }

  async removeLogo(client: PoolClient, tenantId: string): Promise<{ has_logo: false }> {
    const existing = await client.query<{ logo_file_key: string | null }>(
      'SELECT logo_file_key FROM tenants WHERE id = $1',
      [tenantId],
    );
    const oldKey = existing.rows[0]?.logo_file_key ?? null;

    if (oldKey) {
      await this.r2.deleteObject(oldKey);
    }
    await client.query('UPDATE tenants SET logo_file_key = NULL WHERE id = $1', [tenantId]);

    return { has_logo: false };
  }

  async getLogoRedirectUrl(client: PoolClient, tenantId: string): Promise<string> {
    const result = await client.query<{ logo_file_key: string | null }>(
      'SELECT logo_file_key FROM tenants WHERE id = $1',
      [tenantId],
    );
    const key = result.rows[0]?.logo_file_key;
    if (!key) throw new NotFoundException('Logo não encontrada');
    return this.r2.getPresignedDownloadUrl(key);
  }
```

- [ ] **Step 4: Atualizar `backend/src/tenants/tenants.controller.ts`**

Arquivo completo depois da mudança:

```ts
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
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { DatabaseService } from '../common/database/database.service';
import { TenantsService, Tenant } from './tenants.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';

function withHasLogo(tenant: Tenant) {
  return { ...tenant, has_logo: tenant.logo_file_key !== null };
}

@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly db: DatabaseService,
  ) {}

  // Lista completa (todos os tenants, com vínculos agregados) — só admin,
  // ver findAll() abaixo. findMe/updateMe seguem exclusivos de 'empresa',
  // sempre resolvendo o próprio tenantId do JWT, nunca um id vindo do
  // cliente.
  @Roles('empresa')
  @Get('me')
  async findMe(@Req() req: any) {
    const tenant = await req.withTenantContext((client: any) => this.tenants.findOne(client, req.user.tenantId));
    return withHasLogo(tenant);
  }

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch('me')
  async updateMe(@Body() dto: UpdateTenantDto, @Req() req: any) {
    const tenant = await req.withTenantContext((client: any) =>
      this.tenants.update(client, req.user.tenantId, dto),
    );
    return withHasLogo(tenant);
  }

  @Roles('empresa')
  @Post('me/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadLogo(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    return req.withTenantContext((client: any) =>
      this.tenants.uploadLogo(client, req.user.tenantId, {
        buffer: file.buffer,
        mimetype: file.mimetype,
      }),
    );
  }

  @Roles('empresa')
  @Delete('me/logo')
  removeLogo(@Req() req: any) {
    return req.withTenantContext((client: any) => this.tenants.removeLogo(client, req.user.tenantId));
  }

  @Public()
  @Get(':id/logo')
  async getLogo(@Param('id') id: string, @Res() res: Response) {
    const url = await this.db.withoutTenantContext((client) => this.tenants.getLogoRedirectUrl(client, id));
    res.redirect(302, url);
  }

  // 'tenants' não tem RLS própria — @Roles('admin') é a única barreira
  // pra esta lista completa, sem filtro nenhum. Ver Global Constraints do
  // plano da Fase 7 sub-projeto A.
  @Roles('admin')
  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.tenants.findAllWithLinks(client));
  }

  @Roles('admin')
  @Get(':id/detail')
  findDetail(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.tenants.findDetail(client, id));
  }
}
```

**Atenção à ordem das rotas**: `@Get(':id/logo')` precisa vir ANTES de `@Get(':id/detail')`
no arquivo (Nest casa rotas na ordem de declaração dos métodos dentro do
controller) — como estão em métodos diferentes sem conflito de path
literal, a ordem entre elas não importa de verdade aqui (`:id/logo` e
`:id/detail` são sufixos diferentes), mas a rota `@Public() @Get(':id/logo')`
precisa estar registrada como uma rota de `tenants` normal — não há
risco de colisão com `@Get('me')` porque `me` nunca bate com o padrão
`:id/logo` (dois segmentos de path).

- [ ] **Step 5: Rodar o teste, confirmar que passa**

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- tenants-logo"`
Expected: `Tests: 8 passed, 8 total`.

- [ ] **Step 6: Rodar a suíte de tenants já existente, confirmar que não quebrou nada**

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- tenants"`
Expected: `tenants.e2e-spec.ts`, `tenants-admin-list.e2e-spec.ts`, `tenants-detail.e2e-spec.ts` e o novo `tenants-logo.e2e-spec.ts` todos passando — em especial confirmar que `tenants.e2e-spec.ts` (que já asserta campos específicos da resposta de `GET/PATCH /tenants/me`) não quebrou com a adição de `has_logo`/`logo_file_key` na resposta (esses testes fazem asserções pontuais em campos específicos, não uma comparação de objeto inteiro, então campos novos na resposta não deveriam quebrar nada — mas confirme rodando).

- [ ] **Step 7: Build completo**

Run: `docker compose build backend`
Expected: zero erros de TypeScript.

- [ ] **Step 8: Commit**

```bash
git add backend/src/tenants/tenants.service.ts backend/src/tenants/tenants.controller.ts backend/test/tenants-logo.e2e-spec.ts
git commit -m "feat: endpoints de upload/remoção/exibição da logo da empresa"
```

---

## Task 4: Frontend — upload/preview/remoção na tela "Dados da empresa"

**Files:**
- Modify: `frontend/src/app/empresa/onboarding/MatrizForm.tsx`

**Interfaces:**
- Consumes: `POST /tenants/me/logo`, `DELETE /tenants/me/logo` (Task 3); `GET /tenants/:id/logo` só pra exibir o preview (Task 3).
- Produces: nada consumido por outra task deste plano.

- [ ] **Step 1: Atualizar a interface `TenantData` e trocar leitura direta de `localStorage` por `getToken()`**

No topo do arquivo, adicionar o import:

```ts
import { getToken } from '@/lib/auth';
```

Na interface `TenantData`, adicionar `has_logo` (depois de `id`):

```ts
export interface TenantData {
  id: string;
  has_logo: boolean;
  name: string;
  cnpj: string;
  sector: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  trade_name: string | null;
  contact_role: string | null;
  address_street: string | null;
  address_number: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}
```

No `handleSubmit`, trocar:
```ts
const token = localStorage.getItem('montese_token');
```
por:
```ts
const token = getToken();
```

- [ ] **Step 2: Adicionar estado e handlers de logo**

Logo depois da linha `const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');`, adicionar:

```ts
  const [logoStatus, setLogoStatus] = useState<'idle' | 'loading' | 'erro'>('idle');

  async function handleLogoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setLogoStatus('loading');
    const token = getToken();
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/tenants/me/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) {
        setLogoStatus('idle');
        onSaved();
        return;
      }
      setLogoStatus('erro');
    } catch {
      setLogoStatus('erro');
    }
  }

  async function handleLogoRemove() {
    setLogoStatus('loading');
    const token = getToken();
    try {
      const res = await fetch('/api/tenants/me/logo', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setLogoStatus('idle');
        onSaved();
        return;
      }
      setLogoStatus('erro');
    } catch {
      setLogoStatus('erro');
    }
  }
```

(`onSaved()` já existe — é o callback que a tela pai usa pra recarregar `GET /tenants/me`, o mesmo mecanismo que `handleSubmit` já usa. Reaproveitar significa que o `has_logo`/preview atualizam pelo mesmo caminho que qualquer outro campo salvo, sem estado duplicado.)

(`event.target.value = ''` depois de ler o arquivo permite escolher o mesmo arquivo de novo em seguida, caso o usuário queira re-subir — sem isso, o evento `onChange` não dispara de novo pro mesmo arquivo.)

- [ ] **Step 3: Adicionar o bloco de UI**

Logo depois do campo "Nome fantasia" (depois do `</label>` que fecha o input de `tradeName`, antes do label de "Setor/atividade"), adicionar:

```tsx
        <div className="flex flex-col gap-2 text-sm text-brand-900">
          <span>Logo da empresa (opcional)</span>
          {tenant.has_logo && (
            <div className="flex items-center gap-3">
              <img
                src={`/api/tenants/${tenant.id}/logo`}
                alt="Logo atual da empresa"
                className="h-12 w-12 rounded-lg border border-brand-100 object-cover"
              />
              <button
                type="button"
                onClick={handleLogoRemove}
                disabled={logoStatus === 'loading'}
                className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
              >
                Remover logo
              </button>
            </div>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png"
            onChange={handleLogoUpload}
            disabled={logoStatus === 'loading'}
            className="text-sm"
          />
          {logoStatus === 'erro' && (
            <p className="text-sm text-red-600">
              Não foi possível processar a logo. Tente de novo (JPG ou PNG, até 2MB).
            </p>
          )}
        </div>
```

- [ ] **Step 4: Build**

Run: `docker compose build frontend`
Expected: zero erros de TypeScript/lint.

- [ ] **Step 5: Verificação manual via Playwright contra produção real**

Recriar o container (`docker compose up -d frontend`, confirmando com `docker compose ps` que a stack inteira está de pé — lembrete já registrado em fases anteriores: `docker compose up -d frontend` sozinho não reergue o `nginx` se a stack inteira estiver parada).

Cenários mínimos, sessão sintética via `localStorage` (`page.evaluate` numa navegação inicial), `page.route()` mockando `/api/tenants/me` (GET), `/api/tenants/me/logo` (POST/DELETE), `/api/company-units` (GET, vazio):

1. `GET /api/tenants/me` mockado com `has_logo: false` — tela mostra só o input de arquivo, sem preview nem botão "Remover logo".
2. `GET /api/tenants/me` mockado com `has_logo: true` e um `id` fixo — tela mostra o preview (`<img src="/api/tenants/{id}/logo">`, mock essa rota também pra devolver uma imagem qualquer com 200) e o botão "Remover logo".
3. Escolher um arquivo no input (`page.setInputFiles`) com `POST /api/tenants/me/logo` mockado devolvendo `201 { has_logo: true }` — confirmar que o `fetch` foi disparado (via `page.route` capturando a chamada) sem esperar reload de página.
4. Clicar "Remover logo" com `DELETE /api/tenants/me/logo` mockado devolvendo `200 { has_logo: false }` — confirmar que a chamada foi disparada.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/empresa/onboarding/MatrizForm.tsx
git commit -m "feat: upload/remoção de logo na tela Dados da empresa"
```

---

## Task 5: Frontend — menu lateral da empresa exibe a logo

**Files:**
- Modify: `frontend/src/components/EmpresaSidebar.tsx`

**Interfaces:**
- Consumes: `GET /tenants/me` (Task 3) — campos `id`, `name`, `trade_name`, `has_logo`.
- Produces: nada consumido por task seguinte (última task do plano).

- [ ] **Step 1: Atualizar `EmpresaSidebar.tsx`**

Arquivo completo depois da mudança:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getToken, logout } from '@/lib/auth';

interface NavGroup {
  label: string;
  links: { href: string; label: string; emoji: string }[];
}

interface TenantBranding {
  id: string;
  name: string;
  trade_name: string | null;
  has_logo: boolean;
}

const GROUPS: NavGroup[] = [
  {
    label: 'Visão Geral',
    links: [{ href: '/empresa/dashboard', label: 'Início', emoji: '🏠' }],
  },
  {
    label: 'Segurança',
    links: [
      { href: '/empresa/assistente', label: 'Assistente', emoji: '💬' },
      { href: '/empresa/documentos', label: 'Documentos', emoji: '📄' },
      { href: '/empresa/epis', label: 'EPIs', emoji: '🦺' },
      { href: '/empresa/consulta-ca', label: 'Consulta de CA', emoji: '🔎' },
      { href: '/empresa/inspecoes', label: 'Inspeções', emoji: '📋' },
    ],
  },
  {
    label: 'CIPA',
    links: [
      { href: '/empresa/cipa', label: 'Central da CIPA', emoji: '🦺' },
      { href: '/empresa/cipa/reunioes', label: 'Reuniões', emoji: '📅' },
      { href: '/empresa/cipa/membros', label: 'Membros', emoji: '👥' },
      { href: '/empresa/cipa/eleicao', label: 'Eleição', emoji: '🗳️' },
      { href: '/empresa/cipa/pendencias', label: 'Pendências', emoji: '📌' },
      { href: '/empresa/cipa/capacitacao', label: 'Capacitação', emoji: '🎓' },
    ],
  },
  {
    label: 'Conta',
    links: [{ href: '/empresa/onboarding', label: 'Dados da empresa', emoji: '🏢' }],
  },
];

export function EmpresaSidebar() {
  const pathname = usePathname();
  const [tenant, setTenant] = useState<TenantBranding | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch('/api/tenants/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then(setTenant)
      .catch(() => {});
  }, []);

  return (
    <aside className="flex w-56 shrink-0 flex-col bg-brand-900 px-4 py-10">
      {tenant?.has_logo ? (
        <div className="flex items-center gap-2 px-2">
          <img
            src={`/api/tenants/${tenant.id}/logo`}
            alt="Logo da empresa"
            className="h-9 w-9 shrink-0 rounded-lg object-cover"
          />
          <span className="truncate text-sm font-bold text-white">{tenant.trade_name ?? tenant.name}</span>
        </div>
      ) : (
        <h1 className="px-2 text-lg font-bold text-white">Montese SST</h1>
      )}
      <nav className="mt-6 flex flex-1 flex-col gap-5">
        {GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 text-xs font-bold uppercase tracking-wide text-white/60">{group.label}</p>
            <div className="mt-1 flex flex-col gap-1">
              {group.links.map((link) => {
                const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={
                      isActive
                        ? 'flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-brand-900'
                        : 'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10'
                    }
                  >
                    <span aria-hidden="true">{link.emoji}</span>
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <button
        onClick={logout}
        className="mt-6 flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-white/90 hover:bg-white/10"
      >
        <span aria-hidden="true">🚪</span>
        Sair
      </button>
    </aside>
  );
}
```

(Único trecho novo de verdade: a interface `TenantBranding`, o `useState`/`useEffect` de busca, e o bloco condicional `{tenant?.has_logo ? ... : <h1>...}` no lugar do `<h1>` fixo de antes. O resto — `GROUPS`, `nav`, botão "Sair" — é idêntico ao que já existe depois da Fase anterior de cor/fonte.)

- [ ] **Step 2: Build**

Run: `docker compose build frontend`
Expected: zero erros de TypeScript/lint.

- [ ] **Step 3: Verificação manual via Playwright contra produção real**

Recriar o container (mesma nota da Task 4 sobre `docker compose ps`/nginx).

Sessão sintética via `localStorage`, `page.route()` mockando `/api/tenants/me` e `/api/dashboard/summary` (a página de dashboard já precisa desse mock pra carregar, ver Task de cor/fonte anterior nesta mesma fase):

1. `GET /api/tenants/me` mockado com `has_logo: false` — menu mostra "Montese SST" (texto), igual a antes desta fase.
2. `GET /api/tenants/me` mockado com `has_logo: true`, `trade_name: "Empresa Exemplo"`, `id` fixo, e `/api/tenants/{id}/logo` mockado devolvendo uma imagem 200 qualquer — menu mostra a imagem + "Empresa Exemplo" no lugar de "Montese SST".
3. `GET /api/tenants/me` mockado com `has_logo: true` mas `trade_name: null` — menu mostra a imagem + a razão social (`name`) como fallback.
4. `GET /api/tenants/me` mockado pra devolver erro (500) — menu continua mostrando "Montese SST" (fallback seguro, nunca quebra a página).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/EmpresaSidebar.tsx
git commit -m "feat: exibe logo da empresa no menu lateral"
```

---

## Depois da última task

- Rodar `docker compose build backend && docker compose build frontend` combinados uma última vez.
- Gerar o pacote de revisão final de toda a branch (merge-base = commit da spec/plano, `e066105`) e despachar a revisão final no modelo mais capaz disponível, seguindo `subagent-driven-development`.
- Fechar `docs/roadmap.md` com uma entrada detalhada desta fase, mesmo formato de toda fase anterior — incluindo mencionar a parte "bounded" (cor/fonte, commit `3688289`) já coberta antes desta spec existir.
- Próxima frente da ordem já acordada (spec da Fase 12 §1): card da CIPA no dashboard principal — última item da lista original, ainda sem spec.
