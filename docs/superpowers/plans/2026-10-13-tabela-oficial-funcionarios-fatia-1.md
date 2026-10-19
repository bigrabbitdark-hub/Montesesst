# Tabela oficial de funcionários — Fatia 1 (migration, API, tabela editável, cadastro manual)

> **Atualização 2026-10-19 (merge com feat/epi-estoque):** a coluna `esocial_registration` deste plano foi removida; a matrícula única é `employees.registration_number` (0069). Os trechos abaixo já usam o nome novo; a 0080 não cria coluna de matrícula, só CHECK de formato e índice único condicionais (ver o cabeçalho da migration).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estender a tabela `employees` com os 4 campos do modelo Montese e entregar, no setor Funcionários do dashboard, uma tabela oficial com leitura, edição em lote confirmável/cancelável e cadastro manual — sem tabela paralela.

**Architecture:** Uma migration aditiva em `employees`; utilitário puro de validação/normalização compartilhado; endpoints novos em `EmployeesController` (listagem paginada de tabela e `PATCH /employees/bulk` atômico com trava otimista por `row_version`); página `/empresa/funcionarios` com componente de tabela. Histórico (fatia 2), ingestão (fatias 3–4) e botão "Anexar documento" ficam fora desta fatia (botão sem função não entra — AGENTS.md).

**Tech Stack:** NestJS + pg (`req.withTenantContext` = transação BEGIN/COMMIT/ROLLBACK, VERIFICADO em `database.service.ts`), Postgres com RLS, Next.js/React/Tailwind, Jest (`*.unit-spec.ts`, `*.e2e-spec.ts`), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-tabela-oficial-funcionarios-design.md`

## Global Constraints
- Sem commit, push, reset ou alteração de histórico: **os passos "Checkpoint" apenas listam o que mudou; quem commita é o proprietário.**
- Migration só aditiva; **não aplicar em produção** sem autorização. Número `0080` a confirmar (PROJECT_STATE item 5: 0065–0071 existem em produção e não estão na pasta).
- e2e **nunca** contra produção: usar o ensaio descartável (Postgres+Redis próprios, imagem `node:20-bookworm-slim`, senhas aleatórias, R2 falso). Nunca ler/imprimir `.env`. Não usar `run-backend-tests.sh` (lê `.env`).
- Unit backend: `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão> --forceExit`. Frontend: `cd /opt/Montese/frontend && npx vitest run <arquivo>`.
- Matrícula e CBO sempre `TEXT`/`VARCHAR` (zeros à esquerda). Datas trafegam como `YYYY-MM-DD` (usar `to_char`, nunca serializar `Date`).
- Tenant sempre do token (`req.user.tenantId`); `company_unit_id` conferido contra o tenant; permissões de escrita `empresa`/`admin`.
- Baseline conhecido antes de começar (NÃO são regressão): `r2-get-object`, `golden-dataset`, `tenant-context-callsites` falham no HEAD (ver memória de testes).
- **Pré-requisito (decisão do proprietário):** branch/worktree próprio (a árvore tem ~97 alterações de outras frentes). Executor usa `superpowers:using-git-worktrees` antes da Task 1.

## Mapa de arquivos
- Create `backend/db/migrations/0080_employees_official_fields.sql`
- Create `backend/src/employees/employee-fields.util.ts` (validação/normalização pura)
- Create `backend/src/employees/dto/bulk-update-employees.dto.ts`
- Modify `backend/src/employees/employees.service.ts`, `employees.controller.ts`, `dto/create-employee.dto.ts`, `dto/update-employee.dto.ts`
- Create `backend/test/employee-fields.unit-spec.ts`, `backend/test/employees-official-table.e2e-spec.ts`
- Create `frontend/src/lib/employees-table.ts`, `frontend/src/components/FuncionariosTable.tsx`, `frontend/src/app/empresa/funcionarios/page.tsx`
- Modify `frontend/src/lib/dashboard/menu.ts:32`
- Create `frontend/src/lib/__tests__/employees-table.test.ts`, `frontend/src/components/__tests__/FuncionariosTable.test.tsx`

---

### Task 1: Utilitário de validação e normalização

**Files:** Create `backend/src/employees/employee-fields.util.ts`; Test `backend/test/employee-fields.unit-spec.ts`

**Interfaces — Produces:**
```ts
export type FieldResult<T> = { ok: true; value: T } | { ok: false; message: string };
export const onlyDigits: (v: string) => string;
export const isValidCpf: (raw: string) => boolean;
export const normalizeCbo: (raw: unknown) => FieldResult<string>;       // 6 dígitos, padStart
export const normalizeSex: (raw: unknown) => FieldResult<'F' | 'M'>;
export const normalizeRegistrationNumber: (raw: unknown) => FieldResult<string>; // texto, 1–30, [A-Za-z0-9._-]
export const normalizeIsoDate: (raw: unknown) => FieldResult<string>;   // aceita YYYY-MM-DD e DD/MM/YYYY
export function normalizeEmployeeInput(input: Record<string, unknown>): {
  values: Record<string, unknown>;
  errors: Record<string, string>;
};
```

- [ ] **Step 1: Write the failing test** — `backend/test/employee-fields.unit-spec.ts`
```ts
import {
  isValidCpf, normalizeCbo, normalizeSex, normalizeRegistrationNumber,
  normalizeIsoDate, normalizeEmployeeInput,
} from '../src/employees/employee-fields.util';

