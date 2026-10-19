# EPI — Ficha de controle e PDF (Subsistema 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar, no backend, a ficha de controle de EPI por funcionário (a partir do livro de movimentações), a prévia em PDF, a emissão de versões numeradas e imutáveis guardadas no R2 e a verificação de integridade.

**Architecture:** `EpiFichaService` lê o livro (`epi_movements`) e as entregas legadas e monta a ficha em JSON (CPF mascarado). `buildFichaPdf` (pdfkit, `bufferPages`) desenha cabeçalho, tabela, termo (rascunho) e o rodapé de marca em todas as páginas. A emissão congela um instantâneo canônico (hash), gera o PDF, guarda os bytes no R2 e grava `epi_ficha_documents` (imutável) sob trava do funcionário. Verificação recalcula o SHA-256 do arquivo guardado.

**Tech Stack:** NestJS, TypeScript, PostgreSQL (RLS), `pdfkit` (já em uso), `R2Service`, class-validator, Jest + supertest.

**Spec:** `docs/superpowers/specs/2026-10-14-epi-ficha-pdf-design.md` (depende do subsistema 1: `docs/superpowers/specs/2026-10-14-epi-cadastro-movimentacoes-design.md`).

## Global Constraints

- **Sem `git commit`, `push`, `reset`, `stash`, `checkout`, `add`**: o proprietário decide os commits. Os passos "Entrega" listam os arquivos e param. Trabalhar só em `/opt/montese-epi` (branch `feat/epi-estoque`, que já contém o subsistema 1, também sem commit). Nunca em `/opt/Montese`.
- **Testes só em ensaio descartável** (Postgres+Redis próprios, senhas aleatórias, chaves falsas), nunca contra produção; nunca ler/imprimir `.env`/`ensaio.env`; nunca tocar nos containers `montese_*`, Docker Compose, Nginx, Redis/banco de produção; nunca `run-backend-tests.sh` (usa `.env` de produção). Scripts já existentes no scratchpad da sessão: `ensaio-up.sh`, `ensaio-migrate.sh`, `ensaio-down.sh`, `run-be.sh`, `run-be-rl.sh` (ver "Como rodar os testes"). A suíte e2e completa num só processo estoura memória: rodar por padrões de suíte ou em lotes; o rate limit exige `RATE_LIMIT_MAX` alto no ensaio (`run-be-rl.sh`).
- **R2 nos testes sempre mockado** (`overrideProvider(R2Service)` com Map em memória; padrão de `test/certificates-service.e2e-spec.ts`): nunca gravar no bucket real.
- Migration **aditiva**, número **0082** (reconfirmar o próximo livre antes de entregar: 0080 está em `feat/tabela-oficial-funcionarios`, 0081 é do subsistema 1).
- Isolamento entre empresas é crítico: tabela nova com `ENABLE` + `FORCE ROW LEVEL SECURITY` e a policy padrão do módulo; `tenant_id` nunca vem do corpo; toda leitura/escrita via `req.withTenantContext`.
- **Entrada inválida nunca vira 500**: todo parâmetro de rota/consulta/corpo validado (ParseUUIDPipe, class-validator com `DATE_ONLY`/`NO_NUL` de `src/epi/dto/epi-dto-rules.ts`); datas/horas aceitas só nos formatos que o Postgres aceita.
- **CPF mascarado** (`***.456.789-**`) na resposta JSON, no instantâneo e no PDF; nunca CPF completo em log, erro ou instantâneo.
- **Sem selo/imagem de assinatura sem confirmação; nada de "ICP-Brasil"; termo marcado RASCUNHO**, sem citar norma/artigo/prazo.
- **Rodapé de marca em todas as páginas**: imagem `montese-footer.png` (3200×672) na largura total da página A4 (≈125 pt de altura), com a linha técnica (código, versão, página X de Y, prefixo do hash do instantâneo) logo acima. Os ativos ficam em `backend/src/common/pdf/assets/` e são copiados para o `dist` pelo `nest-cli.json` (precedente: schemas XSD do eSocial). **Não alterar o Dockerfile.**
- Rotular o que for afirmado: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO; só afirmar que algo funciona com comando + saída.

## Como rodar os testes (ensaio descartável)

Scripts em `/tmp/claude-0/-opt-Montese/8c2ba2eb-4c11-43d4-a3d0-94e201ce53cb/scratchpad/` (recriar o ensaio se não estiver no ar: `ensaio-down.sh; ensaio-up.sh; ensaio-migrate.sh`, que aplica as migrations de `/opt/montese-epi/backend/db/migrations`):
- `run-be-rl.sh <e2e|unit> "<padrões de spec>" <arquivo-de-log>` roda o jest do worktree no ensaio com `RATE_LIMIT_MAX` alto. Redirecionar o log para arquivo e lê-lo com Read/Grep; nunca `| tail` direto; execuções em sequência.
- Typecheck/build: container `node:20-bookworm-slim` montando `/opt/montese-epi/backend` (ro) e o cache `nm/` do scratchpad (ver `run-be.sh` como modelo): `npx tsc --noEmit -p tsconfig.json` e `npx nest build`.
- Reaplicar migration corrigida: `ensaio-down.sh`, `ensaio-up.sh`, `ensaio-migrate.sh`.

## File Structure

- Create `backend/db/migrations/0082_epi_ficha_documents.sql` — colunas de `employees`, tabela `epi_ficha_documents`, trigger, RLS, REVOKE TRUNCATE.
- Modify `backend/src/employees/employees.service.ts`, `employees.controller.ts`, `dto/create-employee.dto.ts`, `dto/update-employee.dto.ts` — matrícula e setor (validação manual).
- Create `backend/src/epi-ficha/` : `epi-ficha.module.ts`, `epi-ficha.controller.ts`, `epi-ficha.service.ts` (ficha + emissão + documentos + verificação), `epi-ficha.types.ts`, `epi-ficha-term.ts` (termo rascunho), `cpf-mask.util.ts`, `canonical-json.util.ts`, `dto/ficha-query.dto.ts`, `dto/issue-ficha.dto.ts`.
- Create `backend/src/common/pdf/brand-footer.util.ts` e `backend/src/common/pdf/assets/` (`montese-footer.png`, `montese-logo.png`).
- Create `backend/src/epi-ficha/ficha-pdf.util.ts` — `buildFichaPdf`.
- Modify `backend/src/app.module.ts` (registrar `EpiFichaModule`), `backend/nest-cli.json` (assets), `backend/src/epi/epi-stock.service.ts` (fuso de `delivered_at`).
- Tests em `backend/test/`: `epi-ficha-schema.e2e-spec.ts`, `employees-registration.e2e-spec.ts`, `epi-ficha-data.e2e-spec.ts`, `epi-ficha-pdf.unit-spec.ts`, `epi-ficha-pdf.e2e-spec.ts`, `epi-ficha-issue.e2e-spec.ts`, `epi-ficha-permissions.e2e-spec.ts`; unit `cpf-mask.unit-spec.ts`, `canonical-json.unit-spec.ts`.
- Docs: `docs/architecture/epi-ficha.md`.

---

### Task 1: Migration 0082 e matrícula/setor em `employees`

**Files:**
- Create: `backend/db/migrations/0082_epi_ficha_documents.sql`
- Modify: `backend/src/employees/employees.service.ts`, `backend/src/employees/employees.controller.ts`, `backend/src/employees/dto/create-employee.dto.ts`, `backend/src/employees/dto/update-employee.dto.ts`
- Test: `backend/test/epi-ficha-schema.e2e-spec.ts`, `backend/test/employees-registration.e2e-spec.ts`

**Interfaces:**
- Produces: colunas `employees.registration_number`, `employees.department`; tabela `epi_ficha_documents(id, tenant_id, employee_id, version, document_code, file_key, file_sha256, snapshot_sha256, snapshot, term_version, issued_by_user_id, issued_at, idempotency_key)`; função `epi_ficha_documents_immutable()`.

- [ ] **Step 1: Subir o ensaio com as migrations existentes (até 0081)**

Run: `ensaio-down.sh; ensaio-up.sh; ensaio-migrate.sh` (scripts do scratchpad). Expected: `[ok] 0081_epi_stock_ledger.sql` como última linha.

- [ ] **Step 2: Escrever o teste de schema (RED)**

`backend/test/epi-ficha-schema.e2e-spec.ts`:

