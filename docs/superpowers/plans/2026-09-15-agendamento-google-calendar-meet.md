# Agendamento de Reunião/Visita (Google Calendar + Meet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que uma empresa peça uma reunião (virtual, Google Meet) ou visita (presencial, numa filial) ao técnico/parceiro vinculado, o técnico confirme (podendo propor outro horário), e o compromisso confirmado apareça automaticamente no Google Calendar pessoal do técnico.

**Architecture:** Estende `visit_requests` — tabela e módulo backend (`backend/src/visits/`) já existentes desde a Fase 11, nunca ligados a nenhum frontend — com tipo/horário/filial e uma integração nova de Google Calendar/Meet via OAuth por técnico (token criptografado em repouso). O evento no Google é criado automaticamente dentro de `VisitsService.confirm()`, nunca bloqueando a confirmação se o Google falhar. Frontend novo dos dois lados (técnico e empresa).

**Tech Stack:** NestJS + PostgreSQL (RLS) + `pg`, Next.js App Router, `google-auth-library` (OAuth2Client — não o pacote `googleapis` completo, mais pesado e com centenas de APIs não usadas; a Calendar API em si é chamada via `fetch` nativo, mesmo padrão já usado pelo projeto pra OpenRouter), Jest e2e reais contra Postgres/Redis reais.

**Spec:** `docs/specs/agendamento-google-calendar-meet.md`

## Global Constraints

- OAuth individual por técnico — cada técnico conecta sua própria conta Google, nunca uma conta de serviço única da Montese.
- Empresa solicita, técnico confirma — o técnico pode confirmar uma data/hora **diferente** da sugerida pela empresa.
- `type` é `'reuniao'` (vídeo, gera Meet) ou `'visita'` (presencial, exige `company_unit_id`, nunca gera Meet).
- Evento no Google Calendar é criado **automaticamente** ao confirmar — nunca um botão separado.
- Falha ao criar o evento no Google **nunca** impede a confirmação no Montese (try/catch que só loga via `Logger`, nunca `console.*`).
- Só técnico conecta Google nesta fase — parceiro confirma normalmente, sem gerar evento.
- Sem sincronização de volta — cancelar/reagendar depois de confirmado não atualiza nem apaga o evento no Google.
- Renomear rótulo do menu do técnico "Agenda" → "Vencimentos" (rota `/tecnico/agenda` continua igual); "Agenda" passa a apontar pra tela nova de compromissos.
- Refresh token do Google é a primeira credencial de terceiro armazenada neste banco — precisa de criptografia em repouso (AES-256-GCM), nunca logado, nunca devolvido em nenhuma resposta de API.
- Nenhuma chamada real ao Google em testes automatizados — `GoogleCalendarClient` é uma interface com provider token (`Symbol`), mesmo padrão já usado em `FIELD_REPORT_EXTRACTOR`/`DOCUMENT_CLASSIFIER_PROVIDER`/`LIP_AGENT_EXTRACTION_PROVIDER` — testes fazem `overrideProvider(GOOGLE_CALENDAR_CLIENT).useValue({...})`.

## Pré-requisito de ambiente

Mesma nota já usada nas fases anteriores desta sessão: se `/opt/Montese/run-backend-tests.sh` não existir, recrie-o:

```bash
#!/bin/bash
set -e
cd "$(dirname "$0")/backend"
set -a; source ../.env; set +a
export DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@localhost:5432/${POSTGRES_DB}"
export REDIS_URL="redis://localhost:6379"
export AUTH_RATE_LIMIT_MAX=1000
export AUTH_RATE_LIMIT_WINDOW_SECONDS=1
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm use 20 > /dev/null
export NODE_OPTIONS=--experimental-vm-modules
npx "$@"
```

Pra rodar testes e2e, exponha Postgres/Redis em localhost com um overlay efêmero (nunca crie `docker-compose.override.yml`):

```yaml
# docker-compose.dev-redis-temp.yml
services:
  postgres:
    ports:
      - "127.0.0.1:5432:5432"
  redis:
    ports:
      - "127.0.0.1:6379:6379"
```

```bash
docker compose -f docker-compose.yml -f docker-compose.dev-redis-temp.yml up -d postgres redis
# ... rodar testes ...
rm docker-compose.dev-redis-temp.yml && docker compose up -d postgres redis
```

## Pré-requisito externo (fora deste ambiente — ação do fundador)

Antes da Task 2 (ou de rodar em produção), o fundador precisa criar, no [Google Cloud Console](https://console.cloud.google.com/), um projeto com:

1. Tela de consentimento OAuth (OAuth consent screen) — tipo "External", com o app em modo "Testing" ou publicado.
2. Credencial "OAuth 2.0 Client ID", tipo **Web application**.
3. **Authorized redirect URI**: `https://montesesst.com.br/api/google-calendar/callback` (exatamente essa URL — é a que o backend usa no fluxo de troca de código).
4. Scope necessário: `https://www.googleapis.com/auth/calendar.events`.

O `.env` de produção precisa ganhar 3 variáveis novas antes do deploy da Task 2:

```
GOOGLE_CLIENT_ID=<client id do passo 2>
GOOGLE_CLIENT_SECRET=<client secret do passo 2>
GOOGLE_TOKEN_ENCRYPTION_KEY=<gerado com: openssl rand -hex 32>
```

Sem essas variáveis, `GoogleCalendarService` ainda funciona em testes (usa fallback de dev, mesmo padrão de `R2Service`), mas a conexão real com o Google não funciona em produção até o fundador configurar isso.

---

### Task 1: Modelo de dados — tipo/horário/filial em `visit_requests` + endpoint de técnicos da empresa

**Files:**
- Create: `backend/db/migrations/0047_visit_scheduling_fields.sql`
- Modify: `backend/src/visits/dto/create-visit.dto.ts`
- Modify: `backend/src/visits/dto/confirm-visit.dto.ts`
- Modify: `backend/src/visits/visits.service.ts`
- Modify: `backend/src/visits/visits.controller.ts`
- Modify: `backend/src/tenant-technicians/tenant-technicians.service.ts`
- Modify: `backend/src/tenant-technicians/tenant-technicians.controller.ts`
- Test: `backend/test/visits-scheduling.e2e-spec.ts` (novo)
- Test: `backend/test/tenant-technicians-minha-empresa.e2e-spec.ts` (novo)

**Interfaces:**
- Consumes: nada de tasks anteriores (task inicial).
- Produces: `VisitRequest` ganha `type: 'reuniao' | 'visita'`, `preferred_time: string | null`, `confirmed_time: string | null`, `company_unit_id: string | null` (usados pela Task 3 na integração com Google e pelas Tasks 4/5 no frontend). `TenantTechniciansService.findMyTechnicians(client, tenantId): Promise<{ user_id: string; full_name: string; role: 'tecnico' | 'parceiro' }[]>` (consumido pela Task 5).

- [ ] **Step 1: Ler os arquivos reais atuais**

Leia por completo `backend/src/visits/visits.service.ts`, `backend/src/visits/visits.controller.ts`, `backend/src/visits/dto/create-visit.dto.ts`, `backend/src/visits/dto/confirm-visit.dto.ts`, `backend/src/tenant-technicians/tenant-technicians.service.ts`, `backend/src/tenant-technicians/tenant-technicians.controller.ts`. Se algo divergir deste plano, o código real vence.

- [ ] **Step 2: Migration**

`backend/db/migrations/0047_visit_scheduling_fields.sql`:

```sql
-- Agendamento de Reunião/Visita (Google Calendar + Meet): visit_requests
-- já existe desde a Fase 11 (empresa solicita, técnico confirma), mas
-- nunca teve tipo, horário do dia nem filial. Todas as colunas são
-- nullable/com default — não quebra as visitas já existentes em
-- produção, que continuam implicitamente "visita" sem horário.
ALTER TABLE visit_requests ADD COLUMN type TEXT NOT NULL DEFAULT 'visita'
  CHECK (type IN ('reuniao', 'visita'));
ALTER TABLE visit_requests ADD COLUMN preferred_time TIME;
ALTER TABLE visit_requests ADD COLUMN confirmed_time TIME;
ALTER TABLE visit_requests ADD COLUMN company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL;
ALTER TABLE visit_requests ADD COLUMN google_event_id TEXT;
ALTER TABLE visit_requests ADD COLUMN google_meet_link TEXT;
```

- [ ] **Step 3: Rodar a migration**

Exponha Postgres (ver "Pré-requisito de ambiente").

Run: `cd /opt/Montese/backend && npm run db:migrate`
Expected: `[applied] 0047_visit_scheduling_fields.sql` (ou equivalente — confira a saída real do script).

- [ ] **Step 4: Escrever o teste e2e ANTES de mudar o DTO/service (TDD)**

`backend/test/visits-scheduling.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /visits — tipo/horário/filial (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let empresaToken: string;
  let technicianUserId: string;
  let technicianToken: string;
  let companyUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Agendamento Teste');
    tenantId = tenant.tenantId;
    const empresaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = empresaLogin.body.access_token;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Agendamento Teste');
    technicianUserId = tech.userId;
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, techResult.rows[0].id],
    );
    const techLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = techLogin.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE user_id = $1', [technicianUserId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cria pedido de visita com filial obrigatória', async () => {
    const res = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'visita',
        preferred_date: '2026-10-01',
        preferred_time: '14:00',
        company_unit_id: companyUnitId,
        motivo: 'Inspeção trimestral',
      });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('visita');
    expect(res.body.preferred_time).toBe('14:00');
    expect(res.body.company_unit_id).toBe(companyUnitId);
  });

  it('rejeita pedido de visita sem filial', async () => {
    const res = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'visita',
        preferred_date: '2026-10-01',
      });

    expect(res.status).toBe(400);
  });

  it('cria pedido de reunião sem exigir filial', async () => {
    const res = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'reuniao',
        preferred_date: '2026-10-02',
        preferred_time: '10:00',
        motivo: 'Dúvidas sobre PGR',
      });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('reuniao');
    expect(res.body.company_unit_id).toBeNull();
  });

  it('técnico confirma com horário diferente do sugerido', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'reuniao',
        preferred_date: '2026-10-03',
        preferred_time: '09:00',
        motivo: 'Reunião de alinhamento',
      });
    const visitId = createRes.body.id;

    const confirmRes = await request(app.getHttpServer())
      .patch(`/visits/${visitId}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-10-04', confirmed_time: '15:30' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('confirmado');
    expect(confirmRes.body.confirmed_date.slice(0, 10)).toBe('2026-10-04');
    expect(confirmRes.body.confirmed_time).toBe('15:30');
  });
});
```

- [ ] **Step 5: Rodar e confirmar que falha**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "visits-scheduling"`
Expected: FAIL — `type`/`preferred_time`/`company_unit_id` não existem no DTO ainda (erro de `forbidNonWhitelisted` ou undefined no body de resposta).

