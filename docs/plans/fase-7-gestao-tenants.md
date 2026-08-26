# Fase 7 (sub-projeto A) — Gestão de tenants e vínculos — Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans pra implementar este plano tarefa por tarefa. Passos usam checkbox (`- [ ]`) pra rastreio.

**Objetivo:** dar à equipe da Montese uma área `/admin/*` funcional pra listar empresas com seus vínculos, e criar/vincular técnicos e parceiros — sem depender mais de chamadas de API manuais.

**Arquitetura:** um endpoint novo (`GET /tenants`, admin-only, agregando vínculos via subqueries correlacionadas), dois endpoints existentes ganhando campos (`GET /technicians`/`GET /partners` passam a incluir `full_name`/`email` via `JOIN users`), três páginas novas no frontend seguindo o padrão "lista + formulário inline" já usado no `EpisPanel`, e um runbook de provisionamento manual da primeira conta admin.

**Tech Stack:** NestJS + `pg` (backend), Next.js App Router + `fetch` direto (frontend), Postgres 16 com RLS, Jest + Supertest (e2e, sem mock, contra Postgres real).

**Spec:** [`docs/specs/fase-7-gestao-tenants.md`](../specs/fase-7-gestao-tenants.md)

## Global Constraints

- **Sem criar tenant pela tela.** Empresas continuam vindo só do
  autocadastro público (`/cadastro`). `/admin/empresas` é somente leitura.
- **Sem desvincular/desativar nesta entrega.** Só criar técnico/parceiro e
  vincular a uma empresa. Desvincular fica para um sub-projeto seguinte.
