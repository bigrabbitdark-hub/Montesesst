# Fase 11 — Agenda de Visitas + "Meu Dia" do técnico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agendamento real de visita técnica (empresa solicita, técnico/parceiro confirma com data) mais um painel agregado ("Meu Dia") combinando essa agenda com as pendências das empresas vinculadas ao técnico, mais lembrete automático por e-mail.

**Architecture:** Tabela nova `visit_requests` com RLS copiada do padrão já em produção (`documents`/`inspections`/`action_plans`). `VisitsModule` novo com máquina de estados de 4 estágios. `TechnicianAgendaService` agrega a agenda própria do técnico com `DashboardService.getSummary()` (reaproveitado sem nenhuma alteração) chamado uma vez por empresa vinculada. `VisitReminderCron` reaproveita `@nestjs/schedule` (já em uso desde a Fase 9) e `EmailService.send()` (já existe).

**Tech Stack:** NestJS + Postgres (RLS) + node-postgres (`pg`), `class-validator`, `@nestjs/schedule`, Resend (via `EmailService` já existente). Testes: Jest e2e contra Postgres real (`backend/test/*.e2e-spec.ts`), sem mock de banco.

**Spec:** [`docs/specs/fase-11-agenda-visitas.md`](../specs/fase-11-agenda-visitas.md)

## Global Constraints

- Fluxo de estado: **empresa solicita → técnico/parceiro confirma**. Estados: `solicitado`, `confirmado`, `concluido`, `cancelado`. Transições válidas: `solicitado→confirmado`, `solicitado→cancelado`, `confirmado→cancelado`, `confirmado→concluido`. `concluido`/`cancelado` são finais.
- Vale pra técnico responsável **e** técnico parceiro — `technician_user_id` é um único FK pra `users(id)` (não dois FKs separados), porque `technicians.user_id`/`partners.user_id` já referenciam `users` de forma única.
- **Sem recorrência** nesta fase — toda visita é solicitada/confirmada individualmente.
- RLS da tabela nova copia **exatamente** o padrão de `backend/db/migrations/0011_partner_access.sql` (branch admin, branch empresa via `tenant_id`, branch técnico via `tenant_technicians`, branch parceiro via `tenant_partners`).
- `DashboardService.getSummary()` (`backend/src/dashboard/dashboard.service.ts`) é reaproveitado **verbatim** — zero linha alterada nesse arquivo.
- `EmailService.send()` (`backend/src/common/email/email.service.ts`) é reaproveitado tal como está — **lança exceção** se o envio falhar (não retorna erro silenciosamente); quem chama decide se isso derruba o fluxo ou só loga.
- **Desvio deliberado da spec, decidido durante este plano:** a spec (seção 5) sugeria a rota `GET /technicians/me/day`. Este plano usa **`GET /visits/me/day`** em vez disso — mantém tudo sobre visitas+agenda dentro do `VisitsModule` novo, evita duas classes `@Controller('technicians')` competindo pelo mesmo prefixo em módulos diferentes (padrão que não existe hoje no projeto — `tenant-technicians` é prefixo próprio, não compartilha `technicians`), e evita modificar o `TechniciansController` já existente e testado. Mesma lógica, endpoint reagrupado sob o recurso a que ele realmente pertence.
- Toda transição de estado (`confirmar`/`cancelar`/`concluir`) usa `SELECT ... FOR UPDATE` antes de checar o estado — mesmo padrão de `InspectionsService.assertDraft` (`backend/src/inspections/inspections.service.ts:133-143`) — dentro da transação aberta por `req.withTenantContext` (que já faz `BEGIN`/`COMMIT` real, confirmado em `backend/src/common/database/database.service.ts:54-63`), não uma chamada solta.
- Rotas de mutação usam `ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })`, igual `backend/src/inspections/inspections.controller.ts`.
- Verbos de rota em português (`/confirmar`, `/cancelar`, `/concluir`), seguindo o precedente já existente de `inspections/:id/concluir`.

---

## Task 1: Migration + VisitsModule (CRUD + máquina de estados)

**Files:**
- Create: `backend/db/migrations/0022_visit_requests.sql`
- Create: `backend/src/visits/visits.service.ts`
- Create: `backend/src/visits/visits.controller.ts`
- Create: `backend/src/visits/visits.module.ts`
- Create: `backend/src/visits/dto/create-visit.dto.ts`
- Create: `backend/src/visits/dto/confirm-visit.dto.ts`
- Create: `backend/src/visits/dto/conclude-visit.dto.ts`
- Modify: `backend/src/app.module.ts` (registrar `VisitsModule`)
- Test: `backend/test/visits-create-confirm.e2e-spec.ts`
- Test: `backend/test/visits-cancel-conclude.e2e-spec.ts`
- Test: `backend/test/visits-rls.e2e-spec.ts`

**Interfaces:**
- Produces: `VisitRequest` (interface, exportada de `visits.service.ts`) — `{ id, tenant_id, technician_user_id, requested_by_user_id, status: 'solicitado'|'confirmado'|'concluido'|'cancelado', preferred_date: string|null, confirmed_date: string|null, motivo: string|null, inspection_id: string|null, created_at, updated_at }`. `VisitsService` (classe, injetável) com métodos `create`, `findAll`, `confirm`, `cancel`, `conclude` — assinaturas completas no Step 3. Tabela `visit_requests` no Postgres.
- Consumes: nada de tasks anteriores (primeira task da fase).

