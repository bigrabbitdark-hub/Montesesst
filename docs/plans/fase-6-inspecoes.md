# Fase 6 (sub-projeto A — Fluxo de inspeção) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao técnico responsável uma forma real de registrar uma
visita técnica presencial — checklist estruturado de 9 blocos — e à
empresa cliente visibilidade em tempo real do que foi encontrado,
incluindo os planos de ação gerados automaticamente de toda não
conformidade.

**Architecture:** Três tabelas novas (`inspections`, cabeçalho;
`inspection_checklist_items`, genérica — `block`/`item_key`/`item_label`/
`status`/`notes`, não colunas fixas; `action_plans`, gerada
automaticamente na conclusão). RLS de `inspections` e `action_plans`
segue exatamente o padrão de `documents` (empresa vê o próprio tenant,
técnico vê tenants vinculados via `tenant_technicians`, sem gate extra de
status — empresa vê rascunho em tempo real). `inspection_checklist_items`
delega sua RLS pra de `inspections` via `EXISTS`, evitando duplicar a
lógica de vínculo. Itens de checklist são fixos numa constante de código
(16 itens, 4 por bloco), semeados na criação da inspeção. Ciclo
rascunho→concluída: edição livre em rascunho (autosave por item),
travada após `POST /inspections/:id/concluir`, que gera um `action_plan`
por item marcado `NC` na mesma transação.

**Tech Stack:** NestJS + `pg` (PoolClient), Postgres com RLS, Next.js 14
App Router + Tailwind v4, tudo em containers Docker reais desta VPS.
Nenhuma dependência nova (sem R2, sem serviço externo).

**Spec:** [`docs/specs/fase-6-inspecoes.md`](../specs/fase-6-inspecoes.md)

## Global Constraints

- Blocos de checklist fixos: `documentacao`, `epis`, `instalacoes`,
  `maquinas`. Status de item: `C` (conforme), `NC` (não conforme), `NA`
  (não aplicável).
- Status de inspeção: `rascunho` (padrão na criação) → `concluida`
  (definitivo, via `POST /inspections/:id/concluir`). Depois de
  concluída, `PATCH /inspections/:id` e `PATCH
  /inspections/:id/items/:itemId` rejeitam com 409.
- Só o técnico responsável (`@Roles('tecnico')`) cria/edita/conclui
  inspeções nesta entrega. Empresa e técnico (vinculado) só leem —
  `GET /inspections`, `GET /inspections/:id`, `GET /action-plans` não têm
  `@Roles` (RLS decide o que cada um vê).
- RLS de `inspections` e `action_plans`: idêntica ao padrão de
  `documents_isolation` (`docs/specs/fase-4-documentos.md`, seção 2.3) —
  `admin` vê tudo; `empresa` vê o próprio `tenant_id`; `tecnico` vê
  qualquer tenant ao qual esteja vinculado via `tenant_technicians`
  (`EXISTS`). Sem condição adicional de `status` — empresa vê a inspeção
  completa mesmo em rascunho.
- Assinatura: nome digitado (`technician_signature_name`,
  `company_signature_name`), sem canvas. Gravar um desses nomes via
  `PATCH /inspections/:id` também grava o `_at` correspondente
  (`now()`), no mesmo UPDATE.
- Planos de ação (`action_plans`) só nascem em `POST
  /inspections/:id/concluir`, um por item `NC`, nunca item a item durante
  o rascunho. `description` = `item_label` do item de origem.
  `deadline`/`responsible` ficam `NULL` nesta entrega (preenchidos depois,
  fora de escopo).
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
    -e R2_ACCOUNT_ID="${R2_ACCOUNT_ID}" -e R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
    -e R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" -e R2_BUCKET="${R2_BUCKET}" \
    -e R2_ENDPOINT="${R2_ENDPOINT}" \
    node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/<arquivo>.e2e-spec.ts"
  ```
  (mesmo comando/ressalvas documentados em `docs/plans/fase-4-documentos.md`
  — `PUBLIC_APP_URL` e as demais variáveis existem só para o boot do
  `AppModule` completo não falhar, mesmo que a suíte da vez não use R2
  nem Mercado Pago diretamente.)
- Frontend: build isolado antes de considerar uma task de frontend
  pronta (evita depender do container `montese_frontend` de produção,
  que pode estar com trabalho não commitado de outra sessão):
  ```bash
  cd /opt/Montese/frontend && docker build --target builder -t montese-frontend-test-build . \
    && docker rmi montese-frontend-test-build
  ```

---

### Task 1: Migration — tabelas `inspections`, `inspection_checklist_items`, `action_plans` + RLS

**Files:**
- Create: `backend/db/migrations/0010_inspections.sql`
- Test: `backend/test/inspections-rls.e2e-spec.ts`

**Interfaces:**
- Consumes: `tenants`, `tenant_technicians`, `technicians`, `users`
  (existentes), função `set_updated_at()` (existente, `0001_init.sql`).
- Produces: tabelas `inspections`, `inspection_checklist_items`,
  `action_plans` com RLS — todas as tasks seguintes dependem deste
  schema exatamente como descrito abaixo.

- [ ] **Step 1: Escrever a migration**

`backend/db/migrations/0010_inspections.sql`:

```sql
-- Fase 6 (sub-projeto A — Fluxo de inspeção): checklist estruturado de
-- visita técnica presencial (9 blocos do modelo de referência), com
-- geração automática de plano de ação a partir de item não conforme.
-- Ver docs/specs/fase-6-inspecoes.md.

CREATE TABLE inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  technician_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'concluida')),
  visited_at DATE NOT NULL,
  company_contact TEXT,
  dds_topic TEXT,
  dds_participants_count INTEGER,
  dds_notes TEXT,
  general_recommendations TEXT,
  technician_signature_name TEXT,
  technician_signature_at TIMESTAMPTZ,
  company_signature_name TEXT,
  company_signature_at TIMESTAMPTZ,
  concluded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_inspections_updated_at BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections FORCE ROW LEVEL SECURITY;
CREATE POLICY inspections_isolation ON inspections USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = inspections.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
);

CREATE TABLE inspection_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  block TEXT NOT NULL CHECK (block IN ('documentacao', 'epis', 'instalacoes', 'maquinas')),
  item_key TEXT NOT NULL,
  item_label TEXT NOT NULL,
  status TEXT CHECK (status IN ('C', 'NC', 'NA')),
  notes TEXT,
  UNIQUE (inspection_id, item_key)
);

ALTER TABLE inspection_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_checklist_items FORCE ROW LEVEL SECURITY;
CREATE POLICY inspection_checklist_items_isolation ON inspection_checklist_items USING (
  EXISTS (SELECT 1 FROM inspections i WHERE i.id = inspection_checklist_items.inspection_id)
);

