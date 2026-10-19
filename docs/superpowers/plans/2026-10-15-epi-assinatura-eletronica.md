# EPI — Assinatura eletrônica mobile (Subsistema 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O funcionário assina o recebimento de EPI no celular por um link de uso único protegido por código curto; o sistema grava evidência imutável, atualiza as entregas, gera comprovante em PDF e reflete a assinatura na ficha.

**Architecture:** Funções `SECURITY DEFINER` no banco (padrão `auth_*`) atendem as rotas públicas sem contexto de empresa: conferem hash do token e do código, contam tentativas, gravam a evidência e atualizam as entregas sob `FOR UPDATE`. O backend gera token (256 bits) e código (6 dígitos), valida a imagem PNG sem dependência nova, guarda a assinatura no R2 e expõe rotas autenticadas para o responsável. A página pública `/assinar` (Next.js) lê o token do fragmento da URL, tem canvas próprio e nunca coloca o token em URL de API.

**Tech Stack:** NestJS, PostgreSQL (RLS, pgcrypto `digest`), `pdfkit`, `R2Service`, class-validator, Jest + supertest; Next.js 14, React 18, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-15-epi-assinatura-eletronica-design.md` (depende dos subsistemas 1 e 2: `…2026-10-14-epi-cadastro-movimentacoes-design.md`, `…2026-10-14-epi-ficha-pdf-design.md`).

## Global Constraints

- **Sem `git commit`, `push`, `reset`, `stash`, `checkout`, `add`.** O proprietário decide os commits; os passos "Entrega" listam arquivos e param. Trabalhar só em `/opt/montese-epi` (branch `feat/epi-estoque`, que contém os subsistemas 1 e 2, sem commit). Nunca em `/opt/Montese` (só leitura quando indicado).
- **Testes só em ensaio descartável** (Postgres+Redis próprios, senhas aleatórias, chaves falsas); nunca ler/imprimir `.env`/`ensaio.env`; nunca tocar nos containers `montese_*`, Docker Compose, Nginx, Redis/banco de produção, `Dockerfile`; nunca `run-backend-tests.sh`. **R2 sempre mockado** (`overrideProvider(R2Service)`, Map em memória). Nenhuma chamada real a e-mail/Mercado Pago/OpenRouter.
- Scripts do scratchpad (`/tmp/claude-0/-opt-Montese/8c2ba2eb-4c11-43d4-a3d0-94e201ce53cb/scratchpad/`): `ensaio-up.sh`, `ensaio-migrate.sh`, `ensaio-down.sh`, `run-be-rl.sh <e2e|unit> "<padrões>" <log>`, `run-be-batch.sh`, `snap.sh`, `pkg.sh`. Redirecionar log para arquivo e lê-lo com Read/Grep; nunca `| tail` direto; execuções em sequência; a suíte e2e completa num só processo estoura memória: rodar por padrões ou em lotes; rate limit exige `RATE_LIMIT_MAX` alto (`run-be-rl.sh`). Typecheck/build: container `node:20-bookworm-slim` com `/opt/montese-epi/backend` (ro) e o cache `nm/` (modelo: `run-be.sh`): `npx tsc --noEmit -p tsconfig.json` e `npx nest build`.
- **Frontend**: testes com Vitest num container descartável `node:20-bookworm-slim` com o cache de `node_modules` do frontend (criar `nmf/` no scratchpad com `npm ci` do `frontend/package-lock.json`, como foi feito para o backend; rede liberada só para o npm). `npm run lint` e `npx tsc --noEmit` do frontend também.
- **Numeração da migration: 0083** (0081 e 0082 são dos subsistemas 1-2; 0080 está em `feat/tabela-oficial-funcionarios`): reconfirmar o próximo livre antes de entregar.
- Isolamento entre empresas é crítico: tabelas novas com `ENABLE` + `FORCE ROW LEVEL SECURITY` e a policy padrão do módulo; `tenant_id` nunca vem do corpo; rotas autenticadas usam `req.withTenantContext`.
- **Entrada inválida nunca vira 500** (ParseUUIDPipe, class-validator, `DATE_ONLY`/`NO_NUL` de `src/epi/dto/epi-dto-rules.ts`, tradução de erros do PG).
- **Rotas públicas**: `@Public()` + `@RateLimit` por rota; respostas idênticas para token inexistente, expirado, usado ou revogado; `Cache-Control: no-store`; token só no CORPO da requisição (nunca na URL da API); nenhum log de token, código, imagem ou CPF; CPF nunca em resposta pública.
- **Decisões do proprietário** (2026-10-15): link + QR mostrados ao responsável; código de 6 dígitos de uso único + aceite explícito; backend + página pública; expiração 24 h; 5 tentativas; comprovante em PDF; termo rascunho **bloqueia a assinatura em produção** (`EPI_SIGNATURE_ALLOW_DRAFT_TERM`, padrão `false`; testes ligam `true`).
- **Nada de "ICP-Brasil"** nem selo falso; a evidência diz que desenho + código não provam identidade sozinhos; sem imagem de assinatura na ficha sem evidência.
- Rotular o que for afirmado: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

## Convenção sobre os testes deste plano

Os testes aparecem de duas formas: com **código completo** (os de maior risco: schema/funções SQL, segredos, PNG, criação, assinatura) e **só por título** (`it('…', async () => {})` ou `/* … */`). Os de só título são **especificações**: o implementador escreve o corpo com asserções reais que provem exatamente o que o título afirma (status HTTP, estado no banco, ausência de efeito colateral), no estilo dos testes completos vizinhos, e o revisor confere que cada título tem um teste que falharia se o comportamento fosse removido. Um título sem asserção equivalente é achado do revisor.

## Decisões deste plano que detalham ou emendam a spec (revisar)

1. **Token no fragmento da URL**: o link é `${PUBLIC_APP_URL}/assinar#token=<token>` (padrão da página de redefinir senha); as rotas públicas recebem o token no **corpo** (`POST`), não na URL. Isso emenda a spec (que citava `/assinar/<token>` e `GET /public/:token`).
2. **Comprovante em PDF gerado sob demanda** a partir da evidência (não guardado no R2): a fonte de verdade é `epi_signatures`, ancorada em `evidence_sha256`; evita colunas mutáveis numa tabela imutável. Emenda a spec (`receipt_file_key`, `receipt_sha256` removidos).
3. **Evidência verificável**: `epi_signatures.evidence_payload` (JSONB exato que foi hasheado) + `evidence_sha256 = sha256(evidence_payload::text)` calculado no banco com `pgcrypto.digest`; qualquer um recalcula.
4. **Expiração do link não altera a entrega**: a requisição vira `expirada` e as entregas permanecem `pendente` (a assinatura ainda não ocorreu); o responsável gera novo link, registra presencial ou estorna. Entregas `recusada` podem receber novo link (voltam a `pendente` na criação). Status `expirada` de entrega fica reservado.
5. **Termo**: `term_version` e `term_text_sha256` ficam na requisição no momento da criação e são copiados para a evidência; a página só exibe o termo se a versão da requisição for a do código (`EPI_TERM.version`); senão responde como link inválido.
6. **Sem detecção de assinatura em branco por heurística de tamanho**: o PNG exigido é RGBA 8 bits, não entrelaçado, desenhado em canvas **transparente**; o servidor faz `inflate` das linhas e rejeita se todos os bytes de pixel forem zero (imagem em branco ≡ dados zerados, pois todos os filtros PNG preservam zeros).
7. A rota `GET /epi-signatures/:id/receipt.pdf` autenticada serve o comprovante; a página pública mostra o comprovante em tela (código e hora), não PDF.
8. O arquivo novo que usa `DatabaseService.withoutTenantContext` (rotas públicas) precisa entrar na lista `ALLOWED` do teste `tenant-context-callsites.unit-spec.ts`: é exatamente o caso previsto (rota pública sem tenant), mas **exige revisão de segurança** do revisor (guarda do ITEM 008).

## File Structure

- Create `backend/db/migrations/0083_epi_signatures.sql` — tabelas, trigger, RLS, grants e funções SQL.
- Create `backend/src/epi-signature/`: `epi-signature.module.ts`, `epi-signature.controller.ts` (rotas autenticadas), `epi-signature-public.controller.ts` (rotas públicas), `epi-signature.service.ts` (responsável: criar/listar/revogar/presencial/comprovante), `epi-signature-public.service.ts` (público: peek/open/sign/refuse), `signature-secrets.util.ts` (token, código, hashes), `signature-png.util.ts` (validação do PNG), `receipt-pdf.util.ts`, `dto/*.ts`.
- Modify `backend/src/app.module.ts`, `backend/src/epi-ficha/epi-ficha.types.ts`, `epi-ficha.service.ts`, `ficha-pdf.util.ts` (status assinado, anexo de comprovantes), `backend/test/tenant-context-callsites.unit-spec.ts` (ALLOWED, com justificativa).
- Create frontend: `frontend/src/app/assinar/page.tsx`, `frontend/src/app/assinar/layout.tsx`, `frontend/src/components/epi/SignaturePad.tsx`, `frontend/src/lib/epi-signature-api.ts`; tests `frontend/src/app/assinar/__tests__/assinar-page.test.tsx`, `frontend/src/components/epi/__tests__/SignaturePad.test.tsx`.
- Tests backend em `backend/test/`: `epi-signature-schema.e2e-spec.ts`, `epi-signature-create.e2e-spec.ts`, `epi-signature-public.e2e-spec.ts`, `epi-signature-permissions.e2e-spec.ts`, `epi-signature-ficha.e2e-spec.ts`; unit `signature-secrets.unit-spec.ts`, `signature-png.unit-spec.ts`, `epi-signature-receipt.unit-spec.ts`; helper `backend/test/helpers/png.ts`.
- Docs: `docs/architecture/epi-assinatura.md`.

---

### Task 1: Migration 0083 — tabelas, imutabilidade, RLS e funções SQL

**Files:**
- Create: `backend/db/migrations/0083_epi_signatures.sql`
- Test: `backend/test/epi-signature-schema.e2e-spec.ts`

**Interfaces:**
- Produces: tabelas `epi_signature_requests`, `epi_signature_request_items`, `epi_signatures` (imutável); funções (executáveis por `montese_app`): `epi_sig_peek(p_token_hash TEXT) → (usable BOOLEAN, company_name TEXT)`, `epi_sig_open(p_token_hash TEXT, p_pin_hash TEXT) → (result TEXT, attempts_left INT, request_id UUID, tenant_id UUID, employee_name TEXT, expires_at TIMESTAMPTZ, term_version TEXT, items JSONB)`, `epi_sig_sign(p_token_hash TEXT, p_pin_hash TEXT, p_accepted BOOLEAN, p_signature_key TEXT, p_signature_sha256 TEXT, p_ip TEXT, p_user_agent TEXT) → (result TEXT, signature_id UUID, receipt_code TEXT, signed_at TIMESTAMPTZ, evidence_sha256 TEXT)`, `epi_sig_refuse(p_token_hash TEXT, p_pin_hash TEXT, p_reason TEXT) → (result TEXT)`. `result ∈ {'ok','invalid','locked','wrong_code','conflict','not_accepted'}`.