- [ ] **Step 6: Estender os DTOs**

`backend/src/visits/dto/create-visit.dto.ts` (reescreva o arquivo completo):

```typescript
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

export class CreateVisitDto {
  @IsUUID()
  technician_user_id: string;

  @IsIn(['reuniao', 'visita'])
  type: 'reuniao' | 'visita';

  @IsOptional()
  @IsISO8601()
  preferred_date?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'preferred_time deve estar no formato HH:MM' })
  preferred_time?: string;

  @ValidateIf((dto) => dto.type === 'visita')
  @IsUUID()
  company_unit_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
```

`backend/src/visits/dto/confirm-visit.dto.ts` (reescreva o arquivo completo):

```typescript
import { IsISO8601, IsOptional, Matches } from 'class-validator';

export class ConfirmVisitDto {
  @IsISO8601()
  confirmed_date: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'confirmed_time deve estar no formato HH:MM' })
  confirmed_time?: string;
}
```

- [ ] **Step 7: Estender `VisitsService`**

Em `backend/src/visits/visits.service.ts`, atualize a interface `VisitRequest` e os métodos `create`/`confirm`. Reescreva o arquivo completo:

```typescript
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AuthenticatedUser } from '../common/types';

export interface VisitRequest {
  id: string;
  tenant_id: string;
  technician_user_id: string;
  requested_by_user_id: string;
  status: 'solicitado' | 'confirmado' | 'concluido' | 'cancelado';
  type: 'reuniao' | 'visita';
  preferred_date: string | null;
  preferred_time: string | null;
  confirmed_date: string | null;
  confirmed_time: string | null;
  company_unit_id: string | null;
  google_event_id: string | null;
  google_meet_link: string | null;
  motivo: string | null;
  inspection_id: string | null;
  created_at: string;
  updated_at: string;
}

// Colunas `date`/`time` do Postgres chegam via node-pg como objeto Date
// ou string "HH:MM:SS" — mesma armadilha já documentada em várias fases
// deste projeto (dashboard.service.ts, inspections.service.ts). Normaliza
// os 4 campos sensíveis a formato antes de qualquer VisitRequest sair
// pro controller.
export function toDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

export function toTimeString(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 5);
}

export function normalizeVisit(row: VisitRequest): VisitRequest {
  return {
    ...row,
    preferred_date: toDateString(row.preferred_date),
    confirmed_date: toDateString(row.confirmed_date),
    preferred_time: toTimeString(row.preferred_time),
    confirmed_time: toTimeString(row.confirmed_time),
  };
}

@Injectable()
export class VisitsService {
  private async assertCompanyUnitBelongsToTenant(
    client: PoolClient,
    companyUnitId: string,
    tenantId: string,
  ): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (result.rowCount === 0) throw new NotFoundException('Filial não encontrada');
  }

  async create(
    client: PoolClient,
    tenantId: string,
    requestedByUserId: string,
    technicianUserId: string,
    type: 'reuniao' | 'visita',
    preferredDate: string | undefined,
    preferredTime: string | undefined,
    companyUnitId: string | undefined,
    motivo: string | undefined,
  ): Promise<VisitRequest> {
    const linked = await this.isTechnicianLinked(client, tenantId, technicianUserId);
    if (!linked) {
      throw new ForbiddenException('Técnico não está vinculado a esta empresa');
    }
    if (type === 'visita' && companyUnitId) {
      await this.assertCompanyUnitBelongsToTenant(client, companyUnitId, tenantId);
    }

    const result = await client.query<VisitRequest>(
      `INSERT INTO visit_requests
         (tenant_id, technician_user_id, requested_by_user_id, type, preferred_date, preferred_time, company_unit_id, motivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        tenantId,
        technicianUserId,
        requestedByUserId,
        type,
        preferredDate ?? null,
        preferredTime ?? null,
        type === 'visita' ? (companyUnitId ?? null) : null,
        motivo ?? null,
      ],
    );
    return normalizeVisit(result.rows[0]);
  }

  async findAll(client: PoolClient, user: AuthenticatedUser): Promise<VisitRequest[]> {
    if (user.role === 'admin') {
      const result = await client.query<VisitRequest>(
        `SELECT * FROM visit_requests
         ORDER BY COALESCE(confirmed_date, preferred_date) ASC NULLS LAST`,
      );
      return result.rows.map(normalizeVisit);
    }
    if (user.role === 'empresa') {
      const result = await client.query<VisitRequest>(
        `SELECT * FROM visit_requests WHERE tenant_id = $1
         ORDER BY COALESCE(confirmed_date, preferred_date) ASC NULLS LAST`,
        [user.tenantId],
      );
      return result.rows.map(normalizeVisit);
    }
    const result = await client.query<VisitRequest>(
      `SELECT * FROM visit_requests WHERE technician_user_id = $1
       ORDER BY COALESCE(confirmed_date, preferred_date) ASC NULLS LAST`,
      [user.id],
    );
    return result.rows.map(normalizeVisit);
  }

  async confirm(
    client: PoolClient,
    id: string,
    technicianUserId: string,
    confirmedDate: string,
    confirmedTime: string | undefined,
  ): Promise<VisitRequest> {
    const visit = await this.findAndLock(client, id);
    if (visit.technician_user_id !== technicianUserId) {
      throw new ForbiddenException('Só o técnico designado pode confirmar esta visita');
    }
    if (visit.status !== 'solicitado') {
      throw new ConflictException('Visita não está aguardando confirmação');
    }

    const result = await client.query<VisitRequest>(
      `UPDATE visit_requests SET status = 'confirmado', confirmed_date = $2, confirmed_time = $3
       WHERE id = $1 RETURNING *`,
      [id, confirmedDate, confirmedTime ?? null],
    );
    return normalizeVisit(result.rows[0]);
  }

  async cancel(client: PoolClient, id: string, user: AuthenticatedUser): Promise<VisitRequest> {
    const visit = await this.findAndLock(client, id);
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
    return normalizeVisit(result.rows[0]);
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
    return normalizeVisit(result.rows[0]);
  }

  async setGoogleEvent(
    client: PoolClient,
    id: string,
    googleEventId: string,
    googleMeetLink: string | null,
  ): Promise<void> {
    await client.query(
      `UPDATE visit_requests SET google_event_id = $2, google_meet_link = $3 WHERE id = $1`,
      [id, googleEventId, googleMeetLink],
    );
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

Note: `setGoogleEvent` é o método que a Task 3 vai chamar — já incluído aqui pra não precisar reabrir este arquivo depois, mas não é chamado por ninguém ainda nesta task (fica sem uso até a Task 3, o que é esperado e não gera erro de compilação).

- [ ] **Step 8: Atualizar o controller**

Em `backend/src/visits/visits.controller.ts`, atualize as chamadas de `create`/`confirmar` pra passar os campos novos. Reescreva o arquivo completo:

```typescript
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
      this.visits.create(
        client,
        req.user.tenantId,
        req.user.id,
        dto.technician_user_id,
        dto.type,
        dto.preferred_date,
        dto.preferred_time,
        dto.company_unit_id,
        dto.motivo,
      ),
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
      this.visits.confirm(client, id, req.user.id, dto.confirmed_date, dto.confirmed_time),
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

- [ ] **Step 9: Rodar e confirmar que os 4 testes de `visits-scheduling` passam**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "visits-scheduling"`
Expected: `4 passed`.

- [ ] **Step 10: Endpoint novo — empresa lista seus técnicos/parceiros**

Escreva o teste primeiro. `backend/test/tenant-technicians-minha-empresa.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /tenant-technicians/minha-empresa (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let empresaToken: string;
  let technicianUserId: string;
  let technicianId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Minha Equipe Teste');
    tenantId = tenant.tenantId;
    const empresaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = empresaLogin.body.access_token;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Minha Equipe Teste');
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
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('lista o técnico vinculado à empresa', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenant-technicians/minha-empresa')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { user_id: technicianUserId, full_name: 'Tecnico Minha Equipe Teste', role: 'tecnico' },
    ]);
  });
});
```

- [ ] **Step 11: Rodar e confirmar que falha**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "tenant-technicians-minha-empresa"`
Expected: FAIL — rota não existe (404).

- [ ] **Step 12: Implementar `findMyTechnicians`**

Em `backend/src/tenant-technicians/tenant-technicians.service.ts`, adicione o método (mantendo `findMyTenants` intacto). Reescreva o arquivo completo:

```typescript
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface LinkedTenant {
  tenant_id: string;
  tenant_name: string;
  tenant_cnpj: string;
}

export interface LinkedTechnician {
  user_id: string;
  full_name: string;
  role: 'tecnico' | 'parceiro';
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

  async findMyTechnicians(client: PoolClient, tenantId: string): Promise<LinkedTechnician[]> {
    const result = await client.query<LinkedTechnician>(
      `SELECT u.id AS user_id, u.full_name, 'tecnico' AS role
       FROM tenant_technicians tt
       JOIN technicians t ON t.id = tt.technician_id
       JOIN users u ON u.id = t.user_id
       WHERE tt.tenant_id = $1 AND tt.status = 'ativo'
       UNION ALL
       SELECT u.id AS user_id, u.full_name, 'parceiro' AS role
       FROM tenant_partners tp
       JOIN partners p ON p.id = tp.partner_id
       JOIN users u ON u.id = p.user_id
       WHERE tp.tenant_id = $1 AND tp.status = 'ativo'
       ORDER BY full_name`,
      [tenantId],
    );
    return result.rows;
  }
}
```

Em `backend/src/tenant-technicians/tenant-technicians.controller.ts`, adicione a rota nova. Reescreva o arquivo completo:

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

  @Roles('empresa')
  @Get('minha-empresa')
  findMyTechnicians(@Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.tenantTechnicians.findMyTechnicians(client, req.user.tenantId),
    );
  }
}
```

- [ ] **Step 13: Rodar e confirmar que passa**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "tenant-technicians-minha-empresa"`
Expected: `1 passed`.

- [ ] **Step 14: Regressão — confirmar que nada de `visits`/`tenant-technicians` já existente quebrou**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "visits|tenant-technicians"`
Expected: sem quebra em nenhum arquivo (se existir algum e2e antigo de `visits`, ele precisa continuar passando — confira se existe algo em `backend/test/visit*.e2e-spec.ts` além do que esta task criou; se existir e usar `create()`/`confirm()` com a assinatura antiga, ajuste as chamadas pra assinatura nova, seguindo o mesmo padrão desta task).

- [ ] **Step 15: Restaurar a stack Docker**

```bash
cd /opt/Montese
rm docker-compose.dev-redis-temp.yml
docker compose up -d postgres redis
```

- [ ] **Step 16: Tipos e commit**

Run: `cd /opt/Montese/backend && npx tsc --noEmit` — sem erros.

```bash
cd /opt/Montese
git add backend/db/migrations/0047_visit_scheduling_fields.sql \
  backend/src/visits/dto/create-visit.dto.ts \
  backend/src/visits/dto/confirm-visit.dto.ts \
  backend/src/visits/visits.service.ts \
  backend/src/visits/visits.controller.ts \
  backend/src/tenant-technicians/tenant-technicians.service.ts \
  backend/src/tenant-technicians/tenant-technicians.controller.ts \
  backend/test/visits-scheduling.e2e-spec.ts \
  backend/test/tenant-technicians-minha-empresa.e2e-spec.ts
git commit -m "feat: tipo/horário/filial em visit_requests + empresa lista seus técnicos (Agendamento)"
```

---

### Task 2: Integração com Google Calendar — OAuth, criptografia e criação de evento (mockável)

**Files:**
- Create: `backend/db/migrations/0048_technician_google_accounts.sql`
- Create: `backend/src/common/crypto/secret-crypto.util.ts`
- Create: `backend/src/google-calendar/google-calendar-client.interface.ts`
- Create: `backend/src/google-calendar/google-oauth-calendar-client.service.ts`
- Create: `backend/src/google-calendar/google-calendar.service.ts`
- Create: `backend/src/google-calendar/google-calendar.controller.ts`
- Create: `backend/src/google-calendar/google-calendar.module.ts`
- Modify: `backend/package.json` (dependência nova `google-auth-library`)
- Test: `backend/test/secret-crypto.unit-spec.ts` (novo)
- Test: `backend/test/google-calendar.e2e-spec.ts` (novo)

**Interfaces:**
- Consumes: nada das tasks anteriores diretamente (independente da Task 1, ambas partem do mesmo BASE).
- Produces: `GoogleCalendarModule` exportando `GoogleCalendarService` com os métodos `getAuthUrl(technicianUserId: string): string`, `getStatus(client: PoolClient, technicianUserId: string): Promise<{ connected: boolean; google_email?: string }>`, `disconnect(client: PoolClient, technicianUserId: string): Promise<void>`, `handleCallback(client: PoolClient, code: string, state: string): Promise<void>`, `createEvent(client: PoolClient, technicianUserId: string, params: CreateEventParams): Promise<{ eventId: string; meetLink: string | null } | null>` — consumido pela Task 3. `GOOGLE_CALENDAR_CLIENT` (Symbol, provider token) e a interface `GoogleCalendarClient` — usados por testes futuros que precisem sobrepor a chamada real ao Google.

- [ ] **Step 1: Instalar a dependência**

```bash
cd /opt/Montese/backend
npm install google-auth-library
```

Confirme que `google-auth-library` (não `googleapis` — o pacote completo é muito mais pesado, com centenas de APIs não usadas; a Calendar API em si é só um `fetch` de REST, mesmo padrão já usado pelo projeto pra OpenRouter) aparece em `package.json`/`package-lock.json`.

- [ ] **Step 2: Migration**

`backend/db/migrations/0048_technician_google_accounts.sql`:

```sql
-- Agendamento de Reunião/Visita (Google Calendar + Meet): primeira
-- credencial de terceiro armazenada neste banco. refresh_token_encrypted
-- nunca é devolvido em nenhuma resposta de API — só google_email e
-- connected_at (ver GoogleCalendarService.getStatus).
CREATE TABLE technician_google_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_technician_google_accounts_updated_at
  BEFORE UPDATE ON technician_google_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE technician_google_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_google_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY technician_google_accounts_isolation ON technician_google_accounts USING (
  current_setting('app.role', true) = 'admin'
  OR technician_user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
);
```

Run: `cd /opt/Montese/backend && npm run db:migrate` (exponha Postgres antes, ver "Pré-requisito de ambiente").

- [ ] **Step 3: Escrever o teste do utilitário de criptografia (TDD)**

`backend/test/secret-crypto.unit-spec.ts`:

```typescript
import { encryptSecret, decryptSecret } from '../src/common/crypto/secret-crypto.util';

describe('secret-crypto.util', () => {
  const originalKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes em hex
  });

  afterAll(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalKey;
  });

  it('criptografa e decriptografa de volta pro valor original', () => {
    const original = 'refresh-token-super-secreto-1234';
    const encrypted = encryptSecret(original);
    expect(encrypted).not.toBe(original);
    expect(decryptSecret(encrypted)).toBe(original);
  });

  it('duas criptografias do mesmo valor produzem saídas diferentes (IV aleatório)', () => {
    const original = 'mesmo-valor';
    const a = encryptSecret(original);
    const b = encryptSecret(original);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(original);
    expect(decryptSecret(b)).toBe(original);
  });

  it('lança erro claro se a chave não tiver 32 bytes', () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'chave-curta-demais';
    expect(() => encryptSecret('qualquer coisa')).toThrow();
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  });
});
```

- [ ] **Step 4: Rodar e confirmar que falha**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:unit -- "secret-crypto"`
Expected: FAIL — módulo não existe.

- [ ] **Step 5: Implementar o utilitário**

`backend/src/common/crypto/secret-crypto.util.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// AES-256-GCM: primeira credencial de terceiro armazenada neste banco
// (refresh token do Google — ver GoogleCalendarService). A chave vem de
// GOOGLE_TOKEN_ENCRYPTION_KEY, 32 bytes em hex (gerar com
// `openssl rand -hex 32`, documentado no plano de implementação). Cada
// chamada de encryptSecret usa um IV novo (obrigatório em GCM — reusar
// IV com a mesma chave quebra a garantia de confidencialidade), por
// isso duas criptografias do mesmo valor produzem saídas diferentes.
const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'GOOGLE_TOKEN_ENCRYPTION_KEY ausente ou com tamanho errado (esperado 64 caracteres hex = 32 bytes)',
    );
  }
  return Buffer.from(hex, 'hex');
}

