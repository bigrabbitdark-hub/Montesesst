# Gestão da brigada de incêndio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastro de brigadistas vinculados a funcionários já cadastrados, rastreio de treinamento/reciclagem, e um painel de cobertura por filial ("X necessários, Y treinados..."), integrado ao dashboard já existente.

**Architecture:** Módulo novo `backend/src/fire-brigade/` (uma tabela de membros + uma de treinamentos + uma de meta de cobertura, um service/controller só — mesmo padrão de arquivo único que `EpiService`/`EpisController` já usam pra CRUD + sub-recurso aninhado) + integração no `DashboardService.getSummary` já existente (mesmo padrão do sub-projeto A) + página nova de frontend.

**Tech Stack:** NestJS + `pg` (Postgres real, RLS), Next.js/React (fetch direto), reaproveita `DocumentsService.upload()` já existente pra certificado de treinamento (não R2 direto — certificado é um documento, mesmo padrão de `cipa_trainings.certificado_document_id`).

**Spec:** `docs/specs/prevencao-emergencia-brigada.md`

## Global Constraints

- Brigadista é vinculado a um funcionário já cadastrado (`employee_id`, obrigatório) — não um cadastro à parte com nome livre.
- Sem entidade "brigada" própria com ciclo/mandato — lista plana de membros por filial.
- `funcao_brigada` é lista fechada: `'lider' | 'vice_lider' | 'brigadista'`.
- Treinamento de brigada tem tabela própria (`fire_brigade_trainings`), não reaproveita `cipa_trainings`.
- `telefone`/`turno` são campos próprios do vínculo com a brigada (texto livre), não puxados de `employees`/`users`.
- Mesmos papéis do sub-projeto A: `@Roles('empresa', 'tecnico', 'parceiro')` pra criar/editar; `+'admin'` pra apagar membro. Resolução de `tenant_id`: `tecnico`/`parceiro` mandam no body, `empresa` usa o do próprio token.
- Janela de "vencendo" é 30 dias (mesma escolha do sub-projeto A) — **não** os 60 dias que `cipa_trainings` usa; são domínios diferentes, cada um com sua própria janela já decidida.
- "Vencendo"/"vencido" usam a MAIOR `data_validade` entre todos os treinamentos do membro, não o mais recente por `data_realizacao`.
- Número "necessário" do painel é definido manualmente por filial, nunca calculado.
- Vagas necessárias = `max(0, necessários - treinados)`.
- Integra com o dashboard já existente, mesmo formato do sub-projeto A: vencido → `atencao` com `prioridade: 'alta'`; vencendo → `media`. A fonte percorre TODAS as filiais do tenant, não uma só.

---

### Task 1: Migration + cadastro de brigadista (CRUD de membro)

**Files:**
- Create: `backend/db/migrations/0037_fire_brigade.sql`
- Create: `backend/src/fire-brigade/fire-brigade.service.ts`
- Create: `backend/src/fire-brigade/fire-brigade.controller.ts`
- Create: `backend/src/fire-brigade/fire-brigade.module.ts`
- Create: `backend/src/fire-brigade/dto/create-fire-brigade-member.dto.ts`
- Create: `backend/src/fire-brigade/dto/update-fire-brigade-member.dto.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/fire-brigade.e2e-spec.ts`

**Interfaces:**
- Produces: `FUNCAO_BRIGADA_VALUES` (const array), `FuncaoBrigada`, `FireBrigadeMember` interface, `FireBrigadeService.createMember/findMembers/findMember/updateMember/removeMember`. Task 2 estende o MESMO arquivo de service/controller com os métodos de treinamento/cobertura. Task 3 consome `FireBrigadeService` (método novo que a Task 2 adiciona). Task 4 consome os endpoints HTTP.

- [ ] **Step 1: Escrever a migration**

Cria `backend/db/migrations/0037_fire_brigade.sql`:

```sql
-- Prevenção e Emergência, sub-projeto B: gestão da brigada de incêndio.
-- Ver docs/specs/prevencao-emergencia-brigada.md. Lista plana de
-- membros por filial, sem ciclo/mandato (diferente de cipa_members) —
-- brigadista é sempre um funcionário já cadastrado (employee_id).

CREATE TABLE fire_brigade_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  funcao_brigada TEXT NOT NULL CHECK (funcao_brigada IN ('lider', 'vice_lider', 'brigadista')),
  turno TEXT,
  telefone TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id)
);
CREATE INDEX fire_brigade_members_company_unit_idx ON fire_brigade_members (company_unit_id);
CREATE TRIGGER trg_fire_brigade_members_updated_at BEFORE UPDATE ON fire_brigade_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE fire_brigade_trainings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- CASCADE, não RESTRICT como cipa_trainings.employee_id — aqui o
  -- "dono" do histórico é o vínculo com a brigada, não o funcionário
  -- em si. Se o brigadista sai da brigada, o histórico de treinamento
  -- de brigada não tem mais sentido isolado.
  member_id UUID NOT NULL REFERENCES fire_brigade_members(id) ON DELETE CASCADE,
  data_realizacao DATE NOT NULL,
  data_validade DATE NOT NULL,
  carga_horaria INT,
  certificado_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fire_brigade_trainings_member_idx ON fire_brigade_trainings (member_id);
CREATE INDEX fire_brigade_trainings_validade_idx ON fire_brigade_trainings (data_validade);
CREATE TRIGGER trg_fire_brigade_trainings_updated_at BEFORE UPDATE ON fire_brigade_trainings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE fire_brigade_coverage_targets (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  quantidade_necessaria INT NOT NULL DEFAULT 0 CHECK (quantidade_necessaria >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_unit_id)
);
CREATE TRIGGER trg_fire_brigade_coverage_targets_updated_at BEFORE UPDATE ON fire_brigade_coverage_targets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE fire_brigade_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_brigade_members FORCE ROW LEVEL SECURITY;
CREATE POLICY fire_brigade_members_isolation ON fire_brigade_members USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE fire_brigade_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_brigade_trainings FORCE ROW LEVEL SECURITY;
CREATE POLICY fire_brigade_trainings_isolation ON fire_brigade_trainings USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE fire_brigade_coverage_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_brigade_coverage_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY fire_brigade_coverage_targets_isolation ON fire_brigade_coverage_targets USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
```

- [ ] **Step 2: Aplicar a migration**

Run: `docker compose exec backend npm run db:migrate` (ou `docker compose run --rm backend npm run db:migrate` se o container não estiver de pé)
Expected: `[apply] 0037_fire_brigade.sql` seguido de `[ok]` / `Migrations concluídas.`

- [ ] **Step 3: Escrever o service (CRUD de membro)**

