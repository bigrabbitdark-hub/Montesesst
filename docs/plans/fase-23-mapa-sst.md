# Fase 23 — Mapa SST: cargo, requisitos e divergência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cargo vira entidade real por tenant (`positions`), com vínculo de funcionários existentes por sugestão automática de agrupamento; a empresa configura quais itens do catálogo de EPI e quais treinamentos NR cada cargo exige; o sistema calcula e exibe divergência (funcionário sem EPI/treinamento exigido) numa página nova e no dashboard já existente.

**Architecture:** Módulo novo `backend/src/positions/` (`PositionsService`/`Controller`/`Module`) concentra toda a lógica nova. `employees.service.ts` ganha uma checagem de posse de tenant pro novo `position_id` (mesmo padrão já usado pra `company_unit_id`). `dashboard.service.ts` ganha uma nova fonte de itens de atenção. Frontend ganha uma página nova (`/empresa/mapa-sst`) com um painel único (mesmo padrão de arquivo único já usado em `EpisPanel.tsx`/`DocumentsPanel.tsx`).

**Tech Stack:** NestJS + `pg` (Postgres real, RLS), Next.js/React (fetch direto, sem lib de estado), sem nenhuma IA nesta fase.

**Spec:** `docs/specs/fase-23-mapa-sst.md`

## Global Constraints

- Cargo (`positions`) é por tenant, não por filial — nenhuma referência a `company_unit_id`.
- Requisito por cargo é 100% manual (sem IA, sem heurística de sugestão de EPI/treinamento por cargo).
- `tipo` de treinamento reaproveita EXATAMENTE `TRAINING_TYPES`/`TrainingType` já exportados de `backend/src/cipa/trainings.service.ts` — não redefinir o enum.
- EPI "atendido" = pelo menos 1 `employee_epi_deliveries` daquele item, sem checar validade do CA.
- Treinamento "divergente" = nenhum `cipa_trainings` daquele tipo com `data_validade >= CURRENT_DATE` (cobre nunca-fez e vencido na mesma consulta).
- Funcionário com `position_id IS NULL` nunca entra em cálculo de divergência.
- `positions.name` é único por tenant (`UNIQUE(tenant_id, name)`); violação vira 409 via `mapPgError` (`backend/src/common/pg-error.util.ts`, já existente — reaproveitar, não reimplementar).
- Todas as tabelas novas usam `FORCE ROW LEVEL SECURITY` com a mesma policy já usada em `tenant_epis` (`current_setting('app.role')='admin' OR tenant_id = app.tenant_id OR tenant_id IN (assigned_tenant_ids_for_current_user())`).
- Migration nova é `backend/db/migrations/0035_positions.sql` (`0034_minimax_usage_log.sql` é a última existente).
- Testes de backend: e2e reais (Postgres real via `TestDb`/`db-test-helper.ts`), nenhum mock exceto quando já estabelecido em fases anteriores (não se aplica aqui — nenhuma IA envolvida).
- Frontend sem suíte automatizada — verificação manual via Playwright contra o bundle real implantado (deploy confirmado via grep no bundle do container ANTES de qualquer teste), mesma disciplina de todas as fases anteriores.
- **Guardrails de segurança permanentes deste projeto** (repetir em todo dispatch de subagente): nunca extrair segredos de container/env/config; nunca rodar `docker compose down -v`/`docker compose down --volumes` (com ou sem nome de serviço) nem `docker volume rm`/`docker volume prune`, em nenhuma circunstância — incidente real de perda de dados de produção já ocorreu nesta sessão por causa disso; nunca rodar `docker compose config` nem `docker inspect` sem filtro explícito; nunca registrar conta real nem logar com credenciais reais; override de dev (`docker-compose.override.yml`) só quando necessário, apagado imediatamente depois, antes de qualquer outro comando `docker compose`.

---

### Task 1: Cargo como entidade — migration + CRUD básico

**Files:**
- Create: `backend/db/migrations/0035_positions.sql`
- Create: `backend/src/positions/positions.module.ts`
- Create: `backend/src/positions/positions.controller.ts`
- Create: `backend/src/positions/positions.service.ts`
- Create: `backend/src/positions/dto/create-position.dto.ts`
- Create: `backend/src/positions/dto/update-position.dto.ts`
- Modify: `backend/src/app.module.ts` — registra `PositionsModule`
- Test: `backend/test/positions-catalog.e2e-spec.ts`

**Interfaces:**
- Produces: `Position { id: string, tenant_id: string, name: string, created_at: string }`; `PositionSummary { id: string, name: string, employee_count: number, epi_requirement_count: number, training_requirement_count: number }`; `PositionsService.create(client, tenantId, name)`, `.findAll(client, tenantId)`, `.update(client, id, name)`; `POST /positions`, `GET /positions`, `PATCH /positions/:id`. Também cria as tabelas `position_epi_requirements`/`position_training_requirements` e a coluna `employees.position_id` que as Tasks 2-4 vão consumir (schema completo nesta migration, lógica de negócio incremental nas tasks seguintes).

- [ ] **Step 1: Escrever a migration completa**

Cria `backend/db/migrations/0035_positions.sql`:

```sql
-- Fase 23 (Mapa SST): cargo vira entidade real por tenant. Ver
-- docs/specs/fase-23-mapa-sst.md. `positions` é análoga a
-- `company_units` (nome, renomeável, mesmo padrão de updated_at +
-- trigger). As duas tabelas de requisito são junções puras
-- (nunca editadas linha a linha — sempre substituídas por inteiro via
-- PUT .../epi-requirements e .../training-requirements, Task 3), por
-- isso não têm updated_at, mesmo padrão já usado em
-- employee_epi_deliveries.

CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER trg_positions_updated_at BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions FORCE ROW LEVEL SECURITY;
CREATE POLICY positions_isolation ON positions USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

-- SET NULL, não CASCADE nem RESTRICT: apagar um cargo não pode apagar
-- nem bloquear a exclusão do funcionário — ele só perde o vínculo e
-- some do cálculo de divergência (mesmo comportamento de "sem cargo
-- vinculado").
ALTER TABLE employees ADD COLUMN position_id UUID REFERENCES positions(id) ON DELETE SET NULL;

CREATE TABLE position_epi_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  epi_catalog_item_id UUID NOT NULL REFERENCES epi_catalog_items(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (position_id, epi_catalog_item_id)
);

ALTER TABLE position_epi_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_epi_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY position_epi_requirements_isolation ON position_epi_requirements USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE TABLE position_training_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'nr-05', 'nr-06', 'nr-10', 'nr-11', 'nr-12', 'nr-18', 'nr-20',
    'nr-33', 'nr-35', 'outro'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (position_id, tipo)
);

ALTER TABLE position_training_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_training_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY position_training_requirements_isolation ON position_training_requirements USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
```

- [ ] **Step 2: Aplicar a migration**

Run: `docker compose exec backend npm run db:migrate` (ou `docker compose run --rm backend npm run db:migrate` se o container não estiver de pé)
Expected: `[apply] 0035_positions.sql` seguido de `[ok] 0035_positions.sql` / `Migrations concluídas.`

- [ ] **Step 3: Criar os DTOs**

Cria `backend/src/positions/dto/create-position.dto.ts`:

```typescript
export class CreatePositionDto {
  name: string;
  tenant_id?: string;
}
```

Cria `backend/src/positions/dto/update-position.dto.ts`:

```typescript
export class UpdatePositionDto {
  name: string;
}
```

(Sem `class-validator` — mesmo padrão já usado em `UpdateEmployeeDto`, projeto não valida DTOs simples desse jeito nos módulos de cadastro.)