- **`tenants` não tem RLS própria** ("raiz do isolamento, sem RLS
  própria", comentário em `0001_init.sql`). `GET /tenants` depende
  inteiramente do `@Roles('admin')` do NestJS como única barreira — não
  há uma segunda camada de RLS atrás. Os testes precisam cobrir
  explicitamente os 403 pra `empresa`/`tecnico`/`parceiro`.
- **Um tenant pode ter vários técnicos e vários parceiros vinculados**
  (`tenant_technicians`/`tenant_partners` são muitos-para-muitos) — a
  lista de empresas mostra todos os nomes vinculados, não um único.
- **Mudança em `Technician`/`Partner` é aditiva.** `full_name`/`email`
  são campos novos — nenhum campo existente (`registration_number`,
  `specialization`, `service_region`, `status`, etc.) pode sumir da
  resposta.
- **Guarda de acesso no frontend é mínima**, mesmo padrão de `/tecnico/*`
  e `/empresa/epis`: cada página só verifica se existe `montese_token` no
  `localStorage` (senão redireciona pra `/login`). Nenhuma checagem de
  `role` no cliente — a autorização real é o `@Roles('admin')` do
  backend.
- **Provisionamento da primeira conta admin é manual, fora de código.**
  Sem endpoint de cadastro novo. Task 6 documenta o processo num runbook
  — a execução real do `INSERT` em produção NÃO é uma ação automática de
  nenhuma task deste plano (ver nota na Task 6).
- **Testes e2e reais, sem mock**, contra o Postgres desta VPS — mesmo
  padrão rigoroso de todo o projeto. `TestDb`
  (`backend/test/db-test-helper.ts`) já suporta
  `createUserWithRole('admin', ...)` — usado em testes anteriores
  (`technicians-assign.e2e-spec.ts`), nenhuma mudança necessária nele.

---

### Task 1: Backend — `GET /tenants` (admin-only, vínculos agregados)

**Files:**
- Modify: `backend/src/tenants/tenants.service.ts`
- Modify: `backend/src/tenants/tenants.controller.ts`
- Test: `backend/test/tenants-admin-list.e2e-spec.ts` (criar)

**Interfaces:**
- Consumes: nada de outra task.
- Produces: `TenantsService.findAllWithLinks(client): Promise<TenantWithLinks[]>`,
  interface `TenantWithLinks` (`Tenant` + `technicians: {id: string, name:
  string}[]` + `partners: {id: string, name: string}[]`), endpoint
  `GET /tenants` (`@Roles('admin')`). Task 3 consome o endpoint pra listar
  empresas; Tasks 4/5 consomem pra popular o seletor de "vincular a
  empresa".

- [ ] **Step 1: Escrever o teste e2e (vai falhar — endpoint não existe)**

Criar `backend/test/tenants-admin-list.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /tenants (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let tenantAId: string;
  let tenantBId: string;
  let tenantCId: string;
  let technician1Id: string;
  let technician2Id: string;
  let partnerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenantA = await db.createTenantWithUser('Empresa Admin List A');
    const tenantB = await db.createTenantWithUser('Empresa Admin List B');
    const tenantC = await db.createTenantWithUser('Empresa Admin List C');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;
    tenantCId = tenantC.tenantId;

    const admin = await db.createUserWithRole('admin', 'Admin List Teste');
    const tech1 = await db.createUserWithRole('tecnico', 'Tecnico List Um');
    const tech2 = await db.createUserWithRole('tecnico', 'Tecnico List Dois');
    const partner1 = await db.createUserWithRole('parceiro', 'Parceiro List Um');

    const tech1Result = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech1.userId],
    );
    technician1Id = tech1Result.rows[0].id;

    const tech2Result = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech2.userId],
    );
    technician2Id = tech2Result.rows[0].id;

    const partnerResult = await (db as any).client.query(
      'INSERT INTO partners (user_id, service_region) VALUES ($1, $2) RETURNING id',
      [partner1.userId, 'Sul'],
    );
    partnerId = partnerResult.rows[0].id;

    // tenantB: 1 técnico vinculado, 0 parceiros
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantBId, technician1Id],
    );

    // tenantC: 2 técnicos + 1 parceiro vinculados
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantCId, technician1Id],
    );
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantCId, technician2Id],
    );
    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantCId, partnerId],
    );

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    tokenEmpresa = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantBId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantCId]);
    await (db as any).client.query('DELETE FROM tenant_partners WHERE tenant_id = $1', [tenantCId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technician1Id]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technician2Id]);
    await (db as any).client.query('DELETE FROM partners WHERE id = $1', [partnerId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('admin vê todos os tenants com vínculos agregados corretamente', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenants')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const byId = new Map(res.body.map((t: any) => [t.id, t]));

    const tenantA = byId.get(tenantAId) as any;
    expect(tenantA.technicians).toEqual([]);
    expect(tenantA.partners).toEqual([]);

    const tenantB = byId.get(tenantBId) as any;
    expect(tenantB.technicians).toHaveLength(1);
    expect(tenantB.technicians[0].id).toBe(technician1Id);
    expect(tenantB.partners).toEqual([]);

    const tenantC = byId.get(tenantCId) as any;
    expect(tenantC.technicians).toHaveLength(2);
    expect(tenantC.technicians.map((t: any) => t.id).sort()).toEqual(
      [technician1Id, technician2Id].sort(),
    );
    expect(tenantC.partners).toHaveLength(1);
    expect(tenantC.partners[0].id).toBe(partnerId);
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenants')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(res.status).toBe(403);
  });

  it('bloqueia tecnico com 403', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Bloqueio List');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });
    const res = await request(app.getHttpServer())
      .get('/tenants')
      .set('Authorization', `Bearer ${login.body.access_token}`);
    expect(res.status).toBe(403);
  });

  it('bloqueia parceiro com 403', async () => {
    const parceiro = await db.createUserWithRole('parceiro', 'Parceiro Bloqueio List');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: parceiro.email, password: parceiro.password });
    const res = await request(app.getHttpServer())
      .get('/tenants')
      .set('Authorization', `Bearer ${login.body.access_token}`);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

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
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand tenants-admin-list"
```

Esperado: FAIL — `GET /tenants` retorna 404 (rota não existe ainda).

- [ ] **Step 3: Implementar `findAllWithLinks` em `tenants.service.ts`**

Adicionar ao topo do arquivo (depois do `import`), antes da interface `Tenant`:

```typescript
export interface TenantLink {
  id: string;
  name: string;
}

export interface TenantWithLinks extends Tenant {
  technicians: TenantLink[];
  partners: TenantLink[];
}
```

Adicionar ao `TenantsService`, como novo método (antes de `findOne`):

```typescript
  async findAllWithLinks(client: PoolClient): Promise<TenantWithLinks[]> {
    const result = await client.query<TenantWithLinks>(
      `SELECT
         t.id, t.name, t.cnpj, t.plan, t.status, t.sector, t.contact_name,
         t.contact_phone, t.created_at, t.updated_at,
         COALESCE(
           (SELECT json_agg(jsonb_build_object('id', tech.id, 'name', tu.full_name))
            FROM tenant_technicians tt
            JOIN technicians tech ON tech.id = tt.technician_id
            JOIN users tu ON tu.id = tech.user_id
            WHERE tt.tenant_id = t.id AND tt.status = 'ativo'),
           '[]'
         ) AS technicians,
         COALESCE(
           (SELECT json_agg(jsonb_build_object('id', p.id, 'name', pu.full_name))
            FROM tenant_partners tp
            JOIN partners p ON p.id = tp.partner_id
            JOIN users pu ON pu.id = p.user_id
            WHERE tp.tenant_id = t.id AND tp.status = 'ativo'),
           '[]'
         ) AS partners
       FROM tenants t
       ORDER BY t.created_at DESC`,
    );
    return result.rows;
  }
```

- [ ] **Step 4: Adicionar o endpoint em `tenants.controller.ts`**

Substituir o comentário existente acima de `findMe` (linhas 10-12, que
cita "Fase 7 (Dashboard Admin), fora de escopo aqui" — está desatualizado
agora que esta task existe) e adicionar o novo endpoint:

```typescript
import { Body, Controller, Get, Patch, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantsService } from './tenants.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  // Lista completa (todos os tenants, com vínculos agregados) — só admin,
  // ver findAll() abaixo. findMe/updateMe seguem exclusivos de 'empresa',
  // sempre resolvendo o próprio tenantId do JWT, nunca um id vindo do
  // cliente.
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

  // 'tenants' não tem RLS própria — @Roles('admin') é a única barreira
  // pra esta lista completa, sem filtro nenhum. Ver Global Constraints do
  // plano da Fase 7 sub-projeto A.
  @Roles('admin')
  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.tenants.findAllWithLinks(client));
  }
}
```

- [ ] **Step 5: Rodar o teste pra confirmar que passa**

Mesmo comando do Step 2. Esperado: PASS, 4 testes.

- [ ] **Step 6: Commit**

```bash
git add backend/src/tenants/tenants.service.ts backend/src/tenants/tenants.controller.ts backend/test/tenants-admin-list.e2e-spec.ts
git commit -m "feat: adiciona GET /tenants admin-only com vinculos agregados"
```

---

### Task 2: Backend — `GET /technicians`/`GET /partners` ganham `full_name`/`email`

**Files:**
- Modify: `backend/src/technicians/technicians.service.ts`
- Modify: `backend/src/partners/partners.service.ts`
- Test: `backend/test/technicians-partners-fields.e2e-spec.ts` (criar)

**Interfaces:**
- Consumes: nada de outra task.
- Produces: `Technician`/`Partner` ganham `full_name: string` e `email:
  string`. Tasks 4/5 consomem esses campos pra exibir nome/e-mail na
  lista do frontend.

- [ ] **Step 1: Escrever o teste e2e (vai falhar — campos não existem)**

Criar `backend/test/technicians-partners-fields.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /technicians e GET /partners incluem full_name/email (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let technicianId: string;
  let partnerId: string;
  let techEmail: string;
  let partnerEmail: string;

  const techFullName = 'Tecnico Fields Teste';
  const partnerFullName = 'Parceiro Fields Teste';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Fields Teste');
    const tech = await db.createUserWithRole('tecnico', techFullName);
    const partner = await db.createUserWithRole('parceiro', partnerFullName);
    techEmail = tech.email;
    partnerEmail = partner.email;

    const techResult = await (db as any).client.query(
      `INSERT INTO technicians (user_id, registration_number, specialization)
       VALUES ($1, $2, $3) RETURNING id`,
      [tech.userId, 'REG-001', 'Segurança do Trabalho'],
    );
    technicianId = techResult.rows[0].id;

    const partnerResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, $2) RETURNING id`,
      [partner.userId, 'Sul'],
    );
    partnerId = partnerResult.rows[0].id;

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await (db as any).client.query('DELETE FROM partners WHERE id = $1', [partnerId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /technicians inclui full_name/email sem perder os campos existentes', async () => {
    const res = await request(app.getHttpServer())
      .get('/technicians')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const found = res.body.find((t: any) => t.id === technicianId);
    expect(found).toBeDefined();
    expect(found.full_name).toBe(techFullName);
    expect(found.email).toBe(techEmail);
    expect(found.registration_number).toBe('REG-001');
    expect(found.specialization).toBe('Segurança do Trabalho');
    expect(found.status).toBe('ativo');
  });

  it('GET /technicians/:id inclui full_name/email', async () => {
    const res = await request(app.getHttpServer())
      .get(`/technicians/${technicianId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body.full_name).toBe(techFullName);
    expect(res.body.email).toBe(techEmail);
  });

  it('GET /partners inclui full_name/email sem perder os campos existentes', async () => {
    const res = await request(app.getHttpServer())
      .get('/partners')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const found = res.body.find((p: any) => p.id === partnerId);
    expect(found).toBeDefined();
    expect(found.full_name).toBe(partnerFullName);
    expect(found.email).toBe(partnerEmail);
    expect(found.service_region).toBe('Sul');
    expect(found.status).toBe('ativo');
  });

  it('GET /partners/:id inclui full_name/email', async () => {
    const res = await request(app.getHttpServer())
      .get(`/partners/${partnerId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body.full_name).toBe(partnerFullName);
    expect(res.body.email).toBe(partnerEmail);
  });
});
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Mesmo comando de execução do Task 1 Step 2, trocando o filtro do jest
pro nome deste arquivo: `technicians-partners-fields`.
Esperado: FAIL — `full_name`/`email` vêm `undefined` nas asserções.