// Formato de saída: "<iv-hex>:<authTag-hex>:<ciphertext-hex>" — os 3
// componentes são necessários pra decriptar (GCM produz um auth tag
// separado do ciphertext).
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(encoded: string): string {
  const key = getKey();
  const [ivHex, authTagHex, ciphertextHex] = encoded.split(':');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}
```

- [ ] **Step 6: Rodar e confirmar que os 3 testes passam**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:unit -- "secret-crypto"`
Expected: `3 passed`.

- [ ] **Step 7: Interface do client Google (provider mockável)**

`backend/src/google-calendar/google-calendar-client.interface.ts`:

```typescript
export interface GoogleTokenSet {
  refreshToken: string;
  accessToken: string;
  expiresAt: Date;
}

export interface CreateGoogleEventInput {
  summary: string;
  description: string;
  startDateTimeIso: string;
  endDateTimeIso: string;
  location: string | null;
  createMeetLink: boolean;
}

export interface CreateGoogleEventResult {
  eventId: string;
  meetLink: string | null;
}

export interface GoogleCalendarClient {
  getAuthUrl(state: string): string;
  exchangeCode(code: string): Promise<GoogleTokenSet>;
  getUserEmail(accessToken: string): Promise<string>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }>;
  insertEvent(accessToken: string, event: CreateGoogleEventInput): Promise<CreateGoogleEventResult>;
}

export const GOOGLE_CALENDAR_CLIENT = Symbol('GOOGLE_CALENDAR_CLIENT');
```

- [ ] **Step 8: Implementação real (OAuth2Client + fetch)**