- [ ] **Step 4: Escrever o service**

Cria `backend/src/positions/positions.service.ts`:

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';

export interface Position {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string;
}

export interface PositionSummary {
  id: string;
  name: string;
  employee_count: number;
  epi_requirement_count: number;
  training_requirement_count: number;
}

@Injectable()
export class PositionsService {
  async create(client: PoolClient, tenantId: string, name: string): Promise<Position> {
    try {
      const result = await client.query<Position>(
        `INSERT INTO positions (tenant_id, name) VALUES ($1, $2) RETURNING *`,
        [tenantId, name],
      );
      return result.rows[0];
    } catch (err) {
      mapPgError(err);
    }
  }

  async findAll(client: PoolClient, tenantId: string): Promise<PositionSummary[]> {
    const result = await client.query<PositionSummary>(
      `SELECT p.id, p.name,
         (SELECT COUNT(*)::int FROM employees e WHERE e.position_id = p.id) AS employee_count,
         (SELECT COUNT(*)::int FROM position_epi_requirements per WHERE per.position_id = p.id) AS epi_requirement_count,
         (SELECT COUNT(*)::int FROM position_training_requirements ptr WHERE ptr.position_id = p.id) AS training_requirement_count
       FROM positions p
       WHERE p.tenant_id = $1
       ORDER BY p.name`,
      [tenantId],
    );
    return result.rows;
  }

  async update(client: PoolClient, id: string, name: string): Promise<Position> {
    try {
      const result = await client.query<Position>(
        `UPDATE positions SET name = $2 WHERE id = $1 RETURNING *`,
        [id, name],
      );
      const position = result.rows[0];
      if (!position) throw new NotFoundException('Cargo não encontrado');
      return position;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      mapPgError(err);
    }
  }
}
```

- [ ] **Step 5: Escrever o controller**

Cria `backend/src/positions/positions.controller.ts`:

```typescript
import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { PositionsService } from './positions.service';
import { CreatePositionDto } from './dto/create-position.dto';
import { UpdatePositionDto } from './dto/update-position.dto';

@Controller('positions')
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Roles('empresa', 'admin')
  @Post()
  create(@Body() dto: CreatePositionDto, @Req() req: any) {
    const user = req.user;
    const tenantId = user.role === 'admin' ? dto.tenant_id : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) => this.positions.create(client, tenantId, dto.name));
  }

  @Get()
  findAll(@Query('tenant_id') tenantIdParam: string | undefined, @Req() req: any) {
    const tenantId = req.user.role === 'admin' ? tenantIdParam : req.user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) => this.positions.findAll(client, tenantId));
  }

  @Roles('empresa', 'admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePositionDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.positions.update(client, id, dto.name));
  }
}
```

- [ ] **Step 6: Escrever o module e registrar no app**

Cria `backend/src/positions/positions.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { PositionsController } from './positions.controller';
import { PositionsService } from './positions.service';

@Module({
  controllers: [PositionsController],
  providers: [PositionsService],
  exports: [PositionsService],
})
export class PositionsModule {}
```

Em `backend/src/app.module.ts`, adiciona o import junto dos demais módulos de domínio (linha do `import { CaepiModule } ...`) e no array `imports` do `@Module`:

```typescript
import { PositionsModule } from './positions/positions.module';
```

```typescript
    CaepiModule,
    PositionsModule,
