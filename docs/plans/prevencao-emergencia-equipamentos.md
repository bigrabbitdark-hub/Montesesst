# Equipamentos contra incêndio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastro e controle de equipamentos contra incêndio (extintor, hidrante, alarme, etc.) com status calculado por data de manutenção, integrado ao dashboard já existente.

**Architecture:** Módulo novo `backend/src/fire-safety-equipment/` (tabela única, CRUD completo, upload de foto via R2 já existente — `@Global()`, sem import de módulo necessário) + integração no `DashboardService.getSummary` já existente (mesmo padrão de `getEpiStatus`) + página nova de frontend consumindo tudo isso.

**Tech Stack:** NestJS + `pg` (Postgres real, RLS), Next.js/React (fetch direto), Cloudflare R2 (upload de foto, `R2Service` já existente). Sem IA — status é calculado por data, determinístico.

**Spec:** `docs/specs/prevencao-emergencia-equipamentos.md`

## Global Constraints

- Todos os ~11 tipos de equipamento numa tabela só (não uma por tipo) — `tipo` é um CHECK constraint fechado.
- Campos de extintor (`agente_extintor`/`capacidade`/`classe_fogo`) só persistem quando `tipo = 'extintor'` — ignorados silenciosamente (não é erro) pra qualquer outro tipo.
- Status (`'regular' | 'vencendo' | 'vencido'`) é sempre CALCULADO a partir de `proxima_manutencao` (janela de 30 dias pra "vencendo", mesma janela já usada em `getEpiStatus`) — nunca persistido no banco.
- Mesmos papéis do EPI: `@Roles('empresa', 'tecnico', 'parceiro')` pra criar/editar/upload de foto; `+'admin'` pra apagar. Resolução de `tenant_id`: `tecnico`/`parceiro` mandam `tenant_id` no body (não têm tenant próprio), `empresa` sempre usa o do próprio token — mesmo padrão exato de `CreateEpiDto`/`EpisController.create`.
- RLS: mesma policy shape de `tenant_epis` (`FORCE ROW LEVEL SECURITY`, bypass de admin, visibilidade de técnico/parceiro via `assigned_tenant_ids_for_current_user()`).
- Upload de foto reaproveita `R2Service` já existente (`@Global()`, `backend/src/common/r2/r2.module.ts` — nenhum import de módulo necessário, só injetar no constructor).
- Frontend sem suíte automatizada — verificação sempre manual via Playwright contra o bundle real implantado em produção, deploy confirmado via grep no bundle ANTES de qualquer teste.
- Testes de backend: e2e reais (Postgres real via `TestDb`), nenhum mock.

---

### Task 1: Migration + CRUD backend + upload de foto

**Files:**
- Create: `backend/db/migrations/0036_fire_safety_equipment.sql`
- Create: `backend/src/fire-safety-equipment/fire-safety-equipment.service.ts`
- Create: `backend/src/fire-safety-equipment/fire-safety-equipment.controller.ts`
- Create: `backend/src/fire-safety-equipment/fire-safety-equipment.module.ts`
- Create: `backend/src/fire-safety-equipment/dto/create-fire-safety-equipment.dto.ts`
- Create: `backend/src/fire-safety-equipment/dto/update-fire-safety-equipment.dto.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/fire-safety-equipment.e2e-spec.ts`

**Interfaces:**
- Produces: `EQUIPMENT_TYPES` (const array), `EquipmentType`, `EQUIPMENT_TYPE_LABEL` (label por tipo), `EquipmentStatus`, `getEquipmentStatus(proximaManutencao): EquipmentStatus`, `FireSafetyEquipment` interface (inclui `status` calculado), `FireSafetyEquipmentService.create/findAll/findOne/update/remove/uploadFoto`. Task 2 consome `getEquipmentStatus`/`EQUIPMENT_TYPE_LABEL`/`FireSafetyEquipmentService.findAll` diretamente; Task 3 consome os 6 endpoints HTTP.

- [ ] **Step 1: Escrever a migration**

Cria `backend/db/migrations/0036_fire_safety_equipment.sql`:

```sql
-- Prevenção e Emergência, sub-projeto A: equipamentos contra incêndio.
-- Ver docs/specs/prevencao-emergencia-equipamentos.md. Uma tabela só
-- pra todos os ~11 tipos (decisão do fundador) — agente_extintor/
-- capacidade/classe_fogo só fazem sentido pra tipo='extintor', ficam
-- NULL pros demais (mesmo padrão de cipa_trainings.tipo_outro).

CREATE TABLE fire_safety_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'extintor', 'hidrante', 'mangueira', 'alarme', 'detector',
    'iluminacao_emergencia', 'saida_emergencia', 'porta_corta_fogo',
    'sprinkler', 'central_alarme', 'outro'
  )),
  codigo TEXT,
  localizacao TEXT,
  data_instalacao DATE,
  data_ultima_manutencao DATE,
  proxima_manutencao DATE,
  empresa_responsavel TEXT,
  observacoes TEXT,
  foto_r2_key TEXT,
  -- Só usados quando tipo = 'extintor'; NULL nos demais casos (mesmo
  -- padrão já usado em cipa_trainings.tipo_outro pra campo condicional).
  agente_extintor TEXT,
  capacidade TEXT,
  classe_fogo TEXT,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_fire_safety_equipment_updated_at BEFORE UPDATE ON fire_safety_equipment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE fire_safety_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_safety_equipment FORCE ROW LEVEL SECURITY;
CREATE POLICY fire_safety_equipment_isolation ON fire_safety_equipment USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
```

