# Checklist de prevenção + Simulado de emergência Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Checklist de prevenção contra incêndio (vistoria técnica periódica, 14 itens fixos, foto opcional) e simulado de evacuação (registrado pela empresa, lista de presença nominal, relatório calculado), ambos gerando ações corretivas numa tabela compartilhada, integrados ao dashboard já existente.

**Architecture:** Três módulos backend novos — `prevention-corrective-actions` (fundação, consumida pelos outros dois), `prevention-checklist` (mesmo fluxo rascunho→conclusão de Inspeções, mas com foto por item) e `emergency-drill` (registro direto pela empresa, lista de presença nominal, relatório calculado) — mais integração no dashboard já existente e duas páginas de frontend.

**Tech Stack:** NestJS + `pg` (Postgres real, RLS), Next.js/React (fetch direto), Cloudflare R2 (upload de foto direto, mesmo padrão do sub-projeto A).

**Spec:** `docs/specs/prevencao-emergencia-checklist-simulado.md`

## Global Constraints

- Checklist é só `@Roles('tecnico', 'parceiro')` — vistoria técnica, mesmo padrão de Inspeções, sem `'empresa'`.
- Lista de 14 itens do checklist é fixa (constante TypeScript), sem tela de configuração.
- Foto por item do checklist é upload direto ao R2 (mesmo padrão do sub-projeto A) — não passa pelo `DocumentsService`.
- Simulado é `@Roles('empresa', 'tecnico', 'parceiro')` — resolução de `tenant_id` idêntica aos sub-projetos A/B (técnico/parceiro mandam no body, empresa usa o do token).
- Lista de presença do simulado é nominal por funcionário (`employee_id` obrigatório, sem nome livre), cobrindo todo funcionário esperado (inclusive ausentes, `presente=false`) — não só quem compareceu.
- "Brigadistas presentes" é sempre calculado via JOIN contra `fire_brigade_members`, nunca persistido.
- Ações corretivas têm tabela própria (`prevention_corrective_actions`), não reaproveita `action_plans`.
- Dashboard: ação corretiva `pendente` com `deadline` vencido → `atencao` como `prioridade: 'alta'` (conta em `resumo.pendencias`); vencendo em até 30 dias, OU sem `deadline` definido ainda → `media` (conta em `resumo.avisos`); mais de 30 dias no futuro → não aparece.
- Toda `titulo` de `AttentionItem` gerada por este sub-projeto não embute nome de funcionário (`description` de ação corretiva vem de `item_label`/texto fixo gerado, nunca de `employee_full_name`) — o novo tipo entra em `ATTENTION_TIPO_AI_SAFE` como `true`.

---

### Task 1: Ações corretivas (módulo fundação)

**Files:**
- Create: `backend/db/migrations/0039_prevention_checklist_and_drills.sql`
- Create: `backend/src/prevention-corrective-actions/prevention-corrective-actions.service.ts`
- Create: `backend/src/prevention-corrective-actions/prevention-corrective-actions.controller.ts`
- Create: `backend/src/prevention-corrective-actions/prevention-corrective-actions.module.ts`
- Create: `backend/src/prevention-corrective-actions/dto/update-corrective-action-status.dto.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/prevention-corrective-actions.e2e-spec.ts`

**Interfaces:**
- Produces: `CorrectiveAction` interface, `PreventionCorrectiveActionsService.create/findAll/updateStatus/getStatusSummary`. Task 2 e Task 3 consomem `create` diretamente (injetado via `PreventionCorrectiveActionsModule`). Task 4 consome `getStatusSummary(client, tenantId)`. Task 5/6 consomem os endpoints HTTP de listagem/resolução.

- [ ] **Step 1: Escrever a migration (as 5 tabelas da feature completa)**

Cria `backend/db/migrations/0039_prevention_checklist_and_drills.sql`:

```sql
-- Prevenção e Emergência, sub-projeto C: checklist de prevenção +
-- simulado de emergência. Ver docs/specs/prevencao-emergencia-checklist-simulado.md.
-- Ações corretivas têm tabela própria, não reaproveita action_plans
-- (que tem inspection_id NOT NULL, exigiria alterar tabela em produção).

CREATE TABLE prevention_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  technician_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'concluida')),
  data_realizacao DATE NOT NULL,
  concluded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX prevention_checklists_company_unit_idx ON prevention_checklists (company_unit_id);
CREATE TRIGGER trg_prevention_checklists_updated_at BEFORE UPDATE ON prevention_checklists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE prevention_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES prevention_checklists(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item_label TEXT NOT NULL,
  status TEXT CHECK (status IN ('C', 'NC', 'NA')),
  observacoes TEXT,
  foto_r2_key TEXT,
  UNIQUE (checklist_id, item_key)
);

CREATE TABLE emergency_drills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  data_realizacao DATE NOT NULL,
  horario TIME,
  tempo_evacuacao_segundos INT,
  ponto_encontro_adequado BOOLEAN,
  falhas_sinalizacao BOOLEAN NOT NULL DEFAULT false,
  falhas_iluminacao BOOLEAN NOT NULL DEFAULT false,
  portas_bloqueadas BOOLEAN NOT NULL DEFAULT false,
  extintores_obstruidos BOOLEAN NOT NULL DEFAULT false,
  observacoes TEXT,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX emergency_drills_company_unit_idx ON emergency_drills (company_unit_id);
CREATE TRIGGER trg_emergency_drills_updated_at BEFORE UPDATE ON emergency_drills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE emergency_drill_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_id UUID NOT NULL REFERENCES emergency_drills(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  presente BOOLEAN NOT NULL,
  UNIQUE (drill_id, employee_id)
);

CREATE TABLE prevention_corrective_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  checklist_item_id UUID REFERENCES prevention_checklist_items(id) ON DELETE CASCADE,
  drill_id UUID REFERENCES emergency_drills(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  deadline DATE,
  responsible TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'resolvido')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_corrective_action_source CHECK (
    (checklist_item_id IS NOT NULL AND drill_id IS NULL)
    OR (checklist_item_id IS NULL AND drill_id IS NOT NULL)
  )
);

ALTER TABLE prevention_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE prevention_checklists FORCE ROW LEVEL SECURITY;
CREATE POLICY prevention_checklists_isolation ON prevention_checklists USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE prevention_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE prevention_checklist_items FORCE ROW LEVEL SECURITY;
CREATE POLICY prevention_checklist_items_isolation ON prevention_checklist_items USING (
  EXISTS (SELECT 1 FROM prevention_checklists c WHERE c.id = prevention_checklist_items.checklist_id)
);

ALTER TABLE emergency_drills ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_drills FORCE ROW LEVEL SECURITY;
CREATE POLICY emergency_drills_isolation ON emergency_drills USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE emergency_drill_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_drill_participants FORCE ROW LEVEL SECURITY;
CREATE POLICY emergency_drill_participants_isolation ON emergency_drill_participants USING (
  EXISTS (SELECT 1 FROM emergency_drills d WHERE d.id = emergency_drill_participants.drill_id)
);

ALTER TABLE prevention_corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prevention_corrective_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY prevention_corrective_actions_isolation ON prevention_corrective_actions USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
```

- [ ] **Step 2: Aplicar a migration**

Run: `docker compose exec backend npm run db:migrate` (ou `docker compose run --rm backend npm run db:migrate` se o container não estiver de pé)
Expected: `[apply] 0039_prevention_checklist_and_drills.sql` seguido de `[ok]` / `Migrations concluídas.`

- [ ] **Step 3: Escrever o service**

Cria `backend/src/prevention-corrective-actions/prevention-corrective-actions.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface CorrectiveAction {
  id: string;
  tenant_id: string;
  checklist_item_id: string | null;
  drill_id: string | null;
  description: string;
  deadline: string | null;
  responsible: string | null;
  status: 'pendente' | 'resolvido';
  created_at: string;
}

interface CreateCorrectiveActionData {
  tenantId: string;
  checklistItemId?: string;
  drillId?: string;
  description: string;
  deadline?: string;
  responsible?: string;
}

@Injectable()
export class PreventionCorrectiveActionsService {
  async create(client: PoolClient, data: CreateCorrectiveActionData): Promise<CorrectiveAction> {
    const result = await client.query<CorrectiveAction>(
      `INSERT INTO prevention_corrective_actions
         (tenant_id, checklist_item_id, drill_id, description, deadline, responsible)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        data.tenantId,
        data.checklistItemId ?? null,
        data.drillId ?? null,
        data.description,
        data.deadline ?? null,
        data.responsible ?? null,
      ],
    );
    return result.rows[0];
  }

  async findAll(
    client: PoolClient,
    filters: { tenantId?: string; status?: string },
  ): Promise<CorrectiveAction[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filters.tenantId) {
      values.push(filters.tenantId);
      conditions.push(`tenant_id = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      conditions.push(`status = $${values.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await client.query<CorrectiveAction>(
      `SELECT * FROM prevention_corrective_actions ${where} ORDER BY created_at DESC`,
      values,
    );
    return result.rows;
  }

  async updateStatus(client: PoolClient, id: string, status: 'pendente' | 'resolvido'): Promise<CorrectiveAction> {
    const result = await client.query<CorrectiveAction>(
      `UPDATE prevention_corrective_actions SET status = $2 WHERE id = $1 RETURNING *`,
      [id, status],
    );
    const action = result.rows[0];
    if (!action) throw new NotFoundException('Ação corretiva não encontrada');
    return action;
  }

  // Consumida pelo dashboard (Task 4). Sem deadline definido (comum nas
  // ações geradas automaticamente por checklist/simulado, que não setam
  // prazo na criação) ainda entra em "avisos" — deixar invisível até
  // alguém editar manualmente esconderia um achado de segurança real.
  async getStatusSummary(
    client: PoolClient,
    tenantId: string,
  ): Promise<{ pendencias: CorrectiveAction[]; avisos: CorrectiveAction[] }> {
    const actions = await this.findAll(client, { tenantId, status: 'pendente' });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const pendencias: CorrectiveAction[] = [];
    const avisos: CorrectiveAction[] = [];
    for (const action of actions) {
      if (!action.deadline) {
        avisos.push(action);
        continue;
      }
      const deadline = new Date(action.deadline);
      deadline.setHours(0, 0, 0, 0);
      const diffDays = Math.round((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) pendencias.push(action);
      else if (diffDays <= 30) avisos.push(action);
    }
    return { pendencias, avisos };
  }
}
```

- [ ] **Step 4: Criar o DTO**

Cria `backend/src/prevention-corrective-actions/dto/update-corrective-action-status.dto.ts`:

```typescript
import { IsIn } from 'class-validator';

export class UpdateCorrectiveActionStatusDto {
  @IsIn(['pendente', 'resolvido'])
  status: string;
}
```

- [ ] **Step 5: Escrever o controller**

Cria `backend/src/prevention-corrective-actions/prevention-corrective-actions.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Patch, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { PreventionCorrectiveActionsService } from './prevention-corrective-actions.service';
import { UpdateCorrectiveActionStatusDto } from './dto/update-corrective-action-status.dto';

@Controller('prevention-corrective-actions')
export class PreventionCorrectiveActionsController {
  constructor(private readonly correctiveActions: PreventionCorrectiveActionsService) {}

  @Get()
  findAll(
    @Query('tenant_id') tenantId: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) => this.correctiveActions.findAll(client, { tenantId, status }));
  }

  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateCorrectiveActionStatusDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.correctiveActions.updateStatus(client, id, dto.status as 'pendente' | 'resolvido'),
    );
  }
}
```

- [ ] **Step 6: Escrever o module e registrar no app**

Cria `backend/src/prevention-corrective-actions/prevention-corrective-actions.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PreventionCorrectiveActionsController } from './prevention-corrective-actions.controller';
import { PreventionCorrectiveActionsService } from './prevention-corrective-actions.service';

