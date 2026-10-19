# EPI — Cadastro e Movimentações (Subsistema 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar, no backend, o livro de movimentações de EPI (estoque auditável por entrada, entrega, devolução, troca, baixa, ajuste e estorno), o cadastro ampliado de EPI e a migration correspondente.

**Architecture:** Livro `epi_movements` imutável (trigger) + saldo materializado em `tenant_epis.stock_balance`/`epi_lots.balance`, atualizado na mesma transação com `SELECT ... FOR UPDATE` no EPI (serializa concorrência). Idempotência por `idempotency_key` único por empresa. Estorno é uma movimentação oposta que referencia a original.

**Tech Stack:** NestJS, TypeScript, PostgreSQL (`pg`, RLS + FORCE RLS), class-validator, Jest + supertest (e2e).

**Spec:** `docs/superpowers/specs/2026-10-14-epi-cadastro-movimentacoes-design.md`

## Global Constraints

- Sem `git commit`, `push`, `reset` ou alteração de histórico: **os passos "Commit" abaixo são pontos de entrega para o proprietário; o executor NÃO comita**. Ele lista os arquivos e espera a decisão do dono.
- Trabalhar num **worktree isolado** (a pasta principal tem 131 alterações não commitadas de outras sessões). Não alterar Docker, Nginx, banco de produção, Redis, TLS, DNS, backups ou secrets.
- **Nunca** ler/imprimir `.env`, chaves ou certificados. **Nunca** `docker compose down -v`. **Nunca** usar `run-backend-tests.sh` (carrega o `.env` de produção) nem rodar e2e contra produção: os e2e deste plano rodam só em **ensaio descartável** (Postgres+Redis próprios, senhas aleatórias, chaves falsas; ver memória `reference_ensaio_descartavel_isolado` e `reference_running_tests_in_throwaway_container`).
- Isolamento entre empresas é crítico: toda tabela nova com `ENABLE` + `FORCE ROW LEVEL SECURITY` e a policy padrão do módulo; `tenant_id` nunca vem do corpo da requisição.
- Migration **aditiva**, nenhuma destruição de dados. Numeração: **0081** (0079 em produção; 0080 na branch `feat/tabela-oficial-funcionarios`). Reconfirmar o próximo número livre antes de entregar.
- Papéis existentes (enum `user_role`): `empresa`, `tecnico`, `parceiro`, `admin`. Não existe "dono da conta" separado: **"dono" = papel `empresa`** (mais `admin`).
- Aviso de vencimento padrão: 30 dias (RECOMENDADO, não é prazo normativo). Não inventar norma, artigo ou prazo.
- Não incluir CPF em logs, mensagens de erro ou respostas desnecessárias.
- Rotular o que for afirmado: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO. Só afirmar que algo funciona com comando + resultado.

## Decisões deste plano que diferem ou detalham a spec (revisar)

1. **Rota legada `POST /epis/:id/deliveries` fica inalterada** (sem efeito no estoque, `signature_status='legado'`). Motivo: `frontend/src/components/EpisPanel.tsx:182` a chama; redirecioná-la para o estoque quebraria a tela em produção para EPIs sem saldo. O novo fluxo com estoque é `POST /epis/:id/movements` (tipos `entrega`/`troca`). A rota legada será aposentada quando o frontend migrar (subsistema 4). **Risco aceito:** até lá existem duas formas de registrar entrega e a legada não baixa estoque.
2. **`employee_epi_deliveries.movement_id` não é criado**: o vínculo é `epi_movements.delivery_id` (evita FK circular).
3. **Troca = saída do EPI novo (`troca`, −1)**; a devolução do item antigo é uma movimentação `devolucao` separada com o mesmo motivo.
4. **CA vencido bloqueia `entrega`/`troca`** (RECOMENDADO); lote vencido também. Sem override nesta fase.
5. **`GET /epis` não muda de formato** (array). A listagem paginada com filtros é nova: `GET /epis/search`.
6. `getDivergences` (`positions.service.ts`) passa a ignorar entregas `estornada`.

## File Structure

- Create `backend/db/migrations/0081_epi_stock_ledger.sql` — schema, trigger, RLS.
- Create `backend/src/epi/epi-stock.service.ts` — motor de estoque (única porta de escrita do saldo).
- Create `backend/src/epi/epi-stock.types.ts` — tipos e constantes de movimentação.
- Create `backend/src/epi/dto/create-epi-movement.dto.ts`, `create-epi-adjustment.dto.ts`, `reverse-epi-movement.dto.ts`, `update-epi.dto.ts`, `search-epis.query.ts`.
- Modify `backend/src/epi/epi.service.ts` — campos novos, `update`, `search`, `listLots`.
- Modify `backend/src/epi/epis.controller.ts` — novas rotas.
- Modify `backend/src/epi/dto/create-epi.dto.ts` — campos novos opcionais.
- Modify `backend/src/epi/epi.module.ts` — registrar `EpiStockService`.
- Modify `backend/src/positions/positions.service.ts:231` — ignorar estornadas.
- Create tests em `backend/test/`: `epi-ledger-schema.e2e-spec.ts`, `epi-stock-movements.e2e-spec.ts`, `epi-stock-concurrency.e2e-spec.ts`, `epi-stock-permissions.e2e-spec.ts`, `epi-search-update.e2e-spec.ts`.
- Create `docs/architecture/epi-estoque.md` e atualizar `docs/architecture/README.md`.

---

### Task 1: Worktree, ensaio e migration 0081

**Files:**
- Create: `backend/db/migrations/0081_epi_stock_ledger.sql`
- Test: `backend/test/epi-ledger-schema.e2e-spec.ts`

**Interfaces:**
- Produces: tabelas `epi_lots`, `epi_movements`; colunas novas em `tenant_epis`, `employee_epi_deliveries`, `tenants.epi_alert_days`; trigger `epi_movements_immutable`.

- [ ] **Step 1: Criar o worktree e subir o ensaio**

```bash
cd /opt/Montese
git worktree add /opt/montese-epi -b feat/epi-estoque main
```
Subir o ensaio descartável conforme a memória `reference_ensaio_descartavel_isolado` (Postgres+Redis próprios, `TEST_SUPERUSER_DATABASE_URL` e `DATABASE_URL` apontando para ele, nunca para produção). Aplicar as migrations existentes no ensaio com `npx ts-node db/migrate.ts` **no worktree, contra o ensaio**. Observação: a branch base `main` está 20+ commits atrás da produção; se faltar migration que `employees`/`tenants` exigem, basear em `release/documentos-esocial-20261013` (decisão do dono, ver Task 5).

Expected: `[ok]` para todas as migrations existentes.

- [ ] **Step 2: Escrever o teste de schema (falha: tabelas inexistentes)**

`backend/test/epi-ledger-schema.e2e-spec.ts`:

```ts
import { Client } from 'pg';
import { TestDb } from './db-test-helper';

describe('Schema do livro de EPI (0081)', () => {
  let db: TestDb;
  let sql: Client;
  let tenantId: string;
  let userId: string;
  let epiId: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();
    const t = await db.createTenantWithUser('Empresa Epi Schema');
    tenantId = t.tenantId;
    userId = t.userId;
    const cat = await sql.query('SELECT id FROM epi_catalog_items LIMIT 1');
    const epi = await sql.query(
      `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, created_by_user_id)
       VALUES ($1, $2, 'CA-SCHEMA-1', $3) RETURNING id`,
      [tenantId, cat.rows[0].id, userId],
    );
    epiId = epi.rows[0].id;
  });

  afterAll(async () => {
    await db.cleanup(); // DELETE de tenant em CASCADE precisa passar pelo trigger
    await sql.end();
    await db.disconnect();
  });

  const insertMovement = (over: Record<string, unknown> = {}) =>
    sql.query(
      `INSERT INTO epi_movements (tenant_id, tenant_epi_id, type, direction, quantity, balance_after,
                                  supplier, reason, idempotency_key, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'Fornecedor X', 'teste', $7, $8) RETURNING id`,
      [
        tenantId, epiId, over.type ?? 'entrada', over.direction ?? 1, over.quantity ?? 5,
        over.balance_after ?? 5, over.key ?? `k-${Math.random()}`, userId,
      ],
    );

  it('rejeita quantidade <= 0 e saldo negativo no EPI', async () => {
    await expect(insertMovement({ quantity: 0 })).rejects.toThrow();
    await expect(sql.query('UPDATE tenant_epis SET stock_balance = -1 WHERE id = $1', [epiId])).rejects.toThrow();
  });

  it('bloqueia UPDATE e DELETE direto em epi_movements', async () => {
    const { rows } = await insertMovement();
    await expect(sql.query('UPDATE epi_movements SET quantity = 9 WHERE id = $1', [rows[0].id])).rejects.toThrow(
      /imut/i,
    );
    await expect(sql.query('DELETE FROM epi_movements WHERE id = $1', [rows[0].id])).rejects.toThrow(/imut/i);
  });

  it('impede a mesma idempotency_key duas vezes na mesma empresa', async () => {
    await insertMovement({ key: 'chave-unica-1' });
    await expect(insertMovement({ key: 'chave-unica-1' })).rejects.toThrow(/duplicate|unique/i);
  });

  it('exige reason em baixa e ajuste', async () => {
    await expect(
      sql.query(
        `INSERT INTO epi_movements (tenant_id, tenant_epi_id, type, direction, quantity, balance_after,
                                    idempotency_key, created_by_user_id)
         VALUES ($1, $2, 'baixa', -1, 1, 0, 'k-baixa-sem-motivo', $3)`,
        [tenantId, epiId, userId],
      ),
    ).rejects.toThrow();
  });

  it('impede duas unicidades iguais de EPI (catálogo+CA+fabricante+modelo) na mesma empresa', async () => {
    const cat = await sql.query('SELECT epi_catalog_item_id AS id FROM tenant_epis WHERE id = $1', [epiId]);
    await expect(
      sql.query(
        `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, created_by_user_id)
         VALUES ($1, $2, 'CA-SCHEMA-1', $3)`,
        [tenantId, cat.rows[0].id, userId],
      ),
    ).rejects.toThrow(/duplicate|unique/i);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run (no ensaio): `cd backend && npx jest --config ./test/jest-e2e.json --runInBand epi-ledger-schema`
Expected: FAIL (`relation "epi_movements" does not exist`).

- [ ] **Step 4: Escrever a migration**

`backend/db/migrations/0081_epi_stock_ledger.sql`:

```sql
-- Módulo EPI, subsistema 1: livro de movimentações e estoque.
-- Aditiva: nenhuma coluna ou linha existente é removida. Ver
-- docs/superpowers/specs/2026-10-14-epi-cadastro-movimentacoes-design.md.
--
-- ATENÇÃO (antes de aplicar em produção): o índice único uq_tenant_epis_identity
-- falha se já houver EPIs duplicados (mesma empresa, catálogo, CA, fabricante, modelo).
-- Consulta de conferência (somente leitura), a rodar pelo proprietário:
--   SELECT tenant_id, epi_catalog_item_id, ca_number, count(*) FROM tenant_epis
--   GROUP BY 1,2,3 HAVING count(*) > 1;
-- A migration é transacional: se falhar, nada é aplicado.

ALTER TABLE tenants
  ADD COLUMN epi_alert_days INT NOT NULL DEFAULT 30 CHECK (epi_alert_days BETWEEN 1 AND 365);

ALTER TABLE tenant_epis
  ADD COLUMN manufacturer TEXT,
  ADD COLUMN model TEXT,
  ADD COLUMN unit TEXT NOT NULL DEFAULT 'un',
  ADD COLUMN min_stock INT CHECK (min_stock >= 0),
  ADD COLUMN max_stock INT CHECK (max_stock >= 0),
  ADD COLUMN unit_cost NUMERIC(12, 2) CHECK (unit_cost >= 0),
  ADD COLUMN controls_lot BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN replacement_days INT CHECK (replacement_days > 0),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  ADD COLUMN stock_balance INT NOT NULL DEFAULT 0 CHECK (stock_balance >= 0),
  ADD COLUMN updated_by_user_id UUID REFERENCES users(id),
  ADD CONSTRAINT chk_tenant_epis_stock_range CHECK (max_stock IS NULL OR min_stock IS NULL OR max_stock >= min_stock);

CREATE UNIQUE INDEX uq_tenant_epis_identity
  ON tenant_epis (tenant_id, epi_catalog_item_id, ca_number, COALESCE(manufacturer, ''), COALESCE(model, ''));

CREATE TABLE epi_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_epi_id UUID NOT NULL REFERENCES tenant_epis(id) ON DELETE RESTRICT,
  lot_code TEXT NOT NULL,
  valid_until DATE,
  balance INT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_epi_id, lot_code)
);
CREATE INDEX idx_epi_lots_tenant ON epi_lots (tenant_id);