CREATE TABLE action_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  checklist_item_id UUID REFERENCES inspection_checklist_items(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  deadline DATE,
  responsible TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'resolvido')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY action_plans_isolation ON action_plans USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = action_plans.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
);
```

Nenhum `GRANT` extra necessário — mesma role (`montese_app`) dona de
todas as outras tabelas de aplicação.

- [ ] **Step 2: Rodar a migração contra o Postgres real do Docker**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  node:20-alpine npm run db:migrate
```

Esperado: `0010_inspections.sql` aplicada (não `[skip]`, primeira vez).

- [ ] **Step 3: Escrever o teste de RLS (positivo e negativo, nas três tabelas)**

`backend/test/inspections-rls.e2e-spec.ts`:

```typescript
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS em inspections/inspection_checklist_items/action_plans (e2e)', () => {
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let inspectionAId: string;
  let inspectionBId: string;
  let itemAId: string;
  let actionPlanAId: string;
  let technicianLinkedUserId: string;
  let technicianLinkedId: string;
  let technicianUnlinkedUserId: string;
  let technicianUnlinkedId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Inspection RLS A');
    const tenantB = await db.createTenantWithUser('Empresa Inspection RLS B');
    tenantAId = tenantA.tenantId;
    tenantBId = tenantB.tenantId;

    const linkedTech = await db.createUserWithRole('tecnico', 'Tecnico Vinculado Inspection RLS');
    const unlinkedTech = await db.createUserWithRole('tecnico', 'Tecnico Nao Vinculado Inspection RLS');
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

    const insertInspectionA = await (db as any).client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at)
       VALUES ($1, $2, '2026-08-25') RETURNING id`,
      [tenantAId, technicianLinkedUserId],
    );
    inspectionAId = insertInspectionA.rows[0].id;

    const insertInspectionB = await (db as any).client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at)
       VALUES ($1, $2, '2026-08-25') RETURNING id`,
      [tenantBId, technicianUnlinkedUserId],
    );
    inspectionBId = insertInspectionB.rows[0].id;

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
    await (db as any).client.query('DELETE FROM inspections WHERE id = ANY($1)', [
      [inspectionAId, inspectionBId],
    ]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = ANY($1)', [
      [technicianLinkedId, technicianUnlinkedId],
    ]);
    await db.cleanup();
    await db.disconnect();
  });

  async function queryAsContext(
    role: string,
    tenantId: string | null,
    userId: string,
    table: 'inspections' | 'inspection_checklist_items' | 'action_plans',
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

  it('empresa A só vê a própria inspeção via RLS, nunca a de empresa B', async () => {
    const ids = await queryAsContext('empresa', tenantAId, randomUUID(), 'inspections');
    expect(ids).toContain(inspectionAId);
    expect(ids).not.toContain(inspectionBId);
  });

  it('técnico vinculado à empresa A vê a inspeção dela; técnico não vinculado não vê nenhuma', async () => {
    const linkedIds = await queryAsContext('tecnico', null, technicianLinkedUserId, 'inspections');
    expect(linkedIds).toContain(inspectionAId);

    const unlinkedIds = await queryAsContext('tecnico', null, technicianUnlinkedUserId, 'inspections');
    expect(unlinkedIds).not.toContain(inspectionAId);
    expect(unlinkedIds).not.toContain(inspectionBId);
  });

  it('inspection_checklist_items herda a visibilidade de inspections', async () => {
    const ids = await queryAsContext('empresa', tenantAId, randomUUID(), 'inspection_checklist_items');
    expect(ids).toContain(itemAId);

    const otherTenantIds = await queryAsContext('empresa', tenantBId, randomUUID(), 'inspection_checklist_items');
    expect(otherTenantIds).not.toContain(itemAId);
  });

  it('action_plans segue o mesmo isolamento de tenant/técnico vinculado', async () => {
    const ownerIds = await queryAsContext('empresa', tenantAId, randomUUID(), 'action_plans');
    expect(ownerIds).toContain(actionPlanAId);

    const otherTenantIds = await queryAsContext('empresa', tenantBId, randomUUID(), 'action_plans');
    expect(otherTenantIds).not.toContain(actionPlanAId);

    const unlinkedTechIds = await queryAsContext('tecnico', null, technicianUnlinkedUserId, 'action_plans');
    expect(unlinkedTechIds).not.toContain(actionPlanAId);
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
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/inspections-rls.e2e-spec.ts"
```

Esperado: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/0010_inspections.sql backend/test/inspections-rls.e2e-spec.ts
git commit -m "feat: migration de inspections/inspection_checklist_items/action_plans com RLS"
```

---

### Task 2: Constante de checklist + `POST /inspections` + `GET /inspections` + `GET /inspections/:id`

**Files:**
- Create: `backend/src/inspections/checklist-items.const.ts`
- Create: `backend/src/inspections/inspections.service.ts`
- Create: `backend/src/inspections/inspections.controller.ts`
- Create: `backend/src/inspections/inspections.module.ts`
- Create: `backend/src/inspections/dto/create-inspection.dto.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/inspections-create-list.e2e-spec.ts`

**Interfaces:**
- Consumes: tabelas da Task 1.
- Produces: `CHECKLIST_ITEMS: ChecklistItemDefinition[]` (16 itens) —
  usada por `InspectionsService.create` aqui e não muda depois;
  `InspectionsService.create/findAll/findOne`, interfaces `Inspection`,
  `ChecklistItem`, `ActionPlan`, `InspectionDetail` — Tasks 3, 4 e 5
  adicionam métodos ao mesmo service reaproveitando exatamente estes
  tipos; `POST /inspections` → `InspectionDetail`; `GET /inspections` →
  `Inspection[]`; `GET /inspections/:id` → `InspectionDetail` — Task 6
  (frontend) consome os três shapes exatamente assim.

- [ ] **Step 1: Escrever a constante de itens de checklist**

`backend/src/inspections/checklist-items.const.ts`:

```typescript
export type ChecklistBlock = 'documentacao' | 'epis' | 'instalacoes' | 'maquinas';

export interface ChecklistItemDefinition {
  block: ChecklistBlock;
  item_key: string;
  item_label: string;
}