@Module({
  controllers: [PreventionCorrectiveActionsController],
  providers: [PreventionCorrectiveActionsService],
  exports: [PreventionCorrectiveActionsService],
})
export class PreventionCorrectiveActionsModule {}
```

Em `backend/src/app.module.ts`, adiciona o import junto dos demais módulos de domínio:
```typescript
import { PreventionCorrectiveActionsModule } from './prevention-corrective-actions/prevention-corrective-actions.module';
```
E no array `imports` do `@Module`:
```typescript
    PreventionCorrectiveActionsModule,
```

- [ ] **Step 7: Escrever o teste e2e**

Cria `backend/test/prevention-corrective-actions.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Ações corretivas de prevenção (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let checklistItemId: string;
  let drillId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Acoes Corretivas');
    tenantId = tenant.tenantId;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = login.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial Matriz', 'Rua A', 'Cidade A', 'RS', '90000000') RETURNING id`,
      [tenantId],
    );
    const companyUnitId = unitResult.rows[0].id;

    const checklistResult = await (db as any).client.query(
      `INSERT INTO prevention_checklists (tenant_id, company_unit_id, technician_user_id, data_realizacao)
       VALUES ($1, $2, $3, '2026-01-01') RETURNING id`,
      [tenantId, companyUnitId, tenant.userId],
    );
    const itemResult = await (db as any).client.query(
      `INSERT INTO prevention_checklist_items (checklist_id, item_key, item_label, status)
       VALUES ($1, 'extintores_acessiveis', 'Extintores acessíveis', 'NC') RETURNING id`,
      [checklistResult.rows[0].id],
    );
    checklistItemId = itemResult.rows[0].id;

    const drillResult = await (db as any).client.query(
      `INSERT INTO emergency_drills (tenant_id, company_unit_id, data_realizacao, created_by_user_id)
       VALUES ($1, $2, '2026-01-01', $3) RETURNING id`,
      [tenantId, companyUnitId, tenant.userId],
    );
    drillId = drillResult.rows[0].id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('lista ações corretivas pendentes de um tenant', async () => {
    await (db as any).client.query(
      `INSERT INTO prevention_corrective_actions (tenant_id, checklist_item_id, description)
       VALUES ($1, $2, 'Extintores acessíveis')`,
      [tenantId, checklistItemId],
    );

    const res = await request(app.getHttpServer())
      .get('/prevention-corrective-actions?status=pendente')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.some((a: any) => a.description === 'Extintores acessíveis')).toBe(true);
  });

  it('marca uma ação corretiva como resolvida', async () => {
    const created = await (db as any).client.query(
      `INSERT INTO prevention_corrective_actions (tenant_id, drill_id, description)
       VALUES ($1, $2, 'Falha de sinalização identificada no simulado') RETURNING id`,
      [tenantId, drillId],
    );

    const res = await request(app.getHttpServer())
      .patch(`/prevention-corrective-actions/${created.rows[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'resolvido' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolvido');
  });

  it('rejeita status inválido', async () => {
    const created = await (db as any).client.query(
      `INSERT INTO prevention_corrective_actions (tenant_id, checklist_item_id, description)
       VALUES ($1, $2, 'Teste') RETURNING id`,
      [tenantId, checklistItemId],
    );

    const res = await request(app.getHttpServer())
      .patch(`/prevention-corrective-actions/${created.rows[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'invalido' });

    expect(res.status).toBe(400);
  });

  it('constraint impede ter checklist_item_id e drill_id ao mesmo tempo', async () => {
    await expect(
      (db as any).client.query(
        `INSERT INTO prevention_corrective_actions (tenant_id, checklist_item_id, drill_id, description)
         VALUES ($1, $2, $3, 'Inválido')`,
        [tenantId, checklistItemId, drillId],
      ),
    ).rejects.toThrow();
  });

});
```

Nota: a classificação vencido/vencendo/sem-prazo de `getStatusSummary` (usada pelo dashboard) é testada na Task 4, através do endpoint HTTP real do dashboard — não aqui, pra evitar instanciar o service diretamente fora do ciclo de injeção de dependência do Nest (padrão já estabelecido no projeto: toda lógica de service é exercitada via HTTP, nunca via `new Service()` direto num teste e2e).

- [ ] **Step 8: Rodar o teste, confirmar que passa**

Criar `docker-compose.override.yml` (mesmo padrão de sempre — bind mount `./backend:/app` + volume nomeado `/app/node_modules` + `NODE_ENV: development` + `TEST_SUPERUSER_DATABASE_URL`).

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- prevention-corrective-actions"`
Expected: `Tests: 4 passed, 4 total`

- [ ] **Step 9: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/db/migrations/0039_prevention_checklist_and_drills.sql backend/src/prevention-corrective-actions backend/src/app.module.ts backend/test/prevention-corrective-actions.e2e-spec.ts
git commit -m "feat: ações corretivas de prevenção (fundação pro checklist e simulado)"
```

---

### Task 2: Checklist de prevenção

**Files:**
- Create: `backend/src/prevention-checklist/prevention-checklist-items.const.ts`
- Create: `backend/src/prevention-checklist/prevention-checklist.service.ts`
- Create: `backend/src/prevention-checklist/prevention-checklist.controller.ts`
- Create: `backend/src/prevention-checklist/prevention-checklist.module.ts`
- Create: `backend/src/prevention-checklist/dto/create-prevention-checklist.dto.ts`
- Create: `backend/src/prevention-checklist/dto/update-checklist-item.dto.ts`
- Test: `backend/test/prevention-checklist.e2e-spec.ts`

**Interfaces:**
- Consumes: `PreventionCorrectiveActionsService.create` (Task 1).
- Produces: `PreventionChecklistService.create/findAll/findOne/updateItem/uploadItemPhoto/concluir`. Task 5 consome os endpoints HTTP.

- [ ] **Step 1: Criar a constante dos 14 itens fixos**

Cria `backend/src/prevention-checklist/prevention-checklist-items.const.ts`:

```typescript
export interface PreventionChecklistItemDefinition {
  item_key: string;
  item_label: string;
}