- [ ] **Step 1: Subir o ensaio e aplicar as migrations existentes**

Run: `ensaio-down.sh; ensaio-up.sh; ensaio-migrate.sh`. Expected: `[ok] 0082_epi_ficha_documents.sql` como última linha. (Confirmar também `SELECT digest('a','sha256')` no ensaio: pgcrypto está criado pelo `ensaio-up.sh`.)

- [ ] **Step 2: Teste de schema e das funções (RED)**

`backend/test/epi-signature-schema.e2e-spec.ts` (superusuário `sql` para fixtures; role de aplicação `app` via `DATABASE_URL` para chamar as funções como em produção; helpers de hash `sha256Hex`/`hmacHex` de `crypto`):

```ts
import { Client } from 'pg';
import { createHash, createHmac, randomBytes, randomUUID } from 'crypto';
import { TestDb } from './db-test-helper';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (key: string, msg: string) => createHmac('sha256', key).update(msg).digest('hex');

describe('Schema e funções da assinatura eletrônica (0083)', () => {
  let db: TestDb; let sql: Client; let app: Client;
  let tenantId: string; let userId: string; let employeeId: string; let epiId: string;

  // cria uma entrega pendente + requisição ativa; devolve token/pin em claro (só no teste)
  async function makeRequest(over: { expiresInSeconds?: number; deliveries?: number } = {}) {
    const token = randomBytes(32).toString('base64url');
    const pin = '123456';
    const deliveryIds: string[] = [];
    for (let i = 0; i < (over.deliveries ?? 1); i++) {
      const d = await sql.query(
        `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, quantity, signature_status, signed_by_name, signed_at, created_by_user_id)
         VALUES ($1,$2,$3,'2026-10-14',2,'pendente',NULL,NULL,$4) RETURNING id`, [tenantId, epiId, employeeId, userId]);
      deliveryIds.push(d.rows[0].id);
    }
    const r = await sql.query(
      `INSERT INTO epi_signature_requests (tenant_id, employee_id, token_hash, pin_hash, expires_at, term_version, term_text_sha256, created_by_user_id, idempotency_key)
       VALUES ($1,$2,$3,$4, now() + ($5 || ' seconds')::interval, 'rascunho-1', $6, $7, $8) RETURNING id`,
      [tenantId, employeeId, sha(token), hmac(token, pin), String(over.expiresInSeconds ?? 3600), 'a'.repeat(64), userId, `idem-${randomUUID()}`]);
    for (const id of deliveryIds) {
      await sql.query('INSERT INTO epi_signature_request_items (request_id, delivery_id) VALUES ($1,$2)', [r.rows[0].id, id]);
    }
    return { token, pin, requestId: r.rows[0].id as string, deliveryIds };
  }
  const call = (q: string, p: unknown[]) => app.query(q, p);

  beforeAll(async () => { /* db, sql, app (DATABASE_URL), tenant+user+employee, EPI (tenant_epis) via sql */ });
  afterAll(async () => { /* db.cleanup(); fechar clientes */ });

  it('peek: link ativo é utilizável e só devolve o nome da empresa; inexistente é indistinguível de expirado', async () => {
    const a = await makeRequest();
    const ok = await call('SELECT * FROM epi_sig_peek($1)', [sha(a.token)]);
    expect(ok.rows[0].usable).toBe(true);
    expect(ok.rows[0].company_name).toBeTruthy();
    const none = await call('SELECT * FROM epi_sig_peek($1)', [sha('nao-existe')]);
    const exp = await makeRequest({ expiresInSeconds: -5 });
    const expired = await call('SELECT * FROM epi_sig_peek($1)', [sha(exp.token)]);
    expect(none.rows[0]).toEqual({ usable: false, company_name: null });
    expect(expired.rows[0]).toEqual({ usable: false, company_name: null });
    const st = await sql.query('SELECT status FROM epi_signature_requests WHERE id = $1', [exp.requestId]);
    expect(st.rows[0].status).toBe('expirada'); // expiração preguiçosa persistida
  });

  it('open: código certo devolve itens e nome; errado conta tentativa; 5 erros bloqueiam; depois nem o certo abre', async () => {
    const a = await makeRequest();
    const good = await call('SELECT * FROM epi_sig_open($1,$2)', [sha(a.token), hmac(a.token, a.pin)]);
    expect(good.rows[0].result).toBe('ok');
    expect(good.rows[0].items).toHaveLength(1);
    expect(JSON.stringify(good.rows[0])).not.toMatch(/\b\d{11}\b/); // sem CPF
    const b = await makeRequest();
    const bad = hmac(b.token, '000000');
    for (let i = 1; i <= 4; i++) {
      const r = await call('SELECT * FROM epi_sig_open($1,$2)', [sha(b.token), bad]);
      expect(r.rows[0]).toMatchObject({ result: 'wrong_code', attempts_left: 5 - i });
    }
    expect((await call('SELECT * FROM epi_sig_open($1,$2)', [sha(b.token), bad])).rows[0].result).toBe('locked');
    expect((await call('SELECT * FROM epi_sig_open($1,$2)', [sha(b.token), hmac(b.token, b.pin)])).rows[0].result).toBe('locked');
    expect((await sql.query('SELECT status FROM epi_signature_requests WHERE id = $1', [b.requestId])).rows[0].status).toBe('bloqueada');
  });

  it('sign: grava evidência imutável, marca entregas e requisição, e o hash da evidência confere', async () => {
    const a = await makeRequest({ deliveries: 2 });
    const r = await call('SELECT * FROM epi_sig_sign($1,$2,true,$3,$4,$5,$6)',
      [sha(a.token), hmac(a.token, a.pin), 'tenants/x/epi-signatures/s.png', 'b'.repeat(64), '203.0.113.9', 'UA-teste']);
    expect(r.rows[0].result).toBe('ok');
    expect(r.rows[0].receipt_code).toMatch(/^ASEPI-\d{8}-[0-9A-F]{8}$/);
    const ev = (await sql.query('SELECT * FROM epi_signatures WHERE id = $1', [r.rows[0].signature_id])).rows[0];
    const re = await sql.query("SELECT encode(digest(evidence_payload::text,'sha256'),'hex') AS h FROM epi_signatures WHERE id = $1", [r.rows[0].signature_id]);
    expect(re.rows[0].h).toBe(ev.evidence_sha256); // a evidência é verificável por qualquer um a partir do payload gravado
    expect(ev.evidence_payload.signature_sha256).toBe('b'.repeat(64));
    expect(ev.evidence_payload.code_verified).toBe(true);
    const d = await sql.query('SELECT signature_status, signed_at, signed_by_name FROM employee_epi_deliveries WHERE id = ANY($1)', [a.deliveryIds]);
    expect(d.rows.every((x) => x.signature_status === 'assinada' && x.signed_at && x.signed_by_name)).toBe(true);
    expect(ev.items_snapshot).toHaveLength(2);
    expect((await sql.query('SELECT status FROM epi_signature_requests WHERE id = $1', [a.requestId])).rows[0].status).toBe('assinada');
    // segunda tentativa com o mesmo link: inválido, nada muda
    const again = await call('SELECT * FROM epi_sig_sign($1,$2,true,$3,$4,$5,$6)',
      [sha(a.token), hmac(a.token, a.pin), 'k2', 'c'.repeat(64), 'ip', 'ua']);
    expect(again.rows[0].result).toBe('invalid');
    expect((await sql.query('SELECT count(*)::int AS n FROM epi_signatures WHERE request_id = $1', [a.requestId])).rows[0].n).toBe(1);
  });

  it('sign sem aceite não grava nada; entrega que deixou de ser pendente -> conflict', async () => {
    const a = await makeRequest();
    expect((await call('SELECT * FROM epi_sig_sign($1,$2,false,$3,$4,$5,$6)', [sha(a.token), hmac(a.token, a.pin), 'k', 'd'.repeat(64), 'ip', 'ua'])).rows[0].result).toBe('not_accepted');
    await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'estornada' WHERE id = $1`, [a.deliveryIds[0]]);
    expect((await call('SELECT * FROM epi_sig_sign($1,$2,true,$3,$4,$5,$6)', [sha(a.token), hmac(a.token, a.pin), 'k', 'd'.repeat(64), 'ip', 'ua'])).rows[0].result).toBe('conflict');
  });

  it('refuse: marca entregas como recusada e a requisição como recusada; segunda recusa é inválida', async () => {
    const a = await makeRequest();
    expect((await call('SELECT * FROM epi_sig_refuse($1,$2,$3)', [sha(a.token), hmac(a.token, a.pin), 'Não recebi'])).rows[0].result).toBe('ok');
    expect((await sql.query('SELECT signature_status FROM employee_epi_deliveries WHERE id = $1', [a.deliveryIds[0]])).rows[0].signature_status).toBe('recusada');
    expect((await call('SELECT * FROM epi_sig_refuse($1,$2,$3)', [sha(a.token), hmac(a.token, a.pin), 'x'])).rows[0].result).toBe('invalid');
  });

  it('assinaturas concorrentes no mesmo link: exatamente uma vence', async () => {
    const a = await makeRequest();
    const clients = await Promise.all(Array.from({ length: 6 }, async () => { const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect(); return c; }));
    const rs = await Promise.all(clients.map((c, i) => c.query('SELECT * FROM epi_sig_sign($1,$2,true,$3,$4,$5,$6)', [sha(a.token), hmac(a.token, a.pin), `k${i}`, 'e'.repeat(64), 'ip', 'ua'])));
    await Promise.all(clients.map((c) => c.end()));
    expect(rs.filter((r) => r.rows[0].result === 'ok')).toHaveLength(1);
    expect((await sql.query('SELECT count(*)::int AS n FROM epi_signatures WHERE request_id = $1', [a.requestId])).rows[0].n).toBe(1);
  });

  it('epi_signatures é imutável (UPDATE/DELETE 42501) e TRUNCATE é negado à aplicação', async () => { /* … */ });
  it('RLS: empresa B não vê requisições nem assinaturas da A; funções internas (epi_sig_check) não são executáveis pela aplicação', async () => { /* … */ });
  it('exclusão do tenant cascateia requisições, itens e assinaturas', async () => { /* … */ });
});
```
Completar os `/* … */` e os `beforeAll`/`afterAll` com código real (padrão de `epi-ficha-schema.e2e-spec.ts`: asserções `toMatchObject({ code })`; RLS com `set_config` local; `app.query('SELECT * FROM epi_sig_check($1,$2)')` deve falhar com `42501`).

- [ ] **Step 3: Rodar e ver falhar** — `run-be-rl.sh e2e "epi-signature-schema" <log>`. Expected: FAIL (`epi_signature_requests` inexistente).

- [ ] **Step 4: Escrever a migration**

`backend/db/migrations/0083_epi_signatures.sql` (padrões da 0081/0082: trigger de imutabilidade com `epi_tenant_row_exists`, RLS, `REVOKE TRUNCATE`):

```sql
-- Módulo EPI, subsistema 3: assinatura eletrônica mobile. Ver docs/superpowers/specs/2026-10-15-epi-assinatura-eletronica-design.md.
-- Aditiva. As rotas públicas não têm contexto de empresa: usam funções SECURITY DEFINER (dono montese_auth_bypass, BYPASSRLS),
-- no padrão auth_* (0058). Só o hash do token e do código é guardado.