// Itens fixos do modelo de referência real (docs/reference/modelos-relatorios-sst.md,
// seção 2, blocos 2/3/5/6). Única fonte de verdade — usada tanto pra semear
// uma inspeção nova quanto pelos rótulos que a API devolve.
export const CHECKLIST_ITEMS: ChecklistItemDefinition[] = [
  { block: 'documentacao', item_key: 'fichas_epi', item_label: 'Fichas de EPI em dia' },
  { block: 'documentacao', item_key: 'ordem_servico', item_label: 'Ordem de Serviço' },
  { block: 'documentacao', item_key: 'validade_ca', item_label: 'Validade do CA' },
  { block: 'documentacao', item_key: 'aso_em_dia', item_label: 'ASO em dia' },
  { block: 'epis', item_key: 'uso_adequado', item_label: 'Uso adequado' },
  { block: 'epis', item_key: 'estado_conservacao', item_label: 'Estado de conservação' },
  { block: 'epis', item_key: 'compatibilidade_risco', item_label: 'Compatibilidade com risco do setor' },
  { block: 'epis', item_key: 'reposicao_danificados', item_label: 'Reposição de danificados' },
  { block: 'instalacoes', item_key: 'luzes_emergencia', item_label: 'Luzes de emergência' },
  { block: 'instalacoes', item_key: 'sinalizacao', item_label: 'Sinalização' },
  { block: 'instalacoes', item_key: 'extintores', item_label: 'Extintores (validade e pressão)' },
  { block: 'instalacoes', item_key: 'rotas_fuga', item_label: 'Rotas de fuga' },
  { block: 'maquinas', item_key: 'protecoes', item_label: 'Proteções' },
  { block: 'maquinas', item_key: 'loto', item_label: 'LOTO (bloqueio/travamento)' },
  { block: 'maquinas', item_key: 'distancia_seguranca', item_label: 'Distância de segurança' },
  { block: 'maquinas', item_key: 'treinamento_operador', item_label: 'Treinamento do operador' },
];
```

- [ ] **Step 2: Escrever o DTO de criação**

`backend/src/inspections/dto/create-inspection.dto.ts`:

```typescript
import { IsISO8601, IsUUID } from 'class-validator';

export class CreateInspectionDto {
  @IsUUID()
  tenant_id: string;

  @IsISO8601()
  visited_at: string;
}
```

- [ ] **Step 3: Escrever o service**

`backend/src/inspections/inspections.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CHECKLIST_ITEMS, ChecklistBlock } from './checklist-items.const';

export interface Inspection {
  id: string;
  tenant_id: string;
  technician_user_id: string;
  status: 'rascunho' | 'concluida';
  visited_at: string;
  company_contact: string | null;
  dds_topic: string | null;
  dds_participants_count: number | null;
  dds_notes: string | null;
  general_recommendations: string | null;
  technician_signature_name: string | null;
  technician_signature_at: string | null;
  company_signature_name: string | null;
  company_signature_at: string | null;
  concluded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id: string;
  inspection_id: string;
  block: ChecklistBlock;
  item_key: string;
  item_label: string;
  status: 'C' | 'NC' | 'NA' | null;
  notes: string | null;
}

export interface ActionPlan {
  id: string;
  tenant_id: string;
  inspection_id: string;
  checklist_item_id: string | null;
  description: string;
  deadline: string | null;
  responsible: string | null;
  status: 'pendente' | 'resolvido';
  created_at: string;
}

export interface InspectionDetail extends Inspection {
  items: ChecklistItem[];
  action_plans: ActionPlan[];
}

@Injectable()
export class InspectionsService {
  async create(
    client: PoolClient,
    tenantId: string,
    technicianUserId: string,
    visitedAt: string,
  ): Promise<InspectionDetail> {
    const inspectionResult = await client.query<Inspection>(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at)
       VALUES ($1, $2, $3) RETURNING *`,
      [tenantId, technicianUserId, visitedAt],
    );
    const inspection = inspectionResult.rows[0];

    const values: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    for (const { block, item_key, item_label } of CHECKLIST_ITEMS) {
      values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
      params.push(inspection.id, block, item_key, item_label);
    }
    const itemsResult = await client.query<ChecklistItem>(
      `INSERT INTO inspection_checklist_items (inspection_id, block, item_key, item_label)
       VALUES ${values.join(', ')} RETURNING *`,
      params,
    );

    return { ...inspection, items: itemsResult.rows, action_plans: [] };
  }

  async findAll(client: PoolClient, tenantId?: string): Promise<Inspection[]> {
    if (tenantId) {
      const result = await client.query<Inspection>(
        'SELECT * FROM inspections WHERE tenant_id = $1 ORDER BY visited_at DESC',
        [tenantId],
      );
      return result.rows;
    }
    // Sem filtro: RLS já restringe (admin vê tudo, empresa vê o próprio
    // tenant, técnico vê tenants vinculados via EXISTS).
    const result = await client.query<Inspection>('SELECT * FROM inspections ORDER BY visited_at DESC');
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<InspectionDetail> {
    const inspectionResult = await client.query<Inspection>('SELECT * FROM inspections WHERE id = $1', [id]);
    const inspection = inspectionResult.rows[0];
    if (!inspection) throw new NotFoundException('Inspeção não encontrada');

    const itemsResult = await client.query<ChecklistItem>(
      'SELECT * FROM inspection_checklist_items WHERE inspection_id = $1 ORDER BY block, item_key',
      [id],
    );
    const actionPlansResult = await client.query<ActionPlan>(
      'SELECT * FROM action_plans WHERE inspection_id = $1 ORDER BY created_at',
      [id],
    );

    return { ...inspection, items: itemsResult.rows, action_plans: actionPlansResult.rows };
  }
}
```

- [ ] **Step 4: Escrever o controller**

`backend/src/inspections/inspections.controller.ts`:

```typescript
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { InspectionsService } from './inspections.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';

@Controller('inspections')
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  @Roles('tecnico')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post()
  create(@Body() dto: CreateInspectionDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.inspections.create(client, dto.tenant_id, req.user.id, dto.visited_at),
    );
  }

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if (req.user.role === 'tecnico' && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.inspections.findAll(client, tenantId));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.inspections.findOne(client, id));
  }
}
```

- [ ] **Step 5: Registrar o módulo**

`backend/src/inspections/inspections.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { InspectionsController } from './inspections.controller';
import { InspectionsService } from './inspections.service';

@Module({
  controllers: [InspectionsController],
  providers: [InspectionsService],
})
export class InspectionsModule {}
```

Em `backend/src/app.module.ts`: adicionar
`import { InspectionsModule } from './inspections/inspections.module';`
e `InspectionsModule` no array `imports` (depois de `DocumentsModule`).

- [ ] **Step 6: Escrever o teste**

`backend/test/inspections-create-list.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/GET /inspections — criação, semeadura de itens, listagem (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let technicianId: string;
  let technicianToken: string;
  let empresaToken: string;
  let createdInspectionId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection Create Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Inspection Create Teste');
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
    if (createdInspectionId) {
      await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [createdInspectionId]);
    }
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('técnico cria uma inspeção e ela vem com os 16 itens de checklist semeados', async () => {
    const res = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('rascunho');
    expect(res.body.items).toHaveLength(16);
    expect(res.body.action_plans).toHaveLength(0);
    expect(res.body.items.filter((i: { block: string }) => i.block === 'documentacao')).toHaveLength(4);
    createdInspectionId = res.body.id;
  });

  it('empresa rejeitada tentando criar (403) — só técnico cria', async () => {
    const res = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25' });

    expect(res.status).toBe(403);
  });

  it('empresa vê a inspeção na listagem (sem precisar de tenant_id) e no detalhe', async () => {
    const listRes = await request(app.getHttpServer())
      .get('/inspections')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.find((i: { id: string }) => i.id === createdInspectionId)).toBeDefined();

    const detailRes = await request(app.getHttpServer())
      .get(`/inspections/${createdInspectionId}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.items).toHaveLength(16);
  });

  it('técnico sem tenant_id na listagem recebe 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 7: Rodar o teste e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/inspections-create-list.e2e-spec.ts"
```

Esperado: PASS, 4/4.

- [ ] **Step 8: Commit**

```bash
git add backend/src/inspections backend/src/app.module.ts backend/test/inspections-create-list.e2e-spec.ts
git commit -m "feat: adiciona criacao, listagem e detalhe de inspecoes"
```

---

### Task 3: `PATCH /inspections/:id` (cabeçalho) + `PATCH /inspections/:id/items/:itemId`

**Files:**
- Create: `backend/src/inspections/dto/update-inspection.dto.ts`
- Create: `backend/src/inspections/dto/update-checklist-item.dto.ts`
- Modify: `backend/src/inspections/inspections.service.ts`
- Modify: `backend/src/inspections/inspections.controller.ts`
- Test: `backend/test/inspections-update.e2e-spec.ts`

**Interfaces:**
- Consumes: `InspectionsService.findOne` (Task 2), `buildSafeSetClause`
  (`backend/src/common/safe-update.util.ts`, já existe — usada por
  `company-units.service.ts`).
- Produces: `InspectionsService.update/updateItem` — Task 4 (`conclude`)
  reaproveita o mesmo padrão de checagem `status = 'rascunho'`
  (extraído aqui como `assertDraft`, método privado reaproveitado por
  `conclude`).

- [ ] **Step 1: Escrever os DTOs**

`backend/src/inspections/dto/update-inspection.dto.ts`:

```typescript
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpdateInspectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_contact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  dds_topic?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  dds_participants_count?: number;

  @IsOptional()
  @IsString()
  dds_notes?: string;

  @IsOptional()
  @IsString()
  general_recommendations?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  technician_signature_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_signature_name?: string;
}
```

`backend/src/inspections/dto/update-checklist-item.dto.ts`:

```typescript
import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsIn(['C', 'NC', 'NA'])
  status?: 'C' | 'NC' | 'NA';

  @IsOptional()
  @IsString()
  notes?: string;
}
```

- [ ] **Step 2: Adicionar os métodos ao service**

Em `backend/src/inspections/inspections.service.ts` — trocar o import de
`@nestjs/common` para incluir `ConflictException`, e adicionar
`buildSafeSetClause`:

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { buildSafeSetClause } from '../common/safe-update.util';
import { CHECKLIST_ITEMS, ChecklistBlock } from './checklist-items.const';
```