Cria `backend/src/fire-brigade/fire-brigade.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { buildSafeSetClause } from '../common/safe-update.util';
import { DocumentsService } from '../documents/documents.service';

export const FUNCAO_BRIGADA_VALUES = ['lider', 'vice_lider', 'brigadista'] as const;
export type FuncaoBrigada = (typeof FUNCAO_BRIGADA_VALUES)[number];

const VENCENDO_WINDOW_DAYS = 30;

export interface FireBrigadeMemberRow {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  employee_id: string;
  funcao_brigada: FuncaoBrigada;
  turno: string | null;
  telefone: string | null;
  status: 'ativo' | 'inativo';
  created_at: string;
  updated_at: string;
}

export interface FireBrigadeMember extends FireBrigadeMemberRow {
  employee_full_name: string;
  position_name: string | null;
}

interface CreateMemberData {
  tenantId: string;
  companyUnitId: string;
  employeeId: string;
  funcaoBrigada: FuncaoBrigada;
  turno?: string;
  telefone?: string;
}

interface UpdateMemberData {
  company_unit_id?: string;
  funcao_brigada?: string;
  turno?: string;
  telefone?: string;
  status?: string;
}

const MEMBER_UPDATABLE_FIELDS = ['company_unit_id', 'funcao_brigada', 'turno', 'telefone', 'status'] as const;

export type BrigadeMemberTrainingStatus = 'vencido' | 'vencendo' | 'treinado';

export function classifyBrigadeTrainingStatus(maxDataValidade: string | Date | null): BrigadeMemberTrainingStatus {
  if (!maxDataValidade) return 'vencido';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const validade = new Date(maxDataValidade);
  validade.setHours(0, 0, 0, 0);
  const diffDays = Math.round((validade.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'vencido';
  if (diffDays <= VENCENDO_WINDOW_DAYS) return 'vencendo';
  return 'treinado';
}

const MEMBER_SELECT = `
  SELECT m.*, e.full_name AS employee_full_name, p.name AS position_name
  FROM fire_brigade_members m
  JOIN employees e ON e.id = m.employee_id
  LEFT JOIN positions p ON p.id = e.position_id
`;

@Injectable()
export class FireBrigadeService {
  constructor(private readonly documents: DocumentsService) {}

  private async assertCompanyUnitBelongsToTenant(client: PoolClient, companyUnitId: string, tenantId: string): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (result.rowCount === 0) throw new BadRequestException('Filial não encontrada');
  }

  async createMember(client: PoolClient, data: CreateMemberData): Promise<FireBrigadeMember> {
    await this.assertCompanyUnitBelongsToTenant(client, data.companyUnitId, data.tenantId);

    const empCheck = await client.query<{ full_name: string }>(
      `SELECT full_name FROM employees WHERE id = $1 AND tenant_id = $2 AND status = 'ativo'`,
      [data.employeeId, data.tenantId],
    );
    if (empCheck.rowCount === 0) {
      throw new BadRequestException('Funcionário informado não pertence a este tenant ou não está ativo');
    }

    try {
      const result = await client.query<{ id: string }>(
        `INSERT INTO fire_brigade_members (tenant_id, company_unit_id, employee_id, funcao_brigada, turno, telefone)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [data.tenantId, data.companyUnitId, data.employeeId, data.funcaoBrigada, data.turno ?? null, data.telefone ?? null],
      );
      return this.findMember(client, result.rows[0].id);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findMembers(
    client: PoolClient,
    filters: { tenantId?: string; companyUnitId?: string; status?: string },
  ): Promise<FireBrigadeMember[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filters.tenantId) {
      values.push(filters.tenantId);
      conditions.push(`m.tenant_id = $${values.length}`);
    }
    if (filters.companyUnitId) {
      values.push(filters.companyUnitId);
      conditions.push(`m.company_unit_id = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      conditions.push(`m.status = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await client.query<FireBrigadeMember>(`${MEMBER_SELECT} ${where} ORDER BY e.full_name`, values);
    return result.rows;
  }

  async findMember(client: PoolClient, id: string): Promise<FireBrigadeMember> {
    const result = await client.query<FireBrigadeMember>(`${MEMBER_SELECT} WHERE m.id = $1`, [id]);
    const member = result.rows[0];
    if (!member) throw new NotFoundException('Brigadista não encontrado');
    return member;
  }

  async updateMember(client: PoolClient, id: string, data: UpdateMemberData): Promise<FireBrigadeMember> {
    if (data.company_unit_id) {
      const existing = await client.query<{ tenant_id: string }>('SELECT tenant_id FROM fire_brigade_members WHERE id = $1', [
        id,
      ]);
      if (existing.rowCount === 0) throw new NotFoundException('Brigadista não encontrado');
      await this.assertCompanyUnitBelongsToTenant(client, data.company_unit_id, existing.rows[0].tenant_id);
    }
    const { setClauses, values } = buildSafeSetClause(data, MEMBER_UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findMember(client, id);

    const result = await client.query<{ id: string }>(
      `UPDATE fire_brigade_members SET ${setClauses.join(', ')} WHERE id = $1 RETURNING id`,
      [id, ...values],
    );
    if (result.rowCount === 0) throw new NotFoundException('Brigadista não encontrado');
    return this.findMember(client, id);
  }

  async removeMember(client: PoolClient, id: string): Promise<void> {
    const result = await client.query('DELETE FROM fire_brigade_members WHERE id = $1', [id]);
    if (result.rowCount === 0) throw new NotFoundException('Brigadista não encontrado');
  }
}
```

- [ ] **Step 4: Criar os DTOs**

Cria `backend/src/fire-brigade/dto/create-fire-brigade-member.dto.ts`:

```typescript
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { FUNCAO_BRIGADA_VALUES } from '../fire-brigade.service';

export class CreateFireBrigadeMemberDto {
  @IsUUID()
  employee_id: string;

  @IsUUID()
  company_unit_id: string;

  @IsIn(FUNCAO_BRIGADA_VALUES)
  funcao_brigada: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  turno?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefone?: string;

  // Só é lido quando quem envia é role 'tecnico' ou 'parceiro' (empresa
  // sempre usa o próprio tenant_id do token) — mesmo padrão de
  // CreateFireSafetyEquipmentDto/CreateEpiDto.
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
```

Cria `backend/src/fire-brigade/dto/update-fire-brigade-member.dto.ts`:

```typescript
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { FUNCAO_BRIGADA_VALUES } from '../fire-brigade.service';

export class UpdateFireBrigadeMemberDto {
  @IsOptional()
  @IsUUID()
  company_unit_id?: string;

  @IsOptional()
  @IsIn(FUNCAO_BRIGADA_VALUES)
  funcao_brigada?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  turno?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefone?: string;

  @IsOptional()
  @IsIn(['ativo', 'inativo'])
  status?: string;
}
```

- [ ] **Step 5: Escrever o controller (rotas de membro)**

Cria `backend/src/fire-brigade/fire-brigade.controller.ts`:

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
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { FireBrigadeService, FuncaoBrigada } from './fire-brigade.service';
import { CreateFireBrigadeMemberDto } from './dto/create-fire-brigade-member.dto';
import { UpdateFireBrigadeMemberDto } from './dto/update-fire-brigade-member.dto';

@Controller('fire-brigade')
export class FireBrigadeController {
  constructor(private readonly brigade: FireBrigadeService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('members')
  createMember(@Body() dto: CreateFireBrigadeMemberDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.brigade.createMember(client, {
        tenantId,
        companyUnitId: dto.company_unit_id,
        employeeId: dto.employee_id,
        funcaoBrigada: dto.funcao_brigada as FuncaoBrigada,
        turno: dto.turno,
        telefone: dto.telefone,
      }),
    );
  }

  @Get('members')
  findMembers(
    @Query('tenant_id') tenantId: string | undefined,
    @Query('company_unit_id') companyUnitId: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) =>
      this.brigade.findMembers(client, { tenantId, companyUnitId, status }),
    );
  }

  @Get('members/:id')
  findMember(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.brigade.findMember(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch('members/:id')
  updateMember(@Param('id') id: string, @Body() dto: UpdateFireBrigadeMemberDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.brigade.updateMember(client, id, dto));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Delete('members/:id')
  removeMember(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.brigade.removeMember(client, id));
  }
}
```

- [ ] **Step 6: Escrever o module e registrar no app**

Cria `backend/src/fire-brigade/fire-brigade.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { FireBrigadeController } from './fire-brigade.controller';
import { FireBrigadeService } from './fire-brigade.service';

@Module({
  imports: [DocumentsModule],
  controllers: [FireBrigadeController],
  providers: [FireBrigadeService],
  exports: [FireBrigadeService],
})
export class FireBrigadeModule {}
```

Em `backend/src/app.module.ts`, adiciona o import junto dos demais módulos de domínio:
```typescript
import { FireBrigadeModule } from './fire-brigade/fire-brigade.module';
```
E no array `imports` do `@Module`:
```typescript
    FireBrigadeModule,
```

- [ ] **Step 7: Escrever o teste e2e**

Cria `backend/test/fire-brigade.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Brigada de incêndio (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let employeeId: string;
  let companyUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Brigada');
    tenantId = tenant.tenantId;
    employeeId = tenant.employeeId;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = login.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial Matriz', 'Rua A', 'Cidade A', 'RS', '90000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cadastra um brigadista vinculado a um funcionário já existente', async () => {
    const res = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({
        employee_id: employeeId,
        company_unit_id: companyUnitId,
        funcao_brigada: 'lider',
        turno: 'Manhã',
        telefone: '51999999999',
      });

    expect(res.status).toBe(201);
    expect(res.body.funcao_brigada).toBe('lider');
    expect(res.body.employee_full_name).toBeTruthy();
  });

  it('rejeita employee_id de outro tenant', async () => {
    const otherTenant = await db.createTenantWithUser('Empresa Brigada Outro Tenant');

    const res = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({
        employee_id: otherTenant.employeeId,
        company_unit_id: companyUnitId,
        funcao_brigada: 'brigadista',
      });

    expect(res.status).toBe(400);
  });

  it('rejeita cadastrar o mesmo funcionário duas vezes (UNIQUE tenant_id+employee_id)', async () => {
    const tenant2 = await db.createTenantWithUser('Empresa Brigada Duplicidade');
    const unit2 = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial 2', 'Rua B', 'Cidade B', 'SC', '88000000') RETURNING id`,
      [tenant2.tenantId],
    );
    const login2 = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant2.email, password: tenant2.password });
    const token2 = login2.body.access_token;

    const first = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token2}`)
      .send({ employee_id: tenant2.employeeId, company_unit_id: unit2.rows[0].id, funcao_brigada: 'brigadista' });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token2}`)
      .send({ employee_id: tenant2.employeeId, company_unit_id: unit2.rows[0].id, funcao_brigada: 'lider' });
    expect(second.status).toBe(409);
  });

  it('lista, edita e apaga um brigadista', async () => {
    const created = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ employee_id: employeeId, company_unit_id: companyUnitId, funcao_brigada: 'vice_lider' });

    // Este teste roda depois do primeiro (mesmo employeeId já usado) —
    // então esperamos 409 aqui e reaproveitamos o membro já criado no
    // primeiro teste pra exercitar list/edit/delete.
    const listRes = await request(app.getHttpServer())
      .get(`/fire-brigade/members?company_unit_id=${companyUnitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThan(0);
    const memberId = listRes.body[0].id;

    const updateRes = await request(app.getHttpServer())
      .patch(`/fire-brigade/members/${memberId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ turno: 'Tarde' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.turno).toBe('Tarde');

    const deleteRes = await request(app.getHttpServer())
      .delete(`/fire-brigade/members/${memberId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.status).toBe(200);

    const findRes = await request(app.getHttpServer())
      .get(`/fire-brigade/members/${memberId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(findRes.status).toBe(404);
  });

  it('tecnico cadastra brigadista informando tenant_id no body', async () => {
    const technicianUser = await db.createUserWithRole('tecnico', 'Tecnico Brigada');
    await (db as any).client.query(
      `INSERT INTO technicians (user_id) VALUES ($1)`,
      [technicianUser.userId],
    );
    const technicianRow = await (db as any).client.query('SELECT id FROM technicians WHERE user_id = $1', [
      technicianUser.userId,
    ]);
    await (db as any).client.query(`INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)`, [
      tenantId,
      technicianRow.rows[0].id,
    ]);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: technicianUser.email, password: technicianUser.password });
    const technicianToken = login.body.access_token;

    const employee2 = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Segundo Funcionário', '12345678901', 'ativo') RETURNING id`,
      [tenantId],
    );

    const res = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({
        employee_id: employee2.rows[0].id,
        company_unit_id: companyUnitId,
        funcao_brigada: 'brigadista',
        tenant_id: tenantId,
      });

    expect(res.status).toBe(201);
    expect(res.body.tenant_id).toBe(tenantId);

    await (db as any).client.query('DELETE FROM tenant_technicians WHERE technician_id = $1', [technicianRow.rows[0].id]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianRow.rows[0].id]);
  });
});
```

- [ ] **Step 8: Rodar o teste, confirmar que passa**

Criar `docker-compose.override.yml` (mesmo padrão de sempre — bind mount `./backend:/app` + volume nomeado `/app/node_modules` + `NODE_ENV: development` + `TEST_SUPERUSER_DATABASE_URL`).

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- fire-brigade"`
Expected: `Tests: 5 passed, 5 total`