- [ ] **Step 1: Escrever a migration**

Criar `backend/db/migrations/0022_visit_requests.sql`:

```sql
-- Fase 11 — agenda de visitas: fluxo empresa solicita / técnico ou
-- parceiro confirma. technician_user_id é um único FK pra users(id)
-- (não dois FKs separados por papel) porque technicians.user_id e
-- partners.user_id já apontam pra users de forma única (ver
-- 0001_init.sql). RLS copia exatamente o padrão de
-- 0011_partner_access.sql (branch empresa/técnico/parceiro).
CREATE TABLE visit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  technician_user_id UUID NOT NULL REFERENCES users(id),
  requested_by_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'solicitado'
    CHECK (status IN ('solicitado', 'confirmado', 'concluido', 'cancelado')),
  preferred_date DATE,
  confirmed_date DATE,
  motivo TEXT,
  inspection_id UUID REFERENCES inspections(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX visit_requests_technician_idx ON visit_requests (technician_user_id);
CREATE INDEX visit_requests_tenant_idx ON visit_requests (tenant_id);
CREATE INDEX visit_requests_confirmed_date_idx ON visit_requests (confirmed_date)
  WHERE status = 'confirmado';

CREATE TRIGGER trg_visit_requests_updated_at BEFORE UPDATE ON visit_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE visit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY visit_requests_isolation ON visit_requests USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = visit_requests.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = visit_requests.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);
```

- [ ] **Step 2: Rodar a migration**

Run: `docker exec montese_backend npm run db:migrate`
Expected: `[ok] 0022_visit_requests.sql` (ou equivalente "aplicada com sucesso") na saída.

- [ ] **Step 3: Escrever o teste que falha primeiro — fluxo feliz + bug histórico de vínculo**

Criar `backend/test/visits-create-confirm.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /visits, GET /visits, PATCH /visits/:id/confirmar (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let technicianId: string;
  let technicianUserId: string;
  let technicianToken: string;
  let empresaToken: string;
  let createdVisitId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Visits Create Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Visits Create Teste');
    technicianUserId = tech.userId;
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    if (createdVisitId) {
      await (db as any).client.query('DELETE FROM visit_requests WHERE id = $1', [createdVisitId]);
    }
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa solicita visita pra técnico vinculado → 201, status solicitado', async () => {
    const res = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: technicianUserId, preferred_date: '2026-09-10', motivo: 'Revisão de PGR' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('solicitado');
    expect(res.body.tenant_id).toBe(tenantId);
    expect(res.body.technician_user_id).toBe(technicianUserId);
    createdVisitId = res.body.id;
  });

  it('empresa solicita visita pra técnico NÃO vinculado ao seu tenant → 403', async () => {
    const otherTech = await db.createUserWithRole('tecnico', 'Tecnico Visits Nao Vinculado Teste');
    const res = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: otherTech.userId, preferred_date: '2026-09-10' });

    expect(res.status).toBe(403);
  });

  it('técnico confirma a visita solicitada → 200, status confirmado, confirmed_date setada', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${createdVisitId}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-09-12' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmado');
    expect(res.body.confirmed_date).toBe('2026-09-12');
  });

  it('confirmar de novo (já confirmada) → 409', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${createdVisitId}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-09-13' });

    expect(res.status).toBe(409);
  });

  it('empresa vê a visita na listagem', async () => {
    const res = await request(app.getHttpServer())
      .get('/visits')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.find((v: { id: string }) => v.id === createdVisitId)).toBeDefined();
  });
});
```

- [ ] **Step 4: Rodar o teste e confirmar que falha**

Run: `docker exec montese_backend npx jest visits-create-confirm --runInBand`
Expected: FAIL — `Cannot find module '../src/app.module'` resolve ok, mas rotas `/visits` não existem ainda (404 em vez dos status esperados), ou erro de módulo não registrado.

- [ ] **Step 5: Implementar `VisitsService`**

Criar `backend/src/visits/visits.service.ts`:

```ts
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuthenticatedUser } from '../common/types';

export interface VisitRequest {
  id: string;
  tenant_id: string;
  technician_user_id: string;
  requested_by_user_id: string;
  status: 'solicitado' | 'confirmado' | 'concluido' | 'cancelado';
  preferred_date: string | null;
  confirmed_date: string | null;
  motivo: string | null;
  inspection_id: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class VisitsService {
  async create(
    client: PoolClient,
    tenantId: string,
    requestedByUserId: string,
    technicianUserId: string,
    preferredDate: string | undefined,
    motivo: string | undefined,
  ): Promise<VisitRequest> {
    const linked = await this.isTechnicianLinked(client, tenantId, technicianUserId);
    if (!linked) {
      throw new ForbiddenException('Técnico não está vinculado a esta empresa');
    }

    const result = await client.query<VisitRequest>(
      `INSERT INTO visit_requests (tenant_id, technician_user_id, requested_by_user_id, preferred_date, motivo)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenantId, technicianUserId, requestedByUserId, preferredDate ?? null, motivo ?? null],
    );
    return result.rows[0];
  }

  async findAll(client: PoolClient, user: AuthenticatedUser): Promise<VisitRequest[]> {
    if (user.role === 'empresa') {
      const result = await client.query<VisitRequest>(
        `SELECT * FROM visit_requests WHERE tenant_id = $1
         ORDER BY COALESCE(confirmed_date, preferred_date) ASC NULLS LAST`,
        [user.tenantId],
      );
      return result.rows;
    }
    // técnico/parceiro: RLS já restringe às empresas vinculadas; aqui filtra
    // pelas visitas atribuídas especificamente a este usuário.
    const result = await client.query<VisitRequest>(
      `SELECT * FROM visit_requests WHERE technician_user_id = $1
       ORDER BY COALESCE(confirmed_date, preferred_date) ASC NULLS LAST`,
      [user.id],
    );
    return result.rows;
  }

  async confirm(
    client: PoolClient,
    id: string,
    technicianUserId: string,
    confirmedDate: string,
  ): Promise<VisitRequest> {
    const visit = await this.findAndLock(client, id);
    if (visit.technician_user_id !== technicianUserId) {
      throw new ForbiddenException('Só o técnico designado pode confirmar esta visita');
    }
    if (visit.status !== 'solicitado') {
      throw new ConflictException('Visita não está aguardando confirmação');
    }

    const result = await client.query<VisitRequest>(
      `UPDATE visit_requests SET status = 'confirmado', confirmed_date = $2 WHERE id = $1 RETURNING *`,
      [id, confirmedDate],
    );
    return result.rows[0];
  }

  async cancel(client: PoolClient, id: string, user: AuthenticatedUser): Promise<VisitRequest> {
    const visit = await this.findAndLock(client, id);
    // RLS já restringe o que é visível: se `user` é empresa e a linha
    // apareceu aqui, é necessariamente do próprio tenant dela.
    const isOwnerEmpresa = user.role === 'empresa';
    const isAssignedTechnician =
      (user.role === 'tecnico' || user.role === 'parceiro') && visit.technician_user_id === user.id;
    if (!isOwnerEmpresa && !isAssignedTechnician) {
      throw new ForbiddenException('Sem permissão para cancelar esta visita');
    }
    if (visit.status !== 'solicitado' && visit.status !== 'confirmado') {
      throw new ConflictException('Visita não pode mais ser cancelada');
    }

    const result = await client.query<VisitRequest>(
      `UPDATE visit_requests SET status = 'cancelado' WHERE id = $1 RETURNING *`,
      [id],
    );
    return result.rows[0];
  }

  async conclude(
    client: PoolClient,
    id: string,
    technicianUserId: string,
    inspectionId: string | undefined,
  ): Promise<VisitRequest> {
    const visit = await this.findAndLock(client, id);
    if (visit.technician_user_id !== technicianUserId) {
      throw new ForbiddenException('Só o técnico designado pode concluir esta visita');
    }
    if (visit.status !== 'confirmado') {
      throw new ConflictException('Visita precisa estar confirmada para ser concluída');
    }

    if (inspectionId) {
      const inspectionResult = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM inspections WHERE id = $1',
        [inspectionId],
      );
      const inspection = inspectionResult.rows[0];
      if (!inspection || inspection.tenant_id !== visit.tenant_id) {
        throw new ForbiddenException('inspection_id inválido para esta visita');
      }
    }

    const result = await client.query<VisitRequest>(
      `UPDATE visit_requests SET status = 'concluido', inspection_id = $2 WHERE id = $1 RETURNING *`,
      [id, inspectionId ?? null],
    );
    return result.rows[0];
  }

  private async findAndLock(client: PoolClient, id: string): Promise<VisitRequest> {
    const result = await client.query<VisitRequest>(
      'SELECT * FROM visit_requests WHERE id = $1 FOR UPDATE',
      [id],
    );
    const visit = result.rows[0];
    if (!visit) throw new NotFoundException('Visita não encontrada');
    return visit;
  }

  private async isTechnicianLinked(
    client: PoolClient,
    tenantId: string,
    technicianUserId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT 1 FROM tenant_technicians tt
       JOIN technicians t ON t.id = tt.technician_id
       WHERE tt.tenant_id = $1 AND t.user_id = $2 AND tt.status = 'ativo'
       UNION
       SELECT 1 FROM tenant_partners tp
       JOIN partners p ON p.id = tp.partner_id
       WHERE tp.tenant_id = $1 AND p.user_id = $2 AND tp.status = 'ativo'`,
      [tenantId, technicianUserId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
```

- [ ] **Step 6: Criar os DTOs**

Criar `backend/src/visits/dto/create-visit.dto.ts`:

```ts
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateVisitDto {
  @IsUUID()
  technician_user_id: string;

  @IsOptional()
  @IsISO8601()
  preferred_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
```

Criar `backend/src/visits/dto/confirm-visit.dto.ts`:

```ts
import { IsISO8601 } from 'class-validator';

export class ConfirmVisitDto {
  @IsISO8601()
  confirmed_date: string;
}
```

Criar `backend/src/visits/dto/conclude-visit.dto.ts`:

```ts
import { IsOptional, IsUUID } from 'class-validator';

export class ConcludeVisitDto {
  @IsOptional()
  @IsUUID()
  inspection_id?: string;
}
```

- [ ] **Step 7: Implementar `VisitsController`**

Criar `backend/src/visits/visits.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { VisitsService } from './visits.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { ConfirmVisitDto } from './dto/confirm-visit.dto';
import { ConcludeVisitDto } from './dto/conclude-visit.dto';

@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateVisitDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.visits.create(client, req.user.tenantId, req.user.id, dto.technician_user_id, dto.preferred_date, dto.motivo),
    );
  }

  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.visits.findAll(client, req.user));
  }

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/confirmar')
  confirmar(@Param('id') id: string, @Body() dto: ConfirmVisitDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.visits.confirm(client, id, req.user.id, dto.confirmed_date),
    );
  }

  @Patch(':id/cancelar')
  cancelar(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.visits.cancel(client, id, req.user));
  }

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/concluir')
  concluir(@Param('id') id: string, @Body() dto: ConcludeVisitDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.visits.conclude(client, id, req.user.id, dto.inspection_id),
    );
  }
}
```

- [ ] **Step 8: Criar `VisitsModule` e registrar em `app.module.ts`**

Criar `backend/src/visits/visits.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

@Module({
  controllers: [VisitsController],
  providers: [VisitsService],
})
export class VisitsModule {}
```

Modificar `backend/src/app.module.ts`: adicionar `import { VisitsModule } from './visits/visits.module';` junto dos outros imports de módulo, e `VisitsModule` na lista `imports` do `@Module({...})`, logo depois de `NormativeModule`.

- [ ] **Step 9: Build e rodar os testes de Create/Confirm**

Run: `docker compose build backend && docker compose up -d backend`
Run: `docker exec montese_backend npm run db:migrate` (deve mostrar `[skip] 0022_visit_requests.sql (já aplicada)` se já rodou no Step 2, senão aplica agora)
Run: `docker exec montese_backend npx jest visits-create-confirm --runInBand`
Expected: PASS em todos os testes.

- [ ] **Step 10: Escrever e rodar os testes de Cancelar/Concluir**

Criar `backend/test/visits-cancel-conclude.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('PATCH /visits/:id/cancelar, /concluir (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let technicianId: string;
  let technicianUserId: string;
  let technicianToken: string;
  let empresaToken: string;
  let otherTechToken: string;
  let visitToCancelId: string;
  let visitToConcludeId: string;
  let inspectionId: string;
  let foreignInspectionId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Visits CancelConclude Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Visits CancelConclude Teste');
    technicianUserId = tech.userId;
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const otherTech = await db.createUserWithRole('tecnico', 'Tecnico Visits Outro Teste');
    await (db as any).client.query('INSERT INTO technicians (user_id) VALUES ($1)', [otherTech.userId]);

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;

    const loginOtherTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: otherTech.email, password: otherTech.password });
    otherTechToken = loginOtherTech.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;

    const visit1 = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: technicianUserId });
    visitToCancelId = visit1.body.id;

    const visit2 = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: technicianUserId });
    visitToConcludeId = visit2.body.id;
    await request(app.getHttpServer())
      .patch(`/visits/${visitToConcludeId}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-09-15' });

    const inspectionResult = await (db as any).client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at) VALUES ($1, $2, '2026-09-15') RETURNING id`,
      [tenantId, technicianUserId],
    );
    inspectionId = inspectionResult.rows[0].id;

    const foreignTenant = await db.createTenantWithUser('Empresa Visits Foreign Inspection Teste');
    const foreignInspectionResult = await (db as any).client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at) VALUES ($1, $2, '2026-09-15') RETURNING id`,
      [foreignTenant.tenantId, technicianUserId],
    );
    foreignInspectionId = foreignInspectionResult.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM inspections WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa cancela visita solicitada → 200, status cancelado', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${visitToCancelId}/cancelar`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelado');
  });

  it('cancelar de novo (já cancelada) → 409', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${visitToCancelId}/cancelar`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(409);
  });

  it('técnico designado conclui visita confirmada com inspection_id válida → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${visitToConcludeId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ inspection_id: inspectionId });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('concluido');
    expect(res.body.inspection_id).toBe(inspectionId);
  });

  it('técnico B (vinculado à mesma empresa) não conclui visita atribuída ao técnico A → 403', async () => {
    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: technicianUserId });
    await request(app.getHttpServer())
      .patch(`/visits/${visit.body.id}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-09-16' });

    const res = await request(app.getHttpServer())
      .patch(`/visits/${visit.body.id}/concluir`)
      .set('Authorization', `Bearer ${otherTechToken}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('concluir com inspection_id de outro tenant → 403 (nunca aceita id sem validar contexto)', async () => {
    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: technicianUserId });
    await request(app.getHttpServer())
      .patch(`/visits/${visit.body.id}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-09-17' });

    const res = await request(app.getHttpServer())
      .patch(`/visits/${visit.body.id}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ inspection_id: foreignInspectionId });

    expect(res.status).toBe(403);
  });
});
```

Run: `docker exec montese_backend npx jest visits-cancel-conclude --runInBand`
Expected: PASS em todos os testes.

- [ ] **Step 11: Escrever e rodar o teste de isolamento RLS**

Criar `backend/test/visits-rls.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('visit_requests — isolamento RLS entre tenants (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let technicianAId: string;
  let technicianUserAId: string;
  let empresaAToken: string;
  let empresaBToken: string;
  let technicianAToken: string;
  let visitInTenantAId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenantA = await db.createTenantWithUser('Empresa Visits RLS A');
    tenantAId = tenantA.tenantId;
    const tenantB = await db.createTenantWithUser('Empresa Visits RLS B');
    tenantBId = tenantB.tenantId;

    const techA = await db.createUserWithRole('tecnico', 'Tecnico Visits RLS A');
    technicianUserAId = techA.userId;
    const techAResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [techA.userId],
    );
    technicianAId = techAResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantAId, technicianAId],
    );

    const loginEmpresaA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    empresaAToken = loginEmpresaA.body.access_token;

    const loginEmpresaB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.email, password: tenantB.password });
    empresaBToken = loginEmpresaB.body.access_token;

    const loginTechA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: techA.email, password: techA.password });
    technicianAToken = loginTechA.body.access_token;

    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaAToken}`)
      .send({ technician_user_id: technicianUserAId });
    visitInTenantAId = visit.body.id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id = $1', [tenantAId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantAId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianAId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa B não vê visita do tenant A na listagem', async () => {
    const res = await request(app.getHttpServer())
      .get('/visits')
      .set('Authorization', `Bearer ${empresaBToken}`);

    expect(res.status).toBe(200);
    expect(res.body.find((v: { id: string }) => v.id === visitInTenantAId)).toBeUndefined();
  });

  it('empresa B tentando cancelar visita do tenant A → 404 (RLS torna invisível, não 403)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${visitInTenantAId}/cancelar`)
      .set('Authorization', `Bearer ${empresaBToken}`);

    expect(res.status).toBe(404);
  });

  it('técnico A (vinculado ao tenant A) confirma normalmente — RLS permite', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${visitInTenantAId}/confirmar`)
      .set('Authorization', `Bearer ${technicianAToken}`)
      .send({ confirmed_date: '2026-09-20' });

    expect(res.status).toBe(200);
  });
});
```

Run: `docker exec montese_backend npx jest visits-rls --runInBand`
Expected: PASS em todos os testes.

- [ ] **Step 12: Rodar a suíte e2e completa e commitar**

Run: `docker exec montese_backend npx jest --runInBand`
Expected: todas as suítes passando, incluindo as 3 novas.

```bash
git add backend/db/migrations/0022_visit_requests.sql backend/src/visits backend/src/app.module.ts backend/test/visits-create-confirm.e2e-spec.ts backend/test/visits-cancel-conclude.e2e-spec.ts backend/test/visits-rls.e2e-spec.ts
git commit -m "feat: agenda de visitas — solicitar/confirmar/cancelar/concluir (Fase 11)"
```

---

## Task 2: TechnicianAgendaService + GET /visits/me/day

**Files:**
- Create: `backend/src/visits/technician-agenda.service.ts`
- Modify: `backend/src/visits/visits.controller.ts` (adicionar rota `me/day`)
- Modify: `backend/src/visits/visits.module.ts` (importar `DashboardModule`, `TenantTechniciansModule`; registrar `TechnicianAgendaService`)
- Modify: `backend/src/tenant-technicians/tenant-technicians.module.ts` (exportar `TenantTechniciansService` — hoje não exportado, mesmo tipo de ajuste já feito em `DashboardModule` na Fase 10)
- Test: `backend/test/technician-agenda.e2e-spec.ts`

**Interfaces:**
- Consumes: `VisitRequest` (Task 1, `visits.service.ts`). `DashboardService.getSummary(client, tenantId): Promise<DashboardSummary>` (já existe, `backend/src/dashboard/dashboard.service.ts` — **não modificar**). `TenantTechniciansService.findMyTenants(client, userId, role): Promise<LinkedTenant[]>` (já existe, `backend/src/tenant-technicians/tenant-technicians.service.ts` — **não modificar**, só passa a ser exportado do módulo).
- Produces: `MyDayResult` (interface, exportada de `technician-agenda.service.ts`) — `{ visitas: { proximas: VisitRequest[], pendentes_de_confirmar: VisitRequest[] }, empresas: { tenant_id: string, tenant_name: string, resumo: DashboardSummary }[] }`. `TechnicianAgendaService.getMyDay(client, user): Promise<MyDayResult>`.

- [ ] **Step 1: Escrever o teste que falha primeiro — isolamento entre duas empresas vinculadas ao mesmo técnico**

Criar `backend/test/technician-agenda.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /visits/me/day (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let technicianId: string;
  let technicianUserId: string;
  let technicianToken: string;
  let empresaAToken: string;
  let confirmedVisitId: string;
  let pendingVisitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenantA = await db.createTenantWithUser('Empresa MeuDia A Teste');
    tenantAId = tenantA.tenantId;
    const tenantB = await db.createTenantWithUser('Empresa MeuDia B Teste');
    tenantBId = tenantB.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico MeuDia Teste');
    technicianUserId = tech.userId;
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2), ($3, $2)',
      [tenantAId, technicianId, tenantBId],
    );

    // Pendência real na empresa A (documento vencido) — DashboardService já
    // sabe transformar isso em item de `atencao`, reaproveitado sem mudança.
    await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR vencido teste Meu Dia', 'fixture/meudia.pdf', 'meudia.pdf', 'application/pdf', 100, CURRENT_DATE - INTERVAL '5 days', $2, 'empresa')`,
      [tenantAId, tenantA.userId],
    );

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;

    const loginEmpresaA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    empresaAToken = loginEmpresaA.body.access_token;

    const visit1 = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaAToken}`)
      .send({ technician_user_id: technicianUserId, preferred_date: '2026-09-05' });
    confirmedVisitId = visit1.body.id;
    await request(app.getHttpServer())
      .patch(`/visits/${confirmedVisitId}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) });

    const visit2 = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaAToken}`)
      .send({ technician_user_id: technicianUserId });
    pendingVisitId = visit2.body.id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM documents WHERE tenant_id = $1', [tenantAId]);
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id IN ($1, $2)', [tenantAId, tenantBId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE technician_id = $1', [technicianId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('agrega visitas confirmadas/pendentes e pendências das duas empresas vinculadas, isoladas por empresa', async () => {
    const res = await request(app.getHttpServer())
      .get('/visits/me/day')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    expect(res.body.visitas.proximas.map((v: { id: string }) => v.id)).toContain(confirmedVisitId);
    expect(res.body.visitas.pendentes_de_confirmar.map((v: { id: string }) => v.id)).toContain(pendingVisitId);

    expect(res.body.empresas).toHaveLength(2);
    const empresaA = res.body.empresas.find((e: { tenant_id: string }) => e.tenant_id === tenantAId);
    const empresaB = res.body.empresas.find((e: { tenant_id: string }) => e.tenant_id === tenantBId);
    expect(empresaA.resumo.resumo.pendencias).toBe(1);
    expect(empresaB.resumo.resumo.pendencias).toBe(0);
  });

  it('empresa não acessa /visits/me/day (403 — rota é só de técnico/parceiro)', async () => {
    const res = await request(app.getHttpServer())
      .get('/visits/me/day')
      .set('Authorization', `Bearer ${empresaAToken}`);

    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `docker exec montese_backend npx jest technician-agenda --runInBand`
Expected: FAIL — rota `/visits/me/day` ainda não existe (404).

- [ ] **Step 3: Exportar `TenantTechniciansService` do seu módulo**

Modificar `backend/src/tenant-technicians/tenant-technicians.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TenantTechniciansController } from './tenant-technicians.controller';
import { TenantTechniciansService } from './tenant-technicians.service';