- [ ] **Step 2: Aplicar a migration**

Run: `docker compose exec backend npm run db:migrate` (ou `docker compose run --rm backend npm run db:migrate` se o container não estiver de pé)
Expected: `[apply] 0036_fire_safety_equipment.sql` seguido de `[ok]` / `Migrations concluídas.`

- [ ] **Step 3: Escrever o service**

Cria `backend/src/fire-safety-equipment/fire-safety-equipment.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { buildSafeSetClause } from '../common/safe-update.util';
import { R2Service } from '../common/r2/r2.service';

export const EQUIPMENT_TYPES = [
  'extintor', 'hidrante', 'mangueira', 'alarme', 'detector',
  'iluminacao_emergencia', 'saida_emergencia', 'porta_corta_fogo',
  'sprinkler', 'central_alarme', 'outro',
] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

export const EQUIPMENT_TYPE_LABEL: Record<EquipmentType, string> = {
  extintor: 'Extintor',
  hidrante: 'Hidrante',
  mangueira: 'Mangueira',
  alarme: 'Alarme',
  detector: 'Detector',
  iluminacao_emergencia: 'Iluminação de emergência',
  saida_emergencia: 'Saída de emergência',
  porta_corta_fogo: 'Porta corta-fogo',
  sprinkler: 'Sprinkler',
  central_alarme: 'Central de alarme',
  outro: 'Outro',
};

export type EquipmentStatus = 'regular' | 'vencendo' | 'vencido';

const EQUIPMENT_VENCENDO_WINDOW_DAYS = 30;

export function getEquipmentStatus(proximaManutencao: string | Date | null): EquipmentStatus {
  if (!proximaManutencao) return 'regular';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(proximaManutencao);
  dueDate.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'vencido';
  if (diffDays <= EQUIPMENT_VENCENDO_WINDOW_DAYS) return 'vencendo';
  return 'regular';
}

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'arquivo';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export interface FireSafetyEquipmentRow {
  id: string;
  tenant_id: string;
  company_unit_id: string | null;
  tipo: EquipmentType;
  codigo: string;
  localizacao: string | null;
  data_instalacao: string | null;
  data_ultima_manutencao: string | null;
  proxima_manutencao: string | null;
  empresa_responsavel: string | null;
  observacoes: string | null;
  foto_r2_key: string | null;
  agente_extintor: string | null;
  capacidade: string | null;
  classe_fogo: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface FireSafetyEquipment extends FireSafetyEquipmentRow {
  status: EquipmentStatus;
}

function withStatus(row: FireSafetyEquipmentRow): FireSafetyEquipment {
  return { ...row, status: getEquipmentStatus(row.proxima_manutencao) };
}

interface CreateEquipmentData {
  tenantId: string;
  tipo: EquipmentType;
  codigo: string;
  companyUnitId?: string;
  localizacao?: string;
  dataInstalacao?: string;
  dataUltimaManutencao?: string;
  proximaManutencao?: string;
  empresaResponsavel?: string;
  observacoes?: string;
  agenteExtintor?: string;
  capacidade?: string;
  classeFogo?: string;
  createdByUserId: string;
}

interface UpdateEquipmentData {
  tipo?: string;
  codigo?: string;
  company_unit_id?: string;
  localizacao?: string;
  data_instalacao?: string;
  data_ultima_manutencao?: string;
  proxima_manutencao?: string;
  empresa_responsavel?: string;
  observacoes?: string;
  agente_extintor?: string;
  capacidade?: string;
  classe_fogo?: string;
}

const UPDATABLE_FIELDS = [
  'tipo', 'codigo', 'company_unit_id', 'localizacao', 'data_instalacao',
  'data_ultima_manutencao', 'proxima_manutencao', 'empresa_responsavel',
  'observacoes', 'agente_extintor', 'capacidade', 'classe_fogo',
] as const;

@Injectable()
export class FireSafetyEquipmentService {
  constructor(private readonly r2: R2Service) {}

  private async assertCompanyUnitBelongsToTenant(
    client: PoolClient,
    companyUnitId: string,
    tenantId: string,
  ): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (result.rowCount === 0) throw new BadRequestException('Filial não encontrada');
  }

  async create(client: PoolClient, data: CreateEquipmentData): Promise<FireSafetyEquipment> {
    if (data.companyUnitId) {
      await this.assertCompanyUnitBelongsToTenant(client, data.companyUnitId, data.tenantId);
    }
    // Campos de extintor só fazem sentido pra tipo='extintor' — ignorados
    // silenciosamente pra qualquer outro tipo (spec, Seção 4), já que o
    // cliente pode reenviar o mesmo formulário genérico pra qualquer tipo
    // sem precisar tratar isso como erro de validação.
    const isExtintor = data.tipo === 'extintor';
    try {
      const result = await client.query<FireSafetyEquipmentRow>(
        `INSERT INTO fire_safety_equipment
           (tenant_id, company_unit_id, tipo, codigo, localizacao, data_instalacao,
            data_ultima_manutencao, proxima_manutencao, empresa_responsavel, observacoes,
            agente_extintor, capacidade, classe_fogo, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          data.tenantId,
          data.companyUnitId ?? null,
          data.tipo,
          data.codigo,
          data.localizacao ?? null,
          data.dataInstalacao ?? null,
          data.dataUltimaManutencao ?? null,
          data.proximaManutencao ?? null,
          data.empresaResponsavel ?? null,
          data.observacoes ?? null,
          isExtintor ? (data.agenteExtintor ?? null) : null,
          isExtintor ? (data.capacidade ?? null) : null,
          isExtintor ? (data.classeFogo ?? null) : null,
          data.createdByUserId,
        ],
      );
      return withStatus(result.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(
    client: PoolClient,
    tenantId?: string,
    filters?: { tipo?: string; status?: EquipmentStatus },
  ): Promise<FireSafetyEquipment[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (tenantId) {
      values.push(tenantId);
      conditions.push(`tenant_id = $${values.length}`);
    }
    if (filters?.tipo) {
      values.push(filters.tipo);
      conditions.push(`tipo = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await client.query<FireSafetyEquipmentRow>(
      `SELECT * FROM fire_safety_equipment ${where} ORDER BY created_at DESC`,
      values,
    );
    const equipment = result.rows.map(withStatus);
    // status é calculado, não persistido — filtro é em memória, depois
    // da query, igual ao resto do cálculo de status (ver getEquipmentStatus).
    return filters?.status ? equipment.filter((eq) => eq.status === filters.status) : equipment;
  }

  async findOne(client: PoolClient, id: string): Promise<FireSafetyEquipment> {
    const result = await client.query<FireSafetyEquipmentRow>(
      'SELECT * FROM fire_safety_equipment WHERE id = $1',
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Equipamento não encontrado');
    return withStatus(row);
  }

  async update(client: PoolClient, id: string, data: UpdateEquipmentData): Promise<FireSafetyEquipment> {
    if (data.company_unit_id) {
      const existing = await client.query<{ tenant_id: string }>(
        'SELECT tenant_id FROM fire_safety_equipment WHERE id = $1',
        [id],
      );
      if (existing.rowCount === 0) throw new NotFoundException('Equipamento não encontrado');
      await this.assertCompanyUnitBelongsToTenant(client, data.company_unit_id, existing.rows[0].tenant_id);
    }
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

    const result = await client.query<FireSafetyEquipmentRow>(
      `UPDATE fire_safety_equipment SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Equipamento não encontrado');
    return withStatus(row);
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    const existing = await client.query<{ foto_r2_key: string | null }>(
      'SELECT foto_r2_key FROM fire_safety_equipment WHERE id = $1',
      [id],
    );
    if (existing.rowCount === 0) throw new NotFoundException('Equipamento não encontrado');
    await client.query('DELETE FROM fire_safety_equipment WHERE id = $1', [id]);
    if (existing.rows[0].foto_r2_key) {
      // Best-effort — não bloqueia a exclusão do registro se o objeto no
      // R2 já não existir ou a chamada falhar.
      await this.r2.deleteObject(existing.rows[0].foto_r2_key).catch(() => undefined);
    }
  }

  async uploadFoto(client: PoolClient, id: string, file: Express.Multer.File): Promise<FireSafetyEquipment> {
    const equipment = await this.findOne(client, id);
    const fileKey = `tenants/${equipment.tenant_id}/fire-safety-equipment/${id}/${sanitizeFileName(file.originalname)}`;
    await this.r2.putObject(fileKey, file.buffer, file.mimetype);
    const result = await client.query<FireSafetyEquipmentRow>(
      'UPDATE fire_safety_equipment SET foto_r2_key = $2 WHERE id = $1 RETURNING *',
      [id, fileKey],
    );
    return withStatus(result.rows[0]);
  }
}
```

- [ ] **Step 4: Criar os DTOs**

Cria `backend/src/fire-safety-equipment/dto/create-fire-safety-equipment.dto.ts`:

```typescript
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { EQUIPMENT_TYPES } from '../fire-safety-equipment.service';

export class CreateFireSafetyEquipmentDto {
  @IsIn(EQUIPMENT_TYPES)
  tipo: string;

  @IsString()
  @MaxLength(100)
  codigo: string;

  @IsOptional()
  @IsUUID()
  company_unit_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  localizacao?: string;

  @IsOptional()
  @IsISO8601()
  data_instalacao?: string;

  @IsOptional()
  @IsISO8601()
  data_ultima_manutencao?: string;

  @IsOptional()
  @IsISO8601()
  proxima_manutencao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  empresa_responsavel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacoes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  agente_extintor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  capacidade?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  classe_fogo?: string;

  // Só é lido quando quem envia é role 'tecnico' ou 'parceiro' (empresa
  // sempre usa o próprio tenant_id do token) — mesmo padrão de CreateEpiDto.
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
```

Cria `backend/src/fire-safety-equipment/dto/update-fire-safety-equipment.dto.ts`:

```typescript
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { EQUIPMENT_TYPES } from '../fire-safety-equipment.service';

export class UpdateFireSafetyEquipmentDto {
  @IsOptional()
  @IsIn(EQUIPMENT_TYPES)
  tipo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  codigo?: string;

  @IsOptional()
  @IsUUID()
  company_unit_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  localizacao?: string;

  @IsOptional()
  @IsISO8601()
  data_instalacao?: string;

  @IsOptional()
  @IsISO8601()
  data_ultima_manutencao?: string;

  @IsOptional()
  @IsISO8601()
  proxima_manutencao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  empresa_responsavel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacoes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  agente_extintor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  capacidade?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  classe_fogo?: string;
}
```

- [ ] **Step 5: Escrever o controller**

Cria `backend/src/fire-safety-equipment/fire-safety-equipment.controller.ts`:

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
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { FireSafetyEquipmentService } from './fire-safety-equipment.service';
import { CreateFireSafetyEquipmentDto } from './dto/create-fire-safety-equipment.dto';
import { UpdateFireSafetyEquipmentDto } from './dto/update-fire-safety-equipment.dto';

@Controller('fire-safety-equipment')
export class FireSafetyEquipmentController {
  constructor(private readonly equipment: FireSafetyEquipmentService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateFireSafetyEquipmentDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.equipment.create(client, {
        tenantId,
        tipo: dto.tipo as any,
        codigo: dto.codigo,
        companyUnitId: dto.company_unit_id,
        localizacao: dto.localizacao,
        dataInstalacao: dto.data_instalacao,
        dataUltimaManutencao: dto.data_ultima_manutencao,
        proximaManutencao: dto.proxima_manutencao,
        empresaResponsavel: dto.empresa_responsavel,
        observacoes: dto.observacoes,
        agenteExtintor: dto.agente_extintor,
        capacidade: dto.capacidade,
        classeFogo: dto.classe_fogo,
        createdByUserId: user.id,
      }),
    );
  }

  @Get()
  findAll(
    @Query('tenant_id') tenantId: string | undefined,
    @Query('tipo') tipo: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) =>
      this.equipment.findAll(client, tenantId, { tipo, status: status as any }),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.equipment.findOne(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFireSafetyEquipmentDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.equipment.update(client, id, dto));
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.equipment.remove(client, id));
  }

  @Roles('empresa', 'tecnico', 'parceiro')
  @Post(':id/foto')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadFoto(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    return req.withTenantContext((client: any) => this.equipment.uploadFoto(client, id, file));
  }
}
```

- [ ] **Step 6: Escrever o module e registrar no app**

Cria `backend/src/fire-safety-equipment/fire-safety-equipment.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { FireSafetyEquipmentController } from './fire-safety-equipment.controller';
import { FireSafetyEquipmentService } from './fire-safety-equipment.service';

@Module({
  controllers: [FireSafetyEquipmentController],
  providers: [FireSafetyEquipmentService],
  exports: [FireSafetyEquipmentService],
})
export class FireSafetyEquipmentModule {}
```

Em `backend/src/app.module.ts`, adiciona o import junto dos demais módulos de domínio:
```typescript
import { FireSafetyEquipmentModule } from './fire-safety-equipment/fire-safety-equipment.module';
```
E no array `imports` do `@Module`:
```typescript
    FireSafetyEquipmentModule,
```

- [ ] **Step 7: Escrever o teste e2e**

Cria `backend/test/fire-safety-equipment.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

function daysFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('Equipamentos contra incêndio (e2e)', () => {
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
    const tenant = await db.createTenantWithUser('Empresa Equipamentos Incendio');
    tenantId = tenant.tenantId;
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = login.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cria um extintor com todos os campos e devolve status "regular" pra manutenção distante', async () => {
    const res = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'extintor',
        codigo: 'EXT-001',
        localizacao: 'Recepção, térreo',
        proxima_manutencao: daysFromToday(200),
        agente_extintor: 'PQS',
        capacidade: '6kg',
        classe_fogo: 'ABC',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('regular');
    expect(res.body.agente_extintor).toBe('PQS');
  });

  it('devolve status "vencido" pra manutenção no passado e "vencendo" pra manutenção em 10 dias', async () => {
    const vencido = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'extintor', codigo: 'EXT-002', proxima_manutencao: daysFromToday(-5) });
    expect(vencido.body.status).toBe('vencido');

    const vencendo = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'hidrante', codigo: 'HID-001', proxima_manutencao: daysFromToday(10) });
    expect(vencendo.body.status).toBe('vencendo');
  });

  it('ignora silenciosamente campos de extintor quando o tipo não é extintor', async () => {
    const res = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'alarme', codigo: 'ALM-001', agente_extintor: 'PQS', capacidade: '6kg' });

    expect(res.status).toBe(201);
    expect(res.body.agente_extintor).toBeNull();
    expect(res.body.capacidade).toBeNull();
  });

  it('lista, edita e apaga um equipamento', async () => {
    const created = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'sprinkler', codigo: 'SPK-001' });
    const id = created.body.id;

    const listRes = await request(app.getHttpServer())
      .get('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.body.some((eq: any) => eq.id === id)).toBe(true);

    const updateRes = await request(app.getHttpServer())
      .patch(`/fire-safety-equipment/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ localizacao: 'Depósito' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.localizacao).toBe('Depósito');

    const deleteRes = await request(app.getHttpServer())
      .delete(`/fire-safety-equipment/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.status).toBe(200);

    const findRes = await request(app.getHttpServer())
      .get(`/fire-safety-equipment/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(findRes.status).toBe(404);
  });

  it('filtra por tipo e por status na query', async () => {
    await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'hidrante', codigo: 'HID-FILTRO', proxima_manutencao: daysFromToday(-1) });
    await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'extintor', codigo: 'EXT-FILTRO', proxima_manutencao: daysFromToday(200) });

    const porTipo = await request(app.getHttpServer())
      .get('/fire-safety-equipment?tipo=hidrante')
      .set('Authorization', `Bearer ${token}`);
    expect(porTipo.body.every((eq: any) => eq.tipo === 'hidrante')).toBe(true);
    expect(porTipo.body.some((eq: any) => eq.codigo === 'HID-FILTRO')).toBe(true);

    const porStatus = await request(app.getHttpServer())
      .get('/fire-safety-equipment?status=vencido')
      .set('Authorization', `Bearer ${token}`);
    expect(porStatus.body.every((eq: any) => eq.status === 'vencido')).toBe(true);
    expect(porStatus.body.some((eq: any) => eq.codigo === 'HID-FILTRO')).toBe(true);
    expect(porStatus.body.some((eq: any) => eq.codigo === 'EXT-FILTRO')).toBe(false);
  });

  it('rejeita company_unit_id de outro tenant', async () => {
    const otherTenant = await db.createTenantWithUser('Empresa Equipamentos Outro Tenant');
    const otherUnit = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial Outro Tenant', 'Rua X', 'Cidade X', 'SC', '88800000') RETURNING id`,
      [otherTenant.tenantId],
    );

    const res = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'extintor', codigo: 'EXT-003', company_unit_id: otherUnit.rows[0].id });

    expect(res.status).toBe(400);
  });

  it('tecnico cria equipamento informando tenant_id no body', async () => {
    const technicianUser = await db.createUserWithRole('tecnico', 'Tecnico Equipamentos Incendio');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: technicianUser.email, password: technicianUser.password });
    const technicianToken = login.body.access_token;

    const res = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tipo: 'extintor', codigo: 'EXT-004', tenant_id: tenantId });

    expect(res.status).toBe(201);
    expect(res.body.tenant_id).toBe(tenantId);
  });

  it('upload de foto grava o file_key e o equipamento passa a ter foto_r2_key', async () => {
    const created = await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'extintor', codigo: 'EXT-005' });
    const id = created.body.id;

    const res = await request(app.getHttpServer())
      .post(`/fire-safety-equipment/${id}/foto`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'extintor.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(201);
    expect(res.body.foto_r2_key).toContain(id);
  });
});
```

- [ ] **Step 8: Rodar o teste, confirmar que passa**

Criar `docker-compose.override.yml` (mesmo padrão de sempre — bind mount `./backend:/app` + volume nomeado `/app/node_modules` + `NODE_ENV: development` + `TEST_SUPERUSER_DATABASE_URL`).

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- fire-safety-equipment"`
Expected: `Tests: 8 passed, 8 total`