- [ ] **Step 9: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/db/migrations/0037_fire_brigade.sql backend/src/fire-brigade backend/src/app.module.ts backend/test/fire-brigade.e2e-spec.ts
git commit -m "feat: cadastro de brigadista vinculado a funcionário já cadastrado"
```

---

### Task 2: Treinamento de brigadista + painel de cobertura + meta

**Files:**
- Modify: `backend/src/fire-brigade/fire-brigade.service.ts`
- Modify: `backend/src/fire-brigade/fire-brigade.controller.ts`
- Create: `backend/src/fire-brigade/dto/create-fire-brigade-training.dto.ts`
- Create: `backend/src/fire-brigade/dto/set-coverage-target.dto.ts`
- Test: `backend/test/fire-brigade.e2e-spec.ts` (mesmo arquivo da Task 1)

**Interfaces:**
- Consumes: `FireBrigadeService` (Task 1, mesmo arquivo — estendido aqui), `DocumentsService.upload` (já existente, injetado no Task 1's module).
- Produces: `FireBrigadeService.createTraining/findTrainings/getCoverage/getMembersWithTrainingStatus/upsertCoverageTarget`, interface `MemberTrainingStatus { id, company_unit_id, employee_full_name, status: BrigadeMemberTrainingStatus }`, interface `CoverageSummary { necessarios, ativos, treinados, vencendo, vencido, vagas_necessarias }`. Task 3 consome `getMembersWithTrainingStatus(client, { tenantId })` diretamente. Task 4 consome os endpoints HTTP novos.

- [ ] **Step 1: Expor o status de treinamento na listagem de membros**

O frontend (Task 4) precisa mostrar 🟢/🟡/🔴 por brigadista na tabela — a Task 1 ainda não expõe isso, já que `fire_brigade_trainings` só passa a ser usado a partir desta task. Em `backend/src/fire-brigade/fire-brigade.service.ts`, troca:

```typescript
export interface FireBrigadeMember extends FireBrigadeMemberRow {
  employee_full_name: string;
  position_name: string | null;
}
```
Por:
```typescript
export interface FireBrigadeMember extends FireBrigadeMemberRow {
  employee_full_name: string;
  position_name: string | null;
  training_status: BrigadeMemberTrainingStatus;
}
```

Troca:
```typescript
const MEMBER_SELECT = `
  SELECT m.*, e.full_name AS employee_full_name, p.name AS position_name
  FROM fire_brigade_members m
  JOIN employees e ON e.id = m.employee_id
  LEFT JOIN positions p ON p.id = e.position_id
`;
```
Por:
```typescript
const MEMBER_SELECT = `
  SELECT m.*, e.full_name AS employee_full_name, p.name AS position_name,
    (SELECT MAX(t.data_validade) FROM fire_brigade_trainings t WHERE t.member_id = m.id) AS max_data_validade
  FROM fire_brigade_members m
  JOIN employees e ON e.id = m.employee_id
  LEFT JOIN positions p ON p.id = e.position_id
`;