CREATE TABLE epi_signature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  pin_hash TEXT NOT NULL CHECK (pin_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','assinada','recusada','expirada','revogada','bloqueada')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  term_version TEXT NOT NULL,
  term_text_sha256 TEXT NOT NULL CHECK (term_text_sha256 ~ '^[0-9a-f]{64}$'),
  refusal_reason TEXT CHECK (refusal_reason IS NULL OR length(refusal_reason) <= 300),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX idx_epi_sig_requests_tenant ON epi_signature_requests (tenant_id);
CREATE INDEX idx_epi_sig_requests_employee ON epi_signature_requests (employee_id, created_at DESC);

CREATE TABLE epi_signature_request_items (
  request_id UUID NOT NULL REFERENCES epi_signature_requests(id) ON DELETE CASCADE,
  delivery_id UUID NOT NULL REFERENCES employee_epi_deliveries(id) ON DELETE RESTRICT,
  PRIMARY KEY (request_id, delivery_id)
);
CREATE INDEX idx_epi_sig_items_delivery ON epi_signature_request_items (delivery_id);

CREATE TABLE epi_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL UNIQUE REFERENCES epi_signature_requests(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  signed_at TIMESTAMPTZ NOT NULL,
  accepted BOOLEAN NOT NULL CHECK (accepted),
  term_version TEXT NOT NULL,
  term_text_sha256 TEXT NOT NULL,
  items_snapshot JSONB NOT NULL,
  signature_file_key TEXT NOT NULL,
  signature_sha256 TEXT NOT NULL CHECK (signature_sha256 ~ '^[0-9a-f]{64}$'),
  ip TEXT, user_agent TEXT,
  code_verified BOOLEAN NOT NULL CHECK (code_verified),
  evidence_payload JSONB NOT NULL,
  evidence_sha256 TEXT NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_code TEXT NOT NULL,
  UNIQUE (tenant_id, receipt_code)
);
CREATE INDEX idx_epi_signatures_tenant ON epi_signatures (tenant_id);
CREATE INDEX idx_epi_signatures_employee ON epi_signatures (employee_id, signed_at DESC);

-- Imutabilidade da evidência (mesmo padrão de epi_ficha_documents).
CREATE FUNCTION epi_signatures_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 AND NOT epi_tenant_row_exists(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'epi_signatures é imutável' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_epi_signatures_immutable BEFORE UPDATE OR DELETE ON epi_signatures
  FOR EACH ROW EXECUTE FUNCTION epi_signatures_immutable();

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['epi_signature_requests','epi_signature_request_items','epi_signatures'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
CREATE POLICY epi_sig_requests_isolation ON epi_signature_requests USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user()));
CREATE POLICY epi_sig_items_isolation ON epi_signature_request_items USING (
  EXISTS (SELECT 1 FROM epi_signature_requests r WHERE r.id = request_id));
CREATE POLICY epi_signatures_isolation ON epi_signatures USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user()));
REVOKE TRUNCATE ON epi_signature_requests, epi_signature_request_items, epi_signatures FROM montese_app;

-- A role BYPASSRLS das funções precisa de privilégios de tabela (BYPASSRLS não os concede).
GRANT SELECT, UPDATE ON epi_signature_requests TO montese_auth_bypass;
GRANT SELECT ON epi_signature_request_items TO montese_auth_bypass;
GRANT SELECT, INSERT ON epi_signatures TO montese_auth_bypass;
GRANT SELECT, UPDATE ON employee_epi_deliveries TO montese_auth_bypass;
GRANT SELECT ON employees, tenants, tenant_epis, epi_catalog_items TO montese_auth_bypass;

-- Interna: trava a requisição e confere token/código. NÃO executável pela aplicação.
CREATE FUNCTION epi_sig_check(p_token_hash TEXT, p_pin_hash TEXT)
RETURNS TABLE(result TEXT, attempts_left INT, req_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r epi_signature_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM epi_signature_requests WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'invalid'::text, 0, NULL::uuid; RETURN; END IF;
  IF r.status = 'ativa' AND r.expires_at <= now() THEN
    UPDATE epi_signature_requests SET status = 'expirada' WHERE id = r.id;
    RETURN QUERY SELECT 'invalid'::text, 0, NULL::uuid; RETURN;
  END IF;
  IF r.status = 'bloqueada' THEN RETURN QUERY SELECT 'locked'::text, 0, NULL::uuid; RETURN; END IF;
  IF r.status <> 'ativa' THEN RETURN QUERY SELECT 'invalid'::text, 0, NULL::uuid; RETURN; END IF;
  IF r.pin_hash <> p_pin_hash THEN
    UPDATE epi_signature_requests
       SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= 5 THEN 'bloqueada' ELSE status END
     WHERE id = r.id;
    IF r.attempts + 1 >= 5 THEN RETURN QUERY SELECT 'locked'::text, 0, NULL::uuid; RETURN; END IF;
    RETURN QUERY SELECT 'wrong_code'::text, 5 - (r.attempts + 1), NULL::uuid; RETURN;
  END IF;
  RETURN QUERY SELECT 'ok'::text, 5 - r.attempts, r.id;
END;
$$;

CREATE FUNCTION epi_sig_peek(p_token_hash TEXT)
RETURNS TABLE(usable BOOLEAN, company_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r epi_signature_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM epi_signature_requests WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, NULL::text; RETURN; END IF;
  IF r.status = 'ativa' AND r.expires_at <= now() THEN
    UPDATE epi_signature_requests SET status = 'expirada' WHERE id = r.id;
    RETURN QUERY SELECT false, NULL::text; RETURN;
  END IF;
  IF r.status <> 'ativa' THEN RETURN QUERY SELECT false, NULL::text; RETURN; END IF;
  RETURN QUERY SELECT true, (SELECT t.name FROM tenants t WHERE t.id = r.tenant_id);
END;
$$;

-- Itens (entregas) de uma requisição, no formato exibido e gravado na evidência. Interna.
CREATE FUNCTION epi_sig_items(p_request_id UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'delivery_id', d.id, 'date', to_char(d.delivered_at, 'YYYY-MM-DD'),
           'epi_description', eci.description, 'manufacturer', te.manufacturer, 'model', te.model,
           'ca_number', te.ca_number, 'quantity', d.quantity) ORDER BY d.delivered_at, d.id), '[]'::jsonb)
    FROM epi_signature_request_items i
    JOIN employee_epi_deliveries d ON d.id = i.delivery_id
    JOIN tenant_epis te ON te.id = d.tenant_epi_id
    JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
   WHERE i.request_id = p_request_id;
$$;