`backend/src/google-calendar/google-oauth-calendar-client.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import {
  CreateGoogleEventInput,
  CreateGoogleEventResult,
  GoogleCalendarClient,
  GoogleTokenSet,
} from './google-calendar-client.interface';

// Mesmo padrão de fallback-em-dev já usado em R2Service/EmailService —
// ausência de credencial não derruba o boot, só falha na primeira
// chamada real. redirect_uri é fixo (não hardcoded por ambiente): o
// Google exige que bata exatamente com o cadastrado no Cloud Console
// (ver "Pré-requisito externo" no topo do plano de implementação).
const REDIRECT_URI = `${process.env.APP_BASE_URL || 'https://montesesst.com.br'}/api/google-calendar/callback`;

@Injectable()
export class GoogleOAuthCalendarClientService implements GoogleCalendarClient {
  private readonly client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID || 'missing-google-client-id',
    process.env.GOOGLE_CLIENT_SECRET || 'missing-google-client-secret',
    REDIRECT_URI,
  );

  getAuthUrl(state: string): string {
    return this.client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state,
    });
  }

  async exchangeCode(code: string): Promise<GoogleTokenSet> {
    const { tokens } = await this.client.getToken(code);
    if (!tokens.refresh_token || !tokens.access_token || !tokens.expiry_date) {
      throw new Error('Google não devolveu refresh_token/access_token/expiry_date');
    }
    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: new Date(tokens.expiry_date),
    };
  }

  async getUserEmail(accessToken: string): Promise<string> {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Falha ao buscar e-mail da conta Google: HTTP ${res.status}`);
    const body = (await res.json()) as { email: string };
    return body.email;
  }

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    this.client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await this.client.refreshAccessToken();
    if (!credentials.access_token || !credentials.expiry_date) {
      throw new Error('Google não devolveu access_token/expiry_date ao renovar');
    }
    return { accessToken: credentials.access_token, expiresAt: new Date(credentials.expiry_date) };
  }

  async insertEvent(accessToken: string, event: CreateGoogleEventInput): Promise<CreateGoogleEventResult> {
    const body: Record<string, unknown> = {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.startDateTimeIso },
      end: { dateTime: event.endDateTimeIso },
    };
    if (event.location) body.location = event.location;
    if (event.createMeetLink) {
      body.conferenceData = {
        createRequest: { requestId: `montese-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
      };
    }

    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    if (event.createMeetLink) url.searchParams.set('conferenceDataVersion', '1');

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Falha ao criar evento no Google Calendar: HTTP ${res.status}`);
    const created = (await res.json()) as {
      id: string;
      conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[] };
    };
    const meetEntry = created.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
    return { eventId: created.id, meetLink: meetEntry?.uri ?? null };
  }
}
```

- [ ] **Step 9: `GoogleCalendarService`**

`backend/src/google-calendar/google-calendar.service.ts`:

```typescript
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PoolClient } from 'pg';
import { decryptSecret, encryptSecret } from '../common/crypto/secret-crypto.util';
import {
  CreateGoogleEventInput,
  CreateGoogleEventResult,
  GOOGLE_CALENDAR_CLIENT,
  GoogleCalendarClient,
} from './google-calendar-client.interface';

export interface GoogleAccountStatus {
  connected: boolean;
  google_email?: string;
}

export interface CreateEventParams {
  type: 'reuniao' | 'visita';
  summary: string;
  description: string;
  startDateTimeIso: string;
  endDateTimeIso: string;
  location: string | null;
}

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos — só precisa sobreviver ao round-trip do consentimento

@Injectable()
export class GoogleCalendarService {
  constructor(@Inject(GOOGLE_CALENDAR_CLIENT) private readonly google: GoogleCalendarClient) {}

  // state assinado com HMAC-SHA256 reaproveitando JWT_SECRET (já é um
  // segredo real do projeto) — evita precisar de sessão/cookie no
  // redirect de volta do Google, que chega como navegação de browser
  // sem Authorization header.
  private signState(technicianUserId: string): string {
    const expiresAt = Date.now() + STATE_TTL_MS;
    const payload = `${technicianUserId}.${expiresAt}`;
    const signature = createHmac('sha256', process.env.JWT_SECRET || 'dev-secret-change-me')
      .update(payload)
      .digest('hex');
    return Buffer.from(`${payload}.${signature}`).toString('base64url');
  }

  private verifyState(state: string): string {
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const [technicianUserId, expiresAtRaw, signature] = decoded.split('.');
    const expiresAt = Number(expiresAtRaw);
    const payload = `${technicianUserId}.${expiresAtRaw}`;
    const expectedSignature = createHmac('sha256', process.env.JWT_SECRET || 'dev-secret-change-me')
      .update(payload)
      .digest('hex');
    const signatureBuffer = Buffer.from(signature ?? '', 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const validSignature =
      signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
    if (!validSignature || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      throw new BadRequestException('Link de conexão com o Google inválido ou expirado');
    }
    return technicianUserId;
  }

  getAuthUrl(technicianUserId: string): string {
    return this.google.getAuthUrl(this.signState(technicianUserId));
  }

  async handleCallback(client: PoolClient, code: string, state: string): Promise<void> {
    const technicianUserId = this.verifyState(state);
    const tokens = await this.google.exchangeCode(code);
    const googleEmail = await this.google.getUserEmail(tokens.accessToken);
    const encrypted = encryptSecret(tokens.refreshToken);

    await client.query(
      `INSERT INTO technician_google_accounts (technician_user_id, google_email, refresh_token_encrypted)
       VALUES ($1, $2, $3)
       ON CONFLICT (technician_user_id)
       DO UPDATE SET google_email = $2, refresh_token_encrypted = $3, updated_at = now()`,
      [technicianUserId, googleEmail, encrypted],
    );
  }

  async getStatus(client: PoolClient, technicianUserId: string): Promise<GoogleAccountStatus> {
    const result = await client.query<{ google_email: string }>(
      'SELECT google_email FROM technician_google_accounts WHERE technician_user_id = $1',
      [technicianUserId],
    );
    if (result.rowCount === 0) return { connected: false };
    return { connected: true, google_email: result.rows[0].google_email };
  }

  async disconnect(client: PoolClient, technicianUserId: string): Promise<void> {
    const result = await client.query(
      'DELETE FROM technician_google_accounts WHERE technician_user_id = $1',
      [technicianUserId],
    );
    if (result.rowCount === 0) throw new NotFoundException('Nenhuma conta Google conectada');
  }

  // Devolve null (não lança) quando o técnico não tem conta conectada —
  // quem chama (VisitsService.confirm, na Task 3) decide que isso não é
  // um erro, é só "sem evento no Google desta vez".
  async createEvent(
    client: PoolClient,
    technicianUserId: string,
    params: CreateEventParams,
  ): Promise<CreateGoogleEventResult | null> {
    const accountResult = await client.query<{ refresh_token_encrypted: string }>(
      'SELECT refresh_token_encrypted FROM technician_google_accounts WHERE technician_user_id = $1',
      [technicianUserId],
    );
    if (accountResult.rowCount === 0) return null;

    const refreshToken = decryptSecret(accountResult.rows[0].refresh_token_encrypted);
    const { accessToken } = await this.google.refreshAccessToken(refreshToken);

    const input: CreateGoogleEventInput = {
      summary: params.summary,
      description: params.description,
      startDateTimeIso: params.startDateTimeIso,
      endDateTimeIso: params.endDateTimeIso,
      location: params.location,
      createMeetLink: params.type === 'reuniao',
    };
    return this.google.insertEvent(accessToken, input);
  }
}
```

- [ ] **Step 10: Controller**

`backend/src/google-calendar/google-calendar.controller.ts`:

```typescript
import { Controller, Delete, Get, Query, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DatabaseService } from '../common/database/database.service';
import { GoogleCalendarService } from './google-calendar.service';

@Controller('google-calendar')
export class GoogleCalendarController {
  constructor(
    private readonly googleCalendar: GoogleCalendarService,
    private readonly db: DatabaseService,
  ) {}

  @Roles('tecnico')
  @Get('auth-url')
  authUrl(@Req() req: any) {
    return { url: this.googleCalendar.getAuthUrl(req.user.id) };
  }

  // Rota pública: é chamada por navegação de browser vindo do redirect
  // do próprio Google, sem Authorization header — não existe req.user
  // nem req.withTenantContext funcional aqui (o interceptor monta esse
  // helper a partir de req.user, que está ausente numa request pública).
  // Por isso injeta DatabaseService diretamente e chama
  // withTenantContext({ role: 'admin' }, ...) na mão — mesmo padrão exato
  // já usado em visit-reminder.cron.ts pra rodar contra tabelas com RLS
  // sem um usuário autenticado de verdade. O `state` assinado (verificado
  // dentro de handleCallback) é a prova de identidade nesta rota.
  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    try {
      await this.db.withTenantContext({ role: 'admin' }, (client) =>
        this.googleCalendar.handleCallback(client, code, state),
      );
      res.redirect('/tecnico/configuracoes?google=conectado');
    } catch {
      res.redirect('/tecnico/configuracoes?google=erro');
    }
  }

  @Roles('tecnico')
  @Get('status')
  status(@Req() req: any) {
    return req.withTenantContext((client: any) => this.googleCalendar.getStatus(client, req.user.id));
  }

  @Roles('tecnico')
  @Delete('desconectar')
  disconnect(@Req() req: any) {
    return req.withTenantContext((client: any) => this.googleCalendar.disconnect(client, req.user.id));
  }
}
```

- [ ] **Step 11: Module**

`backend/src/google-calendar/google-calendar.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { GoogleCalendarController } from './google-calendar.controller';
import { GoogleCalendarService } from './google-calendar.service';
import { GoogleOAuthCalendarClientService } from './google-oauth-calendar-client.service';
import { GOOGLE_CALENDAR_CLIENT } from './google-calendar-client.interface';