@Module({
  controllers: [TenantTechniciansController],
  providers: [TenantTechniciansService],
  exports: [TenantTechniciansService],
})
export class TenantTechniciansModule {}
```

- [ ] **Step 4: Implementar `TechnicianAgendaService`**

Criar `backend/src/visits/technician-agenda.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuthenticatedUser } from '../common/types';
import { DashboardService, DashboardSummary } from '../dashboard/dashboard.service';
import { TenantTechniciansService } from '../tenant-technicians/tenant-technicians.service';
import { VisitRequest } from './visits.service';

export interface MyDayEmpresaSummary {
  tenant_id: string;
  tenant_name: string;
  resumo: DashboardSummary;
}

export interface MyDayResult {
  visitas: {
    proximas: VisitRequest[];
    pendentes_de_confirmar: VisitRequest[];
  };
  empresas: MyDayEmpresaSummary[];
}

@Injectable()
export class TechnicianAgendaService {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly tenantTechnicians: TenantTechniciansService,
  ) {}

  async getMyDay(client: PoolClient, user: AuthenticatedUser): Promise<MyDayResult> {
    const proximasResult = await client.query<VisitRequest>(
      `SELECT * FROM visit_requests
       WHERE technician_user_id = $1 AND status = 'confirmado'
         AND confirmed_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
       ORDER BY confirmed_date ASC`,
      [user.id],
    );
    const pendentesResult = await client.query<VisitRequest>(
      `SELECT * FROM visit_requests WHERE technician_user_id = $1 AND status = 'solicitado'
       ORDER BY created_at ASC`,
      [user.id],
    );

    const tenants = await this.tenantTechnicians.findMyTenants(
      client,
      user.id,
      user.role as 'tecnico' | 'parceiro',
    );

    // Sequencial, não Promise.all: cada tenant faz múltiplas subconsultas
    // no mesmo client (o próprio DashboardService.getSummary já roda 4
    // queries em paralelo internamente) — encadear N desses em paralelo no
    // mesmo client soma ao aviso de depreciação do node-postgres sobre
    // client.query concorrente sem necessidade real (nenhuma chamada
    // externa envolvida aqui, só Postgres — não há ganho de latência que
    // justifique o risco).
    const empresas: MyDayEmpresaSummary[] = [];
    for (const tenant of tenants) {
      const resumo = await this.dashboard.getSummary(client, tenant.tenant_id);
      empresas.push({ tenant_id: tenant.tenant_id, tenant_name: tenant.tenant_name, resumo });
    }

    return {
      visitas: { proximas: proximasResult.rows, pendentes_de_confirmar: pendentesResult.rows },
      empresas,
    };
  }
}
```

- [ ] **Step 5: Adicionar a rota no `VisitsController`**

Modificar `backend/src/visits/visits.controller.ts` — substituir o arquivo inteiro pelo conteúdo abaixo (acrescenta o import, o segundo parâmetro do construtor e o método `myDay`; os cinco métodos de Task 1 continuam idênticos):

```ts
import { Body, Controller, Get, Param, Patch, Post, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { VisitsService } from './visits.service';
import { TechnicianAgendaService } from './technician-agenda.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { ConfirmVisitDto } from './dto/confirm-visit.dto';
import { ConcludeVisitDto } from './dto/conclude-visit.dto';

@Controller('visits')
export class VisitsController {
  constructor(
    private readonly visits: VisitsService,
    private readonly agenda: TechnicianAgendaService,
  ) {}

  @Roles('empresa')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateVisitDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.visits.create(client, req.user.tenantId, req.user.id, dto.technician_user_id, dto.preferred_date, dto.motivo),
    );
  }

  @Roles('tecnico', 'parceiro')
  @Get('me/day')
  myDay(@Req() req: any) {
    return req.withTenantContext((client: any) => this.agenda.getMyDay(client, req.user));
  }

  @Get()
  findAll(@Req() req: any) {
    return req.withTenantContext((client: any) => this.visits.findAll(client, req.user));
  }

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/confirmar')
  confirmar(@Param('id') id: string, @Body() dto: ConfirmVisitDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.visits.confirm(client, id, req.user.id, dto.confirmed_date),
    );
  }

  @Patch(':id/cancelar')
  cancelar(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.visits.cancel(client, id, req.user));
  }

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/concluir')
  concluir(@Param('id') id: string, @Body() dto: ConcludeVisitDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.visits.conclude(client, id, req.user.id, dto.inspection_id),
    );
  }
}
```

**Atenção de ordem de rotas:** `@Get('me/day')` precisa ser registrado ANTES de qualquer rota `@Get(':id')` neste controller — como este controller não tem `@Get(':id')` (só `@Get()` sem parâmetro pra listagem), não há conflito, mas fica registrado aqui porque é a mesma armadilha que já apareceu noutros controllers deste projeto (rota fixa depois de rota com parâmetro captura por engano).

- [ ] **Step 6: Atualizar `VisitsModule`**

Modificar `backend/src/visits/visits.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { TechnicianAgendaService } from './technician-agenda.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { TenantTechniciansModule } from '../tenant-technicians/tenant-technicians.module';