CREATE FUNCTION epi_sig_open(p_token_hash TEXT, p_pin_hash TEXT)
RETURNS TABLE(result TEXT, attempts_left INT, request_id UUID, tenant_id UUID, employee_name TEXT,
              expires_at TIMESTAMPTZ, term_version TEXT, items JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c RECORD; r epi_signature_requests%ROWTYPE;
BEGIN
  SELECT * INTO c FROM epi_sig_check(p_token_hash, p_pin_hash);
  IF c.result <> 'ok' THEN
    RETURN QUERY SELECT c.result, c.attempts_left, NULL::uuid, NULL::uuid, NULL::text, NULL::timestamptz, NULL::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO r FROM epi_signature_requests WHERE id = c.req_id;
  RETURN QUERY SELECT 'ok'::text, c.attempts_left, r.id, r.tenant_id,
    (SELECT e.full_name FROM employees e WHERE e.id = r.employee_id), r.expires_at, r.term_version, epi_sig_items(r.id);
END;
$$;

CREATE FUNCTION epi_sig_sign(p_token_hash TEXT, p_pin_hash TEXT, p_accepted BOOLEAN, p_signature_key TEXT,
                             p_signature_sha256 TEXT, p_ip TEXT, p_user_agent TEXT)
RETURNS TABLE(result TEXT, signature_id UUID, receipt_code TEXT, signed_at TIMESTAMPTZ, evidence_sha256 TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c RECORD; r epi_signature_requests%ROWTYPE; v_items JSONB; v_now TIMESTAMPTZ := now();
        v_code TEXT; v_payload JSONB; v_hash TEXT; v_id UUID; v_name TEXT; v_pending INT; v_total INT;
BEGIN
  SELECT * INTO c FROM epi_sig_check(p_token_hash, p_pin_hash);
  IF c.result <> 'ok' THEN RETURN QUERY SELECT c.result, NULL::uuid, NULL::text, NULL::timestamptz, NULL::text; RETURN; END IF;
  IF NOT COALESCE(p_accepted, false) THEN RETURN QUERY SELECT 'not_accepted'::text, NULL::uuid, NULL::text, NULL::timestamptz, NULL::text; RETURN; END IF;
  SELECT * INTO r FROM epi_signature_requests WHERE id = c.req_id;
  SELECT count(*), count(*) FILTER (WHERE d.signature_status = 'pendente') INTO v_total, v_pending
    FROM epi_signature_request_items i JOIN employee_epi_deliveries d ON d.id = i.delivery_id WHERE i.request_id = r.id FOR UPDATE OF d;
  IF v_total = 0 OR v_pending <> v_total THEN RETURN QUERY SELECT 'conflict'::text, NULL::uuid, NULL::text, NULL::timestamptz, NULL::text; RETURN; END IF;
  v_items := epi_sig_items(r.id);
  v_code := 'ASEPI-' || to_char(v_now AT TIME ZONE 'America/Sao_Paulo', 'YYYYMMDD') || '-' || upper(encode(gen_random_bytes(4), 'hex'));
  v_payload := jsonb_build_object(
    'request_id', r.id, 'tenant_id', r.tenant_id, 'employee_id', r.employee_id, 'receipt_code', v_code,
    'signed_at', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'accepted', true,
    'term_version', r.term_version, 'term_text_sha256', r.term_text_sha256, 'items', v_items,
    'signature_sha256', p_signature_sha256, 'ip', p_ip, 'user_agent', left(p_user_agent, 300), 'code_verified', true);
  v_hash := encode(digest(v_payload::text, 'sha256'), 'hex');
  INSERT INTO epi_signatures (tenant_id, request_id, employee_id, signed_at, accepted, term_version, term_text_sha256, items_snapshot,
                              signature_file_key, signature_sha256, ip, user_agent, code_verified, evidence_payload, evidence_sha256, receipt_code)
  VALUES (r.tenant_id, r.id, r.employee_id, v_now, true, r.term_version, r.term_text_sha256, v_items,
          p_signature_key, p_signature_sha256, p_ip, left(p_user_agent, 300), true, v_payload, v_hash, v_code)
  RETURNING id INTO v_id;
  SELECT full_name INTO v_name FROM employees WHERE id = r.employee_id;
  UPDATE employee_epi_deliveries d SET signature_status = 'assinada', signed_at = v_now, signed_by_name = left(v_name, 200)
   WHERE d.id IN (SELECT delivery_id FROM epi_signature_request_items WHERE request_id = r.id);
  UPDATE epi_signature_requests SET status = 'assinada', used_at = v_now WHERE id = r.id;
  RETURN QUERY SELECT 'ok'::text, v_id, v_code, v_now, v_hash;
END;
$$;

CREATE FUNCTION epi_sig_refuse(p_token_hash TEXT, p_pin_hash TEXT, p_reason TEXT)
RETURNS TABLE(result TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM epi_sig_check(p_token_hash, p_pin_hash);
  IF c.result <> 'ok' THEN RETURN QUERY SELECT c.result; RETURN; END IF;
  UPDATE employee_epi_deliveries d SET signature_status = 'recusada'
   WHERE d.signature_status = 'pendente'
     AND d.id IN (SELECT delivery_id FROM epi_signature_request_items WHERE request_id = c.req_id);
  UPDATE epi_signature_requests SET status = 'recusada', used_at = now(), refusal_reason = left(p_reason, 300) WHERE id = c.req_id;
  RETURN QUERY SELECT 'ok'::text;
END;
$$;

DO $$ DECLARE f TEXT; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'epi_sig_check(text,text)','epi_sig_peek(text)','epi_sig_items(uuid)','epi_sig_open(text,text)',
    'epi_sig_sign(text,text,boolean,text,text,text,text)','epi_sig_refuse(text,text,text)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO montese_auth_bypass', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION epi_sig_peek(text), epi_sig_open(text,text),
  epi_sig_sign(text,text,boolean,text,text,text,text), epi_sig_refuse(text,text,text) TO montese_app;
```
Notas ao executor: (a) o `ALTER FUNCTION ... OWNER TO` exige que quem roda a migration seja membro de `montese_auth_bypass` (VERIFICADO no subsistema 1: `01-app-role.sh` concede), e os `GRANT ... TO montese_auth_bypass` exigem que o executor seja dono das tabelas — confirmar rodando **todas as migrations como `montese_app`** num ensaio novo, como no subsistema 1; (b) `gen_random_bytes` e `digest` vêm do pgcrypto: confirmar que estão acessíveis com `search_path = public, pg_temp`; (c) `FOR UPDATE OF d` com `count(*)` agregado pode ser inválido no Postgres ("FOR UPDATE is not allowed with aggregate functions"): se falhar, travar as entregas num `PERFORM ... FOR UPDATE` separado antes de contar; (d) o `epi_sig_items` é `STABLE`: como é chamado dentro da mesma transação das escritas, confirme que enxerga as linhas atuais (senão trocar por `VOLATILE`); (e) `epi_tenant_row_exists` vem da 0081.

- [ ] **Step 5: Aplicar como `montese_app` e rodar o teste**

Num ensaio limpo, aplicar todas as migrations conectando como `montese_app` (psql com a senha do app lida do `ensaio.env` por `grep`/`sed` **sem imprimir**, como no subsistema 1) e depois `run-be-rl.sh e2e "epi-signature-schema epi-ficha-schema epi-ledger-schema" <log>`. Expected: PASS. Se o cascade de tenant falhar, investigar a ordem de RESTRICT/CASCADE (nunca afrouxar o DELETE direto).

- [ ] **Step 6: Entrega** (listar arquivos; não comitar).

---

### Task 2: Núcleo do responsável — segredos, criação, revogação, presencial

**Files:**
- Create: `backend/src/epi-signature/signature-secrets.util.ts`, `epi-signature.module.ts`, `epi-signature.controller.ts`, `epi-signature.service.ts`, `dto/create-signature-request.dto.ts`, `dto/in-person.dto.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/signature-secrets.unit-spec.ts`, `backend/test/epi-signature-create.e2e-spec.ts`

**Interfaces:**
- Produces: `generateToken(): string`, `generatePin(): string`, `hashToken(token): string`, `hashPin(token, pin): string`, `termTextSha256(): string`, `signatureTermAllowed(): boolean`; `EpiSignatureService.createRequest(client, dto, userId)`, `listRequests(client, employeeId)`, `revoke(client, id)`, `registerInPerson(client, dto, userId)`; rotas `POST /epi-signatures/requests`, `GET /epi-signatures/requests?employee_id=`, `POST /epi-signatures/requests/:id/revoke`, `POST /epi-signatures/in-person`.

- [ ] **Step 1: Segredos (unit RED → GREEN)**

`backend/test/signature-secrets.unit-spec.ts`:

```ts
import { createHash, createHmac } from 'crypto';
import { generatePin, generateToken, hashPin, hashToken, signatureTermAllowed, termTextSha256 } from '../src/epi-signature/signature-secrets.util';

describe('signature-secrets', () => {
  it('token tem 43 caracteres base64url (256 bits) e é diferente a cada chamada', () => {
    const a = generateToken(), b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
  it('código tem 6 dígitos com zeros à esquerda e cobre toda a faixa', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) { const p = generatePin(); expect(p).toMatch(/^\d{6}$/); seen.add(p); }
    expect(seen.size).toBeGreaterThan(1900);
  });
  it('hashToken é SHA-256 e hashPin é HMAC com chave = token (sem segredo de servidor)', () => {
    expect(hashToken('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
    expect(hashPin('tok', '123456')).toBe(createHmac('sha256', 'tok').update('123456').digest('hex'));
    expect(hashPin('tok', '123456')).not.toBe(hashPin('tok2', '123456'));
  });
  it('termo rascunho só permite assinatura com a variável ligada', () => {
    delete process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM;
    expect(signatureTermAllowed()).toBe(false);
    process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'true';
    expect(signatureTermAllowed()).toBe(true);
    process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = '1';
    expect(signatureTermAllowed()).toBe(false); // só 'true' literal
    delete process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM;
  });
  it('hash do texto do termo é estável e muda com o texto', () => { expect(termTextSha256()).toMatch(/^[0-9a-f]{64}$/); expect(termTextSha256()).toBe(termTextSha256()); });
});
```

`backend/src/epi-signature/signature-secrets.util.ts`:

```ts
import { createHash, createHmac, randomBytes, randomInt } from 'crypto';
import { EPI_TERM } from '../epi-ficha/epi-ficha-term';
import { canonicalJson, sha256Hex } from '../epi-ficha/canonical-json.util';

export const generateToken = (): string => randomBytes(32).toString('base64url');
export const generatePin = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
// Chave = o próprio token: o código só é conferível por quem tem o token (que só existe em hash no banco).
export const hashPin = (token: string, pin: string): string => createHmac('sha256', token).update(pin).digest('hex');
export const termTextSha256 = (): string => sha256Hex(canonicalJson(EPI_TERM));
// Termo em rascunho só pode ser assinado com a variável ligada (padrão: bloqueado em produção).
export const signatureTermAllowed = (): boolean => !EPI_TERM.draft || process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM === 'true';
```

- [ ] **Step 2: Teste e2e da criação (RED)**

`backend/test/epi-signature-create.e2e-spec.ts` — fixtures como `epi-ficha-issue.e2e-spec.ts` (app com `configureApp`, R2 mockado, empresa A e B, técnico/parceiro vinculados via o padrão de `epi-stock-permissions.e2e-spec.ts`, EPI com abertura de 50, helper `deliver(employee, qty)` que cria entrega pelo livro: `POST /epis/:id/movements` tipo `entrega`; `process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'true'` no `beforeAll`). Casos:

```ts
it('cria requisição para as entregas pendentes do funcionário e devolve link, QR e código só uma vez', async () => {
  const d1 = await deliver(emp, 1), d2 = await deliver(emp, 2);
  const r = await create(emp, { idempotency_key: key() });
  expect(r.status).toBe(201);
  expect(r.body.url).toMatch(/\/assinar#token=[A-Za-z0-9_-]{43}$/);
  expect(r.body.qr_payload).toBe(r.body.url);
  expect(r.body.code).toMatch(/^\d{6}$/);
  expect(new Date(r.body.expires_at).getTime() - Date.now()).toBeGreaterThan(23 * 3600 * 1000);
  expect(r.body.delivery_ids.sort()).toEqual([d1, d2].sort());
  const row = (await sql.query('SELECT token_hash, pin_hash, status FROM epi_signature_requests WHERE id = $1', [r.body.id])).rows[0];
  const token = r.body.url.split('token=')[1];
  expect(row.token_hash).toBe(hashToken(token));
  expect(row.pin_hash).toBe(hashPin(token, r.body.code));
  expect(JSON.stringify(row)).not.toContain(token);
  expect(row.status).toBe('ativa');
  const list = await request(srv).get(`/epi-signatures/requests?employee_id=${emp}`).set(auth());
  expect(JSON.stringify(list.body)).not.toMatch(new RegExp(token)); // lista nunca devolve token/código
  expect(JSON.stringify(list.body)).not.toMatch(/token_hash|pin_hash/);
});
it('novo link para as mesmas entregas revoga o anterior; entregas recusadas voltam a pendente', async () => {});
it('mesma idempotency_key -> 409 (o código não é recuperável); chave igual em outra empresa é independente', async () => {});
it('sem entregas pendentes -> 409; entrega de outro funcionário ou de outra empresa -> 404; entrega estornada/assinada -> 409', async () => {});
it('termo em rascunho e variável desligada -> 409 sem criar requisição', async () => {
  process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'false';
  const r = await create(emp, { idempotency_key: key() });
  expect(r.status).toBe(409);
  expect((await sql.query('SELECT 1 FROM epi_signature_requests WHERE employee_id = $1', [freshEmp])).rowCount).toBe(0);
  process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'true';
});
it('revoke: a requisição vira revogada e o link deixa de abrir (peek não utilizável)', async () => {});
it('presencial: marca entregas pendentes como presencial com testemunha e motivo; sem testemunha/motivo -> 400; entrega já assinada -> 409', async () => {});
it('permissões e isolamento: empresa B 404; técnico/parceiro vinculados 201; não vinculados 404; admin 201; sem token 401', async () => {});
it('entrada inválida -> 400: delivery_ids não UUID/duplicados/>50, idempotency_key curta/NUL, corpo extra, employee_id inválido', async () => {});
it('auditoria: a criação passa pelo AuditInterceptor e o corpo (código) não é registrado', async () => {});
```
Os casos com corpo vazio devem ser implementados de verdade (código real, no estilo do primeiro). Run → FAIL (rotas inexistentes).

- [ ] **Step 3: DTOs**

```ts
// dto/create-signature-request.dto.ts
import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { NO_NUL } from '../../epi/dto/epi-dto-rules';
export class CreateSignatureRequestDto {
  @IsUUID() employee_id: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID('all', { each: true }) delivery_ids?: string[];
  @IsString() @MinLength(8) @MaxLength(100) @Matches(NO_NUL) idempotency_key: string;
}
// dto/in-person.dto.ts
export class InPersonDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique() @IsUUID('all', { each: true }) delivery_ids: string[];
  @IsString() @MinLength(3) @MaxLength(120) @Matches(NO_NUL) witness_name: string;
  @IsString() @MinLength(5) @MaxLength(300) @Matches(NO_NUL) reason: string;
}
```
(importar `ArrayMinSize`).

- [ ] **Step 4: Serviço do responsável**

`epi-signature.service.ts` (trecho central; completar o restante no mesmo estilo):

```ts
@Injectable()
export class EpiSignatureService {
  async createRequest(client: PoolClient, dto: CreateSignatureRequestDto, userId: string) {
    if (!signatureTermAllowed()) throw new ConflictException('O termo de recebimento ainda não foi aprovado para uso');
    // 1) trava o funcionário (serializa novos links do mesmo funcionário) e obtém o tenant da LINHA (nunca do corpo)
    const emp = (await client.query('SELECT id, tenant_id FROM employees WHERE id = $1 FOR NO KEY UPDATE', [dto.employee_id])).rows[0];
    if (!emp) throw new NotFoundException('Funcionário não encontrado');
    // 2) idempotência: a chave já usada devolve 409 (o código em claro não é recuperável)
    const prev = await client.query('SELECT 1 FROM epi_signature_requests WHERE tenant_id = $1 AND idempotency_key = $2', [emp.tenant_id, dto.idempotency_key]);
    if (prev.rowCount) throw new ConflictException('Link já emitido com esta chave; revogue e gere outro');
    // 3) entregas elegíveis: do funcionário, pendentes ou recusadas
    const ids = dto.delivery_ids;
    const rows = (await client.query(
      `SELECT id, signature_status, employee_id FROM employee_epi_deliveries
        WHERE employee_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[])) AND signature_status IN ('pendente','recusada')
          AND quantity IS NOT NULL FOR UPDATE`, [dto.employee_id, ids ?? null])).rows;
    if (ids) {
      // todas as pedidas devem existir sob RLS e pertencer ao funcionário
      const found = (await client.query('SELECT id, employee_id, signature_status FROM employee_epi_deliveries WHERE id = ANY($1::uuid[])', [ids])).rows;
      if (found.length !== ids.length || found.some((f) => f.employee_id !== dto.employee_id)) throw new NotFoundException('Entrega não encontrada');
      if (rows.length !== ids.length) throw new ConflictException('Há entregas que não aguardam assinatura');
    }
    if (rows.length === 0) throw new ConflictException('Não há entregas aguardando assinatura');
    // 4) revoga links ativos anteriores que compartilhem entregas
    await client.query(
      `UPDATE epi_signature_requests SET status = 'revogada'
        WHERE status = 'ativa' AND id IN (SELECT request_id FROM epi_signature_request_items WHERE delivery_id = ANY($1::uuid[]))`,
      [rows.map((r) => r.id)]);
    // 5) entregas recusadas voltam a pendente
    await client.query(`UPDATE employee_epi_deliveries SET signature_status = 'pendente' WHERE id = ANY($1::uuid[]) AND signature_status = 'recusada'`, [rows.map((r) => r.id)]);
    // 6) cria a requisição (token e código em claro só existem nesta resposta)
    const token = generateToken(); const pin = generatePin();
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
    let inserted;
    try {
      inserted = await client.query(
        `INSERT INTO epi_signature_requests (tenant_id, employee_id, token_hash, pin_hash, expires_at, term_version, term_text_sha256, created_by_user_id, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, expires_at`,
        [emp.tenant_id, dto.employee_id, hashToken(token), hashPin(token, pin), expiresAt, EPI_TERM.version, termTextSha256(), userId, dto.idempotency_key]);
    } catch (err) { mapPgError(err); }
    for (const r of rows) await client.query('INSERT INTO epi_signature_request_items (request_id, delivery_id) VALUES ($1,$2)', [inserted.rows[0].id, r.id]);
    const base = (process.env.PUBLIC_APP_URL ?? 'https://app.invalid').replace(/\/$/, '');
    const url = `${base}/assinar#token=${token}`;
    return { id: inserted.rows[0].id, url, qr_payload: url, code: pin, expires_at: inserted.rows[0].expires_at, delivery_ids: rows.map((r) => r.id) };
  }
  // listRequests: SELECT id, employee_id, status, attempts, expires_at, created_at, used_at, refusal_reason + delivery_ids (nunca token_hash/pin_hash)
  // revoke: UPDATE ... SET status='revogada' WHERE id=$1 AND status='ativa' RETURNING id; 404 se não existir (RLS), 409 se não estiver ativa
  // registerInPerson: valida entregas pendentes/recusadas do MESMO funcionário e empresa (404/409), UPDATE signature_status='presencial', signed_at=now(),
  //   signed_by_name=<nome da testemunha com prefixo 'Presencial (testemunha): '>, e revoga links ativos dessas entregas; devolve as entregas atualizadas.
}
```
Controller: `@Controller('epi-signatures')`, `@Roles('empresa','tecnico','parceiro','admin')`, `@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))`, `ParseUUIDPipe` em `:id`, `res.status(201)`; declare as rotas `requests` e `in-person` **antes** de qualquer rota `:id`. `Cache-Control: no-store` na resposta de criação (contém o código). Registrar `EpiSignatureModule` em `app.module.ts`.

- [ ] **Step 5: Rodar** — `run-be-rl.sh unit "signature-secrets cpf-mask canonical-json tenant-context-callsites" <log>` e `run-be-rl.sh e2e "epi-signature-create epi-signature-schema epi-ficha-issue epi-stock-permissions" <log>`; `tsc --noEmit`. Expected: PASS.

- [ ] **Step 6: Entrega** (listar arquivos; não comitar).

---

### Task 3: Rotas públicas — peek, open, sign, refuse

**Files:**
- Create: `backend/src/epi-signature/signature-png.util.ts`, `epi-signature-public.service.ts`, `epi-signature-public.controller.ts`, `dto/public-token.dto.ts`, `dto/public-open.dto.ts`, `dto/public-sign.dto.ts`, `dto/public-refuse.dto.ts`, `backend/test/helpers/png.ts`
- Modify: `epi-signature.module.ts`, `backend/test/tenant-context-callsites.unit-spec.ts` (ALLOWED)
- Test: `backend/test/signature-png.unit-spec.ts`, `backend/test/epi-signature-public.e2e-spec.ts`

**Interfaces:**
- Consumes: `hashToken`, `hashPin`, funções SQL da Task 1, `EPI_TERM`.
- Produces: `validateSignaturePng(buf: Buffer): { width: number; height: number }` (lança `BadRequestException`); rotas públicas (todas `POST`, token e código no corpo): `/epi-signatures/public/peek` {token}, `/open` {token, code}, `/sign` {token, code, accepted, term_version, signature_png_base64}, `/refuse` {token, code, reason?}.

- [ ] **Step 1: Helper de PNG para testes e validador (RED → GREEN)**

`backend/test/helpers/png.ts` — gera PNG RGBA 8 bits real sem dependências:

```ts
import { deflateSync } from 'zlib';

const CRC_TABLE = (() => { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
// pixel(x,y) devolve [r,g,b,a]; padrão = transparente (canvas em branco)
export function makePng(w: number, h: number, pixel: (x: number, y: number) => [number, number, number, number] = () => [0, 0, 0, 0], opts: { colorType?: number; interlace?: number } = {}): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = opts.colorType ?? 6; ihdr[12] = opts.interlace ?? 0;
  const bpp = (opts.colorType ?? 6) === 6 ? 4 : 3;
  const raw = Buffer.alloc(h * (1 + w * bpp));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * bpp)] = 0; for (let x = 0; x < w; x++) { const p = pixel(x, y); for (let i = 0; i < bpp; i++) raw[y * (1 + w * bpp) + 1 + x * bpp + i] = p[i]; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const strokePng = (w = 300, h = 100) => makePng(w, h, (x, y) => (Math.abs(y - 50 - Math.round(20 * Math.sin(x / 15))) <= 2 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
export const blankPng = (w = 300, h = 100) => makePng(w, h);
```

`backend/test/signature-png.unit-spec.ts`:

```ts
import { validateSignaturePng } from '../src/epi-signature/signature-png.util';
import { blankPng, makePng, strokePng } from './helpers/png';

describe('validateSignaturePng', () => {
  it('aceita PNG RGBA com traço', () => { expect(validateSignaturePng(strokePng())).toEqual({ width: 300, height: 100 }); });
  it('rejeita canvas em branco (todos os pixels zerados)', () => { expect(() => validateSignaturePng(blankPng())).toThrow(/em branco/i); });
  it('rejeita arquivo que não é PNG, PNG truncado e PNG sem IDAT', () => {
    expect(() => validateSignaturePng(Buffer.from('GIF89a....'))).toThrow();
    expect(() => validateSignaturePng(strokePng().subarray(0, 40))).toThrow();
  });
  it('rejeita dimensões acima do limite, abaixo do mínimo, cor/entrelaçamento diferentes', () => {
    expect(() => validateSignaturePng(makePng(2001, 10))).toThrow();
    expect(() => validateSignaturePng(makePng(20, 10, () => [0, 0, 0, 255]))).toThrow(); // < 50x30
    expect(() => validateSignaturePng(makePng(300, 100, () => [0, 0, 0, 255], { colorType: 2 }))).toThrow();
    expect(() => validateSignaturePng(makePng(300, 100, () => [0, 0, 0, 255], { interlace: 1 }))).toThrow();
  });
  it('rejeita bomba de descompressão e arquivo maior que 200 KB', () => {
    expect(() => validateSignaturePng(Buffer.concat([strokePng(), Buffer.alloc(210 * 1024)]))).toThrow(/tamanho/i);
  });
});
```

`backend/src/epi-signature/signature-png.util.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { inflateSync } from 'zlib';

export const MAX_SIGNATURE_BYTES = 200 * 1024;
const MAX_W = 2000, MAX_H = 1000, MIN_W = 50, MIN_H = 30;
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// PNG RGBA 8 bits, não entrelaçado, de canvas transparente. Rejeita imagem em branco sem biblioteca: todo filtro PNG
// preserva zeros, então "todos os bytes de pixel zero" ≡ imagem totalmente transparente.
export function validateSignaturePng(buf: Buffer): { width: number; height: number } {
  const bad = (m: string) => new BadRequestException(m);
  if (buf.length > MAX_SIGNATURE_BYTES) throw bad('Imagem da assinatura acima do tamanho permitido');
  if (buf.length < 70 || !buf.subarray(0, 8).equals(SIG)) throw bad('Imagem da assinatura inválida');
  let off = 8, width = 0, height = 0, ok = false; const idat: Buffer[] = [];
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    if (len > buf.length || off + 12 + len > buf.length) throw bad('Imagem da assinatura inválida');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      if (len !== 13) throw bad('Imagem da assinatura inválida');
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw bad('Imagem da assinatura em formato não aceito');
      ok = true;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ok || idat.length === 0) throw bad('Imagem da assinatura inválida');
  if (width < MIN_W || height < MIN_H || width > MAX_W || height > MAX_H) throw bad('Dimensões da assinatura fora do permitido');
  const expected = height * (1 + width * 4);
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 16 }); } catch { throw bad('Imagem da assinatura inválida'); }
  if (raw.length !== expected) throw bad('Imagem da assinatura inválida');
  const stride = 1 + width * 4;
  for (let y = 0; y < height; y++) for (let i = 1; i < stride; i++) if (raw[y * stride + i] !== 0) return { width, height };
  throw bad('A assinatura está em branco');
}
```
Run: `run-be-rl.sh unit "signature-png" <log>` (RED sem o util, GREEN com ele).

- [ ] **Step 2: Teste e2e das rotas públicas (RED)**

`backend/test/epi-signature-public.e2e-spec.ts` — fixtures da Task 2 (`create(emp, …)` devolve `{ token, code, id }` lido da URL) mais `fakeR2`. Casos (implementar todos com código real):

```ts
const post = (path: string, body: object) => request(srv).post(`/epi-signatures/public/${path}`).send(body);

it('peek: link ativo mostra só o nome da empresa; inexistente/expirado/revogado/usado respondem IGUAL', async () => {
  const ok = await post('peek', { token });
  expect(ok.status).toBe(200); expect(ok.body).toEqual({ usable: true, company_name: expect.any(String) });
  const bodies = await Promise.all([post('peek', { token: 'x'.repeat(43) }), post('peek', { token: expiredToken }), post('peek', { token: revokedToken }), post('peek', { token: usedToken })]);
  for (const r of bodies) { expect(r.status).toBe(200); expect(r.body).toEqual({ usable: false }); }
  expect(ok.headers['cache-control']).toBe('no-store');
});
it('open: código certo devolve nome do funcionário, itens e termo — sem CPF; errado -> 401 com tentativas restantes; 5ª -> 403 e bloqueia', async () => {});
it('open com token inexistente/expirado/revogado -> 404 com a MESMA mensagem; bloqueado -> 403', async () => {});
it('sign: PNG válido + aceite -> 201, evidência gravada, entregas assinadas, imagem no R2 com hash igual, comprovante com código; a ficha passa a mostrar a assinatura', async () => {
  const png = strokePng();
  const r = await post('sign', { token, code, accepted: true, term_version: 'rascunho-1', signature_png_base64: png.toString('base64') });
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ receipt_code: expect.stringMatching(/^ASEPI-\d{8}-[0-9A-F]{8}$/), signed_at: expect.any(String) });
  const ev = (await sql.query('SELECT * FROM epi_signatures WHERE receipt_code = $1', [r.body.receipt_code])).rows[0];
  expect(sha256Hex(fakeR2.store.get(ev.signature_file_key)!)).toBe(ev.signature_sha256);
  expect(ev.ip).toBeTruthy(); expect(JSON.stringify(ev.items_snapshot)).not.toMatch(/\b\d{11}\b/);
});
it('sign: imagem em branco / não PNG / grande / base64 inválido / sem aceite / termo desatualizado -> 400 sem gravar nada e sem consumir o link', async () => {});
it('sign: código errado conta tentativa (401) e NÃO envia imagem ao R2', async () => { expect(fakeR2.putCount).toBe(before); });
it('sign duas vezes com o mesmo link -> segunda é 404 uniforme; 6 assinaturas simultâneas -> exatamente 1 vence e o R2 não fica com imagem órfã das perdedoras', async () => {});
it('refuse: entregas viram recusada, link encerrado, motivo guardado; recusa com NUL/ >300 -> 400', async () => {});
it('R2 indisponível no sign -> 502 e o link continua utilizável', async () => { fakeR2.failNextPut = true; /* … */ });
it('termo rascunho com a variável desligada -> sign devolve 409 e nada é gravado', async () => {});
it('rate limit: acima do limite por IP a rota devolve 429', async () => { /* usar override de env do RateLimit? ver nota */ });
it('nenhuma resposta ou log contém o token, o código, o base64 da imagem ou CPF', async () => { /* capturar logger e comparar */ });
it('entrada inválida -> 400: token fora do formato (não 43 base64url), code que não seja 6 dígitos, corpo extra, base64 gigante antes de decodificar (limite do body)', async () => {});
```
Nota: o teste de rate limit usa `RATE_LIMIT_MAX` alto no ensaio, mas o `@RateLimit` da rota é fixo; teste com um app Nest isolado sem `RATE_LIMIT_MAX` e chamadas em sequência até 429, ou valide o decorator por metadados (`Reflect.getMetadata`) se o Redis for um problema. Fixar o limite escolhido.

- [ ] **Step 3: DTOs públicos**

```ts
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export class PublicTokenDto { @IsString() @Matches(TOKEN) token: string; }
export class PublicOpenDto extends PublicTokenDto { @IsString() @Matches(/^\d{6}$/) code: string; }
export class PublicSignDto extends PublicOpenDto {
  @IsBoolean() accepted: boolean;
  @IsString() @MaxLength(32) @Matches(NO_NUL) term_version: string;
  @IsString() @MaxLength(300_000) @Matches(/^[A-Za-z0-9+/]+={0,2}$/) signature_png_base64: string; // ≈ 200 KB decodificados
}
export class PublicRefuseDto extends PublicOpenDto { @IsOptional() @IsString() @MaxLength(300) @Matches(NO_NUL) reason?: string; }
```
Conferir o limite de corpo do Nest/Express (`json({ limit })`) em `main.ts`/`app-setup.ts`: o padrão de 100 KB não comporta 300 KB de base64; aumentar **só para essas rotas** (middleware específico ou `bodyParser` por rota) sem elevar o limite global; documentar o valor.

- [ ] **Step 4: Serviço público**

`epi-signature-public.service.ts` (usa `DatabaseService.withoutTenantContext`; **não** usa `req.withTenantContext`):

```ts
@Injectable()
export class EpiSignaturePublicService {
  private readonly logger = new Logger(EpiSignaturePublicService.name);
  constructor(private readonly db: DatabaseService, private readonly r2: R2Service) {}