Adicionar as duas constantes de allowlist logo abaixo dos imports (antes
da classe):

```typescript
const INSPECTION_UPDATABLE_FIELDS = [
  'company_contact',
  'dds_topic',
  'dds_participants_count',
  'dds_notes',
  'general_recommendations',
  'technician_signature_name',
  'company_signature_name',
] as const;

const CHECKLIST_ITEM_UPDATABLE_FIELDS = ['status', 'notes'] as const;
```

Adicionar estes métodos na classe `InspectionsService`, depois de
`findOne` (mantém `create`/`findAll`/`findOne` do Task 2 intactos):

```typescript
  private async assertDraft(client: PoolClient, id: string): Promise<void> {
    const result = await client.query<{ status: string }>(
      'SELECT status FROM inspections WHERE id = $1',
      [id],
    );
    const inspection = result.rows[0];
    if (!inspection) throw new NotFoundException('Inspeção não encontrada');
    if (inspection.status !== 'rascunho') {
      throw new ConflictException('Inspeção já concluída — não pode mais ser editada');
    }
  }

  async update(client: PoolClient, id: string, data: Partial<Inspection>): Promise<Inspection> {
    await this.assertDraft(client, id);

    const { setClauses, values } = buildSafeSetClause(data, INSPECTION_UPDATABLE_FIELDS, 2);
    if ((data as any).technician_signature_name !== undefined) {
      setClauses.push('technician_signature_at = now()');
    }
    if ((data as any).company_signature_name !== undefined) {
      setClauses.push('company_signature_at = now()');
    }

    if (setClauses.length === 0) {
      const result = await client.query<Inspection>('SELECT * FROM inspections WHERE id = $1', [id]);
      return result.rows[0];
    }

    const result = await client.query<Inspection>(
      `UPDATE inspections SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    return result.rows[0];
  }

  async updateItem(
    client: PoolClient,
    inspectionId: string,
    itemId: string,
    data: Partial<ChecklistItem>,
  ): Promise<ChecklistItem> {
    await this.assertDraft(client, inspectionId);

    const { setClauses, values } = buildSafeSetClause(data, CHECKLIST_ITEM_UPDATABLE_FIELDS, 3);
    if (setClauses.length === 0) {
      const result = await client.query<ChecklistItem>(
        'SELECT * FROM inspection_checklist_items WHERE id = $1 AND inspection_id = $2',
        [itemId, inspectionId],
      );
      const item = result.rows[0];
      if (!item) throw new NotFoundException('Item de checklist não encontrado');
      return item;
    }

    const result = await client.query<ChecklistItem>(
      `UPDATE inspection_checklist_items SET ${setClauses.join(', ')}
       WHERE id = $1 AND inspection_id = $2 RETURNING *`,
      [itemId, inspectionId, ...values],
    );
    const item = result.rows[0];
    if (!item) throw new NotFoundException('Item de checklist não encontrado');
    return item;
  }
```

- [ ] **Step 3: Adicionar os endpoints ao controller**

Em `backend/src/inspections/inspections.controller.ts` — trocar o import
de `@nestjs/common` para incluir `Patch`, e importar os dois DTOs novos:

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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { InspectionsService } from './inspections.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { UpdateInspectionDto } from './dto/update-inspection.dto';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto';
```

Adicionar estes dois métodos na classe, depois de `findOne` (mantém
`create`/`findAll`/`findOne` do Task 2 intactos):

```typescript
  @Roles('tecnico')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateInspectionDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.inspections.update(client, id, dto));
  }

  @Roles('tecnico')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateChecklistItemDto,
    @Req() req: any,
  ) {
    return req.withTenantContext((client: any) => this.inspections.updateItem(client, id, itemId, dto));
  }
```

- [ ] **Step 4: Escrever o teste**