```

- [ ] **Step 7: Escrever o teste e2e**

Cria `backend/test/positions-catalog.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/GET/PATCH /positions (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Cargo Teste');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cria um cargo e devolve na listagem com contadores zerados', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Eletricista' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe('Eletricista');

    const listRes = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    const created = listRes.body.find((p: any) => p.id === createRes.body.id);
    expect(created).toMatchObject({
      name: 'Eletricista',
      employee_count: 0,
      epi_requirement_count: 0,
      training_requirement_count: 0,
    });
  });

  it('rejeita nome duplicado no mesmo tenant com 409', async () => {
    await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Soldador' });

    const dupRes = await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Soldador' });

    expect(dupRes.status).toBe(409);
  });

  it('renomeia um cargo existente', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ajudante Geral' });

    const patchRes = await request(app.getHttpServer())
      .patch(`/positions/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Auxiliar Geral' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.name).toBe('Auxiliar Geral');
  });

  it('devolve 404 ao renomear cargo inexistente', async () => {
    const patchRes = await request(app.getHttpServer())
      .patch('/positions/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Não Existe' });

    expect(patchRes.status).toBe(404);
  });
});
```

- [ ] **Step 8: Rodar o teste (deve falhar antes do código existir, se aplicado fora de ordem — aqui, confirmar que passa)**

Criar `docker-compose.override.yml` (bind mount `./backend:/app`, volume nomeado `/app/node_modules`, `NODE_ENV: development`, `TEST_SUPERUSER_DATABASE_URL` construído a partir de `${POSTGRES_SUPERUSER}`/`${POSTGRES_SUPERUSER_PASSWORD}`/`${POSTGRES_DB}` — mesmo conteúdo já usado em todas as tasks anteriores deste projeto).

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- positions-catalog"`
Expected: `Tests: 4 passed, 4 total`

- [ ] **Step 9: Apagar o override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/db/migrations/0035_positions.sql backend/src/positions backend/src/app.module.ts backend/test/positions-catalog.e2e-spec.ts
git commit -m "feat: cargo como entidade (positions) — CRUD básico"
```

---

### Task 2: Vínculo de funcionário a cargo

**Files:**
- Modify: `backend/src/positions/positions.service.ts` — adiciona `getLinkSuggestions`/`confirmLinks`
- Modify: `backend/src/positions/positions.controller.ts` — adiciona `GET /positions/link-suggestions`, `POST /positions/confirm-links`
- Create: `backend/src/positions/dto/confirm-links.dto.ts`
- Modify: `backend/src/employees/employees.service.ts` — `position_id` entra em `UPDATABLE_FIELDS`, ganha checagem de posse de tenant em `update()`
- Modify: `backend/src/employees/dto/update-employee.dto.ts` — adiciona `position_id?: string`
- Test: `backend/test/positions-link.e2e-spec.ts`

**Interfaces:**
- Consumes: `PositionsService` (Task 1), `Position` (Task 1).
- Produces: `LinkSuggestion { suggested_name: string, employee_ids: string[], employee_count: number }`; `PositionsService.getLinkSuggestions(client, tenantId)`, `.confirmLinks(client, tenantId, groups: { name: string, employee_ids: string[] }[])`; `GET /positions/link-suggestions`, `POST /positions/confirm-links`.

- [ ] **Step 1: Escrever o teste e2e (RED)**

Cria `backend/test/positions-link.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /positions/link-suggestions e POST /positions/confirm-links (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tenantAId: string;
  let positionBId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Vinculo Cargo A');
    const tenantB = await db.createTenantWithUser('Empresa Vinculo Cargo B');
    tenantAId = tenantA.tenantId;

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    tokenA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.email, password: tenantB.password });
    tokenB = loginB.body.access_token;

    // 3 funcionários com grafias diferentes do "mesmo" cargo (normalização
    // colapsa acento/case/espaço, mas não sinônimo/abreviação — 2 grupos
    // esperados, não 1).
    await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, position, status) VALUES
       ($1, 'Ana', '10000000001', 'Auxiliar Administrativo', 'ativo'),
       ($1, 'Bia', '10000000002', 'auxiliar administrativo', 'ativo'),
       ($1, 'Caio', '10000000003', 'Soldador', 'ativo')`,
      [tenantAId],
    );

    const positionB = await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Cargo do Tenant B' });
    positionBId = positionB.body.id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('agrupa funcionários por texto normalizado, ignora quem já tem cpf de outro tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/positions/link-suggestions')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const auxGroup = res.body.find((g: any) => g.employee_count === 2);
    expect(auxGroup.suggested_name).toBe('Auxiliar Administrativo');
    expect(auxGroup.employee_ids).toHaveLength(2);

    const soldadorGroup = res.body.find((g: any) => g.employee_count === 1);
    expect(soldadorGroup.suggested_name).toBe('Soldador');
  });

  it('confirma os grupos: cria cargo (ou reaproveita) e vincula os funcionários', async () => {
    const suggestions = await request(app.getHttpServer())
      .get('/positions/link-suggestions')
      .set('Authorization', `Bearer ${tokenA}`);

    const confirmRes = await request(app.getHttpServer())
      .post('/positions/confirm-links')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ groups: suggestions.body });

    expect(confirmRes.status).toBe(201);

    const listRes = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${tokenA}`);

    const auxCargo = listRes.body.find((p: any) => p.name === 'Auxiliar Administrativo');
    expect(auxCargo.employee_count).toBe(2);

    // Confirmação repetida (idempotente) não duplica o cargo.
    const secondConfirm = await request(app.getHttpServer())
      .post('/positions/confirm-links')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ groups: [{ name: 'Auxiliar Administrativo', employee_ids: suggestions.body[0].employee_ids }] });
    expect(secondConfirm.status).toBe(201);

    const listAfter = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${tokenA}`);
    expect(listAfter.body.filter((p: any) => p.name === 'Auxiliar Administrativo')).toHaveLength(1);
  });

  it('rejeita vincular funcionário via position_id de outro tenant no PATCH /employees/:id', async () => {
    const employeesA = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${tokenA}`);
    const employeeId = employeesA.body.find((e: any) => e.full_name === 'Caio').id;

    const res = await request(app.getHttpServer())
      .patch(`/employees/${employeeId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ position_id: positionBId });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- positions-link"`
Expected: FAIL — `GET /positions/link-suggestions` e `POST /positions/confirm-links` ainda não existem (404).

- [ ] **Step 3: DTO de confirmação**

Cria `backend/src/positions/dto/confirm-links.dto.ts`:

```typescript
export class ConfirmLinksGroupDto {
  name: string;
  employee_ids: string[];
}

export class ConfirmLinksDto {
  groups: ConfirmLinksGroupDto[];
}
```

- [ ] **Step 4: Implementar `getLinkSuggestions`/`confirmLinks` no service**

Em `backend/src/positions/positions.service.ts`, adiciona (mesma normalização já usada em `normalizeHeader` da Fase 22, `backend/src/employees/spreadsheet-import.util.ts`):

```typescript
export interface LinkSuggestion {
  suggested_name: string;
  employee_ids: string[];
  employee_count: number;
}
```

```typescript
  private normalizePositionText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  async getLinkSuggestions(client: PoolClient, tenantId: string): Promise<LinkSuggestion[]> {
    const result = await client.query<{ id: string; position: string }>(
      `SELECT id, position FROM employees
       WHERE tenant_id = $1 AND position_id IS NULL AND position IS NOT NULL AND position != ''`,
      [tenantId],
    );

    const groups = new Map<string, { rawCounts: Map<string, number>; employeeIds: string[] }>();
    for (const row of result.rows) {
      const normalized = this.normalizePositionText(row.position);
      if (!groups.has(normalized)) groups.set(normalized, { rawCounts: new Map(), employeeIds: [] });
      const group = groups.get(normalized)!;
      group.employeeIds.push(row.id);
      group.rawCounts.set(row.position, (group.rawCounts.get(row.position) ?? 0) + 1);
    }

    return Array.from(groups.values()).map((group) => {
      // Texto raw mais frequente vira o nome sugerido; empate desfeito por
      // ordem alfabética — determinístico, sem depender de ordem de inserção.
      const [suggestedName] = Array.from(group.rawCounts.entries()).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      })[0];
      return {
        suggested_name: suggestedName,
        employee_ids: group.employeeIds,
        employee_count: group.employeeIds.length,
      };
    });
  }

  async confirmLinks(
    client: PoolClient,
    tenantId: string,
    groups: { name: string; employee_ids: string[] }[],
  ): Promise<void> {
    for (const group of groups) {
      const positionResult = await client.query<{ id: string }>(
        `INSERT INTO positions (tenant_id, name) VALUES ($1, $2)
         ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [tenantId, group.name],
      );
      const positionId = positionResult.rows[0].id;
      if (group.employee_ids.length > 0) {
        await client.query(`UPDATE employees SET position_id = $1 WHERE id = ANY($2)`, [
          positionId,
          group.employee_ids,
        ]);
      }
    }
  }
```

- [ ] **Step 5: Endpoints no controller**

Em `backend/src/positions/positions.controller.ts`, importa `ConfirmLinksDto` e adiciona os dois métodos **antes** do `@Patch(':id')` já existente (rotas literais precisam vir antes de qualquer rota `:id` no mesmo nível de path — `GET /positions/:id` só chega na Task 4, mas o `PATCH /positions/:id` já existente não conflita com `GET`, então a ordem exata aqui só importa entre os dois GETs):

```typescript
import { ConfirmLinksDto } from './dto/confirm-links.dto';
```

```typescript
  @Roles('empresa', 'admin')
  @Get('link-suggestions')
  getLinkSuggestions(@Query('tenant_id') tenantIdParam: string | undefined, @Req() req: any) {
    const tenantId = req.user.role === 'admin' ? tenantIdParam : req.user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) => this.positions.getLinkSuggestions(client, tenantId));
  }

  @Roles('empresa', 'admin')
  @Post('confirm-links')
  confirmLinks(@Body() dto: ConfirmLinksDto, @Query('tenant_id') tenantIdParam: string | undefined, @Req() req: any) {
    const tenantId = req.user.role === 'admin' ? tenantIdParam : req.user.tenantId;
    if (!tenantId) throw new BadRequestException('tenant_id é obrigatório');

    return req.withTenantContext((client: any) => this.positions.confirmLinks(client, tenantId, dto.groups));
  }