  async peek(token: string): Promise<{ usable: boolean; company_name?: string }> {
    const r = await this.db.withoutTenantContext((c) => c.query('SELECT * FROM epi_sig_peek($1)', [hashToken(token)]));
    return r.rows[0]?.usable ? { usable: true, company_name: r.rows[0].company_name } : { usable: false };
  }

  async open(token: string, code: string) {
    const r = (await this.db.withoutTenantContext((c) => c.query('SELECT * FROM epi_sig_open($1,$2)', [hashToken(token), hashPin(token, code)]))).rows[0];
    this.throwIfNotOk(r);
    if (r.term_version !== EPI_TERM.version) throw new NotFoundException(INVALID); // termo desatualizado: link inválido
    return { employee_name: r.employee_name, expires_at: r.expires_at, items: r.items,
             term: { version: EPI_TERM.version, draft: EPI_TERM.draft, title: EPI_TERM.title, paragraphs: EPI_TERM.paragraphs }, attempts_left: r.attempts_left };
  }

  async sign(token: string, dto: PublicSignDto, ctx: { ip: string; userAgent: string }) {
    if (!signatureTermAllowed()) throw new ConflictException('Assinatura indisponível: o termo ainda não foi aprovado');
    if (dto.term_version !== EPI_TERM.version) throw new BadRequestException('Termo desatualizado: recarregue a página');
    if (!dto.accepted) throw new BadRequestException('É necessário aceitar o termo');
    const png = Buffer.from(dto.signature_png_base64, 'base64');
    validateSignaturePng(png); // 400 antes de gastar tentativa ou chamar o R2
    const tokenHash = hashToken(token), pinHash = hashPin(token, dto.code);
    // 1) confere token+código (conta tentativa se errado) e obtém o tenant para a chave do R2
    const o = (await this.db.withoutTenantContext((c) => c.query('SELECT * FROM epi_sig_open($1,$2)', [tokenHash, pinHash]))).rows[0];
    this.throwIfNotOk(o);
    if (o.term_version !== EPI_TERM.version) throw new NotFoundException(INVALID);
    // 2) imagem no R2 (chave imprevisível), com timeout
    const key = `tenants/${o.tenant_id}/epi-signatures/${randomUUID()}.png`;
    await this.putWithTimeout(key, png);
    // 3) grava evidência e atualiza as entregas (atômico no banco); se perder a corrida, remove a imagem
    let s;
    try {
      s = (await this.db.withoutTenantContext((c) => c.query('SELECT * FROM epi_sig_sign($1,$2,$3,$4,$5,$6,$7)',
        [tokenHash, pinHash, true, key, sha256Hex(png), ctx.ip, ctx.userAgent]))).rows[0];
    } catch (err) { await this.bestEffortDelete(key); throw err; }
    if (s.result !== 'ok') { await this.bestEffortDelete(key); this.throwIfNotOk({ result: s.result, attempts_left: 0 }); }
    return { receipt_code: s.receipt_code, signed_at: s.signed_at, evidence_sha256: s.evidence_sha256 };
  }
  // refuse(token, dto): epi_sig_refuse; mesmos erros; devolve { status: 'recusada' }
  // throwIfNotOk: 'invalid' -> NotFoundException(INVALID); 'wrong_code' -> UnauthorizedException({ message: 'Código incorreto', attempts_left });
  //   'locked' -> ForbiddenException('Link bloqueado por tentativas incorretas'); 'conflict' -> ConflictException('Estas entregas já foram tratadas');
  //   'not_accepted' -> BadRequestException. INVALID = 'Link inválido ou expirado' (mensagem única).
  // putWithTimeout/bestEffortDelete: mesmos padrões de EpiFichaService (EPI_FICHA_R2_TIMEOUT_MS); falha/timeout do PUT -> BadGatewayException e o link permanece utilizável.
}
```
Controller público: `@Controller('epi-signatures/public')`, `@Public()`, `@RateLimit({ limit: 20, windowSeconds: 600, keyBy: 'ip' })` em `open`/`sign`/`refuse` e `{ limit: 60, windowSeconds: 600 }` em `peek`; `ValidationPipe` (whitelist/forbid); `@Res({ passthrough: true })` para `Cache-Control: no-store`; IP de `req.ip` e `user-agent` do cabeçalho (truncar a 300). **Nunca** logar o corpo; confirmar que o `AuditInterceptor` global (que audita POST) não registra corpo e que `resourceId` não vaza o token (não há `:id` na rota).

- [ ] **Step 5: ALLOWED do teste de guarda de tenant**

`backend/test/tenant-context-callsites.unit-spec.ts`: acrescentar `epi-signature/epi-signature-public.service.ts` à lista `ALLOWED` com comentário: "rotas públicas de assinatura: sem contexto de empresa, só chama funções SECURITY DEFINER estreitas (epi_sig_*); revisado". **O revisor de segurança deve validar essa entrada.**

- [ ] **Step 6: Rodar** — unit `signature-png signature-secrets tenant-context-callsites`; e2e `epi-signature-public epi-signature-create epi-signature-schema epi-ficha-issue`; `tsc --noEmit`; `nest build`. Expected: PASS.

- [ ] **Step 7: Entrega** (listar arquivos; não comitar).

---

### Task 4: Comprovante em PDF e integração com a ficha

**Files:**
- Create: `backend/src/epi-signature/receipt-pdf.util.ts`
- Modify: `backend/src/epi-signature/epi-signature.service.ts` e `.controller.ts` (rota do comprovante), `backend/src/epi-ficha/epi-ficha.types.ts`, `epi-ficha.service.ts`, `ficha-pdf.util.ts`
- Test: `backend/test/epi-signature-receipt.unit-spec.ts`, `backend/test/epi-signature-ficha.e2e-spec.ts`

**Interfaces:**
- Consumes: `drawBrandFooter`, `brandFooterHeight`, `maskCpf`, `extractPdfTextFull` (testes).
- Produces: `buildReceiptPdf(data: ReceiptData): Promise<Buffer>`; `GET /epi-signatures/:id/receipt.pdf` (autenticada; `:id` = id da `epi_signatures`); `FichaLine` ganha `receipt_code: string | null; signed_at: string | null`; `Ficha` ganha `signatures: FichaSignature[]`; `buildFichaPdf(ficha, meta, signatureImages?: Map<string, Buffer>)`.

- [ ] **Step 1: Comprovante (unit RED → GREEN)**

`ReceiptData`: `{ company: {name, cnpj}, employee: {full_name, cpf_masked}, receipt_code, signed_at (ISO), items: [{date, epi_description, manufacturer, model, ca_number, quantity}], term: {version, draft, title, paragraphs}, evidence_sha256, signature_sha256, ip }`. `receipt-pdf.util.ts` usa `pdfkit` com `bufferPages`, o cabeçalho/rodapé de marca do subsistema 2 (`drawBrandFooter`), imprime o código do comprovante, data/hora em America/Sao_Paulo (dd/mm/aaaa hh:mm), itens, o termo (com "RASCUNHO" se `draft`), os hashes e a frase: "Assinatura eletrônica simples, registrada com aceite explícito, código de confirmação e evidências técnicas; não é assinatura digital com certificado ICP-Brasil." Teste unitário:

```ts
it('gera PDF válido com código, itens, CPF mascarado, hashes e a declaração de assinatura simples', async () => {
  const text = await extractPdfTextFull(await buildReceiptPdf(sample));
  expect(text).toContain('ASEPI-20261015-ABCD1234'); expect(text).toContain('***.533.447-**');
  expect(text).toContain('Assinatura eletrônica simples'); expect(text).not.toMatch(/ICP-Brasil.*(válida|certificada)/i);
  expect(text).toContain('rascunho'.toUpperCase()); expect(text).not.toMatch(/\b\d{11}\b/);
});
it('nome com emoji/CJK e muitos itens (80) não quebram o PDF e mantêm um rodapé por página', async () => {});
```

- [ ] **Step 2: Rota do comprovante (e2e RED → GREEN)**

`GET /epi-signatures/:id/receipt.pdf` (`@Roles('empresa','tecnico','parceiro','admin')`, `ParseUUIDPipe`): lê `epi_signatures` + empresa + funcionário sob RLS (`req.withTenantContext`), **fecha a transação** e só então gera o PDF; `Cache-Control: private, no-store`, `Content-Disposition: inline; filename="<receipt_code>.pdf"` (código gerado pelo servidor). Testes: 200 `%PDF`, texto confere com a evidência; empresa B 404; técnico não vinculado 404; id inválido 400.

- [ ] **Step 3: Ficha — status assinado e anexo (e2e RED → GREEN)**

`epi-ficha.service.ts` `getFicha`: no ramo do livro, juntar `epi_signature_request_items` → `epi_signatures` (apenas requisições `assinada`) para preencher `receipt_code` e `signed_at` (`to_char(... AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SSOF')`) nas linhas `assinada`; acrescentar `signatures` = lista distinta `{ receipt_code, signed_at, evidence_sha256, signature_sha256, signature_file_key? }` — **`signature_file_key` NÃO entra no snapshot nem na resposta pública** (use um campo interno separado só para o emissor ler as imagens). `ficha-pdf.util.ts`: na coluna Assinatura, linhas `assinada` mostram "Assinada eletronicamente em dd/mm/aaaa hh:mm — comprovante CODE"; **anexo "Comprovantes de assinatura"** após o termo: para cada assinatura com imagem disponível, imagem em fundo branco (largura ≤ 220 pt), código, data/hora, hashes; sem imagem disponível (prévia ou limite): lista só código/data. `issue()` lê as imagens do R2 (no máximo 100, em paralelo, com timeout único `EPI_FICHA_R2_TIMEOUT_MS`; falha/timeout → 502 sem registro) e passa `Map<receipt_code, Buffer>` ao `buildFichaPdf`; a prévia **não** lê imagens. O instantâneo guarda `signatures` com os hashes (a imagem fica atrelada por `signature_sha256`). Testes `epi-signature-ficha.e2e-spec.ts`: sem evidência o PDF não tem anexo nem imagem; com evidência (assinatura criada pelo fluxo real da Task 3) o PDF emitido contém o código e o anexo, e a prévia contém só o código; entrega `presencial` aparece como "Registrada presencialmente" sem anexo; as 120 linhas/100 assinaturas não estouram; o `snapshot` guardado não tem `signature_file_key` nem CPF cru.

- [ ] **Step 4: Rodar** — unit `epi-signature-receipt epi-ficha-pdf signature-png signature-secrets`; e2e `epi-signature-ficha epi-signature-public epi-ficha-issue epi-ficha-data epi-ficha-pdf`; `tsc --noEmit`; `nest build`; verificação visual do comprovante e do anexo (container descartável com `poppler-utils` para gerar PNG e `Read` nas imagens, como no subsistema 2). Expected: PASS.

- [ ] **Step 5: Entrega** (listar arquivos; não comitar).

---

### Task 5: Frontend — página pública de assinatura

**Files:**
- Create: `frontend/src/lib/epi-signature-api.ts`, `frontend/src/components/epi/SignaturePad.tsx`, `frontend/src/app/assinar/layout.tsx`, `frontend/src/app/assinar/page.tsx`
- Test: `frontend/src/components/epi/__tests__/SignaturePad.test.tsx`, `frontend/src/app/assinar/__tests__/assinar-page.test.tsx`

**Interfaces:**
- Consumes: rotas públicas da Task 3 (`/api/epi-signatures/public/{peek,open,sign,refuse}`).
- Produces: `SignaturePad` (props `{ onChange: (png: string | null) => void; disabled?: boolean }`, `ref` com `clear()`); página `/assinar`.

- [ ] **Step 1: Preparar o ambiente de testes do frontend** — criar o cache `nmf/` no scratchpad (`npm ci` do `frontend/package-lock.json` em container descartável com rede) e um script `run-fe.sh <comando>` que monta `/opt/montese-epi/frontend` (copiado para um diretório de trabalho do container, sem escrever no worktree) + `nmf/` e roda `npx vitest run <padrão>`, `npx tsc --noEmit` e `npm run lint`. **Confirmar o baseline**: rodar antes de qualquer mudança `npx vitest run` e `npm run lint` e registrar o resultado (o projeto tem 3 avisos de lint antigos conhecidos: `MatrizForm`, `FireSafetyEquipmentPanel`, `AdminBrand`).

- [ ] **Step 2: Cliente da API**

`frontend/src/lib/epi-signature-api.ts` (token só no corpo; nunca na URL; sem armazenar o token em `localStorage`):

```ts
export type OpenData = { employee_name: string; expires_at: string; attempts_left: number;
  items: { delivery_id: string; date: string; epi_description: string; manufacturer: string | null; model: string | null; ca_number: string; quantity: number | null }[];
  term: { version: string; draft: boolean; title: string; paragraphs: string[] } };
export class ApiError extends Error { constructor(public status: number, message: string, public attemptsLeft?: number) { super(message); } }

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`/api/epi-signatures/public/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', referrerPolicy: 'no-referrer' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, typeof data.message === 'string' ? data.message : 'Não foi possível concluir a operação', data.attempts_left);
  return data as T;
}
export const peek = (token: string) => post<{ usable: boolean; company_name?: string }>('peek', { token });
export const openLink = (token: string, code: string) => post<OpenData>('open', { token, code });
export const sign = (token: string, code: string, termVersion: string, png: string) => post<{ receipt_code: string; signed_at: string }>('sign', { token, code, accepted: true, term_version: termVersion, signature_png_base64: png.replace(/^data:image\/png;base64,/, '') });
export const refuse = (token: string, code: string, reason?: string) => post<{ status: string }>('refuse', { token, code, reason });
```

- [ ] **Step 3: `SignaturePad` (RED → GREEN)**

Canvas com eventos de ponteiro (`pointerdown/move/up/cancel`), `touch-action: none`, **tamanho INTERNO FIXO 600x200 px, independente de `devicePixelRatio`** (o servidor rejeita PNG acima de 1200x600; a escala para a tela é só por CSS `width: 100%`, e as coordenadas do ponteiro são convertidas para o espaço 600x200), traço preto de ~3 px sobre fundo **transparente** (o servidor exige canvas transparente, RGBA), `onChange(dataUrl | null)` (null enquanto vazio ou ao limpar), botão "Limpar", rótulo acessível (`role="img"` com `aria-label` "Área para assinar com o dedo"), controle por teclado: o botão "Limpar" é focável e a página oferece a alternativa de recusar/pedir ajuda ao responsável (a assinatura exige desenho; usuários sem essa condição usam o fluxo presencial). Testes (jsdom não tem canvas: mockar `HTMLCanvasElement.prototype.getContext` com spies e `toDataURL` devolvendo `data:image/png;base64,AAAA`):

```tsx
it('começa vazio e só emite PNG depois de um traço; Limpar volta a vazio', () => {});
it('ignora ponteiro com botão não primário e não desenha com disabled', () => {});
it('usa fundo transparente (nunca preenche o canvas) — fillRect não é chamado com cor opaca', () => {});
```

- [ ] **Step 4: Página `/assinar` (RED → GREEN)**

`frontend/src/app/assinar/layout.tsx`: layout mínimo (sem o cabeçalho do site), `metadata = { title: 'Assinatura de recebimento de EPI', robots: { index: false, follow: false }, referrer: 'no-referrer' }`. `page.tsx` (`'use client'`): lê `#token=...` do fragmento no `useEffect` e **remove o fragmento da barra de endereço** (`history.replaceState`), exatamente como `redefinir-senha`; guarda o token só em estado React. Estados e telas: `lendo` → (sem token → "Link inválido") → `peek` → se não utilizável "Este link não é mais válido. Peça um novo link ao responsável." → pede o código (campo numérico 6 dígitos, `inputMode="numeric"`, `autoComplete="one-time-code"`) mostrando "Empresa: <nome>" → `open` (erros: 401 "Código incorreto. Restam N tentativa(s)."; 403 "Link bloqueado. Peça um novo link."; 404 "Link inválido ou expirado.") → tela de conferência com nome do funcionário, lista de itens (descrição, fabricante/modelo, CA, quantidade, data), termo (com selo "RASCUNHO" se `draft`), checkbox obrigatório "Li e aceito o termo e confirmo o recebimento dos itens acima", `SignaturePad`, botões "Assinar" (desabilitado até aceite + desenho) e "Recusar" (abre confirmação com motivo opcional) → sucesso com comprovante em tela (código `ASEPI-…`, data/hora em horário de Brasília, "Guarde este código") e mensagem de que a assinatura foi registrada **sem** prometer validade jurídica especial; falha de rede/502 mantém o desenho e permite tentar de novo. Acessibilidade: rótulos associados, foco gerenciado ao trocar de etapa, `aria-live` para erros, contraste AA, alvos ≥ 44 px, texto mínimo 16 px, layout de coluna única mobile-first; nenhum dado em `localStorage`/`sessionStorage`; nada de CPF. Testes (`assinar-page.test.tsx`, `fetch` mockado e `window.location.hash` preparado):