// Itens fixos do checklist de prevenção contra incêndio (spec, Seção 3).
// Única fonte de verdade — usada tanto pra semear um checklist novo
// quanto pelos rótulos que a API devolve. Mesmo padrão de
// checklist-items.const.ts (Inspeções), sem blocos (decisão do
// fundador — lista plana, não agrupada).
export const PREVENTION_CHECKLIST_ITEMS: PreventionChecklistItemDefinition[] = [
  { item_key: 'extintores_acessiveis', item_label: 'Extintores acessíveis' },
  { item_key: 'extintores_sinalizados', item_label: 'Extintores sinalizados' },
  { item_key: 'sem_obstrucao', item_label: 'Sem obstrução' },
  { item_key: 'lacre_integro', item_label: 'Lacre íntegro' },
  { item_key: 'manometro_adequado', item_label: 'Manômetro em condição adequada, quando aplicável' },
  { item_key: 'mangueiras_acessiveis', item_label: 'Mangueiras acessíveis' },
  { item_key: 'saidas_desobstruidas', item_label: 'Saídas desobstruídas' },
  { item_key: 'sinalizacao_visivel', item_label: 'Sinalização visível' },
  { item_key: 'iluminacao_emergencia', item_label: 'Iluminação de emergência' },
  { item_key: 'alarmes', item_label: 'Alarmes' },
  { item_key: 'portas_emergencia', item_label: 'Portas de emergência' },
  { item_key: 'rotas_fuga', item_label: 'Rotas de fuga' },
  { item_key: 'ponto_encontro', item_label: 'Ponto de encontro' },
  { item_key: 'brigadistas_disponiveis', item_label: 'Brigadistas disponíveis' },
];
```

- [ ] **Step 2: Escrever o service**

Cria `backend/src/prevention-checklist/prevention-checklist.service.ts`:

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { buildSafeSetClause } from '../common/safe-update.util';
import { R2Service } from '../common/r2/r2.service';
import { PreventionCorrectiveActionsService } from '../prevention-corrective-actions/prevention-corrective-actions.service';
import { PREVENTION_CHECKLIST_ITEMS } from './prevention-checklist-items.const';

function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'arquivo';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export interface PreventionChecklist {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  technician_user_id: string;
  status: 'rascunho' | 'concluida';
  data_realizacao: string;
  concluded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PreventionChecklistItem {
  id: string;
  checklist_id: string;
  item_key: string;
  item_label: string;
  status: 'C' | 'NC' | 'NA' | null;
  observacoes: string | null;
  foto_r2_key: string | null;
}

export interface PreventionChecklistDetail extends PreventionChecklist {
  items: PreventionChecklistItem[];
}

const CHECKLIST_ITEM_UPDATABLE_FIELDS = ['status', 'observacoes'] as const;

@Injectable()
export class PreventionChecklistService {
  constructor(
    private readonly r2: R2Service,
    private readonly correctiveActions: PreventionCorrectiveActionsService,
  ) {}

  private async assertCompanyUnitBelongsToTenant(client: PoolClient, companyUnitId: string, tenantId: string): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (result.rowCount === 0) throw new NotFoundException('Filial não encontrada');
  }

  private async assertDraft(client: PoolClient, id: string): Promise<{ tenant_id: string }> {
    const result = await client.query<{ status: string; tenant_id: string }>(
      'SELECT status, tenant_id FROM prevention_checklists WHERE id = $1 FOR UPDATE',
      [id],
    );
    const checklist = result.rows[0];
    if (!checklist) throw new NotFoundException('Checklist não encontrado');
    if (checklist.status !== 'rascunho') {
      throw new ConflictException('Checklist já concluído — não pode mais ser editado');
    }
    return checklist;
  }

  async create(
    client: PoolClient,
    tenantId: string,
    companyUnitId: string,
    technicianUserId: string,
    dataRealizacao: string,
  ): Promise<PreventionChecklistDetail> {
    await this.assertCompanyUnitBelongsToTenant(client, companyUnitId, tenantId);

    try {
      const checklistResult = await client.query<PreventionChecklist>(
        `INSERT INTO prevention_checklists (tenant_id, company_unit_id, technician_user_id, data_realizacao)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [tenantId, companyUnitId, technicianUserId, dataRealizacao],
      );
      const checklist = checklistResult.rows[0];

      const values: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const { item_key, item_label } of PREVENTION_CHECKLIST_ITEMS) {
        values.push(`($${i++}, $${i++}, $${i++})`);
        params.push(checklist.id, item_key, item_label);
      }
      const itemsResult = await client.query<PreventionChecklistItem>(
        `INSERT INTO prevention_checklist_items (checklist_id, item_key, item_label)
         VALUES ${values.join(', ')} RETURNING *`,
        params,
      );

      return { ...checklist, items: itemsResult.rows };
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, tenantId?: string): Promise<PreventionChecklist[]> {
    if (tenantId) {
      const result = await client.query<PreventionChecklist>(
        'SELECT * FROM prevention_checklists WHERE tenant_id = $1 ORDER BY data_realizacao DESC',
        [tenantId],
      );
      return result.rows;
    }
    const result = await client.query<PreventionChecklist>(
      'SELECT * FROM prevention_checklists ORDER BY data_realizacao DESC',
    );
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<PreventionChecklistDetail> {
    const checklistResult = await client.query<PreventionChecklist>(
      'SELECT * FROM prevention_checklists WHERE id = $1',
      [id],
    );
    const checklist = checklistResult.rows[0];
    if (!checklist) throw new NotFoundException('Checklist não encontrado');

    const itemsResult = await client.query<PreventionChecklistItem>(
      'SELECT * FROM prevention_checklist_items WHERE checklist_id = $1 ORDER BY item_key',
      [id],
    );
    return { ...checklist, items: itemsResult.rows };
  }

  async updateItem(
    client: PoolClient,
    checklistId: string,
    itemId: string,
    data: { status?: string; observacoes?: string },
  ): Promise<PreventionChecklistItem> {
    await this.assertDraft(client, checklistId);

    const { setClauses, values } = buildSafeSetClause(data, CHECKLIST_ITEM_UPDATABLE_FIELDS, 3);
    if (setClauses.length === 0) {
      const result = await client.query<PreventionChecklistItem>(
        'SELECT * FROM prevention_checklist_items WHERE id = $1 AND checklist_id = $2',
        [itemId, checklistId],
      );
      const item = result.rows[0];
      if (!item) throw new NotFoundException('Item de checklist não encontrado');
      return item;
    }

    const result = await client.query<PreventionChecklistItem>(
      `UPDATE prevention_checklist_items SET ${setClauses.join(', ')}
       WHERE id = $1 AND checklist_id = $2 RETURNING *`,
      [itemId, checklistId, ...values],
    );
    const item = result.rows[0];
    if (!item) throw new NotFoundException('Item de checklist não encontrado');
    return item;
  }

  async uploadItemPhoto(
    client: PoolClient,
    checklistId: string,
    itemId: string,
    file: Express.Multer.File,
  ): Promise<PreventionChecklistItem> {
    const { tenant_id: tenantId } = await this.assertDraft(client, checklistId);

    const itemCheck = await client.query('SELECT id FROM prevention_checklist_items WHERE id = $1 AND checklist_id = $2', [
      itemId,
      checklistId,
    ]);
    if (itemCheck.rowCount === 0) throw new NotFoundException('Item de checklist não encontrado');

    const fileKey = `tenants/${tenantId}/prevention-checklists/${checklistId}/${itemId}/${sanitizeFileName(file.originalname)}`;
    await this.r2.putObject(fileKey, file.buffer, file.mimetype);

    const result = await client.query<PreventionChecklistItem>(
      'UPDATE prevention_checklist_items SET foto_r2_key = $2 WHERE id = $1 RETURNING *',
      [itemId, fileKey],
    );
    return result.rows[0];
  }

  async concluir(client: PoolClient, id: string): Promise<PreventionChecklistDetail> {
    const { tenant_id: tenantId } = await this.assertDraft(client, id);

    await client.query(`UPDATE prevention_checklists SET status = 'concluida', concluded_at = now() WHERE id = $1`, [
      id,
    ]);

    const ncItemsResult = await client.query<PreventionChecklistItem>(
      `SELECT * FROM prevention_checklist_items WHERE checklist_id = $1 AND status = 'NC'`,
      [id],
    );
    for (const item of ncItemsResult.rows) {
      await this.correctiveActions.create(client, {
        tenantId,
        checklistItemId: item.id,
        description: item.item_label,
      });
    }

    return this.findOne(client, id);
  }
}
```

- [ ] **Step 3: Criar os DTOs**

Cria `backend/src/prevention-checklist/dto/create-prevention-checklist.dto.ts`:

```typescript
import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

export class CreatePreventionChecklistDto {
  @IsUUID()
  company_unit_id: string;

  @IsISO8601()
  data_realizacao: string;

  // Só é lido quando quem envia é role 'tecnico' ou 'parceiro' (empresa
  // não pode criar checklist — mesmo padrão de resolução de tenant_id
  // já usado nos sub-projetos A/B, mas aqui o papel 'empresa' nunca
  // chega a esta rota por causa do @Roles do controller).
  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
```

Cria `backend/src/prevention-checklist/dto/update-checklist-item.dto.ts`:

```typescript
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsIn(['C', 'NC', 'NA'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacoes?: string;
}
```

- [ ] **Step 4: Escrever o controller**

Cria `backend/src/prevention-checklist/prevention-checklist.controller.ts`:

```typescript
import {
  BadRequestException,
  Body,
  Controller,
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
import { PreventionChecklistService } from './prevention-checklist.service';
import { CreatePreventionChecklistDto } from './dto/create-prevention-checklist.dto';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';

@Controller('prevention-checklists')
export class PreventionChecklistController {
  constructor(private readonly checklists: PreventionChecklistService) {}

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreatePreventionChecklistDto, @Req() req: any) {
    const user = req.user;
    const tenantId = dto.tenant_id;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.checklists.create(client, tenantId, dto.company_unit_id, user.id, dto.data_realizacao),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.checklists.findAll(client, tenantId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.checklists.findOne(client, id));
  }

  @Roles('tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateChecklistItemDto,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) => this.checklists.updateItem(client, id, itemId, dto));
  }

  @Roles('tecnico', 'parceiro')
  @Post(':id/items/:itemId/foto')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadItemPhoto(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado');
    return req.withTenantContext((client: any) => this.checklists.uploadItemPhoto(client, id, itemId, file));
  }

  @Roles('tecnico', 'parceiro')
  @Post(':id/concluir')
  concluir(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.checklists.concluir(client, id));
  }
}
```

Nota: diferente do padrão de `empresa`/`tecnico`/`parceiro` dos sub-projetos A/B, aqui `tenant_id` vem sempre do body (nunca do token), porque `empresa` nunca chega nessa rota (`@Roles('tecnico', 'parceiro')` bloqueia antes). Isso segue o mesmo espírito de `InspectionsController.create`, que já resolve `tenant_id` só a partir do DTO.

- [ ] **Step 5: Escrever o module**

Cria `backend/src/prevention-checklist/prevention-checklist.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PreventionCorrectiveActionsModule } from '../prevention-corrective-actions/prevention-corrective-actions.module';
import { PreventionChecklistController } from './prevention-checklist.controller';
import { PreventionChecklistService } from './prevention-checklist.service';

@Module({
  imports: [PreventionCorrectiveActionsModule],
  controllers: [PreventionChecklistController],
  providers: [PreventionChecklistService],
  exports: [PreventionChecklistService],
})
export class PreventionChecklistModule {}
```

Em `backend/src/app.module.ts`, adiciona o import junto dos demais módulos:
```typescript
import { PreventionChecklistModule } from './prevention-checklist/prevention-checklist.module';
```
E no array `imports`:
```typescript
    PreventionChecklistModule,