@Module({
  imports: [DashboardModule, TenantTechniciansModule],
  controllers: [VisitsController],
  providers: [VisitsService, TechnicianAgendaService],
})
export class VisitsModule {}
```

- [ ] **Step 7: Build e rodar os testes**

Run: `docker compose build backend && docker compose up -d backend`
Run: `docker exec montese_backend npx jest technician-agenda --runInBand`
Expected: PASS em todos os testes.

- [ ] **Step 8: Rodar a suíte completa e commitar**

Run: `docker exec montese_backend npx jest --runInBand`
Expected: todas as suítes passando.

```bash
git add backend/src/visits backend/src/tenant-technicians/tenant-technicians.module.ts backend/test/technician-agenda.e2e-spec.ts
git commit -m "feat: Meu Dia do técnico — agenda + pendências agregadas por empresa (Fase 11)"
```

---

## Task 3: VisitReminderCron (lembrete por e-mail)

**Files:**
- Create: `backend/src/visits/visit-reminder.cron.ts`
- Modify: `backend/src/visits/visits.module.ts` (registrar o cron como provider)
- Test: `backend/test/visit-reminder-cron.e2e-spec.ts`

**Interfaces:**
- Consumes: `EmailService.send(input: { to: string, subject: string, html: string }): Promise<void>` (já existe, `backend/src/common/email/email.service.ts`, `EmailModule` é `@Global()` — não precisa import explícito no `VisitsModule`). `VisitRequest` (Task 1).
- Produces: `VisitReminderCronService` (classe, injetável) com `runOnce(): Promise<void>` — método separado do `@Cron`, mesmo padrão de `NormativeMonitorService.runOnce()` (`backend/src/normative/normative-monitor.service.ts:51`), pra o teste poder chamar diretamente sem esperar o cron real disparar.

- [ ] **Step 1: Escrever o teste que falha primeiro**

Criar `backend/test/visit-reminder-cron.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { VisitReminderCronService } from '../src/visits/visit-reminder.cron';
import { EmailService } from '../src/common/email/email.service';
import { TestDb } from './db-test-helper';