```tsx
it('lê o token do fragmento, remove o fragmento da URL e nunca o envia na URL da API', async () => {});
it('link inválido/expirado mostra a mensagem única e não pede código', async () => {});
it('código errado mostra tentativas restantes; bloqueado mostra orientação', async () => {});
it('só habilita Assinar com aceite e assinatura desenhada; envia PNG sem o prefixo data URL', async () => {});
it('mostra o comprovante com o código; erro 502 preserva o desenho e permite tentar de novo', async () => {});
it('recusar pede confirmação e envia o motivo opcional', async () => {});
it('nenhum CPF e nenhum storage são usados', async () => {});
```

- [ ] **Step 5: Rodar** — `run-fe.sh` com `vitest run` (arquivos novos e a suíte inteira do frontend: regressão), `tsc --noEmit`, `npm run lint` (não pode surgir aviso novo), e `next build` num container descartável (sem publicar nada) para provar que a rota `/assinar` compila. **Verificação visual obrigatória**: subir a página com dados fictícios (script de teste/`next dev` descartável no container, sem backend: mock de `fetch` por um servidor local mínimo) e capturar screenshots mobile (390×844) e desktop com a ferramenta já usada nas fases anteriores (memória `project_visual_qa_tooling`: versões compatíveis com Node 18 e armadilhas de screenshot), inspecioná-las com `Read`. Se não for possível, reportar "NÃO VERIFICADO visualmente".