type FireBrigadeMemberQueryRow = FireBrigadeMemberRow & {
  employee_full_name: string;
  position_name: string | null;
  max_data_validade: string | Date | null;
};

function withTrainingStatus(row: FireBrigadeMemberQueryRow): FireBrigadeMember {
  const { max_data_validade, ...member } = row;
  return { ...member, training_status: classifyBrigadeTrainingStatus(max_data_validade) };
}
```

Troca (dentro de `findMembers`):
```typescript
    const result = await client.query<FireBrigadeMember>(`${MEMBER_SELECT} ${where} ORDER BY e.full_name`, values);
    return result.rows;
```
Por:
```typescript
    const result = await client.query<FireBrigadeMemberQueryRow>(`${MEMBER_SELECT} ${where} ORDER BY e.full_name`, values);
    return result.rows.map(withTrainingStatus);
```

Troca (dentro de `findMember`):
```typescript
  async findMember(client: PoolClient, id: string): Promise<FireBrigadeMember> {
    const result = await client.query<FireBrigadeMember>(`${MEMBER_SELECT} WHERE m.id = $1`, [id]);
    const member = result.rows[0];
    if (!member) throw new NotFoundException('Brigadista não encontrado');
    return member;
  }
```
Por:
```typescript
  async findMember(client: PoolClient, id: string): Promise<FireBrigadeMember> {
    const result = await client.query<FireBrigadeMemberQueryRow>(`${MEMBER_SELECT} WHERE m.id = $1`, [id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Brigadista não encontrado');
    return withTrainingStatus(row);
  }
```

- [ ] **Step 2: Estender o service com treinamento, cobertura e meta**

Em `backend/src/fire-brigade/fire-brigade.service.ts`, adiciona uma interface local logo abaixo dos imports do topo do arquivo — `documents.service.ts` declara o mesmo shape como uma interface privada, não exportada (mesmo padrão já usado por `sanitizeFileName` nesse arquivo: nenhum helper trivial de uso único é exportado), então este módulo precisa da sua própria cópia:

```typescript
interface UploadFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}
```

Adiciona as interfaces e métodos novos ao final da classe `FireBrigadeService` (antes do `}` de fechamento):

```typescript
export interface FireBrigadeTraining {
  id: string;
  tenant_id: string;
  member_id: string;
  data_realizacao: string;
  data_validade: string;
  carga_horaria: number | null;
  certificado_document_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemberTrainingStatus {
  id: string;
  company_unit_id: string;
  employee_full_name: string;
  status: BrigadeMemberTrainingStatus;
}

export interface CoverageSummary {
  necessarios: number;
  ativos: number;
  treinados: number;
  vencendo: number;
  vencido: number;
  vagas_necessarias: number;
}
```

(Essas interfaces ficam no nível do módulo, fora da classe — coloque-as imediatamente acima de `@Injectable()\nexport class FireBrigadeService`.)

Dentro da classe `FireBrigadeService`, adiciona os métodos:

```typescript
  async createTraining(
    client: PoolClient,
    memberId: string,
    userId: string,
    userRole: 'empresa' | 'tecnico' | 'parceiro',
    data: {
      dataRealizacao: string;
      dataValidade: string;
      cargaHoraria?: number;
      file?: UploadFile;
    },
  ): Promise<FireBrigadeTraining> {
    const member = await this.findMember(client, memberId);

    let certificadoDocumentId: string | null = null;
    if (data.file) {
      const document = await this.documents.upload(client, {
        tenantId: member.tenant_id,
        category: 'treinamento',
        title: `Certificado — Brigada de incêndio — ${member.employee_full_name}`,
        file: data.file,
        uploadedByUserId: userId,
        uploadedByRole: userRole,
      });
      certificadoDocumentId = document.id;
    }

    try {
      const result = await client.query<FireBrigadeTraining>(
        `INSERT INTO fire_brigade_trainings (tenant_id, member_id, data_realizacao, data_validade, carga_horaria, certificado_document_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [member.tenant_id, memberId, data.dataRealizacao, data.dataValidade, data.cargaHoraria ?? null, certificadoDocumentId],
      );
      return result.rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async findTrainings(client: PoolClient, memberId: string): Promise<FireBrigadeTraining[]> {
    const result = await client.query<FireBrigadeTraining>(
      'SELECT * FROM fire_brigade_trainings WHERE member_id = $1 ORDER BY data_realizacao DESC',
      [memberId],
    );
    return result.rows;
  }

  async getMembersWithTrainingStatus(
    client: PoolClient,
    filters: { tenantId?: string; companyUnitId?: string },
  ): Promise<MemberTrainingStatus[]> {
    const conditions: string[] = [`m.status = 'ativo'`];
    const values: unknown[] = [];
    if (filters.tenantId) {
      values.push(filters.tenantId);
      conditions.push(`m.tenant_id = $${values.length}`);
    }
    if (filters.companyUnitId) {
      values.push(filters.companyUnitId);
      conditions.push(`m.company_unit_id = $${values.length}`);
    }
    const result = await client.query<{
      id: string;
      company_unit_id: string;
      employee_full_name: string;
      max_validade: string | null;
    }>(
      `SELECT m.id, m.company_unit_id, e.full_name AS employee_full_name, MAX(t.data_validade) AS max_validade
       FROM fire_brigade_members m
       JOIN employees e ON e.id = m.employee_id
       LEFT JOIN fire_brigade_trainings t ON t.member_id = m.id
       WHERE ${conditions.join(' AND ')}
       GROUP BY m.id, m.company_unit_id, e.full_name`,
      values,
    );
    return result.rows.map((row) => ({
      id: row.id,
      company_unit_id: row.company_unit_id,
      employee_full_name: row.employee_full_name,
      status: classifyBrigadeTrainingStatus(row.max_validade),
    }));
  }

  async getCoverage(client: PoolClient, companyUnitId: string): Promise<CoverageSummary> {
    const targetResult = await client.query<{ quantidade_necessaria: number }>(
      'SELECT quantidade_necessaria FROM fire_brigade_coverage_targets WHERE company_unit_id = $1',
      [companyUnitId],
    );
    const necessarios = targetResult.rows[0]?.quantidade_necessaria ?? 0;

    const membersStatus = await this.getMembersWithTrainingStatus(client, { companyUnitId });
    const ativos = membersStatus.length;
    const vencendo = membersStatus.filter((m) => m.status === 'vencendo').length;
    const vencido = membersStatus.filter((m) => m.status === 'vencido').length;
    const treinados = ativos - vencido;
    const vagas_necessarias = Math.max(0, necessarios - treinados);

    return { necessarios, ativos, treinados, vencendo, vencido, vagas_necessarias };
  }

  async upsertCoverageTarget(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    quantidade: number,
  ): Promise<void> {
    await this.assertCompanyUnitBelongsToTenant(client, companyUnitId, tenantId);
    await client.query(
      `INSERT INTO fire_brigade_coverage_targets (tenant_id, company_unit_id, quantidade_necessaria)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_unit_id) DO UPDATE SET quantidade_necessaria = $3, updated_at = now()`,
      [tenantId, companyUnitId, quantidade],
    );
  }
```

- [ ] **Step 3: Criar os DTOs novos**

Cria `backend/src/fire-brigade/dto/create-fire-brigade-training.dto.ts`:

```typescript
import { IsInt, IsISO8601, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFireBrigadeTrainingDto {
  @IsISO8601()
  data_realizacao: string;

  @IsISO8601()
  data_validade: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  carga_horaria?: number;
}
```

Cria `backend/src/fire-brigade/dto/set-coverage-target.dto.ts`:

```typescript
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class SetCoverageTargetDto {
  @IsUUID()
  company_unit_id: string;

  @IsInt()
  @Min(0)
  quantidade_necessaria: number;

  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
```

- [ ] **Step 4: Estender o controller com as rotas novas**

Em `backend/src/fire-brigade/fire-brigade.controller.ts`, troca os imports do topo:
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
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { FireBrigadeService, FuncaoBrigada } from './fire-brigade.service';
import { CreateFireBrigadeMemberDto } from './dto/create-fire-brigade-member.dto';
import { UpdateFireBrigadeMemberDto } from './dto/update-fire-brigade-member.dto';
import { CreateFireBrigadeTrainingDto } from './dto/create-fire-brigade-training.dto';
import { SetCoverageTargetDto } from './dto/set-coverage-target.dto';
```

Adiciona os métodos novos à classe `FireBrigadeController` (depois de `removeMember`, antes do `}` de fechamento):

```typescript
  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('members/:id/trainings')
  @UseInterceptors(FileInterceptor('certificado', { limits: { fileSize: 10 * 1024 * 1024 } }))
  createTraining(
    @Param('id') memberId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CreateFireBrigadeTrainingDto,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) =>
      this.brigade.createTraining(client, memberId, req.user.id, req.user.role, {
        dataRealizacao: dto.data_realizacao,
        dataValidade: dto.data_validade,
        cargaHoraria: dto.carga_horaria,
        file: file
          ? { buffer: file.buffer, mimetype: file.mimetype, originalname: file.originalname, size: file.size }
          : undefined,
      }),
    );
  }

  @Get('members/:id/trainings')
  findTrainings(@Param('id') memberId: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.brigade.findTrainings(client, memberId));
  }

  @Get('coverage')
  getCoverage(@Query('company_unit_id') companyUnitId: string, @Req() req: any) {
    if (!companyUnitId) throw new BadRequestException('company_unit_id é obrigatório');
    return req.withTenantContext((client: any) => this.brigade.getCoverage(client, companyUnitId));
  }

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Put('coverage-target')
  setCoverageTarget(@Body() dto: SetCoverageTargetDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.brigade.upsertCoverageTarget(client, tenantId, dto.company_unit_id, dto.quantidade_necessaria),
    );
  }