```ts
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('Schema de epi_ficha_documents (0082)', () => {
  let db: TestDb;
  let sql: Client;
  let app: Client;
  let tenantId: string;
  let userId: string;
  let employeeId: string;
  let otherTenantId: string;
  let otherEmployeeId: string;

  const insertDoc = (over: Record<string, unknown> = {}) =>
    sql.query(
      `INSERT INTO epi_ficha_documents
         (tenant_id, employee_id, version, document_code, file_key, file_sha256, snapshot_sha256, snapshot,
          term_version, issued_by_user_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb,'rascunho-1',$8,$9) RETURNING id`,
      [
        over.tenant ?? tenantId, over.employee ?? employeeId, over.version ?? 1,
        over.code ?? `FEPI-T-${randomUUID().slice(0, 6)}`, 'k/arquivo.pdf', over.fileHash ?? HASH_A,
        over.snapHash ?? HASH_B, userId, over.key ?? `idem-${randomUUID()}`,
      ],
    );

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();
    app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    const a = await db.createTenantWithUser('Empresa Ficha Schema A');
    const b = await db.createTenantWithUser('Empresa Ficha Schema B');
    tenantId = a.tenantId; userId = a.userId; employeeId = a.employeeId;
    otherTenantId = b.tenantId; otherEmployeeId = b.employeeId;
  });

  afterAll(async () => {
    await db.cleanup();
    await sql.end(); await app.end();
    await db.disconnect();
  });

  it('employees ganha registration_number e department (nulos por padrão)', async () => {
    const r = await sql.query('SELECT registration_number, department FROM employees WHERE id = $1', [employeeId]);
    expect(r.rows[0]).toEqual({ registration_number: null, department: null });
  });

  it('rejeita hash que não é hex de 64 e versão < 1', async () => {
    await expect(insertDoc({ fileHash: 'xyz' })).rejects.toMatchObject({ code: '23514' });
    await expect(insertDoc({ version: 0 })).rejects.toMatchObject({ code: '23514' });
  });

  it('versão, código e idempotency_key são únicos por empresa', async () => {
    await insertDoc({ version: 1, code: 'FEPI-U-0001', key: 'idem-u-1' });
    await expect(insertDoc({ version: 1, code: 'FEPI-U-0002', key: 'idem-u-2' })).rejects.toMatchObject({ code: '23505' });
    await expect(insertDoc({ version: 2, code: 'FEPI-U-0001', key: 'idem-u-3' })).rejects.toMatchObject({ code: '23505' });
    await expect(insertDoc({ version: 2, code: 'FEPI-U-0004', key: 'idem-u-1' })).rejects.toMatchObject({ code: '23505' });
  });

  it('é imutável: UPDATE e DELETE diretos falham com 42501', async () => {
    const { rows } = await insertDoc({ version: 7, code: 'FEPI-I-0001', key: 'idem-i-1' });
    await expect(sql.query(`UPDATE epi_ficha_documents SET file_sha256 = $2 WHERE id = $1`, [rows[0].id, HASH_B])).rejects.toMatchObject({ code: '42501' });
    await expect(sql.query('DELETE FROM epi_ficha_documents WHERE id = $1', [rows[0].id])).rejects.toMatchObject({ code: '42501' });
  });

  it('TRUNCATE é negado à role da aplicação', async () => {
    await expect(app.query('TRUNCATE epi_ficha_documents')).rejects.toMatchObject({ code: '42501' });
  });

  it('RLS: a empresa B não vê nem insere documentos da A', async () => {
    await insertDoc({ version: 20, code: 'FEPI-R-0001', key: 'idem-r-1' });
    const asTenant = async (tid: string, fn: (c: Client) => Promise<void>) => {
      await app.query('BEGIN');
      try {
        await app.query(`SELECT set_config('app.role','empresa',true), set_config('app.tenant_id',$1,true)`, [tid]);
        await fn(app);
      } finally {
        await app.query('ROLLBACK');
      }
    };
    await asTenant(otherTenantId, async (c) => {
      const r = await c.query('SELECT 1 FROM epi_ficha_documents WHERE tenant_id = $1', [tenantId]);
      expect(r.rowCount).toBe(0);
      await expect(
        c.query(
          `INSERT INTO epi_ficha_documents (tenant_id, employee_id, version, document_code, file_key, file_sha256,
             snapshot_sha256, snapshot, term_version, issued_by_user_id, idempotency_key)
           VALUES ($1,$2,1,'FEPI-X-1','k',$3,$3,'{}','t',$4,'idem-x-1')`,
          [tenantId, employeeId, HASH_A, userId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
    await asTenant(tenantId, async (c) => {
      const r = await c.query('SELECT 1 FROM epi_ficha_documents WHERE tenant_id = $1', [tenantId]);
      expect(r.rowCount).toBeGreaterThan(0);
    });
    expect(otherEmployeeId).toBeTruthy();
  });

  it('exclusão do tenant cascateia mesmo com documentos emitidos', async () => {
    const c = await db.createTenantWithUser('Empresa Ficha Cascade');
    await sql.query(
      `INSERT INTO epi_ficha_documents (tenant_id, employee_id, version, document_code, file_key, file_sha256,
         snapshot_sha256, snapshot, term_version, issued_by_user_id, idempotency_key)
       VALUES ($1,$2,1,'FEPI-C-0001','k',$3,$3,'{}','t',$4,'idem-c-1')`,
      [c.tenantId, c.employeeId, HASH_A, c.userId],
    );
    await sql.query('DELETE FROM tenants WHERE id = $1', [c.tenantId]);
    const left = await sql.query('SELECT 1 FROM epi_ficha_documents WHERE tenant_id = $1', [c.tenantId]);
    expect(left.rowCount).toBe(0);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `run-be-rl.sh e2e "epi-ficha-schema" <log>` — Expected: FAIL (`relation "epi_ficha_documents" does not exist`).

- [ ] **Step 4: Escrever a migration**

`backend/db/migrations/0082_epi_ficha_documents.sql`:

```sql
-- Módulo EPI, subsistema 2: documentos emitidos da ficha de controle de EPI + matrícula/setor do funcionário.
-- Aditiva. Ver docs/superpowers/specs/2026-10-14-epi-ficha-pdf-design.md.

ALTER TABLE employees
  ADD COLUMN registration_number TEXT,
  ADD COLUMN department TEXT,
  ADD CONSTRAINT chk_employees_registration_number_len CHECK (registration_number IS NULL OR length(registration_number) <= 60),
  ADD CONSTRAINT chk_employees_department_len CHECK (department IS NULL OR length(department) <= 120);

CREATE TABLE epi_ficha_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  version INT NOT NULL CHECK (version >= 1),
  document_code TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_sha256 TEXT NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_sha256 TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot JSONB NOT NULL,
  term_version TEXT NOT NULL,
  issued_by_user_id UUID NOT NULL REFERENCES users(id),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (tenant_id, employee_id, version),
  UNIQUE (tenant_id, document_code),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX idx_epi_ficha_documents_tenant ON epi_ficha_documents (tenant_id);
CREATE INDEX idx_epi_ficha_documents_employee ON epi_ficha_documents (employee_id, version DESC);

-- Imutabilidade (mesmo padrão da 0081): UPDATE nunca; DELETE direto nunca; a exclusão em cascata de um
-- tenant inteiro roda dentro do trigger de RI (pg_trigger_depth() > 1) e só vale com o tenant já removido
-- (epi_tenant_row_exists, SECURITY DEFINER da 0081, consulta sem RLS).
CREATE FUNCTION epi_ficha_documents_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 AND NOT epi_tenant_row_exists(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'epi_ficha_documents é imutável (emita uma nova versão)' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_epi_ficha_documents_immutable
  BEFORE UPDATE OR DELETE ON epi_ficha_documents
  FOR EACH ROW EXECUTE FUNCTION epi_ficha_documents_immutable();

ALTER TABLE epi_ficha_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE epi_ficha_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY epi_ficha_documents_isolation ON epi_ficha_documents USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

REVOKE TRUNCATE ON epi_ficha_documents FROM montese_app;
```

- [ ] **Step 5: Aplicar e ver o teste passar**

Run: `ensaio-migrate.sh` (Expected `[ok] 0082_epi_ficha_documents.sql`) e `run-be-rl.sh e2e "epi-ficha-schema" <log>` — Expected: 6 testes PASS. Se o cascade falhar com "imutável", investigar a condição do trigger (nunca afrouxar o DELETE direto).

- [ ] **Step 6: Teste da matrícula/setor (RED)**

`backend/test/employees-registration.e2e-spec.ts` (mesmo cabeçalho de app/token dos outros e2e de employees; ver `employees-tenant-id.e2e-spec.ts`):

```ts
it('cria e edita funcionário com matrícula e setor', async () => {
  const c = await request(srv).post('/employees').set(auth()).send({
    full_name: 'Func Matrícula', cpf: '39053344705', registration_number: 'M-0042', department: 'Manutenção',
  });
  expect(c.status).toBe(201);
  expect(c.body).toMatchObject({ registration_number: 'M-0042', department: 'Manutenção' });
  const u = await request(srv).patch(`/employees/${c.body.id}`).set(auth()).send({ department: 'Produção' });
  expect(u.status).toBe(200);
  expect(u.body).toMatchObject({ registration_number: 'M-0042', department: 'Produção' });
});

it('rejeita matrícula/setor longos ou com NUL (400, nunca 500)', async () => {
  const base = { full_name: 'Func Inválido', cpf: '52998224725' };
  for (const bad of [{ registration_number: 'x'.repeat(61) }, { department: 'y'.repeat(121) }, { department: 'a\u0000b' }, { registration_number: 123 }]) {
    const r = await request(srv).post('/employees').set(auth()).send({ ...base, ...bad });
    expect(r.status).toBe(400);
  }
});
```
Run → FAIL (campos ignorados / aceitos).

- [ ] **Step 7: Implementar matrícula/setor em employees (sem decorators)**

Os DTOs de funcionário **não têm decorators** e o `ValidationPipe` global usa `whitelist`+`forbidNonWhitelisted`: **não adicionar decorators só aos campos novos** (o pipe passaria a rejeitar os campos antigos). Validar manualmente:

`employees.service.ts` — acrescentar a `UPDATABLE_FIELDS` `'registration_number'` e `'department'`; à interface `Employee` `registration_number: string | null; department: string | null;`; e antes do INSERT/UPDATE:

```ts
const FICHA_TEXT_LIMITS = { registration_number: 60, department: 120 } as const;

function assertOptionalFichaText(field: keyof typeof FICHA_TEXT_LIMITS, value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || value.length > FICHA_TEXT_LIMITS[field] || value.includes('\u0000')) {
    throw new BadRequestException(`${field} inválido`);
  }
}
```
Chamar `assertOptionalFichaText` para os dois campos em `create()` e `update()`; incluir as colunas no `INSERT INTO employees (...)` (dois parâmetros novos, `?? null`). `employees.controller.ts` (`create` e `@Patch(':id')`): repassar `registration_number` e `department` ao serviço. DTOs: acrescentar `registration_number?: string; department?: string;` (propriedades simples, como as demais).

Se o `ValidationPipe` rejeitar os campos novos por whitelist (verifique no teste), aplicar decorators `@IsOptional()` **a todas as propriedades** do DTO afetado, e rodar todos os e2e `employees-*` para provar que nada quebrou (ver Step 8).

- [ ] **Step 8: Rodar e ver passar + regressão**

Run: `run-be-rl.sh e2e "employees-registration epi-ficha-schema employees-tenant-id employees-limit employees-company-unit employees-import employees-import-flexible" <log>`. Expected: PASS em todas (as de import podem ter falhas pré-existentes por R2; comparar com o baseline do subsistema 1: `employees-*` passavam).

- [ ] **Step 9: Entrega**

Listar os arquivos criados/alterados e parar; o proprietário decide o commit.

---

### Task 2: Dados da ficha (JSON), máscara de CPF e fuso de `delivered_at`

**Files:**
- Create: `backend/src/epi-ficha/epi-ficha.types.ts`, `cpf-mask.util.ts`, `epi-ficha-term.ts`, `epi-ficha.service.ts` (parte da ficha), `epi-ficha.controller.ts` (parte JSON), `epi-ficha.module.ts`, `dto/ficha-query.dto.ts`
- Modify: `backend/src/app.module.ts`, `backend/src/epi/epi-stock.service.ts` (`delivered_at` em America/Sao_Paulo)
- Test: `backend/test/cpf-mask.unit-spec.ts`, `backend/test/epi-ficha-data.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `maskCpf(cpf: string): string`
  - `EPI_TERM: { version: string; draft: true; title: string; paragraphs: string[] }`
  - `FichaLine`, `Ficha` (abaixo) e `EpiFichaService.getFicha(client: PoolClient, employeeId: string, filters: FichaFilters): Promise<Ficha>`
  - `GET /epi-fichas/employees/:employeeId` (query `from`, `to`, `signature_status`)

- [ ] **Step 1: Tipos**

`backend/src/epi-ficha/epi-ficha.types.ts`:

```ts
export const SIGNATURE_STATUSES = ['legado', 'pendente', 'assinada', 'recusada', 'expirada', 'presencial', 'estornada'] as const;
export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

export interface FichaFilters {
  from?: string; // AAAA-MM-DD
  to?: string; // AAAA-MM-DD
  signature_status?: SignatureStatus;
}

export interface FichaLine {
  source: 'livro' | 'legado';
  movement_id: string | null;
  delivery_id: string | null;
  date: string; // AAAA-MM-DD (America/Sao_Paulo)
  type: 'entrega' | 'troca' | 'devolucao' | 'estorno' | 'entrega_legada';
  epi_description: string;
  manufacturer: string | null;
  model: string | null;
  ca_number: string;
  quantity: number | null; // null no legado: nunca inventar quantidade
  reason: string | null;
  signature_status: SignatureStatus | null;
  reversed: boolean;
}

export interface Ficha {
  company: {
    name: string; trade_name: string | null; cnpj: string;
    address: string; // linha única montada dos campos de endereço; 'não informado' se vazio
  };
  employee: {
    id: string; full_name: string; cpf_masked: string; registration_number: string | null;
    department: string | null; position: string | null; admission_date: string | null;
    company_unit_name: string | null; status: string;
  };
  filters: FichaFilters;
  lines: FichaLine[];
  term: { version: string; draft: boolean; title: string; paragraphs: string[] };
}
```

- [ ] **Step 2: Máscara de CPF (teste unitário RED → GREEN)**

`backend/test/cpf-mask.unit-spec.ts`:

```ts
import { maskCpf } from '../src/epi-ficha/cpf-mask.util';

describe('maskCpf', () => {
  it('mostra só os dígitos 4 a 9', () => {
    expect(maskCpf('39053344705')).toBe('***.533.447-**');
  });
  it('aceita CPF formatado', () => {
    expect(maskCpf('390.533.447-05')).toBe('***.533.447-**');
  });
  it('valor inválido nunca vaza dígitos', () => {
    expect(maskCpf('123')).toBe('***.***.***-**');
    expect(maskCpf('')).toBe('***.***.***-**');
  });
});
```

`backend/src/epi-ficha/cpf-mask.util.ts`:

```ts
// CPF protegido: só os dígitos 4 a 9 ficam visíveis. Entrada inválida nunca devolve dígito.
export function maskCpf(cpf: string | null | undefined): string {
  const digits = (cpf ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return '***.***.***-**';
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
}
```
Run: `run-be-rl.sh unit "cpf-mask" <log>` — RED antes do util, GREEN depois.

- [ ] **Step 3: Termo (rascunho)**

`backend/src/epi-ficha/epi-ficha-term.ts`:

```ts
// TEXTO EM RASCUNHO: precisa de revisão do proprietário/jurídico antes de uso definitivo.
// Não cita norma, artigo ou prazo. A versão é gravada em cada documento emitido.
export const EPI_TERM = {
  version: 'rascunho-1',
  draft: true,
  title: 'Termo de recebimento e responsabilidade (RASCUNHO)',
  paragraphs: [
    'Declaro ter recebido os equipamentos de proteção individual (EPI) relacionados nesta ficha, nas quantidades e datas indicadas.',
    'Comprometo-me a utilizá-los apenas para a finalidade a que se destinam, seguindo as orientações recebidas sobre o uso correto.',
    'Comprometo-me a conservá-los e guardá-los em local adequado, e a comunicar imediatamente ao responsável qualquer defeito, dano ou alteração que os torne impróprios para uso.',
    'Comprometo-me a devolvê-los quando solicitado ou ao final de sua utilização, nos termos do procedimento da empresa.',
  ],
} as const;
```

- [ ] **Step 4: Teste e2e dos dados da ficha (RED)**

`backend/test/epi-ficha-data.e2e-spec.ts` — fixtures como `epi-stock-movements.e2e-spec.ts` (app, `db`, token da empresa, EPI com abertura de 10 via `POST /epis/:id/movements`, funcionário `t.employeeId`, e um segundo tenant). Casos:

```ts
it('lista só movimentações reais do funcionário, em ordem cronológica, com CPF mascarado', async () => {
  const e = await mov(epiId, { type: 'entrega', quantity: 2, employee_id: employeeId, idempotency_key: key() });
  await mov(epiId, { type: 'devolucao', quantity: 1, employee_id: employeeId, reason: 'Fim de uso', idempotency_key: key() });
  const r = await request(srv).get(`/epi-fichas/employees/${employeeId}`).set(auth());
  expect(r.status).toBe(200);
  expect(r.body.employee.cpf_masked).toMatch(/^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
  expect(JSON.stringify(r.body)).not.toMatch(/\b\d{11}\b/); // nenhum CPF cru
  const types = r.body.lines.map((l: any) => l.type);
  expect(types).toEqual(['entrega', 'devolucao']);
  expect(r.body.lines[0]).toMatchObject({ quantity: 2, signature_status: 'pendente', reversed: false, source: 'livro' });
  expect(r.body.term.draft).toBe(true);
});

it('entrega estornada aparece marcada, o estorno aparece, nada some', async () => {
  const e = await mov(epiId, { type: 'entrega', quantity: 1, employee_id: employeeId2, idempotency_key: key() });
  await request(srv).post(`/epis/movements/${e.body.id}/reversal`).set(auth()).send({ reason: 'Entrega lançada por engano', idempotency_key: key() });
  const r = await request(srv).get(`/epi-fichas/employees/${employeeId2}`).set(auth());
  const lines = r.body.lines;
  expect(lines.find((l: any) => l.type === 'entrega')).toMatchObject({ reversed: true, signature_status: 'estornada' });
  expect(lines.some((l: any) => l.type === 'estorno')).toBe(true);
});

it('entrega legada entra como legado, sem quantidade inventada', async () => {
  await request(srv).post(`/epis/${epiId}/deliveries`).set(auth())
    .send({ employee_id: employeeId3, delivered_at: '2026-08-25', signed_by_name: 'Maria Responsável' });
  const r = await request(srv).get(`/epi-fichas/employees/${employeeId3}`).set(auth());
  expect(r.body.lines).toHaveLength(1);
  expect(r.body.lines[0]).toMatchObject({ source: 'legado', type: 'entrega_legada', quantity: null, date: '2026-08-25', signature_status: 'legado' });
});

it('filtros por período e por situação da assinatura; datas inválidas -> 400', async () => {
  const ok = await request(srv).get(`/epi-fichas/employees/${employeeId}?from=2020-01-01&to=2099-12-31&signature_status=pendente`).set(auth());
  expect(ok.status).toBe(200);
  expect(ok.body.lines.every((l: any) => l.signature_status === 'pendente')).toBe(true);
  for (const q of ['from=abc', 'from=2026-02-30', 'to=2026', 'signature_status=nada', 'x=1', 'from=2026-01-01&from=2026-01-02']) {
    expect((await request(srv).get(`/epi-fichas/employees/${employeeId}?${q}`).set(auth())).status).toBe(400);
  }
  expect((await request(srv).get('/epi-fichas/employees/abc').set(auth())).status).toBe(400);
});

it('isolamento: empresa B recebe 404 para funcionário da A', async () => {
  expect((await request(srv).get(`/epi-fichas/employees/${employeeId}`).set(authB())).status).toBe(404);
});

it('matrícula e setor "não informado" viram null; preenchidos aparecem', async () => {
  await sql.query('UPDATE employees SET registration_number = $2, department = $3 WHERE id = $1', [employeeId, 'M-7', 'Obra']);
  const r = await request(srv).get(`/epi-fichas/employees/${employeeId}`).set(auth());
  expect(r.body.employee).toMatchObject({ registration_number: 'M-7', department: 'Obra' });
});

it('ficha muito grande é recusada com 400 (limite de linhas)', async () => {
  const big = await db.createTenantWithUser('Empresa Ficha Grande');
  const bigToken = (await request(srv).post('/auth/login').send({ email: big.email, password: big.password })).body.access_token;
  const cat = await sql.query('SELECT id FROM epi_catalog_items ORDER BY code LIMIT 1');
  const bigEpi = (await sql.query(
    `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, created_by_user_id) VALUES ($1,$2,'CA-GRANDE',$3) RETURNING id`,
    [big.tenantId, cat.rows[0].id, big.userId],
  )).rows[0].id;
  await sql.query(
    `INSERT INTO epi_movements (tenant_id, tenant_epi_id, type, direction, quantity, balance_after, employee_id, idempotency_key, created_by_user_id)
     SELECT $1, $2, 'devolucao', 1, 1, 1, $3, 'grande-' || g, $4 FROM generate_series(1, 1001) g`,
    [big.tenantId, bigEpi, big.employeeId, big.userId],
  );
  const r = await request(srv).get(`/epi-fichas/employees/${big.employeeId}`).set('Authorization', `Bearer ${bigToken}`);
  expect(r.status).toBe(400);
  expect(r.body.message).toMatch(/muito grande/i);
  const ok = await request(srv).get(`/epi-fichas/employees/${employeeId}`).set(auth());
  expect(ok.status).toBe(200); // o limite não afeta fichas normais
});

it('delivered_at da entrega do livro usa o dia de São Paulo', async () => {
  // 2026-10-14T01:30:00Z = 13/10 22:30 em São Paulo
  const r = await mov(epiId, { type: 'entrega', quantity: 1, employee_id: employeeId4, occurred_at: '2026-10-14T01:30:00Z', idempotency_key: key() });
  expect(r.status).toBe(201);
  const d = await sql.query(`SELECT to_char(delivered_at, 'YYYY-MM-DD') AS d FROM employee_epi_deliveries WHERE id = $1`, [r.body.delivery_id]);
  expect(d.rows[0].d).toBe('2026-10-13');
  const f = await request(srv).get(`/epi-fichas/employees/${employeeId4}`).set(auth());
  expect(f.body.lines[0].date).toBe('2026-10-13');
});
```
Fixtures necessárias (declarar no `beforeAll`): `employeeId` (do tenant A), `employeeId2`, `employeeId3`, `employeeId4` (funcionários extras do tenant A, inseridos com o `sql` superusuário e CPFs válidos distintos), `epiId` com abertura de 100 unidades, `authB()` para uma segunda empresa. Run → FAIL (rota inexistente).

- [ ] **Step 5: DTO de consulta**

`backend/src/epi-ficha/dto/ficha-query.dto.ts` (padrão de `src/epi/dto/list-epi-movements-query.dto.ts`: leia-o e siga, inclusive a rejeição de parâmetro repetido/desconhecido):

