# Tabela oficial de funcionários — Fatia 2 (histórico campo a campo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar, campo a campo, quem alterou o quê e quando nos dados cadastrais de `employees`, e mostrar esse histórico numa gaveta da página `/empresa/funcionarios`, visível só à empresa dona e ao admin.

**Architecture:** Uma tabela append-only `employee_field_history` (RLS + FORCE RLS, `REVOKE UPDATE, DELETE, TRUNCATE` da role da aplicação, igual ao `audit_log`) alimentada por um **gatilho AFTER INSERT OR UPDATE em `employees`**. O gatilho lê o ator de `app.user_id`/`app.role` (já definidos em toda transação por `database.service.ts`, VERIFICADO linhas 55–60) e a origem de `app.change_source` (padrão `cadastro`). Assim todo caminho de escrita (cadastro, PATCH, bulk, import, `positions.service`) é coberto e é atômico com a alteração, sem depender de cada serviço lembrar de gravar. Endpoint `GET /employees/:id/history` e gaveta no frontend.

**Tech Stack:** NestJS + pg, Postgres (plpgsql, RLS), Next.js/React/Tailwind, Jest (`*.e2e-spec.ts`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-tabela-oficial-funcionarios-design.md` (§3 decisão 2, §4 `employee_field_history`, §5 `GET /employees/:id/history`, §6 gaveta de histórico).

## Global Constraints
- Sem commit, push, reset ou alteração de histórico git: os passos "Checkpoint" só listam o que mudou; quem commita é o proprietário.
- Migration só aditiva; **não aplicar em produção** sem autorização. Número **`0081`** (a `0080` é da Fatia 1; produção está em `0079`). Reconfirmar a numeração antes do release.
- e2e **nunca** contra produção: usar o ensaio descartável (Postgres+Redis próprios, imagem `node:20-bookworm-slim`, rede própria, senhas aleatórias, R2 falso, sem credencial de produção). Nunca ler/imprimir `.env`. Não usar `run-backend-tests.sh`. Receita: memória `reference_ensaio_descartavel_isolado`; scripts de montagem em `/tmp/claude-0/-opt-Montese/f0c08821-fcae-4b9b-aa80-910b26f3e2ad/scratchpad/ens2/{up,down}.sh` (se a sessão acabou, recriar a partir da receita; `up.sh <dir de migrations>`). O ensaio de outra sessão (`ensaio_pg`, `ensaio_redis`) não se mexe.
- Unit backend: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão> --forceExit`. e2e: `docker run --rm --network <rede do ensaio> --env-file <ensaio.env> -e NODE_ENV=test -e GOOGLE_CLIENT_ID=fake -e GOOGLE_CLIENT_SECRET=fake -v <worktree>/backend:/app:ro -w /app node:20-bookworm-slim sh -c 'npx jest --config ./test/jest-e2e.json --runInBand --forceExit --cacheDirectory /tmp/jc <padrão>'`. Frontend: `cd frontend && npx vitest run <arquivo>`.
- **CPF mascarado no histórico** (`***.***.***-NN`, só os 2 últimos dígitos); demais valores completos (spec §3.2). Logs e erros nunca contêm CPF.
- Visível só a `empresa` (do próprio tenant) e `admin`. Técnico/parceiro: 403 na rota e 0 linhas por RLS.
- Tenant sempre do token; id de outro tenant devolve lista vazia (mesma resposta de id inexistente), nunca 403/404 que revele existência.
- Baseline conhecido (NÃO é regressão): `r2-get-object.unit-spec` falha no HEAD; lint do frontend falha por 3 avisos antigos (`MatrizForm`, `FireSafetyEquipmentPanel`, `AdminBrand`).
- Decisão de escopo (diferença da spec §4): `document_id` e `extraction_id` **não** entram agora — as tabelas de documento/extração só chegam nas fatias 3–4 e a coluna entra lá, aditivamente. O `CHECK` de `source` já aceita `documento` e `revisao` para não precisar ser reescrito.

## Mapa de arquivos
- Create `backend/db/migrations/0081_employee_field_history.sql`
- Modify `backend/src/employees/employees.service.ts` (marcar origem `tabela`/`importacao`; método `history`)
- Modify `backend/src/employees/employees.controller.ts` (rota `GET :id/history`)
- Create `backend/test/employee-history.e2e-spec.ts`
- Create `frontend/src/lib/employees-history.ts`, `frontend/src/components/FuncionarioHistoricoDrawer.tsx`
- Modify `frontend/src/components/FuncionariosTable.tsx` (coluna "Histórico" + botão)
- Create `frontend/src/lib/__tests__/employees-history.test.ts`, `frontend/src/components/__tests__/FuncionarioHistoricoDrawer.test.tsx`
- Modify `frontend/src/components/__tests__/FuncionariosTable.test.tsx` (cabeçalhos passam de 10 para 11)

---

### Task 1: Migration `0081` + gatilho de captura

**Files:** Create `backend/db/migrations/0081_employee_field_history.sql`; Test `backend/test/employee-history.e2e-spec.ts` (criado aqui, estendido nas Tasks 2–3)

**Interfaces — Produces:**
- Tabela `employee_field_history(id, tenant_id, employee_id, field, old_value, new_value, actor_user_id, actor_role, source, changed_at)`.
- Campos rastreados (valor de `field`): `full_name, cpf, birth_date, sex, position, admission_date, esocial_registration, cbo_code, activity_description, company_unit_id, status`.
- GUC opcional `app.change_source` ∈ `cadastro|tabela|importacao|documento|revisao` (padrão `cadastro`).

- [ ] **Step 1: Escrever o teste que falha** — `backend/test/employee-history.e2e-spec.ts`
```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

const CPF_A = '52998224725';
const CPF_B = '11144477735';

describe('Funcionários: histórico campo a campo (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tecnicoToken: string;
  let tenantAId: string;
  let userAId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (email: string, password: string) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token as string;
  const sql = (text: string, params: unknown[] = []) => (db as any).client.query(text, params);
  const history = (employeeId: string) =>
    sql(
      `SELECT field, old_value, new_value, actor_user_id, actor_role, source
         FROM employee_field_history WHERE employee_id = $1 ORDER BY field`,
      [employeeId],
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    const a = await db.createTenantWithUser('Empresa Historico A');
    const b = await db.createTenantWithUser('Empresa Historico B');
    tenantAId = a.tenantId;
    tokenA = await login(a.email, a.password);
    tokenB = await login(b.email, b.password);
    userAId = (await sql('SELECT id FROM users WHERE email = $1', [a.email])).rows[0].id;
    const tec = await db.createUserWithRole('tecnico', 'Tecnico Historico');
    tecnicoToken = await login(tec.email, tec.password);
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  const create = (body: Record<string, unknown>, token = tokenA) =>
    request(app.getHttpServer()).post('/employees').set(auth(token)).send(body);
  const patch = (id: string, body: Record<string, unknown>, token = tokenA) =>
    request(app.getHttpServer()).patch(`/employees/${id}`).set(auth(token)).send(body);

  it('cadastro grava uma linha por campo preenchido, com ator, papel e origem cadastro; CPF mascarado', async () => {
    const res = await create({ full_name: 'Hist Ana', cpf: CPF_A, position: 'Soldador', sex: 'F' });
    expect(res.status).toBe(201);
    const rows = (await history(res.body.id)).rows;
    expect(rows.map((r: any) => r.field)).toEqual(['cpf', 'full_name', 'position', 'sex', 'status']);
    const cpf = rows.find((r: any) => r.field === 'cpf');
    expect(cpf.new_value).toBe('***.***.***-25');
    expect(cpf.old_value).toBeNull();
    for (const r of rows) {
      expect(r.actor_user_id).toBe(userAId);
      expect(r.actor_role).toBe('empresa');
      expect(r.source).toBe('cadastro');
    }
    expect(JSON.stringify(rows)).not.toContain(CPF_A);
  });

  it('PATCH grava só o que mudou (old e new); sem mudança real não grava nada', async () => {
    const created = await create({ full_name: 'Hist Bruno', cpf: CPF_B, position: 'Eletricista' });
    const id = created.body.id;
    const before = (await history(id)).rowCount;

    const res = await patch(id, { position: 'Eletricista Sênior', full_name: 'Hist Bruno' });
    expect(res.status).toBe(200);
    const rows = (await history(id)).rows.filter((r: any) => r.field === 'position');
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.old_value === 'Eletricista')?.new_value).toBe('Eletricista Sênior');
    expect((await history(id)).rowCount).toBe(before + 1);

    const noop = await patch(id, { position: 'Eletricista Sênior' });
    expect(noop.status).toBe(200);
    expect((await history(id)).rowCount).toBe(before + 1);
  });

  it('alteração direta no banco (sem contexto da aplicação) também é registrada, sem ator', async () => {
    const created = await create({ full_name: 'Hist Direto', cpf: '40000007994' });
    await sql(`UPDATE employees SET position = 'Via SQL' WHERE id = $1`, [created.body.id]);
    const r = (await history(created.body.id)).rows.find((x: any) => x.field === 'position');
    expect(r).toMatchObject({ new_value: 'Via SQL', actor_user_id: null, source: 'cadastro' });
  });
});
```
- [ ] **Step 2: Run** (ensaio sem a migration `0081`) → FAIL: `relation "employee_field_history" does not exist`.

- [ ] **Step 3: Criar a migration** — `backend/db/migrations/0081_employee_field_history.sql`
```sql
-- Histórico campo a campo dos dados cadastrais do funcionário. Aditiva: nada existente é alterado.
-- employee_id fica SEM chave estrangeira de propósito: o histórico sobrevive à exclusão do
-- funcionário (rastreabilidade); sai junto só se o tenant inteiro for apagado.
CREATE TABLE employee_field_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT,
  source TEXT NOT NULL CHECK (source IN ('cadastro', 'tabela', 'importacao', 'documento', 'revisao')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX employee_field_history_employee_idx
  ON employee_field_history (tenant_id, employee_id, changed_at DESC);

ALTER TABLE employee_field_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_field_history FORCE ROW LEVEL SECURITY;

-- Leitura: admin vê tudo; empresa só o próprio tenant. Técnico/parceiro não leem (spec §3.2).
CREATE POLICY employee_field_history_select ON employee_field_history FOR SELECT USING (
  current_setting('app.role', true) = 'admin'
  OR (
    current_setting('app.role', true) = 'empresa'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
);

-- Escrita: só INSERT, via gatilho. WITH CHECK (true) como no audit_log: um gatilho que falhasse por
-- RLS derrubaria a alteração do funcionário em contextos atípicos; a leitura segue restrita.
CREATE POLICY employee_field_history_insert ON employee_field_history FOR INSERT WITH CHECK (true);

-- Append-only: nem por bug da aplicação a role do backend altera ou apaga o histórico.
REVOKE UPDATE, DELETE, TRUNCATE ON employee_field_history FROM montese_app;

CREATE OR REPLACE FUNCTION employee_field_history_capture() RETURNS trigger AS $$
DECLARE
  f TEXT;
  o TEXT;
  n TEXT;
  old_j JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  new_j JSONB := to_jsonb(NEW);
  src TEXT := COALESCE(NULLIF(current_setting('app.change_source', true), ''), 'cadastro');
  uid UUID := NULLIF(current_setting('app.user_id', true), '')::uuid;
  rl TEXT := NULLIF(current_setting('app.role', true), '');
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'full_name', 'cpf', 'birth_date', 'sex', 'position', 'admission_date',
    'esocial_registration', 'cbo_code', 'activity_description', 'company_unit_id', 'status'
  ] LOOP
    o := old_j ->> f;
    n := new_j ->> f;
    IF o IS DISTINCT FROM n THEN
      IF f = 'cpf' THEN
        o := CASE WHEN o IS NULL THEN NULL ELSE '***.***.***-' || right(o, 2) END;
        n := CASE WHEN n IS NULL THEN NULL ELSE '***.***.***-' || right(n, 2) END;
      END IF;
      INSERT INTO employee_field_history
        (tenant_id, employee_id, field, old_value, new_value, actor_user_id, actor_role, source)
      VALUES (NEW.tenant_id, NEW.id, f, o, n, uid, rl, src);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_employees_field_history
  AFTER INSERT OR UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION employee_field_history_capture();
```
- [ ] **Step 4: Run** no ensaio recriado com as migrations do worktree → os 3 testes PASS. Se `status` não for o valor padrão `'ativo'`, ajustar a lista esperada do primeiro teste ao que o banco realmente grava (VERIFICAR com `\d employees`, não presumir).
- [ ] **Step 5: Regressão** — rodar no ensaio `employees tenant-isolation-sweep rls-isolation` → todos passam (o gatilho não pode quebrar nenhuma escrita existente).
- [ ] **Step 6: Checkpoint** — listar arquivos alterados; não commitar.

---

### Task 2: Origem da alteração (`tabela`, `importacao`)

**Files:** Modify `backend/src/employees/employees.service.ts` (`bulkUpdate` ~linha 251; `processImportRows` ~linha 480); Test: `backend/test/employee-history.e2e-spec.ts`

**Interfaces — Consumes:** GUC `app.change_source` (Task 1). **Produces:** linhas com `source='tabela'` (edição em lote) e `source='importacao'` (CSV/planilha).

- [ ] **Step 1: Teste que falha** — acrescentar ao spec:
```ts
  it('edição em lote grava origem tabela; cadastro e PATCH seguem cadastro', async () => {
    const created = await create({ full_name: 'Hist Lote', cpf: '40000004030', position: 'A' });
    const id = created.body.id;
    const rv = (await request(app.getHttpServer()).get('/employees/table?limit=200').set(auth(tokenA))).body.items.find(
      (r: any) => r.id === id,
    ).row_version;
    const res = await request(app.getHttpServer())
      .patch('/employees/bulk')
      .set(auth(tokenA))
      .send({ changes: [{ id, row_version: rv, fields: { position: 'B' } }] });
    expect(res.status).toBe(200);
    const row = (await history(id)).rows.find((r: any) => r.field === 'position' && r.new_value === 'B');
    expect(row.source).toBe('tabela');
    const first = (await history(id)).rows.find((r: any) => r.field === 'position' && r.new_value === 'A');
    expect(first.source).toBe('cadastro');
  });

  it('importação por planilha grava origem importacao', async () => {
    const csv = 'nome,cpf\nHist Importado,52998224725\n';
    const tb = await db.createTenantWithUser('Empresa Historico Import');
    const t = await login(tb.email, tb.password);
    const res = await request(app.getHttpServer())
      .post('/employees/import')
      .set(auth(t))
      .attach('file', Buffer.from(csv), 'funcionarios.csv');
    expect(res.status).toBeLessThan(300);
    const r = await sql(
      `SELECT source FROM employee_field_history h JOIN employees e ON e.id = h.employee_id
        WHERE e.tenant_id = $1 AND h.field = 'full_name'`,
      [tb.tenantId],
    );
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((x: any) => x.source === 'importacao')).toBe(true);
  });
```
  Antes de fechar o passo, **ler** o controller (`@Post('import')`, nome do campo do arquivo e formato aceito, ~linhas 60–120) e ajustar `attach`/CSV ao contrato real — o trecho acima é o formato esperado, **NÃO VERIFICADO** até esta leitura.
- [ ] **Step 2: Run** → FAIL (`source` vem `cadastro`).
- [ ] **Step 3: Implementar** — em `bulkUpdate`, logo após validar o tamanho do lote e antes de qualquer escrita:
```ts
    // Marca a origem das linhas de histórico geradas nesta transação (o gatilho lê o GUC).
    await client.query(`SELECT set_config('app.change_source', 'tabela', true)`);
```
  e no início de `processImportRows` (mesmo cliente/transação das inserções):
```ts
    await client.query(`SELECT set_config('app.change_source', 'importacao', true)`);
```
  (`is_local=true`: vale só até o fim da transação; nenhuma outra escrita compartilha a transação com esses dois fluxos — conferir lendo o controller.)
- [ ] **Step 4: Run** → PASS; rodar também `employees-import employees-import-flexible employees-official-table` → sem regressão.
- [ ] **Step 5: Checkpoint.**

---

### Task 3: `GET /employees/:id/history`

**Files:** Modify `backend/src/employees/employees.service.ts` (novo método `history`), `backend/src/employees/employees.controller.ts` (nova rota); Test: `backend/test/employee-history.e2e-spec.ts`

**Interfaces — Produces:**
```ts
export interface EmployeeHistoryItem {
  id: string; field: string; old_value: string | null; new_value: string | null;
  actor_role: string | null; source: string; changed_at: string; // ISO UTC "YYYY-MM-DDTHH:MM:SSZ"
}
async history(client: PoolClient, id: string, limit: number, offset: number): Promise<{ items: EmployeeHistoryItem[]; total: number }>
```
Rota: `GET /employees/:id/history?limit=&offset=` (padrão 50, máximo 200), `@Roles('empresa','admin')`, declarada **antes** de `@Get(':id')`.

- [ ] **Step 1: Testes que falham** — acrescentar:
```ts
  const getHistory = (id: string, token: string, q = '') =>
    request(app.getHttpServer()).get(`/employees/${id}/history${q}`).set(auth(token));

  it('GET history devolve do mais novo para o mais antigo, com total, sem actor_user_id', async () => {
    const created = await create({ full_name: 'Hist Rota', cpf: '12345678909', position: 'P1' });
    await patch(created.body.id, { position: 'P2' });
    const res = await getHistory(created.body.id, tokenA);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(res.body.items.length);
    expect(res.body.items[0].new_value).toBe('P2');
    expect(res.body.items[0].changed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(res.body.items[0].actor_user_id).toBeUndefined();
    const paged = await getHistory(created.body.id, tokenA, '?limit=1&offset=1');
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.total).toBe(res.body.total);
  });

  it('histórico de funcionário de outro tenant é lista vazia (igual a id inexistente)', async () => {
    const created = await create({ full_name: 'Hist Alheio', cpf: '98765432100' });
    const foreign = await getHistory(created.body.id, tokenB);
    const unknown = await getHistory('00000000-0000-4000-8000-000000000001', tokenB);
    expect(foreign.status).toBe(200);
    expect(foreign.body).toEqual({ items: [], total: 0 });
    expect(unknown.body).toEqual(foreign.body);
  });

  it('técnico recebe 403; id que não é UUID recebe 400; limit inválido recebe 400', async () => {
    const created = await create({ full_name: 'Hist Papel', cpf: '11122233396' });
    expect((await getHistory(created.body.id, tecnicoToken)).status).toBe(403);
    expect((await getHistory('abc', tokenA)).status).toBe(400);
    expect((await getHistory(created.body.id, tokenA, '?limit=999')).status).toBe(400);
  });

  it('a role da aplicação não consegue alterar nem apagar o histórico (append-only)', async () => {
    const { Client } = await import('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.role', 'admin', true)`);
      await expect(c.query(`UPDATE employee_field_history SET new_value = 'x'`)).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await expect(c.query(`DELETE FROM employee_field_history`)).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });
```
  (CPFs de fixture deste spec, todos com dígito verificador conferido com `isValidCpf` e distintos dentro do tenant A: `52998224725`, `11144477735`, `40000007994`, `40000004030`, `12345678909`, `98765432100`, `11122233396`.)
- [ ] **Step 2: Run** → FAIL (404 da rota).
- [ ] **Step 3: Implementar** — service:
```ts
  async history(client: PoolClient, id: string, limit: number, offset: number) {
    if (!UUID_RE.test(id)) throw new BadRequestException('Identificador de funcionário inválido');
    const total = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM employee_field_history WHERE employee_id = $1',
      [id],
    );
    const items = await client.query(
      `SELECT id, field, old_value, new_value, actor_role, source,
              to_char(changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS changed_at
         FROM employee_field_history WHERE employee_id = $1
        ORDER BY h.changed_at DESC, h.id DESC LIMIT $2 OFFSET $3`,
      [id, limit, offset],
    );
    return { items: items.rows, total: Number(total.rows[0].count) };
  }
```
  controller (antes de `@Get(':id')`; reaproveitar o parse de `limit`/`offset` que `GET /table` já usa — ler `employees.controller.ts` ~121–144 e copiar a mesma validação com mensagens em português, máximo 200):
```ts
  @Roles('empresa', 'admin')
  @Get(':id/history')
  history(@Param('id') id: string, @Query('limit') limit: string, @Query('offset') offset: string, @Req() req: any) {
    const l = limit === undefined ? 50 : Number(limit);
    const o = offset === undefined ? 0 : Number(offset);
    if (!Number.isInteger(l) || l < 1 || l > 200 || !Number.isInteger(o) || o < 0) {
      throw new BadRequestException('limit deve ser de 1 a 200 e offset deve ser 0 ou maior');
    }
    return req.withTenantContext((client: any) => this.employees.history(client, id, l, o));
  }