```

- [ ] **Step 5: Adicionar os testes ao arquivo da Task 1 (RED)**

No MESMO arquivo `backend/test/fire-brigade.e2e-spec.ts`, adiciona os `it(...)` abaixo dentro do `describe` já existente (antes do `});` final):

```typescript
  it('registra treinamento e o painel de cobertura reflete vencido/vencendo/treinado', async () => {
    const memberRes = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ employee_id: employeeId, company_unit_id: companyUnitId, funcao_brigada: 'brigadista' });

    // employeeId já usado em testes anteriores é rejeitado por UNIQUE —
    // então cria um funcionário novo específico pra este teste.
    const freshEmployee = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Funcionário Cobertura', '98765432100', 'ativo') RETURNING id`,
      [tenantId],
    );
    const freshMember = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ employee_id: freshEmployee.rows[0].id, company_unit_id: companyUnitId, funcao_brigada: 'brigadista' });
    expect(freshMember.status).toBe(201);
    const memberId = freshMember.body.id;

    const today = new Date();
    const past = new Date(today);
    past.setDate(past.getDate() - 400);
    const pastValidade = new Date(today);
    pastValidade.setDate(pastValidade.getDate() - 1);

    const trainingRes = await request(app.getHttpServer())
      .post(`/fire-brigade/members/${memberId}/trainings`)
      .set('Authorization', `Bearer ${token}`)
      .field('data_realizacao', past.toISOString().slice(0, 10))
      .field('data_validade', pastValidade.toISOString().slice(0, 10));
    expect(trainingRes.status).toBe(201);

    await request(app.getHttpServer())
      .put('/fire-brigade/coverage-target')
      .set('Authorization', `Bearer ${token}`)
      .send({ company_unit_id: companyUnitId, quantidade_necessaria: 5 });

    const coverageRes = await request(app.getHttpServer())
      .get(`/fire-brigade/coverage?company_unit_id=${companyUnitId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(coverageRes.status).toBe(200);
    expect(coverageRes.body.necessarios).toBe(5);
    expect(coverageRes.body.vagas_necessarias).toBeGreaterThan(0);
  });

  it('histórico de treinamento lista os registros do brigadista', async () => {
    const freshEmployee = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Funcionário Historico', '11122233344', 'ativo') RETURNING id`,
      [tenantId],
    );
    const member = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ employee_id: freshEmployee.rows[0].id, company_unit_id: companyUnitId, funcao_brigada: 'brigadista' });
    const memberId = member.body.id;

    await request(app.getHttpServer())
      .post(`/fire-brigade/members/${memberId}/trainings`)
      .set('Authorization', `Bearer ${token}`)
      .field('data_realizacao', '2026-01-01')
      .field('data_validade', '2027-01-01');

    const historyRes = await request(app.getHttpServer())
      .get(`/fire-brigade/members/${memberId}/trainings`)
      .set('Authorization', `Bearer ${token}`);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.length).toBe(1);
    expect(historyRes.body[0].data_validade).toContain('2027-01-01');
  });
```

- [ ] **Step 6: Rodar o teste, confirmar que passa**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- fire-brigade"`
Expected: `Tests: 7 passed, 7 total`

- [ ] **Step 7: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/src/fire-brigade backend/test/fire-brigade.e2e-spec.ts
git commit -m "feat: treinamento de brigadista, painel de cobertura e meta por filial"
```

---

### Task 3: Integração com o dashboard

**Files:**
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/dashboard/dashboard.module.ts`
- Test: `backend/test/fire-brigade.e2e-spec.ts` (mesmo arquivo das Tasks 1-2 — adiciona 1 teste novo)

**Interfaces:**
- Consumes: `FireBrigadeService.getMembersWithTrainingStatus(client, { tenantId })` (Task 2).
- Produces: `AttentionItem['tipo']` ganha `'brigada_incendio'`; `DashboardService.getSummary` passa a incluir brigadistas vencidos/vencendo em `atencao`/`resumo.pendencias`/`resumo.avisos`.

- [ ] **Step 1: Adicionar o teste ao arquivo das Tasks 1-2 (RED)**

No MESMO arquivo `backend/test/fire-brigade.e2e-spec.ts`, adiciona o `it(...)` abaixo dentro do `describe` já existente (antes do `});` final):