CREATE TABLE epi_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_epi_id UUID NOT NULL REFERENCES tenant_epis(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('abertura', 'entrada', 'entrega', 'devolucao', 'troca', 'baixa', 'ajuste', 'estorno')),
  direction SMALLINT NOT NULL CHECK (direction IN (-1, 1)),
  quantity INT NOT NULL CHECK (quantity > 0),
  balance_after INT NOT NULL CHECK (balance_after >= 0),
  employee_id UUID REFERENCES employees(id) ON DELETE RESTRICT,
  supplier TEXT,
  lot_id UUID REFERENCES epi_lots(id) ON DELETE RESTRICT,
  reason TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_id UUID REFERENCES employee_epi_deliveries(id) ON DELETE RESTRICT,
  reverses_movement_id UUID REFERENCES epi_movements(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_epi_mov_employee CHECK (type NOT IN ('entrega', 'troca', 'devolucao') OR employee_id IS NOT NULL),
  CONSTRAINT chk_epi_mov_reason CHECK (type NOT IN ('baixa', 'ajuste', 'estorno') OR length(btrim(coalesce(reason, ''))) > 0),
  CONSTRAINT chk_epi_mov_reverses CHECK ((type = 'estorno') = (reverses_movement_id IS NOT NULL)),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE UNIQUE INDEX uq_epi_movements_reverses ON epi_movements (reverses_movement_id) WHERE reverses_movement_id IS NOT NULL;
CREATE INDEX idx_epi_movements_epi ON epi_movements (tenant_epi_id, occurred_at DESC);
CREATE INDEX idx_epi_movements_tenant ON epi_movements (tenant_id, occurred_at DESC);
CREATE INDEX idx_epi_movements_employee ON epi_movements (employee_id) WHERE employee_id IS NOT NULL;

-- Imutabilidade: UPDATE nunca; DELETE direto nunca. A exclusão em cascata de um
-- tenant inteiro (FK ON DELETE CASCADE) roda dentro do trigger de RI
-- (pg_trigger_depth() > 1) e continua permitida.
CREATE FUNCTION epi_movements_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'epi_movements é imutável (use estorno)' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_epi_movements_immutable
  BEFORE UPDATE OR DELETE ON epi_movements
  FOR EACH ROW EXECUTE FUNCTION epi_movements_immutable();

ALTER TABLE employee_epi_deliveries
  ALTER COLUMN signed_by_name DROP NOT NULL,
  ALTER COLUMN signed_at DROP NOT NULL,
  ADD COLUMN quantity INT CHECK (quantity > 0),
  ADD COLUMN signature_status TEXT NOT NULL DEFAULT 'legado'
    CHECK (signature_status IN ('legado', 'pendente', 'assinada', 'recusada', 'expirada', 'presencial', 'estornada'));

ALTER TABLE epi_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE epi_lots FORCE ROW LEVEL SECURITY;
CREATE POLICY epi_lots_isolation ON epi_lots USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE epi_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE epi_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY epi_movements_isolation ON epi_movements USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
```

- [ ] **Step 5: Aplicar no ensaio e rodar o teste**

Run: `cd backend && npx ts-node db/migrate.ts` (ensaio) e depois `npx jest --config ./test/jest-e2e.json --runInBand epi-ledger-schema`
Expected: `[ok] 0081_epi_stock_ledger.sql`; 5 testes PASS. Se `pg_trigger_depth() > 1` não permitir o cascade (o `db.cleanup()` falhar com "imutável"), investigar e ajustar a condição do trigger antes de seguir (NÃO afrouxar o DELETE direto).

- [ ] **Step 6: Rodar os testes de EPI existentes (regressão da migration)**

Run: `npx jest --config ./test/jest-e2e.json --runInBand epis-crud epi-deliveries epi-catalog-rls`
Expected: PASS (a migration é aditiva).

- [ ] **Step 7: Entrega**

Listar `git status` do worktree e parar; o proprietário decide o commit.

---

### Task 2: Motor de estoque + entrada, abertura e baixa

**Files:**
- Create: `backend/src/epi/epi-stock.types.ts`
- Create: `backend/src/epi/epi-stock.service.ts`
- Create: `backend/src/epi/dto/create-epi-movement.dto.ts`
- Modify: `backend/src/epi/epi.module.ts`
- Modify: `backend/src/epi/epis.controller.ts`
- Test: `backend/test/epi-stock-movements.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `EpiStockService.applyMovement(client: PoolClient, input: ApplyMovementInput): Promise<ApplyResult>`
  - `EpiStockService.registerMovement(client: PoolClient, tenantEpiId: string, dto: CreateEpiMovementDto, userId: string): Promise<ApplyResult>`
  - `EpiStockService.listMovements(client, filters): Promise<{ items: EpiMovement[]; total: number }>`
  - Rotas `POST /epis/:id/movements` (201 novo, 200 se repetição idempotente) e `GET /epis/movements`.

- [ ] **Step 1: Tipos**

`backend/src/epi/epi-stock.types.ts`:

```ts
export const MOVEMENT_DIRECTION = {
  abertura: 1,
  entrada: 1,
  devolucao: 1,
  entrega: -1,
  troca: -1,
  baixa: -1,
} as const;

export type LedgerMovementType = keyof typeof MOVEMENT_DIRECTION;
export type StockMovementType = LedgerMovementType | 'ajuste' | 'estorno';

export interface EpiMovement {
  id: string;
  tenant_id: string;
  tenant_epi_id: string;
  type: StockMovementType;
  direction: 1 | -1;
  quantity: number;
  balance_after: number;
  employee_id: string | null;
  supplier: string | null;
  lot_id: string | null;
  reason: string | null;
  occurred_at: string;
  delivery_id: string | null;
  reverses_movement_id: string | null;
  idempotency_key: string;
  created_by_user_id: string;
  created_at: string;
}

export interface ApplyMovementInput {
  tenantEpiId: string;
  type: StockMovementType;
  direction?: 1 | -1; // obrigatório só em ajuste/estorno
  quantity: number;
  employeeId?: string;
  supplier?: string;
  lotId?: string;
  lotCode?: string;
  lotValidUntil?: string;
  reason?: string;
  occurredAt?: string;
  reversesMovementId?: string;
  deliveryId?: string;
  idempotencyKey: string;
  userId: string;
  // Chamado depois da checagem de repetição e das validações, antes do INSERT
  // do movimento: usado para criar a entrega vinculada sem duplicá-la numa repetição.
  beforeInsert?: (epi: { id: string; tenant_id: string }) => Promise<string | undefined>;
}

export interface ApplyResult {
  movement: EpiMovement;
  replayed: boolean;
}
```

- [ ] **Step 2: Escrever o teste e2e (falha)**

`backend/test/epi-stock-movements.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Movimentações de estoque de EPI (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sql: Client;
  let token: string;
  let epiId: string;
  let epiLotId: string;
  let tenantId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const mov = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/epis/${id}/movements`).set(auth()).send(body);
  const balance = async (id: string) =>
    (await sql.query('SELECT stock_balance FROM tenant_epis WHERE id = $1', [id])).rows[0].stock_balance;
  let seq = 0;
  const key = () => `teste-mov-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();
    const t = await db.createTenantWithUser('Empresa Epi Estoque');
    tenantId = t.tenantId;
    token = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: t.email, password: t.password })
    ).body.access_token;
    const cat = (await request(app.getHttpServer()).get('/epi-catalog-items').set(auth())).body;
    epiId = (
      await request(app.getHttpServer())
        .post('/epis')
        .set(auth())
        .send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-EST-1', manufacturer: 'Fab', model: 'M1' })
    ).body.id;
    epiLotId = (
      await request(app.getHttpServer())
        .post('/epis')
        .set(auth())
        .send({ epi_catalog_item_id: cat[1].id, ca_number: 'CA-EST-2', controls_lot: true })
    ).body.id;
  });

  afterAll(async () => {
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  it('abertura define o saldo inicial e só pode existir uma por EPI', async () => {
    const r = await mov(epiId, { type: 'abertura', quantity: 10, idempotency_key: key() });
    expect(r.status).toBe(201);
    expect(r.body.balance_after).toBe(10);
    expect(await balance(epiId)).toBe(10);
    const again = await mov(epiId, { type: 'abertura', quantity: 5, idempotency_key: key() });
    expect(again.status).toBe(409);
    expect(await balance(epiId)).toBe(10);
  });

  it('entrada soma ao saldo e baixa subtrai, ambas com histórico', async () => {
    await mov(epiId, { type: 'entrada', quantity: 100, supplier: 'Fornecedor A', idempotency_key: key() });
    expect(await balance(epiId)).toBe(110);
    const b = await mov(epiId, { type: 'baixa', quantity: 3, reason: 'Item danificado', idempotency_key: key() });
    expect(b.status).toBe(201);
    expect(await balance(epiId)).toBe(107);
    const list = await request(app.getHttpServer()).get(`/epis/movements?tenant_epi_id=${epiId}`).set(auth());
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(3);
  });

  it('rejeita saída maior que o saldo, sem alterar nada', async () => {
    const r = await mov(epiId, { type: 'baixa', quantity: 999, reason: 'Teste', idempotency_key: key() });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/insuficiente/i);
    expect(await balance(epiId)).toBe(107);
  });

  it('repetir a mesma idempotency_key devolve a mesma movimentação sem mexer no saldo', async () => {
    const k = key();
    const first = await mov(epiId, { type: 'entrada', quantity: 1, supplier: 'F', idempotency_key: k });
    const second = await mov(epiId, { type: 'entrada', quantity: 1, supplier: 'F', idempotency_key: k });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await balance(epiId)).toBe(108);
    const conflict = await mov(epiId, { type: 'entrada', quantity: 7, supplier: 'F', idempotency_key: k });
    expect(conflict.status).toBe(409);
  });

  it('exige motivo em baixa e fornecedor/origem em entrada', async () => {
    expect((await mov(epiId, { type: 'baixa', quantity: 1, idempotency_key: key() })).status).toBe(400);
    expect((await mov(epiId, { type: 'entrada', quantity: 1, idempotency_key: key() })).status).toBe(400);
  });

  it('EPI com controle de lote exige lote e mantém saldo por lote', async () => {
    const semLote = await mov(epiLotId, { type: 'entrada', quantity: 5, supplier: 'F', idempotency_key: key() });
    expect(semLote.status).toBe(400);
    const ok = await mov(epiLotId, {
      type: 'entrada', quantity: 5, supplier: 'F', lot_code: 'L-001', lot_valid_until: '2099-12-31',
      idempotency_key: key(),
    });
    expect(ok.status).toBe(201);
    expect(ok.body.lot_id).toBeTruthy();
    const lot = await sql.query('SELECT balance FROM epi_lots WHERE id = $1', [ok.body.lot_id]);
    expect(lot.rows[0].balance).toBe(5);
    const saida = await mov(epiLotId, {
      type: 'baixa', quantity: 9, reason: 'Teste', lot_id: ok.body.lot_id, idempotency_key: key(),
    });
    expect(saida.status).toBe(409);
  });

  it('o saldo materializado sempre bate com a soma das movimentações', async () => {
    const r = await sql.query(
      `SELECT te.id, te.stock_balance, COALESCE(SUM(m.direction * m.quantity), 0)::int AS soma
       FROM tenant_epis te LEFT JOIN epi_movements m ON m.tenant_epi_id = te.id
       WHERE te.tenant_id = $1 GROUP BY te.id, te.stock_balance`,
      [tenantId],
    );
    for (const row of r.rows) expect(row.stock_balance).toBe(row.soma);
  });
});
```

(`POST /epis` com `manufacturer`/`model`/`controls_lot` exige a Task 4 parcial: nesta task, **ampliar `CreateEpiDto`/`EpiService.create` com os campos novos opcionais** — ver Step 5.)

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest --config ./test/jest-e2e.json --runInBand epi-stock-movements`
Expected: FAIL (rota inexistente / campos rejeitados por `forbidNonWhitelisted`).

- [ ] **Step 4: DTO de movimentação**

`backend/src/epi/dto/create-epi-movement.dto.ts`:

```ts
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export const REGISTERABLE_TYPES = ['abertura', 'entrada', 'entrega', 'devolucao', 'troca', 'baixa'] as const;