- [ ] **Step 6: Entrega** (listar arquivos; não comitar).

---

### Task 6: Regressão, revisão independente, documentação e relatório

**Files:**
- Create: `docs/architecture/epi-assinatura.md`
- Modify: `docs/superpowers/specs/2026-10-15-epi-assinatura-eletronica-design.md` (seção de desvios)

- [ ] **Step 1: Regressão no ensaio** — unit completo (`run-be-rl.sh unit "" <log>`; baseline: só `r2-get-object` falha) e e2e completo **em lotes de 12** (um container por lote, `NODE_OPTIONS="--experimental-vm-modules --max-old-space-size=3072"`, `RATE_LIMIT_MAX` alto), comparando as suítes que falham com a lista da linha de base (16 suítes e2e que já falhavam por R2/Mercado Pago/OpenRouter falsos); qualquer suíte nova com falha deve ser reproduzida no código base antes de ser tratada como pré-existente. Frontend: `vitest run` completo, `tsc`, `lint`, `next build`. Registrar comandos e resultados literais.
- [ ] **Step 2: Migration** — ensaio recriado do zero **só com as migrations aplicadas como `montese_app`**; testes de schema passam; **rollback** `0083.down.sql` (DROP das funções e tabelas, recusando executar se houver `epi_signatures` ou requisições não `ativa`/`expirada`) testado com comparação de `pg_dump --schema-only` antes/depois, como no subsistema 1/2.
- [ ] **Step 3: Revisão independente** — `montese-seguranca` (obrigatória e rigorosa: primeira rota pública do módulo; funções SECURITY DEFINER, grants, resposta uniforme, força bruta, enumeração, IDOR, race, imagem/R2, LGPD, logs, headers, CSRF/CORS da rota pública, XSS na página, token no fragmento) e `montese-qa` (diff real e critérios). Corrigir só achados confirmados, numa única onda, com uma re-revisão escopada.
- [ ] **Step 4: Documentação** `docs/architecture/epi-assinatura.md`: modelo, funções SQL e seus grants, fluxo, API (rota, corpo, códigos 200/201/400/401/403/404/409/429/502), segurança (o que protege e o que NÃO prova: identidade), variáveis de ambiente (`EPI_SIGNATURE_ALLOW_DRAFT_TERM`, `EPI_FICHA_R2_TIMEOUT_MS`, `PUBLIC_APP_URL`), frontend, testes e como rodá-los no ensaio, rollback, limitações e decisões pendentes (termo rascunho → assinatura bloqueada em produção; sem envio por e-mail/WhatsApp; sem telas do responsável até o subsistema 4; sem página pública de verificação de documento; limite de 100 imagens no anexo; órfãos de imagem no R2 em falha; ordem de release 0081 → 0082 → 0083; pgcrypto `digest`/`gen_random_bytes` presentes em produção (NÃO VERIFICADO)), rotulando VERIFICADO/NÃO VERIFICADO. Não editar `PROJECT_STATE.md` sem autorização.
- [ ] **Step 5: Relatório final** ao proprietário: arquivos, migration 0083, testes e resultados literais, riscos restantes, validação manual sugerida (criar link numa empresa de teste, abrir no celular, assinar, baixar comprovante e ficha emitida), ordem de release e as decisões que ficam com ele. Não aplicar nada em produção.