describe('isValidCpf', () => {
  it('aceita CPF válido com e sem máscara', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('529.982.247-25')).toBe(true);
  });
  it('rejeita dígito verificador errado, repetidos e tamanho errado', () => {
    expect(isValidCpf('52998224726')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('1234')).toBe(false);
  });
});

describe('normalizeCbo', () => {
  it('preserva 6 dígitos e restaura zero à esquerda de número do Excel', () => {
    expect(normalizeCbo('717510')).toEqual({ ok: true, value: '717510' });
    expect(normalizeCbo(51210)).toEqual({ ok: true, value: '051210' });
  });
  it('rejeita vazio e mais de 6 dígitos', () => {
    expect(normalizeCbo('').ok).toBe(false);
    expect(normalizeCbo('1234567').ok).toBe(false);
  });
});

describe('normalizeSex', () => {
  it('aceita f/M em qualquer caixa', () => {
    expect(normalizeSex(' f ')).toEqual({ ok: true, value: 'F' });
    expect(normalizeSex('M')).toEqual({ ok: true, value: 'M' });
  });
  it('rejeita outros valores', () => expect(normalizeSex('X').ok).toBe(false));
});

describe('normalizeRegistrationNumber', () => {
  it('mantém zeros à esquerda como texto', () => {
    expect(normalizeRegistrationNumber('00012345678')).toEqual({ ok: true, value: '00012345678' });
  });
  it('rejeita espaços internos e excesso de tamanho', () => {
    expect(normalizeRegistrationNumber('12 34').ok).toBe(false);
    expect(normalizeRegistrationNumber('1'.repeat(31)).ok).toBe(false);
  });
});

describe('normalizeIsoDate', () => {
  it('aceita ISO e BR e devolve ISO sem fuso', () => {
    expect(normalizeIsoDate('2020-01-05')).toEqual({ ok: true, value: '2020-01-05' });
    expect(normalizeIsoDate('05/01/2020')).toEqual({ ok: true, value: '2020-01-05' });
  });
  it('rejeita data inexistente', () => {
    expect(normalizeIsoDate('31/02/2020').ok).toBe(false);
    expect(normalizeIsoDate('lixo').ok).toBe(false);
  });
});