`backend/test/inspections-update.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('PATCH /inspections/:id e /inspections/:id/items/:itemId (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let technicianId: string;
  let technicianToken: string;
  let empresaToken: string;
  let inspectionId: string;
  let itemId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection Update Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Inspection Update Teste');
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

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25' });
    inspectionId = createRes.body.id;
    itemId = createRes.body.items[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [inspectionId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('rejeita empresa tentando editar o cabeçalho ou um item (403) — só técnico edita', async () => {
    const headerRes = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ company_contact: 'Tentativa indevida' });
    expect(headerRes.status).toBe(403);

    const itemRes = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${itemId}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ status: 'C' });
    expect(itemRes.status).toBe(403);
  });

  it('atualiza o cabeçalho e grava o carimbo de assinatura junto do nome', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ company_contact: 'João da Silva', technician_signature_name: 'Maria Técnica' });

    expect(res.status).toBe(200);
    expect(res.body.company_contact).toBe('João da Silva');
    expect(res.body.technician_signature_name).toBe('Maria Técnica');
    expect(res.body.technician_signature_at).not.toBeNull();
  });

  it('atualiza um item de checklist', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${itemId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'NC', notes: 'Ficha vencida' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('NC');
    expect(res.body.notes).toBe('Ficha vencida');
  });

  it('rejeita edição depois de concluída (409), no cabeçalho e no item', async () => {
    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(concludeRes.status).toBe(201);

    const headerRes = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ company_contact: 'Outro nome' });
    expect(headerRes.status).toBe(409);

    const itemRes = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${itemId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'C' });
    expect(itemRes.status).toBe(409);
  });
});
```

Nota: o terceiro teste chama `POST /inspections/:id/concluir`, que só
existe a partir do Task 4 — **este teste fica marcado como dependência
direta do Task 4** e só passa depois dele. Escreva-o aqui mesmo assim
(documenta o contrato esperado), mas o Step 5 abaixo roda só os dois
primeiros `it` isoladamente; o terceiro é confirmado no Step 6 do Task 4.