---

## Self-Review (spec × plano)

- Tabelas, imutabilidade, RLS, grants, funções `SECURITY DEFINER`, hash do código com HMAC (chave = token), evidência verificável (`evidence_payload` + `evidence_sha256`) → Task 1.
- Criação do link (token 256 bits, código 6 dígitos, mostrados uma vez; revoga anteriores; múltiplas entregas; idempotência; termo rascunho bloqueado por variável), revogação e presencial; permissões e isolamento → Task 2.
- Rotas públicas sem sondagem (respostas uniformes), tentativas (5), expiração (24 h), PNG validado sem biblioteca (inclui imagem em branco), R2 com timeout, corrida (uma vence), aceite explícito, recusa, rate limit, LGPD/logs → Task 3.
- Comprovante em PDF e integração com a ficha (status, anexo só com evidência, sem selo falso) → Task 4.
- Página mobile `/assinar` (token no fragmento, canvas próprio, acessibilidade, estados, sem storage) → Task 5.
- Regressão, rollback, revisão independente, documentação → Task 6.
- Emendas da spec registradas: token no fragmento e rotas `POST` com token no corpo; comprovante sob demanda; entrega continua `pendente` quando o link expira.
- Fora de escopo mantido: envio por e-mail/WhatsApp, telas do responsável, página pública de verificação, ICP-Brasil.
- Tipos consistentes: `hashToken/hashPin`, `result ∈ {ok, invalid, locked, wrong_code, conflict, not_accepted}`, `validateSignaturePng`, `buildReceiptPdf`, `FichaSignature`, `receipt_code` com formato `ASEPI-AAAAMMDD-XXXXXXXX`.
- Pontos a verificar na execução (NÃO VERIFICADO até rodar): `FOR UPDATE OF d` com agregação (ajuste indicado), `STABLE` em `epi_sig_items`, `pgcrypto` acessível com `search_path` fixo, `ALTER FUNCTION … OWNER TO` e `GRANT` como `montese_app`, limite de corpo para 300 KB só nas rotas públicas, `req.ip` correto atrás do Nginx (confiança no proxy), `RateLimit` testável, geração de screenshots do frontend, `next build` com a rota nova.