export class CreateEpiMovementDto {
  @IsIn(REGISTERABLE_TYPES)
  type: (typeof REGISTERABLE_TYPES)[number];

  @IsInt()
  @Min(1)
  @Max(100000)
  quantity: number;

  @IsOptional()
  @IsUUID()
  employee_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplier?: string;

  @IsOptional()
  @IsUUID()
  lot_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  lot_code?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  lot_valid_until?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsISO8601()
  occurred_at?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotency_key: string;
}
```

- [ ] **Step 5: Motor de estoque**

`backend/src/epi/epi-stock.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { mapPgError } from '../common/pg-error.util';
import { CreateEpiMovementDto } from './dto/create-epi-movement.dto';
import {
  ApplyMovementInput,
  ApplyResult,
  EpiMovement,
  MOVEMENT_DIRECTION,
  LedgerMovementType,
} from './epi-stock.types';

interface LockedEpi {
  id: string;
  tenant_id: string;
  controls_lot: boolean;
  status: string;
  stock_balance: number;
  ca_valid_until: string | null;
}

interface LotRow {
  id: string;
  valid_until: string | null;
  balance: number;
}

const today = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class EpiStockService {
  // ÚNICA porta de escrita do saldo. Tudo roda na transação do chamador
  // (req.withTenantContext); qualquer exceção desfaz a movimentação inteira.
  async applyMovement(client: PoolClient, input: ApplyMovementInput): Promise<ApplyResult> {
    // 1) Trava o EPI: serializa entregas concorrentes do mesmo item.
    const epiRes = await client.query<LockedEpi>(
      `SELECT id, tenant_id, controls_lot, status, stock_balance, ca_valid_until
       FROM tenant_epis WHERE id = $1 FOR UPDATE`,
      [input.tenantEpiId],
    );
    const epi = epiRes.rows[0];
    if (!epi) throw new NotFoundException('EPI não encontrado');

    // 2) Repetição idempotente (depois da trava, para duas requisições iguais em paralelo).
    const prev = await client.query<EpiMovement>(
      'SELECT * FROM epi_movements WHERE tenant_id = $1 AND idempotency_key = $2',
      [epi.tenant_id, input.idempotencyKey],
    );
    if (prev.rows[0]) {
      const p = prev.rows[0];
      if (p.tenant_epi_id !== epi.id || p.type !== input.type || p.quantity !== input.quantity) {
        throw new ConflictException('Chave de idempotência já usada em outra operação');
      }
      return { movement: p, replayed: true };
    }

    const direction = this.resolveDirection(input);
    this.validateBusinessRules(input, epi, direction);

    if (input.reversesMovementId) {
      const done = await client.query('SELECT 1 FROM epi_movements WHERE reverses_movement_id = $1', [
        input.reversesMovementId,
      ]);
      if (done.rowCount) throw new ConflictException('Movimentação já estornada');
    }

    if (input.employeeId) {
      const emp = await client.query('SELECT 1 FROM employees WHERE id = $1 AND tenant_id = $2', [
        input.employeeId,
        epi.tenant_id,
      ]);
      if (!emp.rowCount) throw new NotFoundException('Funcionário não encontrado');
    }

    if (input.type === 'abertura') {
      const hasAny = await client.query(
        `SELECT 1 FROM epi_movements WHERE tenant_epi_id = $1
           AND lot_id IS NOT DISTINCT FROM $2::uuid LIMIT 1`,
        [epi.id, input.lotId ?? null],
      );
      // Para EPI com lote o lote ainda pode ser novo; só bloqueia se já houver histórico.
      if (hasAny.rowCount && !epi.controls_lot) {
        throw new ConflictException('Já existe movimentação para este EPI; use entrada ou ajuste');
      }
    }

    const lot = await this.resolveLot(client, epi, input, direction);

    if ((input.type === 'entrega' || input.type === 'troca') && epi.ca_valid_until && epi.ca_valid_until < today()) {
      throw new ConflictException('CA vencido: não é possível entregar este EPI');
    }
    if ((input.type === 'entrega' || input.type === 'troca') && lot?.valid_until && lot.valid_until < today()) {
      throw new ConflictException('Lote vencido: não é possível entregar deste lote');
    }

    const newBalance = epi.stock_balance + direction * input.quantity;
    if (newBalance < 0) throw new ConflictException('Estoque insuficiente');
    if (lot && lot.balance + direction * input.quantity < 0) {
      throw new ConflictException('Estoque insuficiente no lote');
    }

    let deliveryId = input.deliveryId;
    if (input.beforeInsert) deliveryId = await input.beforeInsert({ id: epi.id, tenant_id: epi.tenant_id });

    try {
      const ins = await client.query<EpiMovement>(
        `INSERT INTO epi_movements
           (tenant_id, tenant_epi_id, type, direction, quantity, balance_after, employee_id, supplier,
            lot_id, reason, occurred_at, delivery_id, reverses_movement_id, idempotency_key, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11::timestamptz, now()),$12,$13,$14,$15)
         RETURNING *`,
        [
          epi.tenant_id, epi.id, input.type, direction, input.quantity, newBalance,
          input.employeeId ?? null, input.supplier ?? null, lot?.id ?? null, input.reason ?? null,
          input.occurredAt ?? null, deliveryId ?? null, input.reversesMovementId ?? null,
          input.idempotencyKey, input.userId,
        ],
      );
      await client.query('UPDATE tenant_epis SET stock_balance = $2, updated_by_user_id = $3 WHERE id = $1', [
        epi.id, newBalance, input.userId,
      ]);
      if (lot) {
        await client.query('UPDATE epi_lots SET balance = balance + $2 WHERE id = $1', [
          lot.id, direction * input.quantity,
        ]);
      }
      if (input.type === 'estorno' && deliveryId) {
        await client.query(`UPDATE employee_epi_deliveries SET signature_status = 'estornada' WHERE id = $1`, [
          deliveryId,
        ]);
      }
      return { movement: ins.rows[0], replayed: false };
    } catch (err) {
      mapPgError(err);
    }
  }

  // Valida o corpo da API, cria a entrega vinculada (entrega/troca) e aplica o movimento.
  async registerMovement(
    client: PoolClient,
    tenantEpiId: string,
    dto: CreateEpiMovementDto,
    userId: string,
  ): Promise<ApplyResult> {
    const input: ApplyMovementInput = {
      tenantEpiId,
      type: dto.type,
      quantity: dto.quantity,
      employeeId: dto.employee_id,
      supplier: dto.supplier,
      lotId: dto.lot_id,
      lotCode: dto.lot_code,
      lotValidUntil: dto.lot_valid_until,
      reason: dto.reason,
      occurredAt: dto.occurred_at,
      idempotencyKey: dto.idempotency_key,
      userId,
    };
    if (dto.type === 'entrega' || dto.type === 'troca') {
      input.beforeInsert = async (epi) => {
        const d = await client.query<{ id: string }>(
          `INSERT INTO employee_epi_deliveries
             (tenant_id, tenant_epi_id, employee_id, delivered_at, quantity, signature_status,
              signed_by_name, signed_at, created_by_user_id)
           VALUES ($1, $2, $3, COALESCE($4::timestamptz, now())::date, $5, 'pendente', NULL, NULL, $6)
           RETURNING id`,
          [epi.tenant_id, epi.id, dto.employee_id, dto.occurred_at ?? null, dto.quantity, userId],
        );
        return d.rows[0].id;
      };
    }
    return this.applyMovement(client, input);
  }

  async reverse(
    client: PoolClient,
    movementId: string,
    data: { reason: string; idempotencyKey: string; userId: string },
  ): Promise<ApplyResult> {
    const res = await client.query<EpiMovement>('SELECT * FROM epi_movements WHERE id = $1', [movementId]);
    const orig = res.rows[0];
    if (!orig) throw new NotFoundException('Movimentação não encontrada');
    if (orig.type === 'estorno') throw new ConflictException('Um estorno não pode ser estornado');
    return this.applyMovement(client, {
      tenantEpiId: orig.tenant_epi_id,
      type: 'estorno',
      direction: orig.direction === 1 ? -1 : 1,
      quantity: orig.quantity,
      employeeId: orig.employee_id ?? undefined,
      lotId: orig.lot_id ?? undefined,
      reason: data.reason,
      reversesMovementId: orig.id,
      deliveryId: orig.delivery_id ?? undefined,
      idempotencyKey: data.idempotencyKey,
      userId: data.userId,
    });
  }

  async listMovements(
    client: PoolClient,
    f: { tenantEpiId?: string; employeeId?: string; type?: string; from?: string; to?: string; page: number; pageSize: number },
  ): Promise<{ items: EpiMovement[]; total: number; page: number; page_size: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sqlFrag: string, v: unknown) => {
      params.push(v);
      where.push(sqlFrag.replace('?', `$${params.length}`));
    };
    if (f.tenantEpiId) add('tenant_epi_id = ?', f.tenantEpiId);
    if (f.employeeId) add('employee_id = ?', f.employeeId);
    if (f.type) add('type = ?', f.type);
    if (f.from) add('occurred_at >= ?', f.from);
    if (f.to) add('occurred_at <= ?', f.to);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await client.query<{ n: string }>(`SELECT count(*) AS n FROM epi_movements ${w}`, params);
    const items = await client.query<EpiMovement>(
      `SELECT * FROM epi_movements ${w} ORDER BY occurred_at DESC, created_at DESC
       LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
      params,
    );
    return { items: items.rows, total: Number(total.rows[0].n), page: f.page, page_size: f.pageSize };
  }

  private resolveDirection(input: ApplyMovementInput): 1 | -1 {
    if (input.type === 'ajuste' || input.type === 'estorno') {
      if (input.direction !== 1 && input.direction !== -1) throw new BadRequestException('Direção obrigatória');
      return input.direction;
    }
    return MOVEMENT_DIRECTION[input.type as LedgerMovementType];
  }

  private validateBusinessRules(input: ApplyMovementInput, epi: LockedEpi, direction: 1 | -1): void {
    const needsEmployee = ['entrega', 'troca', 'devolucao'].includes(input.type);
    if (needsEmployee && !input.employeeId) throw new BadRequestException('Funcionário é obrigatório');
    if ((input.type === 'entrada') && !input.supplier?.trim()) {
      throw new BadRequestException('Fornecedor/origem é obrigatório na entrada');
    }
    if (['baixa', 'ajuste', 'estorno'].includes(input.type) && !input.reason?.trim()) {
      throw new BadRequestException('Motivo é obrigatório');
    }
    if (epi.status !== 'ativo' && ['entrada', 'entrega', 'troca', 'abertura'].includes(input.type)) {
      throw new ConflictException('EPI inativo');
    }
    if (direction === 1 && input.type === 'entrega') throw new BadRequestException('Direção inválida');
  }

  // Resolve (ou cria, em entrada/abertura) o lote e o trava. Retorna null se o EPI não controla lote.
  private async resolveLot(
    client: PoolClient,
    epi: LockedEpi,
    input: ApplyMovementInput,
    direction: 1 | -1,
  ): Promise<LotRow | null> {
    if (!epi.controls_lot) {
      if (input.lotId || input.lotCode) throw new BadRequestException('Este EPI não controla lote');
      return null;
    }
    if (input.lotId) {
      const r = await client.query<LotRow>(
        'SELECT id, valid_until, balance FROM epi_lots WHERE id = $1 AND tenant_epi_id = $2 FOR UPDATE',
        [input.lotId, epi.id],
      );
      if (!r.rows[0]) throw new NotFoundException('Lote não encontrado');
      return r.rows[0];
    }
    if (direction === 1 && input.lotCode) {
      const found = await client.query<LotRow>(
        'SELECT id, valid_until, balance FROM epi_lots WHERE tenant_epi_id = $1 AND lot_code = $2 FOR UPDATE',
        [epi.id, input.lotCode],
      );
      if (found.rows[0]) {
        const cur = found.rows[0].valid_until;
        if (input.lotValidUntil && cur && cur !== input.lotValidUntil) {
          throw new ConflictException('Lote já existe com outra validade');
        }
        return found.rows[0];
      }
      const created = await client.query<LotRow>(
        `INSERT INTO epi_lots (tenant_id, tenant_epi_id, lot_code, valid_until)
         VALUES ($1, $2, $3, $4) RETURNING id, valid_until, balance`,
        [epi.tenant_id, epi.id, input.lotCode, input.lotValidUntil ?? null],
      );
      return created.rows[0];
    }
    throw new BadRequestException('Informe o lote (lot_id ou lot_code) para este EPI');
  }
}
```

Observação: `valid_until` volta do `pg` como `Date` por padrão se o parser de DATE não estiver sobrescrito; no Step 7 conferir o tipo e, se vier `Date`, converter com `.toISOString().slice(0,10)` antes de comparar (ajustar `resolveLot`/`applyMovement`). Idem `ca_valid_until`.

- [ ] **Step 6: Campos novos em `CreateEpiDto` e `EpiService.create`**

Em `backend/src/epi/dto/create-epi.dto.ts` acrescentar (imports `IsBoolean, IsInt, IsNumber, Min, IsIn` do class-validator):

```ts
  @IsOptional() @IsString() @MaxLength(120) manufacturer?: string;
  @IsOptional() @IsString() @MaxLength(120) model?: string;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @IsOptional() @IsInt() @Min(0) min_stock?: number;
  @IsOptional() @IsInt() @Min(0) max_stock?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unit_cost?: number;
  @IsOptional() @IsBoolean() controls_lot?: boolean;
  @IsOptional() @IsInt() @Min(1) replacement_days?: number;
```

Em `epi.service.ts`: estender `CreateEpiData`, o `INSERT` (colunas `manufacturer, model, unit, min_stock, max_stock, unit_cost, controls_lot, replacement_days`, `unit` com `COALESCE($n,'un')`) e `EPI_SELECT` (`te.manufacturer, te.model, te.unit, te.min_stock, te.max_stock, te.unit_cost, te.controls_lot, te.replacement_days, te.status, te.stock_balance`), além da interface `Epi`. No controller `create`, repassar os campos. Estas colunas são todas aditivas: o formato antigo continua válido.

- [ ] **Step 7: Controller, módulo e permissões**

Em `epi.module.ts`: `providers: [EpiService, EpiStockService]`. Em `epis.controller.ts` injetar `EpiStockService` e acrescentar (declarar `movements` **antes** de rotas com `:id`):

```ts
  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @Get('movements')
  listMovements(@Query() q: Record<string, string>, @Req() req: any) {
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(q.page_size ?? '25', 10) || 25));
    return req.withTenantContext((client: any) =>
      this.stock.listMovements(client, {
        tenantEpiId: q.tenant_epi_id, employeeId: q.employee_id, type: q.type, from: q.from, to: q.to, page, pageSize,
      }),
    );
  }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/movements')
  async registerMovement(
    @Param('id') id: string,
    @Body() dto: CreateEpiMovementDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const role = req.user.role;
    if (dto.type === 'abertura' && role !== 'empresa' && role !== 'admin') {
      throw new ForbiddenException('Somente a empresa ou o administrador registra a abertura de estoque');
    }
    const result = await req.withTenantContext((client: any) =>
      this.stock.registerMovement(client, id, dto, req.user.id),
    );
    res.status(result.replayed ? 200 : 201);
    return result.movement;
  }
```
(importar `ForbiddenException`, `Res` de `@nestjs/common`; `Get('movements')` valida UUIDs de `tenant_epi_id`/`employee_id` com `ParseUUIDPipe` via checagem manual `isUUID` de class-validator → 400 se inválido.) O `AuditInterceptor` genérico já registra toda rota mutante (ator, papel, empresa, recurso, IP) — sem CPF.

- [ ] **Step 8: Rodar o teste**

Run: `npx jest --config ./test/jest-e2e.json --runInBand epi-stock-movements`
Expected: 7 testes PASS. Em seguida `npx tsc --noEmit -p tsconfig.json` limpo.

- [ ] **Step 9: Entrega** (listar arquivos; não comitar).

---

### Task 3: Entrega, devolução, troca, ajuste e estorno + concorrência + permissões

**Files:**
- Create: `backend/src/epi/dto/create-epi-adjustment.dto.ts`, `backend/src/epi/dto/reverse-epi-movement.dto.ts`
- Modify: `backend/src/epi/epis.controller.ts`, `backend/src/positions/positions.service.ts:231`
- Test: `backend/test/epi-stock-concurrency.e2e-spec.ts`, `backend/test/epi-stock-permissions.e2e-spec.ts`; ampliar `epi-stock-movements.e2e-spec.ts`

**Interfaces:**
- Consumes: `EpiStockService.applyMovement/registerMovement/reverse` (Task 2).
- Produces: `POST /epis/:id/adjustments`, `POST /epis/movements/:movementId/reversal`.

- [ ] **Step 1: Testes novos em `epi-stock-movements.e2e-spec.ts`** (acrescentar dentro do `describe`, usando `t.employeeId` guardado como `employeeId` em `beforeAll`):

```ts
  it('entrega cria a entrega pendente e baixa o saldo; estorno devolve ao estoque e marca a entrega', async () => {
    await mov(epiId, { type: 'entrada', quantity: 10, supplier: 'F', idempotency_key: key() });
    const before = await balance(epiId);
    const e = await mov(epiId, { type: 'entrega', quantity: 2, employee_id: employeeId, idempotency_key: key() });
    expect(e.status).toBe(201);
    expect(e.body.delivery_id).toBeTruthy();
    expect(await balance(epiId)).toBe(before - 2);
    const del = await sql.query('SELECT signature_status, quantity, signed_at FROM employee_epi_deliveries WHERE id = $1', [e.body.delivery_id]);
    expect(del.rows[0]).toMatchObject({ signature_status: 'pendente', quantity: 2, signed_at: null });

    const rev = await request(app.getHttpServer())
      .post(`/epis/movements/${e.body.id}/reversal`).set(auth())
      .send({ reason: 'Entrega cancelada', idempotency_key: key() });
    expect(rev.status).toBe(201);
    expect(rev.body.type).toBe('estorno');
    expect(rev.body.reverses_movement_id).toBe(e.body.id);
    expect(await balance(epiId)).toBe(before);
    const del2 = await sql.query('SELECT signature_status FROM employee_epi_deliveries WHERE id = $1', [e.body.delivery_id]);
    expect(del2.rows[0].signature_status).toBe('estornada');
    // a movimentação original continua no histórico, intacta
    const orig = await sql.query('SELECT quantity FROM epi_movements WHERE id = $1', [e.body.id]);
    expect(orig.rows[0].quantity).toBe(2);
  });

  it('não estorna duas vezes nem estorna um estorno', async () => {
    const e = await mov(epiId, { type: 'entrada', quantity: 3, supplier: 'F', idempotency_key: key() });
    const r1 = await request(app.getHttpServer()).post(`/epis/movements/${e.body.id}/reversal`).set(auth())
      .send({ reason: 'Erro de digitação', idempotency_key: key() });
    expect(r1.status).toBe(201);
    const r2 = await request(app.getHttpServer()).post(`/epis/movements/${e.body.id}/reversal`).set(auth())
      .send({ reason: 'De novo', idempotency_key: key() });
    expect(r2.status).toBe(409);
    const r3 = await request(app.getHttpServer()).post(`/epis/movements/${r1.body.id}/reversal`).set(auth())
      .send({ reason: 'Estornar estorno', idempotency_key: key() });
    expect(r3.status).toBe(409);
  });

  it('devolução soma ao saldo e exige funcionário; funcionário de outra empresa é recusado', async () => {
    const before = await balance(epiId);
    const d = await mov(epiId, { type: 'devolucao', quantity: 1, employee_id: employeeId, reason: 'Fim de uso', idempotency_key: key() });
    expect(d.status).toBe(201);
    expect(await balance(epiId)).toBe(before + 1);
    expect((await mov(epiId, { type: 'devolucao', quantity: 1, idempotency_key: key() })).status).toBe(400);
    const outro = await db.createTenantWithUser('Empresa Epi Estoque Outra');
    const bad = await mov(epiId, { type: 'entrega', quantity: 1, employee_id: outro.employeeId, idempotency_key: key() });
    expect(bad.status).toBe(404);
  });

  it('bloqueia entrega de EPI com CA vencido', async () => {
    const cat = (await request(app.getHttpServer()).get('/epi-catalog-items').set(auth())).body;
    const vencido = (await request(app.getHttpServer()).post('/epis').set(auth())
      .send({ epi_catalog_item_id: cat[2].id, ca_number: 'CA-VENC', ca_valid_until: '2020-01-01' })).body.id;
    await mov(vencido, { type: 'abertura', quantity: 5, idempotency_key: key() });
    const r = await mov(vencido, { type: 'entrega', quantity: 1, employee_id: employeeId, idempotency_key: key() });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/CA vencido/);
  });
```

- [ ] **Step 2: Rodar e ver falhar** — `npx jest ... epi-stock-movements` → falha em `/reversal` (404 de rota).

- [ ] **Step 3: DTOs de ajuste e estorno**

```ts
// create-epi-adjustment.dto.ts
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
export class CreateEpiAdjustmentDto {
  @IsIn(['mais', 'menos']) direction: 'mais' | 'menos';
  @IsInt() @Min(1) @Max(100000) quantity: number;
  @IsString() @MinLength(5) @MaxLength(500) reason: string;
  @IsOptional() @IsUUID() lot_id?: string;
  @IsString() @MinLength(8) @MaxLength(100) idempotency_key: string;
}
// reverse-epi-movement.dto.ts
import { IsString, MaxLength, MinLength } from 'class-validator';
export class ReverseEpiMovementDto {
  @IsString() @MinLength(5) @MaxLength(500) reason: string;
  @IsString() @MinLength(8) @MaxLength(100) idempotency_key: string;
}
```

- [ ] **Step 4: Rotas restritas** (`empresa` e `admin`; técnico e parceiro recebem 403 do `RolesGuard`)

```ts
  @Roles('empresa', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post(':id/adjustments')
  async adjust(@Param('id') id: string, @Body() dto: CreateEpiAdjustmentDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const result = await req.withTenantContext((client: any) =>
      this.stock.applyMovement(client, {
        tenantEpiId: id, type: 'ajuste', direction: dto.direction === 'mais' ? 1 : -1,
        quantity: dto.quantity, reason: dto.reason, lotId: dto.lot_id,
        idempotencyKey: dto.idempotency_key, userId: req.user.id,
      }),
    );
    res.status(result.replayed ? 200 : 201);
    return result.movement;
  }

  @Roles('empresa', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Post('movements/:movementId/reversal')
  async reverse(@Param('movementId') movementId: string, @Body() dto: ReverseEpiMovementDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const result = await req.withTenantContext((client: any) =>
      this.stock.reverse(client, movementId, { reason: dto.reason, idempotencyKey: dto.idempotency_key, userId: req.user.id }),
    );
    res.status(result.replayed ? 200 : 201);
    return result.movement;
  }
```
(`ParseUUIDPipe` em `:id` e `:movementId` para devolver 400 em vez de erro de cast do Postgres.)

- [ ] **Step 5: Ignorar entregas estornadas em divergências**

`backend/src/positions/positions.service.ts` (subconsulta em `getDivergences`): acrescentar `AND eed.signature_status <> 'estornada'` ao `WHERE eed.employee_id = e.id AND te.epi_catalog_item_id = eci.id`.

- [ ] **Step 6: Teste de concorrência**

`backend/test/epi-stock-concurrency.e2e-spec.ts` (mesmo `beforeAll`/`afterAll` do Task 2; um EPI com `abertura` de 5):

```ts
  it('10 entregas simultâneas de 1 unidade sobre saldo 5: exatamente 5 passam, 5 falham, saldo 0', async () => {
    await mov(epiId, { type: 'abertura', quantity: 5, idempotency_key: key() });
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        mov(epiId, { type: 'entrega', quantity: 1, employee_id: employeeId, idempotency_key: key() }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const conflito = results.filter((r) => r.status === 409).length;
    expect(ok).toBe(5);
    expect(conflito).toBe(5);
    expect(await balance(epiId)).toBe(0);
    const soma = await sql.query(
      'SELECT COALESCE(SUM(direction * quantity),0)::int AS s FROM epi_movements WHERE tenant_epi_id = $1', [epiId]);
    expect(soma.rows[0].s).toBe(0);
    const entregas = await sql.query('SELECT count(*)::int AS n FROM employee_epi_deliveries WHERE tenant_epi_id = $1', [epiId]);
    expect(entregas.rows[0].n).toBe(5); // as 5 rejeitadas não deixam entrega órfã
  });

  it('10 requisições idênticas em paralelo (mesma chave) geram 1 movimentação', async () => {
    const k = key();
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => mov(epiId, { type: 'entrada', quantity: 4, supplier: 'F', idempotency_key: k })),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(9);
    expect(await balance(epiId)).toBe(4);
  });
```

- [ ] **Step 7: Teste de permissões e isolamento**

`backend/test/epi-stock-permissions.e2e-spec.ts` (cria duas empresas A e B, um técnico via `db.createUserWithRole('tecnico', ...)` sem vínculo):

```ts
  it('técnico não faz ajuste, estorno nem abertura (403)', async () => {
    expect((await request(srv).post(`/epis/${epiA}/adjustments`).set(tec())
      .send({ direction: 'mais', quantity: 1, reason: 'Contagem', idempotency_key: 'perm-adj-0001' })).status).toBe(403);
    expect((await request(srv).post(`/epis/movements/${movA}/reversal`).set(tec())
      .send({ reason: 'Teste', idempotency_key: 'perm-rev-0001' })).status).toBe(403);
  });

  it('empresa B não vê nem movimenta o EPI da empresa A', async () => {
    const r = await request(srv).post(`/epis/${epiA}/movements`).set(authB())
      .send({ type: 'entrada', quantity: 1, supplier: 'F', idempotency_key: 'perm-iso-0001' });
    expect(r.status).toBe(404);
    const list = await request(srv).get(`/epis/movements?tenant_epi_id=${epiA}`).set(authB());
    expect(list.body.total).toBe(0);
    const rev = await request(srv).post(`/epis/movements/${movA}/reversal`).set(authB())
      .send({ reason: 'Tentativa', idempotency_key: 'perm-iso-0002' });
    expect(rev.status).toBe(404);
  });

  it('a mesma idempotency_key pode existir em empresas diferentes sem colidir', async () => {
    const a = await request(srv).post(`/epis/${epiA}/movements`).set(authA())
      .send({ type: 'entrada', quantity: 1, supplier: 'F', idempotency_key: 'chave-compartilhada-1' });
    const b = await request(srv).post(`/epis/${epiB}/movements`).set(authB())
      .send({ type: 'entrada', quantity: 1, supplier: 'F', idempotency_key: 'chave-compartilhada-1' });
    expect([a.status, b.status]).toEqual([201, 201]);
  });

  it('ajuste manual exige motivo e fica registrado com autor', async () => {
    const r = await request(srv).post(`/epis/${epiA}/adjustments`).set(authA())
      .send({ direction: 'menos', quantity: 1, reason: 'Contagem física', idempotency_key: 'perm-adj-0002' });
    expect(r.status).toBe(201);
    expect(r.body.created_by_user_id).toBe(userA);
    expect((await request(srv).post(`/epis/${epiA}/adjustments`).set(authA())
      .send({ direction: 'menos', quantity: 1, reason: '', idempotency_key: 'perm-adj-0003' })).status).toBe(400);
  });
```

- [ ] **Step 8: Rodar tudo do módulo**

Run: `npx jest --config ./test/jest-e2e.json --runInBand epi-stock epis-crud epi-deliveries epi-catalog-rls caepi positions` e `npx jest --config ./test/jest-unit.json epi-by-function tenant-context-callsites`
Expected: PASS. Se `tenant-context-callsites` reclamar de chamada nova, seguir o padrão que ele exige (nunca desabilitar o teste).

- [ ] **Step 9: Entrega** (listar arquivos; não comitar).

---

### Task 4: Cadastro ampliado — edição, busca, filtros, paginação e alertas

**Files:**
- Create: `backend/src/epi/dto/update-epi.dto.ts`
- Modify: `backend/src/epi/epi.service.ts`, `backend/src/epi/epis.controller.ts`
- Test: `backend/test/epi-search-update.e2e-spec.ts`

**Interfaces:**
- Produces: `PATCH /epis/:id`, `GET /epis/search`, `GET /epis/:id/lots`; `EpiService.update/search/listLots`.

- [ ] **Step 1: Teste (falha)** — `epi-search-update.e2e-spec.ts`:

```ts
  it('PATCH edita campos permitidos, ignora saldo e não permite mudar controls_lot com histórico', async () => {
    const r = await request(srv).patch(`/epis/${epiId}`).set(auth())
      .send({ manufacturer: 'Fabricante Novo', min_stock: 5, max_stock: 50, unit_cost: 12.5 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ manufacturer: 'Fabricante Novo', min_stock: 5, max_stock: 50 });
    expect((await request(srv).patch(`/epis/${epiId}`).set(auth()).send({ stock_balance: 999 })).status).toBe(400);
    await mov(epiId, { type: 'abertura', quantity: 10, idempotency_key: key() });
    expect((await request(srv).patch(`/epis/${epiId}`).set(auth()).send({ controls_lot: true })).status).toBe(409);
    expect((await request(srv).patch(`/epis/${epiId}`).set(auth()).send({ min_stock: 60, max_stock: 50 })).status).toBe(400);
  });

  it('duplicidade: mesmo catálogo+CA+fabricante+modelo na mesma empresa retorna 409', async () => {
    const body = { epi_catalog_item_id: catId, ca_number: 'CA-DUP', manufacturer: 'F', model: 'M' };
    expect((await request(srv).post('/epis').set(auth()).send(body)).status).toBe(201);
    expect((await request(srv).post('/epis').set(auth()).send(body)).status).toBe(409);
  });

  it('search pagina e filtra por faixa de estoque e por situação do CA', async () => {
    // fixtures: sem_estoque (saldo 0), abaixo (saldo 2, min 5), otimo (saldo 20, min 5, max 50), CA vencido
    const r = await request(srv).get('/epis/search?stock_band=abaixo&page=1&page_size=10').set(auth());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ page: 1, page_size: 10 });
    expect(r.body.items.every((i: any) => i.stock_band === 'abaixo')).toBe(true);
    const ca = await request(srv).get('/epis/search?ca_alert=vencido').set(auth());
    expect(ca.body.items.every((i: any) => i.ca_alert === 'vencido')).toBe(true);
    const q = await request(srv).get('/epis/search?q=CA-DUP').set(auth());
    expect(q.body.total).toBeGreaterThanOrEqual(1);
  });

  it('alerta de CA respeita epi_alert_days da empresa', async () => {
    await sql.query('UPDATE tenants SET epi_alert_days = 10 WHERE id = $1', [tenantId]);
    // CA vencendo em 5 dias => a_vencer; em 20 dias => ok
  });
```
(Completar o último teste com dois EPIs de `ca_valid_until` a +5 e +20 dias calculados em JS e asserções `ca_alert === 'a_vencer'` / `'ok'`.)

- [ ] **Step 2: Rodar e ver falhar** (`PATCH`/`search` inexistentes).

- [ ] **Step 3: `UpdateEpiDto`** — mesmos campos opcionais de `CreateEpiDto` (exceto `epi_catalog_item_id` e `tenant_id`) mais `status?: 'ativo' | 'inativo'` (`@IsIn`) e `ca_number`/`ca_valid_until`.

- [ ] **Step 4: `EpiService`**

```ts
const UPDATABLE = ['manufacturer','model','unit','min_stock','max_stock','unit_cost','controls_lot',
  'replacement_days','status','ca_number','ca_valid_until'] as const;

async update(client: PoolClient, id: string, dto: UpdateEpiDto, userId: string): Promise<Epi> {
  const current = await this.findOne(client, id);
  if (dto.controls_lot !== undefined && dto.controls_lot !== current.controls_lot) {
    const mv = await client.query('SELECT 1 FROM epi_movements WHERE tenant_epi_id = $1 LIMIT 1', [id]);
    if (mv.rowCount) throw new ConflictException('Não é possível alterar o controle de lote com movimentações registradas');
  }
  const min = dto.min_stock ?? current.min_stock;
  const max = dto.max_stock ?? current.max_stock;
  if (min != null && max != null && max < min) throw new BadRequestException('Estoque máximo menor que o mínimo');
  const { setClauses, values } = buildSafeSetClause(dto, UPDATABLE, 3);
  if (!setClauses.length) return current;
  try {
    await client.query(
      `UPDATE tenant_epis SET ${setClauses.join(', ')}, updated_by_user_id = $2 WHERE id = $1`,
      [id, userId, ...values],
    );
  } catch (err) { mapPgError(err); }
  return this.findOne(client, id);
}

async search(client: PoolClient, f: SearchEpisQuery): Promise<{ items: EpiListItem[]; total: number; page: number; page_size: number }> {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (frag: string, v: unknown) => { params.push(v); where.push(frag.replace('?', `$${params.length}`)); };
  if (f.q) add(`(eci.description ILIKE '%' || ? || '%' OR te.ca_number ILIKE '%' || ? || '%' OR te.manufacturer ILIKE '%' || ? || '%')`.replace(/\?/g, `$${params.length + 1}`), f.q);
  if (f.status) add('te.status = ?', f.status);
  if (f.category) add('eci.category = ?', f.category);
  const base = `
    SELECT te.*, eci.category, eci.code, eci.equipment_group, eci.description,
      CASE WHEN te.stock_balance = 0 THEN 'sem_estoque'
           WHEN te.min_stock IS NOT NULL AND te.stock_balance < te.min_stock THEN 'abaixo'
           WHEN te.max_stock IS NOT NULL AND te.stock_balance > te.max_stock THEN 'acima'
           ELSE 'otimo' END AS stock_band,
      CASE WHEN te.ca_valid_until IS NULL THEN 'sem_validade'
           WHEN te.ca_valid_until < CURRENT_DATE THEN 'vencido'
           WHEN te.ca_valid_until <= CURRENT_DATE + COALESCE(t.epi_alert_days, 30) THEN 'a_vencer'
           ELSE 'ok' END AS ca_alert,
      (SELECT count(*) FROM epi_lots l WHERE l.tenant_epi_id = te.id AND l.balance > 0 AND l.valid_until < CURRENT_DATE)::int AS lots_expired,
      (SELECT count(*) FROM epi_lots l WHERE l.tenant_epi_id = te.id AND l.balance > 0 AND l.valid_until >= CURRENT_DATE
         AND l.valid_until <= CURRENT_DATE + COALESCE(t.epi_alert_days, 30))::int AS lots_expiring,
      (te.stock_balance * COALESCE(te.unit_cost, 0))::numeric(14,2) AS stock_value
    FROM tenant_epis te
    JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
    LEFT JOIN tenants t ON t.id = te.tenant_id`;
  const outer: string[] = [];
  if (f.stock_band) { params.push(f.stock_band); outer.push(`stock_band = $${params.length}`); }
  if (f.ca_alert) { params.push(f.ca_alert); outer.push(`ca_alert = $${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const o = outer.length ? `WHERE ${outer.join(' AND ')}` : '';
  const sqlText = `SELECT * FROM (${base} ${w}) x ${o}`;
  const total = await client.query<{ n: string }>(`SELECT count(*) AS n FROM (${sqlText}) c`, params);
  const rows = await client.query(
    `${sqlText} ORDER BY description, ca_number LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`, params);
  return { items: rows.rows, total: Number(total.rows[0].n), page: f.page, page_size: f.pageSize };
}

async listLots(client: PoolClient, epiId: string) {
  await this.findOne(client, epiId);
  return (await client.query('SELECT * FROM epi_lots WHERE tenant_epi_id = $1 ORDER BY valid_until NULLS LAST, lot_code', [epiId])).rows;
}
```
Nota ao executor: simplificar o `add` do filtro `q` (o trecho com `replace` acima é frágil) — usar um único parâmetro `$n` repetido três vezes: `params.push(f.q); const n = params.length; where.push(\`(eci.description ILIKE '%'||$${n}||'%' OR te.ca_number ILIKE '%'||$${n}||'%' OR te.manufacturer ILIKE '%'||$${n}||'%')\`)`. Escapar `%` e `_` de `f.q` antes. `SearchEpisQuery` é a interface `{ q?, status?, category?, stock_band?, ca_alert?, page: number, pageSize: number }`, validada no controller (`stock_band` ∈ {sem_estoque, abaixo, otimo, acima}; `ca_alert` ∈ {vencido, a_vencer, ok, sem_validade}; `page_size` ≤ 100; valores fora → 400).

- [ ] **Step 5: Rotas** em `epis.controller.ts` (`search` e `movements` declaradas antes de `:id`):

```ts
  @Get('search')
  search(@Query() q: Record<string, string>, @Req() req: any) { /* valida allowlists, chama this.epi.search */ }

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEpiDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.update(client, id, dto, req.user.id));
  }

  @Get(':id/lots')
  lots(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.epi.listLots(client, id));
  }
```
`PATCH` por `tecnico/parceiro` só alcança EPIs de empresas vinculadas (RLS); `admin` edita qualquer um.

- [ ] **Step 6: Rodar** `npx jest ... epi-search-update epis-crud` → PASS; `npx tsc --noEmit` limpo; `npm run build`.

- [ ] **Step 7: Entrega** (listar arquivos; não comitar).

---

### Task 5: Regressão completa, isolamento, revisão independente e documentação

**Files:**
- Create: `docs/architecture/epi-estoque.md`
- Modify: `docs/architecture/README.md`, `PROJECT_STATE.md` (somente a seção "Em andamento", com autorização do dono)

- [ ] **Step 1: Suíte de regressão no ensaio** — `npm run test:unit`, `npm run test:isolation`, e2e: `epi-*`, `epis-crud`, `caepi`, `positions*`, `tenant-isolation-sweep`. Comparar falhas com a linha de base conhecida (19 e2e falham igual com e sem o código novo por R2/permissões; `r2-get-object` falha na base). Qualquer falha **nova** bloqueia a entrega. Registrar comando e resultado literais.
- [ ] **Step 2: Build e typecheck** — `npm run build` e `npx tsc --noEmit` no backend: sem erros.
- [ ] **Step 3: Teste de reversão da migration** — no ensaio, anotar o rollback manual (DROP das tabelas novas, colunas e trigger) em `docs/architecture/epi-estoque.md` e executá-lo num ensaio limpo para confirmar que o schema volta ao estado anterior.
- [ ] **Step 4: Revisão independente (obrigatória, quem implementa não aprova)** — acionar `montese-seguranca` (RLS, `FORCE`, permissões, trigger de imutabilidade, ausência de CPF em logs) e `montese-qa` (diff real + critérios de aceitação). Corrigir apenas achados confirmados.
- [ ] **Step 5: Documentação** — `docs/architecture/epi-estoque.md`: modelo, regras (saldo nunca negativo, estorno, idempotência, CA/lote vencidos bloqueiam entrega), rotas, papéis, comandos de teste no ensaio, rollback e limitações (rota legada de entrega sem efeito no estoque até o subsistema 4; backfill: EPIs existentes começam com saldo 0 e sem abertura). Linkar no `docs/architecture/README.md`.
- [ ] **Step 6: Relatório final ao dono** — arquivos alterados, migration `0081` (a confirmar), testes executados e resultados (VERIFICADO só com saída real), riscos restantes, instruções de validação manual e a **ordem de release** (aplicar 0081 só depois de rodar a consulta de duplicidade acima em produção; backup antes). Não aplicar nada em produção.

---

## Self-Review (spec × plano)

- Modelo de dados (spec): `tenant_epis`, `epi_lots`, `epi_movements` (imutável, CHECKs, idempotência, estorno único), `employee_epi_deliveries` (+ `quantity`, `signature_status`), `tenants.epi_alert_days` → Task 1.
- Regras: idempotência, saldo ≥ 0 (CHECK + serviço), estorno rastreável e único, abertura, entrega com validações, alertas de estoque/CA/lote com dias configuráveis, exclusão só sem movimentação (já garantido por `RESTRICT`) → Tasks 1–4.
- API: movements (POST/GET), adjustments, reversal, PATCH, search, lots → Tasks 2–4. Compatibilidade da rota legada → decisão 1 (detalhada, divergente da spec: não redireciona).
- Permissões: operar = empresa/técnico/parceiro/admin; abertura, ajuste e estorno = empresa/admin → Tasks 2–3. Auditoria via `AuditInterceptor` existente + autor gravado no movimento.
- Testes pedidos: cadastro/edição, entrada/saída, saldo insuficiente, duplicidade de requisição, concorrência, isolamento, estorno, imutabilidade, soma = saldo, permissões, regressão → Tasks 1–5. Assinatura e PDF são dos subsistemas 2–3 (fora de escopo).
- Tipos consistentes: `ApplyMovementInput`, `ApplyResult`, `EpiMovement`, `registerMovement`, `reverse`, `listMovements`, `EpiService.update/search/listLots` usados com os mesmos nomes nas tasks.
- Pontos que o executor deve verificar (NÃO VERIFICADO até rodar): comportamento de `pg_trigger_depth()` no CASCADE de tenant; tipo retornado pelo `pg` para colunas `DATE`; assinatura exata de `tenant-context-callsites`; necessidade de basear o worktree em `release/documentos-esocial-20261013` em vez de `main`.