- [ ] **Step 3: Adicionar `full_name`/`email` em `technicians.service.ts`**

Modificar a interface `Technician` (linhas 11-19):

```typescript
export interface Technician {
  id: string;
  user_id: string;
  registration_number: string | null;
  specialization: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  full_name: string;
  email: string;
}
```

Modificar `findAll` (linhas 57-62):

```typescript
  async findAll(client: PoolClient): Promise<Technician[]> {
    const result = await client.query<Technician>(
      `SELECT technicians.*, users.full_name, users.email
       FROM technicians
       JOIN users ON users.id = technicians.user_id
       ORDER BY technicians.created_at DESC`,
    );
    return result.rows;
  }
```

Modificar `findOne` (linhas 64-69):

```typescript
  async findOne(client: PoolClient, id: string): Promise<Technician> {
    const result = await client.query<Technician>(
      `SELECT technicians.*, users.full_name, users.email
       FROM technicians
       JOIN users ON users.id = technicians.user_id
       WHERE technicians.id = $1`,
      [id],
    );
    const technician = result.rows[0];
    if (!technician) throw new NotFoundException('Técnico não encontrado');
    return technician;
  }
```

- [ ] **Step 4: Mesma mudança em `partners.service.ts`**

Modificar a interface `Partner` (linhas 11-18):