```ts
import { IsIn, IsISO8601, IsOptional, IsString, Matches } from 'class-validator';
import { DATE_ONLY } from '../../epi/dto/epi-dto-rules';
import { SIGNATURE_STATUSES } from '../epi-ficha.types';

export class FichaQueryDto {
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) to?: string;
  @IsOptional() @IsIn(SIGNATURE_STATUSES as unknown as string[]) signature_status?: string;
}
```

- [ ] **Step 6: Serviço da ficha**

`backend/src/epi-ficha/epi-ficha.service.ts` (início):

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { maskCpf } from './cpf-mask.util';
import { EPI_TERM } from './epi-ficha-term';
import { Ficha, FichaFilters, FichaLine } from './epi-ficha.types';

export const MAX_FICHA_LINES = 1000;
const TZ = `'America/Sao_Paulo'`;

@Injectable()
export class EpiFichaService {
  async getFicha(client: PoolClient, employeeId: string, filters: FichaFilters): Promise<Ficha> {
    const emp = await client.query(
      `SELECT e.id, e.tenant_id, e.full_name, e.cpf, e.registration_number, e.department, e.position,
              to_char(e.admission_date, 'YYYY-MM-DD') AS admission_date, e.status, cu.name AS company_unit_name
       FROM employees e LEFT JOIN company_units cu ON cu.id = e.company_unit_id
       WHERE e.id = $1`,
      [employeeId],
    );
    const e = emp.rows[0];
    if (!e) throw new NotFoundException('Funcionário não encontrado');

    const t = await client.query(
      `SELECT name, trade_name, cnpj, address_street, address_number, address_complement, address_neighborhood,
              address_city, address_state, address_zip
       FROM tenants WHERE id = $1`,
      [e.tenant_id],
    );
    const tn = t.rows[0];

    const params: unknown[] = [employeeId];
    const mWhere: string[] = [];
    const lWhere: string[] = [];
    if (filters.from) { params.push(filters.from); mWhere.push(`(m.occurred_at AT TIME ZONE ${TZ})::date >= $${params.length}::date`); lWhere.push(`d.delivered_at >= $${params.length}::date`); }
    if (filters.to) { params.push(filters.to); mWhere.push(`(m.occurred_at AT TIME ZONE ${TZ})::date <= $${params.length}::date`); lWhere.push(`d.delivered_at <= $${params.length}::date`); }
    if (filters.signature_status) {
      params.push(filters.signature_status);
      mWhere.push(`COALESCE(d.signature_status, '') = $${params.length}`);
      lWhere.push(`d.signature_status = $${params.length}`);
    }
    const mExtra = mWhere.length ? ` AND ${mWhere.join(' AND ')}` : '';
    const lExtra = lWhere.length ? ` AND ${lWhere.join(' AND ')}` : '';

    const rows = await client.query(
      `SELECT * FROM (
         SELECT 'livro'::text AS source, m.id AS movement_id, m.delivery_id,
                to_char(m.occurred_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS date, m.occurred_at AS sort_at,
                m.type, eci.description AS epi_description, te.manufacturer, te.model, te.ca_number,
                m.quantity, m.reason, d.signature_status,
                EXISTS (SELECT 1 FROM epi_movements r WHERE r.reverses_movement_id = m.id) AS reversed
         FROM epi_movements m
         JOIN tenant_epis te ON te.id = m.tenant_epi_id
         JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
         LEFT JOIN employee_epi_deliveries d ON d.id = m.delivery_id
         WHERE m.employee_id = $1 AND m.type IN ('entrega','troca','devolucao','estorno')${mExtra}
         UNION ALL
         SELECT 'legado'::text, NULL, d.id, to_char(d.delivered_at, 'YYYY-MM-DD'), d.delivered_at::timestamptz,
                'entrega_legada', eci.description, te.manufacturer, te.model, te.ca_number,
                NULL::int, NULL, d.signature_status, false
         FROM employee_epi_deliveries d
         JOIN tenant_epis te ON te.id = d.tenant_epi_id
         JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
         WHERE d.employee_id = $1 AND d.signature_status = 'legado'
           AND NOT EXISTS (SELECT 1 FROM epi_movements mm WHERE mm.delivery_id = d.id)${lExtra}
       ) x ORDER BY sort_at, movement_id NULLS LAST
       LIMIT ${MAX_FICHA_LINES + 1}`,
      params,
    );
    if (rows.rows.length > MAX_FICHA_LINES) {
      throw new BadRequestException('Ficha muito grande: restrinja o período');
    }

    const lines: FichaLine[] = rows.rows.map((r) => ({
      source: r.source, movement_id: r.movement_id, delivery_id: r.delivery_id, date: r.date, type: r.type,
      epi_description: r.epi_description, manufacturer: r.manufacturer, model: r.model, ca_number: r.ca_number,
      quantity: r.quantity, reason: r.reason, signature_status: r.signature_status, reversed: r.reversed,
    }));

    const addr = [
      [tn.address_street, tn.address_number].filter(Boolean).join(', '),
      tn.address_complement, tn.address_neighborhood,
      [tn.address_city, tn.address_state].filter(Boolean).join('/'), tn.address_zip,
    ].filter(Boolean).join(' - ');

    return {
      company: { name: tn.name, trade_name: tn.trade_name, cnpj: tn.cnpj, address: addr || 'não informado' },
      employee: {
        id: e.id, full_name: e.full_name, cpf_masked: maskCpf(e.cpf), registration_number: e.registration_number,
        department: e.department, position: e.position, admission_date: e.admission_date,
        company_unit_name: e.company_unit_name, status: e.status,
      },
      filters,
      lines,
      term: { version: EPI_TERM.version, draft: EPI_TERM.draft, title: EPI_TERM.title, paragraphs: [...EPI_TERM.paragraphs] },
    };
  }
}
```

Observação ao executor: o `signature_status` do filtro em linhas do livro só existe para entrega/troca (via `d`); devolução/estorno ficam de fora quando o filtro é aplicado — documente isso no teste. A `ORDER BY ... movement_id NULLS LAST` precisa de um desempate estável: use `sort_at, source, COALESCE(movement_id::text, delivery_id::text)`.

- [ ] **Step 7: Controller, módulo e registro**

`epi-ficha.controller.ts`:

```ts
import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { EpiFichaService } from './epi-ficha.service';
import { FichaQueryDto } from './dto/ficha-query.dto';

@Controller('epi-fichas')
export class EpiFichaController {
  constructor(private readonly ficha: EpiFichaService) {}

  @Roles('empresa', 'tecnico', 'parceiro', 'admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @Get('employees/:employeeId')
  getFicha(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() q: FichaQueryDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.ficha.getFicha(client, employeeId, { from: q.from, to: q.to, signature_status: q.signature_status as any }),
    );
  }
}
```
`epi-ficha.module.ts`: `@Module({ controllers: [EpiFichaController], providers: [EpiFichaService], exports: [EpiFichaService] })`. Registrar `EpiFichaModule` em `app.module.ts` junto de `EpiModule`.

- [ ] **Step 8: Fuso de `delivered_at` (pendência do subsistema 1)**

Em `backend/src/epi/epi-stock.service.ts`, no INSERT de `employee_epi_deliveries` do `beforeInsert`, trocar `COALESCE($4::timestamptz, now())::date` por `(COALESCE($4::timestamptz, now()) AT TIME ZONE 'America/Sao_Paulo')::date`. Acrescentar o teste "delivered_at usa o dia de São Paulo" do Step 4 (occurred_at `2026-10-14T01:30:00Z` → `2026-10-13`).

- [ ] **Step 9: Rodar e ver passar + regressão**

Run: `run-be-rl.sh e2e "epi-ficha-data epi-ficha-schema epi-stock-movements epi-stock-concurrency epi-stock-permissions epi-deliveries epis-crud" <log>`, `run-be-rl.sh unit "cpf-mask epi-by-function tenant-context-callsites" <log>`, `tsc --noEmit`. Expected: PASS. Se `tenant-context-callsites` reclamar de arquivo novo, seguir o padrão exigido (nunca editar a lista ALLOWED sem justificar).

- [ ] **Step 10: Entrega** (listar arquivos; não comitar).

---

### Task 3: Rodapé de marca, PDF da ficha e prévia

**Files:**
- Create: `backend/src/common/pdf/assets/montese-footer.png`, `backend/src/common/pdf/assets/montese-logo.png`, `backend/src/common/pdf/brand-footer.util.ts`, `backend/src/epi-ficha/ficha-pdf.util.ts`
- Modify: `backend/nest-cli.json`, `backend/src/epi-ficha/epi-ficha.controller.ts`
- Test: `backend/test/epi-ficha-pdf.unit-spec.ts`, `backend/test/epi-ficha-pdf.e2e-spec.ts`

**Interfaces:**
- Consumes: `Ficha`, `FichaLine` (Task 2).
- Produces:
  - `drawBrandFooter(doc: PDFKit.PDFDocument, opts: { technicalLine: string }): void` e a constante `BRAND_FOOTER_HEIGHT(pageWidth: number): number`
  - `buildFichaPdf(ficha: Ficha, meta: FichaPdfMeta): Promise<Buffer>` com `FichaPdfMeta = { preview: boolean; documentCode?: string; version?: number; issuedAt?: string; snapshotHash?: string }`
  - `GET /epi-fichas/employees/:employeeId/preview.pdf`

- [ ] **Step 1: Copiar os ativos de marca (leitura das origens, sem apagar nada)**

```bash
mkdir -p /opt/montese-epi/backend/src/common/pdf/assets
cp /tmp/claude-0/-opt-Montese/8c2ba2eb-4c11-43d4-a3d0-94e201ce53cb/images/2.png /opt/montese-epi/backend/src/common/pdf/assets/montese-footer.png
cp /opt/Montese/frontend/public/brand/logo-horizontal-transparente.png /opt/montese-epi/backend/src/common/pdf/assets/montese-logo.png
file /opt/montese-epi/backend/src/common/pdf/assets/*.png
```
Expected: `montese-footer.png: PNG image data, 3200 x 672`. (A foto `images/1.jpg` não é usada nesta tarefa; fica para decisão do proprietário.)

- [ ] **Step 2: nest-cli.json copia os ativos para o dist**

`backend/nest-cli.json`: acrescentar ao array `assets`:
```json
{ "include": "common/pdf/assets/**/*", "outDir": "dist/src", "watchAssets": false }
```
(manter a entrada existente dos XSD). Não tocar no Dockerfile.

- [ ] **Step 3: Teste unitário do PDF (RED)**

`backend/test/epi-ficha-pdf.unit-spec.ts`:

```ts
import { buildFichaPdf } from '../src/epi-ficha/ficha-pdf.util';
import { extractPdfText } from '../src/common/pdf/pdf-text.util'; // ver a assinatura real do util existente