@Module({
  controllers: [GoogleCalendarController],
  providers: [
    GoogleCalendarService,
    GoogleOAuthCalendarClientService,
    { provide: GOOGLE_CALENDAR_CLIENT, useClass: GoogleOAuthCalendarClientService },
  ],
  exports: [GoogleCalendarService],
})
export class GoogleCalendarModule {}
```

Registre `GoogleCalendarModule` em `backend/src/app.module.ts` (adicione ao array `imports`, mesmo padrão dos outros módulos já listados lá — leia o arquivo real antes de editar pra manter a ordem/estilo).

- [ ] **Step 12: Escrever o teste e2e (com `GOOGLE_CALENDAR_CLIENT` mockado — TDD)**

`backend/test/google-calendar.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GOOGLE_CALENDAR_CLIENT } from '../src/google-calendar/google-calendar-client.interface';
import { TestDb } from './db-test-helper';

describe('Google Calendar — status/conexão/desconexão (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let technicianUserId: string;
  let technicianToken: string;

  const fakeExchangeCode = jest.fn();
  const fakeGetUserEmail = jest.fn();
  const fakeGoogleClient = {
    getAuthUrl: jest.fn(() => 'https://accounts.google.com/o/oauth2/fake'),
    exchangeCode: fakeExchangeCode,
    getUserEmail: fakeGetUserEmail,
    refreshAccessToken: jest.fn(),
    insertEvent: jest.fn(),
  };

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GOOGLE_CALENDAR_CLIENT)
      .useValue(fakeGoogleClient)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Google Teste');
    technicianUserId = tech.userId;
    await (db as any).client.query('INSERT INTO technicians (user_id) VALUES ($1)', [tech.userId]);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = login.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM technician_google_accounts WHERE technician_user_id = $1', [
      technicianUserId,
    ]);
    await (db as any).client.query('DELETE FROM technicians WHERE user_id = $1', [technicianUserId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('status inicial: não conectado', async () => {
    const res = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: false });
  });

  it('gera uma URL de autorização', async () => {
    const res = await request(app.getHttpServer())
      .get('/google-calendar/auth-url')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toContain('accounts.google.com');
  });

  it('callback com state válido conecta a conta e status passa a refletir isso', async () => {
    fakeExchangeCode.mockResolvedValue({
      refreshToken: 'refresh-fake-123',
      accessToken: 'access-fake-123',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    fakeGetUserEmail.mockResolvedValue('tecnico@gmail.com');

    const authUrlRes = await request(app.getHttpServer())
      .get('/google-calendar/auth-url')
      .set('Authorization', `Bearer ${technicianToken}`);
    const url = new URL(authUrlRes.body.url.replace('https://accounts.google.com/o/oauth2/fake', 'http://x?'));
    const state = url.searchParams.get('state');

    // A URL fake não carrega o state real (o mock devolve uma string
    // fixa) — pegue o state genuíno direto do serviço, não da URL fake.
    // Ajuste este teste durante a implementação: injete GoogleCalendarService
    // e chame getAuthUrl(technicianUserId) diretamente pra extrair o state
    // real, OU altere fakeGetAuthUrl pra ecoar o state recebido
    // (`(state) => \`https://accounts.google.com/o/oauth2/fake?state=${state}\``)
    // e parseie a partir daí. A segunda opção é mais simples — use-a.

    const callbackRes = await request(app.getHttpServer()).get(
      `/google-calendar/callback?code=fake-code&state=${encodeURIComponent(state ?? '')}`,
    );
    expect(callbackRes.status).toBe(302);

    const statusRes = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(statusRes.body).toEqual({ connected: true, google_email: 'tecnico@gmail.com' });
  });

  it('desconectar remove a conta', async () => {
    const res = await request(app.getHttpServer())
      .delete('/google-calendar/desconectar')
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(res.status).toBe(200);

    const statusRes = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(statusRes.body).toEqual({ connected: false });
  });

  it('callback com state inválido não conecta nada', async () => {
    const res = await request(app.getHttpServer()).get(
      '/google-calendar/callback?code=fake-code&state=lixo-invalido',
    );
    expect(res.status).toBe(302); // redireciona pro erro, não derruba a request

    const statusRes = await request(app.getHttpServer())
      .get('/google-calendar/status')
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(statusRes.body).toEqual({ connected: false });
  });
});
```

**Antes de rodar**: implemente a correção mencionada no comentário do 3º teste — troque `fakeGoogleClient.getAuthUrl` pra `jest.fn((state: string) => \`https://accounts.google.com/o/oauth2/fake?state=${state}\`)` e ajuste a extração do `state` no teste pra vir de `new URL(authUrlRes.body.url).searchParams.get('state')` diretamente (sem o replace estranho). Isso torna o teste determinístico sem precisar inspecionar o `GoogleCalendarService` diretamente.

- [ ] **Step 13: Rodar e confirmar que os 5 testes passam**

Exponha Postgres/Redis (ver "Pré-requisito de ambiente").

Run: `cd /opt/Montese && GOOGLE_TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32) ./run-backend-tests.sh test:e2e -- "google-calendar"`
Expected: `5 passed`.

- [ ] **Step 14: Regressão completa**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "visits|tenant-technicians|google-calendar"`
Expected: sem quebra.

- [ ] **Step 15: Restaurar a stack Docker**

```bash
cd /opt/Montese
rm docker-compose.dev-redis-temp.yml
docker compose up -d postgres redis
```

- [ ] **Step 16: Tipos e commit**

Run: `cd /opt/Montese/backend && npx tsc --noEmit` — sem erros.

```bash
cd /opt/Montese
git add backend/package.json backend/package-lock.json \
  backend/db/migrations/0048_technician_google_accounts.sql \
  backend/src/common/crypto/secret-crypto.util.ts \
  backend/src/google-calendar/ \
  backend/src/app.module.ts \
  backend/test/secret-crypto.unit-spec.ts \
  backend/test/google-calendar.e2e-spec.ts
git commit -m "feat: integração OAuth com Google Calendar/Meet (conectar/status/desconectar/criar evento)"
```

---

### Task 3: Ligar a confirmação de visita à criação do evento no Google

**Files:**
- Modify: `backend/src/visits/visits.service.ts`
- Modify: `backend/src/visits/visits.module.ts`
- Modify: `backend/src/visits/visit-reminder.cron.ts`
- Test: `backend/test/visits-google-integration.e2e-spec.ts` (novo)

**Interfaces:**
- Consumes: `VisitsService.confirm()`/`setGoogleEvent()` (Task 1), `GoogleCalendarService.createEvent()` (Task 2), `GOOGLE_CALENDAR_CLIENT` provider token (Task 2, pra mockar em teste).
- Produces: nenhuma interface nova pra tasks seguintes (Tasks 4/5 consomem só os campos `google_event_id`/`google_meet_link` do `VisitRequest`, já produzidos pela Task 1).

- [ ] **Step 1: Ler os arquivos reais atuais**

Leia `backend/src/visits/visits.service.ts` e `backend/src/visits/visit-reminder.cron.ts` no estado deixado pela Task 1/Task 2 — se algo divergir deste plano, o código real vence.

- [ ] **Step 2: Escrever o teste e2e ANTES de integrar (TDD)**

`backend/test/visits-google-integration.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GOOGLE_CALENDAR_CLIENT } from '../src/google-calendar/google-calendar-client.interface';
import { TestDb } from './db-test-helper';