- [ ] **Step 9: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/db/migrations/0036_fire_safety_equipment.sql backend/src/fire-safety-equipment backend/src/app.module.ts backend/test/fire-safety-equipment.e2e-spec.ts
git commit -m "feat: cadastro e controle de equipamentos contra incêndio"
```

---

### Task 2: Integração com o dashboard

**Files:**
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/dashboard/dashboard.module.ts`
- Test: `backend/test/fire-safety-equipment.e2e-spec.ts` (mesmo arquivo da Task 1 — adiciona 1 teste novo)

**Interfaces:**
- Consumes: `FireSafetyEquipmentService.findAll` (Task 1), `EQUIPMENT_TYPE_LABEL` (Task 1).
- Produces: `AttentionItem['tipo']` ganha `'equipamento_incendio'`; `DashboardService.getSummary` passa a incluir equipamentos vencidos/vencendo em `atencao`/`resumo.pendencias`/`resumo.avisos`.

- [ ] **Step 1: Adicionar o teste ao arquivo da Task 1 (RED)**

No MESMO arquivo `backend/test/fire-safety-equipment.e2e-spec.ts`, adiciona o `it(...)` abaixo dentro do `describe` já existente (antes do `});` final):

```typescript
  it('equipamento vencido aparece no dashboard existente como item de atenção', async () => {
    await request(app.getHttpServer())
      .post('/fire-safety-equipment')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'extintor', codigo: 'EXT-DASHBOARD', proxima_manutencao: daysFromToday(-3) });

    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const equipmentItems = res.body.atencao.filter((i: any) => i.tipo === 'equipamento_incendio');
    expect(equipmentItems.length).toBeGreaterThan(0);
    expect(equipmentItems[0].prioridade).toBe('alta');
    expect(equipmentItems[0].link).toBe('/empresa/equipamentos-incendio');
  });
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- fire-safety-equipment"`
Expected: FAIL no teste novo — `equipamento_incendio` nunca aparece em `atencao` ainda.