- [ ] **Step 5: Rodar os três primeiros testes e confirmar que passam**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand -t 'rejeita empresa|atualiza' test/inspections-update.e2e-spec.ts"
```

Esperado: PASS, 3/3 (o quarto `it`, sobre 409 pós-conclusão, falha
normalmente aqui porque `POST /inspections/:id/concluir` ainda não
existe — 404 de rota — e é esperado até o Task 4 estar pronto).

- [ ] **Step 6: Commit**

```bash
git add backend/src/inspections backend/test/inspections-update.e2e-spec.ts
git commit -m "feat: adiciona edicao de cabecalho e item de checklist (so em rascunho)"
```

---

### Task 4: `POST /inspections/:id/concluir` — conclusão + geração de planos de ação

**Files:**
- Modify: `backend/src/inspections/inspections.service.ts`
- Modify: `backend/src/inspections/inspections.controller.ts`
- Test: `backend/test/inspections-conclude.e2e-spec.ts`

**Interfaces:**
- Consumes: `InspectionsService.assertDraft`/`findOne` (Task 3/2).
- Produces: `InspectionsService.conclude` → `InspectionDetail` com
  `status: 'concluida'` e `action_plans` preenchido — Task 5 lista esses
  mesmos registros via `GET /action-plans`; `POST
  /inspections/:id/concluir` → mesmo shape de `GET /inspections/:id`.

- [ ] **Step 1: Adicionar o método ao service**

Em `backend/src/inspections/inspections.service.ts`, adicionar depois de
`updateItem` (mantém tudo dos Tasks 2 e 3 intacto):

```typescript
  async conclude(client: PoolClient, id: string): Promise<InspectionDetail> {
    await this.assertDraft(client, id);

    await client.query(
      `UPDATE inspections SET status = 'concluida', concluded_at = now() WHERE id = $1`,
      [id],
    );

    const tenantResult = await client.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM inspections WHERE id = $1',
      [id],
    );
    const tenantId = tenantResult.rows[0].tenant_id;

    const ncItemsResult = await client.query<ChecklistItem>(
      `SELECT * FROM inspection_checklist_items WHERE inspection_id = $1 AND status = 'NC'`,
      [id],
    );

    for (const item of ncItemsResult.rows) {
      await client.query(
        `INSERT INTO action_plans (tenant_id, inspection_id, checklist_item_id, description)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, id, item.id, item.item_label],
      );
    }

    return this.findOne(client, id);
  }
```

`assertDraft` já garante 409 se a inspeção já estiver `concluida` (mesmo
método do Task 3, reaproveitado sem mudança). Toda a operação roda
dentro da mesma transação que `req.withTenantContext` já abre por
request (`backend/src/common/database/database.service.ts`) — o UPDATE
de status e os INSERTs de `action_plans` são atômicos.

- [ ] **Step 2: Adicionar o endpoint ao controller**

Em `backend/src/inspections/inspections.controller.ts`, adicionar depois
de `updateItem`:

```typescript
  @Roles('tecnico')
  @Post(':id/concluir')
  conclude(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.inspections.conclude(client, id));
  }
```

- [ ] **Step 3: Escrever o teste**

`backend/test/inspections-conclude.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /inspections/:id/concluir (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let technicianId: string;
  let technicianToken: string;
  let empresaToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection Concluir Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Inspection Concluir Teste');
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
    await (db as any).client.query('DELETE FROM inspections WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('rejeita empresa tentando concluir (403) — só técnico conclui', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25' });
    const inspectionId = createRes.body.id;

    const res = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(403);
  });

  it('gera exatamente um plano de ação por item NC, nenhum para C/N.A.', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25' });
    const inspectionId = createRes.body.id;
    const items = createRes.body.items;

    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${items[0].id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'NC', notes: 'Não conforme 1' });
    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${items[1].id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'NC', notes: 'Não conforme 2' });
    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${items[2].id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'C' });

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.status).toBe('concluida');
    expect(concludeRes.body.concluded_at).not.toBeNull();
    expect(concludeRes.body.action_plans).toHaveLength(2);
    expect(concludeRes.body.action_plans.map((p: { description: string }) => p.description)).toEqual(
      expect.arrayContaining([items[0].item_label, items[1].item_label]),
    );
  });

  it('conclui sem nenhum item NC — action_plans fica vazio, sem erro', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25' });
    const inspectionId = createRes.body.id;

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.action_plans).toHaveLength(0);
  });

  it('rejeita concluir de novo uma inspeção já concluída (409)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25' });
    const inspectionId = createRes.body.id;

    await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);

    const secondRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(secondRes.status).toBe(409);
  });
});
```

- [ ] **Step 4: Rodar o teste desta task e confirmar que passa**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/inspections-conclude.e2e-spec.ts"
```

Esperado: PASS, 4/4.

- [ ] **Step 5: Confirmar retroativamente o terceiro teste do Task 3 (que dependia deste endpoint)**

```bash
set -a; source /opt/Montese/.env; set +a
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://${POSTGRES_APP_USER}:${POSTGRES_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://${POSTGRES_SUPERUSER}:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@redis:6379" \
  -e JWT_SECRET="${JWT_SECRET}" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  -e RATE_LIMIT_MAX=300 -e RATE_LIMIT_WINDOW_SECONDS=300 \
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/inspections-update.e2e-spec.ts"
```

Esperado: PASS, 4/4 (agora os quatro, incluindo o de 409 pós-conclusão).

- [ ] **Step 6: Commit**

```bash
git add backend/src/inspections backend/test/inspections-conclude.e2e-spec.ts
git commit -m "feat: adiciona conclusao de inspecao com geracao automatica de planos de acao"
```

---

### Task 5: `GET /action-plans` — listagem simples

**Files:**
- Create: `backend/src/inspections/action-plans.controller.ts`
- Modify: `backend/src/inspections/inspections.service.ts`
- Modify: `backend/src/inspections/inspections.module.ts`
- Test: `backend/test/action-plans-list.e2e-spec.ts`

**Interfaces:**
- Consumes: `ActionPlan` (Task 2), tabela `action_plans` (Task 1).
- Produces: `GET /action-plans?tenant_id=` → `ActionPlan[]` — Task 7
  (frontend da empresa) consome esse shape pra listar pendências.

- [ ] **Step 1: Adicionar o método ao service**

Em `backend/src/inspections/inspections.service.ts`, adicionar depois de
`conclude` (mantém tudo dos Tasks 2-4 intacto):

```typescript
  async findActionPlans(client: PoolClient, tenantId?: string): Promise<ActionPlan[]> {
    if (tenantId) {
      const result = await client.query<ActionPlan>(
        'SELECT * FROM action_plans WHERE tenant_id = $1 ORDER BY created_at DESC',
        [tenantId],
      );
      return result.rows;
    }
    const result = await client.query<ActionPlan>('SELECT * FROM action_plans ORDER BY created_at DESC');
    return result.rows;
  }
```

- [ ] **Step 2: Escrever o controller novo**

`backend/src/inspections/action-plans.controller.ts`:

```typescript
import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';
import { InspectionsService } from './inspections.service';

@Controller('action-plans')
export class ActionPlansController {
  constructor(private readonly inspections: InspectionsService) {}

  @Get()
  findAll(@Query('tenant_id') tenantId: string | undefined, @Req() req: any) {
    if (req.user.role === 'tecnico' && !tenantId) {
      throw new BadRequestException('tenant_id é obrigatório');
    }
    return req.withTenantContext((client: any) => this.inspections.findActionPlans(client, tenantId));
  }
}
```

- [ ] **Step 3: Registrar o controller no módulo**

Em `backend/src/inspections/inspections.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { InspectionsController } from './inspections.controller';
import { ActionPlansController } from './action-plans.controller';
import { InspectionsService } from './inspections.service';

@Module({
  controllers: [InspectionsController, ActionPlansController],
  providers: [InspectionsService],
})
export class InspectionsModule {}
```

- [ ] **Step 4: Escrever o teste**

`backend/test/action-plans-list.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /action-plans (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let technicianId: string;
  let technicianToken: string;
  let empresaToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Action Plans Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Action Plans Teste');
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

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25' });
    const inspectionId = createRes.body.id;
    const itemId = createRes.body.items[0].id;

    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${itemId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'NC' });

    await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM inspections WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa lista os planos de ação do próprio tenant, status pendente por padrão', async () => {
    const res = await request(app.getHttpServer())
      .get('/action-plans')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('pendente');
  });

  it('técnico sem tenant_id recebe 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/action-plans')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(400);
  });

  it('técnico com tenant_id vê os planos de ação da empresa vinculada', async () => {
    const res = await request(app.getHttpServer())
      .get(`/action-plans?tenant_id=${tenantId}`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
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
  node:20-alpine sh -c "npx jest --config ./test/jest-e2e.json --runInBand test/action-plans-list.e2e-spec.ts"
```

Esperado: PASS, 3/3.

- [ ] **Step 6: Rodar a suíte e2e completa (regressão) antes de ir pro frontend**

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
  node:20-alpine sh -c "npm run test:e2e"
```

Esperado: todas as suítes passando (nenhuma regressão nas fases
anteriores).

- [ ] **Step 7: Commit**

```bash
git add backend/src/inspections backend/test/action-plans-list.e2e-spec.ts
git commit -m "feat: adiciona listagem de planos de acao"
```

---

### Task 6: Frontend — técnico (lista de inspeções + formulário de preenchimento)

**Files:**
- Modify: `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`
- Create: `frontend/src/app/tecnico/empresas/[tenantId]/inspecoes/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/inspections`, `GET /api/inspections/:id`,
  `PATCH /api/inspections/:id`, `PATCH
  /api/inspections/:id/items/:itemId`, `POST
  /api/inspections/:id/concluir` (Tasks 2-4).
- Produces: nenhuma interface nova pra outras tasks — página terminal do
  fluxo do técnico.

- [ ] **Step 1: Adicionar a seção de inspeções na página da empresa (visão do técnico)**

Em `frontend/src/app/tecnico/empresas/[tenantId]/page.tsx`, substituir o
arquivo inteiro por:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { DocumentsPanel } from '@/components/DocumentsPanel';

interface InspectionRow {
  id: string;
  status: 'rascunho' | 'concluida';
  visited_at: string;
}

export default function TecnicoEmpresaDocumentosPage() {
  const router = useRouter();
  const params = useParams<{ tenantId: string }>();
  const [ready, setReady] = useState(false);
  const [inspections, setInspections] = useState<InspectionRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function loadInspections() {
    const token = localStorage.getItem('montese_token');
    const res = await fetch(`/api/inspections?tenant_id=${params.tenantId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setInspections(await res.json());
  }

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    setReady(true);
    loadInspections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function handleNovaInspecao() {
    setCreating(true);
    setError('');
    const token = localStorage.getItem('montese_token');
    try {
      const res = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tenant_id: params.tenantId,
          visited_at: new Date().toISOString().slice(0, 10),
        }),
      });
      if (res.ok) {
        const inspection = await res.json();
        router.push(`/tecnico/empresas/${params.tenantId}/inspecoes/${inspection.id}`);
        return;
      }
      setError('Não foi possível criar a inspeção.');
    } catch {
      setError('Não foi possível conectar ao servidor.');
    }
    setCreating(false);
  }

  if (!ready) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Documentos da empresa</h1>
      <div className="mt-8">
        <DocumentsPanel tenantId={params.tenantId} />
      </div>

      <section className="mt-10 rounded-lg border border-brand-100 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-brand-900">Inspeções</h2>
          <button
            onClick={handleNovaInspecao}
            disabled={creating}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {creating ? 'Criando...' : 'Nova inspeção'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {inspections.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhuma inspeção registrada ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {inspections.map((inspection) => (
              <li key={inspection.id}>
                <Link
                  href={`/tecnico/empresas/${params.tenantId}/inspecoes/${inspection.id}`}
                  className="flex items-center justify-between rounded-md border border-brand-100 px-4 py-3 text-sm hover:bg-brand-100"
                >
                  <span className="text-brand-900">
                    {new Date(inspection.visited_at).toLocaleDateString('pt-BR')}
                  </span>
                  <span className={inspection.status === 'concluida' ? 'text-green-700' : 'text-yellow-700'}>
                    {inspection.status === 'concluida' ? 'Concluída' : 'Rascunho'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Criar a página de preenchimento do checklist**

`frontend/src/app/tecnico/empresas/[tenantId]/inspecoes/[id]/page.tsx`:

```tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface ChecklistItem {
  id: string;
  block: 'documentacao' | 'epis' | 'instalacoes' | 'maquinas';
  item_key: string;
  item_label: string;
  status: 'C' | 'NC' | 'NA' | null;
  notes: string | null;
}

interface ActionPlan {
  id: string;
  description: string;
  status: 'pendente' | 'resolvido';
}

interface InspectionDetail {
  id: string;
  status: 'rascunho' | 'concluida';
  visited_at: string;
  company_contact: string | null;
  dds_topic: string | null;
  dds_participants_count: number | null;
  dds_notes: string | null;
  general_recommendations: string | null;
  technician_signature_name: string | null;
  company_signature_name: string | null;
  items: ChecklistItem[];
  action_plans: ActionPlan[];
}

const BLOCK_LABELS: Record<ChecklistItem['block'], string> = {
  documentacao: 'Documentação',
  epis: 'Uso de EPIs',
  instalacoes: 'Inspeção de instalações',
  maquinas: 'Riscos em máquinas e equipamentos',
};

const BLOCK_ORDER: ChecklistItem['block'][] = ['documentacao', 'epis', 'instalacoes', 'maquinas'];

export default function InspecaoPage() {
  const router = useRouter();
  const params = useParams<{ tenantId: string; id: string }>();
  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [concluding, setConcluding] = useState(false);

  async function loadInspection() {
    const token = localStorage.getItem('montese_token');
    const res = await fetch(`/api/inspections/${params.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setInspection(await res.json());
    } else {
      setError('Não foi possível carregar a inspeção.');
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!localStorage.getItem('montese_token')) {
      router.push('/login');
      return;
    }
    loadInspection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const isDraft = inspection?.status === 'rascunho';

  async function saveHeaderField(field: string, value: string | number) {
    const token = localStorage.getItem('montese_token');
    const res = await fetch(`/api/inspections/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ [field]: value }),
    });
    if (res.ok) {
      const updated = await res.json();
      setInspection((prev) => (prev ? { ...prev, ...updated } : prev));
    } else {
      setError('Não foi possível salvar a alteração.');
    }
  }

  async function saveItem(itemId: string, patch: { status?: string; notes?: string }) {
    const token = localStorage.getItem('montese_token');
    const res = await fetch(`/api/inspections/${params.id}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updatedItem = await res.json();
      setInspection((prev) =>
        prev
          ? { ...prev, items: prev.items.map((i) => (i.id === itemId ? updatedItem : i)) }
          : prev,
      );
    } else {
      setError('Não foi possível salvar o item.');
    }
  }

  async function handleConcluir(event: FormEvent) {
    event.preventDefault();
    setConcluding(true);
    setError('');
    const token = localStorage.getItem('montese_token');
    const res = await fetch(`/api/inspections/${params.id}/concluir`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setInspection(await res.json());
    } else {
      setError('Não foi possível concluir a inspeção.');
    }
    setConcluding(false);
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }
  if (!inspection) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-red-600">{error}</div>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-brand-900">Inspeção — {new Date(inspection.visited_at).toLocaleDateString('pt-BR')}</h1>
        <span className={inspection.status === 'concluida' ? 'text-green-700' : 'text-yellow-700'}>
          {inspection.status === 'concluida' ? 'Concluída' : 'Rascunho'}
        </span>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Identificação</h2>
        <label className="mt-3 flex flex-col gap-1 text-sm text-brand-900">
          Responsável pela empresa
          <input
            defaultValue={inspection.company_contact ?? ''}
            disabled={!isDraft}
            onBlur={(e) => saveHeaderField('company_contact', e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
          />
        </label>
      </section>

      {BLOCK_ORDER.map((block) => (
        <section key={block} className="mt-6 rounded-lg border border-brand-100 p-6">
          <h2 className="text-lg font-bold text-brand-900">{BLOCK_LABELS[block]}</h2>
          <div className="mt-4 flex flex-col gap-4">
            {inspection.items
              .filter((item) => item.block === block)
              .map((item) => (
                <div key={item.id} className="border-b border-brand-100 pb-4 last:border-0 last:pb-0">
                  <p className="text-sm font-medium text-brand-900">{item.item_label}</p>
                  <div className="mt-2 flex gap-3 text-sm">
                    {(['C', 'NC', 'NA'] as const).map((option) => (
                      <label key={option} className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`item-${item.id}`}
                          checked={item.status === option}
                          disabled={!isDraft}
                          onChange={() => saveItem(item.id, { status: option })}
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                  <textarea
                    defaultValue={item.notes ?? ''}
                    disabled={!isDraft}
                    placeholder="Observação (opcional)"
                    onBlur={(e) => saveItem(item.id, { notes: e.target.value })}
                    className="mt-2 w-full rounded-md border border-brand-100 px-3 py-2 text-sm disabled:bg-brand-50"
                  />
                </div>
              ))}
          </div>
        </section>
      ))}

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Conscientização (DDS)</h2>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Tema abordado
            <input
              defaultValue={inspection.dds_topic ?? ''}
              disabled={!isDraft}
              onBlur={(e) => saveHeaderField('dds_topic', e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Número de participantes
            <input
              type="number"
              min={0}
              defaultValue={inspection.dds_participants_count ?? ''}
              disabled={!isDraft}
              onBlur={(e) => saveHeaderField('dds_participants_count', Number(e.target.value))}
              className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Pontos reforçados
            <textarea
              defaultValue={inspection.dds_notes ?? ''}
              disabled={!isDraft}
              onBlur={(e) => saveHeaderField('dds_notes', e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
            />
          </label>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Recomendações gerais</h2>
        <textarea
          defaultValue={inspection.general_recommendations ?? ''}
          disabled={!isDraft}
          onBlur={(e) => saveHeaderField('general_recommendations', e.target.value)}
          className="mt-3 w-full rounded-md border border-brand-100 px-3 py-2 text-sm disabled:bg-brand-50"
        />
      </section>

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Assinaturas</h2>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Nome do técnico
            <input
              defaultValue={inspection.technician_signature_name ?? ''}
              disabled={!isDraft}
              onBlur={(e) => saveHeaderField('technician_signature_name', e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-brand-900">
            Nome do responsável pela empresa
            <input
              defaultValue={inspection.company_signature_name ?? ''}
              disabled={!isDraft}
              onBlur={(e) => saveHeaderField('company_signature_name', e.target.value)}
              className="rounded-md border border-brand-100 px-3 py-2 disabled:bg-brand-50"
            />
          </label>
        </div>
      </section>

      {inspection.action_plans.length > 0 && (
        <section className="mt-6 rounded-lg border border-brand-100 p-6">
          <h2 className="text-lg font-bold text-brand-900">Planos de ação gerados</h2>
          <ul className="mt-3 flex flex-col gap-1 text-sm text-red-600">
            {inspection.action_plans.map((plan) => (
              <li key={plan.id}>{plan.description}</li>
            ))}
          </ul>
        </section>
      )}

      {isDraft && (
        <form onSubmit={handleConcluir} className="mt-8">
          <button
            type="submit"
            disabled={concluding}
            className="w-full rounded-md bg-brand-500 px-6 py-3 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {concluding ? 'Concluindo...' : 'Concluir inspeção'}
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build isolado (sem tocar no container de produção)**

```bash
cd /opt/Montese/frontend && docker build --target builder -t montese-frontend-test-build . \
  && docker rmi montese-frontend-test-build
```

Esperado: `Compiled successfully`, sem erro de tipo, incluindo as rotas
`/tecnico/empresas/[tenantId]` e
`/tecnico/empresas/[tenantId]/inspecoes/[id]` na listagem de rotas
impressa no final do build.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/tecnico/empresas
git commit -m "feat: adiciona lista e formulario de inspecao ao painel do tecnico"
```

---

### Task 7: Frontend — empresa (`/empresa/inspecoes`)

**Files:**
- Create: `frontend/src/app/empresa/inspecoes/page.tsx`

**Interfaces:**
- Consumes: `GET /api/inspections`, `GET /api/inspections/:id`,
  `GET /api/action-plans` (Tasks 2 e 5).
- Produces: nenhuma interface nova — página terminal do sub-projeto.

- [ ] **Step 1: Criar a página**

`frontend/src/app/empresa/inspecoes/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface InspectionRow {
  id: string;
  status: 'rascunho' | 'concluida';
  visited_at: string;
}

interface ChecklistItem {
  id: string;
  block: 'documentacao' | 'epis' | 'instalacoes' | 'maquinas';
  item_label: string;
  status: 'C' | 'NC' | 'NA' | null;
  notes: string | null;
}

interface InspectionDetail extends InspectionRow {
  company_contact: string | null;
  general_recommendations: string | null;
  items: ChecklistItem[];
}

interface ActionPlan {
  id: string;
  description: string;
  status: 'pendente' | 'resolvido';
}

const BLOCK_LABELS: Record<ChecklistItem['block'], string> = {
  documentacao: 'Documentação',
  epis: 'Uso de EPIs',
  instalacoes: 'Inspeção de instalações',
  maquinas: 'Riscos em máquinas e equipamentos',
};

const BLOCK_ORDER: ChecklistItem['block'][] = ['documentacao', 'epis', 'instalacoes', 'maquinas'];

export default function EmpresaInspecoesPage() {
  const router = useRouter();
  const [inspections, setInspections] = useState<InspectionRow[]>([]);
  const [actionPlans, setActionPlans] = useState<ActionPlan[]>([]);
  const [selected, setSelected] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('montese_token');
    if (!token) {
      router.push('/login');
      return;
    }

    Promise.all([
      fetch('/api/inspections', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/action-plans', { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(async ([inspectionsRes, actionPlansRes]) => {
        if (!inspectionsRes.ok || !actionPlansRes.ok) {
          setError('Não foi possível carregar as inspeções.');
          setLoading(false);
          return;
        }
        setInspections(await inspectionsRes.json());
        setActionPlans(await actionPlansRes.json());
        setLoading(false);
      })
      .catch(() => {
        setError('Não foi possível conectar ao servidor.');
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openInspection(id: string) {
    const token = localStorage.getItem('montese_token');
    const res = await fetch(`/api/inspections/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      setSelected(await res.json());
    } else {
      setError('Não foi possível carregar o relatório.');
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-2xl px-4 py-16 text-center text-brand-700">Carregando...</div>;
  }

  if (selected) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <button onClick={() => setSelected(null)} className="text-sm text-brand-500 hover:underline">
          ← Voltar
        </button>
        <div className="mt-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">
            Inspeção — {new Date(selected.visited_at).toLocaleDateString('pt-BR')}
          </h1>
          <span className={selected.status === 'concluida' ? 'text-green-700' : 'text-yellow-700'}>
            {selected.status === 'concluida' ? 'Concluída' : 'Rascunho'}
          </span>
        </div>
        {selected.company_contact && (
          <p className="mt-2 text-sm text-brand-700">Responsável: {selected.company_contact}</p>
        )}
        {BLOCK_ORDER.map((block) => (
          <section key={block} className="mt-6 rounded-lg border border-brand-100 p-6">
            <h2 className="text-lg font-bold text-brand-900">{BLOCK_LABELS[block]}</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {selected.items
                .filter((item) => item.block === block)
                .map((item) => (
                  <li key={item.id} className="text-brand-900">
                    {item.item_label} —{' '}
                    <span className={item.status === 'NC' ? 'font-bold text-red-600' : 'text-brand-700'}>
                      {item.status ?? 'Não avaliado'}
                    </span>
                    {item.notes && <span className="text-brand-700"> — {item.notes}</span>}
                  </li>
                ))}
            </ul>
          </section>
        ))}
        {selected.general_recommendations && (
          <section className="mt-6 rounded-lg border border-brand-100 p-6">
            <h2 className="text-lg font-bold text-brand-900">Recomendações gerais</h2>
            <p className="mt-2 text-sm text-brand-700">{selected.general_recommendations}</p>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-brand-900">Inspeções</h1>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Planos de ação pendentes</h2>
        {actionPlans.length === 0 ? (
          <p className="mt-2 text-sm text-brand-700">Nenhum plano de ação pendente.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-red-600">
            {actionPlans.map((plan) => (
              <li key={plan.id}>{plan.description}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-brand-100 p-6">
        <h2 className="text-lg font-bold text-brand-900">Relatórios</h2>
        {inspections.length === 0 ? (
          <p className="mt-4 text-sm text-brand-700">Nenhuma inspeção registrada ainda.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {inspections.map((inspection) => (
              <li key={inspection.id}>
                <button
                  onClick={() => openInspection(inspection.id)}
                  className="flex w-full items-center justify-between rounded-md border border-brand-100 px-4 py-3 text-sm hover:bg-brand-100"
                >
                  <span className="text-brand-900">
                    {new Date(inspection.visited_at).toLocaleDateString('pt-BR')}
                  </span>
                  <span className={inspection.status === 'concluida' ? 'text-green-700' : 'text-yellow-700'}>
                    {inspection.status === 'concluida' ? 'Concluída' : 'Rascunho'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Build isolado**

```bash
cd /opt/Montese/frontend && docker build --target builder -t montese-frontend-test-build . \
  && docker rmi montese-frontend-test-build
```

Esperado: `Compiled successfully`, sem erro de tipo, `/empresa/inspecoes`
aparece na listagem de rotas.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/empresa/inspecoes
git commit -m "feat: adiciona pagina de inspecoes e planos de acao da empresa"
```

---

## Depois de todas as tasks

Rodar a suíte e2e completa mais uma vez (mesmo comando do Step 6 da
Task 5) e confirmar 0 regressões. Atualizar `docs/roadmap.md` com o
fechamento da Fase 6 sub-projeto A, seguindo o mesmo formato usado nas
fases anteriores (tabela de tasks, evidência de verificação, pendências
explícitas: catálogo de EPI e acesso do técnico parceiro ficam para
sub-projetos seguintes da Fase 6).