```typescript
export interface Partner {
  id: string;
  user_id: string;
  service_region: string;
  status: string;
  created_at: string;
  updated_at: string;
  full_name: string;
  email: string;
}
```

Modificar `findAll` (linhas 53-56):

```typescript
  async findAll(client: PoolClient): Promise<Partner[]> {
    const result = await client.query<Partner>(
      `SELECT partners.*, users.full_name, users.email
       FROM partners
       JOIN users ON users.id = partners.user_id
       ORDER BY partners.created_at DESC`,
    );
    return result.rows;
  }
```

Modificar `findOne` (linhas 58-63):

```typescript
  async findOne(client: PoolClient, id: string): Promise<Partner> {
    const result = await client.query<Partner>(
      `SELECT partners.*, users.full_name, users.email
       FROM partners
       JOIN users ON users.id = partners.user_id
       WHERE partners.id = $1`,
      [id],
    );
    const partner = result.rows[0];
    if (!partner) throw new NotFoundException('Parceiro não encontrado');
    return partner;
  }
```

- [ ] **Step 5: Rodar o teste pra confirmar que passa**

Mesmo comando do Step 2. Esperado: PASS, 4 testes.

- [ ] **Step 6: Rodar a suíte completa pra confirmar zero regressão**

Mesmo comando, sem filtro de nome (roda tudo):

```bash
node:20-alpine sh -c "npm run test:e2e"
```

Esperado: todas as suítes PASS — nenhum outro teste depende do shape
antigo de `Technician`/`Partner` (mudança é aditiva).

- [ ] **Step 7: Commit**

```bash
git add backend/src/technicians/technicians.service.ts backend/src/partners/partners.service.ts backend/test/technicians-partners-fields.e2e-spec.ts
git commit -m "feat: GET /technicians e GET /partners passam a incluir full_name/email"
```

---

### Task 3: Frontend — `AdminNav`, `/admin/empresas`, redirect de login

**Files:**
- Create: `frontend/src/components/AdminNav.tsx`
- Create: `frontend/src/app/admin/empresas/page.tsx`
- Modify: `frontend/src/app/(site)/login/page.tsx:32-39`

**Interfaces:**
- Consumes: `GET /tenants` (Task 1) — shape `TenantWithLinks[]`
  (`id, name, cnpj, plan, status, technicians: {id,name}[], partners:
  {id,name}[]`).
- Produces: componente `AdminNav` (sem props) — consumido por Tasks 4 e
  5 sem modificação.

- [ ] **Step 1: Criar `AdminNav.tsx`**