- [ ] **Step 3: `DashboardService` ganha a nova fonte**

Em `backend/src/dashboard/dashboard.service.ts`, troca:
```typescript
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DocumentsService } from '../documents/documents.service';
import { PositionsService } from '../positions/positions.service';

export type DashboardStatus = 'ok' | 'atencao' | 'critico';
export type AttentionPriority = 'alta' | 'media' | 'baixa';
export type AttentionResponsible = 'empresa' | 'tecnico';

export interface AttentionItem {
  tipo: 'documento' | 'epi' | 'acao' | 'inspecao' | 'cargo';
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

Troca:
```typescript
  constructor(
    private readonly documents: DocumentsService,
    private readonly positionsService: PositionsService,
  ) {}

  async getSummary(client: PoolClient, tenantId: string): Promise<DashboardSummary> {
    const [compliance, epis, actionPlans, inspecoesPendentes, positionDivergences] = await Promise.all([
      this.documents.getCompliance(client, tenantId),
      this.getEpiStatus(client, tenantId),
      this.getActionPlans(client, tenantId),
      this.countInspecoesPendentes(client, tenantId),
      this.positionsService.getDivergences(client, tenantId),
    ]);
```
Por:
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

Dentro do array `atencao`, logo depois do `...positionDivergences.map(...)` já existente, adiciona:
```typescript
      ...fireSafetyEquipment.pendencias.map((eq): AttentionItem => ({
        tipo: 'equipamento_incendio',
        titulo: `Equipamento vencido: ${EQUIPMENT_TYPE_LABEL[eq.tipo]} (${eq.codigo})`,
        prioridade: 'alta',
        data: toDateString(eq.proxima_manutencao),
        responsavel: 'empresa',
        link: '/empresa/equipamentos-incendio',
      })),
      ...fireSafetyEquipment.avisos.map((eq): AttentionItem => ({
        tipo: 'equipamento_incendio',
        titulo: `Equipamento vencendo: ${EQUIPMENT_TYPE_LABEL[eq.tipo]} (${eq.codigo})`,
        prioridade: 'media',
        data: toDateString(eq.proxima_manutencao),
        responsavel: 'empresa',
        link: '/empresa/equipamentos-incendio',
      })),
```

Troca a linha de `pendencias`/`avisos`:
```typescript
    const pendencias = compliance.pendencias.length + epis.pendencias.length + positionDivergences.length;
    const avisos = compliance.avisos.length + epis.avisos.length;
```
Por:
```typescript
    const pendencias =
      compliance.pendencias.length + epis.pendencias.length + positionDivergences.length + fireSafetyEquipment.pendencias.length;
    const avisos = compliance.avisos.length + epis.avisos.length + fireSafetyEquipment.avisos.length;
```

Adiciona o método privado novo, ao lado de `getEpiStatus`/`getActionPlans`:
```typescript
  private async getFireSafetyEquipmentStatus(client: PoolClient, tenantId: string) {
    const equipment = await this.fireSafetyEquipmentService.findAll(client, tenantId);
    const pendencias = equipment.filter((eq) => eq.status === 'vencido');
    const avisos = equipment.filter((eq) => eq.status === 'vencendo');
    return { pendencias, avisos };
  }
```

- [ ] **Step 4: `DashboardModule` importa `FireSafetyEquipmentModule`**

Em `backend/src/dashboard/dashboard.module.ts`, troca:
```typescript
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { WeeklyDigestService } from './weekly-digest.service';
import { DocumentsModule } from '../documents/documents.module';
import { PositionsModule } from '../positions/positions.module';

@Module({
  imports: [DocumentsModule, PositionsModule],
  controllers: [DashboardController],
  providers: [DashboardService, WeeklyDigestService],
  exports: [DashboardService],
})
export class DashboardModule {}
```
Por:
```typescript
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { WeeklyDigestService } from './weekly-digest.service';
import { DocumentsModule } from '../documents/documents.module';
import { PositionsModule } from '../positions/positions.module';
import { FireSafetyEquipmentModule } from '../fire-safety-equipment/fire-safety-equipment.module';

@Module({
  imports: [DocumentsModule, PositionsModule, FireSafetyEquipmentModule],
  controllers: [DashboardController],
  providers: [DashboardService, WeeklyDigestService],
  exports: [DashboardService],
})
export class DashboardModule {}
```

- [ ] **Step 5: Rodar o teste, confirmar que passa**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- fire-safety-equipment"`
Expected: `Tests: 9 passed, 9 total`

- [ ] **Step 6: Regressão de `dashboard`**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- dashboard"`
Expected: todas as suítes de `dashboard` já existentes continuam verdes (em especial `dashboard-summary.e2e-spec.ts`, que não cria nenhum equipamento, então `fireSafetyEquipment` deve vir vazio nesses testes e não alterar nenhuma asserção existente).

- [ ] **Step 7: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/src/dashboard backend/test/fire-safety-equipment.e2e-spec.ts
git commit -m "feat: integra equipamentos contra incêndio no dashboard existente"
```

---

### Task 3: Frontend — página `/empresa/equipamentos-incendio`

**Files:**
- Create: `frontend/src/app/empresa/equipamentos-incendio/page.tsx`
- Create: `frontend/src/components/FireSafetyEquipmentPanel.tsx`
- Modify: `frontend/src/components/EmpresaSidebar.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /api/fire-safety-equipment`, `POST /api/fire-safety-equipment/:id/foto`, `GET /api/company-units` (já existente, pra popular o seletor de filial).

- [ ] **Step 1: Criar a página (wrapper de autenticação)**

Cria `frontend/src/app/empresa/equipamentos-incendio/page.tsx` (mesmo padrão de `frontend/src/app/empresa/epis/page.tsx`):

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FireSafetyEquipmentPanel } from '@/components/FireSafetyEquipmentPanel';

export default function EmpresaEquipamentosIncendioPage() {
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
      <h1 className="text-2xl font-bold text-brand-900">Equipamentos contra incêndio</h1>
      <div className="mt-8">
        <FireSafetyEquipmentPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar o painel completo**

Cria `frontend/src/components/FireSafetyEquipmentPanel.tsx`:

```typescript
'use client';

import { FormEvent, useEffect, useState } from 'react';

interface Equipment {
  id: string;
  tipo: string;
  codigo: string;
  company_unit_id: string | null;
  localizacao: string | null;
  proxima_manutencao: string | null;
  agente_extintor: string | null;
  capacidade: string | null;
  classe_fogo: string | null;
  status: 'regular' | 'vencendo' | 'vencido';
  foto_r2_key: string | null;
}

interface CompanyUnitOption {
  id: string;
  name: string;
  is_matriz: boolean;
}

const EQUIPMENT_TYPES = [
  'extintor', 'hidrante', 'mangueira', 'alarme', 'detector',
  'iluminacao_emergencia', 'saida_emergencia', 'porta_corta_fogo',
  'sprinkler', 'central_alarme', 'outro',
] as const;

const EQUIPMENT_TYPE_LABEL: Record<string, string> = {
  extintor: 'Extintor',
  hidrante: 'Hidrante',
  mangueira: 'Mangueira',
  alarme: 'Alarme',
  detector: 'Detector',
  iluminacao_emergencia: 'Iluminação de emergência',
  saida_emergencia: 'Saída de emergência',
  porta_corta_fogo: 'Porta corta-fogo',
  sprinkler: 'Sprinkler',
  central_alarme: 'Central de alarme',
  outro: 'Outro',
};

const STATUS_LABEL: Record<Equipment['status'], { emoji: string; text: string; className: string }> = {
  regular: { emoji: '🟢', text: 'Regular', className: 'text-green-700' },
  vencendo: { emoji: '🟡', text: 'Vencendo', className: 'text-amber-700' },
  vencido: { emoji: '🔴', text: 'Vencido', className: 'text-red-600' },
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function FireSafetyEquipmentPanel() {
  const [items, setItems] = useState<Equipment[]>([]);
  const [units, setUnits] = useState<CompanyUnitOption[]>([]);
  const [tipo, setTipo] = useState<string>('extintor');
  const [codigo, setCodigo] = useState('');
  const [companyUnitId, setCompanyUnitId] = useState('');
  const [localizacao, setLocalizacao] = useState('');
  const [proximaManutencao, setProximaManutencao] = useState('');
  const [agenteExtintor, setAgenteExtintor] = useState('');
  const [capacidade, setCapacidade] = useState('');
  const [classeFogo, setClasseFogo] = useState('');
  const [createError, setCreateError] = useState('');
  const [filterTipo, setFilterTipo] = useState('');

  async function loadItems() {
    const res = await fetch('/api/fire-safety-equipment', { headers: authHeaders() });
    if (res.ok) setItems(await res.json());
  }

  async function loadUnits() {
    const res = await fetch('/api/company-units', { headers: authHeaders() });
    if (res.ok) setUnits(await res.json());
  }

  useEffect(() => {
    loadItems();
    loadUnits();
  }, []);

  function unitName(companyUnitIdValue: string | null): string {
    if (!companyUnitIdValue) return '—';
    return units.find((unit) => unit.id === companyUnitIdValue)?.name ?? '—';
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError('');
    const res = await fetch('/api/fire-safety-equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        tipo,
        codigo,
        company_unit_id: companyUnitId || undefined,
        localizacao: localizacao || undefined,
        proxima_manutencao: proximaManutencao || undefined,
        agente_extintor: tipo === 'extintor' ? agenteExtintor || undefined : undefined,
        capacidade: tipo === 'extintor' ? capacidade || undefined : undefined,
        classe_fogo: tipo === 'extintor' ? classeFogo || undefined : undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setCreateError(body?.message ?? 'Não foi possível cadastrar o equipamento.');
      return;
    }
    setCodigo('');
    setCompanyUnitId('');
    setLocalizacao('');
    setProximaManutencao('');
    setAgenteExtintor('');
    setCapacidade('');
    setClasseFogo('');
    loadItems();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/fire-safety-equipment/${id}`, { method: 'DELETE', headers: authHeaders() });
    loadItems();
  }

  const visibleItems = filterTipo ? items.filter((item) => item.tipo === filterTipo) : items;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-md border border-brand-100 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tipo
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              {EQUIPMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EQUIPMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Código/ID
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              required
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Filial
            <select
              value={companyUnitId}
              onChange={(e) => setCompanyUnitId(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            >
              <option value="">Selecione (opcional)</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Localização
            <input
              value={localizacao}
              onChange={(e) => setLocalizacao(e.target.value)}
              placeholder="Ex.: 2º andar, corredor B"
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Próxima manutenção
            <input
              type="date"
              value={proximaManutencao}
              onChange={(e) => setProximaManutencao(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
        </div>
        {tipo === 'extintor' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Agente extintor
              <input
                value={agenteExtintor}
                onChange={(e) => setAgenteExtintor(e.target.value)}
                className="rounded-md border border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Capacidade
              <input
                value={capacidade}
                onChange={(e) => setCapacidade(e.target.value)}
                className="rounded-md border border-brand-100 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-brand-900">
              Classe de fogo
              <input
                value={classeFogo}
                onChange={(e) => setClasseFogo(e.target.value)}
                className="rounded-md border border-brand-100 px-3 py-2"
              />
            </label>
          </div>
        )}
        <button
          type="submit"
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700"
        >
          Cadastrar equipamento
        </button>
        {createError && <p className="text-sm text-red-600">{createError}</p>}
      </form>

      <div className="flex items-center gap-2">
        <label className="text-sm text-brand-900">Filtrar por tipo:</label>
        <select
          value={filterTipo}
          onChange={(e) => setFilterTipo(e.target.value)}
          className="rounded-md border border-brand-100 px-3 py-2 text-sm"
        >
          <option value="">Todos</option>
          {EQUIPMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EQUIPMENT_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-brand-700">
            <th className="px-2 py-1">Código</th>
            <th className="px-2 py-1">Tipo</th>
            <th className="px-2 py-1">Filial</th>
            <th className="px-2 py-1">Localização</th>
            <th className="px-2 py-1">Próxima manutenção</th>
            <th className="px-2 py-1">Status</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {visibleItems.map((item) => (
            <tr key={item.id} className="border-t border-brand-50">
              <td className="px-2 py-1 font-medium text-brand-900">{item.codigo}</td>
              <td className="px-2 py-1">{EQUIPMENT_TYPE_LABEL[item.tipo] ?? item.tipo}</td>
              <td className="px-2 py-1">{unitName(item.company_unit_id)}</td>
              <td className="px-2 py-1">{item.localizacao ?? '—'}</td>
              <td className="px-2 py-1">{item.proxima_manutencao ? formatDate(item.proxima_manutencao) : '—'}</td>
              <td className={`px-2 py-1 ${STATUS_LABEL[item.status].className}`}>
                {STATUS_LABEL[item.status].emoji} {STATUS_LABEL[item.status].text}
              </td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  className="text-xs text-red-600 underline"
                >
                  Excluir
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Adicionar entrada de navegação no sidebar**

Em `frontend/src/components/EmpresaSidebar.tsx`, dentro do grupo `Segurança`, adiciona uma entrada logo depois de `{ href: '/empresa/mapa-sst', label: 'Mapa SST', emoji: '🗺️' }` (ou onde essa entrada estiver hoje):
```typescript
      { href: '/empresa/equipamentos-incendio', label: 'Equipamentos contra incêndio', emoji: '🧯' },
```

Confirme a localização exata da entrada de `mapa-sst`/o array `GROUPS` antes de aplicar — o grupo `Segurança` já existia com `assistente`/`documentos`/`epis`/`consulta-ca`/`inspecoes` e ganhou `mapa-sst` na Fase 23.

- [ ] **Step 4: Deploy e confirmação do bundle real**

```bash
docker compose build frontend
docker compose up -d frontend
```

```bash
docker compose exec frontend sh -c "grep -rl 'Equipamentos contra incêndio' .next/server/app 2>/dev/null || grep -rl 'Equipamentos contra incêndio' .next/static/chunks 2>/dev/null"
```

Expected: pelo menos um arquivo encontrado.

- [ ] **Step 5: Verificação Playwright real**

Escreva um script Playwright (Node, scratchpad) que abre `https://montesesst.com.br/empresa/equipamentos-incendio` com sessão sintética (`localStorage`), mocka `GET /api/fire-safety-equipment` (lista com 2 itens, um `vencido` e um `regular`), `GET /api/company-units` (lista com 1 filial), `POST /api/fire-safety-equipment` (sucesso), `DELETE /api/fire-safety-equipment/:id` (sucesso), e confirma:

1. A tabela renderiza os 2 itens com o emoji/texto de status certo (🔴 Vencido / 🟢 Regular) e a data de `proxima_manutencao` no formato dd/mm/yyyy (não a string ISO crua).
2. Selecionar tipo "Extintor" no formulário mostra os 3 campos extras (agente extintor/capacidade/classe de fogo); selecionar outro tipo (ex. "Alarme") os esconde.
3. O seletor de Filial mostra a filial mockada; a coluna "Filial" da tabela mostra o nome certo pro item que tem `company_unit_id` preenchido.
4. Preencher e submeter o formulário dispara `POST /api/fire-safety-equipment` com o corpo certo (incluindo `company_unit_id` quando uma filial é selecionada, e os campos de extintor só quando o tipo selecionado é extintor).
5. Clicar em "Excluir" numa linha dispara `DELETE /api/fire-safety-equipment/:id` com o id certo.
6. O link "Equipamentos contra incêndio" aparece no sidebar (`EmpresaSidebar`) e aponta pra `/empresa/equipamentos-incendio`.

Run: script Playwright real contra a URL de produção.
Expected: todas as asserções passam.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/empresa/equipamentos-incendio frontend/src/components/FireSafetyEquipmentPanel.tsx frontend/src/components/EmpresaSidebar.tsx
git commit -m "feat: página de equipamentos contra incêndio + entrada no sidebar"
```