describe('Confirmar visita cria evento no Google Calendar (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let empresaToken: string;
  let technicianUserId: string;
  let technicianToken: string;

  const fakeInsertEvent = jest.fn();
  const fakeGoogleClient = {
    getAuthUrl: jest.fn(() => 'https://accounts.google.com/fake'),
    exchangeCode: jest.fn().mockResolvedValue({
      refreshToken: 'refresh-fake',
      accessToken: 'access-fake',
      expiresAt: new Date(Date.now() + 3600_000),
    }),
    getUserEmail: jest.fn().mockResolvedValue('tecnico@gmail.com'),
    refreshAccessToken: jest.fn().mockResolvedValue({
      accessToken: 'access-fake-renovado',
      expiresAt: new Date(Date.now() + 3600_000),
    }),
    insertEvent: fakeInsertEvent,
  };

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'c'.repeat(64);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GOOGLE_CALENDAR_CLIENT)
      .useValue(fakeGoogleClient)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Google Integration Teste');
    tenantId = tenant.tenantId;
    const empresaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = empresaLogin.body.access_token;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Google Integration Teste');
    technicianUserId = tech.userId;
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, techResult.rows[0].id],
    );
    const techLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = techLogin.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query(
      'DELETE FROM technician_google_accounts WHERE technician_user_id = $1',
      [technicianUserId],
    );
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE user_id = $1', [technicianUserId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('técnico SEM Google conectado: confirmação funciona normalmente, sem evento', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'reuniao',
        preferred_date: '2026-11-01',
        preferred_time: '10:00',
        motivo: 'Reunião sem Google conectado',
      });

    const confirmRes = await request(app.getHttpServer())
      .patch(`/visits/${createRes.body.id}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-11-01', confirmed_time: '10:00' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('confirmado');
    expect(confirmRes.body.google_event_id).toBeNull();
    expect(fakeInsertEvent).not.toHaveBeenCalled();
  });

  it('técnico COM Google conectado, tipo reunião: confirmação cria evento com Meet', async () => {
    // Conecta o Google via callback real (com o client mockado)
    const authUrlRes = await request(app.getHttpServer())
      .get('/google-calendar/auth-url')
      .set('Authorization', `Bearer ${technicianToken}`);
    const state = new URL(authUrlRes.body.url).searchParams.get('state');
    await request(app.getHttpServer()).get(
      `/google-calendar/callback?code=fake&state=${encodeURIComponent(state ?? '')}`,
    );

    fakeInsertEvent.mockResolvedValue({ eventId: 'evt-123', meetLink: 'https://meet.google.com/abc-defg-hij' });

    const createRes = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'reuniao',
        preferred_date: '2026-11-02',
        preferred_time: '14:00',
        motivo: 'Reunião com Google conectado',
      });

    const confirmRes = await request(app.getHttpServer())
      .patch(`/visits/${createRes.body.id}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-11-02', confirmed_time: '14:00' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.google_event_id).toBe('evt-123');
    expect(confirmRes.body.google_meet_link).toBe('https://meet.google.com/abc-defg-hij');
    expect(fakeInsertEvent).toHaveBeenCalledWith(
      'access-fake-renovado',
      expect.objectContaining({ createMeetLink: true }),
    );
  });

  it('Google falha ao criar evento: confirmação continua de pé, sem evento', async () => {
    fakeInsertEvent.mockRejectedValue(new Error('Google fora do ar (simulado)'));

    const createRes = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'reuniao',
        preferred_date: '2026-11-03',
        preferred_time: '09:00',
        motivo: 'Reunião com Google falhando',
      });

    const confirmRes = await request(app.getHttpServer())
      .patch(`/visits/${createRes.body.id}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-11-03', confirmed_time: '09:00' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('confirmado');
    expect(confirmRes.body.google_event_id).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "visits-google-integration"`
Expected: FAIL — `confirm()` ainda não chama `GoogleCalendarService`.

- [ ] **Step 4: Injetar `GoogleCalendarService` em `VisitsService` e estender `confirm()`**

Em `backend/src/visits/visits.service.ts`: adicione o import de `GoogleCalendarService` e `PoolClient` (já importado), adicione um construtor injetando `GoogleCalendarService`, e depois do `UPDATE ... SET status = 'confirmado'` dentro de `confirm()`, adicione a chamada ao Google. A visita precisa de dados extras pro evento (nome do tenant, endereço da filial se for visita) — busque-os dentro do próprio `confirm()`.

Altere a assinatura da classe e do método `confirm` (mantenha todo o resto do arquivo da Task 1 igual, só estas duas partes mudam):

```typescript
import { GoogleCalendarService } from '../google-calendar/google-calendar.service';

// ... (interfaces e funções de normalização continuam iguais) ...

@Injectable()
export class VisitsService {
  constructor(private readonly googleCalendar: GoogleCalendarService) {}

  private readonly logger = new (require('@nestjs/common').Logger)(VisitsService.name);

  // ... assertCompanyUnitBelongsToTenant, create, findAll continuam iguais ...

  async confirm(
    client: PoolClient,
    id: string,
    technicianUserId: string,
    confirmedDate: string,
    confirmedTime: string | undefined,
  ): Promise<VisitRequest> {
    const visit = await this.findAndLock(client, id);
    if (visit.technician_user_id !== technicianUserId) {
      throw new ForbiddenException('Só o técnico designado pode confirmar esta visita');
    }
    if (visit.status !== 'solicitado') {
      throw new ConflictException('Visita não está aguardando confirmação');
    }

    const result = await client.query<VisitRequest>(
      `UPDATE visit_requests SET status = 'confirmado', confirmed_date = $2, confirmed_time = $3
       WHERE id = $1 RETURNING *`,
      [id, confirmedDate, confirmedTime ?? null],
    );
    let confirmed = normalizeVisit(result.rows[0]);

    try {
      const startTime = confirmedTime || '09:00';
      const startDateTimeIso = `${confirmedDate}T${startTime}:00`;
      const [hours, minutes] = startTime.split(':').map(Number);
      const endDate = new Date(`${confirmedDate}T${startTime}:00`);
      endDate.setHours(hours + 1, minutes);
      const endDateTimeIso = endDate.toISOString().slice(0, 19);

      let location: string | null = null;
      if (confirmed.type === 'visita' && confirmed.company_unit_id) {
        const unitResult = await client.query<{
          address_street: string;
          address_number: string | null;
          address_city: string;
          address_state: string;
        }>(
          'SELECT address_street, address_number, address_city, address_state FROM company_units WHERE id = $1',
          [confirmed.company_unit_id],
        );
        const unit = unitResult.rows[0];
        if (unit) {
          location = `${unit.address_street}${unit.address_number ? `, ${unit.address_number}` : ''} — ${unit.address_city}/${unit.address_state}`;
        }
      }

      const event = await this.googleCalendar.createEvent(client, technicianUserId, {
        type: confirmed.type,
        summary: confirmed.type === 'reuniao' ? 'Reunião — Montese SST' : 'Visita técnica — Montese SST',
        description: confirmed.motivo || 'Agendado via Montese SST',
        startDateTimeIso,
        endDateTimeIso,
        location,
      });

      if (event) {
        await this.setGoogleEvent(client, id, event.eventId, event.meetLink);
        confirmed = { ...confirmed, google_event_id: event.eventId, google_meet_link: event.meetLink };
      }
    } catch (err) {
      // Nunca derruba a confirmação por causa do Google — mesmo padrão
      // de resiliência já usado na geração do PDF de visita técnica.
      this.logger.warn(`Falha ao criar evento no Google Calendar pra visita ${id}: ${(err as Error).message}`);
    }

    return confirmed;
  }

  // ... cancel, conclude, setGoogleEvent, findAndLock, isTechnicianLinked continuam iguais ...
}
```

**Atenção**: o snippet acima usa `require('@nestjs/common').Logger` só pra caber no formato deste plano sem reescrever o arquivo inteiro de novo — na implementação real, adicione `Logger` ao import já existente no topo do arquivo (`import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';`) e declare `private readonly logger = new Logger(VisitsService.name);` como propriedade normal da classe, junto do `constructor`. Reescreva o arquivo completo (`visits.service.ts`) juntando isso com o conteúdo já produzido na Task 1 — não deixe as duas versões coexistindo.

- [ ] **Step 5: Atualizar o módulo**

Em `backend/src/visits/visits.module.ts`, importe `GoogleCalendarModule`:

```typescript
import { Module } from '@nestjs/common';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { TechnicianAgendaService } from './technician-agenda.service';
import { VisitReminderCronService } from './visit-reminder.cron';
import { DashboardModule } from '../dashboard/dashboard.module';
import { TenantTechniciansModule } from '../tenant-technicians/tenant-technicians.module';
import { GoogleCalendarModule } from '../google-calendar/google-calendar.module';

@Module({
  imports: [DashboardModule, TenantTechniciansModule, GoogleCalendarModule],
  controllers: [VisitsController],
  providers: [VisitsService, TechnicianAgendaService, VisitReminderCronService],
})
export class VisitsModule {}
```

- [ ] **Step 6: Rodar e confirmar que os 3 testes passam**

Exponha Postgres/Redis (ver "Pré-requisito de ambiente").

Run: `cd /opt/Montese && GOOGLE_TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32) ./run-backend-tests.sh test:e2e -- "visits-google-integration"`
Expected: `3 passed`.

- [ ] **Step 7: Atualizar o e-mail do cron pra incluir o Meet**

Em `backend/src/visits/visit-reminder.cron.ts`, o `SELECT` já precisa trazer `google_meet_link` e o HTML do e-mail pro técnico (não pra empresa — Meet é usado pelo técnico como organizador, e a empresa recebe o link seguindo o convite do próprio Google/e-mail de calendário, fora do escopo desta fase) ganha uma linha condicional. Ajuste a query (adicione `vr.google_meet_link` no SELECT) e o corpo do e-mail:

```typescript
try {
  const meetLine = row.google_meet_link
    ? `<p>Link da reunião: <a href="${row.google_meet_link}">${row.google_meet_link}</a></p>`
    : '';
  await this.email.send({
    to: row.technician_email,
    subject: 'Você tem visita confirmada amanhã',
    html: `<p>Você tem uma visita confirmada amanhã (${confirmedDate}) na empresa ${tenantName}.</p>${meetLine}`,
  });
} catch (err) {
  this.logger.error(`Falha ao enviar lembrete (técnico) pra visita ${row.id}`, (err as Error).stack);
}
```

Adicione `google_meet_link: string | null;` na interface `ReminderRow` e `vr.google_meet_link` na query `SELECT`.

- [ ] **Step 8: Regressão completa**

Run: `cd /opt/Montese && ./run-backend-tests.sh test:e2e -- "visits|tenant-technicians|google-calendar"`
Expected: sem quebra em nenhum arquivo.

- [ ] **Step 9: Restaurar a stack Docker**

```bash
cd /opt/Montese
rm docker-compose.dev-redis-temp.yml
docker compose up -d postgres redis
```

- [ ] **Step 10: Tipos e commit**

Run: `cd /opt/Montese/backend && npx tsc --noEmit` — sem erros.

```bash
cd /opt/Montese
git add backend/src/visits/visits.service.ts \
  backend/src/visits/visits.module.ts \
  backend/src/visits/visit-reminder.cron.ts \
  backend/test/visits-google-integration.e2e-spec.ts
git commit -m "feat: confirmar visita cria evento automaticamente no Google Calendar do técnico"
```

---

### Task 4: Frontend do técnico — Vencimentos/Agenda + conectar Google Calendar

**Files:**
- Modify: `frontend/src/components/TecnicoSidebar.tsx`
- Create: `frontend/src/app/tecnico/agendamentos/page.tsx`
- Create: `frontend/src/app/tecnico/configuracoes/page.tsx`

**Interfaces:**
- Consumes: `GET /visits/me/day` (`{ visitas: { proximas: VisitRequest[], pendentes_de_confirmar: VisitRequest[] }, empresas: [...] }` — já existe desde a Fase 11, Task 3 não mudou o formato), `PATCH /visits/:id/confirmar` (body `{ confirmed_date, confirmed_time? }`), `PATCH /visits/:id/cancelar`, `GET /google-calendar/status` (`{ connected: boolean, google_email?: string }`), `GET /google-calendar/auth-url` (`{ url: string }`), `DELETE /google-calendar/desconectar`.
- Produces: nada consumido por outra task (Task 5 é independente no frontend).

- [ ] **Step 1: Ler os arquivos reais atuais**

Leia por completo `frontend/src/components/TecnicoSidebar.tsx` e `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx` (como referência de estilo/padrão de fetch/estado já usado nas telas do técnico). Se algo divergir deste plano, o código real vence.

- [ ] **Step 2: Sidebar — renomear e adicionar itens**

Em `frontend/src/components/TecnicoSidebar.tsx`, altere o array `GROUPS`:

```typescript
const GROUPS: NavGroup[] = [
  {
    label: 'Carteira',
    links: [{ href: '/tecnico/empresas', label: 'Suas empresas', emoji: '🏢' }],
  },
  {
    label: 'Trabalho',
    links: [
      { href: '/tecnico/agendamentos', label: 'Agenda', emoji: '📅' },
      { href: '/tecnico/agenda', label: 'Vencimentos', emoji: '⏰' },
      { href: '/tecnico/consulta-ca', label: 'Consulta de CA', emoji: '🔎' },
    ],
  },
  {
    label: 'Conta',
    links: [{ href: '/tecnico/configuracoes', label: 'Configurações', emoji: '⚙️' }],
  },
];
```

Nada mais no arquivo muda (o componente já é genérico o suficiente pra renderizar qualquer item de `GROUPS`).

- [ ] **Step 3: Tela de configurações — conectar/desconectar Google**

`frontend/src/app/tecnico/configuracoes/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

interface GoogleStatus {
  connected: boolean;
  google_email?: string;
}

export default function TecnicoConfiguracoesPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);

  function loadStatus() {
    const token = localStorage.getItem('montese_token');
    fetch('/api/google-calendar/status', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setStatus(data);
        setLoading(false);
      })
      .catch(() => {
        setError('Não foi possível carregar o status da conexão com o Google.');
        setLoading(false);
      });
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConectar() {
    const token = localStorage.getItem('montese_token');
    const res = await fetch('/api/google-calendar/auth-url', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const { url } = await res.json();
      window.location.href = url;
    }
  }

  async function handleDesconectar() {
    setDisconnecting(true);
    const token = localStorage.getItem('montese_token');
    const res = await fetch('/api/google-calendar/desconectar', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      loadStatus();
    } else {
      setError('Não foi possível desconectar.');
    }
    setDisconnecting(false);
  }

  const googleResult = searchParams.get('google');

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Configurações</h1>

      {googleResult === 'conectado' && (
        <p className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
          Conta do Google conectada com sucesso.
        </p>
      )}
      {googleResult === 'erro' && (
        <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-600">
          Não foi possível conectar a conta do Google. Tente novamente.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Google Calendar</h2>
        <p className="mt-1 text-sm text-brand-700">
          Conecte sua conta do Google pra que reuniões e visitas confirmadas apareçam automaticamente na sua
          agenda, com link do Google Meet quando for reunião.
        </p>
        {status?.connected ? (
          <div className="mt-4 flex items-center justify-between rounded-md bg-brand-50 p-3">
            <span className="text-sm text-brand-900">Conectado como {status.google_email}</span>
            <button
              onClick={handleDesconectar}
              disabled={disconnecting}
              className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
            >
              {disconnecting ? 'Desconectando...' : 'Desconectar'}
            </button>
          </div>
        ) : (
          <button
            onClick={handleConectar}
            className="mt-4 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Conectar Google Calendar
          </button>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Tela de agenda — pendentes + próximos**

`frontend/src/app/tecnico/agendamentos/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';

interface VisitRequest {
  id: string;
  tenant_id: string;
  status: 'solicitado' | 'confirmado' | 'concluido' | 'cancelado';
  type: 'reuniao' | 'visita';
  preferred_date: string | null;
  preferred_time: string | null;
  confirmed_date: string | null;
  confirmed_time: string | null;
  motivo: string | null;
  google_meet_link: string | null;
}

interface MyDayResult {
  visitas: {
    proximas: VisitRequest[];
    pendentes_de_confirmar: VisitRequest[];
  };
}

const TYPE_LABELS: Record<string, string> = { reuniao: 'Reunião', visita: 'Visita' };

export default function TecnicoAgendamentosPage() {
  const [data, setData] = useState<MyDayResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDates, setConfirmDates] = useState<Record<string, string>>({});
  const [confirmTimes, setConfirmTimes] = useState<Record<string, string>>({});

  function load() {
    const token = localStorage.getItem('montese_token');
    fetch('/api/visits/me/day', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        setError('Não foi possível carregar a agenda.');
        setLoading(false);
      });
  }

  useEffect(() => {
    load();
  }, []);

  async function handleConfirmar(visitId: string) {
    const token = localStorage.getItem('montese_token');
    const res = await fetch(`/api/visits/${visitId}/confirmar`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        confirmed_date: confirmDates[visitId],
        confirmed_time: confirmTimes[visitId] || undefined,
      }),
    });
    if (res.ok) {
      load();
    } else {
      setError('Não foi possível confirmar.');
    }
  }

  async function handleCancelar(visitId: string) {
    const token = localStorage.getItem('montese_token');
    const res = await fetch(`/api/visits/${visitId}/cancelar`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) load();
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Agenda</h1>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <section className="mt-6">
        <h2 className="text-lg font-bold text-brand-900">Pedidos pendentes de confirmar</h2>
        {data?.visitas.pendentes_de_confirmar.length === 0 ? (
          <p className="mt-2 text-sm text-brand-700">Nenhum pedido pendente.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {data?.visitas.pendentes_de_confirmar.map((visit) => (
              <li key={visit.id} className="rounded-md border border-brand-100 p-4">
                <p className="text-sm font-medium text-brand-900">
                  {TYPE_LABELS[visit.type]} — sugerido: {visit.preferred_date} {visit.preferred_time ?? ''}
                </p>
                {visit.motivo && <p className="mt-1 text-sm text-brand-700">{visit.motivo}</p>}
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="flex flex-col gap-1 text-xs text-brand-900">
                    Confirmar data
                    <input
                      type="date"
                      defaultValue={visit.preferred_date ?? ''}
                      onChange={(e) => setConfirmDates((prev) => ({ ...prev, [visit.id]: e.target.value }))}
                      className="rounded-md border border-brand-100 px-3 py-2"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-brand-900">
                    Horário
                    <input
                      type="time"
                      defaultValue={visit.preferred_time ?? ''}
                      onChange={(e) => setConfirmTimes((prev) => ({ ...prev, [visit.id]: e.target.value }))}
                      className="rounded-md border border-brand-100 px-3 py-2"
                    />
                  </label>
                  <button
                    onClick={() => handleConfirmar(visit.id)}
                    className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    Confirmar
                  </button>
                  <button
                    onClick={() => handleCancelar(visit.id)}
                    className="text-sm font-medium text-red-600 hover:underline"
                  >
                    Recusar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-brand-900">Próximos compromissos</h2>
        {data?.visitas.proximas.length === 0 ? (
          <p className="mt-2 text-sm text-brand-700">Nada nos próximos 7 dias.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-sm text-brand-700">
            {data?.visitas.proximas.map((visit) => (
              <li key={visit.id} className="rounded-md border border-brand-100 p-3">
                <span className="font-medium text-brand-900">{TYPE_LABELS[visit.type]}</span> —{' '}
                {visit.confirmed_date} {visit.confirmed_time ?? ''}
                {visit.motivo ? ` — ${visit.motivo}` : ''}
                {visit.google_meet_link && (
                  <a
                    href={visit.google_meet_link}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 font-medium text-brand-500 hover:underline"
                  >
                    Entrar no Meet
                  </a>
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

- [ ] **Step 5: Tipos**

Run: `cd /opt/Montese/frontend && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Build de produção**

Run: `cd /opt/Montese/frontend && npx next build`
Expected: build limpo, sem erro de tipo nem de rota.

- [ ] **Step 7: Commit**

```bash
cd /opt/Montese
git add frontend/src/components/TecnicoSidebar.tsx \
  frontend/src/app/tecnico/agendamentos/page.tsx \
  frontend/src/app/tecnico/configuracoes/page.tsx
git commit -m "feat: tela de agenda de compromissos + conectar Google Calendar (lado técnico)"
```

Verificação manual em produção fica pra depois da Task 5 (uma única rodada de Playwright cobrindo os dois lados, ver seção final do plano).

---

### Task 5: Frontend da empresa — solicitar reunião/visita

**Files:**
- Modify: `frontend/src/components/EmpresaSidebar.tsx`
- Create: `frontend/src/app/empresa/agendamentos/page.tsx`

**Interfaces:**
- Consumes: `GET /tenant-technicians/minha-empresa` (Task 1), `GET /api/company-units` (já existe, sem `@Roles`, RLS escopa por tenant), `POST /visits` (Task 1, body `{ technician_user_id, type, preferred_date, preferred_time?, company_unit_id?, motivo? }`), `GET /visits` (já existe, lista as solicitações da empresa).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Ler os arquivos reais atuais**

Leia por completo `frontend/src/components/EmpresaSidebar.tsx` e `frontend/src/app/empresa/onboarding/FiliaisForm.tsx` (referência de como o lado empresa já busca `company_units`). Se algo divergir deste plano, o código real vence.

- [ ] **Step 2: Sidebar — item novo**

Em `frontend/src/components/EmpresaSidebar.tsx`, adicione ao grupo "Segurança" (mantendo os outros links do grupo intactos):

```typescript
{ href: '/empresa/agendamentos', label: 'Reuniões e Visitas', emoji: '📅' },
```

(Insira essa linha no array `links` do grupo `'Segurança'`, por exemplo logo depois de `'/empresa/inspecoes'` — ordem exata não é crítica, mas mantenha o restante do array idêntico.)

- [ ] **Step 3: Tela de solicitação + lista**

`frontend/src/app/empresa/agendamentos/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';

interface Technician {
  user_id: string;
  full_name: string;
  role: 'tecnico' | 'parceiro';
}

interface CompanyUnit {
  id: string;
  name: string;
}

interface VisitRequest {
  id: string;
  status: 'solicitado' | 'confirmado' | 'concluido' | 'cancelado';
  type: 'reuniao' | 'visita';
  preferred_date: string | null;
  preferred_time: string | null;
  confirmed_date: string | null;
  confirmed_time: string | null;
  motivo: string | null;
  google_meet_link: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  solicitado: 'Aguardando confirmação',
  confirmado: 'Confirmado',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

export default function EmpresaAgendamentosPage() {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [units, setUnits] = useState<CompanyUnit[]>([]);
  const [visits, setVisits] = useState<VisitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const [technicianUserId, setTechnicianUserId] = useState('');
  const [type, setType] = useState<'reuniao' | 'visita'>('reuniao');
  const [preferredDate, setPreferredDate] = useState('');
  const [preferredTime, setPreferredTime] = useState('');
  const [companyUnitId, setCompanyUnitId] = useState('');
  const [motivo, setMotivo] = useState('');

  function loadAll() {
    const token = localStorage.getItem('montese_token');
    Promise.all([
      fetch('/api/tenant-technicians/minha-empresa', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/company-units', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/visits', { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(async ([techRes, unitsRes, visitsRes]) => {
        if (techRes.ok) setTechnicians(await techRes.json());
        if (unitsRes.ok) setUnits(await unitsRes.json());
        if (visitsRes.ok) setVisits(await visitsRes.json());
        setLoading(false);
      })
      .catch(() => {
        setError('Não foi possível carregar a página.');
        setLoading(false);
      });
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function handleSolicitar() {
    if (!technicianUserId) {
      setError('Selecione um técnico ou parceiro.');
      return;
    }
    if (type === 'visita' && !companyUnitId) {
      setError('Selecione a filial para uma visita.');
      return;
    }
    setCreating(true);
    setError('');
    const token = localStorage.getItem('montese_token');
    const res = await fetch('/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        technician_user_id: technicianUserId,
        type,
        preferred_date: preferredDate || undefined,
        preferred_time: preferredTime || undefined,
        company_unit_id: type === 'visita' ? companyUnitId : undefined,
        motivo: motivo || undefined,
      }),
    });
    if (res.ok) {
      setPreferredDate('');
      setPreferredTime('');
      setMotivo('');
      loadAll();
    } else {
      setError('Não foi possível enviar o pedido.');
    }
    setCreating(false);
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Reuniões e Visitas</h1>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Solicitar reunião ou visita</h2>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Técnico ou parceiro
            <select
              value={technicianUserId}
              onChange={(e) => setTechnicianUserId(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              <option value="">Selecione</option>
              {technicians.map((t) => (
                <option key={t.user_id} value={t.user_id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tipo
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'reuniao' | 'visita')}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              <option value="reuniao">Reunião (virtual, com Google Meet)</option>
              <option value="visita">Visita (presencial)</option>
            </select>
          </label>
          {type === 'visita' && (
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Filial
              <select
                value={companyUnitId}
                onChange={(e) => setCompanyUnitId(e.target.value)}
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
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1 text-sm text-brand-900">
              Data preferida
              <input
                type="date"
                value={preferredDate}
                onChange={(e) => setPreferredDate(e.target.value)}
                className="rounded-md border border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm text-brand-900">
              Horário preferido
              <input
                type="time"
                value={preferredTime}
                onChange={(e) => setPreferredTime(e.target.value)}
                className="rounded-md border border-brand-100 px-3 py-2"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Motivo
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Descreva o motivo (opcional)"
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <button
            onClick={handleSolicitar}
            disabled={creating}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {creating ? 'Enviando...' : 'Solicitar'}
          </button>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold text-brand-900">Suas solicitações</h2>
        {visits.length === 0 ? (
          <p className="mt-2 text-sm text-brand-700">Nenhuma solicitação ainda.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {visits.map((visit) => (
              <li key={visit.id} className="rounded-md border border-brand-100 p-3 text-sm text-brand-700">
                <span className="font-medium text-brand-900">{STATUS_LABELS[visit.status]}</span> —{' '}
                {visit.type === 'reuniao' ? 'Reunião' : 'Visita'} —{' '}
                {visit.confirmed_date ?? visit.preferred_date} {visit.confirmed_time ?? visit.preferred_time ?? ''}
                {visit.motivo ? ` — ${visit.motivo}` : ''}
                {visit.google_meet_link && (
                  <a
                    href={visit.google_meet_link}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 font-medium text-brand-500 hover:underline"
                  >
                    Entrar no Meet
                  </a>
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

- [ ] **Step 4: Tipos**

Run: `cd /opt/Montese/frontend && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Build de produção**

Run: `cd /opt/Montese/frontend && npx next build`
Expected: build limpo, sem erro de tipo nem de rota.

- [ ] **Step 6: Commit**

```bash
cd /opt/Montese
git add frontend/src/components/EmpresaSidebar.tsx \
  frontend/src/app/empresa/agendamentos/page.tsx
git commit -m "feat: tela de solicitação de reunião/visita (lado empresa)"
```

- [ ] **Step 7: Verificação manual real em produção via Playwright (cobre Tasks 4 e 5 juntas)**

Depois do redeploy (backend + frontend, autorização do fundador necessária a cada deploy) **e** depois de o fundador ter configurado `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_TOKEN_ENCRYPTION_KEY` em produção (ver "Pré-requisito externo" no topo deste plano):

1. Como empresa: solicite uma reunião com um técnico vinculado, sem preencher filial (tipo reunião). Confirme que aparece na lista "Suas solicitações" com status "Aguardando confirmação".
2. Solicite uma visita sem escolher filial — confirme que a UI bloqueia antes de mandar a request (mensagem "Selecione a filial").
3. Solicite a visita de novo, agora escolhendo a filial. Confirme que aparece na lista.
4. Como técnico: acesse "Agenda" — confirme que os 2 pedidos aparecem em "Pedidos pendentes de confirmar", com o tipo certo.
5. Confirme um deles com uma data/hora diferente da sugerida — confirme que ele desaparece de "pendentes" e aparece em "Próximos compromissos" com a data/hora que você digitou (não a original).
6. Acesse "Configurações" e conecte uma conta Google real de teste — confirme o redirect pro consentimento do Google, o retorno bem-sucedido, e o e-mail aparecendo como conectado.
7. Confirme o segundo pedido (tipo reunião) agora com o Google já conectado — confirme que aparece um link "Entrar no Meet" tanto na tela do técnico quanto na lista da empresa, e que o link abre um Google Meet real.
8. Confirme que "Vencimentos" (antiga "Agenda") continua mostrando os vencimentos de documentos/EPI normalmente, sem misturar com compromissos.
9. Console do navegador sem erro em todas as verificações.

---

## Self-Review

**1. Cobertura da spec:** §1 (objetivo) coberto pelas 5 tasks. §2 (decisões) — OAuth individual (Task 2), empresa solicita/técnico confirma com horário diferente (Task 1, já herdado do código existente), tipo escolhido pela empresa (Task 1/5), evento automático ao confirmar (Task 3), só técnico conecta Google (Task 2/4, controller `@Roles('tecnico')` nunca inclui parceiro), sem sync de volta (não implementado em nenhuma task, correto — está fora de escopo), renomear "Agenda"→"Vencimentos" (Task 4). §3 (modelo de dados) — migrations 0047/0048 (Tasks 1/2). §4 (backend) — DTOs/endpoint/módulo Google/confirm() (Tasks 1/2/3). §5 (frontend) — Tasks 4/5. §6 (pré-requisito externo) — documentado no topo do plano, não uma task, com os 3 valores de `.env` explícitos. §7 (testes) — e2e reais em cada task backend, Playwright manual no Step 7 da Task 5. §8 (fora de escopo) — nenhuma task implementa disponibilidade real, sync de volta, ou parceiro conectando Google.

**2. Placeholder scan:** nenhum "TBD"/"TODO" nas tasks. O único ponto que pede atenção do implementador em vez de dar código pronto é o `require('@nestjs/common').Logger` na Task 3 (uma nota explícita de como integrar corretamente, não uma lacuna) e a nota sobre `withTenantContext({role: 'admin'}, ...)` na Task 2 (pede confirmação da assinatura real antes de aplicar — igual ao que outras tasks deste projeto já fizeram quando a assinatura exata de um helper não estava 100% memorizada).

**3. Consistência de tipos:** `VisitRequest` (Task 1) é usado identicamente pela Task 3 (`confirmed.type`, `confirmed.company_unit_id`) e pelo frontend (Tasks 4/5, mesmos nomes de campo). `GoogleCalendarClient`/`GOOGLE_CALENDAR_CLIENT` (Task 2) são consumidos sem alteração pela Task 3. `CreateEventParams`/`CreateGoogleEventResult` (Task 2) batem com o que a Task 3 passa/recebe de `createEvent`. `LinkedTechnician` (Task 1) bate com a interface `Technician` do frontend da Task 5 (mesmos 3 campos).