```typescript
  it('brigadista sem treinamento válido aparece no dashboard existente como item de atenção', async () => {
    const freshEmployee = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Funcionário Dashboard Brigada', '55566677788', 'ativo') RETURNING id`,
      [tenantId],
    );
    const member = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ employee_id: freshEmployee.rows[0].id, company_unit_id: companyUnitId, funcao_brigada: 'brigadista' });
    expect(member.status).toBe(201);
    // Sem nenhum treinamento cadastrado — conta como "vencido" (nunca treinou).

    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const brigadeItems = res.body.atencao.filter((i: any) => i.tipo === 'brigada_incendio');
    expect(brigadeItems.length).toBeGreaterThan(0);
    expect(brigadeItems[0].prioridade).toBe('alta');
    expect(brigadeItems[0].link).toBe('/empresa/brigada');
  });
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- fire-brigade"`
Expected: FAIL no teste novo — `brigada_incendio` nunca aparece em `atencao` ainda.

- [ ] **Step 3: `DashboardService` ganha a nova fonte**

Em `backend/src/dashboard/dashboard.service.ts`, troca:
```typescript
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DocumentsService } from '../documents/documents.service';
import { PositionsService } from '../positions/positions.service';
import { EQUIPMENT_TYPE_LABEL, FireSafetyEquipmentService } from '../fire-safety-equipment/fire-safety-equipment.service';

export type DashboardStatus = 'ok' | 'atencao' | 'critico';
export type AttentionPriority = 'alta' | 'media' | 'baixa';
export type AttentionResponsible = 'empresa' | 'tecnico';

export interface AttentionItem {
  tipo: 'documento' | 'epi' | 'acao' | 'inspecao' | 'cargo' | 'equipamento_incendio';
  titulo: string;
  prioridade: AttentionPriority;
  data: string | null;
  responsavel: AttentionResponsible;
  link: string;
}
```
Por:
```typescript
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DocumentsService } from '../documents/documents.service';
import { PositionsService } from '../positions/positions.service';
import { EQUIPMENT_TYPE_LABEL, FireSafetyEquipmentService } from '../fire-safety-equipment/fire-safety-equipment.service';
import { FireBrigadeService } from '../fire-brigade/fire-brigade.service';

export type DashboardStatus = 'ok' | 'atencao' | 'critico';
export type AttentionPriority = 'alta' | 'media' | 'baixa';
export type AttentionResponsible = 'empresa' | 'tecnico';

export interface AttentionItem {
  tipo: 'documento' | 'epi' | 'acao' | 'inspecao' | 'cargo' | 'equipamento_incendio' | 'brigada_incendio';
  titulo: string;
  prioridade: AttentionPriority;
  data: string | null;
  responsavel: AttentionResponsible;
  link: string;
}
```

Troca:
```typescript
  constructor(
    private readonly documents: DocumentsService,
    private readonly positionsService: PositionsService,
    private readonly fireSafetyEquipmentService: FireSafetyEquipmentService,
  ) {}

  async getSummary(client: PoolClient, tenantId: string): Promise<DashboardSummary> {
    const [compliance, epis, actionPlans, inspecoesPendentes, positionDivergences, fireSafetyEquipment] =
      await Promise.all([
        this.documents.getCompliance(client, tenantId),
        this.getEpiStatus(client, tenantId),
        this.getActionPlans(client, tenantId),
        this.countInspecoesPendentes(client, tenantId),
        this.positionsService.getDivergences(client, tenantId),
        this.getFireSafetyEquipmentStatus(client, tenantId),
      ]);
```
Por:
```typescript
  constructor(
    private readonly documents: DocumentsService,
    private readonly positionsService: PositionsService,
    private readonly fireSafetyEquipmentService: FireSafetyEquipmentService,
    private readonly fireBrigadeService: FireBrigadeService,
  ) {}

  async getSummary(client: PoolClient, tenantId: string): Promise<DashboardSummary> {
    const [compliance, epis, actionPlans, inspecoesPendentes, positionDivergences, fireSafetyEquipment, fireBrigade] =
      await Promise.all([
        this.documents.getCompliance(client, tenantId),
        this.getEpiStatus(client, tenantId),
        this.getActionPlans(client, tenantId),
        this.countInspecoesPendentes(client, tenantId),
        this.positionsService.getDivergences(client, tenantId),
        this.getFireSafetyEquipmentStatus(client, tenantId),
        this.getFireBrigadeStatus(client, tenantId),
      ]);
```

Dentro do array `atencao`, logo depois do `...fireSafetyEquipment.avisos.map(...)` já existente (adicionado pelo sub-projeto A), adiciona:
```typescript
      ...fireBrigade.pendencias.map((m): AttentionItem => ({
        tipo: 'brigada_incendio',
        titulo: `Brigadista sem treinamento válido: ${m.employee_full_name}`,
        prioridade: 'alta',
        data: null,
        responsavel: 'empresa',
        link: '/empresa/brigada',
      })),
      ...fireBrigade.avisos.map((m): AttentionItem => ({
        tipo: 'brigada_incendio',
        titulo: `Treinamento de brigada vencendo: ${m.employee_full_name}`,
        prioridade: 'media',
        data: null,
        responsavel: 'empresa',
        link: '/empresa/brigada',
      })),
```

Troca a linha de `pendencias`/`avisos`:
```typescript
    const pendencias =
      compliance.pendencias.length + epis.pendencias.length + positionDivergences.length + fireSafetyEquipment.pendencias.length;
    const avisos = compliance.avisos.length + epis.avisos.length + fireSafetyEquipment.avisos.length;
```
Por:
```typescript
    const pendencias =
      compliance.pendencias.length +
      epis.pendencias.length +
      positionDivergences.length +
      fireSafetyEquipment.pendencias.length +
      fireBrigade.pendencias.length;
    const avisos =
      compliance.avisos.length + epis.avisos.length + fireSafetyEquipment.avisos.length + fireBrigade.avisos.length;
```

Adiciona o método privado novo, ao lado de `getFireSafetyEquipmentStatus`:
```typescript
  private async getFireBrigadeStatus(client: PoolClient, tenantId: string) {
    const members = await this.fireBrigadeService.getMembersWithTrainingStatus(client, { tenantId });
    const pendencias = members.filter((m) => m.status === 'vencido');
    const avisos = members.filter((m) => m.status === 'vencendo');
    return { pendencias, avisos };
  }
```

- [ ] **Step 4: `DashboardModule` importa `FireBrigadeModule`**

Em `backend/src/dashboard/dashboard.module.ts`, troca:
```typescript
import { FireSafetyEquipmentModule } from '../fire-safety-equipment/fire-safety-equipment.module';

@Module({
  imports: [DocumentsModule, PositionsModule, FireSafetyEquipmentModule],
```
Por:
```typescript
import { FireSafetyEquipmentModule } from '../fire-safety-equipment/fire-safety-equipment.module';
import { FireBrigadeModule } from '../fire-brigade/fire-brigade.module';

@Module({
  imports: [DocumentsModule, PositionsModule, FireSafetyEquipmentModule, FireBrigadeModule],
```

- [ ] **Step 5: Rodar o teste, confirmar que passa**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- fire-brigade"`
Expected: `Tests: 8 passed, 8 total`

- [ ] **Step 6: Regressão de `dashboard`**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- dashboard"`
Expected: todas as suítes de `dashboard` já existentes continuam verdes — tenants sem brigadista cadastrado devem receber `fireBrigade.pendencias`/`.avisos` vazios, sem alterar nenhuma asserção existente.