describe('VisitReminderCronService.runOnce (e2e)', () => {
  let db: TestDb;
  let tenantId: string;
  let tenantEmail: string;
  let technicianId: string;
  let technicianUserId: string;
  let technicianEmail: string;
  let sendSpy: jest.SpyInstance;
  let cron: VisitReminderCronService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    cron = moduleRef.get(VisitReminderCronService);
    const emailService = moduleRef.get(EmailService);
    sendSpy = jest.spyOn(emailService, 'send').mockResolvedValue(undefined);

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Visits Reminder Teste');
    tenantId = tenant.tenantId;
    tenantEmail = tenant.email;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Visits Reminder Teste');
    technicianUserId = tech.userId;
    technicianEmail = tech.email;
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    // Visita confirmada pra amanhã — deve gerar lembrete.
    await (db as any).client.query(
      `INSERT INTO visit_requests (tenant_id, technician_user_id, requested_by_user_id, status, confirmed_date)
       VALUES ($1, $2, $3, 'confirmado', CURRENT_DATE + INTERVAL '1 day')`,
      [tenantId, technicianUserId, tenant.userId],
    );
    // Visita confirmada pra depois de amanhã — NÃO deve gerar lembrete.
    await (db as any).client.query(
      `INSERT INTO visit_requests (tenant_id, technician_user_id, requested_by_user_id, status, confirmed_date)
       VALUES ($1, $2, $3, 'confirmado', CURRENT_DATE + INTERVAL '2 days')`,
      [tenantId, technicianUserId, tenant.userId],
    );
    // Visita solicitada (não confirmada) pra amanhã — NÃO deve gerar lembrete.
    await (db as any).client.query(
      `INSERT INTO visit_requests (tenant_id, technician_user_id, requested_by_user_id, status, preferred_date)
       VALUES ($1, $2, $3, 'solicitado', CURRENT_DATE + INTERVAL '1 day')`,
      [tenantId, technicianUserId, tenant.userId],
    );
  });

  afterAll(async () => {
    sendSpy.mockRestore();
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
  });

  it('dispara e-mail pra empresa e técnico só da visita confirmada de amanhã, não das outras', async () => {
    await cron.runOnce();

    expect(sendSpy).toHaveBeenCalledTimes(2);
    const recipients = sendSpy.mock.calls.map((call) => call[0].to).sort();
    expect(recipients).toEqual([tenantEmail, technicianEmail].sort());
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `docker exec montese_backend npx jest visit-reminder-cron --runInBand`
Expected: FAIL — `VisitReminderCronService` não existe ainda (erro de módulo não encontrado / provider não encontrado no `moduleRef.get`).

- [ ] **Step 3: Implementar `VisitReminderCronService`**

Criar `backend/src/visits/visit-reminder.cron.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseService } from '../common/database/database.service';
import { EmailService } from '../common/email/email.service';

interface ReminderRow {
  id: string;
  tenant_id: string;
  tenant_name: string;
  technician_user_id: string;
  technician_email: string;
  requested_by_email: string;
  confirmed_date: string;
}

@Injectable()
export class VisitReminderCronService {
  private readonly logger = new Logger(VisitReminderCronService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly email: EmailService,
  ) {}

  @Cron('0 8 * * *')
  async handleCron(): Promise<void> {
    await this.runOnce();
  }

  // Job de sistema, sem usuário autenticado — mesmo padrão de
  // NormativeMonitorService.runOnce (terceiro caso de withoutTenantContext
  // já documentado em DatabaseService).
  async runOnce(): Promise<void> {
    const { rows } = await this.db.withoutTenantContext((client) =>
      client.query<ReminderRow>(
        `SELECT vr.id, vr.tenant_id, t.name AS tenant_name, vr.technician_user_id,
                tech_user.email AS technician_email, req_user.email AS requested_by_email,
                vr.confirmed_date
         FROM visit_requests vr
         JOIN tenants t ON t.id = vr.tenant_id
         JOIN users tech_user ON tech_user.id = vr.technician_user_id
         JOIN users req_user ON req_user.id = vr.requested_by_user_id
         WHERE vr.status = 'confirmado' AND vr.confirmed_date = CURRENT_DATE + INTERVAL '1 day'`,
      ),
    );

    for (const row of rows) {
      try {
        await this.email.send({
          to: row.requested_by_email,
          subject: 'Visita técnica confirmada amanhã',
          html: `<p>Sua visita técnica com ${row.technician_email} está confirmada para amanhã (${row.confirmed_date}).</p>`,
        });
      } catch (err) {
        this.logger.error(`Falha ao enviar lembrete (empresa) pra visita ${row.id}`, (err as Error).stack);
      }

      try {
        await this.email.send({
          to: row.technician_email,
          subject: 'Você tem visita confirmada amanhã',
          html: `<p>Você tem uma visita confirmada amanhã (${row.confirmed_date}) na empresa ${row.tenant_name}.</p>`,
        });
      } catch (err) {
        this.logger.error(`Falha ao enviar lembrete (técnico) pra visita ${row.id}`, (err as Error).stack);
      }
    }
  }
}
```

- [ ] **Step 4: Registrar o provider**

Modificar `backend/src/visits/visits.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { TechnicianAgendaService } from './technician-agenda.service';
import { VisitReminderCronService } from './visit-reminder.cron';
import { DashboardModule } from '../dashboard/dashboard.module';
import { TenantTechniciansModule } from '../tenant-technicians/tenant-technicians.module';

@Module({
  imports: [DashboardModule, TenantTechniciansModule],
  controllers: [VisitsController],
  providers: [VisitsService, TechnicianAgendaService, VisitReminderCronService],
})
export class VisitsModule {}
```

- [ ] **Step 5: Build e rodar o teste**

Run: `docker compose build backend && docker compose up -d backend`
Run: `docker exec montese_backend npx jest visit-reminder-cron --runInBand`
Expected: PASS.

- [ ] **Step 6: Rodar a suíte completa, migração no-op e commitar**

Run: `docker exec montese_backend npm run db:migrate` (deve mostrar tudo `[skip] ... (já aplicada)`)
Run: `docker exec montese_backend npx jest --runInBand`
Expected: todas as suítes passando (contagem final deve ser a suíte anterior + as 4 novas: `visits-create-confirm`, `visits-cancel-conclude`, `visits-rls`, `technician-agenda`, `visit-reminder-cron` — 5 novas suítes no total desta fase).

```bash
git add backend/src/visits/visit-reminder.cron.ts backend/src/visits/visits.module.ts backend/test/visit-reminder-cron.e2e-spec.ts
git commit -m "feat: lembrete por e-mail no dia anterior à visita confirmada (Fase 11)"
```

---

## Depois da última task

1. Atualizar `docs/specs/fase-11-agenda-visitas.md` seção 5 pra refletir a rota real (`GET /visits/me/day`, não `GET /technicians/me/day`) — mantém spec e código consistentes, mesma disciplina já aplicada nas Fases 9/10.
2. Atualizar `docs/roadmap.md` com o status da Fase 11 (mesmo formato das entradas de Fase 9/10).
3. Seguir com `superpowers:finishing-a-development-branch` — mesmo fluxo já usado nas Fases 9/10 (verificar suíte completa, detectar ambiente, apresentar opções de merge/PR).

Nenhuma chamada à API paga envolvida nesta fase (sem IA) — não há validação "real contra API paga" a fazer como nas Fases 9/10; a suíte e2e contra Postgres real já é a validação de ponta a ponta suficiente aqui.