const base = {
  company: { name: 'Empresa Teste Ltda', trade_name: null, cnpj: '12345678000190', address: 'Rua A, 10 - Centro - Natal/RN - 59000000' },
  employee: { id: 'x', full_name: 'Fulano de Tal', cpf_masked: '***.533.447-**', registration_number: null, department: null, position: 'Soldador', admission_date: '2024-01-10', company_unit_name: null, status: 'ativo' },
  filters: {},
  term: { version: 'rascunho-1', draft: true, title: 'Termo de recebimento e responsabilidade (RASCUNHO)', paragraphs: ['Declaro ter recebido...'] },
};
const line = (i: number, over: Record<string, unknown> = {}) => ({
  source: 'livro', movement_id: `m${i}`, delivery_id: `d${i}`, date: '2026-10-14', type: 'entrega',
  epi_description: `Capacete ${i}`, manufacturer: 'Fab', model: 'M1', ca_number: '12345', quantity: 1, reason: 'Entrega',
  signature_status: 'pendente', reversed: false, ...over,
});

describe('buildFichaPdf', () => {
  it('gera PDF válido de prévia com marca NÃO EMITIDO, CPF mascarado e "não informada" para matrícula', async () => {
    const buf = await buildFichaPdf({ ...base, lines: [line(1)] } as any, { preview: true });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = await extractPdfText(buf);
    expect(text).toContain('NÃO EMITIDO');
    expect(text).toContain('***.533.447-**');
    expect(text).toContain('não informada');
    expect(text).not.toMatch(/\b\d{11}\b/);
    expect(text).toContain('RASCUNHO');
  });

  it('PDF emitido traz código, versão e prefixo do hash; sem a marca de prévia', async () => {
    const buf = await buildFichaPdf({ ...base, lines: [line(1)] } as any, {
      preview: false, documentCode: 'FEPI-20261014-ABC123', version: 3, issuedAt: '2026-10-14T12:00:00.000Z', snapshotHash: 'a'.repeat(64),
    });
    const text = await extractPdfText(buf);
    expect(text).toContain('FEPI-20261014-ABC123');
    expect(text).toContain('Versão 3');
    expect(text).toContain('aaaaaaaaaaaa'); // prefixo do hash do instantâneo (12 caracteres)
    expect(text).not.toContain('NÃO EMITIDO');
  });

  it('muitas linhas geram várias páginas, cada uma com "Página X de Y"', async () => {
    const lines = Array.from({ length: 120 }, (_, i) => line(i));
    const buf = await buildFichaPdf({ ...base, lines } as any, { preview: true });
    const text = await extractPdfText(buf);
    const m = text.match(/Página (\d+) de (\d+)/g) ?? [];
    expect(m.length).toBeGreaterThan(1);
    expect(m[0]).toMatch(/Página 1 de \d+/);
  });

  it('não desenha selo/imagem de assinatura: pendente aparece como texto', async () => {
    const text = await extractPdfText(await buildFichaPdf({ ...base, lines: [line(1)] } as any, { preview: true }));
    expect(text).toContain('Pendente');
    expect(text).not.toMatch(/assinado digitalmente|ICP/i);
  });

  it('nome e termo com acentos e entrega legada sem quantidade ("—")', async () => {
    const text = await extractPdfText(await buildFichaPdf({
      ...base, lines: [line(1, { source: 'legado', type: 'entrega_legada', quantity: null, signature_status: 'legado' })],
    } as any, { preview: true }));
    expect(text).toContain('Histórico anterior ao módulo');
    expect(text).toContain('—');
  });
});
```
Run → FAIL (módulo inexistente). Executor: confirmar o nome e a assinatura reais de `extractPdfText` em `src/common/pdf/pdf-text.util.ts` (e se rodar com `NODE_OPTIONS=--experimental-vm-modules`, como os demais unit de PDF) e ajustar o import.

- [ ] **Step 4: Rodapé de marca (helper reutilizável)**

`backend/src/common/pdf/brand-footer.util.ts`:

```ts
import { join } from 'path';

const FOOTER_IMAGE = join(__dirname, 'assets', 'montese-footer.png');
const FOOTER_RATIO = 672 / 3200; // altura/largura da imagem fornecida
const TECH_LINE_HEIGHT = 18;

export function brandFooterHeight(pageWidth: number): number {
  return pageWidth * FOOTER_RATIO + TECH_LINE_HEIGHT;
}

// Desenha, na página atual, a linha técnica e a faixa de marca em largura total. Zera a margem
// inferior só durante o desenho (senão o pdfkit abre uma página nova ao escrever na margem).
export function drawBrandFooter(doc: PDFKit.PDFDocument, technicalLine: string): void {
  const { width, height } = doc.page;
  const bannerH = width * FOOTER_RATIO;
  const saved = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.image(FOOTER_IMAGE, 0, height - bannerH, { width });
  doc.font('Helvetica').fontSize(7.5).fillColor('#444444')
    .text(technicalLine, 50, height - bannerH - TECH_LINE_HEIGHT + 4, { width: width - 100, align: 'center', lineBreak: false });
  doc.page.margins.bottom = saved;
  doc.fillColor('#000000');
}
```

- [ ] **Step 5: Construtor do PDF**

`backend/src/epi-ficha/ficha-pdf.util.ts` — pdfkit com `bufferPages: true`; margens `{ top: 95, bottom: brandFooterHeight(595.28) + 14, left: 40, right: 40 }`; conteúdo desenhado primeiro, cabeçalho/rodapé/marca d'água em loop ao final (`doc.bufferedPageRange()`, `doc.switchToPage(i)`):

```ts
import PDFDocument from 'pdfkit';
import { join } from 'path';
import { brandFooterHeight, drawBrandFooter } from '../common/pdf/brand-footer.util';
import { Ficha, FichaLine } from './epi-ficha.types';

export interface FichaPdfMeta {
  preview: boolean;
  documentCode?: string;
  version?: number;
  issuedAt?: string;
  snapshotHash?: string;
}

const LOGO = join(__dirname, '..', 'common', 'pdf', 'assets', 'montese-logo.png');
const SIGNATURE_LABEL: Record<string, string> = {
  pendente: 'Pendente', assinada: 'Assinada', recusada: 'Recusada', expirada: 'Expirada',
  presencial: 'Registrada presencialmente', legado: 'Histórico anterior ao módulo', estornada: 'Estornada',
};
const TYPE_LABEL: Record<string, string> = {
  entrega: 'Entrega', troca: 'Troca', devolucao: 'Devolução', estorno: 'Estorno', entrega_legada: 'Entrega (histórico anterior ao módulo)',
};
const COLS = [
  { key: 'date', label: 'Data', w: 58 },
  { key: 'epi', label: 'Equipamento', w: 150 },
  { key: 'ca', label: 'CA', w: 44 },
  { key: 'qty', label: 'Qtd.', w: 30 },
  { key: 'mov', label: 'Movimento / motivo', w: 118 },
  { key: 'sig', label: 'Assinatura', w: 115 },
] as const;

export function buildFichaPdf(ficha: Ficha, meta: FichaPdfMeta): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', bufferPages: true, margins: { top: 95, bottom: Math.ceil(brandFooterHeight(595.28)) + 14, left: 40, right: 40 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom;

    // 1) Identificação
    doc.font('Helvetica-Bold').fontSize(14).text('FICHA DE CONTROLE DE EPI', { align: 'center' });
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(10).text('Empresa contratante');
    doc.font('Helvetica').fontSize(9)
      .text(`${ficha.company.name}${ficha.company.trade_name ? ` (${ficha.company.trade_name})` : ''}`)
      .text(`CNPJ: ${ficha.company.cnpj}`).text(`Endereço: ${ficha.company.address}`);
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(10).text('Colaborador');
    const e = ficha.employee;
    doc.font('Helvetica').fontSize(9)
      .text(`Nome: ${e.full_name}   CPF: ${e.cpf_masked}`)
      .text(`Matrícula: ${e.registration_number ?? 'não informada'}   Setor: ${e.department ?? 'não informado'}   Função: ${e.position ?? 'não informada'}`)
      .text(`Admissão: ${e.admission_date ?? 'não informada'}   Situação: ${e.status}${e.company_unit_name ? `   Unidade: ${e.company_unit_name}` : ''}`);
    doc.moveDown(0.8);

    // 2) Histórico (tabela com quebra de página e cabeçalho repetido)
    const drawHeader = () => {
      let x = left;
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8);
      for (const c of COLS) { doc.text(c.label, x, y, { width: c.w - 4 }); x += c.w; }
      doc.moveTo(left, y + 11).lineTo(left + COLS.reduce((s, c) => s + c.w, 0), y + 11).stroke();
      doc.y = y + 14;
    };
    doc.font('Helvetica-Bold').fontSize(10).text('Histórico de equipamentos', left, doc.y);
    doc.moveDown(0.3);
    drawHeader();
    if (ficha.lines.length === 0) {
      doc.font('Helvetica').fontSize(9).text('Nenhuma movimentação registrada no período.', left);
    }
    for (const l of ficha.lines) {
      const cells = rowCells(l);
      doc.font('Helvetica').fontSize(8);
      const h = Math.max(...COLS.map((c, i) => doc.heightOfString(cells[i], { width: c.w - 4 }))) + 4;
      if (doc.y + h > bottomLimit()) { doc.addPage(); drawHeader(); }
      let x = left;
      const y = doc.y;
      COLS.forEach((c, i) => { doc.text(cells[i], x, y, { width: c.w - 4 }); x += c.w; });
      doc.y = y + h;
    }

    // 3) Termo
    if (doc.y + 120 > bottomLimit()) doc.addPage();
    doc.moveDown(1).font('Helvetica-Bold').fontSize(10).text(ficha.term.title, left);
    doc.font('Helvetica').fontSize(8.5);
    for (const p of ficha.term.paragraphs) doc.moveDown(0.3).text(p, left, undefined, { width: 515 });
    doc.moveDown(0.6).fontSize(8)
      .text(`Versão do termo: ${ficha.term.version}${ficha.term.draft ? ' (texto em rascunho, pendente de revisão)' : ''}`);
    doc.moveDown(0.4).text('A situação de assinatura de cada entrega consta na coluna "Assinatura". Não há assinatura eletrônica registrada além da indicada em cada linha.');

    // 4) Cabeçalho, marca d'água e rodapé em todas as páginas
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const saved = doc.page.margins.top;
      doc.page.margins.top = 0;
      doc.image(LOGO, 40, 22, { height: 40 });
      doc.font('Helvetica').fontSize(8).fillColor('#333333')
        .text(`${ficha.company.name} — CNPJ ${ficha.company.cnpj}`, 200, 30, { width: 355, align: 'right', lineBreak: false });
      doc.moveTo(40, 72).lineTo(555, 72).strokeColor('#0b6b3a').stroke().strokeColor('#000000');
      doc.page.margins.top = saved;
      if (meta.preview) {
        doc.save().fillOpacity(0.12).fillColor('#000000').font('Helvetica-Bold').fontSize(70)
          .rotate(-35, { origin: [297, 420] }).text('NÃO EMITIDO', 90, 380, { lineBreak: false }).restore();
      }
      const tech = meta.preview
        ? `Prévia não emitida — Página ${i + 1} de ${range.count}`
        : `${meta.documentCode} — Versão ${meta.version} — Emitido em ${meta.issuedAt} — Hash do instantâneo ${meta.snapshotHash?.slice(0, 12)} — Página ${i + 1} de ${range.count}`;
      drawBrandFooter(doc, tech);
    }
    doc.end();
  });
}