- [ ] **Step 7: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/src/dashboard backend/test/fire-brigade.e2e-spec.ts
git commit -m "feat: integra brigada de incêndio no dashboard existente"
```

---

### Task 4: Frontend — página `/empresa/brigada`

**Files:**
- Create: `frontend/src/app/empresa/brigada/page.tsx`
- Create: `frontend/src/components/FireBrigadePanel.tsx`
- Modify: `frontend/src/components/EmpresaSidebar.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /api/fire-brigade/members`, `POST /api/fire-brigade/members/:id/trainings`, `GET /api/fire-brigade/members/:id/trainings`, `GET /api/fire-brigade/coverage`, `PUT /api/fire-brigade/coverage-target`, `GET /api/company-units` (já existente), `GET /api/employees` (já existente, pra popular o seletor de funcionário).

- [ ] **Step 1: Criar a página (wrapper de autenticação)**

Cria `frontend/src/app/empresa/brigada/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FireBrigadePanel } from '@/components/FireBrigadePanel';

export default function EmpresaBrigadaPage() {
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
    <div className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Brigada de incêndio</h1>
      <div className="mt-8">
        <FireBrigadePanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar o painel completo**

Cria `frontend/src/components/FireBrigadePanel.tsx`:

```typescript
'use client';

import { Fragment, FormEvent, useEffect, useState } from 'react';

interface Member {
  id: string;
  employee_id: string;
  employee_full_name: string;
  position_name: string | null;
  company_unit_id: string;
  funcao_brigada: string;
  turno: string | null;
  telefone: string | null;
  status: string;
  training_status: 'vencido' | 'vencendo' | 'treinado';
}

interface EmployeeOption {
  id: string;
  full_name: string;
  status: string;
}

interface CompanyUnitOption {
  id: string;
  name: string;
  is_matriz: boolean;
}

interface Coverage {
  necessarios: number;
  ativos: number;
  treinados: number;
  vencendo: number;
  vencido: number;
  vagas_necessarias: number;
}

const FUNCAO_LABEL: Record<string, string> = {
  lider: 'Líder',
  vice_lider: 'Vice-líder',
  brigadista: 'Brigadista',
};

const TRAINING_STATUS_LABEL: Record<Member['training_status'], { emoji: string; text: string; className: string }> = {
  treinado: { emoji: '🟢', text: 'Treinado', className: 'text-green-700' },
  vencendo: { emoji: '🟡', text: 'Vencendo', className: 'text-amber-700' },
  vencido: { emoji: '🔴', text: 'Vencido', className: 'text-red-600' },
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

export function FireBrigadePanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [units, setUnits] = useState<CompanyUnitOption[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [targetInput, setTargetInput] = useState('');

  const [employeeId, setEmployeeId] = useState('');
  const [companyUnitId, setCompanyUnitId] = useState('');
  const [funcaoBrigada, setFuncaoBrigada] = useState('brigadista');
  const [turno, setTurno] = useState('');
  const [telefone, setTelefone] = useState('');
  const [createError, setCreateError] = useState('');

  const [trainingFormMemberId, setTrainingFormMemberId] = useState<string | null>(null);
  const [trainingDataRealizacao, setTrainingDataRealizacao] = useState('');
  const [trainingDataValidade, setTrainingDataValidade] = useState('');
  const [trainingCargaHoraria, setTrainingCargaHoraria] = useState('');
  const [trainingFile, setTrainingFile] = useState<File | null>(null);
  const [trainingError, setTrainingError] = useState('');

  async function loadMembers() {
    const res = await fetch('/api/fire-brigade/members', { headers: authHeaders() });
    if (res.ok) setMembers(await res.json());
  }

  async function loadEmployees() {
    const res = await fetch('/api/employees', { headers: authHeaders() });
    if (res.ok) {
      const all: EmployeeOption[] = await res.json();
      setEmployees(all.filter((e) => e.status === 'ativo'));
    }
  }

  async function loadUnits() {
    const res = await fetch('/api/company-units', { headers: authHeaders() });
    if (res.ok) setUnits(await res.json());
  }

  async function loadCoverage(unitId: string) {
    if (!unitId) {
      setCoverage(null);
      return;
    }
    const res = await fetch(`/api/fire-brigade/coverage?company_unit_id=${unitId}`, { headers: authHeaders() });
    if (res.ok) setCoverage(await res.json());
  }

  useEffect(() => {
    loadMembers();
    loadEmployees();
    loadUnits();
  }, []);

  useEffect(() => {
    loadCoverage(selectedUnitId);
  }, [selectedUnitId]);

  useEffect(() => {
    if (!selectedUnitId && units.length > 0) {
      setSelectedUnitId(units[0].id);
    }
  }, [units, selectedUnitId]);

  function unitName(id: string): string {
    return units.find((u) => u.id === id)?.name ?? '—';
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError('');
    const res = await fetch('/api/fire-brigade/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        employee_id: employeeId,
        company_unit_id: companyUnitId,
        funcao_brigada: funcaoBrigada,
        turno: turno || undefined,
        telefone: telefone || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setCreateError(body?.message ?? 'Não foi possível cadastrar o brigadista.');
      return;
    }
    setEmployeeId('');
    setCompanyUnitId('');
    setTurno('');
    setTelefone('');
    loadMembers();
    loadCoverage(selectedUnitId);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/fire-brigade/members/${id}`, { method: 'DELETE', headers: authHeaders() });
    loadMembers();
    loadCoverage(selectedUnitId);
  }

  function openTrainingForm(memberId: string) {
    setTrainingFormMemberId(memberId);
    setTrainingDataRealizacao('');
    setTrainingDataValidade('');
    setTrainingCargaHoraria('');
    setTrainingFile(null);
    setTrainingError('');
  }

  async function handleRegisterTraining(e: FormEvent) {
    e.preventDefault();
    if (!trainingFormMemberId) return;
    setTrainingError('');

    const formData = new FormData();
    formData.append('data_realizacao', trainingDataRealizacao);
    formData.append('data_validade', trainingDataValidade);
    if (trainingCargaHoraria) formData.append('carga_horaria', trainingCargaHoraria);
    if (trainingFile) formData.append('certificado', trainingFile);

    const res = await fetch(`/api/fire-brigade/members/${trainingFormMemberId}/trainings`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setTrainingError(body?.message ?? 'Não foi possível registrar o treinamento.');
      return;
    }
    setTrainingFormMemberId(null);
    loadMembers();
    loadCoverage(selectedUnitId);
  }

  async function handleSaveTarget(e: FormEvent) {
    e.preventDefault();
    if (!selectedUnitId || !targetInput) return;
    await fetch('/api/fire-brigade/coverage-target', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ company_unit_id: selectedUnitId, quantidade_necessaria: parseInt(targetInput, 10) }),
    });
    setTargetInput('');
    loadCoverage(selectedUnitId);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-md border border-brand-100 p-4">
        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Filial
          <select
            value={selectedUnitId}
            onChange={(e) => setSelectedUnitId(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          >
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>

        {coverage && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="text-center">
              <div className="text-2xl font-bold text-brand-900">{coverage.necessarios}</div>
              <div className="text-xs text-brand-700">Necessários</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-700">{coverage.ativos}</div>
              <div className="text-xs text-brand-700">Ativos</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-700">{coverage.treinados}</div>
              <div className="text-xs text-brand-700">Treinados</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-700">{coverage.vencendo}</div>
              <div className="text-xs text-brand-700">Vencendo</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{coverage.vagas_necessarias}</div>
              <div className="text-xs text-brand-700">Vagas necessárias</div>
            </div>
          </div>
        )}

        <form onSubmit={handleSaveTarget} className="mt-4 flex items-end gap-2">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Meta de brigadistas necessários nesta filial
            <input
              type="number"
              min={0}
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              className="w-32 rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <button type="submit" className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Salvar meta
          </button>
        </form>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-md border border-brand-100 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Funcionário
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              required
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              <option value="">Selecione</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Filial
            <select
              value={companyUnitId}
              onChange={(e) => setCompanyUnitId(e.target.value)}
              required
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
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Função na brigada
            <select
              value={funcaoBrigada}
              onChange={(e) => setFuncaoBrigada(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              <option value="lider">Líder</option>
              <option value="vice_lider">Vice-líder</option>
              <option value="brigadista">Brigadista</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Turno
            <input
              value={turno}
              onChange={(e) => setTurno(e.target.value)}
              placeholder="Ex.: Manhã"
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Telefone
            <input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
        </div>
        <button
          type="submit"
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700"
        >
          Cadastrar brigadista
        </button>
        {createError && <p className="text-sm text-red-600">{createError}</p>}
      </form>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-brand-700">
            <th className="px-2 py-1">Nome</th>
            <th className="px-2 py-1">Função</th>
            <th className="px-2 py-1">Filial</th>
            <th className="px-2 py-1">Turno</th>
            <th className="px-2 py-1">Telefone</th>
            <th className="px-2 py-1">Treinamento</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <Fragment key={member.id}>
              <tr className="border-t border-brand-50">
                <td className="px-2 py-1 font-medium text-brand-900">{member.employee_full_name}</td>
                <td className="px-2 py-1">{FUNCAO_LABEL[member.funcao_brigada] ?? member.funcao_brigada}</td>
                <td className="px-2 py-1">{unitName(member.company_unit_id)}</td>
                <td className="px-2 py-1">{member.turno ?? '—'}</td>
                <td className="px-2 py-1">{member.telefone ?? '—'}</td>
                <td className={`px-2 py-1 ${TRAINING_STATUS_LABEL[member.training_status].className}`}>
                  {TRAINING_STATUS_LABEL[member.training_status].emoji} {TRAINING_STATUS_LABEL[member.training_status].text}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => openTrainingForm(member.id)}
                    className="mr-2 text-xs text-brand-700 underline"
                  >
                    Registrar treinamento
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(member.id)}
                    className="text-xs text-red-600 underline"
                  >
                    Excluir
                  </button>
                </td>
              </tr>
              {trainingFormMemberId === member.id && (
                <tr className="border-t border-brand-50 bg-brand-50/40">
                  <td colSpan={7} className="px-2 py-3">
                    <form onSubmit={handleRegisterTraining} className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1 text-sm text-brand-900">
                        Data de realização
                        <input
                          type="date"
                          required
                          value={trainingDataRealizacao}
                          onChange={(e) => setTrainingDataRealizacao(e.target.value)}
                          className="rounded-md border border-brand-100 px-3 py-2"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm text-brand-900">
                        Validade
                        <input
                          type="date"
                          required
                          value={trainingDataValidade}
                          onChange={(e) => setTrainingDataValidade(e.target.value)}
                          className="rounded-md border border-brand-100 px-3 py-2"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm text-brand-900">
                        Carga horária
                        <input
                          type="number"
                          min={0}
                          value={trainingCargaHoraria}
                          onChange={(e) => setTrainingCargaHoraria(e.target.value)}
                          className="w-24 rounded-md border border-brand-100 px-3 py-2"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm text-brand-900">
                        Certificado (opcional)
                        <input
                          type="file"
                          accept="application/pdf,image/jpeg,image/png"
                          onChange={(e) => setTrainingFile(e.target.files?.[0] ?? null)}
                        />
                      </label>
                      <button
                        type="submit"
                        className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                      >
                        Salvar
                      </button>
                      <button
                        type="button"
                        onClick={() => setTrainingFormMemberId(null)}
                        className="text-sm text-brand-700 underline"
                      >
                        Cancelar
                      </button>
                      {trainingError && <p className="w-full text-sm text-red-600">{trainingError}</p>}
                    </form>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Adicionar entrada de navegação no sidebar**

Em `frontend/src/components/EmpresaSidebar.tsx`, dentro do grupo `Segurança`, adiciona uma entrada logo depois de `{ href: '/empresa/equipamentos-incendio', label: 'Equipamentos contra incêndio', emoji: '🧯' }` (inserida pelo sub-projeto A):
```typescript
      { href: '/empresa/brigada', label: 'Brigada de incêndio', emoji: '👨‍🚒' },
```

Confirme a localização exata da entrada antes de aplicar — o grupo `Segurança` deve ter `assistente`/`documentos`/`epis`/`consulta-ca`/`inspecoes`/`mapa-sst`/`equipamentos-incendio`, nessa ordem.

- [ ] **Step 4: Deploy e confirmação do bundle real**

```bash
docker compose build frontend
docker compose up -d frontend
```

```bash
docker compose exec frontend sh -c "grep -rl 'Brigada de incêndio' .next/server/app 2>/dev/null || grep -rl 'Brigada de incêndio' .next/static/chunks 2>/dev/null"
```

Expected: pelo menos um arquivo encontrado.

- [ ] **Step 5: Verificação Playwright real**

Escreva um script Playwright (Node, scratchpad) que abre `https://montesesst.com.br/empresa/brigada` com sessão sintética (`localStorage`), mocka `GET /api/fire-brigade/members` (lista com 2 membros, um `training_status: 'vencido'` e outro `'treinado'`), `GET /api/employees` (lista com 1 funcionário ativo + 1 inativo), `GET /api/company-units` (1 filial), `GET /api/fire-brigade/coverage` (`{necessarios: 5, ativos: 2, treinados: 1, vencendo: 1, vencido: 1, vagas_necessarias: 4}`), `POST /api/fire-brigade/members` (sucesso), `POST /api/fire-brigade/members/:id/trainings` (sucesso), `PUT /api/fire-brigade/coverage-target` (sucesso), `DELETE /api/fire-brigade/members/:id` (sucesso), e confirma:

1. O painel de cobertura no topo mostra os 5 números mockados corretamente.
2. O seletor de funcionário no formulário só lista o funcionário `ativo` mockado, não o `inativo`.
3. A coluna de treinamento da tabela mostra o emoji/texto certo pra cada membro (🔴 Vencido / 🟢 Treinado).
4. Preencher e submeter o formulário de cadastro dispara `POST /api/fire-brigade/members` com o corpo certo (`employee_id`/`company_unit_id`/`funcao_brigada`/`turno`/`telefone`).
5. Clicar em "Registrar treinamento" numa linha abre o mini-formulário; preenchê-lo e submeter dispara `POST /api/fire-brigade/members/:id/trainings` como `multipart/form-data` com `data_realizacao`/`data_validade` no corpo (com e sem certificado anexado).
6. Preencher e submeter o campo de meta dispara `PUT /api/fire-brigade/coverage-target` com `company_unit_id` e `quantidade_necessaria` corretos.
7. Clicar em "Excluir" numa linha dispara `DELETE /api/fire-brigade/members/:id` com o id certo.
8. O link "Brigada de incêndio" aparece no sidebar (`EmpresaSidebar`) e aponta pra `/empresa/brigada`.

Run: script Playwright real contra a URL de produção.
Expected: todas as asserções passam.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/empresa/brigada frontend/src/components/FireBrigadePanel.tsx frontend/src/components/EmpresaSidebar.tsx
git commit -m "feat: página de brigada de incêndio + entrada no sidebar"
```