```
  (A RLS filtra por tenant; o `employee_id` vem da URL mas nunca amplia o acesso.)
- [ ] **Step 4: Run** → PASS; `tsc --noEmit` 0 erros; rodar de novo `employees tenant-isolation-sweep rls-isolation`.
- [ ] **Step 5: Checkpoint.**

---

### Task 4: Gaveta de histórico no frontend

**Files:** Create `frontend/src/lib/employees-history.ts`, `frontend/src/components/FuncionarioHistoricoDrawer.tsx`; Modify `frontend/src/components/FuncionariosTable.tsx`; Test: `frontend/src/lib/__tests__/employees-history.test.ts`, `frontend/src/components/__tests__/FuncionarioHistoricoDrawer.test.tsx`, `frontend/src/components/__tests__/FuncionariosTable.test.tsx`

**Interfaces — Consumes:** `GET /api/employees/:id/history?limit=&offset=` → `{ items: HistoryItem[]; total: number }`. **Produces:**
```ts
export interface HistoryItem { id: string; field: string; old_value: string | null; new_value: string | null; actor_role: string | null; source: string; changed_at: string }
export const FIELD_LABELS: Record<string, string>;
export function formatHistoryValue(field: string, value: string | null): string; // '—' para vazio; data ISO → DD/MM/AAAA; sexo/status legíveis
export function sourceLabel(source: string): string;   // cadastro→"Cadastro", tabela→"Edição da tabela", importacao→"Importação", documento→"Documento", revisao→"Revisão"
export function roleLabel(role: string | null): string; // empresa→"Empresa", admin→"Administrador Montese", null→"Sistema"
export function formatChangedAt(iso: string): string;  // "DD/MM/AAAA HH:MM" em America/Sao_Paulo
// <FuncionarioHistoricoDrawer employeeId employeeName onClose />
```

- [ ] **Step 1: Testes da lib que falham** — `employees-history.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { FIELD_LABELS, formatChangedAt, formatHistoryValue, roleLabel, sourceLabel } from '../employees-history';