```

- [ ] **Step 6: Escrever o teste e2e**

Cria `backend/test/prevention-checklist.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Checklist de prevenção (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let technicianToken: string;
  let empresaToken: string;
  let tenantId: string;
  let companyUnitId: string;
  let technicianId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Checklist Prevencao');
    tenantId = tenant.tenantId;

    const empresaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = empresaLogin.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial Matriz', 'Rua A', 'Cidade A', 'RS', '90000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const technicianUser = await db.createUserWithRole('tecnico', 'Tecnico Checklist Prevencao');
    technicianId = technicianUser.userId;
    await (db as any).client.query(`INSERT INTO technicians (user_id) VALUES ($1)`, [technicianUser.userId]);
    const technicianRow = await (db as any).client.query('SELECT id FROM technicians WHERE user_id = $1', [
      technicianUser.userId,
    ]);
    await (db as any).client.query(`INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)`, [
      tenantId,
      technicianRow.rows[0].id,
    ]);

    const technicianLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: technicianUser.email, password: technicianUser.password });
    technicianToken = technicianLogin.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('técnico cria um checklist e recebe os 14 itens seedados', async () => {
    const res = await request(app.getHttpServer())
      .post('/prevention-checklists')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ company_unit_id: companyUnitId, data_realizacao: '2026-02-01', tenant_id: tenantId });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('rascunho');
    expect(res.body.items.length).toBe(14);
    expect(res.body.items.every((item: any) => item.status === null)).toBe(true);
  });

  it('empresa não consegue criar checklist (403)', async () => {
    const res = await request(app.getHttpServer())
      .post('/prevention-checklists')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ company_unit_id: companyUnitId, data_realizacao: '2026-02-01', tenant_id: tenantId });

    expect(res.status).toBe(403);
  });

  it('atualiza um item, faz upload de foto, e conclui gerando ação corretiva pro item NC', async () => {
    const created = await request(app.getHttpServer())
      .post('/prevention-checklists')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ company_unit_id: companyUnitId, data_realizacao: '2026-02-02', tenant_id: tenantId });
    const checklistId = created.body.id;
    const ncItem = created.body.items.find((i: any) => i.item_key === 'extintores_acessiveis');
    const okItem = created.body.items.find((i: any) => i.item_key === 'saidas_desobstruidas');

    const ncUpdate = await request(app.getHttpServer())
      .patch(`/prevention-checklists/${checklistId}/items/${ncItem.id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'NC', observacoes: 'Extintor bloqueado por caixas' });
    expect(ncUpdate.status).toBe(200);
    expect(ncUpdate.body.status).toBe('NC');

    const photoUpload = await request(app.getHttpServer())
      .post(`/prevention-checklists/${checklistId}/items/${ncItem.id}/foto`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .attach('file', Buffer.from('fake-image-bytes'), { filename: 'extintor.jpg', contentType: 'image/jpeg' });
    expect(photoUpload.status).toBe(201);
    expect(photoUpload.body.foto_r2_key).toContain(checklistId);

    await request(app.getHttpServer())
      .patch(`/prevention-checklists/${checklistId}/items/${okItem.id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'C' });

    const concludeRes = await request(app.getHttpServer())
      .post(`/prevention-checklists/${checklistId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.status).toBe('concluida');

    const actionsRes = await request(app.getHttpServer())
      .get(`/prevention-corrective-actions?tenant_id=${tenantId}`)
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(actionsRes.body.some((a: any) => a.checklist_item_id === ncItem.id)).toBe(true);
    expect(actionsRes.body.some((a: any) => a.checklist_item_id === okItem.id)).toBe(false);
  });

  it('não permite editar item nem fazer upload depois de concluído', async () => {
    const created = await request(app.getHttpServer())
      .post('/prevention-checklists')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ company_unit_id: companyUnitId, data_realizacao: '2026-02-03', tenant_id: tenantId });
    const checklistId = created.body.id;
    const itemId = created.body.items[0].id;

    await request(app.getHttpServer())
      .post(`/prevention-checklists/${checklistId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);

    const editAttempt = await request(app.getHttpServer())
      .patch(`/prevention-checklists/${checklistId}/items/${itemId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'C' });

    expect(editAttempt.status).toBe(409);
  });
});
```

- [ ] **Step 7: Rodar o teste, confirmar que passa**

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- prevention-checklist"`
Expected: `Tests: 4 passed, 4 total`

- [ ] **Step 8: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/src/prevention-checklist backend/src/app.module.ts backend/test/prevention-checklist.e2e-spec.ts
git commit -m "feat: checklist de prevenção contra incêndio (vistoria técnica, 14 itens, foto)"
```

---

### Task 3: Simulado de emergência

**Files:**
- Create: `backend/src/emergency-drill/emergency-drill.service.ts`
- Create: `backend/src/emergency-drill/emergency-drill.controller.ts`
- Create: `backend/src/emergency-drill/emergency-drill.module.ts`
- Create: `backend/src/emergency-drill/dto/create-emergency-drill.dto.ts`
- Test: `backend/test/emergency-drill.e2e-spec.ts`

**Interfaces:**
- Consumes: `PreventionCorrectiveActionsService.create` (Task 1).
- Produces: `EmergencyDrillService.create/findAll/findOne`, interface `EmergencyDrillReport` (com os números calculados). Task 6 consome os endpoints HTTP.

- [ ] **Step 1: Escrever o service**

Cria `backend/src/emergency-drill/emergency-drill.service.ts`:

```typescript
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { PreventionCorrectiveActionsService } from '../prevention-corrective-actions/prevention-corrective-actions.service';

export interface EmergencyDrill {
  id: string;
  tenant_id: string;
  company_unit_id: string;
  data_realizacao: string;
  horario: string | null;
  tempo_evacuacao_segundos: number | null;
  ponto_encontro_adequado: boolean | null;
  falhas_sinalizacao: boolean;
  falhas_iluminacao: boolean;
  portas_bloqueadas: boolean;
  extintores_obstruidos: boolean;
  observacoes: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface EmergencyDrillParticipant {
  id: string;
  drill_id: string;
  employee_id: string;
  presente: boolean;
  employee_full_name: string;
}

export interface EmergencyDrillReport extends EmergencyDrill {
  participants: EmergencyDrillParticipant[];
  participantes_total: number;
  participantes_ausentes: number;
  brigadistas_presentes: number;
  nao_conformidades: number;
}

interface CreateDrillData {
  tenantId: string;
  companyUnitId: string;
  dataRealizacao: string;
  horario?: string;
  tempoEvacuacaoSegundos?: number;
  pontoEncontroAdequado?: boolean;
  falhasSinalizacao?: boolean;
  falhasIluminacao?: boolean;
  portasBloqueadas?: boolean;
  extintoresObstruidos?: boolean;
  observacoes?: string;
  createdByUserId: string;
  participants: { employeeId: string; presente: boolean }[];
}

const PROBLEM_FLAG_DESCRIPTIONS: Record<
  'falhas_sinalizacao' | 'falhas_iluminacao' | 'portas_bloqueadas' | 'extintores_obstruidos',
  string
> = {
  falhas_sinalizacao: 'Falha de sinalização identificada no simulado de {data}',
  falhas_iluminacao: 'Falha de iluminação de emergência identificada no simulado de {data}',
  portas_bloqueadas: 'Porta de emergência bloqueada identificada no simulado de {data}',
  extintores_obstruidos: 'Extintor obstruído identificado no simulado de {data}',
};

@Injectable()
export class EmergencyDrillService {
  constructor(private readonly correctiveActions: PreventionCorrectiveActionsService) {}

  private async assertCompanyUnitBelongsToTenant(client: PoolClient, companyUnitId: string, tenantId: string): Promise<void> {
    const result = await client.query('SELECT id FROM company_units WHERE id = $1 AND tenant_id = $2', [
      companyUnitId,
      tenantId,
    ]);
    if (result.rowCount === 0) throw new BadRequestException('Filial não encontrada');
  }

  async create(client: PoolClient, data: CreateDrillData): Promise<EmergencyDrillReport> {
    await this.assertCompanyUnitBelongsToTenant(client, data.companyUnitId, data.tenantId);

    try {
      const drillResult = await client.query<EmergencyDrill>(
        `INSERT INTO emergency_drills
           (tenant_id, company_unit_id, data_realizacao, horario, tempo_evacuacao_segundos,
            ponto_encontro_adequado, falhas_sinalizacao, falhas_iluminacao, portas_bloqueadas,
            extintores_obstruidos, observacoes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [
          data.tenantId,
          data.companyUnitId,
          data.dataRealizacao,
          data.horario ?? null,
          data.tempoEvacuacaoSegundos ?? null,
          data.pontoEncontroAdequado ?? null,
          data.falhasSinalizacao ?? false,
          data.falhasIluminacao ?? false,
          data.portasBloqueadas ?? false,
          data.extintoresObstruidos ?? false,
          data.observacoes ?? null,
          data.createdByUserId,
        ],
      );
      const drill = drillResult.rows[0];

      const values: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const participant of data.participants) {
        values.push(`($${i++}, $${i++}, $${i++})`);
        params.push(drill.id, participant.employeeId, participant.presente);
      }
      if (values.length > 0) {
        await client.query(
          `INSERT INTO emergency_drill_participants (drill_id, employee_id, presente) VALUES ${values.join(', ')}`,
          params,
        );
      }

      for (const [flag, template] of Object.entries(PROBLEM_FLAG_DESCRIPTIONS) as [
        keyof typeof PROBLEM_FLAG_DESCRIPTIONS,
        string,
      ][]) {
        if (drill[flag]) {
          await this.correctiveActions.create(client, {
            tenantId: data.tenantId,
            drillId: drill.id,
            description: template.replace('{data}', drill.data_realizacao),
          });
        }
      }

      return this.findOne(client, drill.id);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, tenantId?: string): Promise<EmergencyDrill[]> {
    if (tenantId) {
      const result = await client.query<EmergencyDrill>(
        'SELECT * FROM emergency_drills WHERE tenant_id = $1 ORDER BY data_realizacao DESC',
        [tenantId],
      );
      return result.rows;
    }
    const result = await client.query<EmergencyDrill>('SELECT * FROM emergency_drills ORDER BY data_realizacao DESC');
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<EmergencyDrillReport> {
    const drillResult = await client.query<EmergencyDrill>('SELECT * FROM emergency_drills WHERE id = $1', [id]);
    const drill = drillResult.rows[0];
    if (!drill) throw new NotFoundException('Simulado não encontrado');

    const participantsResult = await client.query<EmergencyDrillParticipant>(
      `SELECT p.*, e.full_name AS employee_full_name
       FROM emergency_drill_participants p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.drill_id = $1
       ORDER BY e.full_name`,
      [id],
    );
    const participants = participantsResult.rows;

    const brigadeResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) FROM emergency_drill_participants p
       JOIN fire_brigade_members m ON m.employee_id = p.employee_id AND m.status = 'ativo'
       WHERE p.drill_id = $1 AND p.presente = true`,
      [id],
    );

    const participantesAusentes = participants.filter((p) => !p.presente).length;
    const flagsAtivas = [
      drill.falhas_sinalizacao,
      drill.falhas_iluminacao,
      drill.portas_bloqueadas,
      drill.extintores_obstruidos,
    ].filter(Boolean).length;

    return {
      ...drill,
      participants,
      participantes_total: participants.length,
      participantes_ausentes: participantesAusentes,
      brigadistas_presentes: Number(brigadeResult.rows[0].count),
      nao_conformidades: flagsAtivas + (participantesAusentes > 0 ? 1 : 0),
    };
  }
}
```

- [ ] **Step 2: Criar o DTO**

Cria `backend/src/emergency-drill/dto/create-emergency-drill.dto.ts`:

```typescript
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class EmergencyDrillParticipantDto {
  @IsUUID()
  employee_id: string;

  @IsBoolean()
  presente: boolean;
}

export class CreateEmergencyDrillDto {
  @IsUUID()
  company_unit_id: string;

  @IsISO8601()
  data_realizacao: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Horário inválido, use HH:MM' })
  horario?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  tempo_evacuacao_segundos?: number;

  @IsOptional()
  @IsBoolean()
  ponto_encontro_adequado?: boolean;

  @IsOptional()
  @IsBoolean()
  falhas_sinalizacao?: boolean;

  @IsOptional()
  @IsBoolean()
  falhas_iluminacao?: boolean;

  @IsOptional()
  @IsBoolean()
  portas_bloqueadas?: boolean;

  @IsOptional()
  @IsBoolean()
  extintores_obstruidos?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  observacoes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmergencyDrillParticipantDto)
  participants: EmergencyDrillParticipantDto[];

  @IsOptional()
  @IsUUID()
  tenant_id?: string;
}
```

- [ ] **Step 3: Escrever o controller**

Cria `backend/src/emergency-drill/emergency-drill.controller.ts`:

```typescript
import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { EmergencyDrillService } from './emergency-drill.service';
import { CreateEmergencyDrillDto } from './dto/create-emergency-drill.dto';

@Controller('emergency-drills')
export class EmergencyDrillController {
  constructor(private readonly drills: EmergencyDrillService) {}

  @Roles('empresa', 'tecnico', 'parceiro')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateEmergencyDrillDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'tecnico' || user.role === 'parceiro' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) =>
      this.drills.create(client, {
        tenantId,
        companyUnitId: dto.company_unit_id,
        dataRealizacao: dto.data_realizacao,
        horario: dto.horario,
        tempoEvacuacaoSegundos: dto.tempo_evacuacao_segundos,
        pontoEncontroAdequado: dto.ponto_encontro_adequado,
        falhasSinalizacao: dto.falhas_sinalizacao,
        falhasIluminacao: dto.falhas_iluminacao,
        portasBloqueadas: dto.portas_bloqueadas,
        extintoresObstruidos: dto.extintores_obstruidos,
        observacoes: dto.observacoes,
        createdByUserId: user.id,
        participants: dto.participants.map((p) => ({ employeeId: p.employee_id, presente: p.presente })),
      }),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    return req.withTenantContext((client: any) => this.drills.findAll(client, tenantId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.drills.findOne(client, id));
  }
}
```

- [ ] **Step 4: Escrever o module e registrar no app**

Cria `backend/src/emergency-drill/emergency-drill.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PreventionCorrectiveActionsModule } from '../prevention-corrective-actions/prevention-corrective-actions.module';
import { EmergencyDrillController } from './emergency-drill.controller';
import { EmergencyDrillService } from './emergency-drill.service';

@Module({
  imports: [PreventionCorrectiveActionsModule],
  controllers: [EmergencyDrillController],
  providers: [EmergencyDrillService],
  exports: [EmergencyDrillService],
})
export class EmergencyDrillModule {}
```

Em `backend/src/app.module.ts`, adiciona o import:
```typescript
import { EmergencyDrillModule } from './emergency-drill/emergency-drill.module';
```
E no array `imports`:
```typescript
    EmergencyDrillModule,
```

- [ ] **Step 5: Escrever o teste e2e**

Cria `backend/test/emergency-drill.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Simulado de emergência (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let companyUnitId: string;
  let employeeId: string;
  let secondEmployeeId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Simulado Emergencia');
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

    const secondEmployee = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Segundo Funcionário Simulado', '22233344455', 'ativo') RETURNING id`,
      [tenantId],
    );
    secondEmployeeId = secondEmployee.rows[0].id;

    await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ employee_id: employeeId, company_unit_id: companyUnitId, funcao_brigada: 'brigadista' });
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('registra um simulado com lista de presença e devolve o relatório calculado', async () => {
    const res = await request(app.getHttpServer())
      .post('/emergency-drills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        company_unit_id: companyUnitId,
        data_realizacao: '2026-03-01',
        horario: '14:00',
        tempo_evacuacao_segundos: 272,
        ponto_encontro_adequado: true,
        falhas_sinalizacao: true,
        participants: [
          { employee_id: employeeId, presente: true },
          { employee_id: secondEmployeeId, presente: false },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.participantes_total).toBe(2);
    expect(res.body.participantes_ausentes).toBe(1);
    expect(res.body.brigadistas_presentes).toBe(1);
    expect(res.body.nao_conformidades).toBe(2);
  });

  it('gera ação corretiva pra cada flag de problema marcada', async () => {
    const res = await request(app.getHttpServer())
      .post('/emergency-drills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        company_unit_id: companyUnitId,
        data_realizacao: '2026-03-02',
        falhas_iluminacao: true,
        portas_bloqueadas: true,
        participants: [{ employee_id: employeeId, presente: true }],
      });

    const actionsRes = await request(app.getHttpServer())
      .get(`/prevention-corrective-actions?tenant_id=${tenantId}`)
      .set('Authorization', `Bearer ${token}`);

    const drillActions = actionsRes.body.filter((a: any) => a.drill_id === res.body.id);
    expect(drillActions.length).toBe(2);
    expect(drillActions.some((a: any) => a.description.includes('iluminação'))).toBe(true);
    expect(drillActions.some((a: any) => a.description.includes('bloqueada'))).toBe(true);
  });

  it('rejeita company_unit_id de outro tenant', async () => {
    const otherTenant = await db.createTenantWithUser('Empresa Simulado Outro Tenant');

    const res = await request(app.getHttpServer())
      .post('/emergency-drills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        company_unit_id: (
          await (db as any).client.query(
            `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
             VALUES ($1, 'Filial Alheia', 'Rua X', 'Cidade X', 'SC', '88000000') RETURNING id`,
            [otherTenant.tenantId],
          )
        ).rows[0].id,
        data_realizacao: '2026-03-03',
        participants: [],
      });

    expect(res.status).toBe(400);
  });

  it('lista simulados do tenant', async () => {
    const res = await request(app.getHttpServer())
      .get(`/emergency-drills?tenant_id=${tenantId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Rodar o teste, confirmar que passa**

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- emergency-drill"`
Expected: `Tests: 4 passed, 4 total`

- [ ] **Step 7: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/src/emergency-drill backend/src/app.module.ts backend/test/emergency-drill.e2e-spec.ts
git commit -m "feat: registro de simulado de emergência com lista de presença e relatório calculado"
```

---

### Task 4: Integração com o dashboard

**Files:**
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/dashboard/dashboard.module.ts`
- Test: `backend/test/prevention-corrective-actions.e2e-spec.ts` (mesmo arquivo da Task 1 — adiciona 1 teste novo)

**Interfaces:**
- Consumes: `PreventionCorrectiveActionsService.getStatusSummary(client, tenantId)` (Task 1).
- Produces: `AttentionItem['tipo']` ganha `'acao_corretiva_prevencao'`; `DashboardService.getSummary` passa a incluir ações corretivas vencidas/vencendo em `atencao`/`resumo.pendencias`/`resumo.avisos`.

- [ ] **Step 1: Adicionar o teste ao arquivo da Task 1 (RED)**

No MESMO arquivo `backend/test/prevention-corrective-actions.e2e-spec.ts`, adiciona o `it(...)` abaixo dentro do `describe` já existente (antes do `});` final):

```typescript
  it('ações corretivas vencida/vencendo/sem-prazo aparecem no dashboard existente com a prioridade certa', async () => {
    const today = new Date();
    const past = new Date(today);
    past.setDate(past.getDate() - 1);
    const soon = new Date(today);
    soon.setDate(soon.getDate() + 10);
    const farFuture = new Date(today);
    farFuture.setDate(farFuture.getDate() + 90);

    await (db as any).client.query(
      `INSERT INTO prevention_corrective_actions (tenant_id, checklist_item_id, description, deadline)
       VALUES ($1, $2, 'Ação vencida pro dashboard', $3)`,
      [tenantId, checklistItemId, past.toISOString().slice(0, 10)],
    );
    await (db as any).client.query(
      `INSERT INTO prevention_corrective_actions (tenant_id, checklist_item_id, description, deadline)
       VALUES ($1, $2, 'Ação vencendo pro dashboard', $3)`,
      [tenantId, checklistItemId, soon.toISOString().slice(0, 10)],
    );
    await (db as any).client.query(
      `INSERT INTO prevention_corrective_actions (tenant_id, checklist_item_id, description)
       VALUES ($1, $2, 'Ação sem prazo pro dashboard')`,
      [tenantId, checklistItemId],
    );
    await (db as any).client.query(
      `INSERT INTO prevention_corrective_actions (tenant_id, checklist_item_id, description, deadline)
       VALUES ($1, $2, 'Ação distante demais pro dashboard', $3)`,
      [tenantId, checklistItemId, farFuture.toISOString().slice(0, 10)],
    );

    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const items = res.body.atencao.filter((i: any) => i.tipo === 'acao_corretiva_prevencao');
    expect(items.find((i: any) => i.titulo === 'Ação vencida pro dashboard').prioridade).toBe('alta');
    expect(items.find((i: any) => i.titulo === 'Ação vencendo pro dashboard').prioridade).toBe('media');
    expect(items.find((i: any) => i.titulo === 'Ação sem prazo pro dashboard').prioridade).toBe('media');
    expect(items.some((i: any) => i.titulo === 'Ação distante demais pro dashboard')).toBe(false);
  });
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- prevention-corrective-actions"`
Expected: FAIL no teste novo — `acao_corretiva_prevencao` nunca aparece em `atencao` ainda.

- [ ] **Step 3: `DashboardService` ganha a nova fonte**

Em `backend/src/dashboard/dashboard.service.ts`, troca:
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

// Cada tipo precisa de uma entrada explícita aqui — true = seguro pra
// mandar pro provedor de IA externo (MiniMax/OpenRouter) via o
// Assistente normativo, false = embute PII de funcionário (nome
// completo) e nunca deve sair do produto pra terceiro (LGPD). Usar
// `satisfies` força o TypeScript a recusar a compilação se um tipo
// novo for adicionado à union sem entrar aqui — não depende de alguém
// lembrar de atualizar um filtro separado (achado da revisão final:
// isso já vazou PII duas vezes, 'cargo' e 'brigada_incendio', porque
// era um denylist de manutenção manual).
export const ATTENTION_TIPO_AI_SAFE = {
  documento: true,
  epi: true,
  acao: true,
  inspecao: true,
  cargo: false,
  equipamento_incendio: true,
  brigada_incendio: false,
} satisfies Record<AttentionItem['tipo'], boolean>;
```
Por:
```typescript
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DocumentsService } from '../documents/documents.service';
import { PositionsService } from '../positions/positions.service';
import { EQUIPMENT_TYPE_LABEL, FireSafetyEquipmentService } from '../fire-safety-equipment/fire-safety-equipment.service';
import { FireBrigadeService } from '../fire-brigade/fire-brigade.service';
import { PreventionCorrectiveActionsService } from '../prevention-corrective-actions/prevention-corrective-actions.service';

export type DashboardStatus = 'ok' | 'atencao' | 'critico';
export type AttentionPriority = 'alta' | 'media' | 'baixa';
export type AttentionResponsible = 'empresa' | 'tecnico';

export interface AttentionItem {
  tipo:
    | 'documento'
    | 'epi'
    | 'acao'
    | 'inspecao'
    | 'cargo'
    | 'equipamento_incendio'
    | 'brigada_incendio'
    | 'acao_corretiva_prevencao';
  titulo: string;
  prioridade: AttentionPriority;
  data: string | null;
  responsavel: AttentionResponsible;
  link: string;
}

// Cada tipo precisa de uma entrada explícita aqui — true = seguro pra
// mandar pro provedor de IA externo (MiniMax/OpenRouter) via o
// Assistente normativo, false = embute PII de funcionário (nome
// completo) e nunca deve sair do produto pra terceiro (LGPD). Usar
// `satisfies` força o TypeScript a recusar a compilação se um tipo
// novo for adicionado à union sem entrar aqui — não depende de alguém
// lembrar de atualizar um filtro separado (achado da revisão final do
// sub-projeto B: isso já vazou PII duas vezes, 'cargo' e
// 'brigada_incendio', porque era um denylist de manutenção manual).
// 'acao_corretiva_prevencao' é seguro: a descrição vem de item_label
// (texto fixo do checklist) ou de um texto gerado (flags do simulado),
// nunca de employee_full_name.
export const ATTENTION_TIPO_AI_SAFE = {
  documento: true,
  epi: true,
  acao: true,
  inspecao: true,
  cargo: false,
  equipamento_incendio: true,
  brigada_incendio: false,
  acao_corretiva_prevencao: true,
} satisfies Record<AttentionItem['tipo'], boolean>;
```

Troca:
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
Por:
```typescript
  constructor(
    private readonly documents: DocumentsService,
    private readonly positionsService: PositionsService,
    private readonly fireSafetyEquipmentService: FireSafetyEquipmentService,
    private readonly fireBrigadeService: FireBrigadeService,
    private readonly preventionCorrectiveActionsService: PreventionCorrectiveActionsService,
  ) {}

  async getSummary(client: PoolClient, tenantId: string): Promise<DashboardSummary> {
    const [
      compliance,
      epis,
      actionPlans,
      inspecoesPendentes,
      positionDivergences,
      fireSafetyEquipment,
      fireBrigade,
      preventionCorrectiveActions,
    ] = await Promise.all([
      this.documents.getCompliance(client, tenantId),
      this.getEpiStatus(client, tenantId),
      this.getActionPlans(client, tenantId),
      this.countInspecoesPendentes(client, tenantId),
      this.positionsService.getDivergences(client, tenantId),
      this.getFireSafetyEquipmentStatus(client, tenantId),
      this.getFireBrigadeStatus(client, tenantId),
      this.preventionCorrectiveActionsService.getStatusSummary(client, tenantId),
    ]);
```

Dentro do array `atencao`, logo depois do `...fireBrigade.avisos.map(...)` já existente, adiciona:
```typescript
      ...preventionCorrectiveActions.pendencias.map((a): AttentionItem => ({
        tipo: 'acao_corretiva_prevencao',
        titulo: a.description,
        prioridade: 'alta',
        data: toDateString(a.deadline),
        responsavel: 'empresa',
        link: a.checklist_item_id ? '/empresa/checklist-prevencao' : '/empresa/simulados',
      })),
      ...preventionCorrectiveActions.avisos.map((a): AttentionItem => ({
        tipo: 'acao_corretiva_prevencao',
        titulo: a.description,
        prioridade: 'media',
        data: toDateString(a.deadline),
        responsavel: 'empresa',
        link: a.checklist_item_id ? '/empresa/checklist-prevencao' : '/empresa/simulados',
      })),
```

Troca a linha de `pendencias`/`avisos`:
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
Por:
```typescript
    const pendencias =
      compliance.pendencias.length +
      epis.pendencias.length +
      positionDivergences.length +
      fireSafetyEquipment.pendencias.length +
      fireBrigade.pendencias.length +
      preventionCorrectiveActions.pendencias.length;
    const avisos =
      compliance.avisos.length +
      epis.avisos.length +
      fireSafetyEquipment.avisos.length +
      fireBrigade.avisos.length +
      preventionCorrectiveActions.avisos.length;
```

- [ ] **Step 4: `DashboardModule` importa `PreventionCorrectiveActionsModule`**

Em `backend/src/dashboard/dashboard.module.ts`, troca:
```typescript
import { FireBrigadeModule } from '../fire-brigade/fire-brigade.module';

@Module({
  imports: [DocumentsModule, PositionsModule, FireSafetyEquipmentModule, FireBrigadeModule],
```
Por:
```typescript
import { FireBrigadeModule } from '../fire-brigade/fire-brigade.module';
import { PreventionCorrectiveActionsModule } from '../prevention-corrective-actions/prevention-corrective-actions.module';

@Module({
  imports: [
    DocumentsModule,
    PositionsModule,
    FireSafetyEquipmentModule,
    FireBrigadeModule,
    PreventionCorrectiveActionsModule,
  ],
```

- [ ] **Step 5: Rodar o teste, confirmar que passa**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- prevention-corrective-actions"`
Expected: `Tests: 5 passed, 5 total`

- [ ] **Step 6: Regressão de `dashboard` e do Assistente (LGPD)**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- dashboard"`
Expected: todas as suítes de `dashboard` já existentes continuam verdes.

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit --testPathPattern='normative-assistant.e2e-spec.ts$'"`
Expected: `Tests: 16 passed, 16 total` — confirma que `ATTENTION_TIPO_AI_SAFE` continua compilando e filtrando do jeito certo com o tipo novo adicionado.

- [ ] **Step 7: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/src/dashboard backend/test/prevention-corrective-actions.e2e-spec.ts
git commit -m "feat: integra ações corretivas de prevenção no dashboard existente"
```

---

### Task 5: Frontend — página `/empresa/checklist-prevencao`

**Files:**
- Create: `frontend/src/app/empresa/checklist-prevencao/page.tsx`
- Create: `frontend/src/components/PreventionChecklistPanel.tsx`
- Modify: `frontend/src/components/EmpresaSidebar.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/prevention-checklists`, `GET /api/prevention-checklists/:id`, `PATCH /api/prevention-checklists/:id/items/:itemId`, `POST /api/prevention-checklists/:id/items/:itemId/foto`, `POST /api/prevention-checklists/:id/concluir`, `GET/PATCH /api/prevention-corrective-actions`, `GET /api/company-units`.

- [ ] **Step 1: Criar a página (wrapper de autenticação)**

Cria `frontend/src/app/empresa/checklist-prevencao/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PreventionChecklistPanel } from '@/components/PreventionChecklistPanel';

export default function EmpresaChecklistPrevencaoPage() {
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
      <h1 className="text-2xl font-bold text-brand-900">Checklist de prevenção</h1>
      <div className="mt-8">
        <PreventionChecklistPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar o painel completo**

Nota importante: este painel é predominantemente **read-only pra empresa** — cadastro/edição de item/conclusão são `@Roles('tecnico', 'parceiro')` no backend, então a empresa só vê a lista de checklists já concluídos (ou em rascunho) e pode marcar ações corretivas como resolvidas. Não existe formulário de criação nesta página (quem cria é o técnico durante uma visita, fora do escopo desta tela — mesma disciplina de Inspeções, que também não tem formulário de criação pela empresa).

Cria `frontend/src/components/PreventionChecklistPanel.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';

interface ChecklistItem {
  id: string;
  item_key: string;
  item_label: string;
  status: 'C' | 'NC' | 'NA' | null;
  observacoes: string | null;
  foto_r2_key: string | null;
}

interface Checklist {
  id: string;
  company_unit_id: string;
  status: 'rascunho' | 'concluida';
  data_realizacao: string;
  concluded_at: string | null;
}

interface ChecklistDetail extends Checklist {
  items: ChecklistItem[];
}

interface CorrectiveAction {
  id: string;
  checklist_item_id: string | null;
  drill_id: string | null;
  description: string;
  status: 'pendente' | 'resolvido';
}

const STATUS_LABEL: Record<NonNullable<ChecklistItem['status']>, { emoji: string; text: string; className: string }> = {
  C: { emoji: '🟢', text: 'Conforme', className: 'text-green-700' },
  NC: { emoji: '🔴', text: 'Não conforme', className: 'text-red-600' },
  NA: { emoji: '⚪', text: 'Não se aplica', className: 'text-brand-500' },
};

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

export function PreventionChecklistPanel() {
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChecklistDetail | null>(null);
  const [correctiveActions, setCorrectiveActions] = useState<CorrectiveAction[]>([]);

  async function loadChecklists() {
    const res = await fetch('/api/prevention-checklists', { headers: authHeaders() });
    if (res.ok) setChecklists(await res.json());
  }

  async function loadCorrectiveActions() {
    const res = await fetch('/api/prevention-corrective-actions', { headers: authHeaders() });
    if (res.ok) setCorrectiveActions(await res.json());
  }

  async function loadDetail(id: string) {
    const res = await fetch(`/api/prevention-checklists/${id}`, { headers: authHeaders() });
    if (res.ok) setDetail(await res.json());
  }

  useEffect(() => {
    loadChecklists();
    loadCorrectiveActions();
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId]);

  async function handleResolve(actionId: string) {
    await fetch(`/api/prevention-corrective-actions/${actionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ status: 'resolvido' }),
    });
    loadCorrectiveActions();
  }

  const actionsForChecklist = (itemIds: string[]) =>
    correctiveActions.filter((a) => a.checklist_item_id && itemIds.includes(a.checklist_item_id));

  return (
    <div className="flex flex-col gap-6">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-brand-700">
            <th className="px-2 py-1">Data</th>
            <th className="px-2 py-1">Status</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {checklists.map((checklist) => (
            <tr key={checklist.id} className="border-t border-brand-50">
              <td className="px-2 py-1 font-medium text-brand-900">{formatDate(checklist.data_realizacao)}</td>
              <td className="px-2 py-1">{checklist.status === 'concluida' ? 'Concluído' : 'Em andamento'}</td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => setSelectedId(checklist.id)}
                  className="text-xs text-brand-700 underline"
                >
                  Ver detalhes
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <div className="rounded-md border border-brand-100 p-4">
          <h2 className="text-lg font-semibold text-brand-900">
            Checklist de {formatDate(detail.data_realizacao)}
          </h2>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-brand-700">
                <th className="px-2 py-1">Item</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Observações</th>
                <th className="px-2 py-1">Foto</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item) => (
                <tr key={item.id} className="border-t border-brand-50">
                  <td className="px-2 py-1">{item.item_label}</td>
                  <td className={`px-2 py-1 ${item.status ? STATUS_LABEL[item.status].className : ''}`}>
                    {item.status ? `${STATUS_LABEL[item.status].emoji} ${STATUS_LABEL[item.status].text}` : '—'}
                  </td>
                  <td className="px-2 py-1">{item.observacoes ?? '—'}</td>
                  <td className="px-2 py-1">{item.foto_r2_key ? '📷' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {actionsForChecklist(detail.items.map((i) => i.id)).length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-brand-900">Ações corretivas</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {actionsForChecklist(detail.items.map((i) => i.id)).map((action) => (
                  <li key={action.id} className="flex items-center justify-between text-sm">
                    <span>{action.description}</span>
                    {action.status === 'pendente' ? (
                      <button
                        type="button"
                        onClick={() => handleResolve(action.id)}
                        className="text-xs text-brand-700 underline"
                      >
                        Marcar resolvido
                      </button>
                    ) : (
                      <span className="text-xs text-green-700">Resolvido</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Adicionar entrada de navegação no sidebar**

Em `frontend/src/components/EmpresaSidebar.tsx`, dentro do grupo `Segurança`, adiciona uma entrada logo depois de `{ href: '/empresa/brigada', label: 'Brigada de incêndio', emoji: '👨‍🚒' }` (inserida pelo sub-projeto B):
```typescript
      { href: '/empresa/checklist-prevencao', label: 'Checklist de prevenção', emoji: '📋' },
```

Confirme a localização exata antes de aplicar — o grupo `Segurança` deve ter `assistente`/`documentos`/`epis`/`consulta-ca`/`inspecoes`/`mapa-sst`/`equipamentos-incendio`/`brigada`, nessa ordem.

- [ ] **Step 4: Deploy e confirmação do bundle real**

```bash
docker compose build frontend
docker compose up -d frontend
```

```bash
docker compose exec frontend sh -c "grep -rl 'Checklist de prevenção' .next/server/app 2>/dev/null || grep -rl 'Checklist de prevenção' .next/static/chunks 2>/dev/null"
```

Expected: pelo menos um arquivo encontrado.

- [ ] **Step 5: Verificação Playwright real**

Escreva um script Playwright (Node, scratchpad) que abre `https://montesesst.com.br/empresa/checklist-prevencao` com sessão sintética (`localStorage`), mocka `GET /api/prevention-checklists` (lista com 1 checklist concluído), `GET /api/prevention-checklists/:id` (com os 14 itens, um deles `NC` com foto), `GET /api/prevention-corrective-actions` (1 pendente ligada ao item NC), `PATCH /api/prevention-corrective-actions/:id` (sucesso), e confirma:

1. A tabela de checklists renderiza a linha com a data formatada dd/mm/yyyy.
2. Clicar em "Ver detalhes" carrega e mostra os 14 itens com status/emoji certos.
3. O item com foto mostra o indicador 📷; os sem foto mostram "—".
4. A ação corretiva pendente aparece com o botão "Marcar resolvido"; clicar dispara `PATCH /api/prevention-corrective-actions/:id` com `{status: 'resolvido'}`.
5. O link "Checklist de prevenção" aparece no sidebar (`EmpresaSidebar`) e aponta pra `/empresa/checklist-prevencao`.

Run: script Playwright real contra a URL de produção.
Expected: todas as asserções passam.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/empresa/checklist-prevencao frontend/src/components/PreventionChecklistPanel.tsx frontend/src/components/EmpresaSidebar.tsx
git commit -m "feat: página de checklist de prevenção contra incêndio + entrada no sidebar"
```

---

### Task 6: Frontend — página `/empresa/simulados`

**Files:**
- Create: `frontend/src/app/empresa/simulados/page.tsx`
- Create: `frontend/src/components/EmergencyDrillPanel.tsx`
- Modify: `frontend/src/components/EmpresaSidebar.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/emergency-drills`, `GET /api/emergency-drills/:id`, `GET /api/employees`, `GET /api/company-units`, `GET/PATCH /api/prevention-corrective-actions`.

- [ ] **Step 1: Criar a página (wrapper de autenticação)**

Cria `frontend/src/app/empresa/simulados/page.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmergencyDrillPanel } from '@/components/EmergencyDrillPanel';

export default function EmpresaSimuladosPage() {
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
      <h1 className="text-2xl font-bold text-brand-900">Simulados de emergência</h1>
      <div className="mt-8">
        <EmergencyDrillPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar o painel completo**

Cria `frontend/src/components/EmergencyDrillPanel.tsx`:

```typescript
'use client';

import { FormEvent, useEffect, useState } from 'react';

interface EmployeeOption {
  id: string;
  full_name: string;
  status: string;
}

interface CompanyUnitOption {
  id: string;
  name: string;
}

interface DrillSummary {
  id: string;
  company_unit_id: string;
  data_realizacao: string;
}

interface DrillReport extends DrillSummary {
  horario: string | null;
  tempo_evacuacao_segundos: number | null;
  participantes_total: number;
  participantes_ausentes: number;
  brigadistas_presentes: number;
  nao_conformidades: number;
}

interface CorrectiveAction {
  id: string;
  drill_id: string | null;
  description: string;
  status: 'pendente' | 'resolvido';
}

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function formatSeconds(totalSeconds: number | null): string {
  if (totalSeconds === null) return '—';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}min${seconds.toString().padStart(2, '0')}s`;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

export function EmergencyDrillPanel() {
  const [drills, setDrills] = useState<DrillSummary[]>([]);
  const [selectedReport, setSelectedReport] = useState<DrillReport | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [units, setUnits] = useState<CompanyUnitOption[]>([]);
  const [correctiveActions, setCorrectiveActions] = useState<CorrectiveAction[]>([]);

  const [companyUnitId, setCompanyUnitId] = useState('');
  const [dataRealizacao, setDataRealizacao] = useState('');
  const [horario, setHorario] = useState('');
  const [tempoEvacuacao, setTempoEvacuacao] = useState('');
  const [pontoEncontroAdequado, setPontoEncontroAdequado] = useState(true);
  const [falhasSinalizacao, setFalhasSinalizacao] = useState(false);
  const [falhasIluminacao, setFalhasIluminacao] = useState(false);
  const [portasBloqueadas, setPortasBloqueadas] = useState(false);
  const [extintoresObstruidos, setExtintoresObstruidos] = useState(false);
  const [observacoes, setObservacoes] = useState('');
  const [presenca, setPresenca] = useState<Record<string, boolean>>({});
  const [createError, setCreateError] = useState('');

  async function loadDrills() {
    const res = await fetch('/api/emergency-drills', { headers: authHeaders() });
    if (res.ok) setDrills(await res.json());
  }

  async function loadEmployees() {
    const res = await fetch('/api/employees', { headers: authHeaders() });
    if (res.ok) {
      const all: EmployeeOption[] = await res.json();
      const active = all.filter((e) => e.status === 'ativo');
      setEmployees(active);
      setPresenca(Object.fromEntries(active.map((e) => [e.id, true])));
    }
  }

  async function loadUnits() {
    const res = await fetch('/api/company-units', { headers: authHeaders() });
    if (res.ok) setUnits(await res.json());
  }

  async function loadCorrectiveActions() {
    const res = await fetch('/api/prevention-corrective-actions', { headers: authHeaders() });
    if (res.ok) setCorrectiveActions(await res.json());
  }

  async function loadReport(id: string) {
    const res = await fetch(`/api/emergency-drills/${id}`, { headers: authHeaders() });
    if (res.ok) setSelectedReport(await res.json());
  }

  useEffect(() => {
    loadDrills();
    loadEmployees();
    loadUnits();
    loadCorrectiveActions();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError('');
    const res = await fetch('/api/emergency-drills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        company_unit_id: companyUnitId,
        data_realizacao: dataRealizacao,
        horario: horario || undefined,
        tempo_evacuacao_segundos: tempoEvacuacao ? parseInt(tempoEvacuacao, 10) : undefined,
        ponto_encontro_adequado: pontoEncontroAdequado,
        falhas_sinalizacao: falhasSinalizacao,
        falhas_iluminacao: falhasIluminacao,
        portas_bloqueadas: portasBloqueadas,
        extintores_obstruidos: extintoresObstruidos,
        observacoes: observacoes || undefined,
        participants: employees.map((emp) => ({ employee_id: emp.id, presente: presenca[emp.id] ?? true })),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setCreateError(body?.message ?? 'Não foi possível registrar o simulado.');
      return;
    }
    setCompanyUnitId('');
    setDataRealizacao('');
    setHorario('');
    setTempoEvacuacao('');
    setObservacoes('');
    setFalhasSinalizacao(false);
    setFalhasIluminacao(false);
    setPortasBloqueadas(false);
    setExtintoresObstruidos(false);
    loadDrills();
    loadCorrectiveActions();
  }

  async function handleResolve(actionId: string) {
    await fetch(`/api/prevention-corrective-actions/${actionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ status: 'resolvido' }),
    });
    loadCorrectiveActions();
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-md border border-brand-100 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            Data
            <input
              type="date"
              value={dataRealizacao}
              onChange={(e) => setDataRealizacao(e.target.value)}
              required
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Horário
            <input
              type="time"
              value={horario}
              onChange={(e) => setHorario(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tempo de evacuação (segundos)
            <input
              type="number"
              min={0}
              value={tempoEvacuacao}
              onChange={(e) => setTempoEvacuacao(e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-brand-900">
          <input
            type="checkbox"
            checked={pontoEncontroAdequado}
            onChange={(e) => setPontoEncontroAdequado(e.target.checked)}
          />
          Ponto de encontro adequado
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-brand-900">Problemas encontrados</span>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input type="checkbox" checked={falhasSinalizacao} onChange={(e) => setFalhasSinalizacao(e.target.checked)} />
            Falha de sinalização
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input type="checkbox" checked={falhasIluminacao} onChange={(e) => setFalhasIluminacao(e.target.checked)} />
            Falha de iluminação de emergência
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input type="checkbox" checked={portasBloqueadas} onChange={(e) => setPortasBloqueadas(e.target.checked)} />
            Porta de emergência bloqueada
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input
              type="checkbox"
              checked={extintoresObstruidos}
              onChange={(e) => setExtintoresObstruidos(e.target.checked)}
            />
            Extintor obstruído
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm text-brand-900">
          Observações
          <textarea
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-brand-900">Lista de presença</span>
          <div className="max-h-64 overflow-y-auto rounded-md border border-brand-100">
            {employees.map((emp) => (
              <label key={emp.id} className="flex items-center gap-2 border-b border-brand-50 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={presenca[emp.id] ?? true}
                  onChange={(e) => setPresenca({ ...presenca, [emp.id]: e.target.checked })}
                />
                {emp.full_name}
              </label>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="self-start rounded-md bg-brand-500 px-6 py-2 font-medium text-white hover:bg-brand-700"
        >
          Registrar simulado
        </button>
        {createError && <p className="text-sm text-red-600">{createError}</p>}
      </form>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-brand-700">
            <th className="px-2 py-1">Data</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {drills.map((drill) => (
            <tr key={drill.id} className="border-t border-brand-50">
              <td className="px-2 py-1 font-medium text-brand-900">{formatDate(drill.data_realizacao)}</td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => loadReport(drill.id)}
                  className="text-xs text-brand-700 underline"
                >
                  Ver relatório
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedReport && (
        <div className="rounded-md border border-brand-100 p-4">
          <h2 className="text-lg font-semibold text-brand-900">
            Relatório do simulado de {formatDate(selectedReport.data_realizacao)}
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-brand-900">
                {formatSeconds(selectedReport.tempo_evacuacao_segundos)}
              </div>
              <div className="text-xs text-brand-700">Tempo de evacuação</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-brand-900">{selectedReport.participantes_total}</div>
              <div className="text-xs text-brand-700">Participantes</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-brand-900">{selectedReport.brigadistas_presentes}</div>
              <div className="text-xs text-brand-700">Brigadistas</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{selectedReport.nao_conformidades}</div>
              <div className="text-xs text-brand-700">Não conformidades</div>
            </div>
          </div>
        </div>
      )}

      {correctiveActions.filter((a) => a.drill_id).length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-brand-900">Ações corretivas de simulados</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {correctiveActions
              .filter((a) => a.drill_id)
              .map((action) => (
                <li key={action.id} className="flex items-center justify-between text-sm">
                  <span>{action.description}</span>
                  {action.status === 'pendente' ? (
                    <button
                      type="button"
                      onClick={() => handleResolve(action.id)}
                      className="text-xs text-brand-700 underline"
                    >
                      Marcar resolvido
                    </button>
                  ) : (
                    <span className="text-xs text-green-700">Resolvido</span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Adicionar entrada de navegação no sidebar**

Em `frontend/src/components/EmpresaSidebar.tsx`, dentro do grupo `Segurança`, adiciona uma entrada logo depois de `{ href: '/empresa/checklist-prevencao', label: 'Checklist de prevenção', emoji: '📋' }` (inserida pela Task 5):
```typescript
      { href: '/empresa/simulados', label: 'Simulados de emergência', emoji: '🚨' },
```

- [ ] **Step 4: Deploy e confirmação do bundle real**

```bash
docker compose build frontend
docker compose up -d frontend
```

```bash
docker compose exec frontend sh -c "grep -rl 'Simulados de emergência' .next/server/app 2>/dev/null || grep -rl 'Simulados de emergência' .next/static/chunks 2>/dev/null"
```

Expected: pelo menos um arquivo encontrado.

- [ ] **Step 5: Verificação Playwright real**

Escreva um script Playwright (Node, scratchpad) que abre `https://montesesst.com.br/empresa/simulados` com sessão sintética (`localStorage`), mocka `GET /api/employees` (2 funcionários ativos, 1 inativo), `GET /api/company-units` (1 filial), `GET /api/emergency-drills` (lista com 1 simulado), `GET /api/emergency-drills/:id` (relatório calculado), `GET /api/prevention-corrective-actions` (1 pendente ligada a um `drill_id`), `POST /api/emergency-drills` (sucesso), `PATCH /api/prevention-corrective-actions/:id` (sucesso), e confirma:

1. A lista de presença mostra só os 2 funcionários ativos (não o inativo), todos marcados presentes por padrão.
2. Desmarcar um funcionário e submeter o formulário dispara `POST /api/emergency-drills` com `participants` incluindo `presente: false` pro funcionário desmarcado.
3. Marcar uma das 4 flags de problema e submeter inclui essa flag como `true` no corpo do POST.
4. Clicar em "Ver relatório" mostra os 4 números calculados (tempo formatado `MMmSSs`, participantes, brigadistas, não conformidades).
5. A ação corretiva de simulado pendente aparece com o botão "Marcar resolvido"; clicar dispara o `PATCH` certo.
6. O link "Simulados de emergência" aparece no sidebar e aponta pra `/empresa/simulados`.

Run: script Playwright real contra a URL de produção.
Expected: todas as asserções passam.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/empresa/simulados frontend/src/components/EmergencyDrillPanel.tsx frontend/src/components/EmpresaSidebar.tsx
git commit -m "feat: página de simulados de emergência + entrada no sidebar"
```