describe('normalizeEmployeeInput', () => {
  it('normaliza campos presentes e ignora ausentes', () => {
    const { values, errors } = normalizeEmployeeInput({
      cpf: '529.982.247-25', sex: 'f', cbo_code: 51210, position: '  Soldador ', activity_description: '',
    });
    expect(errors).toEqual({});
    expect(values).toEqual({
      cpf: '52998224725', sex: 'F', cbo_code: '051210', position: 'Soldador', activity_description: null,
    });
  });
  it('vazio limpa campo opcional (null) mas nome vazio é erro', () => {
    const { values, errors } = normalizeEmployeeInput({ birth_date: '', full_name: '  ' });
    expect(values).toEqual({ birth_date: null });
    expect(errors.full_name).toBe('Nome é obrigatório');
  });
  it('acumula erros por campo', () => {
    const { errors } = normalizeEmployeeInput({ cpf: '1', sex: 'X', cbo_code: 'ab' });
    expect(Object.keys(errors).sort()).toEqual(['cbo_code', 'cpf', 'sex']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**
Run: `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json employee-fields --forceExit`
Expected: FAIL — `Cannot find module '../src/employees/employee-fields.util'`.

- [ ] **Step 3: Implement** — `backend/src/employees/employee-fields.util.ts`
```ts
export type FieldResult<T> = { ok: true; value: T } | { ok: false; message: string };

export const onlyDigits = (v: string): string => v.replace(/\D/g, '');

export function isValidCpf(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(d[len])) return false;
  }
  return true;
}

export function normalizeCbo(raw: unknown): FieldResult<string> {
  const d = onlyDigits(String(raw ?? ''));
  if (d.length === 0 || d.length > 6) return { ok: false, message: 'CBO deve ter até 6 dígitos' };
  return { ok: true, value: d.padStart(6, '0') };
}

export function normalizeSex(raw: unknown): FieldResult<'F' | 'M'> {
  const v = String(raw ?? '').trim().toUpperCase();
  return v === 'F' || v === 'M' ? { ok: true, value: v } : { ok: false, message: 'Sexo deve ser F ou M' };
}

export function normalizeRegistrationNumber(raw: unknown): FieldResult<string> {
  const v = String(raw ?? '').trim();
  return /^[A-Za-z0-9._-]{1,30}$/.test(v)
    ? { ok: true, value: v }
    : { ok: false, message: 'Matrícula eSocial inválida (1 a 30 caracteres, sem espaços)' };
}

export function normalizeIsoDate(raw: unknown): FieldResult<string> {
  const s = String(raw ?? '').trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const [y, m, d] = br ? [br[3], br[2], br[1]] : iso ? [iso[1], iso[2], iso[3]] : [];
  if (!y) return { ok: false, message: 'Data inválida (use DD/MM/AAAA)' };
  const probe = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  const real =
    probe.getUTCFullYear() === Number(y) && probe.getUTCMonth() === Number(m) - 1 && probe.getUTCDate() === Number(d);
  return real ? { ok: true, value: `${y}-${m}-${d}` } : { ok: false, message: 'Data inexistente' };
}

const isBlank = (v: unknown): boolean => v === null || (typeof v === 'string' && v.trim() === '');
const PASS_THROUGH = ['company_unit_id', 'position_id'] as const;
const STATUSES = ['ativo', 'inativo', 'pendente'];

export function normalizeEmployeeInput(input: Record<string, unknown>): {
  values: Record<string, unknown>;
  errors: Record<string, string>;
} {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  const apply = <T>(field: string, r: FieldResult<T>) => (r.ok ? (values[field] = r.value) : (errors[field] = r.message));

  for (const [field, raw] of Object.entries(input)) {
    if (raw === undefined) continue;
    switch (field) {
      case 'full_name':
        typeof raw === 'string' && raw.trim() ? (values[field] = raw.trim()) : (errors[field] = 'Nome é obrigatório');
        break;
      case 'cpf':
        isValidCpf(String(raw)) ? (values[field] = onlyDigits(String(raw))) : (errors[field] = 'CPF inválido');
        break;
      case 'birth_date':
      case 'admission_date':
        isBlank(raw) ? (values[field] = null) : apply(field, normalizeIsoDate(raw));
        break;
      case 'sex':
        isBlank(raw) ? (values[field] = null) : apply(field, normalizeSex(raw));
        break;
      case 'cbo_code':
        isBlank(raw) ? (values[field] = null) : apply(field, normalizeCbo(raw));
        break;
      case 'registration_number':
        isBlank(raw) ? (values[field] = null) : apply(field, normalizeRegistrationNumber(raw));
        break;
      case 'position':
      case 'activity_description': {
        const max = field === 'position' ? 200 : 2000;
        const t = isBlank(raw) ? null : String(raw).trim();
        t !== null && t.length > max ? (errors[field] = `Máximo de ${max} caracteres`) : (values[field] = t);
        break;
      }
      case 'status':
        STATUSES.includes(String(raw)) ? (values[field] = raw) : (errors[field] = 'Situação inválida');
        break;
      default:
        if ((PASS_THROUGH as readonly string[]).includes(field)) values[field] = isBlank(raw) ? null : raw;
    }
  }
  return { values, errors };
}
```

- [ ] **Step 4: Run to verify it passes** — mesmo comando do Step 2. Expected: PASS (todos os `it`).

- [ ] **Step 5: Checkpoint** — `git status --short backend/src/employees backend/test/employee-fields.unit-spec.ts` lista só os 2 arquivos novos. Sem commit.

---

### Task 2: Migration `0080` (ensaio descartável)

**Files:** Create `backend/db/migrations/0080_employees_official_fields.sql`

**Interfaces — Produces:** colunas `employees.registration_number TEXT`, `sex CHAR(1)`, `cbo_code VARCHAR(6)`, `activity_description TEXT`, índice único parcial `employees_tenant_registration_number_uidx`.

- [ ] **Step 1: Escrever a migration**
```sql
-- Campos do modelo oficial Montese SST (planilha "Cadastro Funcionários - Laudos e eSocial").
-- Aditiva: nenhuma coluna existente é alterada. Matrícula e CBO ficam como texto
-- (zeros à esquerda). Colunas novas nascem NULL, então o índice único parcial
-- não pode colidir com dados legados.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS registration_number TEXT,
  ADD COLUMN IF NOT EXISTS sex CHAR(1),
  ADD COLUMN IF NOT EXISTS cbo_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS activity_description TEXT;

ALTER TABLE employees
  ADD CONSTRAINT employees_sex_check CHECK (sex IS NULL OR sex IN ('F', 'M')),
  ADD CONSTRAINT employees_cbo_code_check CHECK (cbo_code IS NULL OR cbo_code ~ '^[0-9]{6}$'),
  ADD CONSTRAINT employees_registration_number_check
    CHECK (registration_number IS NULL OR registration_number ~ '^[A-Za-z0-9._-]{1,30}$');

CREATE UNIQUE INDEX IF NOT EXISTS employees_tenant_registration_number_uidx
  ON employees (tenant_id, registration_number)
  WHERE registration_number IS NOT NULL;
```
(RLS/FORCE RLS da tabela não mudam: colunas novas herdam a policy `employees_isolation`.)

- [ ] **Step 2: Subir o ensaio descartável** conforme memória `reference_ensaio_descartavel_isolado` (rede `montese_ensaio`, `pgvector/pgvector:pg16` com `--tmpfs`, `redis:7-alpine`, senhas `openssl rand -hex`, `CREATE EXTENSION vector, pgcrypto, pg_trgm`, aplicar `0001`…`0078` em ordem com `psql -v ON_ERROR_STOP=1 --single-transaction`). Salvar o env do ensaio no scratchpad, nunca imprimir senhas. Se `0065`–`0071` faltarem na pasta e alguma migration posterior depender delas, **parar e reportar** ao proprietário.

- [ ] **Step 3: Aplicar a `0080` no ensaio e provar as constraints**
```bash
docker exec -i ensaio_pg psql -v ON_ERROR_STOP=1 --single-transaction -U montese_superuser_ensaio -d montese -f - < backend/db/migrations/0080_employees_official_fields.sql
```
(ajustar usuário/banco ao que o ensaio criou.) Depois, no mesmo banco, três `INSERT`s que **devem falhar**: `sex='X'`, `cbo_code='12345'`, e dois funcionários do mesmo tenant com a mesma `registration_number`. Expected: `ERROR: violates check constraint` / `duplicate key` nos três; e dois funcionários com `registration_number` NULL passam.

- [ ] **Step 4: Checkpoint** — registrar no relatório final: migration aplicada **somente no ensaio**; produção NÃO VERIFICADO/NÃO APLICADA.

---

### Task 3: Service + DTOs (create/update com campos oficiais e validação)

**Files:** Modify `backend/src/employees/employees.service.ts` (interface `Employee`, `UPDATABLE_FIELDS`, `create`, `update`), `dto/create-employee.dto.ts`, `dto/update-employee.dto.ts`, `employees.controller.ts` (`create`); Test `backend/test/employees-official-table.e2e-spec.ts`

**Interfaces — Consumes:** `normalizeEmployeeInput` (Task 1). **Produces:** `EmployeesService.create/update` aceitam `registration_number, sex, cbo_code, activity_description` e rejeitam dados inválidos com `BadRequestException`.

- [ ] **Step 1: Failing e2e (criação e validação)** — criar `backend/test/employees-official-table.e2e-spec.ts` (estrutura idêntica a `employees-tenant-id.e2e-spec.ts`: `Test.createTestingModule({imports:[AppModule]})`, `TestDb`, login via `/auth/login`). Casos desta task:
```ts
const CPF_OK = '52998224725';
it('cria funcionário com os campos do modelo e devolve cbo/matrícula como texto', async () => {
  const res = await request(app.getHttpServer()).post('/employees').set('Authorization', `Bearer ${empresaToken}`)
    .send({ full_name: 'Ana Teste', cpf: '529.982.247-25', sex: 'f', registration_number: '00012345678',
            cbo_code: '051210', position: 'Soldador', activity_description: 'Solda em campo' });
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ cpf: CPF_OK, sex: 'F', registration_number: '00012345678', cbo_code: '051210' });
});
it('rejeita CPF com dígito verificador inválido (400, mensagem em português)', async () => {
  const res = await request(app.getHttpServer()).post('/employees').set('Authorization', `Bearer ${empresaToken}`)
    .send({ full_name: 'Bia', cpf: '52998224726' });
  expect(res.status).toBe(400);
  expect(JSON.stringify(res.body)).toContain('CPF inválido');
});
it('matrícula repetida no mesmo tenant dá 409', async () => { /* cria dois com mesma registration_number e CPFs distintos válidos; segundo → 409 */ });
```
(Para o 3º caso gerar um 2º CPF válido, ex. `'11144477735'`.)

- [ ] **Step 2: Run to verify it fails** — no ensaio:
`docker run --rm --network montese_ensaio --env-file <ensaio.env> -e NODE_ENV=test -e GOOGLE_CLIENT_ID=fake -e GOOGLE_CLIENT_SECRET=fake -v /opt/Montese/backend:/app:ro -w /app node:20-bookworm-slim sh -c 'npx jest --config ./test/jest-e2e.json --runInBand --forceExit --cacheDirectory /tmp/jc employees-official-table' > <scratchpad>/e2e-t3.log 2>&1`
Expected: FAIL (campos ignorados / CPF inválido aceito). Ler o log do arquivo, nunca `| tail` durante a execução.

- [ ] **Step 3: Implementar**
  - `Employee` ganha `registration_number: string | null; sex: 'F' | 'M' | null; cbo_code: string | null; activity_description: string | null;`.
  - `UPDATABLE_FIELDS` ganha `'registration_number','sex','cbo_code','activity_description'`.
  - DTOs (`CreateEmployeeDto`/`UpdateEmployeeDto`) ganham os mesmos 4 campos opcionais (`string`).
  - `create`: no início, `const { values, errors } = normalizeEmployeeInput({ full_name: data.full_name, cpf: data.cpf, birth_date: data.birth_date, position: data.position, admission_date: data.admission_date, sex: data.sex, cbo_code: data.cbo_code, registration_number: data.registration_number, activity_description: data.activity_description });` e `if (Object.keys(errors).length) throw new BadRequestException(Object.values(errors).join('; '));` — INSERT passa a incluir as 4 colunas novas a partir de `values` (`?? null`). `mapPgError` continua traduzindo 23505 (CPF duplicado); acrescentar tradução de `employees_tenant_registration_number_uidx` → `ConflictException('Matrícula eSocial já cadastrada nesta empresa')` (checar `common/pg-error.util.ts` e seguir o padrão local).
  - `update`: antes de montar o SET, `const { values, errors } = normalizeEmployeeInput(data as Record<string, unknown>);` mesmo tratamento de `errors`; usar `values` no lugar de `data` em `buildSafeSetClause` e nas checagens existentes (`status`, `company_unit_id`, `position_id`).
  - `controller.create`: repassar os 4 campos novos do DTO.

- [ ] **Step 4: Run to verify passes** — mesmo comando do Step 2 → PASS. Depois rodar **também** `employees-company-unit`, `employees-import`, `employees-limit`, `employees-tenant-id` no ensaio. Esperado: se algum falhar por CPF de fixture com dígito verificador inválido (ex.: `'40000008099'`), trocar o fixture por CPF válido (helper `validCpf(n)` local ao spec) **sem enfraquecer a asserção**; registrar quais specs foram alterados.

- [ ] **Step 5: Checkpoint** — `git diff --stat` mostra só os arquivos do mapa + fixtures ajustados.

---

### Task 4: Listagem da tabela e `PATCH /employees/bulk`

**Files:** Modify `employees.service.ts`, `employees.controller.ts`; Create `dto/bulk-update-employees.dto.ts`; Test `employees-official-table.e2e-spec.ts`

**Interfaces — Produces:**
```ts
export interface EmployeeTableRow {
  id: string; sequence: number; row_version: string;
  full_name: string; registration_number: string | null; cpf: string;
  birth_date: string | null; sex: 'F' | 'M' | null; position: string | null;
  admission_date: string | null; cbo_code: string | null; activity_description: string | null;
  company_unit_id: string | null; status: string;
}
// GET /employees/table?company_unit_id=&limit=&offset=&tenant_id=  → { items: EmployeeTableRow[]; total: number }
// PATCH /employees/bulk  body { changes: { id: string; row_version: string; fields: Record<string, unknown> }[] }
//   → 200 { updated: number; items: EmployeeTableRow[] } | 400 { message, errors: Record<`${id}.${field}`, string> } | 409
```
`sequence` = `offset + posição` na ordenação `full_name, id`; **não** é identificador. `row_version` = `to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` (precisão de microssegundos; comparar sempre no SQL, nunca via `Date` do JS).

- [ ] **Step 1: Failing e2e** — adicionar a `employees-official-table.e2e-spec.ts`:
```ts
it('GET /employees/table devolve datas como texto, sequence calculado e total', async () => { /* cria 1 com birth_date '1990-03-05'; espera items[0].birth_date === '1990-03-05' e typeof sequence === 'number' */ });
it('GET /employees/table respeita paginação e filtro por filial', async () => { /* 3 funcionários, limit=2 → items.length 2, total 3 */ });
it('PATCH /employees/bulk aplica alterações e devolve a tabela atualizada', async () => { /* muda position e cbo_code de 2 funcionários com row_version atual; espera 200, updated 2, valores novos persistidos via novo GET */ });
it('PATCH /employees/bulk é atômico: um inválido reprova todos', async () => { /* 1 válido + 1 com cpf inválido → 400 com errors["<id>.cpf"]; GET mostra o válido NÃO alterado */ });
it('PATCH /employees/bulk com row_version velha dá 409 e não altera nada', async () => {});
it('PATCH /employees/bulk não altera funcionário de outro tenant (id desconhecido → 404, sem vazar existência)', async () => { /* cria funcionário no tenant B via superuser (TestDb); empresa A tenta alterar → 404 */ });
it('PATCH /employees/bulk rejeita técnico (403) e lote vazio ou > 200 (400)', async () => {});
it('filial de outro tenant em company_unit_id → 400 "Filial não encontrada"', async () => {});
```
Escrever cada corpo de teste por completo seguindo o padrão do arquivo (os comentários acima definem a asserção obrigatória; **o executor não pode deixar o corpo vazio**).

- [ ] **Step 2: Run to verify it fails** — comando da Task 3 → FAIL (rotas inexistentes; `GET /employees/table` hoje cairia em `:id`).

- [ ] **Step 3: Implementar**
  - `bulk-update-employees.dto.ts`:
```ts
export class BulkEmployeeChangeDto { id: string; row_version: string; fields: Record<string, unknown>; }
export class BulkUpdateEmployeesDto { changes: BulkEmployeeChangeDto[]; }
```
  - Service — constante `TABLE_COLUMNS` com `to_char(birth_date,'YYYY-MM-DD') AS birth_date`, idem `admission_date`, e `to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS row_version`.
  - `findTable(client, { tenantId?, companyUnitId?, limit, offset })`: `limit` 1–200 (default 50), `offset` ≥ 0; `WHERE` por tenant (se informado) e filial; `ORDER BY full_name, id`; `sequence` via `offset + ROW_NUMBER() OVER (ORDER BY full_name, id)`; `total` por `COUNT(*)` com os mesmos filtros. RLS continua sendo a barreira; `tenant_id` do parâmetro só é aceito para admin/técnico/parceiro (mesma regra do `findAll` atual).
  - `bulkUpdate(client, changes, callerRole)`:
    1. `changes.length` 1–200, senão `BadRequestException`.
    2. `normalizeEmployeeInput` por mudança; acumular `errors[`${id}.${field}`]`; se houver, `throw new BadRequestException({ message: 'Há campos inválidos', errors })`.
    3. `SELECT id, to_char(...) AS row_version FROM employees WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE` (ordem fixa evita deadlock). Ids ausentes → `NotFoundException('Funcionário não encontrado')` (mesma mensagem para inexistente e de outro tenant).
    4. `row_version` diferente → `ConflictException('Esta linha foi alterada por outra pessoa. Atualize a tabela e refaça a edição.')`.
    5. Para cada mudança com `fields` não vazios: `await this.update(client, id, values, callerRole)` (reaproveita checagem de filial/cargo/limite de plano).
    6. Retornar `{ updated, items }` relendo as linhas pelo `ANY($1)` com `TABLE_COLUMNS`.
  - Controller — **declarar `@Get('table')` e `@Patch('bulk')` ANTES de `@Get(':id')`/`@Patch(':id')`** (senão `table`/`bulk` viram `:id`):
```ts
@Get('table')
findTable(@Query() q: { tenant_id?: string; company_unit_id?: string; limit?: string; offset?: string }, @Req() req: any) { /* mesma regra de tenant_id obrigatório p/ técnico/parceiro do findAll */ }

@Roles('empresa', 'admin')
@Patch('bulk')
bulkUpdate(@Body() dto: BulkUpdateEmployeesDto, @Req() req: any) {
  return req.withTenantContext((client: any) => this.employees.bulkUpdate(client, dto.changes ?? [], req.user.role));
}
```

- [ ] **Step 4: Run to verify passes** — comando da Task 3 → PASS nos 8 casos; reexecutar os 4 specs antigos de employees (sem regressão).

- [ ] **Step 5: Isolamento** — rodar no ensaio `tenant-isolation-sweep` (ver `npm run test:isolation`) e `tenant-context-callsites` (unit) → sem novas falhas além do baseline listado em Global Constraints.

---

### Task 5: Lib e componente da tabela (frontend)

**Files:** Create `frontend/src/lib/employees-table.ts`, `frontend/src/components/FuncionariosTable.tsx`; Test `frontend/src/lib/__tests__/employees-table.test.ts`, `frontend/src/components/__tests__/FuncionariosTable.test.tsx`

**Interfaces — Consumes:** contrato da Task 4. **Produces:**
```ts
export interface EmployeeTableRow { /* idêntico ao backend */ }
export const EDITABLE_COLUMNS: { key: keyof EmployeeTableRow; label: string; type: 'text' | 'date' | 'sex' | 'cbo' }[];
export function diffRows(original: EmployeeTableRow[], draft: EmployeeTableRow[]): { id: string; row_version: string; fields: Record<string, string | null> }[];
export function formatCpf(cpf: string): string;           // 52998224725 -> 529.982.247-25
export function isoToBr(iso: string | null): string;       // 2020-01-05 -> 05/01/2020 (sem new Date)
export function brToIso(br: string): string | null;
```

- [ ] **Step 1: Failing tests da lib** — `employees-table.test.ts`: `formatCpf` mascara; `isoToBr('2020-01-05') === '05/01/2020'` e `isoToBr(null) === ''`; `brToIso('05/01/2020') === '2020-01-05'` e `brToIso('99/99/2020') === null`; `diffRows` devolve **somente** linhas/campos alterados, com `row_version` da linha original, e `[]` quando nada mudou.
- [ ] **Step 2: Run** — `cd /opt/Montese/frontend && npx vitest run src/lib/__tests__/employees-table.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar a lib** (funções puras; `isoToBr`/`brToIso` por split de string, nunca `new Date`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Failing tests do componente** — `FuncionariosTable.test.tsx` (padrão de `shell.test.tsx`; `fetch` mockado com `vi.stubGlobal`):
  - carrega `GET /api/employees/table` e mostra as 10 colunas do modelo (`Qtde`, `Funcionário`, `Matrícula eSocial`, `CPF`, `Data de nascimento`, `Sexo`, `Função/Cargo`, `Data de admissão`, `CBO`, `Descrição da atividade`) e `Qtde` vem do `sequence`;
  - "Editar tabela" habilita inputs e mostra "Confirmar alterações"/"Cancelar";
  - alterar uma célula a destaca (`data-changed="true"`) e "Confirmar alterações" envia `PATCH /api/employees/bulk` só com o diff; só após a resposta 200 aparece "Alterações salvas" e a tabela é recarregada do backend;
  - "Cancelar" descarta o rascunho (valor volta ao original, sem `PATCH`);
  - resposta 400 com `errors` mostra a mensagem do campo e **mantém a edição aberta**; 409 mostra a mensagem de conflito;
  - "Atualizar tabela" refaz o `GET` (não reaproveita estado local);
  - matrícula `00012345678` e CBO `051210` aparecem com zeros à esquerda;
  - sem alterações, "Confirmar alterações" fica desabilitado.
- [ ] **Step 6: Run** → FAIL.
- [ ] **Step 7: Implementar `FuncionariosTable.tsx`** — `'use client'`; token de `localStorage.getItem('montese_token')` (padrão `EpisPanel`); props `{ tenantId?: string }` (técnico/admin usa `?tenant_id=`); estados `original`, `draft`, `editing`, `saving`, `message`, `fieldErrors`; `<table>` com `overflow-x-auto` e, abaixo de `md`, layout em cartões (cada célula com `<span>` de rótulo); inputs com `aria-label` = rótulo da coluna + nome do funcionário; mensagens em `role="status"`/`role="alert"`; estilos com tokens `dash-*` já usados no projeto. Em `Confirmar`, converter datas `brToIso` antes do envio; data inválida bloqueia o envio com mensagem na célula.
- [ ] **Step 8: Run** `npx vitest run src/lib/__tests__/employees-table.test.ts src/components/__tests__/FuncionariosTable.test.tsx` → PASS.

---

### Task 6: Página, menu e cadastro manual

**Files:** Create `frontend/src/app/empresa/funcionarios/page.tsx`; Modify `frontend/src/lib/dashboard/menu.ts:32`; Create/extend component for manual add inside `FuncionariosTable.tsx` (ou `NovoFuncionarioForm.tsx` se passar de ~250 linhas); Test: acrescentar a `FuncionariosTable.test.tsx` e ajustar `shell.test.tsx` se ele assertar o href antigo.

- [ ] **Step 1: Failing tests** — (a) menu: o item "Funcionários" aponta para `/empresa/funcionarios` com `implemented: true` (teste em `dashboard/__tests__/shell.test.tsx` ou novo `menu.test.ts`); (b) "Adicionar funcionário" abre formulário com os campos do modelo, `POST /api/employees` com `cpf` e demais campos, e após 201 a tabela recarrega via `GET /api/employees/table` e mostra o novo registro; erro 400/409 do backend aparece em português sem fechar o formulário.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implementar** — `menu.ts:32`: `{ href: '/empresa/funcionarios', label: 'Funcionários', icon: Users, implemented: true }`; `page.tsx` segue o molde de `app/empresa/epis/page.tsx` (guarda de token, `PageHeader titulo="Funcionários"`, `DashSkin`, `Card`, `max-w-6xl` por causa das 10 colunas); seletor de filial usando o endpoint de filiais já usado em `FuncionariosForm.tsx` (confirmar o caminho lendo o arquivo antes — **NÃO VERIFICADO** até lá).
- [ ] **Step 4: Run** testes dos Steps anteriores + suíte do dashboard: `npx vitest run src/components/dashboard src/components/__tests__ src/lib` → sem novas falhas.
- [ ] **Step 5: Qualidade** — `npx tsc --noEmit` (0 erros) e `npm run lint` (baseline: 3 avisos antigos conhecidos em `MatrizForm`, `FireSafetyEquipmentPanel`, `AdminBrand` — o lint usa `--max-warnings=0`, então reportar que ele já falha no HEAD por eles, sem corrigir).
- [ ] **Step 6: Conferência visual** — subir o frontend de desenvolvimento e capturar tela larga e estreita (receita Playwright/sharp da memória `project_visual_qa_tooling`), anexando as imagens ao relatório; **não** declarar "responsivo" sem a captura.

---

### Task 7: Verificação final e entrega da fatia

- [ ] **Step 1:** backend `npx tsc --noEmit` → 0 erros; unit completo (`jest-unit.json`) → apenas as 3 falhas de baseline; e2e dos 5 specs de employees + `tenant-isolation-sweep` no ensaio → todos passam.
- [ ] **Step 2:** invocar `superpowers:verification-before-completion` e colar saídas reais dos comandos no relatório, rotulando VERIFICADO / NÃO VERIFICADO.
- [ ] **Step 3: Revisão independente (regra do projeto):** acionar `montese-qa` (diff real + critérios) e `montese-seguranca` (RLS, `bulk` entre tenants, 404 sem vazamento, logs sem CPF) — agentes diferentes de quem implementou. Corrigir achados e reexecutar os testes afetados.
- [ ] **Step 4: Relatório da fatia** (formato do item 14 do pedido): funcionalidades, arquivos, tabelas/campos, testes e resultados, pendências, confirmação de que **nenhum dado existente foi alterado** (migration só adiciona colunas NULL) e que **nada foi aplicado em produção**.

## Auto-revisão contra a spec
- §2 campos: Tasks 2, 3, 5 (10 colunas; `Qtde` calculada). §3 decisões 1–4: fora da fatia 1 (revisão/IA/histórico) — por design. §4 migration: Task 2. §5 backend: `GET /employees/table` e `PATCH /employees/bulk` na Task 4; `history`, `documents`, `extractions` ficam nas fatias 2–4. §6 frontend: botões Atualizar/Editar/Confirmar/Cancelar + cadastro manual (Tasks 5–6); **"Anexar documento" é adiado para a fatia 3** (sem função antes disso). §8 testes desta fatia cobrem os itens 1–5, 13, 14, 16, 17 do pedido (cadastro, exibição, edição/confirmação, cancelamento, persistência, zeros, permissões, compatibilidade, fluxos existentes); 6–12 e 15 pertencem às fatias 2–4.
- Tipos: `EmployeeTableRow`, `row_version`, `sequence`, `fields` iguais em Tasks 4 e 5.
- Riscos desta fatia: validação de dígito verificador pode quebrar fixtures antigos (tratado na Task 3 Step 4); ordem de rotas `table`/`bulk` antes de `:id` (Task 4); `updated_at` com microssegundos (tratado por `row_version` em texto).