```typescript
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/admin/empresas', label: 'Empresas' },
  { href: '/admin/tecnicos', label: 'Técnicos' },
  { href: '/admin/parceiros', label: 'Parceiros' },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-4 border-b border-brand-100 pb-4">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={
            pathname === link.href
              ? 'font-semibold text-brand-900'
              : 'text-brand-700 hover:text-brand-900'
          }
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Criar `/admin/empresas/page.tsx`**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminNav } from '@/components/AdminNav';

interface TenantLink {
  id: string;
  name: string;
}

interface TenantRow {
  id: string;
  name: string;
  cnpj: string;
  plan: string;
  status: string;
  technicians: TenantLink[];
  partners: TenantLink[];
}

export default function AdminEmpresasPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    fetch('/api/tenants', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(setTenants)
      .catch(() => setError('Não foi possível carregar as empresas.'));
  }, [router]);

  if (!ready) {
    return <div className="mx-auto max-w-4xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Painel administrativo</h1>
      <div className="mt-6">
        <AdminNav />
      </div>
      <div className="mt-8">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {tenants.length === 0 && !error ? (
          <p className="text-sm text-brand-700">Nenhuma empresa cadastrada ainda.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-brand-100 text-brand-700">
                <th className="py-2">Empresa</th>
                <th className="py-2">CNPJ</th>
                <th className="py-2">Plano</th>
                <th className="py-2">Status</th>
                <th className="py-2">Técnicos</th>
                <th className="py-2">Parceiros</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="border-b border-brand-100">
                  <td className="py-2 font-medium text-brand-900">{tenant.name}</td>
                  <td className="py-2 text-brand-700">{tenant.cnpj}</td>
                  <td className="py-2 text-brand-700">{tenant.plan}</td>
                  <td className="py-2 text-brand-700">{tenant.status}</td>
                  <td className="py-2 text-brand-700">
                    {tenant.technicians.length === 0
                      ? '—'
                      : tenant.technicians.map((t) => t.name).join(', ')}
                  </td>
                  <td className="py-2 text-brand-700">
                    {tenant.partners.length === 0
                      ? '—'
                      : tenant.partners.map((p) => p.name).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Adicionar o branch de `role === 'admin'` no redirect do login**

Em `frontend/src/app/(site)/login/page.tsx`, substituir o `router.push`
(linhas 33-39):

```typescript
      router.push(
        role === 'empresa'
          ? '/empresa/onboarding'
          : role === 'tecnico' || role === 'parceiro'
            ? '/tecnico/empresas'
            : role === 'admin'
              ? '/admin/empresas'
              : '/',
      );
```

- [ ] **Step 4: Build isolado do frontend**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
```

Esperado: build passa sem erro de tipo (as três rotas novas de `/admin/*`
das Tasks 4/5 ainda não existem — isso é normal, o build só valida o que
já foi criado até aqui).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AdminNav.tsx frontend/src/app/admin/empresas/page.tsx "frontend/src/app/(site)/login/page.tsx"
git commit -m "feat: adiciona painel admin (empresas) e redirect de login pra role admin"
```

---

### Task 4: Frontend — `/admin/tecnicos` (criar + vincular)

**Files:**
- Create: `frontend/src/app/admin/tecnicos/page.tsx`

**Interfaces:**
- Consumes: `AdminNav` (Task 3, sem props); `GET /tenants` (Task 1, pro
  seletor de "vincular a empresa"); `GET /technicians`, `POST
  /technicians` (`CreateTechnicianDto`: `email, password, full_name,
  phone?, registration_number?, specialization?`), `POST
  /technicians/:id/assign` (`AssignTechnicianDto`: `tenant_id`) — campos
  `full_name`/`email` da Task 2.
- Produces: nada consumido por outra task.

- [ ] **Step 1: Criar `/admin/tecnicos/page.tsx`**

```typescript
'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminNav } from '@/components/AdminNav';

interface Technician {
  id: string;
  full_name: string;
  email: string;
  registration_number: string | null;
  specialization: string | null;
  status: string;
}

interface TenantOption {
  id: string;
  name: string;
}