describe('employees-history', () => {
  it('rótulos dos 11 campos rastreados', () => {
    expect(FIELD_LABELS.cbo_code).toBe('CBO');
    expect(FIELD_LABELS.esocial_registration).toBe('Matrícula eSocial');
    expect(Object.keys(FIELD_LABELS)).toHaveLength(11);
  });
  it('formata valores', () => {
    expect(formatHistoryValue('birth_date', '1990-02-03')).toBe('03/02/1990');
    expect(formatHistoryValue('sex', 'F')).toBe('F');
    expect(formatHistoryValue('position', null)).toBe('—');
    expect(formatHistoryValue('cpf', '***.***.***-25')).toBe('***.***.***-25');
    expect(formatHistoryValue('company_unit_id', '3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe('Outra filial');
  });
  it('rótulos de origem e papel', () => {
    expect(sourceLabel('tabela')).toBe('Edição da tabela');
    expect(sourceLabel('qualquer')).toBe('Outra origem');
    expect(roleLabel(null)).toBe('Sistema');
    expect(roleLabel('admin')).toBe('Administrador Montese');
  });
  it('formata data/hora em horário de Brasília', () => {
    expect(formatChangedAt('2026-10-13T15:30:00Z')).toBe('13/10/2026 12:30');
  });
});
```
- [ ] **Step 2: Run** → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar `employees-history.ts`**
```ts
export interface HistoryItem {
  id: string; field: string; old_value: string | null; new_value: string | null;
  actor_role: string | null; source: string; changed_at: string;
}

export const FIELD_LABELS: Record<string, string> = {
  full_name: 'Funcionário', cpf: 'CPF', birth_date: 'Data de nascimento', sex: 'Sexo',
  position: 'Função/Cargo', admission_date: 'Data de admissão', esocial_registration: 'Matrícula eSocial',
  cbo_code: 'CBO', activity_description: 'Descrição da atividade', company_unit_id: 'Filial', status: 'Situação',
};

const DATE_FIELDS = new Set(['birth_date', 'admission_date']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatHistoryValue(field: string, value: string | null): string {
  if (value === null || value === '') return '—';
  if (DATE_FIELDS.has(field)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
  }
  // O histórico guarda só o id da filial; o nome exigiria outra consulta (YAGNI nesta fatia).
  if (field === 'company_unit_id' && UUID_RE.test(value)) return 'Outra filial';
  return value;
}

const SOURCES: Record<string, string> = {
  cadastro: 'Cadastro', tabela: 'Edição da tabela', importacao: 'Importação', documento: 'Documento', revisao: 'Revisão',
};
export const sourceLabel = (s: string): string => SOURCES[s] ?? 'Outra origem';

export function roleLabel(role: string | null): string {
  if (role === 'empresa') return 'Empresa';
  if (role === 'admin') return 'Administrador Montese';
  return 'Sistema';
}

export function formatChangedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
}
```
  Se o texto "Outra filial" ficar enganoso (a filial mudou **para** algo), aceitar por ora e registrar como pendência de UX — não buscar nomes de filial nesta fatia.
- [ ] **Step 4: Run** a lib → PASS.
- [ ] **Step 5: Testes do componente que falham** — `FuncionarioHistoricoDrawer.test.tsx` (molde dos testes de `FuncionariosTable.test.tsx`: `resp()` helper, `vi.stubGlobal('fetch')`, `localStorage 'montese_token'`):
```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FuncionarioHistoricoDrawer } from '../FuncionarioHistoricoDrawer';

const resp = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, headers: new Headers(), json: async () => body }) as Response;
const item = (over = {}) => ({
  id: 'h1', field: 'position', old_value: 'Soldador', new_value: 'Eletricista', actor_role: 'empresa',
  source: 'tabela', changed_at: '2026-10-13T15:30:00Z', ...over,
});