```

**Atenção de ordem de declaração**: coloca `@Get('link-suggestions')` ANTES do `@Get()` de listagem (Task 1) não é necessário (paths diferentes: `/positions` vs `/positions/link-suggestions`, Nest resolve por especificidade de path inteiro, não por prefixo) — mas mantém os dois métodos novos localizados junto aos outros métodos de nível `/positions` (antes do `@Patch(':id')`), só por organização do arquivo.

- [ ] **Step 6: `position_id` em `UpdateEmployeeDto` e checagem de posse em `EmployeesService.update`**

Em `backend/src/employees/dto/update-employee.dto.ts`, adiciona o campo:

```typescript
export class UpdateEmployeeDto {
  full_name?: string;
  cpf?: string;
  birth_date?: string;
  position?: string;
  admission_date?: string;
  company_unit_id?: string;
  position_id?: string;
  status?: 'ativo' | 'inativo' | 'pendente';
}
```

Em `backend/src/employees/employees.service.ts`, adiciona `'position_id'` a `UPDATABLE_FIELDS`:

```typescript
const UPDATABLE_FIELDS = [
  'full_name',
  'cpf',
  'birth_date',
  'position',
  'admission_date',
  'company_unit_id',
  'position_id',
  'status',
] as const;
```

E em `update()` (mesmo padrão já usado pra `company_unit_id`, incluindo o mesmo comentário sobre o tenant relevante ser o do funcionário ALVO):

```typescript
  async update(client: PoolClient, id: string, data: UpdateEmployeeData): Promise<Employee> {
    if (data.company_unit_id) {
      // O tenant relevante aqui é o do funcionário ALVO (id), não necessariamente o do
      // caller — um admin pode atualizar funcionário de qualquer tenant, então é preciso
      // buscar a qual tenant o funcionário já pertence antes de validar a filial.
      const existing = await client.query<{ tenant_id: string }>('SELECT tenant_id FROM employees WHERE id = $1', [
        id,
      ]);
      if (existing.rowCount === 0) throw new NotFoundException('Funcionário não encontrado');
      await this.assertCompanyUnitBelongsToTenant(client, data.company_unit_id, existing.rows[0].tenant_id);
    }
    if (data.position_id) {
      // Mesmo raciocínio de company_unit_id acima: um position_id de outro
      // tenant não é barrado pela RLS de `positions` pro role admin (bypass
      // explícito na policy), então precisa de checagem cruzada explícita
      // aqui, não só confiar na visibilidade de RLS.
      const existing = await client.query<{ tenant_id: string }>('SELECT tenant_id FROM employees WHERE id = $1', [
        id,
      ]);
      if (existing.rowCount === 0) throw new NotFoundException('Funcionário não encontrado');
      const positionResult = await client.query('SELECT id FROM positions WHERE id = $1 AND tenant_id = $2', [
        data.position_id,
        existing.rows[0].tenant_id,
      ]);
      if (positionResult.rowCount === 0) throw new BadRequestException('Cargo não encontrado');
    }
    const { setClauses, values } = buildSafeSetClause(data, UPDATABLE_FIELDS, 2);
    if (setClauses.length === 0) return this.findOne(client, id);

    const result = await client.query<Employee>(
      `UPDATE employees SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    const employee = result.rows[0];
    if (!employee) throw new NotFoundException('Funcionário não encontrado');
    return employee;
  }
```

(A busca de `existing` roda 2x — uma pra `company_unit_id`, outra pra `position_id` — só quando os dois campos vêm juntos no mesmo PATCH, caso raro; não vale a pena introduzir uma variável compartilhada só pra isso e complicar a leitura do método.)

Adiciona `position_id?: string;` à interface `UpdateEmployeeData` (mesmo arquivo, próximo a `company_unit_id?: string;`).

- [ ] **Step 7: Rodar o teste, confirmar que passa**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- positions-link"`
Expected: `Tests: 3 passed, 3 total`

- [ ] **Step 8: Regressão de `employees`**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- employees"`
Expected: todas as suítes de `employees` continuam verdes (nenhuma mudou de comportamento pros campos já existentes).

- [ ] **Step 9: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/src/positions backend/src/employees backend/test/positions-link.e2e-spec.ts
git commit -m "feat: vínculo de funcionário a cargo (sugestão de agrupamento + confirmação)"
```

---

### Task 3: Requisitos por cargo (EPI + treinamento)

**Files:**
- Modify: `backend/src/positions/positions.service.ts` — adiciona `setEpiRequirements`/`setTrainingRequirements`
- Modify: `backend/src/positions/positions.controller.ts` — adiciona `PUT /positions/:id/epi-requirements`, `PUT /positions/:id/training-requirements`
- Create: `backend/src/positions/dto/set-epi-requirements.dto.ts`
- Create: `backend/src/positions/dto/set-training-requirements.dto.ts`
- Test: `backend/test/positions-requirements.e2e-spec.ts`

**Interfaces:**
- Consumes: `PositionsService` (Task 1), `TRAINING_TYPES`/`TrainingType` de `backend/src/cipa/trainings.service.ts` (já existente).
- Produces: `PositionsService.setEpiRequirements(client, positionId, epiCatalogItemIds: string[])`, `.setTrainingRequirements(client, positionId, tipos: TrainingType[])`; `PUT /positions/:id/epi-requirements`, `PUT /positions/:id/training-requirements`.

- [ ] **Step 1: Escrever o teste e2e (RED)**

Cria `backend/test/positions-requirements.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('PUT /positions/:id/epi-requirements e /training-requirements (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let positionId: string;
  let epiCatalogItemId: string;
  let epiCatalogItemId2: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Requisitos Cargo');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    const positionRes = await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Soldador Requisitos' });
    positionId = positionRes.body.id;

    const catalogRows = await (db as any).client.query('SELECT id FROM epi_catalog_items ORDER BY code LIMIT 2');
    epiCatalogItemId = catalogRows.rows[0].id;
    epiCatalogItemId2 = catalogRows.rows[1].id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('define requisitos de EPI e reflete na listagem de cargos', async () => {
    const res = await request(app.getHttpServer())
      .put(`/positions/${positionId}/epi-requirements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ epi_catalog_item_ids: [epiCatalogItemId, epiCatalogItemId2] });

    expect(res.status).toBe(200);

    const listRes = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${token}`);
    const position = listRes.body.find((p: any) => p.id === positionId);
    expect(position.epi_requirement_count).toBe(2);
  });

  it('substitui a lista por inteiro (PUT idempotente, não incremental)', async () => {
    await request(app.getHttpServer())
      .put(`/positions/${positionId}/epi-requirements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ epi_catalog_item_ids: [epiCatalogItemId] });

    const listRes = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${token}`);
    const position = listRes.body.find((p: any) => p.id === positionId);
    expect(position.epi_requirement_count).toBe(1);
  });

  it('define requisitos de treinamento e reflete na listagem de cargos', async () => {
    const res = await request(app.getHttpServer())
      .put(`/positions/${positionId}/training-requirements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipos: ['nr-06', 'nr-35'] });

    expect(res.status).toBe(200);

    const listRes = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${token}`);
    const position = listRes.body.find((p: any) => p.id === positionId);
    expect(position.training_requirement_count).toBe(2);
  });

  it('rejeita tipo de treinamento inválido com 400', async () => {
    const res = await request(app.getHttpServer())
      .put(`/positions/${positionId}/training-requirements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipos: ['nr-99-invalido'] });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- positions-requirements"`
Expected: FAIL — os 2 endpoints `PUT` ainda não existem (404).

- [ ] **Step 3: DTOs**

Cria `backend/src/positions/dto/set-epi-requirements.dto.ts`:

```typescript
export class SetEpiRequirementsDto {
  epi_catalog_item_ids: string[];
}
```

Cria `backend/src/positions/dto/set-training-requirements.dto.ts`:

```typescript
export class SetTrainingRequirementsDto {
  tipos: string[];
}
```

- [ ] **Step 4: Implementar no service**

Em `backend/src/positions/positions.service.ts`, importa o enum já existente e adiciona os dois métodos:

```typescript
import { TRAINING_TYPES, TrainingType } from '../cipa/trainings.service';
```

```typescript
  async setEpiRequirements(client: PoolClient, positionId: string, epiCatalogItemIds: string[]): Promise<void> {
    const positionResult = await client.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM positions WHERE id = $1',
      [positionId],
    );
    if (positionResult.rowCount === 0) throw new NotFoundException('Cargo não encontrado');
    const tenantId = positionResult.rows[0].tenant_id;

    await client.query('DELETE FROM position_epi_requirements WHERE position_id = $1', [positionId]);
    for (const epiCatalogItemId of epiCatalogItemIds) {
      await client.query(
        `INSERT INTO position_epi_requirements (tenant_id, position_id, epi_catalog_item_id) VALUES ($1, $2, $3)`,
        [tenantId, positionId, epiCatalogItemId],
      );
    }
  }

  async setTrainingRequirements(client: PoolClient, positionId: string, tipos: string[]): Promise<void> {
    const positionResult = await client.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM positions WHERE id = $1',
      [positionId],
    );
    if (positionResult.rowCount === 0) throw new NotFoundException('Cargo não encontrado');
    const tenantId = positionResult.rows[0].tenant_id;

    for (const tipo of tipos) {
      if (!TRAINING_TYPES.includes(tipo as TrainingType)) {
        throw new BadRequestException(`Tipo de treinamento inválido: ${tipo}`);
      }
    }

    await client.query('DELETE FROM position_training_requirements WHERE position_id = $1', [positionId]);
    for (const tipo of tipos) {
      await client.query(
        `INSERT INTO position_training_requirements (tenant_id, position_id, tipo) VALUES ($1, $2, $3)`,
        [tenantId, positionId, tipo],
      );
    }
  }
```

Adiciona `BadRequestException` ao import de `@nestjs/common` no topo do arquivo (junto de `Injectable`/`NotFoundException` já importados).

- [ ] **Step 5: Endpoints no controller**

Em `backend/src/positions/positions.controller.ts`:

```typescript
import { SetEpiRequirementsDto } from './dto/set-epi-requirements.dto';
import { SetTrainingRequirementsDto } from './dto/set-training-requirements.dto';
```

```typescript
  @Roles('empresa', 'admin')
  @Put(':id/epi-requirements')
  setEpiRequirements(@Param('id') id: string, @Body() dto: SetEpiRequirementsDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.positions.setEpiRequirements(client, id, dto.epi_catalog_item_ids),
    );
  }

  @Roles('empresa', 'admin')
  @Put(':id/training-requirements')
  setTrainingRequirements(@Param('id') id: string, @Body() dto: SetTrainingRequirementsDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.positions.setTrainingRequirements(client, id, dto.tipos));
  }
```

Adiciona `Put` ao import de `@nestjs/common` no topo do arquivo.

- [ ] **Step 6: Rodar o teste, confirmar que passa**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- positions-requirements"`
Expected: `Tests: 4 passed, 4 total`

- [ ] **Step 7: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/src/positions backend/test/positions-requirements.e2e-spec.ts
git commit -m "feat: requisitos de EPI e treinamento por cargo"
```

---

### Task 4: Divergência + detalhe do cargo + integração com o dashboard

**Files:**
- Modify: `backend/src/positions/positions.service.ts` — adiciona `getDivergences`, `findOne` (detalhe completo), estende `findAll` com `divergence_count`
- Modify: `backend/src/positions/positions.controller.ts` — adiciona `GET /positions/:id`
- Modify: `backend/src/positions/positions.module.ts` — exporta `PositionsModule` pronto pra importar no dashboard
- Modify: `backend/src/dashboard/dashboard.service.ts` — integra divergência na lista `atencao`
- Modify: `backend/src/dashboard/dashboard.module.ts` — importa `PositionsModule`, injeta `PositionsService`
- Test: `backend/test/positions-divergence.e2e-spec.ts`
- Test: `backend/test/dashboard-summary.e2e-spec.ts` (existente — adiciona 1 teste de regressão/integração)

**Interfaces:**
- Consumes: `PositionsService` (Tasks 1-3), `DashboardService`/`AttentionItem` (`backend/src/dashboard/dashboard.service.ts`, já existente).
- Produces: `Divergence { employee_id: string, employee_name: string, position_name: string, categoria: 'epi' | 'treinamento', requisito: string, empresa_tem_no_catalogo?: boolean }`; `PositionsService.getDivergences(client, tenantId)`, `.findOne(client, id)`; `GET /positions/:id`; `AttentionItem['tipo']` ganha `'cargo'`.

- [ ] **Step 1: Escrever o teste e2e (RED)**

Cria `backend/test/positions-divergence.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /positions/:id (divergência) e integração com o dashboard (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let positionId: string;
  let employeeId: string;
  let epiCatalogItemId: string;
  let epiCatalogItemId2: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Divergencia Cargo');
    tenantId = tenant.tenantId;
    employeeId = tenant.employeeId;
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    const positionRes = await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Eletricista Divergencia' });
    positionId = positionRes.body.id;

    await (db as any).client.query('UPDATE employees SET position_id = $1 WHERE id = $2', [positionId, employeeId]);

    const catalogRows = await (db as any).client.query('SELECT id FROM epi_catalog_items ORDER BY code LIMIT 2');
    epiCatalogItemId = catalogRows.rows[0].id;
    epiCatalogItemId2 = catalogRows.rows[1].id;

    await request(app.getHttpServer())
      .put(`/positions/${positionId}/epi-requirements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ epi_catalog_item_ids: [epiCatalogItemId, epiCatalogItemId2] });

    await request(app.getHttpServer())
      .put(`/positions/${positionId}/training-requirements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipos: ['nr-35'] });

    // Cadastra o item 1 no catálogo da empresa e entrega pro funcionário —
    // esse item fica "atendido". O item 2 nunca é cadastrado pela empresa —
    // fica divergente com empresa_tem_no_catalogo=false. Treinamento nr-35
    // nunca é feito — fica divergente sem esse campo.
    const tenantEpiRes = await request(app.getHttpServer())
      .post('/epis')
      .set('Authorization', `Bearer ${token}`)
      .send({ epi_catalog_item_id: epiCatalogItemId, ca_number: '12345' });

    await request(app.getHttpServer())
      .post(`/epis/${tenantEpiRes.body.id}/deliveries`)
      .set('Authorization', `Bearer ${token}`)
      .send({ employee_id: employeeId, delivered_at: '2026-01-01', signed_by_name: 'Assinante Teste' });
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /positions/:id mostra 1 requisito atendido e 2 divergentes (1 EPI sem cadastro, 1 treinamento nunca feito)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/positions/${positionId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.employees).toHaveLength(1);
    const employee = res.body.employees[0];
    expect(employee.divergences).toHaveLength(2);

    const epiDivergence = employee.divergences.find((d: any) => d.categoria === 'epi');
    expect(epiDivergence.empresa_tem_no_catalogo).toBe(false);

    const trainingDivergence = employee.divergences.find((d: any) => d.categoria === 'treinamento');
    expect(trainingDivergence.requisito).toBe('nr-35');
  });

  it('GET /positions devolve divergence_count > 0 pro cargo com pendência', async () => {
    const res = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${token}`);

    const position = res.body.find((p: any) => p.id === positionId);
    expect(position.divergence_count).toBe(2);
  });

  it('dashboard existente lista as mesmas divergências como itens de atenção prioridade alta', async () => {
    const res = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const cargoItems = res.body.atencao.filter((i: any) => i.tipo === 'cargo');
    expect(cargoItems.length).toBe(2);
    expect(cargoItems.every((i: any) => i.prioridade === 'alta' && i.link === '/empresa/mapa-sst')).toBe(true);
    expect(res.body.status).toBe('critico');
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `docker compose run --rm backend sh -c "npm install && npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- positions-divergence"`
Expected: FAIL — `GET /positions/:id` ainda não existe (404), e o dashboard ainda não inclui itens `tipo: 'cargo'`.

Confirmar antes o path exato do endpoint de resumo do dashboard: `grep -n "@Get" backend/src/dashboard/dashboard.controller.ts` (deve ser `/dashboard/summary` — se for outro path, ajustar o teste acima pra bater com o real antes de prosseguir).

- [ ] **Step 3: `getDivergences` e `findOne` no service**

Em `backend/src/positions/positions.service.ts`:

```typescript
export interface Divergence {
  employee_id: string;
  employee_name: string;
  position_id: string;
  position_name: string;
  categoria: 'epi' | 'treinamento';
  requisito: string;
  empresa_tem_no_catalogo?: boolean;
}

export interface PositionDetail {
  id: string;
  name: string;
  epi_requirement_ids: string[];
  training_requirement_tipos: string[];
  employees: {
    id: string;
    full_name: string;
    divergences: Omit<Divergence, 'employee_id' | 'employee_name' | 'position_id' | 'position_name'>[];
  }[];
}
```

```typescript
  async getDivergences(client: PoolClient, tenantId: string): Promise<Divergence[]> {
    const epiDivergences = await client.query<Divergence>(
      `SELECT e.id AS employee_id, e.full_name AS employee_name, p.id AS position_id, p.name AS position_name,
              'epi'::text AS categoria, eci.description AS requisito,
              EXISTS (SELECT 1 FROM tenant_epis te WHERE te.tenant_id = e.tenant_id
                      AND te.epi_catalog_item_id = eci.id) AS empresa_tem_no_catalogo
       FROM employees e
       JOIN positions p ON p.id = e.position_id
       JOIN position_epi_requirements per ON per.position_id = p.id
       JOIN epi_catalog_items eci ON eci.id = per.epi_catalog_item_id
       WHERE e.tenant_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM employee_epi_deliveries eed
           JOIN tenant_epis te ON te.id = eed.tenant_epi_id
           WHERE eed.employee_id = e.id AND te.epi_catalog_item_id = eci.id
         )`,
      [tenantId],
    );

    const trainingDivergences = await client.query<Divergence>(
      `SELECT e.id AS employee_id, e.full_name AS employee_name, p.id AS position_id, p.name AS position_name,
              'treinamento'::text AS categoria, ptr.tipo AS requisito
       FROM employees e
       JOIN positions p ON p.id = e.position_id
       JOIN position_training_requirements ptr ON ptr.position_id = p.id
       WHERE e.tenant_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM cipa_trainings ct
           WHERE ct.employee_id = e.id AND ct.tipo = ptr.tipo AND ct.data_validade >= CURRENT_DATE
         )`,
      [tenantId],
    );

    return [...epiDivergences.rows, ...trainingDivergences.rows];
  }

  async findOne(client: PoolClient, id: string): Promise<PositionDetail> {
    const positionResult = await client.query<{ id: string; name: string; tenant_id: string }>(
      'SELECT id, name, tenant_id FROM positions WHERE id = $1',
      [id],
    );
    const position = positionResult.rows[0];
    if (!position) throw new NotFoundException('Cargo não encontrado');

    const epiReqResult = await client.query<{ epi_catalog_item_id: string }>(
      'SELECT epi_catalog_item_id FROM position_epi_requirements WHERE position_id = $1',
      [id],
    );
    const trainingReqResult = await client.query<{ tipo: string }>(
      'SELECT tipo FROM position_training_requirements WHERE position_id = $1',
      [id],
    );
    const employeesResult = await client.query<{ id: string; full_name: string }>(
      'SELECT id, full_name FROM employees WHERE position_id = $1 ORDER BY full_name',
      [id],
    );

    const allDivergences = await this.getDivergences(client, position.tenant_id);
    const divergencesByEmployee = new Map<string, Divergence[]>();
    for (const divergence of allDivergences) {
      if (divergence.position_id !== id) continue;
      if (!divergencesByEmployee.has(divergence.employee_id)) divergencesByEmployee.set(divergence.employee_id, []);
      divergencesByEmployee.get(divergence.employee_id)!.push(divergence);
    }

    return {
      id: position.id,
      name: position.name,
      epi_requirement_ids: epiReqResult.rows.map((r) => r.epi_catalog_item_id),
      training_requirement_tipos: trainingReqResult.rows.map((r) => r.tipo),
      employees: employeesResult.rows.map((employee) => ({
        id: employee.id,
        full_name: employee.full_name,
        divergences: (divergencesByEmployee.get(employee.id) ?? []).map((d) => ({
          categoria: d.categoria,
          requisito: d.requisito,
          ...(d.categoria === 'epi' ? { empresa_tem_no_catalogo: d.empresa_tem_no_catalogo } : {}),
        })),
      })),
    };
  }
```

Estende `findAll` (Task 1) pra incluir `divergence_count`, substituindo o corpo do método inteiro:

```typescript
  async findAll(client: PoolClient, tenantId: string): Promise<PositionSummary[]> {
    const result = await client.query<Omit<PositionSummary, 'divergence_count'>>(
      `SELECT p.id, p.name,
         (SELECT COUNT(*)::int FROM employees e WHERE e.position_id = p.id) AS employee_count,
         (SELECT COUNT(*)::int FROM position_epi_requirements per WHERE per.position_id = p.id) AS epi_requirement_count,
         (SELECT COUNT(*)::int FROM position_training_requirements ptr WHERE ptr.position_id = p.id) AS training_requirement_count
       FROM positions p
       WHERE p.tenant_id = $1
       ORDER BY p.name`,
      [tenantId],
    );

    const divergences = await this.getDivergences(client, tenantId);
    const countByPosition = new Map<string, number>();
    for (const divergence of divergences) {
      countByPosition.set(divergence.position_id, (countByPosition.get(divergence.position_id) ?? 0) + 1);
    }

    return result.rows.map((row) => ({ ...row, divergence_count: countByPosition.get(row.id) ?? 0 }));
  }
```

E adiciona `divergence_count: number;` à interface `PositionSummary` (Task 1).

- [ ] **Step 4: Endpoint `GET /positions/:id`**

Em `backend/src/positions/positions.controller.ts`, adiciona **depois** de `getLinkSuggestions`/`confirmLinks` (Task 2) e **antes** do `@Patch(':id')` (Task 1) — ordem entre os dois GETs não importa aqui porque um é `/positions` (sem parâmetro) e o outro é `/positions/:id`, mas os dois `:id` (`GET` e `PATCH`) ficam juntos por organização:

```typescript
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.positions.findOne(client, id));
  }
```

- [ ] **Step 5: Integração com o dashboard**

Em `backend/src/dashboard/dashboard.service.ts`:

```typescript
import { PositionsService } from '../positions/positions.service';
```

```typescript
export interface AttentionItem {
  tipo: 'documento' | 'epi' | 'acao' | 'inspecao' | 'cargo';
  titulo: string;
  prioridade: AttentionPriority;
  data: string | null;
  responsavel: AttentionResponsible;
  link: string;
}
```

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

E dentro do array `atencao` (logo após o `...actionPlans.map(...)` já existente):

```typescript
      ...positionDivergences.map((divergence): AttentionItem => ({
        tipo: 'cargo',
        titulo:
          divergence.categoria === 'epi'
            ? `EPI ${divergence.empresa_tem_no_catalogo ? 'não entregue' : 'não cadastrado no catálogo'}: ${divergence.requisito} — ${divergence.employee_name} (${divergence.position_name})`
            : `Treinamento pendente/vencido: ${divergence.requisito} — ${divergence.employee_name} (${divergence.position_name})`,
        prioridade: 'alta',
        data: null,
        responsavel: 'empresa',
        link: '/empresa/mapa-sst',
      })),
```

E na linha de `pendencias` (logo abaixo do array `atencao`, onde hoje é `compliance.pendencias.length + epis.pendencias.length`):

```typescript
    const pendencias = compliance.pendencias.length + epis.pendencias.length + positionDivergences.length;
```

- [ ] **Step 6: Módulos — `PositionsModule` exportado, `DashboardModule` importando**

`backend/src/positions/positions.module.ts` já exporta `PositionsService` desde a Task 1 (`exports: [PositionsService]`) — nenhuma mudança necessária aqui.

Em `backend/src/dashboard/dashboard.module.ts`:

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

- [ ] **Step 7: Rodar o teste, confirmar que passa**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- positions-divergence"`
Expected: `Tests: 3 passed, 3 total`

- [ ] **Step 8: Regressão de `dashboard` e `positions`**

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- dashboard"`
Expected: todas as suítes de `dashboard` continuam verdes — em especial `dashboard-summary.e2e-spec.ts`, que não cria nenhum cargo/vínculo, então `positionDivergences` deve vir vazio nesses testes e não alterar nenhuma asserção existente.

Run: `docker compose run --rm backend sh -c "npx jest --config ./test/jest-e2e.json --runInBand --forceExit -- positions"`
Expected: as 4 suítes de `positions` (catalog, link, requirements, divergence) continuam verdes juntas.

- [ ] **Step 9: Apagar override, build e commit**

```bash
rm -f docker-compose.override.yml
docker compose build backend
git add backend/src/positions backend/src/dashboard backend/test/positions-divergence.e2e-spec.ts
git commit -m "feat: divergência de EPI/treinamento por cargo + integração com o dashboard"
```

---

### Task 5: Frontend — página `/empresa/mapa-sst`

**Files:**
- Create: `frontend/src/app/empresa/mapa-sst/page.tsx`
- Create: `frontend/src/components/MapaSstPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/positions`, `POST /api/positions`, `PATCH /api/positions/:id`, `GET /api/positions/link-suggestions`, `POST /api/positions/confirm-links`, `GET /api/positions/:id`, `PUT /api/positions/:id/epi-requirements`, `PUT /api/positions/:id/training-requirements` (Tasks 1-4), `GET /api/epi-catalog-items` (já existente, `backend/src/epi/epi-catalog.controller.ts`), `TRAINING_TYPE_LABEL`/`TRAINING_TYPES` (conceito já existente do backend — reimplementa a lista/label localmente no frontend, já que não há import cross-runtime backend→frontend neste projeto).

- [ ] **Step 1: Criar a página (wrapper de autenticação)**

Cria `frontend/src/app/empresa/mapa-sst/page.tsx` (mesmo padrão de `frontend/src/app/empresa/epis/page.tsx`):

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapaSstPanel } from '@/components/MapaSstPanel';

export default function EmpresaMapaSstPage() {
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
      <h1 className="text-2xl font-bold text-brand-900">Mapa SST</h1>
      <div className="mt-8">
        <MapaSstPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar o painel completo**

Cria `frontend/src/components/MapaSstPanel.tsx`:

```typescript
'use client';

import { FormEvent, useEffect, useState } from 'react';

interface PositionSummary {
  id: string;
  name: string;
  employee_count: number;
  epi_requirement_count: number;
  training_requirement_count: number;
  divergence_count: number;
}

interface LinkSuggestion {
  suggested_name: string;
  employee_ids: string[];
  employee_count: number;
}

interface EpiCatalogItem {
  id: string;
  category: string;
  code: string;
  equipment_group: string;
  description: string;
}

interface PositionDetail {
  id: string;
  name: string;
  epi_requirement_ids: string[];
  training_requirement_tipos: string[];
  employees: {
    id: string;
    full_name: string;
    divergences: { categoria: 'epi' | 'treinamento'; requisito: string; empresa_tem_no_catalogo?: boolean }[];
  }[];
}

const TRAINING_TYPES = ['nr-05', 'nr-06', 'nr-10', 'nr-11', 'nr-12', 'nr-18', 'nr-20', 'nr-33', 'nr-35', 'outro'] as const;
const TRAINING_TYPE_LABEL: Record<string, string> = {
  'nr-05': 'NR-05 — Membro da CIPA',
  'nr-06': 'NR-06 — Uso de EPI',
  'nr-10': 'NR-10 — Segurança em eletricidade',
  'nr-11': 'NR-11 — Transporte/movimentação de materiais',
  'nr-12': 'NR-12 — Segurança em máquinas e equipamentos',
  'nr-18': 'NR-18 — Condições de segurança na construção civil',
  'nr-20': 'NR-20 — Inflamáveis e combustíveis',
  'nr-33': 'NR-33 — Espaço confinado',
  'nr-35': 'NR-35 — Trabalho em altura',
  outro: 'Outro',
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

export function MapaSstPanel() {
  const [positions, setPositions] = useState<PositionSummary[]>([]);
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  const [showLinkReview, setShowLinkReview] = useState(false);
  const [newPositionName, setNewPositionName] = useState('');
  const [createError, setCreateError] = useState('');
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PositionDetail | null>(null);
  const [catalogItems, setCatalogItems] = useState<EpiCatalogItem[]>([]);
  const [epiSelection, setEpiSelection] = useState<Set<string>>(new Set());
  const [trainingSelection, setTrainingSelection] = useState<Set<string>>(new Set());

  async function loadPositions() {
    const res = await fetch('/api/positions', { headers: authHeaders() });
    if (res.ok) setPositions(await res.json());
  }

  async function loadSuggestions() {
    const res = await fetch('/api/positions/link-suggestions', { headers: authHeaders() });
    if (res.ok) setSuggestions(await res.json());
  }

  useEffect(() => {
    loadPositions();
    loadSuggestions();
    fetch('/api/epi-catalog-items', { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : []))
      .then(setCatalogItems);
  }, []);

  async function handleCreatePosition(e: FormEvent) {
    e.preventDefault();
    setCreateError('');
    const res = await fetch('/api/positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name: newPositionName }),
    });
    if (!res.ok) {
      setCreateError(res.status === 409 ? 'Já existe um cargo com esse nome' : 'Erro ao criar cargo');
      return;
    }
    setNewPositionName('');
    loadPositions();
  }

  async function handleConfirmLinks() {
    await fetch('/api/positions/confirm-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ groups: suggestions }),
    });
    setShowLinkReview(false);
    loadPositions();
    loadSuggestions();
  }

  function updateSuggestionName(index: number, name: string) {
    setSuggestions((prev) => prev.map((s, i) => (i === index ? { ...s, suggested_name: name } : s)));
  }

  async function openDetail(positionId: string) {
    setSelectedPositionId(positionId);
    const res = await fetch(`/api/positions/${positionId}`, { headers: authHeaders() });
    if (!res.ok) return;
    const data: PositionDetail = await res.json();
    setDetail(data);
    setEpiSelection(new Set(data.epi_requirement_ids));
    setTrainingSelection(new Set(data.training_requirement_tipos));
  }

  async function saveEpiRequirements() {
    if (!selectedPositionId) return;
    await fetch(`/api/positions/${selectedPositionId}/epi-requirements`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ epi_catalog_item_ids: Array.from(epiSelection) }),
    });
    openDetail(selectedPositionId);
    loadPositions();
  }

  async function saveTrainingRequirements() {
    if (!selectedPositionId) return;
    await fetch(`/api/positions/${selectedPositionId}/training-requirements`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ tipos: Array.from(trainingSelection) }),
    });
    openDetail(selectedPositionId);
    loadPositions();
  }

  function toggleEpi(id: string) {
    setEpiSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTraining(tipo: string) {
    setTrainingSelection((prev) => {
      const next = new Set(prev);
      if (next.has(tipo)) next.delete(tipo);
      else next.add(tipo);
      return next;
    });
  }

  const catalogByCategory = catalogItems.reduce<Record<string, EpiCatalogItem[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-6">
      {suggestions.length > 0 && !showLinkReview && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            {suggestions.reduce((sum, s) => sum + s.employee_count, 0)} funcionário(s) sem cargo vinculado.
          </p>
          <button
            type="button"
            onClick={() => setShowLinkReview(true)}
            className="mt-2 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Revisar
          </button>
        </div>
      )}

      {showLinkReview && (
        <div className="flex flex-col gap-3 rounded-md border border-brand-100 p-4">
          <p className="text-sm text-brand-700">
            Grafias parecidas foram agrupadas automaticamente. Edite o nome do cargo se quiser antes de confirmar.
          </p>
          {suggestions.map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <input
                value={s.suggested_name}
                onChange={(e) => updateSuggestionName(i, e.target.value)}
                className="flex-1 rounded-md border border-brand-100 px-3 py-2 text-sm"
              />
              <span className="text-xs text-brand-700">{s.employee_count} funcionário(s)</span>
            </div>
          ))}
          <button
            type="button"
            onClick={handleConfirmLinks}
            className="self-start rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Confirmar vínculos
          </button>
        </div>
      )}

      <form onSubmit={handleCreatePosition} className="flex items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm text-brand-900">
          Novo cargo
          <input
            value={newPositionName}
            onChange={(e) => setNewPositionName(e.target.value)}
            className="rounded-md border border-brand-100 px-3 py-2"
            required
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Criar
        </button>
      </form>
      {createError && <p className="text-sm text-red-600">{createError}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-brand-700">
            <th className="px-2 py-1">Cargo</th>
            <th className="px-2 py-1">Funcionários</th>
            <th className="px-2 py-1">Requisitos</th>
            <th className="px-2 py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.id} className="cursor-pointer hover:bg-brand-50" onClick={() => openDetail(p.id)}>
              <td className="px-2 py-1 font-medium text-brand-900">{p.name}</td>
              <td className="px-2 py-1">{p.employee_count}</td>
              <td className="px-2 py-1">{p.epi_requirement_count + p.training_requirement_count}</td>
              <td className="px-2 py-1">
                {p.divergence_count > 0 ? (
                  <span className="text-red-600">{p.divergence_count} pendência(s)</span>
                ) : (
                  <span className="text-green-700">Em dia</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <div className="flex flex-col gap-4 rounded-md border border-brand-100 p-4">
          <h2 className="text-lg font-bold text-brand-900">{detail.name}</h2>

          <div>
            <h3 className="text-sm font-medium text-brand-900">EPI exigido</h3>
            {Object.entries(catalogByCategory).map(([category, items]) => (
              <div key={category} className="mt-2">
                <p className="text-xs font-medium text-brand-700">Categoria {category}</p>
                {items.map((item) => (
                  <label key={item.id} className="flex items-center gap-2 text-sm text-brand-900">
                    <input
                      type="checkbox"
                      checked={epiSelection.has(item.id)}
                      onChange={() => toggleEpi(item.id)}
                    />
                    {item.description}
                  </label>
                ))}
              </div>
            ))}
            <button
              type="button"
              onClick={saveEpiRequirements}
              className="mt-2 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Salvar EPI exigido
            </button>
          </div>

          <div>
            <h3 className="text-sm font-medium text-brand-900">Treinamento exigido</h3>
            {TRAINING_TYPES.map((tipo) => (
              <label key={tipo} className="flex items-center gap-2 text-sm text-brand-900">
                <input type="checkbox" checked={trainingSelection.has(tipo)} onChange={() => toggleTraining(tipo)} />
                {TRAINING_TYPE_LABEL[tipo]}
              </label>
            ))}
            <button
              type="button"
              onClick={saveTrainingRequirements}
              className="mt-2 rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Salvar treinamento exigido
            </button>
          </div>

          <div>
            <h3 className="text-sm font-medium text-brand-900">Funcionários</h3>
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left">Nome</th>
                  <th className="px-2 py-1 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {detail.employees.map((employee) => (
                  <tr key={employee.id}>
                    <td className="px-2 py-1 text-brand-900">{employee.full_name}</td>
                    <td className="px-2 py-1">
                      {employee.divergences.length === 0 ? (
                        <span className="text-green-700">✓ Em dia</span>
                      ) : (
                        employee.divergences.map((d, i) => (
                          <div key={i} className="text-red-600">
                            ⚠{' '}
                            {d.categoria === 'epi'
                              ? `${d.empresa_tem_no_catalogo ? 'EPI não entregue' : 'EPI não cadastrado no catálogo'}: ${d.requisito}`
                              : `Treinamento pendente/vencido: ${TRAINING_TYPE_LABEL[d.requisito] ?? d.requisito}`}
                          </div>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Deploy e confirmação do bundle real**

```bash
docker compose build frontend
docker compose up -d frontend
```

Confirmar via grep dentro do container que o bundle novo está de pé antes de qualquer teste Playwright (mesma disciplina de todas as fases anteriores — um `docker compose build` sozinho não garante que o container rodando já serve o código novo):

```bash
docker compose exec frontend sh -c "grep -rl 'Mapa SST' .next/server/app 2>/dev/null || grep -rl 'mapa-sst' .next/static/chunks 2>/dev/null"
```

Expected: pelo menos um arquivo encontrado.

- [ ] **Step 4: Verificação manual via Playwright**

Escrever um script Playwright (`node`, fora do repo — scratchpad) que:
1. Abre `https://montesesst.com.br/empresa/mapa-sst` com uma sessão sintética (`page.addInitScript` setando `montese_token` no `localStorage`).
2. Mocka `GET /api/positions` (lista com 1 cargo, `divergence_count: 1`), `GET /api/positions/link-suggestions` (vazio), `GET /api/epi-catalog-items` (2-3 itens de exemplo).
3. Confirma que a tabela de cargos renderiza a linha e o texto "1 pendência(s)".
4. Clica na linha, mocka `GET /api/positions/:id` (1 funcionário com 1 divergência de EPI, `empresa_tem_no_catalogo: false`), confirma que o texto "EPI não cadastrado no catálogo" aparece.
5. Marca um checkbox de EPI, clica "Salvar EPI exigido", mocka `PUT /api/positions/:id/epi-requirements` (200) e confirma que a chamada de rede foi feita com o `epi_catalog_item_id` certo no corpo (inspeciona o `request().postData()` do `page.route`).
6. Repete um teste equivalente pro banner de vínculo pendente: mocka `GET /api/positions/link-suggestions` com 1 grupo, confirma que o banner aparece, clica "Revisar", edita o nome sugerido, clica "Confirmar vínculos", confirma que `POST /api/positions/confirm-links` foi chamado com o nome editado (não o original).

Run: script Playwright real contra a URL de produção.
Expected: todas as asserções passam; nenhuma chamada de rede real além das mockadas.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/empresa/mapa-sst frontend/src/components/MapaSstPanel.tsx
git commit -m "feat: página Mapa SST (cargo, requisitos e divergência)"
```

---

## Nota final pro controlador da SDD

Esta é a Fase 23 — spec única cobrindo as 3 sub-partes que o fundador pediu pra desenhar juntas (grafo/entidade de cargo, requisitos, divergência), mas a implementação acima já está fatiada em 5 tasks incrementais e independentemente testáveis, seguindo a Task Right-Sizing da própria skill. Nenhuma delas precisa ser um plano separado — a decomposição em tasks já resolve o tamanho.