export default function AdminTecnicosPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [listError, setListError] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const [assignFormId, setAssignFormId] = useState<string | null>(null);
  const [assignTenantId, setAssignTenantId] = useState('');
  const [assignStatus, setAssignStatus] = useState<'idle' | 'loading' | 'erro' | 'sucesso'>('idle');

  async function loadTechnicians() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/technicians', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setTechnicians(await res.json());
        setListError('');
      } else {
        setListError('Não foi possível carregar os técnicos.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  async function loadTenants() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/tenants', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setTenants(await res.json());
    } catch {
      // seletor de empresa fica vazio; erro de conexão já reportado por loadTechnicians
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    Promise.all([loadTechnicians(), loadTenants()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setErrorMessage('');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/technicians', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          phone: phone || undefined,
          registration_number: registrationNumber || undefined,
          specialization: specialization || undefined,
        }),
      });
      if (res.ok) {
        setEmail('');
        setPassword('');
        setFullName('');
        setPhone('');
        setRegistrationNumber('');
        setSpecialization('');
        setStatus('idle');
        loadTechnicians();
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(body?.message ?? 'Não foi possível cadastrar o técnico.');
      setStatus('erro');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setStatus('erro');
    }
  }

  async function handleAssign(event: FormEvent, technicianId: string) {
    event.preventDefault();
    setAssignStatus('loading');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/technicians/${technicianId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: assignTenantId }),
      });
      if (res.ok) {
        setAssignStatus('sucesso');
        setAssignTenantId('');
      } else {
        setAssignStatus('erro');
      }
    } catch {
      setAssignStatus('erro');
    }
  }

  if (!ready) {
    return <div className="mx-auto max-w-4xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Painel administrativo</h1>
      <div className="mt-6">
        <AdminNav />
      </div>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Criar técnico</h2>
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            E-mail
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Senha
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
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
            Telefone (opcional)
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Registro profissional (opcional)
            <input
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Especialização (opcional)
            <input
              value={specialization}
              onChange={(e) => setSpecialization(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={status === 'loading'}
            className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {status === 'loading' ? 'Cadastrando...' : 'Criar técnico'}
          </button>
        </form>
      </section>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Técnicos cadastrados</h2>
        {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}
        {technicians.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhum técnico cadastrado ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {technicians.map((tech) => (
              <li key={tech.id} className="rounded-md border border-brand-100 px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <strong className="text-brand-900">{tech.full_name}</strong>
                    <span className="ml-2 text-brand-700">{tech.email}</span>
                  </div>
                  <button
                    onClick={() => {
                      setAssignFormId(tech.id);
                      setAssignStatus('idle');
                    }}
                    className="text-brand-500 hover:underline"
                  >
                    Vincular a empresa
                  </button>
                </div>

                {assignFormId === tech.id && (
                  <form
                    onSubmit={(e) => handleAssign(e, tech.id)}
                    className="mt-3 flex flex-col gap-2 border-t border-brand-100 pt-3"
                  >
                    <label className="flex flex-col gap-1 text-xs text-brand-900">
                      Empresa
                      <select
                        required
                        value={assignTenantId}
                        onChange={(e) => setAssignTenantId(e.target.value)}
                        className="rounded-md border border-brand-100 px-3 py-2"
                      >
                        <option value="">Selecione</option>
                        {tenants.map((tenant) => (
                          <option key={tenant.id} value={tenant.id}>
                            {tenant.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {assignStatus === 'erro' && (
                      <p className="text-xs text-red-600">Não foi possível vincular.</p>
                    )}
                    {assignStatus === 'sucesso' && (
                      <p className="text-xs text-brand-700">Vinculado com sucesso.</p>
                    )}
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        className="self-start rounded-md bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        Confirmar vínculo
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssignFormId(null)}
                        className="self-start rounded-md border border-brand-100 px-4 py-2 text-xs font-medium text-brand-700"
                      >
                        Fechar
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Build isolado do frontend**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
```

Esperado: build passa sem erro de tipo.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/tecnicos/page.tsx
git commit -m "feat: adiciona painel admin de tecnicos (criar + vincular)"
```

---

### Task 5: Frontend — `/admin/parceiros` (criar + vincular)

**Files:**
- Create: `frontend/src/app/admin/parceiros/page.tsx`

**Interfaces:**
- Consumes: `AdminNav` (Task 3, sem props); `GET /tenants` (Task 1, pro
  seletor de "vincular a empresa"); `GET /partners`, `POST /partners`
  (`CreatePartnerDto`: `email, password, full_name, phone?,
  service_region`), `POST /partners/:id/assign` (`AssignPartnerDto`:
  `tenant_id`) — campos `full_name`/`email` da Task 2.
- Produces: nada consumido por outra task.

- [ ] **Step 1: Criar `/admin/parceiros/page.tsx`**

```typescript
'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AdminNav } from '@/components/AdminNav';

interface Partner {
  id: string;
  full_name: string;
  email: string;
  service_region: string;
  status: string;
}

interface TenantOption {
  id: string;
  name: string;
}

export default function AdminParceirosPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [listError, setListError] = useState('');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [serviceRegion, setServiceRegion] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'erro'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const [assignFormId, setAssignFormId] = useState<string | null>(null);
  const [assignTenantId, setAssignTenantId] = useState('');
  const [assignStatus, setAssignStatus] = useState<'idle' | 'loading' | 'erro' | 'sucesso'>('idle');

  async function loadPartners() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/partners', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        setPartners(await res.json());
        setListError('');
      } else {
        setListError('Não foi possível carregar os parceiros.');
      }
    } catch {
      setListError('Não foi possível conectar ao servidor.');
    }
  }

  async function loadTenants() {
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/tenants', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) setTenants(await res.json());
    } catch {
      // seletor de empresa fica vazio; erro de conexão já reportado por loadPartners
    }
  }

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }
    setReady(true);
    Promise.all([loadPartners(), loadTenants()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setStatus('loading');
    setErrorMessage('');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email,
          password,
          full_name: fullName,
          phone: phone || undefined,
          service_region: serviceRegion,
        }),
      });
      if (res.ok) {
        setEmail('');
        setPassword('');
        setFullName('');
        setPhone('');
        setServiceRegion('');
        setStatus('idle');
        loadPartners();
        return;
      }
      const body = await res.json().catch(() => null);
      setErrorMessage(body?.message ?? 'Não foi possível cadastrar o parceiro.');
      setStatus('erro');
    } catch {
      setErrorMessage('Não foi possível conectar ao servidor.');
      setStatus('erro');
    }
  }

  async function handleAssign(event: FormEvent, partnerId: string) {
    event.preventDefault();
    setAssignStatus('loading');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch(`/api/partners/${partnerId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenant_id: assignTenantId }),
      });
      if (res.ok) {
        setAssignStatus('sucesso');
        setAssignTenantId('');
      } else {
        setAssignStatus('erro');
      }
    } catch {
      setAssignStatus('erro');
    }
  }

  if (!ready) {
    return <div className="mx-auto max-w-4xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Painel administrativo</h1>
      <div className="mt-6">
        <AdminNav />
      </div>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Criar parceiro</h2>
        <form onSubmit={handleCreate} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            E-mail
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Senha
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
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
            Telefone (opcional)
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Região de atendimento
            <input
              required
              value={serviceRegion}
              onChange={(e) => setServiceRegion(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          {status === 'erro' && <p className="text-sm text-red-600">{errorMessage}</p>}
          <button
            type="submit"
            disabled={status === 'loading'}
            className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {status === 'loading' ? 'Cadastrando...' : 'Criar parceiro'}
          </button>
        </form>
      </section>

      <section className="mt-8 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Parceiros cadastrados</h2>
        {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}
        {partners.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhum parceiro cadastrado ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {partners.map((partner) => (
              <li key={partner.id} className="rounded-md border border-brand-100 px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <strong className="text-brand-900">{partner.full_name}</strong>
                    <span className="ml-2 text-brand-700">{partner.email}</span>
                    <span className="ml-2 text-brand-700">({partner.service_region})</span>
                  </div>
                  <button
                    onClick={() => {
                      setAssignFormId(partner.id);
                      setAssignStatus('idle');
                    }}
                    className="text-brand-500 hover:underline"
                  >
                    Vincular a empresa
                  </button>
                </div>

                {assignFormId === partner.id && (
                  <form
                    onSubmit={(e) => handleAssign(e, partner.id)}
                    className="mt-3 flex flex-col gap-2 border-t border-brand-100 pt-3"
                  >
                    <label className="flex flex-col gap-1 text-xs text-brand-900">
                      Empresa
                      <select
                        required
                        value={assignTenantId}
                        onChange={(e) => setAssignTenantId(e.target.value)}
                        className="rounded-md border border-brand-100 px-3 py-2"
                      >
                        <option value="">Selecione</option>
                        {tenants.map((tenant) => (
                          <option key={tenant.id} value={tenant.id}>
                            {tenant.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {assignStatus === 'erro' && (
                      <p className="text-xs text-red-600">Não foi possível vincular.</p>
                    )}
                    {assignStatus === 'sucesso' && (
                      <p className="text-xs text-brand-700">Vinculado com sucesso.</p>
                    )}
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        className="self-start rounded-md bg-brand-500 px-4 py-2 text-xs font-medium text-white hover:bg-brand-700"
                      >
                        Confirmar vínculo
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssignFormId(null)}
                        className="self-start rounded-md border border-brand-100 px-4 py-2 text-xs font-medium text-brand-700"
                      >
                        Fechar
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Build isolado do frontend**

```bash
docker run --rm -v "$(pwd)/frontend:/app" -w /app node:20-alpine npm run build
```

Esperado: build passa sem erro de tipo — as três páginas de `/admin/*`
(empresas, técnicos, parceiros) agora existem juntas.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/admin/parceiros/page.tsx
git commit -m "feat: adiciona painel admin de parceiros (criar + vincular)"
```

---

### Task 6: Runbook de provisionamento da primeira conta admin

**Files:**
- Create: `docs/operations/admin-provisioning.md`

**Interfaces:**
- Consumes: nada de outra task (documentação pura, sem código).
- Produces: nada consumido por outra task.

**Nota importante de escopo:** esta task documenta o processo. A
execução real do `INSERT` contra o banco de produção — criar uma conta
com credenciais de login de verdade — é uma ação com efeito persistente
sobre um sistema real, não uma etapa de código a rodar sem supervisão.
Quem executar este plano documenta o runbook e para aí; rodar o comando
final de fato é uma decisão do controller da sessão (ou do fundador
diretamente), tomada com confirmação explícita do e-mail/senha a usar —
igual a qualquer outra ação irreversível/sensível deste projeto.

- [ ] **Step 1: Criar o runbook**

Criar `docs/operations/admin-provisioning.md`:

```markdown
# Provisionamento de conta admin

> Fase 7 sub-projeto A (Gestão de tenants e vínculos). Diferente de
> técnico/parceiro (`POST /technicians`, `POST /partners`), não existe
> endpoint de cadastro para o papel `admin` — decisão confirmada em
> brainstorming de 2026-08-26: "insert manual documentado", já que só um
> punhado de pessoas da Montese será admin. Ver
> [`docs/specs/fase-7-gestao-tenants.md`](../specs/fase-7-gestao-tenants.md)
> seção 4.

## Pré-requisito

`role = 'admin'` já existe no tipo `user_role` desde a Fase 1
(`0001_init.sql`) e todo RLS multi-tenant do projeto já reconhece essa
role — nenhuma migration é necessária, só a linha em `users`.

## Passo 1 — gerar o hash da senha

Rodar dentro de um container Node isolado (mesma imagem usada nos testes
e2e do projeto, com `bcrypt` já compilado em `backend/node_modules`):

\`\`\`bash
cd /opt/Montese
docker run --rm -v "$(pwd)/backend:/app" -w /app node:20-alpine \
  node -e "const bcrypt = require('bcrypt'); bcrypt.hash(process.argv[1], 10).then((h) => console.log(h));" \
  "SENHA_FORTE_AQUI"
\`\`\`

Copiar a saída (uma string começando com `$2b$10$...`) — esse é o
`password_hash` usado no passo 2.

## Passo 2 — inserir a conta

`users` tem RLS (`users_isolation`) — inserir direto como
`POSTGRES_APP_USER` exigiria as variáveis de sessão `app.role`/
`app.tenant_id` que só a aplicação define. Pra uma inserção manual
única, conectar como superuser (mesmo padrão que
`backend/test/db-test-helper.ts` já usa pra fixtures de teste — bypassa
RLS por definição):

\`\`\`bash
set -a; source /opt/Montese/.env; set +a
docker exec -it montese_postgres psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" -c "
INSERT INTO users (tenant_id, role, email, password_hash, full_name, status)
VALUES (NULL, 'admin', 'EMAIL_DO_ADMIN_AQUI', 'HASH_GERADO_NO_PASSO_1', 'NOME_DO_ADMIN_AQUI', 'ativo');
"
\`\`\`

`tenant_id = NULL` é obrigatório — a constraint em `0001_init.sql:41`
só permite `tenant_id NOT NULL` pra `role = 'empresa'`;
`tecnico`/`parceiro`/`admin` são sempre `NULL`.

## Passo 3 — verificar

Login manual em `https://montesesst.com.br/login` com o e-mail/senha
escolhidos. Deve redirecionar para `/admin/empresas` e mostrar a lista
de empresas cadastradas.

## Contas existentes

Nenhuma — em 2026-08-26, `SELECT COUNT(*) FROM users WHERE role =
'admin'` retorna `0`. A primeira conta real é criada seguindo este
runbook, fora do escopo automático deste plano de implementação (ver
nota da Task 6).
```

- [ ] **Step 2: Commit**

```bash
git add docs/operations/admin-provisioning.md
git commit -m "docs: runbook de provisionamento manual da primeira conta admin"
```

---

## Self-Review (feito ao escrever este plano)

**Cobertura da spec:** seção 2 (`GET /tenants` → Task 1; `full_name`/
`email` → Task 2) ✅; seção 3 (login → Task 3; três páginas → Tasks 3/4/5)
✅; seção 4 (provisionamento → Task 6) ✅; seção 5 (testes e2e reais +
build isolado → cobertos em cada task) ✅; seção 6 (decisões) refletidas
nas Global Constraints ✅; seção 7 (pendências) deliberadamente sem task
— fora de escopo, como a própria spec documenta.

**Placeholders:** nenhum `TBD`/`TODO` — os únicos placeholders literais
(`SENHA_FORTE_AQUI`, `EMAIL_DO_ADMIN_AQUI`) estão dentro do runbook da
Task 6, que é documentação operacional para preenchimento humano no
momento da execução real, não uma lacuna do plano.

**Consistência de tipos:** `TenantWithLinks` (Task 1) é consumida
identicamente em Tasks 3/4/5 como `{id, name, cnpj, plan, status,
technicians: {id,name}[], partners: {id,name}[]}`. `Technician`/
`Partner` (Task 2) ganham `full_name`/`email`, consumidos com os mesmos
nomes em Tasks 4/5. Nenhuma divergência de nome entre tasks.