function rowCells(l: FichaLine): string[] {
  const equip = [l.epi_description, [l.manufacturer, l.model].filter(Boolean).join(' ')].filter(Boolean).join('\n');
  const mov = `${TYPE_LABEL[l.type] ?? l.type}${l.reversed ? ' (ESTORNADA)' : ''}${l.reason ? `\n${l.reason}` : ''}`;
  return [l.date, equip, l.ca_number, l.quantity == null ? '—' : String(l.quantity), mov, l.signature_status ? SIGNATURE_LABEL[l.signature_status] ?? l.signature_status : '—'];
}
```
Notas ao executor: (a) o texto da prévia/emitido deve ser extraível pelo `extractPdfText` (texto de verdade, não imagem); (b) `Matrícula: não informada` deve aparecer literalmente (teste); (c) ajuste coordenadas se o rodapé de marca sobrepuser conteúdo: o `bottomLimit()` já desconta a margem inferior; (d) a marca d'água não pode impedir extração do texto principal; (e) confirme a contagem de páginas e que **nenhuma página extra em branco** é criada pelo loop de rodapé.

- [ ] **Step 6: Rota de prévia e teste e2e**

No controller:

```ts
@Roles('empresa', 'tecnico', 'parceiro', 'admin')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
@Get('employees/:employeeId/preview.pdf')
async previewPdf(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Query() q: FichaQueryDto, @Req() req: any, @Res() res: any) {
  const ficha = await req.withTenantContext((client: any) =>
    this.ficha.getFicha(client, employeeId, { from: q.from, to: q.to, signature_status: q.signature_status as any }),
  );
  const pdf = await buildFichaPdf(ficha, { preview: true });
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="ficha-epi-previa.pdf"', 'Cache-Control': 'private, no-store' });
  res.send(pdf);
}
```
(`@Res()` sem passthrough: o interceptor de auditoria global ainda registra a chamada GET? Só mutações são auditadas; ok.) `backend/test/epi-ficha-pdf.e2e-spec.ts`: 200 + `application/pdf` + `%PDF-`; texto contém `NÃO EMITIDO` e o nome do funcionário; **nenhum registro** novo em `epi_ficha_documents` após a prévia; 404 para outra empresa; 400 para filtro inválido; pdf com `Cache-Control: private, no-store`.

- [ ] **Step 7: Rodar**

Run: `run-be-rl.sh unit "epi-ficha-pdf cpf-mask" <log>` (com `NODE_OPTIONS=--experimental-vm-modules` se o script não definir), `run-be-rl.sh e2e "epi-ficha-pdf epi-ficha-data" <log>`, `tsc --noEmit`, `nest build` e **conferir que os ativos foram copiados**: dentro do container, `ls dist/src/common/pdf/assets/` lista os dois PNG. Expected: PASS.

- [ ] **Step 8: Verificação visual (NÃO substitui os testes)**

Gerar um PDF de prévia de exemplo num script descartável do scratchpad (dados fictícios), converter a primeira página em imagem (se houver ferramenta disponível: `pdftoppm` ou a skill de PDF) e inspecionar: logo no cabeçalho, tabela legível, faixa de marca no rodapé sem sobrepor texto, "Página X de Y". Se não houver ferramenta, reportar "NÃO VERIFICADO visualmente".

- [ ] **Step 9: Entrega** (listar arquivos, inclusive os binários copiados; não comitar).

---

### Task 4: Emissão, versões, download e verificação

**Files:**
- Create: `backend/src/epi-ficha/canonical-json.util.ts`, `dto/issue-ficha.dto.ts`
- Modify: `backend/src/epi-ficha/epi-ficha.service.ts`, `epi-ficha.controller.ts`
- Test: `backend/test/canonical-json.unit-spec.ts`, `backend/test/epi-ficha-issue.e2e-spec.ts`, `backend/test/epi-ficha-permissions.e2e-spec.ts`

**Interfaces:**
- Consumes: `getFicha`, `buildFichaPdf`, `maskCpf`, `R2Service` (`putObject`, `getObject`, `deleteObject`).
- Produces: `canonicalJson(value: unknown): string`, `sha256Hex(data: string | Buffer): string`; `EpiFichaService.issue(client, employeeId, dto, userId)`, `listDocuments`, `getDocumentFile`, `verify`; rotas `POST /epi-fichas/employees/:employeeId/issue`, `GET /epi-fichas/employees/:employeeId/documents`, `GET /epi-fichas/documents/:documentId/download`, `GET /epi-fichas/documents/:documentId/verify`.

- [ ] **Step 1: JSON canônico e hash (unit RED → GREEN)**

`backend/test/canonical-json.unit-spec.ts`:

```ts
import { canonicalJson, sha256Hex } from '../src/epi-ficha/canonical-json.util';

describe('canonicalJson', () => {
  it('ordena as chaves recursivamente e ignora a ordem de entrada', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it('trata null e omite undefined, como o JSON', () => {
    expect(canonicalJson({ a: null, b: undefined })).toBe('{"a":null}');
  });
  it('sha256Hex tem 64 hex e muda com qualquer byte', () => {
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('abc')).not.toBe(sha256Hex('abd'));
  });
});
```

`backend/src/epi-ficha/canonical-json.util.ts`:

```ts
import { createHash } from 'crypto';

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = sortKeys((v as Record<string, unknown>)[k]);
      return acc;
    }, {});
  }
  return v;
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
```

- [ ] **Step 2: Teste e2e da emissão (RED)**

`backend/test/epi-ficha-issue.e2e-spec.ts` — app com `overrideProvider(R2Service).useValue(fakeR2)` (Map em memória com `putObject/getObject/deleteObject/getPresignedDownloadUrl`; `getObject` de chave ausente lança `Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })`), fixtures do Task 2 (EPI com abertura e uma entrega ao funcionário). Casos:

```ts
it('emite a versão 1, grava o arquivo no R2 e o registro; o hash confere', async () => {
  const r = await request(srv).post(`/epi-fichas/employees/${employeeId}/issue`).set(auth()).send({ idempotency_key: key() });
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ version: 1 });
  expect(r.body.document_code).toMatch(/^FEPI-\d{8}-[0-9A-F]{6}$/);
  const row = (await sql.query('SELECT * FROM epi_ficha_documents WHERE id = $1', [r.body.id])).rows[0];
  const stored = fakeR2.store.get(row.file_key)!;
  expect(sha256Hex(stored)).toBe(row.file_sha256);
  expect(stored.subarray(0, 5).toString()).toBe('%PDF-');
  expect(JSON.stringify(row.snapshot)).not.toMatch(/\b\d{11}\b/); // sem CPF no instantâneo
  expect(row.snapshot_sha256).toBe(sha256Hex(canonicalJson(row.snapshot)));
});

it('emissões seguintes viram versão 2, 3...; as anteriores permanecem intactas', async () => {
  const v1 = await issue(emp, { idempotency_key: key() });
  const h1 = (await sql.query('SELECT file_sha256 FROM epi_ficha_documents WHERE id = $1', [v1.body.id])).rows[0].file_sha256;
  const v2 = await issue(emp, { idempotency_key: key() });
  expect(v2.status).toBe(201);
  expect(v2.body.version).toBe(v1.body.version + 1);
  const again = (await sql.query('SELECT file_sha256 FROM epi_ficha_documents WHERE id = $1', [v1.body.id])).rows[0].file_sha256;
  expect(again).toBe(h1);
  const list = await request(srv).get(`/epi-fichas/employees/${emp}/documents`).set(auth());
  expect(list.body.map((d: any) => d.version)).toEqual([...list.body.map((d: any) => d.version)].sort((a, b) => b - a));
  expect(JSON.stringify(list.body)).not.toMatch(/file_key|"snapshot"/); // lista pública não expõe chave do R2 nem o instantâneo
});

it('mesma idempotency_key devolve o mesmo documento (200); outros filtros ou outro funcionário -> 409', async () => {
  const k = key();
  const a = await issue(emp, { idempotency_key: k });
  const b = await issue(emp, { idempotency_key: k });
  expect(a.status).toBe(201);
  expect(b.status).toBe(200);
  expect(b.body.id).toBe(a.body.id);
  expect((await issue(emp, { idempotency_key: k, from: '2020-01-01' })).status).toBe(409);
  expect((await issue(otherEmp, { idempotency_key: k })).status).toBe(409);
  const n = await sql.query('SELECT count(*)::int AS n FROM epi_ficha_documents WHERE idempotency_key = $1', [k]);
  expect(n.rows[0].n).toBe(1);
});