describe('FuncionarioHistoricoDrawer', () => {
  beforeEach(() => localStorage.setItem('montese_token', 't'));
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('é um diálogo rotulado, busca o histórico e mostra campo, de→para, quem, origem e quando', async () => {
    const f = vi.fn().mockResolvedValue(resp({ items: [item()], total: 1 }));
    vi.stubGlobal('fetch', f);
    render(<FuncionarioHistoricoDrawer employeeId="e1" employeeName="Ana Teste" onClose={() => {}} />);
    const dlg = await screen.findByRole('dialog', { name: 'Histórico de Ana Teste' });
    expect(dlg).toBeTruthy();
    expect(f.mock.calls[0][0]).toBe('/api/employees/e1/history?limit=50&offset=0');
    expect(await screen.findByText('Função/Cargo')).toBeTruthy();
    expect(screen.getByText('Soldador')).toBeTruthy();
    expect(screen.getByText('Eletricista')).toBeTruthy();
    expect(screen.getByText(/Empresa/)).toBeTruthy();
    expect(screen.getByText(/Edição da tabela/)).toBeTruthy();
    expect(screen.getByText(/13\/10\/2026 12:30/)).toBeTruthy();
  });

  it('estado vazio, erro em português e fechar por botão e por Esc', async () => {
    const onClose = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ items: [], total: 0 })));
    const { unmount } = render(<FuncionarioHistoricoDrawer employeeId="e1" employeeName="Ana" onClose={onClose} />);
    expect(await screen.findByText('Nenhuma alteração registrada para este funcionário.')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ message: 'x' }, 500)));
    render(<FuncionarioHistoricoDrawer employeeId="e1" employeeName="Ana" onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar o histórico');
  });

  it('"Carregar mais" busca a próxima página e acrescenta', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(resp({ items: [item({ id: 'h1', new_value: 'A' })], total: 2 }))
      .mockResolvedValueOnce(resp({ items: [item({ id: 'h2', new_value: 'B' })], total: 2 }));
    vi.stubGlobal('fetch', f);
    render(<FuncionarioHistoricoDrawer employeeId="e1" employeeName="Ana" onClose={() => {}} />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await screen.findByText('B');
    expect(f.mock.calls[1][0]).toBe('/api/employees/e1/history?limit=50&offset=1');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });
});
```
- [ ] **Step 6: Implementar `FuncionarioHistoricoDrawer.tsx`** — `'use client'`; props `{ employeeId: string; employeeName: string; onClose: () => void }`. Comportamento exigido pelos testes e pela acessibilidade:
  - contêiner `role="dialog"` `aria-modal="true"` `aria-label={`Histórico de ${employeeName}`}`, painel à direita (`fixed inset-y-0 right-0 w-full sm:max-w-md`), fundo escurecido clicável que fecha; classes de tema `dash-*` iguais às de `FuncionariosTable.tsx` (`border-dash-border-soft`, `text-dash-muted`, `bg-dash-card`);
  - ao abrir, foco no botão "Fechar"; `keydown` `Escape` em `document` chama `onClose` (remover o listener no cleanup);
  - `fetch(`/api/employees/${employeeId}/history?limit=50&offset=${offset}`)` com `Authorization: Bearer`; **não** enviar `tenant_id` (a rota não o lê; a RLS decide o acesso);
  - estados: carregando ("Carregando histórico..."), erro (`role="alert"`: "Não foi possível carregar o histórico."), vazio ("Nenhuma alteração registrada para este funcionário."), lista (`<ol>`): por item, rótulo do campo em negrito, "`antes` → `depois`" (valores por `formatHistoryValue`), e uma linha miúda "`roleLabel` · `sourceLabel` · `formatChangedAt`";
  - "Carregar mais" (`<button>`) só enquanto `items.length < total`, busca `offset=items.length` e **acrescenta**; guardar contador de requisição (`useRef`) para descartar resposta superada (mesmo padrão do `load()` de `FuncionariosTable.tsx`).
  Código mínimo do núcleo de dados:
```tsx
const [items, setItems] = useState<HistoryItem[]>([]);
const [total, setTotal] = useState(0);
const [state, setState] = useState<'carregando' | 'ok' | 'erro'>('carregando');
const seq = useRef(0);
const load = useCallback(async (offset: number) => {
  const mine = ++seq.current;
  try {
    const res = await fetch(`/api/employees/${employeeId}/history?limit=50&offset=${offset}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('montese_token')}` },
    });
    const body = await res.json().catch(() => ({}));
    if (mine !== seq.current) return;
    if (!res.ok) return setState('erro');
    setItems((prev) => (offset === 0 ? body.items : [...prev, ...body.items]));
    setTotal(body.total ?? 0);
    setState('ok');
  } catch {
    if (mine === seq.current) setState('erro');
  }
}, [employeeId]);
useEffect(() => { void load(0); }, [load]);
```
- [ ] **Step 7: Run** testes do componente → PASS.
- [ ] **Step 8: Testes da tabela que falham** — em `FuncionariosTable.test.tsx`: (a) `COLUNAS` passa a terminar em `'Histórico'` (11 cabeçalhos); (b) novo teste: clicar em "Histórico de Ana Teste" abre o diálogo "Histórico de Ana Teste" e o `fetch` chama `/api/employees/e1/history?limit=50&offset=0`; fechar remove o diálogo; (c) o botão fica habilitado também durante a edição (consultar histórico não altera nada).
- [ ] **Step 9: Implementar na tabela** — em `FuncionariosTable.tsx`: `const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null);`; no `<thead>` acrescentar `<th scope="col" className="px-2 py-2 font-semibold">Histórico</th>` após o `map` das colunas; em cada linha, depois do `map` de células, uma `<td className="py-1 md:table-cell md:px-2 md:py-2">` com
```tsx
<button
  type="button"
  onClick={() => setHistoryFor({ id: row.id, name: row.full_name })}
  aria-label={`Histórico de ${row.full_name}`}
  className="rounded-md border border-dash-border-soft px-2 py-1 text-xs font-semibold text-dash-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-dash-primary"
>
  Ver histórico
</button>
```
  e, no fim do JSX do componente, `{historyFor && <FuncionarioHistoricoDrawer employeeId={historyFor.id} employeeName={historyFor.name} onClose={() => setHistoryFor(null)} />}`. No cartão (mobile) mostrar um rótulo `md:hidden` "Histórico" como nas demais células.
- [ ] **Step 10: Run** `npx vitest run src/components src/lib src/app/empresa` → sem falhas; `npx tsc --noEmit` → 0 erros; `npm run lint` → só os 3 avisos de baseline.
- [ ] **Step 11: Conferência visual** — subir `next dev` do worktree em porta livre, interceptar `/api/**` no Playwright (sessão `empresa` falsa só no `localStorage` do navegador de teste: JWT sem assinatura com `exp` futuro + `montese_user`; receita usada na Fatia 1: `scratchpad/shot.js`), capturar a gaveta aberta em 1440 px e 390 px, verificar `scrollWidth === innerWidth`, ausência de `pageerror`; anexar as imagens ao relatório. Encerrar o `next dev`. **Não** declarar "responsivo" sem a captura.
- [ ] **Step 12: Checkpoint.**

---

### Task 5: Verificação final e entrega da fatia

- [ ] **Step 1:** backend `npx tsc --noEmit` → 0 erros; unit completo → só a falha de baseline `r2-get-object`; e2e no ensaio: `employee-history employees tenant-isolation-sweep rls-isolation` → todos passam (colar a saída real).
- [ ] **Step 2:** frontend `npx vitest run` completo e `npx tsc --noEmit` → sem falhas.
- [ ] **Step 3:** invocar `superpowers:verification-before-completion`; relatório com VERIFICADO / NÃO VERIFICADO.
- [ ] **Step 4: Revisão independente** (agentes diferentes de quem implementou): `montese-qa` (diff real + critérios abaixo) e `montese-seguranca` (RLS do histórico: técnico/parceiro sem leitura, tenant A não lê tenant B, `WITH CHECK (true)` do INSERT, append-only, CPF mascarado em todos os caminhos, gatilho não quebra escrita, `GET history` com UUID inválido e paginação). Corrigir achados e reexecutar o que for afetado.
- [ ] **Step 5: Relatório da fatia:** funcionalidades, arquivos, tabela/gatilho, testes e resultados, pendências; confirmar que **nenhum dado existente foi alterado** (migration só cria tabela, função e gatilho) e que **nada foi aplicado em produção**.

## Critérios de aceitação da fatia
1. Cadastro, PATCH, edição em lote e importação geram linhas de histórico com ator, papel, origem e horário, dentro da mesma transação da alteração (falha na alteração ⇒ nenhuma linha).
2. Alteração sem mudança real não gera linha. CPF nunca aparece completo no histórico.
3. Empresa vê só o histórico do próprio tenant; admin vê todos; técnico/parceiro: 403 na rota e 0 linhas por RLS; id de outro tenant ≡ id inexistente (lista vazia).
4. A role da aplicação não consegue `UPDATE`/`DELETE`/`TRUNCATE` na tabela.
5. Gaveta acessível (diálogo rotulado, Esc, foco, rolagem interna), com estados carregando/erro/vazio/lista e "Carregar mais".
6. Nenhum fluxo existente de escrita em `employees` quebra (e2e de employees, import, isolamento passam).

## Riscos desta fatia
- **Gatilho em tabela quente:** custo por UPDATE é de 11 comparações em jsonb; aceitável no volume atual. NÃO VERIFICADO sob carga — medir se o import de milhares de linhas for usado (RECOMENDADO só se aparecer lentidão).
- **`app.change_source` é um GUC local de transação:** se um fluxo futuro misturar escritas de origens diferentes na mesma transação, todas herdam a última marcada. Hoje `bulk` e `import` rodam em transação própria (conferir na Task 2).
- **`to_jsonb(OLD)` para colunas novas:** novos campos de `employees` só entram no histórico se forem acrescentados à lista do gatilho (migration futura). Documentado aqui para as fatias 3–4.
- **Tenant apagado** remove o histórico por cascata (intencional); funcionário apagado **não** remove (sem FK).
- **Nome da filial** não aparece no histórico (só "Outra filial"): pendência de UX, fora desta fatia.
- **Aplicação em produção** exige a numeração reconfirmada (`0081` ou a próxima livre) e aprovação do proprietário; criação do índice é em tabela nova (sem trava em tabelas existentes).

## Auto-revisão contra a spec
- §3.2 histórico completo exceto CPF mascarado, visível só à empresa dona e ao admin: Task 1 (máscara, RLS de leitura) + Task 3 (403 técnico).
- §4 tabela append-only com RLS + FORCE e REVOKE: Task 1. `document_id`/`extraction_id`: **adiados** para as fatias 3–4 (declarado em Global Constraints).
- §5 `GET /employees/:id/history`: Task 3. §6 gaveta de histórico: Task 4. Fontes `documento|revisao` já aceitas pelo CHECK; só serão gravadas nas fatias 3–4.
- Tipos: `HistoryItem` (frontend) ≡ colunas devolvidas por `history()` (backend) sem `actor_user_id`; GUC `app.change_source` com os mesmos valores do CHECK da migration.

## Desvios da execução (registrados em 2026-10-13, após a revisão final)
- `actor_user_id` ficou **sem FK** (o plano previa `REFERENCES users ... SET NULL`): um JWT de usuário apagado derrubaria a escrita do funcionário.
- Índice final: `(employee_id, changed_at DESC)` (o plano previa `(tenant_id, employee_id, changed_at DESC)`); gatilho com `SET search_path = public, pg_temp`.
- `ORDER BY h.changed_at DESC, h.id DESC` (o alias de saída ordenava por texto).
- `limit`/`offset` de `GET :id/history`: só `/^\d+$/` + `Number.isSafeInteger`, vazio → 400.
- Gaveta: trap de foco, foco restaurado ao fechar, "Tentar novamente" no erro de paginação, `role="status"` e `sr-only` "de/para".
- Pendência de decisão do proprietário antes do release: retenção/expurgo LGPD do histórico (nenhum caminho de DELETE para a role da aplicação).