it('emissões concorrentes (8 em paralelo, chaves diferentes) geram versões distintas e consecutivas', async () => {
  const fresh = freshEmployeeId; // funcionário sem emissões anteriores
  const rs = await Promise.all(Array.from({ length: 8 }, () => issue(fresh, { idempotency_key: key() })));
  expect(rs.every((r) => r.status === 201)).toBe(true);
  expect(rs.map((r) => r.body.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});

it('documento antigo continua íntegro e idêntico depois de mudar o cadastro do funcionário e do EPI', async () => {
  const d = await issue(emp, { idempotency_key: key() });
  const before = Buffer.from((await request(srv).get(`/epi-fichas/documents/${d.body.id}/download`).set(auth()).buffer(true).parse(binaryParser)).body);
  await sql.query(`UPDATE employees SET full_name = 'Nome Alterado Depois', department = 'Outro Setor' WHERE id = $1`, [emp]);
  await request(srv).patch(`/epis/${epiId}`).set(auth()).send({ manufacturer: 'Fabricante Alterado' });
  const after = Buffer.from((await request(srv).get(`/epi-fichas/documents/${d.body.id}/download`).set(auth()).buffer(true).parse(binaryParser)).body);
  expect(sha256Hex(after)).toBe(sha256Hex(before));
  expect((await request(srv).get(`/epi-fichas/documents/${d.body.id}/verify`).set(auth())).body.status).toBe('integro');
  // uma nova emissão reflete o cadastro novo, sem alterar a antiga
  const novo = await issue(emp, { idempotency_key: key() });
  const snap = (await sql.query('SELECT snapshot FROM epi_ficha_documents WHERE id = $1', [novo.body.id])).rows[0].snapshot;
  expect(snap.employee.full_name).toBe('Nome Alterado Depois');
});

it('verify: íntegro; arquivo adulterado no R2 -> divergente; arquivo ausente -> arquivo_ausente', async () => {
  const d = await issue(emp, { idempotency_key: key() });
  const row = (await sql.query('SELECT file_key FROM epi_ficha_documents WHERE id = $1', [d.body.id])).rows[0];
  const verify = async () => (await request(srv).get(`/epi-fichas/documents/${d.body.id}/verify`).set(auth())).body;
  expect((await verify()).status).toBe('integro');
  const orig = fakeR2.store.get(row.file_key)!;
  fakeR2.store.set(row.file_key, Buffer.concat([orig, Buffer.from('x')]));
  const bad = await verify();
  expect(bad.status).toBe('divergente');
  expect(bad.actual_sha256).not.toBe(bad.expected_sha256);
  fakeR2.store.delete(row.file_key);
  expect((await verify()).status).toBe('arquivo_ausente');
  fakeR2.store.set(row.file_key, orig); // restaura
});

it('falha no R2 (putObject lança) não deixa registro nem consome a versão', async () => {
  const count = async () => (await sql.query('SELECT count(*)::int AS n FROM epi_ficha_documents WHERE employee_id = $1', [emp2])).rows[0].n;
  const before = await count();
  fakeR2.failNextPut = true;
  const r = await issue(emp2, { idempotency_key: key() });
  expect(r.status).toBe(502);
  expect(await count()).toBe(before);
  const ok = await issue(emp2, { idempotency_key: key() });
  expect(ok.status).toBe(201);
  expect(ok.body.version).toBe(before + 1);
});

it('falha ao gravar o registro remove o arquivo órfão do R2', async () => {
  const filesBefore = fakeR2.store.size;
  // força violação no INSERT: document_code já existente não é controlável; usa um trigger descartável que rejeita inserts do funcionário emp3
  await sql.query(`CREATE OR REPLACE FUNCTION epi_ficha_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.employee_id = '${emp3}' THEN RAISE EXCEPTION 'rejeitado pelo teste' USING ERRCODE = '23514'; END IF; RETURN NEW; END; $$`);
  await sql.query('CREATE TRIGGER trg_epi_ficha_test_reject BEFORE INSERT ON epi_ficha_documents FOR EACH ROW EXECUTE FUNCTION epi_ficha_test_reject()');
  try {
    const r = await issue(emp3, { idempotency_key: key() });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(fakeR2.store.size).toBe(filesBefore); // nenhum arquivo órfão ficou
  } finally {
    await sql.query('DROP TRIGGER IF EXISTS trg_epi_ficha_test_reject ON epi_ficha_documents');
    await sql.query('DROP FUNCTION IF EXISTS epi_ficha_test_reject()');
  }
});

it('download devolve application/pdf com os mesmos bytes e cabeçalhos privados; outra empresa recebe 404', async () => {
  const d = await issue(emp, { idempotency_key: key() });
  const row = (await sql.query('SELECT file_key, file_sha256 FROM epi_ficha_documents WHERE id = $1', [d.body.id])).rows[0];
  const r = await request(srv).get(`/epi-fichas/documents/${d.body.id}/download`).set(auth()).buffer(true).parse(binaryParser);
  expect(r.status).toBe(200);
  expect(r.headers['content-type']).toMatch(/application\/pdf/);
  expect(r.headers['cache-control']).toBe('private, no-store');
  expect(sha256Hex(Buffer.from(r.body))).toBe(row.file_sha256);
  expect((await request(srv).get(`/epi-fichas/documents/${d.body.id}/download`).set(authB())).status).toBe(404);
  expect((await request(srv).get(`/epi-fichas/documents/${d.body.id}/verify`).set(authB())).status).toBe(404);
});

it('PDF emitido sem assinatura confirmada: "Pendente", sem selo; entrega presencial aparece como Registrada presencialmente', async () => {
  const d = await issue(emp, { idempotency_key: key() });
  const file = fakeR2.store.get((await sql.query('SELECT file_key FROM epi_ficha_documents WHERE id = $1', [d.body.id])).rows[0].file_key)!;
  const text = await extractPdfText(file);
  expect(text).toContain('Pendente');
  expect(text).not.toMatch(/assinado digitalmente|ICP/i);
  expect(text).toContain(d.body.document_code);
  expect(text).toContain(`Versão ${d.body.version}`);
  await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'presencial', signed_at = now(), signed_by_name = 'Responsável' WHERE employee_id = $1`, [emp]);
  const d2 = await issue(emp, { idempotency_key: key() });
  const text2 = await extractPdfText(fakeR2.store.get((await sql.query('SELECT file_key FROM epi_ficha_documents WHERE id = $1', [d2.body.id])).rows[0].file_key)!);
  expect(text2).toContain('Registrada presencialmente');
});

it('entrada inválida -> 400: idempotency_key curta/longa/NUL, filtros inválidos, corpo extra, ids não UUID', async () => {
  for (const body of [{}, { idempotency_key: 'curta' }, { idempotency_key: 'x'.repeat(101) }, { idempotency_key: 'abcdefgh\u0000' },
    { idempotency_key: key(), from: '2026-02-30' }, { idempotency_key: key(), to: 'abc' }, { idempotency_key: key(), signature_status: 'nada' }, { idempotency_key: key(), extra: 1 }]) {
    expect((await issue(emp, body)).status).toBe(400);
  }
  expect((await request(srv).post('/epi-fichas/employees/abc/issue').set(auth()).send({ idempotency_key: key() })).status).toBe(400);
  expect((await request(srv).get('/epi-fichas/documents/abc/download').set(auth())).status).toBe(400);
  expect((await request(srv).get('/epi-fichas/documents/abc/verify').set(auth())).status).toBe(400);
  expect((await request(srv).post(`/epi-fichas/employees/${otherTenantRandomUuid}/issue`).set(auth()).send({ idempotency_key: key() })).status).toBe(404);
});
```
Fixtures do `beforeAll`: `fakeR2 = { store: new Map<string, Buffer>(), failNextPut: false, putObject(k, b) { if (this.failNextPut) { this.failNextPut = false; throw new Error('R2 indisponível (teste)'); } this.store.set(k, b); }, getObject(k) { const v = this.store.get(k); if (!v) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }); return v; }, deleteObject(k) { this.store.delete(k); }, getPresignedDownloadUrl() { return 'x'; } }` e `.overrideProvider(R2Service).useValue(fakeR2)`; helper `issue = (employee, body) => request(srv).post(`/epi-fichas/employees/${employee}/issue`).set(auth()).send(body)`; `binaryParser` (`(res, cb) => { const c: Buffer[] = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }`); funcionários `emp`, `emp2`, `emp3`, `freshEmployeeId`, `otherEmp` (de outra empresa) com `sql` superusuário e CPFs válidos distintos; um EPI com abertura e uma entrega a `emp`; `otherTenantRandomUuid = randomUUID()`; importar `sha256Hex`, `canonicalJson` e `extractPdfText`. Run → FAIL (rotas inexistentes).

- [ ] **Step 3: DTO de emissão**

```ts
import { IsISO8601, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DATE_ONLY, NO_NUL } from '../../epi/dto/epi-dto-rules';
import { SIGNATURE_STATUSES } from '../epi-ficha.types';

export class IssueFichaDto {
  @IsString() @MinLength(8) @MaxLength(100) @Matches(NO_NUL) idempotency_key: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsString() @Matches(DATE_ONLY) @IsISO8601({ strict: true }) to?: string;
  @IsOptional() @IsIn(SIGNATURE_STATUSES as unknown as string[]) signature_status?: string;
}
```

- [ ] **Step 4: Serviço — emissão, listagem, arquivo e verificação**

Acrescentar a `epi-ficha.service.ts` (injetar `R2Service` e `Logger`):

```ts
import { randomBytes } from 'crypto';
import { BadGatewayException, ConflictException } from '@nestjs/common';
import { R2Service } from '../common/r2/r2.service';
import { buildFichaPdf } from './ficha-pdf.util';
import { canonicalJson, sha256Hex } from './canonical-json.util';

@Injectable()
export class EpiFichaService {
  private readonly logger = new Logger(EpiFichaService.name);
  constructor(private readonly r2: R2Service) {}
  // getFicha(...) como na Task 2

  async issue(client: PoolClient, employeeId: string, dto: IssueFichaDto, userId: string): Promise<{ doc: DocumentRow; replayed: boolean }> {
    // 1) trava o funcionário: serializa a numeração de versões do mesmo funcionário
    const lock = await client.query('SELECT id, tenant_id FROM employees WHERE id = $1 FOR UPDATE', [employeeId]);
    const emp = lock.rows[0];
    if (!emp) throw new NotFoundException('Funcionário não encontrado');
    const filters = { from: dto.from, to: dto.to, signature_status: dto.signature_status as FichaFilters['signature_status'] };

    // 2) repetição idempotente: mesmo funcionário e mesmos filtros -> o documento existente
    const prev = await client.query('SELECT * FROM epi_ficha_documents WHERE tenant_id = $1 AND idempotency_key = $2', [emp.tenant_id, dto.idempotency_key]);
    if (prev.rows[0]) {
      const p = prev.rows[0];
      if (p.employee_id !== employeeId || canonicalJson(p.snapshot.filters ?? {}) !== canonicalJson(cleanFilters(filters))) {
        throw new ConflictException('Chave de idempotência já usada em outra operação');
      }
      return { doc: toDocumentRow(p), replayed: true };
    }

    // 3) versão e código
    const v = await client.query('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM epi_ficha_documents WHERE employee_id = $1', [employeeId]);
    const version = Number(v.rows[0].next);
    const issuedAt = new Date().toISOString();
    const code = `FEPI-${issuedAt.slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;

    // 4) instantâneo congelado (sem CPF completo) + hashes + PDF
    const ficha = await this.getFicha(client, employeeId, filters);
    const snapshot = { ...ficha, filters: cleanFilters(filters), version, document_code: code, issued_at: issuedAt, issued_by_user_id: userId };
    const snapshotHash = sha256Hex(canonicalJson(snapshot));
    const pdf = await buildFichaPdf(snapshot, { preview: false, documentCode: code, version, issuedAt, snapshotHash });
    const fileHash = sha256Hex(pdf);

    // 5) R2 primeiro; se o registro falhar, remove o arquivo órfão
    const key = `tenants/${emp.tenant_id}/epi-fichas/${employeeId}/${code}.pdf`;
    try {
      await this.r2.putObject(key, pdf, 'application/pdf');
    } catch (err) {
      this.logger.error(`Falha ao gravar a ficha no R2 (${code})`);
      throw new BadGatewayException('Não foi possível guardar o documento');
    }
    try {
      const ins = await client.query(
        `INSERT INTO epi_ficha_documents (tenant_id, employee_id, version, document_code, file_key, file_sha256,
           snapshot_sha256, snapshot, term_version, issued_by_user_id, issued_at, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12) RETURNING *`,
        [emp.tenant_id, employeeId, version, code, key, fileHash, snapshotHash, JSON.stringify(snapshot), ficha.term.version, userId, issuedAt, dto.idempotency_key],
      );
      return { doc: toDocumentRow(ins.rows[0]), replayed: false };
    } catch (err) {
      await this.r2.deleteObject(key).catch(() => this.logger.error(`Arquivo órfão no R2: ${key}`));
      mapPgError(err);
    }
  }
}
```
Pontos a implementar completos: `cleanFilters` (remove `undefined`), `toDocumentRow` (campos públicos: `id, employee_id, version, document_code, file_sha256, snapshot_sha256, term_version, issued_by_user_id, issued_at` — **sem `snapshot` nem `file_key`**), `listDocuments(client, employeeId)` (ordem `version DESC`, 404 se o funcionário não existe), `getDocumentFile(client, documentId)` → `{ buffer, code }` (busca a linha sob RLS → 404; `r2.getObject` com tratamento: erro `NoSuchKey` → `NotFoundException('Arquivo indisponível')`, outros → `BadGatewayException`), e:

```ts
async verify(client: PoolClient, documentId: string): Promise<{ status: 'integro' | 'divergente' | 'arquivo_ausente'; document_code: string; version: number; expected_sha256: string; actual_sha256: string | null }> {
  const r = await client.query('SELECT id, document_code, version, file_key, file_sha256 FROM epi_ficha_documents WHERE id = $1', [documentId]);
  const d = r.rows[0];
  if (!d) throw new NotFoundException('Documento não encontrado');
  let buf: Buffer;
  try {
    buf = await this.r2.getObject(d.file_key);
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') {
      return { status: 'arquivo_ausente', document_code: d.document_code, version: d.version, expected_sha256: d.file_sha256, actual_sha256: null };
    }
    throw new BadGatewayException('Não foi possível ler o documento');
  }
  const actual = sha256Hex(buf);
  return { status: actual === d.file_sha256 ? 'integro' : 'divergente', document_code: d.document_code, version: d.version, expected_sha256: d.file_sha256, actual_sha256: actual };
}
```
Se `R2Service` não for injetável no `EpiFichaModule` por não ser global (`R2Module` é global, VERIFICADO no comentário do `R2Service`), nada a importar; confirmar no teste.

- [ ] **Step 5: Rotas**

No controller (declarar `documents/...` antes de rotas com parâmetro conflitante; `documents` é segmento literal):

```ts
@Roles('empresa', 'tecnico', 'parceiro', 'admin')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
@Post('employees/:employeeId/issue')
async issue(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Body() dto: IssueFichaDto, @Req() req: any, @Res({ passthrough: true }) res: any) {
  const { doc, replayed } = await req.withTenantContext((client: any) => this.ficha.issue(client, employeeId, dto, req.user.id));
  res.status(replayed ? 200 : 201);
  return doc;
}

@Roles('empresa', 'tecnico', 'parceiro', 'admin')
@Get('employees/:employeeId/documents')
documents(@Param('employeeId', ParseUUIDPipe) employeeId: string, @Req() req: any) {
  return req.withTenantContext((client: any) => this.ficha.listDocuments(client, employeeId));
}

@Roles('empresa', 'tecnico', 'parceiro', 'admin')
@Get('documents/:documentId/download')
async download(@Param('documentId', ParseUUIDPipe) documentId: string, @Req() req: any, @Res() res: any) {
  const { buffer, code } = await req.withTenantContext((client: any) => this.ficha.getDocumentFile(client, documentId));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${code}.pdf"`, 'Cache-Control': 'private, no-store' });
  res.send(buffer);
}

@Roles('empresa', 'tecnico', 'parceiro', 'admin')
@Get('documents/:documentId/verify')
verify(@Param('documentId', ParseUUIDPipe) documentId: string, @Req() req: any) {
  return req.withTenantContext((client: any) => this.ficha.verify(client, documentId));
}
```
O `AuditInterceptor` global já audita o POST de emissão (ator, papel, empresa, recurso); não registrar CPF em log.

- [ ] **Step 6: Testes de permissões e isolamento**

`backend/test/epi-ficha-permissions.e2e-spec.ts` (R2 mockado): empresa B recebe 404 em issue/documents/download/verify de funcionário/documento da A; técnico **não vinculado** recebe 404; técnico e parceiro **vinculados** (padrão `tenant_technicians`/`tenant_partners` dos e2e existentes) conseguem emitir, listar, baixar e verificar; `admin` consegue; ids não UUID → 400; sem token → 401; `UPDATE`/`DELETE` direto em `epi_ficha_documents` falham (já coberto no schema, repetir uma asserção via API não existe: não há rota de edição/exclusão — provar com um teste que `PATCH/DELETE /epi-fichas/documents/:id` retornam 404).

- [ ] **Step 7: Rodar tudo**

Run: `run-be-rl.sh e2e "epi-ficha-issue epi-ficha-permissions epi-ficha-pdf epi-ficha-data epi-ficha-schema employees-registration" <log>`, unit `canonical-json cpf-mask epi-ficha-pdf epi-by-function tenant-context-callsites`, `tsc --noEmit`, `nest build`. Expected: PASS.

- [ ] **Step 8: Entrega** (listar arquivos; não comitar).

---

### Task 5: Regressão, revisão, documentação e relatório

**Files:**
- Create: `docs/architecture/epi-ficha.md`
- Modify: `docs/superpowers/specs/2026-10-14-epi-ficha-pdf-design.md` (seção de desvios, se houver)

- [ ] **Step 1: Regressão no ensaio** — unit completo (`run-be-rl.sh unit "" <log>`; baseline: só `r2-get-object` falha por não haver R2) e e2e completo **em lotes** de 12 suítes (um container por lote, `NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=3072"`, `RATE_LIMIT_MAX` alto). Qualquer suíte que falhe deve ser rodada também no código base (`git archive 8b9e5bf backend`) para provar que a falha é anterior (baseline do subsistema 1: 21 suítes e2e falham igual no base por R2/Mercado Pago/OpenRouter falsos, 61 testes). Registrar comandos e resultados literais.
- [ ] **Step 2: tsc + build** limpos; confirmar que `dist/src/common/pdf/assets/*.png` existe após `nest build`.
- [ ] **Step 3: Teste da migration em banco recriado do zero** (`ensaio-down/up/migrate` só com as migrations, sem ajuste manual) e **rollback** documentado e testado: aplicar 0082, rodar um `0082.down.sql` (DROP TABLE epi_ficha_documents; DROP FUNCTION epi_ficha_documents_immutable(); ALTER TABLE employees DROP COLUMN registration_number, DROP COLUMN department; DELETE FROM _migrations WHERE name = '0082_epi_ficha_documents.sql') que recusa executar se houver documentos emitidos, e comparar o `pg_dump --schema-only` com o de antes (como no subsistema 1).
- [ ] **Step 4: Revisão independente** (quem implementa não aprova): `montese-seguranca` (RLS, permissões, imutabilidade, CPF, entrada inválida→400, ausência de URL pública, falhas de R2) e `montese-qa` (diff real + critérios de aceitação). Corrigir só achados confirmados, numa única onda, com uma re-revisão escopada.
- [ ] **Step 5: Documentação** `docs/architecture/epi-ficha.md`: modelo, regras, API (rota, papéis, códigos de resposta), formato do PDF e do rodapé, instantâneo e hashes (e o limite: o hash do arquivo não está dentro do arquivo), verificação, testes, como rodar no ensaio, rollback, **limitações e decisões pendentes** (termo é rascunho; CPF sempre mascarado; documentos emitidos e funcionários com ficha não podem ser apagados — decisão LGPD; sem assinatura eletrônica, sem página pública de verificação; adoção do rodapé de marca nos PDFs existentes é decisão separada; foto `1.jpg` não usada; retenção; matrícula/setor sem tela até o subsistema 4; migration 0082 depende da ordem de release e da 0081), rotulando VERIFICADO/NÃO VERIFICADO. Não editar `PROJECT_STATE.md` sem autorização.
- [ ] **Step 6: Relatório final** ao proprietário: arquivos, migration, testes e resultados literais, riscos restantes, validação manual sugerida (gerar uma prévia e uma emissão numa empresa de teste e abrir o PDF), ordem de release (0081 antes da 0082; backup; consulta de duplicidade da 0081). Não aplicar nada em produção.

---

## Self-Review (spec × plano)

- Colunas `registration_number`/`department` e tabela imutável com RLS, REVOKE TRUNCATE, cascata e unicidades → Task 1.
- Ficha só do livro + legado, CPF mascarado, filtros, estornadas visíveis, limite de linhas, fuso de `delivered_at` → Task 2.
- Prévia sem registro, PDF A4 multipágina, marca "NÃO EMITIDO", cabeçalho/rodapé em todas as páginas, rodapé de marca fornecido, sem selo de assinatura, termo rascunho → Task 3.
- Emissão com versão sob trava, idempotência, instantâneo canônico e hashes, R2 + rollback de órfão, download privado, verificação (íntegro/divergente/ausente), permissões e isolamento → Task 4.
- Regressão, revisão independente, rollback, documentação → Task 5.
- Fora de escopo mantido: assinatura eletrônica, telas, página pública, adoção do rodapé em PDFs existentes, importação de matrícula/setor.
- Tipos consistentes entre tasks: `Ficha`, `FichaLine`, `FichaFilters`, `FichaPdfMeta`, `EpiFichaService.getFicha/issue/listDocuments/getDocumentFile/verify`, `maskCpf`, `canonicalJson`, `sha256Hex`, `brandFooterHeight`, `drawBrandFooter`.
- Pontos a verificar na execução (NÃO VERIFICADO até rodar): assinatura/nome de `extractPdfText` e flag `--experimental-vm-modules`; se o `ValidationPipe` global aceita os campos novos dos DTOs de funcionário sem decorators; layout do PDF (rodapé sem sobrepor texto; nenhuma página em branco extra) e legibilidade da faixa fornecida; `pg_trigger_depth()` no cascade com `epi_tenant_row_exists`; tamanho do PDF com a imagem do rodapé (≈ 410 KB por documento no R2: avaliar otimização se virar problema); `Cache-Control` e `Content-Disposition` com `@Res()` sob os interceptors globais.
