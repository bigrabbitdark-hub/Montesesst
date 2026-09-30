# eSocial SST — Sub-projeto 1 (Fundação + Certificado + Piloto S-2220) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o pipeline completo e auditável de um evento eSocial real (S-2220 — Monitoramento da Saúde do Trabalhador) rodando em Produção Restrita: certificado A1 do cliente custodiado com segurança, diagnóstico de prontidão, geração/assinatura/transmissão/consulta do XML, e uma tela mínima de status — sem UI rica, sem os demais eventos SST (ficam para sub-projetos futuros).

**Architecture:** Novo módulo `backend/src/esocial/` (certificates/events/xml/transmission/diagnostics) seguindo o padrão "um módulo por domínio" já usado no projeto, mais um módulo novo independente `backend/src/aso/` para o dado de saúde ocupacional que não existe hoje. Transmissão SOAP usa **envelope manual** (axios + `https.Agent` com o certificado do tenant), não geração dinâmica via WSDL — decisão tomada nesta fase de plano porque só há 2 operações necessárias (enviar lote, consultar lote) e isso torna o cliente SOAP totalmente testável sem depender de um WSDL real ou mockado (a spec de arquitetura já documentava esta opção como o "fallback de menor risco"; aqui vira a escolha primária pela testabilidade). Fila/estado via `@nestjs/schedule` (cron), sem fila nova.

**Tech Stack:** NestJS 10 + TypeScript, `pg` puro (migrations SQL sequenciais), `node-forge` 1.4.0 (PKCS#12), `xml-crypto` 6.3.2 (XMLDSig), `axios` (já uma dependência transitiva via outras libs — usar `https.Agent` nativo do Node para mTLS), Jest para testes.

**Spec:** `docs/specs/esocial-arquitetura.md`, `docs/specs/esocial-mapeamento-dados.md`, `docs/specs/esocial-seguranca.md` — este plano implementa os 3 juntos; os executores devem ler os 3 antes de começar.

## Global Constraints

- Toda tabela nova com `tenant_id` precisa de `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + a policy padrão de 3 ramos (ver Task 1 para o texto exato) — sem exceção, é pega automaticamente por `backend/test/tenant-isolation-sweep.e2e-spec.ts`.
- Nenhum controller/service monta contexto de tenant a partir de `dto`/`body`/`query`/`params` — sempre `req.withTenantContext(...)`. Qualquer `db.withTenantContext` fora de `req.withTenantContext` (ex. o cron da Task 18) precisa ser adicionado à lista `ALLOWED` de `backend/test/tenant-context-callsites.unit-spec.ts` com motivo escrito (Task 18 já inclui esse passo).
- Migrations: SQL puro em `backend/db/migrations/NNNN_descricao.sql`, 4 dígitos zero-padded, próxima livre nesta data é `0061` — **confirme antes de rodar** com `ls backend/db/migrations | sort -V | tail -3`, pode ter avançado.
- Senha de certificado e chave privada **nunca** em texto puro em banco, log ou resposta de API — só via `certificate-crypto.service.ts` (Task 8).
- PFX cifrado vai para R2 (`R2Service`, já existe, `backend/src/common/r2/r2.service.ts`), nunca disco nem coluna grande de banco.
- Nenhum item marcado INFERIDO na spec (estrutura exata do XSD, algoritmo de assinatura, URLs de Produção real) vira constante travada sem o passo de verificação explícito incluído nas tasks abaixo.
- Testes unitários (`*.unit-spec.ts`) rodam direto no host: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão> --forceExit`.
- Testes e2e (`*.e2e-spec.ts`) **não alcançam o Postgres a partir do shell do agente** — precisam rodar dentro de um container Docker na rede `montese_internal` (receita completa na Task 4, reaproveitada em toda task e2e deste plano). **Nunca aplique uma migration nova contra o Postgres de produção como parte de TDD** — use um banco de ensaio (`CREATE DATABASE montese_rehearsal`, restaurado do dump mais recente) apontado por `DATABASE_URL`/`TEST_SUPERUSER_DATABASE_URL` alternativos dentro do container de teste. Migração em produção real só acontece depois, com autorização explícita do dono e backup prévio (`bash ops/backup-postgres.sh`) — não é parte deste plano.
- Commit é sempre `git add <arquivos específicos>` + mensagem — nunca `git push`, nunca commit automático fora do que este plano pede explicitamente por task.

---

## Índice de fases

- **Fase A — Schema** (Tasks 1-6): migrations + env var.
- **Fase B — Criptografia** (Tasks 7-9): envelope encryption genérico, seal/unseal de certificado, parsing PKCS#12.
- **Fase C — Módulo ASO** (Task 10): CRUD de ASO, independente do eSocial.
- **Fase D — Certificados** (Tasks 11-12): upload/validação/status via API.
- **Fase E — Evento e XML** (Tasks 13-15): tradução ASO→payload, geração de XML, assinatura.
- **Fase F — Diagnóstico** (Task 16).
- **Fase G — Transmissão** (Tasks 17-19): cliente SOAP manual, cron de fila, API de status.
- **Fase H — UI mínima e integração** (Tasks 20-22).
- **Fase I — Fechamento** (Tasks 23-24): `PRODUCT.md`, validação manual em Produção Restrita.

---

## Fase A — Schema

### Task 1: Migration — `esocial_layout_versions`

**Files:**
- Create: `backend/db/migrations/0061_esocial_layout_versions.sql`
- Test: `backend/test/esocial-layout-versions.unit-spec.ts`

**Interfaces:**
- Produces: tabela `esocial_layout_versions(id, version_code, is_active, producao_restrita_envio_url, producao_restrita_consulta_url, producao_envio_url, producao_consulta_url, effective_from, notes, created_at, updated_at)` — global, sem `tenant_id` (mesma categoria de `caepi_records`: dado de referência compartilhado, não de tenant, sem RLS).

- [ ] **Step 1: Escrever a migration**

```sql
-- backend/db/migrations/0061_esocial_layout_versions.sql
-- Versão vigente do leiaute eSocial (S-1.3, VERIFICADO em docs/specs/esocial-arquitetura.md)
-- e os endpoints de transmissão por ambiente. Global (sem tenant_id): é dado de
-- referência compartilhado por toda a plataforma, não por empresa — mesma categoria
-- de caepi_records.
CREATE TABLE esocial_layout_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_code TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- URLs de Produção Restrita: VERIFICADO contra gov.br/esocial em 2026-09-29.
  producao_restrita_envio_url TEXT NOT NULL,
  producao_restrita_consulta_url TEXT NOT NULL,
  -- URLs de Produção real: NÃO VERIFICADAS contra fonte primária (ver spec) —
  -- ficam NULL até serem confirmadas contra o Pacote de Comunicação oficial.
  producao_envio_url TEXT,
  producao_consulta_url TEXT,
  effective_from DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO esocial_layout_versions (
  version_code, is_active,
  producao_restrita_envio_url, producao_restrita_consulta_url,
  effective_from, notes
) VALUES (
  'S-1.3', true,
  'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc',
  'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc',
  CURRENT_DATE,
  'Seed inicial — Sub-projeto 1. URLs de Produção Restrita verificadas em 2026-09-29 contra gov.br/esocial/pt-br/acesso-ao-sistema/ambiente-de-producao-restrita. URLs de Produção real pendentes de confirmação — ver docs/specs/esocial-arquitetura.md, seção Riscos.'
);
```

- [ ] **Step 2: Rodar a migration num banco de ensaio (nunca produção)**

Crie/restaure um banco `montese_rehearsal` (ver Global Constraints) e rode:
`DATABASE_URL=postgresql://<app>:<pw>@postgres:5432/montese_rehearsal npm run db:migrate`

- [ ] **Step 3: Escrever o teste unitário que confirma o seed**

```typescript
// backend/test/esocial-layout-versions.unit-spec.ts
import { readFileSync } from 'fs';
import { join } from 'path';

describe('esocial_layout_versions migration', () => {
  it('contém a URL de Produção Restrita verificada e nenhuma URL de Produção hardcoded como fato', () => {
    const sql = readFileSync(
      join(__dirname, '../db/migrations/0061_esocial_layout_versions.sql'),
      'utf8',
    );
    expect(sql).toContain('webservices.producaorestrita.esocial.gov.br');
    expect(sql).toContain("'S-1.3'");
    // Garante que ninguém adicionou uma URL de produção real sem atualizar este teste
    // e o comentário de verificação junto dela.
    expect(sql).not.toMatch(/producao_envio_url,\s*producao_consulta_url\s*\)\s*VALUES/i);
  });
});
```

- [ ] **Step 4: Rodar o teste**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json esocial-layout-versions --forceExit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/db/migrations/0061_esocial_layout_versions.sql backend/test/esocial-layout-versions.unit-spec.ts
git commit -m "feat(esocial): migration de esocial_layout_versions com seed S-1.3"
```

---

### Task 2: Migration — `esocial_certificates`

**Files:**
- Create: `backend/db/migrations/0062_esocial_certificates.sql`

**Interfaces:**
- Consumes: `tenants(id)`, `users(id)` (já existem)
- Produces: tabela `esocial_certificates(id, tenant_id, label, subject_cn, subject_document, thumbprint_sha256, not_before, not_after, status, pfx_r2_key, encrypted_password, encrypted_data_key, uploaded_by_user_id, created_at, updated_at)`. `status` é `'ativo' | 'expirado' | 'invalido' | 'removido'`.

- [ ] **Step 1: Escrever a migration**

```sql
-- backend/db/migrations/0062_esocial_certificates.sql
CREATE TABLE esocial_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  subject_cn TEXT NOT NULL,
  subject_document TEXT,
  thumbprint_sha256 TEXT NOT NULL,
  not_before TIMESTAMPTZ NOT NULL,
  not_after TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'expirado', 'invalido', 'removido')),
  -- Blob do .pfx cifrado (envelope encryption) vive no R2, nunca em coluna de banco
  -- nem em disco — ver certificate-crypto.service.ts e certificates.service.ts.
  pfx_r2_key TEXT NOT NULL,
  -- "<iv-hex>:<authTag-hex>:<ciphertext-hex>" (ver backend/src/common/crypto/envelope-crypto.util.ts).
  -- encrypted_password é cifrada pela data key; encrypted_data_key é a data key cifrada
  -- pela chave mestra ESOCIAL_CERT_ENCRYPTION_KEY. Nunca a senha em texto puro.
  encrypted_password TEXT NOT NULL,
  encrypted_data_key TEXT NOT NULL,
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE esocial_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE esocial_certificates FORCE ROW LEVEL SECURITY;
CREATE POLICY esocial_certificates_isolation ON esocial_certificates USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE INDEX esocial_certificates_tenant_id_idx ON esocial_certificates(tenant_id);
```

- [ ] **Step 2: Rodar num banco de ensaio**

`DATABASE_URL=postgresql://<app>:<pw>@postgres:5432/montese_rehearsal npm run db:migrate`

- [ ] **Step 3: Commit**

```bash
git add backend/db/migrations/0062_esocial_certificates.sql
git commit -m "feat(esocial): migration de esocial_certificates com RLS"
```

---

### Task 3: Migration — módulo ASO (`aso_records`, `aso_exam_details`, `tenant_pcmso_physicians`)

**Files:**
- Create: `backend/db/migrations/0063_aso_module.sql`

**Interfaces:**
- Consumes: `tenants(id)`, `employees(id)`, `users(id)`
- Produces: `aso_records(id, tenant_id, employee_id, exam_type, exam_date, result, result_disclosure_authorized, doctor_name, doctor_crm, doctor_crm_uf, pcmso_physician_id, file_key, created_by_user_id, created_at, updated_at)`, `aso_exam_details(id, tenant_id, aso_record_id, procedure_name, exam_date, result, created_at)`, `tenant_pcmso_physicians(id, tenant_id, cpf, name, crm, crm_uf, active, created_at, updated_at)`.

- [ ] **Step 1: Escrever a migration**

```sql
-- backend/db/migrations/0063_aso_module.sql
-- Módulo ASO: dado de SST puro, reaproveitável independente do eSocial (peer de
-- epi/caepi). exam_type e result seguem os valores inferidos do bloco exMedOcup/aso
-- do evento S-2220 (ver docs/specs/esocial-arquitetura.md — INFERIDO, confirmar
-- contra o XSD oficial antes da Task 13 gerar o payload do evento).

CREATE TABLE tenant_pcmso_physicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cpf VARCHAR(11) NOT NULL,
  name TEXT NOT NULL,
  crm TEXT NOT NULL,
  crm_uf CHAR(2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_pcmso_physicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_pcmso_physicians FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_pcmso_physicians_isolation ON tenant_pcmso_physicians USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE TABLE aso_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  exam_type TEXT NOT NULL CHECK (exam_type IN (
    'admissional', 'periodico', 'retorno_trabalho', 'mudanca_funcao',
    'monitoracao_pontual', 'demissional'
  )),
  exam_date DATE NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('apto', 'inapto')),
  result_disclosure_authorized BOOLEAN NOT NULL DEFAULT false,
  doctor_name TEXT NOT NULL,
  doctor_crm TEXT NOT NULL,
  doctor_crm_uf CHAR(2) NOT NULL,
  pcmso_physician_id UUID REFERENCES tenant_pcmso_physicians(id),
  file_key TEXT,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE aso_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE aso_records FORCE ROW LEVEL SECURITY;
CREATE POLICY aso_records_isolation ON aso_records USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE INDEX aso_records_tenant_id_idx ON aso_records(tenant_id);
CREATE INDEX aso_records_employee_id_idx ON aso_records(employee_id);

CREATE TABLE aso_exam_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  aso_record_id UUID NOT NULL REFERENCES aso_records(id) ON DELETE CASCADE,
  procedure_name TEXT NOT NULL,
  exam_date DATE NOT NULL,
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE aso_exam_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE aso_exam_details FORCE ROW LEVEL SECURITY;
CREATE POLICY aso_exam_details_isolation ON aso_exam_details USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE INDEX aso_exam_details_aso_record_id_idx ON aso_exam_details(aso_record_id);
```

- [ ] **Step 2: Rodar num banco de ensaio**

`DATABASE_URL=postgresql://<app>:<pw>@postgres:5432/montese_rehearsal npm run db:migrate`

- [ ] **Step 3: Commit**

```bash
git add backend/db/migrations/0063_aso_module.sql
git commit -m "feat(aso): migration do módulo aso (aso_records, aso_exam_details, tenant_pcmso_physicians)"
```

---

### Task 4: Migration — `esocial_events` + `esocial_event_history`

**Files:**
- Create: `backend/db/migrations/0064_esocial_events.sql`
- Test: `backend/test/esocial-events-rls.e2e-spec.ts`

**Interfaces:**
- Consumes: `tenants(id)`, `employees(id)`, `users(id)`, `esocial_certificates(id)`, `esocial_layout_versions(id)`, `aso_records(id)`
- Produces: `esocial_events(id, tenant_id, event_type, aso_record_id, employee_id, certificate_id, layout_version_id, ambiente, status, retificacao_de_evento_id, ind_retif, payload_json, xml_generated, xml_signed, nr_recibo, protocolo_lote, erro_codigo, erro_mensagem, idempotency_key, created_by_user_id, created_at, updated_at)`. `status` transita `rascunho → validando → assinado → aguardando_transmissao → transmitindo → transmitido → processando → (processado | rejeitado | erro_tecnico)`. `esocial_event_history(id, tenant_id, esocial_event_id, from_status, to_status, detail, actor_user_id, occurred_at)`, append-only.

- [ ] **Step 1: Escrever a migration**

```sql
-- backend/db/migrations/0064_esocial_events.sql
CREATE TABLE esocial_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('S-2220')),
  aso_record_id UUID NOT NULL REFERENCES aso_records(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id),
  certificate_id UUID NOT NULL REFERENCES esocial_certificates(id),
  layout_version_id UUID NOT NULL REFERENCES esocial_layout_versions(id),
  ambiente TEXT NOT NULL CHECK (ambiente IN ('producao_restrita', 'producao')),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN (
    'rascunho', 'validando', 'assinado', 'aguardando_transmissao',
    'transmitindo', 'transmitido', 'processando', 'processado', 'rejeitado', 'erro_tecnico'
  )),
  retificacao_de_evento_id UUID REFERENCES esocial_events(id),
  ind_retif SMALLINT NOT NULL DEFAULT 1,
  payload_json JSONB NOT NULL,
  xml_generated TEXT,
  xml_signed TEXT,
  nr_recibo TEXT,
  protocolo_lote TEXT,
  erro_codigo TEXT,
  erro_mensagem TEXT,
  idempotency_key TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

ALTER TABLE esocial_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE esocial_events FORCE ROW LEVEL SECURITY;
CREATE POLICY esocial_events_isolation ON esocial_events USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE INDEX esocial_events_tenant_id_idx ON esocial_events(tenant_id);
CREATE INDEX esocial_events_status_idx ON esocial_events(status);

CREATE TABLE esocial_event_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  esocial_event_id UUID NOT NULL REFERENCES esocial_events(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  detail TEXT,
  actor_user_id UUID REFERENCES users(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE esocial_event_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE esocial_event_history FORCE ROW LEVEL SECURITY;
CREATE POLICY esocial_event_history_isolation ON esocial_event_history USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

-- Append-only, mesmo mecanismo que já protege audit_log (0002_audit_log.sql):
-- mesmo um bug de aplicação não consegue alterar/apagar uma linha de histórico.
REVOKE UPDATE, DELETE, TRUNCATE ON esocial_event_history FROM montese_app;

CREATE INDEX esocial_event_history_event_id_idx ON esocial_event_history(esocial_event_id);
```

- [ ] **Step 2: Rodar num banco de ensaio**

`DATABASE_URL=postgresql://<app>:<pw>@postgres:5432/montese_rehearsal npm run db:migrate`

- [ ] **Step 3: Escrever o teste RLS dedicado (RECEITA de container reaproveitada em toda task e2e deste plano)**

```typescript
// backend/test/esocial-events-rls.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('esocial_events RLS', () => {
  let app: INestApplication;
  let db: TestDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('tenant A não consegue ler evento eSocial do tenant B (404, não 403)', async () => {
    const tenantA = await db.createTenantWithUser('esocial-events-a');
    const tenantB = await db.createTenantWithUser('esocial-events-b');

    const eventId = await db.insertRawRow('esocial_events', {
      tenant_id: tenantB.tenantId,
      event_type: 'S-2220',
      aso_record_id: await db.insertMinimalAsoRecord(tenantB),
      employee_id: tenantB.employeeId,
      certificate_id: await db.insertMinimalCertificate(tenantB),
      layout_version_id: await db.getActiveLayoutVersionId(),
      ambiente: 'producao_restrita',
      idempotency_key: 'test-key-cross-tenant',
      payload_json: '{}',
      created_by_user_id: tenantB.userId,
    });

    const res = await request(app.getHttpServer())
      .get(`/esocial/events/${eventId}`)
      .set('Authorization', `Bearer ${tenantA.token}`);

    expect(res.status).toBe(404);
  });
});
```

Nota: `insertRawRow`, `insertMinimalAsoRecord`, `insertMinimalCertificate`, `getActiveLayoutVersionId` são helpers a adicionar em `backend/test/db-test-helper.ts` na Task 10 (quando o módulo ASO existir) e Task 12 (quando certificados existirem) — este teste só fica executável de ponta a ponta depois da Task 12; escreva-o agora (RED esperado: rota `/esocial/events/:id` ainda não existe) e retome-o (GREEN) na Task 19.

- [ ] **Step 4: Commit**

```bash
git add backend/db/migrations/0064_esocial_events.sql backend/test/esocial-events-rls.e2e-spec.ts
git commit -m "feat(esocial): migration de esocial_events/esocial_event_history com RLS e trilha append-only"
```

---

### Task 5: Migration — colunas de pré-requisito em `company_units`, `employees`, `positions`

**Files:**
- Create: `backend/db/migrations/0065_esocial_prerequisite_columns.sql`

**Interfaces:**
- Modifica: `company_units` (+ `cnae VARCHAR(7)`, `+ esocial_establishment_code TEXT`), `employees` (+ `registration_number TEXT`, `+ esocial_category_code TEXT`, `+ esocial_vinculo_confirmed_at TIMESTAMPTZ`, `+ esocial_vinculo_confirmed_by_user_id UUID REFERENCES users(id)`), `positions` (+ `cbo_code VARCHAR(6)`). Todas nullable — nenhuma quebra dado existente.

- [ ] **Step 1: Escrever a migration**

```sql
-- backend/db/migrations/0065_esocial_prerequisite_columns.sql
-- Colunas de pré-requisito para o eSocial, todas nullable (não quebram cadastro
-- existente). Ver docs/specs/esocial-mapeamento-dados.md, seções 1-2.

ALTER TABLE company_units
  ADD COLUMN cnae VARCHAR(7),
  ADD COLUMN esocial_establishment_code TEXT;

ALTER TABLE employees
  ADD COLUMN registration_number TEXT,
  ADD COLUMN esocial_category_code TEXT,
  ADD COLUMN esocial_vinculo_confirmed_at TIMESTAMPTZ,
  ADD COLUMN esocial_vinculo_confirmed_by_user_id UUID REFERENCES users(id);

ALTER TABLE positions
  ADD COLUMN cbo_code VARCHAR(6);
```

- [ ] **Step 2: Rodar num banco de ensaio**

`DATABASE_URL=postgresql://<app>:<pw>@postgres:5432/montese_rehearsal npm run db:migrate`

- [ ] **Step 3: Commit**

```bash
git add backend/db/migrations/0065_esocial_prerequisite_columns.sql
git commit -m "feat(esocial): adiciona colunas de pré-requisito eSocial em company_units/employees/positions"
```

---

### Task 6: Variável de ambiente `ESOCIAL_CERT_ENCRYPTION_KEY`

**Files:**
- Modify: `backend/src/common/config/env.validator.ts`
- Modify: `backend/.env.example`
- Modify: `docker-compose.yml`
- Test: `backend/test/env-validator.unit-spec.ts` (se já existir, adicionar caso; senão criar)

**Interfaces:**
- Produces: `ESOCIAL_CERT_ENCRYPTION_KEY` validada como 64 caracteres hex (32 bytes), obrigatória em produção, mesmo padrão fail-fast das demais chaves.

- [ ] **Step 1: Ler o arquivo atual para confirmar o formato exato do array `REQUIRED`**

Run: `grep -n "REQUIRED" backend/src/common/config/env.validator.ts | head -5`

- [ ] **Step 2: Escrever o teste (adaptando ao formato real encontrado no Step 1)**

```typescript
// backend/test/env-validator.unit-spec.ts (adicionar dentro do describe existente,
// ou criar se o arquivo não existir ainda com este padrão)
describe('ESOCIAL_CERT_ENCRYPTION_KEY', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production' };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('rejeita quando ESOCIAL_CERT_ENCRYPTION_KEY está ausente', () => {
    delete process.env.ESOCIAL_CERT_ENCRYPTION_KEY;
    const { validateProductionEnv } = require('../src/common/config/env.validator');
    expect(() => validateProductionEnv()).toThrow(/ESOCIAL_CERT_ENCRYPTION_KEY/);
  });

  it('rejeita quando ESOCIAL_CERT_ENCRYPTION_KEY não tem 64 caracteres hex', () => {
    process.env.ESOCIAL_CERT_ENCRYPTION_KEY = 'muito-curta';
    const { validateProductionEnv } = require('../src/common/config/env.validator');
    expect(() => validateProductionEnv()).toThrow(/ESOCIAL_CERT_ENCRYPTION_KEY/);
  });
});
```

- [ ] **Step 3: Rodar o teste para confirmar que falha**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json env-validator --forceExit`
Expected: FAIL (variável ainda não está em `REQUIRED`)

- [ ] **Step 4: Adicionar a variável em `env.validator.ts`, `.env.example` e `docker-compose.yml`**

Em `env.validator.ts`, adicionar ao array `REQUIRED` (mesmo padrão de `GOOGLE_TOKEN_ENCRYPTION_KEY`, 64 hex):

```typescript
{
  name: 'ESOCIAL_CERT_ENCRYPTION_KEY',
  validate: (v: string) => /^[0-9a-f]{64}$/i.test(v),
  hint: 'esperado 64 caracteres hex = 32 bytes, gerar com `openssl rand -hex 32`',
},
```

Em `backend/.env.example`, adicionar:

```
# Chave mestra de envelope encryption para certificados digitais A1 do eSocial.
# 32 bytes em hex. Gerar com: openssl rand -hex 32
# Nunca reusar a mesma chave de GOOGLE_TOKEN_ENCRYPTION_KEY.
ESOCIAL_CERT_ENCRYPTION_KEY=
```

Em `docker-compose.yml`, no serviço `backend`, adicionar em `environment:`:

```yaml
      - ESOCIAL_CERT_ENCRYPTION_KEY=${ESOCIAL_CERT_ENCRYPTION_KEY}
```

- [ ] **Step 5: Rodar o teste de novo**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json env-validator --forceExit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/common/config/env.validator.ts backend/.env.example docker-compose.yml backend/test/env-validator.unit-spec.ts
git commit -m "feat(esocial): adiciona ESOCIAL_CERT_ENCRYPTION_KEY ao fail-fast de produção"
```

---

## Fase B — Criptografia

### Task 7: `envelope-crypto.util.ts` — AES-256-GCM genérico com chave explícita

**Files:**
- Create: `backend/src/common/crypto/envelope-crypto.util.ts`
- Test: `backend/test/envelope-crypto.unit-spec.ts`

**Interfaces:**
- Produces: `encryptWithKey(key: Buffer, plaintext: Buffer): string` (formato `"<iv-hex>:<authTag-hex>:<ciphertext-hex>"`), `decryptWithKey(key: Buffer, encoded: string): Buffer`, `encryptWithKeyToBuffer(key: Buffer, plaintext: Buffer): Buffer` (formato `iv(12) || authTag(16) || ciphertext`, para blobs binários grandes como o PFX), `decryptWithKeyFromBuffer(key: Buffer, sealed: Buffer): Buffer`, `loadMasterKey(envVarName: string): Buffer`.
- Nota: generaliza o padrão de `backend/src/common/crypto/secret-crypto.util.ts` (que já existe, mas está fixo em `GOOGLE_TOKEN_ENCRYPTION_KEY` e só aceita string) — não duplica, adiciona a variante parametrizada por chave/Buffer que o eSocial precisa (envelope encryption com data key por certificado, não uma chave fixa só).

- [ ] **Step 1: Escrever o teste falho**

```typescript
// backend/test/envelope-crypto.unit-spec.ts
import { randomBytes } from 'crypto';
import {
  encryptWithKey,
  decryptWithKey,
  encryptWithKeyToBuffer,
  decryptWithKeyFromBuffer,
  loadMasterKey,
} from '../src/common/crypto/envelope-crypto.util';

describe('envelope-crypto.util', () => {
  it('cifra e decifra um texto ida e volta com a mesma chave', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('senha-do-certificado-123', 'utf8');
    const encoded = encryptWithKey(key, plaintext);
    expect(encoded.split(':')).toHaveLength(3);
    expect(decryptWithKey(key, encoded).toString('utf8')).toBe('senha-do-certificado-123');
  });

  it('duas cifragens do mesmo valor produzem saídas diferentes (IV novo)', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('mesmo valor', 'utf8');
    expect(encryptWithKey(key, plaintext)).not.toBe(encryptWithKey(key, plaintext));
  });

  it('falha ao decifrar com a chave errada', () => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const encoded = encryptWithKey(key, Buffer.from('dado', 'utf8'));
    expect(() => decryptWithKey(wrongKey, encoded)).toThrow();
  });

  it('cifra e decifra um Buffer binário grande ida e volta (formato de blob)', () => {
    const key = randomBytes(32);
    const pfxLike = randomBytes(4096);
    const sealed = encryptWithKeyToBuffer(key, pfxLike);
    expect(sealed.length).toBe(12 + 16 + pfxLike.length);
    expect(decryptWithKeyFromBuffer(key, sealed).equals(pfxLike)).toBe(true);
  });

  it('loadMasterKey rejeita chave ausente ou com tamanho errado', () => {
    delete process.env.TEST_MASTER_KEY_VAR;
    expect(() => loadMasterKey('TEST_MASTER_KEY_VAR')).toThrow(/TEST_MASTER_KEY_VAR/);
    process.env.TEST_MASTER_KEY_VAR = 'curta';
    expect(() => loadMasterKey('TEST_MASTER_KEY_VAR')).toThrow(/TEST_MASTER_KEY_VAR/);
    process.env.TEST_MASTER_KEY_VAR = randomBytes(32).toString('hex');
    expect(loadMasterKey('TEST_MASTER_KEY_VAR')).toBeInstanceOf(Buffer);
    delete process.env.TEST_MASTER_KEY_VAR;
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json envelope-crypto --forceExit`
Expected: FAIL com "Cannot find module '../src/common/crypto/envelope-crypto.util'"

- [ ] **Step 3: Implementar**

```typescript
// backend/src/common/crypto/envelope-crypto.util.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function encryptWithKey(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptWithKey(key: Buffer, encoded: string): Buffer {
  const [ivHex, authTagHex, ciphertextHex] = encoded.split(':');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
}

// Formato binário compacto (iv || authTag || ciphertext) — usado para blobs grandes
// (o .pfx cifrado) que vão para o R2 como objeto, não como coluna de texto.
export function encryptWithKeyToBuffer(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptWithKeyFromBuffer(key: Buffer, sealed: Buffer): Buffer {
  const iv = sealed.subarray(0, IV_LENGTH);
  const authTag = sealed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = sealed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function loadMasterKey(envVarName: string): Buffer {
  const hex = process.env[envVarName];
  if (!hex || hex.length !== 64) {
    throw new Error(`${envVarName} ausente ou com tamanho errado (esperado 64 caracteres hex = 32 bytes)`);
  }
  return Buffer.from(hex, 'hex');
}
```

- [ ] **Step 4: Rodar o teste de novo**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json envelope-crypto --forceExit`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/src/common/crypto/envelope-crypto.util.ts backend/test/envelope-crypto.unit-spec.ts
git commit -m "feat(esocial): envelope-crypto.util genérico para AES-256-GCM com chave explícita"
```

---

### Task 8: `certificate-crypto.service.ts` — seal/unseal do certificado (envelope encryption)

**Files:**
- Create: `backend/src/esocial/certificates/certificate-crypto.service.ts`
- Test: `backend/test/certificate-crypto.unit-spec.ts`

**Interfaces:**
- Consumes: `encryptWithKey`, `decryptWithKey`, `encryptWithKeyToBuffer`, `decryptWithKeyFromBuffer`, `loadMasterKey` de `../../common/crypto/envelope-crypto.util` (Task 7)
- Produces: `CertificateCryptoService.seal(pfxBuffer: Buffer, password: string): SealedCertificate` onde `SealedCertificate = { encryptedPfx: Buffer; encryptedPassword: string; encryptedDataKey: string }`; `CertificateCryptoService.unseal(sealed: SealedCertificate): { pfxBuffer: Buffer; password: string }`.

- [ ] **Step 1: Escrever o teste falho**

```typescript
// backend/test/certificate-crypto.unit-spec.ts
import { randomBytes } from 'crypto';
import { CertificateCryptoService } from '../src/esocial/certificates/certificate-crypto.service';

describe('CertificateCryptoService', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ESOCIAL_CERT_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('sela e dessela um certificado ida e volta preservando pfx e senha', () => {
    const service = new CertificateCryptoService();
    const pfxBuffer = randomBytes(2048);
    const password = 'senha-super-secreta';

    const sealed = service.seal(pfxBuffer, password);
    expect(sealed.encryptedPfx.equals(pfxBuffer)).toBe(false);
    expect(sealed.encryptedPassword).not.toContain(password);

    const unsealed = service.unseal(sealed);
    expect(unsealed.pfxBuffer.equals(pfxBuffer)).toBe(true);
    expect(unsealed.password).toBe(password);
  });

  it('duas chamadas de seal para o mesmo pfx usam data keys diferentes (saídas diferentes)', () => {
    const service = new CertificateCryptoService();
    const pfxBuffer = randomBytes(512);
    const sealedA = service.seal(pfxBuffer, 'senha');
    const sealedB = service.seal(pfxBuffer, 'senha');
    expect(sealedA.encryptedDataKey).not.toBe(sealedB.encryptedDataKey);
    expect(sealedA.encryptedPfx.equals(sealedB.encryptedPfx)).toBe(false);
  });

  it('lança erro claro se ESOCIAL_CERT_ENCRYPTION_KEY não estiver definida', () => {
    delete process.env.ESOCIAL_CERT_ENCRYPTION_KEY;
    const service = new CertificateCryptoService();
    expect(() => service.seal(Buffer.from('x'), 'y')).toThrow(/ESOCIAL_CERT_ENCRYPTION_KEY/);
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json certificate-crypto --forceExit`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

```typescript
// backend/src/esocial/certificates/certificate-crypto.service.ts
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  encryptWithKey,
  decryptWithKey,
  encryptWithKeyToBuffer,
  decryptWithKeyFromBuffer,
  loadMasterKey,
} from '../../common/crypto/envelope-crypto.util';

export interface SealedCertificate {
  encryptedPfx: Buffer;
  encryptedPassword: string;
  encryptedDataKey: string;
}

const MASTER_KEY_ENV_VAR = 'ESOCIAL_CERT_ENCRYPTION_KEY';

// Envelope encryption: cada certificado ganha uma data key aleatória (nunca
// reaproveitada entre certificados), que cifra o .pfx e a senha. A data key em si
// é cifrada pela chave mestra (env var acima). Migração futura para KMS real troca
// só quem cifra a data key (esta classe) — o resto do dado não precisa ser recifrado.
// Ver docs/specs/esocial-seguranca.md, seção 1.
@Injectable()
export class CertificateCryptoService {
  seal(pfxBuffer: Buffer, password: string): SealedCertificate {
    const masterKey = loadMasterKey(MASTER_KEY_ENV_VAR);
    const dataKey = randomBytes(32);
    const encryptedPfx = encryptWithKeyToBuffer(dataKey, pfxBuffer);
    const encryptedPassword = encryptWithKey(dataKey, Buffer.from(password, 'utf8'));
    const encryptedDataKey = encryptWithKey(masterKey, dataKey);
    return { encryptedPfx, encryptedPassword, encryptedDataKey };
  }

  unseal(sealed: SealedCertificate): { pfxBuffer: Buffer; password: string } {
    const masterKey = loadMasterKey(MASTER_KEY_ENV_VAR);
    const dataKey = decryptWithKey(masterKey, sealed.encryptedDataKey);
    const pfxBuffer = decryptWithKeyFromBuffer(dataKey, sealed.encryptedPfx);
    const password = decryptWithKey(dataKey, sealed.encryptedPassword).toString('utf8');
    return { pfxBuffer, password };
  }
}
```

- [ ] **Step 4: Rodar o teste de novo**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json certificate-crypto --forceExit`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/src/esocial/certificates/certificate-crypto.service.ts backend/test/certificate-crypto.unit-spec.ts
git commit -m "feat(esocial): CertificateCryptoService com envelope encryption por certificado"
```

---

### Task 9: `pkcs12.util.ts` — parsing do certificado A1 e fixture de teste

**Files:**
- Create: `backend/src/esocial/certificates/pkcs12.util.ts`
- Create: `backend/test/fixtures/esocial/generate-test-certificate.sh`
- Test: `backend/test/pkcs12-util.unit-spec.ts`

**Interfaces:**
- Consumes: `node-forge` (adicionar a `backend/package.json`: `npm install node-forge @types/node-forge --save` dentro de `backend/`)
- Produces: `parsePkcs12(pfxBuffer: Buffer, password: string): ParsedCertificate` onde `ParsedCertificate = { certificatePem: string; privateKeyPem: string; subjectCn: string; subjectDocument: string | null; notBefore: Date; notAfter: Date; thumbprintSha256: string }`. Lança `InvalidCertificateError` (classe exportada do mesmo arquivo) se a senha estiver errada ou o arquivo não for PKCS#12 válido.

- [ ] **Step 1: Instalar a dependência**

Run: `cd backend && npm install node-forge @types/node-forge --save`

- [ ] **Step 2: Gerar o fixture de certificado de teste (self-signed, só para validar nosso código de parsing — não é um certificado ICP-Brasil real)**

```bash
#!/bin/sh
# backend/test/fixtures/esocial/generate-test-certificate.sh
# Gera um .pfx de teste self-signed. Não é uma cadeia ICP-Brasil real — serve
# só para testar unitariamente o parsing PKCS#12 do nosso código (pkcs12.util.ts).
# Senha fixa "teste1234", usada nos testes. Rodar uma vez; o arquivo gerado é
# commitado (não contém segredo real, é só um fixture de teste).
set -e
DIR="$(dirname "$0")"
TMP_KEY=$(mktemp)
TMP_CERT=$(mktemp)
openssl req -x509 -newkey rsa:2048 -keyout "$TMP_KEY" -out "$TMP_CERT" -days 3650 -nodes \
  -subj "/CN=EMPRESA TESTE LTDA:00000000000191/O=Teste Montese"
openssl pkcs12 -export -out "$DIR/test-certificate.pfx" \
  -inkey "$TMP_KEY" -in "$TMP_CERT" -password pass:teste1234
rm -f "$TMP_KEY" "$TMP_CERT"
echo "Gerado: $DIR/test-certificate.pfx (senha: teste1234)"
```

Run: `chmod +x backend/test/fixtures/esocial/generate-test-certificate.sh && backend/test/fixtures/esocial/generate-test-certificate.sh`

- [ ] **Step 3: Escrever o teste falho**

```typescript
// backend/test/pkcs12-util.unit-spec.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePkcs12, InvalidCertificateError } from '../src/esocial/certificates/pkcs12.util';

const FIXTURE_PATH = join(__dirname, 'fixtures/esocial/test-certificate.pfx');

describe('parsePkcs12', () => {
  it('extrai certificado, chave privada e metadados de um .pfx válido', () => {
    const pfxBuffer = readFileSync(FIXTURE_PATH);
    const parsed = parsePkcs12(pfxBuffer, 'teste1234');

    expect(parsed.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(parsed.privateKeyPem).toContain('BEGIN');
    expect(parsed.subjectCn).toContain('EMPRESA TESTE LTDA');
    expect(parsed.notBefore.getTime()).toBeLessThan(Date.now());
    expect(parsed.notAfter.getTime()).toBeGreaterThan(Date.now());
    expect(parsed.thumbprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lança InvalidCertificateError com senha errada', () => {
    const pfxBuffer = readFileSync(FIXTURE_PATH);
    expect(() => parsePkcs12(pfxBuffer, 'senha-errada')).toThrow(InvalidCertificateError);
  });

  it('lança InvalidCertificateError com arquivo que não é PKCS#12', () => {
    const notAPfx = Buffer.from('isto não é um certificado', 'utf8');
    expect(() => parsePkcs12(notAPfx, 'qualquer')).toThrow(InvalidCertificateError);
  });
});
```

- [ ] **Step 4: Rodar o teste para confirmar que falha**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json pkcs12-util --forceExit`
Expected: FAIL — módulo não existe

- [ ] **Step 5: Implementar**

```typescript
// backend/src/esocial/certificates/pkcs12.util.ts
import * as forge from 'node-forge';

export class InvalidCertificateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCertificateError';
  }
}

export interface ParsedCertificate {
  certificatePem: string;
  privateKeyPem: string;
  subjectCn: string;
  subjectDocument: string | null;
  notBefore: Date;
  notAfter: Date;
  thumbprintSha256: string;
}

// Extrai a "razão social:CNPJ" (ou CPF) do padrão de CN usado em certificados
// ICP-Brasil de pessoa jurídica — formato "<nome>:<CNPJ 14 dígitos>". Se não bater
// o padrão, retorna null em vez de adivinhar (nunca inventar dado do titular).
function extractDocumentFromCn(cn: string): string | null {
  const match = cn.match(/:(\d{11}|\d{14})$/);
  return match ? match[1] : null;
}

export function parsePkcs12(pfxBuffer: Buffer, password: string): ParsedCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
  } catch (err) {
    throw new InvalidCertificateError(
      'Não foi possível abrir o certificado — verifique se o arquivo é um .pfx/.p12 válido e a senha está correta',
    );
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const cert = certBags[forge.pki.oids.certBag]?.[0]?.cert;
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const privateKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;

  if (!cert || !privateKey) {
    throw new InvalidCertificateError(
      'O arquivo não contém um certificado e uma chave privada válidos',
    );
  }

  const cn = cert.subject.getField('CN')?.value ?? '';
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const thumbprint = forge.md.sha256.create().update(certDer).digest().toHex();

  return {
    certificatePem: forge.pki.certificateToPem(cert),
    privateKeyPem: forge.pki.privateKeyToPem(privateKey as forge.pki.rsa.PrivateKey),
    subjectCn: cn,
    subjectDocument: extractDocumentFromCn(cn),
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    thumbprintSha256: thumbprint,
  };
}
```

- [ ] **Step 6: Rodar o teste de novo**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json pkcs12-util --forceExit`
Expected: PASS (3 testes)

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/esocial/certificates/pkcs12.util.ts backend/test/pkcs12-util.unit-spec.ts backend/test/fixtures/esocial/
git commit -m "feat(esocial): parsePkcs12 via node-forge + fixture de certificado de teste"
```

---

## Fase C — Módulo ASO

### Task 10: Módulo `aso/` — service, controller, DTOs, testes (unit + e2e + RLS)

**Files:**
- Create: `backend/src/aso/aso.module.ts`
- Create: `backend/src/aso/aso.service.ts`
- Create: `backend/src/aso/aso.controller.ts`
- Create: `backend/src/aso/dto/create-aso-record.dto.ts`
- Create: `backend/src/aso/dto/create-pcmso-physician.dto.ts`
- Modify: `backend/src/app.module.ts` (registrar `AsoModule`)
- Modify: `backend/test/db-test-helper.ts` (adicionar `insertMinimalAsoRecord`, usado pela Task 4)
- Test: `backend/test/aso.e2e-spec.ts`, `backend/test/aso-rls.e2e-spec.ts`

**Interfaces:**
- Produces: `AsoService.createRecord(client, tenantId, dto, userId): Promise<AsoRecord>`, `AsoService.findByEmployee(client, employeeId): Promise<AsoRecord[]>`, `AsoService.createPhysician(client, dto): Promise<PcmsoPhysician>`. Rotas: `POST /aso/records`, `GET /aso/records?employeeId=`, `POST /aso/pcmso-physicians`.

- [ ] **Step 1: Escrever o DTO de criação de ASO**

```typescript
// backend/src/aso/dto/create-aso-record.dto.ts
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

const EXAM_TYPES = [
  'admissional', 'periodico', 'retorno_trabalho', 'mudanca_funcao',
  'monitoracao_pontual', 'demissional',
] as const;

export class CreateAsoRecordDto {
  @IsUUID()
  employeeId!: string;

  @IsIn(EXAM_TYPES)
  examType!: (typeof EXAM_TYPES)[number];

  @IsDateString()
  examDate!: string;

  @IsIn(['apto', 'inapto'])
  result!: 'apto' | 'inapto';

  @IsBoolean()
  resultDisclosureAuthorized!: boolean;

  @IsString()
  doctorName!: string;

  @IsString()
  doctorCrm!: string;

  @Length(2, 2)
  doctorCrmUf!: string;

  @IsOptional()
  @IsUUID()
  pcmsoPhysicianId?: string;
}
```

```typescript
// backend/src/aso/dto/create-pcmso-physician.dto.ts
import { IsString, Length } from 'class-validator';

export class CreatePcmsoPhysicianDto {
  @Length(11, 11)
  cpf!: string;

  @IsString()
  name!: string;

  @IsString()
  crm!: string;

  @Length(2, 2)
  crmUf!: string;
}
```

- [ ] **Step 2: Escrever o service**

```typescript
// backend/src/aso/aso.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';
import { CreateAsoRecordDto } from './dto/create-aso-record.dto';
import { CreatePcmsoPhysicianDto } from './dto/create-pcmso-physician.dto';

export interface AsoRecord {
  id: string;
  tenant_id: string;
  employee_id: string;
  exam_type: string;
  exam_date: string;
  result: string;
  result_disclosure_authorized: boolean;
  doctor_name: string;
  doctor_crm: string;
  doctor_crm_uf: string;
  pcmso_physician_id: string | null;
  created_by_user_id: string;
  created_at: string;
}

@Injectable()
export class AsoService {
  async createRecord(
    client: PoolClient,
    dto: CreateAsoRecordDto,
    userId: string,
  ): Promise<AsoRecord> {
    // Sem WHERE tenant_id explícito no INSERT: RLS exige que o tenant_id gravado
    // bata com app.tenant_id do contexto — usamos current_setting diretamente,
    // igual ao padrão já usado no resto do projeto, nunca um tenantId vindo do DTO.
    const result = await client.query<AsoRecord>(
      `INSERT INTO aso_records (
        tenant_id, employee_id, exam_type, exam_date, result,
        result_disclosure_authorized, doctor_name, doctor_crm, doctor_crm_uf,
        pcmso_physician_id, created_by_user_id
      ) VALUES (
        NULLIF(current_setting('app.tenant_id', true), '')::uuid,
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      ) RETURNING *`,
      [
        dto.employeeId, dto.examType, dto.examDate, dto.result,
        dto.resultDisclosureAuthorized, dto.doctorName, dto.doctorCrm, dto.doctorCrmUf,
        dto.pcmsoPhysicianId ?? null, userId,
      ],
    );
    return result.rows[0];
  }

  async findByEmployee(client: PoolClient, employeeId: string): Promise<AsoRecord[]> {
    const result = await client.query<AsoRecord>(
      'SELECT * FROM aso_records WHERE employee_id = $1 ORDER BY exam_date DESC',
      [employeeId],
    );
    return result.rows;
  }

  async findOne(client: PoolClient, id: string): Promise<AsoRecord> {
    const result = await client.query<AsoRecord>('SELECT * FROM aso_records WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new NotFoundException('Registro de ASO não encontrado');
    return result.rows[0];
  }

  async createPhysician(client: PoolClient, dto: CreatePcmsoPhysicianDto) {
    const result = await client.query(
      `INSERT INTO tenant_pcmso_physicians (tenant_id, cpf, name, crm, crm_uf)
       VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid, $1, $2, $3, $4)
       RETURNING *`,
      [dto.cpf, dto.name, dto.crm, dto.crmUf],
    );
    return result.rows[0];
  }
}
```

- [ ] **Step 3: Escrever o controller**

```typescript
// backend/src/aso/aso.controller.ts
import { Body, Controller, Get, Post, Query, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import { AsoService } from './aso.service';
import { CreateAsoRecordDto } from './dto/create-aso-record.dto';
import { CreatePcmsoPhysicianDto } from './dto/create-pcmso-physician.dto';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('aso')
export class AsoController {
  constructor(private readonly aso: AsoService) {}

  @Post('records')
  @Roles('empresa', 'tecnico', 'admin')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  createRecord(@Body() dto: CreateAsoRecordDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.aso.createRecord(client, dto, req.user.id),
    );
  }

  @Get('records')
  @Roles('empresa', 'tecnico', 'admin')
  findByEmployee(@Query('employeeId') employeeId: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.aso.findByEmployee(client, employeeId));
  }

  @Post('pcmso-physicians')
  @Roles('empresa', 'admin')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  createPhysician(@Body() dto: CreatePcmsoPhysicianDto, @Req() req: any) {
    return req.withTenantContext((client: any) => this.aso.createPhysician(client, dto));
  }
}
```

- [ ] **Step 4: Módulo e registro no `app.module.ts`**

```typescript
// backend/src/aso/aso.module.ts
import { Module } from '@nestjs/common';
import { AsoController } from './aso.controller';
import { AsoService } from './aso.service';

@Module({
  controllers: [AsoController],
  providers: [AsoService],
  exports: [AsoService],
})
export class AsoModule {}
```

Em `backend/src/app.module.ts`: adicionar `import { AsoModule } from './aso/aso.module';` e incluir `AsoModule` no array `imports` (mesmo padrão dos outros 35 módulos já listados).

- [ ] **Step 5: Adicionar helper em `db-test-helper.ts`**

Ler `backend/test/db-test-helper.ts` primeiro para confirmar a forma exata da classe `TestDb` e de `createTenantWithUser`, depois adicionar (seguindo o mesmo estilo):

```typescript
// dentro da classe TestDb em backend/test/db-test-helper.ts
async insertMinimalAsoRecord(tenant: { tenantId: string; employeeId: string; userId: string }): Promise<string> {
  const result = await this.superuserClient.query(
    `INSERT INTO aso_records (
      tenant_id, employee_id, exam_type, exam_date, result,
      result_disclosure_authorized, doctor_name, doctor_crm, doctor_crm_uf, created_by_user_id
    ) VALUES ($1, $2, 'periodico', CURRENT_DATE, 'apto', false, 'Dr. Teste', '12345', 'SP', $3)
    RETURNING id`,
    [tenant.tenantId, tenant.employeeId, tenant.userId],
  );
  return result.rows[0].id;
}
```

- [ ] **Step 6: Escrever o teste e2e funcional**

```typescript
// backend/test/aso.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('ASO module (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('cria e lista um registro de ASO', async () => {
    const tenant = await db.createTenantWithUser('aso-basic');

    const createRes = await request(app.getHttpServer())
      .post('/aso/records')
      .set('Authorization', `Bearer ${tenant.token}`)
      .send({
        employeeId: tenant.employeeId,
        examType: 'periodico',
        examDate: '2026-09-01',
        result: 'apto',
        resultDisclosureAuthorized: true,
        doctorName: 'Dra. Fulana',
        doctorCrm: '54321',
        doctorCrmUf: 'SP',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.result).toBe('apto');

    const listRes = await request(app.getHttpServer())
      .get(`/aso/records?employeeId=${tenant.employeeId}`)
      .set('Authorization', `Bearer ${tenant.token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });
});
```

- [ ] **Step 7: Escrever o teste RLS dedicado**

```typescript
// backend/test/aso-rls.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('aso_records RLS (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('empresa do tenant A não lista ASO de funcionário do tenant B', async () => {
    const tenantA = await db.createTenantWithUser('aso-rls-a');
    const tenantB = await db.createTenantWithUser('aso-rls-b');
    await db.insertMinimalAsoRecord(tenantB);

    const res = await request(app.getHttpServer())
      .get(`/aso/records?employeeId=${tenantB.employeeId}`)
      .set('Authorization', `Bearer ${tenantA.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});
```

- [ ] **Step 8: Rodar os testes e2e no container (receita, ver Global Constraints)**

```bash
docker run --rm --network montese_internal -v /opt/Montese/backend:/app-src:ro \
  -e DATABASE_URL=postgresql://<app>:<pw>@postgres:5432/montese_rehearsal \
  -e TEST_SUPERUSER_DATABASE_URL=postgresql://<superuser>:<pw>@postgres:5432/montese_rehearsal \
  -e REDIS_URL=redis://:<pw>@redis:6379 -e JWT_SECRET -e JWT_EXPIRES_IN -e NODE_ENV=test \
  -e NODE_OPTIONS=--experimental-vm-modules -e GOOGLE_CLIENT_ID=fake -e GOOGLE_CLIENT_SECRET=fake \
  -e GOOGLE_TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32) -e ESOCIAL_CERT_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  node:20-alpine sh -c "cp -r /app-src /app && cd /app && rm -rf node_modules && npm install && npx jest --config ./test/jest-e2e.json aso --runInBand --forceExit --verbose" \
  > /tmp/aso-e2e.log 2>&1
```

Confira o log depois (não use `| tail`, redirecione e leia o arquivo). Expected: PASS em `aso.e2e-spec.ts` e `aso-rls.e2e-spec.ts`. **Use o banco de ensaio (`montese_rehearsal`), nunca produção.**

- [ ] **Step 9: Commit**

```bash
git add backend/src/aso/ backend/src/app.module.ts backend/test/db-test-helper.ts backend/test/aso.e2e-spec.ts backend/test/aso-rls.e2e-spec.ts
git commit -m "feat(aso): módulo ASO completo (service, controller, DTOs, RLS)"
```

---

## Fase D — Certificados

### Task 11: `CertificatesService` — upload, validação, armazenamento no R2

**Files:**
- Create: `backend/src/esocial/esocial.module.ts`
- Create: `backend/src/esocial/certificates/certificates.module.ts`
- Create: `backend/src/esocial/certificates/certificates.service.ts`
- Create: `backend/src/esocial/certificates/dto/upload-certificate.dto.ts`
- Test: `backend/test/certificates-service.e2e-spec.ts`

**Interfaces:**
- Consumes: `parsePkcs12` (Task 9), `CertificateCryptoService.seal` (Task 8), `R2Service.putObject` (já existe, `backend/src/common/r2/r2.service.ts`)
- Produces: `CertificatesService.upload(client, tenantId, pfxBuffer, dto, userId): Promise<CertificateSummary>`, `CertificatesService.list(client): Promise<CertificateSummary[]>`, `CertificatesService.remove(client, id): Promise<void>`. `CertificateSummary` nunca inclui `encrypted_password`/`encrypted_data_key`/`pfx_r2_key` na resposta — só metadados públicos (`id, label, subjectCn, subjectDocument, notBefore, notAfter, status, thumbprintSha256`).

- [ ] **Step 1: DTO de upload**

```typescript
// backend/src/esocial/certificates/dto/upload-certificate.dto.ts
import { IsString, MinLength } from 'class-validator';

export class UploadCertificateDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
```

- [ ] **Step 2: Escrever o teste e2e falho (upload + list + remove, nunca vazando segredo)**

```typescript
// backend/test/certificates-service.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

const FIXTURE_PATH = join(__dirname, 'fixtures/esocial/test-certificate.pfx');

describe('Certificates (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('faz upload, lista sem vazar segredo, e remove', async () => {
    const tenant = await db.createTenantWithUser('cert-basic');
    const pfxBuffer = readFileSync(FIXTURE_PATH);

    const uploadRes = await request(app.getHttpServer())
      .post('/esocial/certificates')
      .set('Authorization', `Bearer ${tenant.token}`)
      .field('label', 'Certificado principal')
      .field('password', 'teste1234')
      .attach('file', pfxBuffer, 'test-certificate.pfx');

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.subjectCn).toContain('EMPRESA TESTE LTDA');
    expect(uploadRes.body.status).toBe('ativo');
    expect(JSON.stringify(uploadRes.body)).not.toContain('teste1234');
    expect(uploadRes.body.encryptedPassword).toBeUndefined();
    expect(uploadRes.body.pfxR2Key).toBeUndefined();

    const listRes = await request(app.getHttpServer())
      .get('/esocial/certificates')
      .set('Authorization', `Bearer ${tenant.token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);

    const removeRes = await request(app.getHttpServer())
      .delete(`/esocial/certificates/${uploadRes.body.id}`)
      .set('Authorization', `Bearer ${tenant.token}`);
    expect(removeRes.status).toBe(200);
  });

  it('rejeita upload com senha errada sem persistir nada', async () => {
    const tenant = await db.createTenantWithUser('cert-wrong-pw');
    const pfxBuffer = readFileSync(FIXTURE_PATH);

    const res = await request(app.getHttpServer())
      .post('/esocial/certificates')
      .set('Authorization', `Bearer ${tenant.token}`)
      .field('label', 'Certificado')
      .field('password', 'senha-errada')
      .attach('file', pfxBuffer, 'test-certificate.pfx');

    expect(res.status).toBe(400);

    const listRes = await request(app.getHttpServer())
      .get('/esocial/certificates')
      .set('Authorization', `Bearer ${tenant.token}`);
    expect(listRes.body).toHaveLength(0);
  });
});
```

Nota: este teste assume upload via `multipart/form-data` com `FileInterceptor('file')` — implementado no controller na Task 12; até lá, este teste falha com 404. Rode-o de novo só depois da Task 12 (ele já está correto para as duas tasks juntas).

- [ ] **Step 3: Implementar `CertificatesService`**

```typescript
// backend/src/esocial/certificates/certificates.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { R2Service } from '../../common/r2/r2.service';
import { parsePkcs12, InvalidCertificateError } from './pkcs12.util';
import { CertificateCryptoService } from './certificate-crypto.service';
import { UploadCertificateDto } from './dto/upload-certificate.dto';

export interface CertificateSummary {
  id: string;
  label: string;
  subjectCn: string;
  subjectDocument: string | null;
  notBefore: string;
  notAfter: string;
  status: string;
  thumbprintSha256: string;
}

function toSummary(row: any): CertificateSummary {
  return {
    id: row.id,
    label: row.label,
    subjectCn: row.subject_cn,
    subjectDocument: row.subject_document,
    notBefore: row.not_before,
    notAfter: row.not_after,
    status: row.status,
    thumbprintSha256: row.thumbprint_sha256,
  };
}

@Injectable()
export class CertificatesService {
  constructor(
    private readonly r2: R2Service,
    // Nomeado certCrypto (não crypto) para não sombrear o módulo nativo `crypto`
    // do Node, usado abaixo em crypto.randomUUID().
    private readonly certCrypto: CertificateCryptoService,
  ) {}

  async upload(
    client: PoolClient,
    pfxBuffer: Buffer,
    dto: UploadCertificateDto,
    userId: string,
  ): Promise<CertificateSummary> {
    let parsed;
    try {
      parsed = parsePkcs12(pfxBuffer, dto.password);
    } catch (err) {
      if (err instanceof InvalidCertificateError) throw new BadRequestException(err.message);
      throw err;
    }

    if (parsed.notAfter.getTime() < Date.now()) {
      throw new BadRequestException('Certificado expirado — envie um certificado válido');
    }

    const sealed = this.certCrypto.seal(pfxBuffer, dto.password);
    const r2Key = `esocial-certificates/${randomUUID()}.pfx.enc`;
    await this.r2.putObject(r2Key, sealed.encryptedPfx, 'application/octet-stream');

    const result = await client.query(
      `INSERT INTO esocial_certificates (
        tenant_id, label, subject_cn, subject_document, thumbprint_sha256,
        not_before, not_after, status, pfx_r2_key, encrypted_password, encrypted_data_key,
        uploaded_by_user_id
      ) VALUES (
        NULLIF(current_setting('app.tenant_id', true), '')::uuid,
        $1, $2, $3, $4, $5, $6, 'ativo', $7, $8, $9, $10
      ) RETURNING *`,
      [
        dto.label, parsed.subjectCn, parsed.subjectDocument, parsed.thumbprintSha256,
        parsed.notBefore, parsed.notAfter, r2Key, sealed.encryptedPassword,
        sealed.encryptedDataKey, userId,
      ],
    );
    return toSummary(result.rows[0]);
  }

  async list(client: PoolClient): Promise<CertificateSummary[]> {
    const result = await client.query(
      `SELECT * FROM esocial_certificates WHERE status <> 'removido' ORDER BY created_at DESC`,
    );
    return result.rows.map(toSummary);
  }

  async remove(client: PoolClient, id: string): Promise<void> {
    const result = await client.query(
      `UPDATE esocial_certificates SET status = 'removido' WHERE id = $1 RETURNING id`,
      [id],
    );
    if (result.rowCount === 0) throw new NotFoundException('Certificado não encontrado');
  }

  // Uso interno (Task 15, assinatura de XML) — nunca exposto via controller/resposta HTTP.
  async loadForSigning(client: PoolClient, id: string): Promise<{ certificatePem: string; privateKeyPem: string }> {
    const { pfxBuffer, password } = await this.loadRawPfxForTransmission(client, id);
    const parsed = parsePkcs12(pfxBuffer, password);
    return { certificatePem: parsed.certificatePem, privateKeyPem: parsed.privateKeyPem };
  }

  // Uso interno (Task 18, transmissão mTLS: o https.Agent precisa do .pfx bruto + senha,
  // não do PEM extraído) — nunca exposto via controller/resposta HTTP.
  async loadRawPfxForTransmission(client: PoolClient, id: string): Promise<{ pfxBuffer: Buffer; password: string }> {
    const result = await client.query(
      'SELECT pfx_r2_key, encrypted_password, encrypted_data_key FROM esocial_certificates WHERE id = $1 AND status = $2',
      [id, 'ativo'],
    );
    if (result.rows.length === 0) throw new NotFoundException('Certificado ativo não encontrado');
    const row = result.rows[0];
    const encryptedPfx = await this.r2.getObject(row.pfx_r2_key);
    return this.certCrypto.unseal({
      encryptedPfx: Buffer.isBuffer(encryptedPfx) ? encryptedPfx : Buffer.from(encryptedPfx as any),
      encryptedPassword: row.encrypted_password,
      encryptedDataKey: row.encrypted_data_key,
    });
  }
}
```

- [ ] **Step 4: Módulo `certificates.module.ts` e `esocial.module.ts`**

```typescript
// backend/src/esocial/certificates/certificates.module.ts
import { Module } from '@nestjs/common';
import { R2Module } from '../../common/r2/r2.module';
import { CertificatesService } from './certificates.service';
import { CertificateCryptoService } from './certificate-crypto.service';

@Module({
  imports: [R2Module],
  providers: [CertificatesService, CertificateCryptoService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
```

```typescript
// backend/src/esocial/esocial.module.ts
import { Module } from '@nestjs/common';
import { CertificatesModule } from './certificates/certificates.module';

@Module({
  imports: [CertificatesModule],
  exports: [CertificatesModule],
})
export class EsocialModule {}
```

Registrar `EsocialModule` em `backend/src/app.module.ts`, mesmo padrão dos demais.

- [ ] **Step 5: Commit (controller vem na Task 12 — este commit deixa o service pronto mas sem rota ainda)**

```bash
git add backend/src/esocial/esocial.module.ts backend/src/esocial/certificates/certificates.module.ts backend/src/esocial/certificates/certificates.service.ts backend/src/esocial/certificates/dto/upload-certificate.dto.ts backend/test/certificates-service.e2e-spec.ts backend/src/app.module.ts
git commit -m "feat(esocial): CertificatesService (upload/list/remove/loadForSigning)"
```

---

### Task 12: `CertificatesController` + teste RLS dedicado

**Files:**
- Create: `backend/src/esocial/certificates/certificates.controller.ts`
- Modify: `backend/src/esocial/certificates/certificates.module.ts` (registrar o controller)
- Modify: `backend/test/db-test-helper.ts` (adicionar `insertMinimalCertificate`, usado pela Task 4)
- Test: `backend/test/esocial-certificates-rls.e2e-spec.ts`

**Interfaces:**
- Produces: `POST /esocial/certificates` (multipart, campo `file` + `label` + `password`), `GET /esocial/certificates`, `DELETE /esocial/certificates/:id`.

- [ ] **Step 1: Implementar o controller**

```typescript
// backend/src/esocial/certificates/certificates.controller.ts
import {
  Body, Controller, Delete, Get, Param, Post, Req, UploadedFile, UseInterceptors, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CertificatesService } from './certificates.service';
import { UploadCertificateDto } from './dto/upload-certificate.dto';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('esocial/certificates')
export class CertificatesController {
  constructor(private readonly certificates: CertificatesService) {}

  @Post()
  @Roles('empresa', 'admin')
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  upload(@UploadedFile() file: Express.Multer.File, @Body() dto: UploadCertificateDto, @Req() req: any) {
    return req.withTenantContext((client: any) =>
      this.certificates.upload(client, file.buffer, dto, req.user.id),
    );
  }

  @Get()
  @Roles('empresa', 'tecnico', 'admin')
  list(@Req() req: any) {
    return req.withTenantContext((client: any) => this.certificates.list(client));
  }

  @Delete(':id')
  @Roles('empresa', 'admin')
  remove(@Param('id') id: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.certificates.remove(client, id));
  }
}
```

- [ ] **Step 2: Registrar o controller no módulo**

```typescript
// backend/src/esocial/certificates/certificates.module.ts (atualizar)
import { Module } from '@nestjs/common';
import { R2Module } from '../../common/r2/r2.module';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { CertificateCryptoService } from './certificate-crypto.service';

@Module({
  imports: [R2Module],
  controllers: [CertificatesController],
  providers: [CertificatesService, CertificateCryptoService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
```

- [ ] **Step 3: Rodar o teste da Task 11 agora que a rota existe**

Use a receita de container da Task 10, Step 8, trocando o padrão de spec para `certificates-service`. Expected: PASS.

- [ ] **Step 4: Adicionar `insertMinimalCertificate` em `db-test-helper.ts`**

```typescript
// dentro da classe TestDb em backend/test/db-test-helper.ts
async insertMinimalCertificate(tenant: { tenantId: string; userId: string }): Promise<string> {
  const result = await this.superuserClient.query(
    `INSERT INTO esocial_certificates (
      tenant_id, label, subject_cn, thumbprint_sha256, not_before, not_after,
      status, pfx_r2_key, encrypted_password, encrypted_data_key, uploaded_by_user_id
    ) VALUES ($1, 'Teste', 'TESTE LTDA', 'aaaa', now() - interval '1 day', now() + interval '1 year',
      'ativo', 'fake-key', 'fake:fake:fake', 'fake:fake:fake', $2)
    RETURNING id`,
    [tenant.tenantId, tenant.userId],
  );
  return result.rows[0].id;
}
```

- [ ] **Step 5: Escrever o teste RLS dedicado**

```typescript
// backend/test/esocial-certificates-rls.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('esocial_certificates RLS (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('tenant A não vê certificado do tenant B na listagem', async () => {
    const tenantA = await db.createTenantWithUser('cert-rls-a');
    const tenantB = await db.createTenantWithUser('cert-rls-b');
    await db.insertMinimalCertificate(tenantB);

    const res = await request(app.getHttpServer())
      .get('/esocial/certificates')
      .set('Authorization', `Bearer ${tenantA.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('tenant A não consegue remover certificado do tenant B (404, não 403)', async () => {
    const tenantA = await db.createTenantWithUser('cert-rls-remove-a');
    const tenantB = await db.createTenantWithUser('cert-rls-remove-b');
    const certId = await db.insertMinimalCertificate(tenantB);

    const res = await request(app.getHttpServer())
      .delete(`/esocial/certificates/${certId}`)
      .set('Authorization', `Bearer ${tenantA.token}`);

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: Rodar os testes no container (receita da Task 10, Step 8)**

Padrão de spec: `esocial-certificates-rls`. Expected: PASS (2 testes).

- [ ] **Step 7: Commit**

```bash
git add backend/src/esocial/certificates/certificates.controller.ts backend/src/esocial/certificates/certificates.module.ts backend/test/db-test-helper.ts backend/test/esocial-certificates-rls.e2e-spec.ts
git commit -m "feat(esocial): CertificatesController com upload multipart e RLS dedicado"
```

---

## Fase E — Evento e XML

### Task 13: Verificação do XSD oficial + `s2220-event-builder.ts`

**Files:**
- Create: `backend/src/esocial/events/s2220-event.types.ts`
- Create: `backend/src/esocial/events/s2220-event-builder.ts`
- Create: `backend/src/esocial/esocial-provider.interface.ts`
- Test: `backend/test/s2220-event-builder.unit-spec.ts`

**Interfaces:**
- Consumes: `AsoRecord` (Task 10), dados de `employees`/`tenants`/`tenant_pcmso_physicians`
- Produces: `buildS2220Payload(input: S2220BuilderInput): S2220EventPayload` — estrutura tipada do `evtMonit`. `EsocialProvider` interface (adapter): `generateEvent`, `validateEvent`, `signEvent`, `sendEvent`, `consultEvent`, `deleteEvent`, `getStatus`.

- [ ] **Step 0 (OBRIGATÓRIO, não pular): confirmar a estrutura do `evtMonit` contra o XSD oficial**

A estrutura usada abaixo é **INFERIDA** (`docs/specs/esocial-arquitetura.md`, seção "Estrutura do evento S-2220") — convergência de fontes secundárias, não confirmada contra o texto primário do MOS. Antes de codificar o `Step 3`:

1. Baixe o pacote de esquemas XSD mais recente de `https://www.gov.br/esocial/pt-br/documentacao-tecnica` (link "Leiaute do eSocial", pacote `esquemas_xsd_v_s_01_03_00`).
2. Localize `evtMonit-v01_03_00.xsd` (ou nome equivalente na versão baixada) e abra a definição do elemento `evtMonit`.
3. Compare campo a campo com a tabela da seção "Estrutura do evento S-2220" de `docs/specs/esocial-arquitetura.md`.
4. Se houver divergência: atualize `docs/specs/esocial-mapeamento-dados.md` e este task ANTES de prosseguir — registre a mudança com rótulo VERIFICADO (agora tem fonte primária) e a data.
5. Se o XSD não puder ser baixado no ambiente de execução (sandbox sem internet): registre explicitamente "NÃO VERIFICADO — XSD não pôde ser confirmado neste ambiente" no commit da Task 13 e sinalize ao dono do produto antes de considerar este evento pronto para Produção real (Produção Restrita ainda é aceitável para prova de conceito, mas o critério de aceite da spec exige essa confirmação antes de Produção real).

- [ ] **Step 1: Tipos do payload (baseados na estrutura INFERIDA, após o Step 0)**

```typescript
// backend/src/esocial/events/s2220-event.types.ts
export interface S2220IdeEvento {
  indRetif: 1 | 2;
  nrRecibo: string | null;
  ambiente: 'producao_restrita' | 'producao';
}

export interface S2220IdeEmpregador {
  tpInsc: '1' | '2'; // 1=CNPJ, 2=CPF/CNO — INFERIDO, confirmar contra XSD (Step 0)
  nrInsc: string;
}

export interface S2220IdeVinculo {
  cpfTrab: string;
  matricula: string;
  categoria: string; // esocial_category_code — INFERIDO, ver Step 0
}

export interface S2220Medico {
  nmMed: string;
  crm: string;
  ufCrm: string;
}

export interface S2220Exame {
  procedimento: string;
  dtExame: string; // YYYY-MM-DD
  resultado: string | null;
}

export interface S2220Aso {
  dtAso: string;
  resAso: 'apto' | 'inapto';
  indResult: boolean;
  exames: S2220Exame[];
  medico: S2220Medico;
}

export interface S2220RespMonit {
  cpfResp: string;
  nmResp: string;
  crm: string;
  ufCrm: string;
}

export interface S2220ExMedOcup {
  tpExameOcup:
    | 'admissional' | 'periodico' | 'retorno_trabalho'
    | 'mudanca_funcao' | 'monitoracao_pontual' | 'demissional';
  aso: S2220Aso;
  respMonit: S2220RespMonit | null;
}

export interface S2220EventPayload {
  ideEvento: S2220IdeEvento;
  ideEmpregador: S2220IdeEmpregador;
  ideVinculo: S2220IdeVinculo;
  exMedOcup: S2220ExMedOcup;
}
```

- [ ] **Step 2: Interface do adapter `EsocialProvider`**

```typescript
// backend/src/esocial/esocial-provider.interface.ts
export interface EsocialTransmissionResult {
  status: 'processado' | 'rejeitado' | 'erro_tecnico';
  nrRecibo?: string;
  protocoloLote?: string;
  erroCodigo?: string;
  erroMensagem?: string;
}

// Adapter único que o resto do sistema conhece — implementação concreta
// (envelope SOAP manual, Tasks 17-18) fica isolada atrás desta interface,
// trocável sem afetar diagnóstico/UI/futuro assistente.
export interface EsocialProvider {
  generateEvent(payload: unknown): string; // -> XML não assinado
  signEvent(xml: string, certificateId: string): Promise<string>; // -> XML assinado
  sendEvent(signedXml: string): Promise<{ protocoloLote: string }>;
  consultEvent(protocoloLote: string): Promise<EsocialTransmissionResult>;
  deleteEvent(nrReciboOriginal: string): Promise<EsocialTransmissionResult>; // S-3000, fora de escopo desta fase
  getStatus(protocoloLote: string): Promise<EsocialTransmissionResult['status']>;
}
```

- [ ] **Step 3: Escrever o teste falho do builder**

```typescript
// backend/test/s2220-event-builder.unit-spec.ts
import { buildS2220Payload } from '../src/esocial/events/s2220-event-builder';

describe('buildS2220Payload', () => {
  const baseInput = {
    ambiente: 'producao_restrita' as const,
    tenantCnpj: '00000000000191',
    employeeCpf: '11122233344',
    employeeRegistrationNumber: 'MAT-001',
    employeeEsocialCategoryCode: '101',
    asoRecord: {
      exam_type: 'periodico',
      exam_date: '2026-09-01',
      result: 'apto',
      result_disclosure_authorized: true,
      doctor_name: 'Dra. Fulana',
      doctor_crm: '54321',
      doctor_crm_uf: 'SP',
    },
    examDetails: [{ procedure_name: 'Audiometria', exam_date: '2026-09-01', result: 'normal' }],
    pcmsoPhysician: { cpf: '99988877766', name: 'Dr. Coordenador', crm: '11111', crm_uf: 'SP' },
  };

  it('monta o payload de inclusão (indRetif=1) sem número de recibo', () => {
    const payload = buildS2220Payload(baseInput);
    expect(payload.ideEvento.indRetif).toBe(1);
    expect(payload.ideEvento.nrRecibo).toBeNull();
    expect(payload.ideEmpregador.nrInsc).toBe('00000000000191');
    expect(payload.ideVinculo.cpfTrab).toBe('11122233344');
    expect(payload.exMedOcup.tpExameOcup).toBe('periodico');
    expect(payload.exMedOcup.aso.resAso).toBe('apto');
    expect(payload.exMedOcup.aso.exames).toHaveLength(1);
    expect(payload.exMedOcup.respMonit?.nmResp).toBe('Dr. Coordenador');
  });

  it('monta o payload de retificação (indRetif=2) com nrRecibo do evento anterior', () => {
    const payload = buildS2220Payload({ ...baseInput, retificacaoDeNrRecibo: 'RECIBO-123' });
    expect(payload.ideEvento.indRetif).toBe(2);
    expect(payload.ideEvento.nrRecibo).toBe('RECIBO-123');
  });

  it('omite respMonit quando não há médico coordenador do PCMSO cadastrado', () => {
    const payload = buildS2220Payload({ ...baseInput, pcmsoPhysician: null });
    expect(payload.exMedOcup.respMonit).toBeNull();
  });
});
```

- [ ] **Step 4: Rodar o teste para confirmar que falha**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json s2220-event-builder --forceExit`
Expected: FAIL — módulo não existe

- [ ] **Step 5: Implementar**

```typescript
// backend/src/esocial/events/s2220-event-builder.ts
import { S2220EventPayload } from './s2220-event.types';

export interface S2220BuilderInput {
  ambiente: 'producao_restrita' | 'producao';
  tenantCnpj: string;
  employeeCpf: string;
  employeeRegistrationNumber: string;
  employeeEsocialCategoryCode: string;
  asoRecord: {
    exam_type: string;
    exam_date: string;
    result: string;
    result_disclosure_authorized: boolean;
    doctor_name: string;
    doctor_crm: string;
    doctor_crm_uf: string;
  };
  examDetails: Array<{ procedure_name: string; exam_date: string; result: string | null }>;
  pcmsoPhysician: { cpf: string; name: string; crm: string; crm_uf: string } | null;
  retificacaoDeNrRecibo?: string;
}

export function buildS2220Payload(input: S2220BuilderInput): S2220EventPayload {
  return {
    ideEvento: {
      indRetif: input.retificacaoDeNrRecibo ? 2 : 1,
      nrRecibo: input.retificacaoDeNrRecibo ?? null,
      ambiente: input.ambiente,
    },
    ideEmpregador: {
      tpInsc: '1',
      nrInsc: input.tenantCnpj,
    },
    ideVinculo: {
      cpfTrab: input.employeeCpf,
      matricula: input.employeeRegistrationNumber,
      categoria: input.employeeEsocialCategoryCode,
    },
    exMedOcup: {
      tpExameOcup: input.asoRecord.exam_type as S2220EventPayload['exMedOcup']['tpExameOcup'],
      aso: {
        dtAso: input.asoRecord.exam_date,
        resAso: input.asoRecord.result as 'apto' | 'inapto',
        indResult: input.asoRecord.result_disclosure_authorized,
        exames: input.examDetails.map((e) => ({
          procedimento: e.procedure_name,
          dtExame: e.exam_date,
          resultado: e.result,
        })),
        medico: {
          nmMed: input.asoRecord.doctor_name,
          crm: input.asoRecord.doctor_crm,
          ufCrm: input.asoRecord.doctor_crm_uf,
        },
      },
      respMonit: input.pcmsoPhysician
        ? {
            cpfResp: input.pcmsoPhysician.cpf,
            nmResp: input.pcmsoPhysician.name,
            crm: input.pcmsoPhysician.crm,
            ufCrm: input.pcmsoPhysician.crm_uf,
          }
        : null,
    },
  };
}
```

- [ ] **Step 6: Rodar o teste de novo**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json s2220-event-builder --forceExit`
Expected: PASS (3 testes)

- [ ] **Step 7: Commit**

```bash
git add backend/src/esocial/events/ backend/src/esocial/esocial-provider.interface.ts backend/test/s2220-event-builder.unit-spec.ts
git commit -m "feat(esocial): tipos e builder do payload S-2220 + interface EsocialProvider"
```

---

### Task 14: `xml-generator.service.ts` — payload → XML

**Files:**
- Create: `backend/src/esocial/xml/xml-generator.service.ts`
- Test: `backend/test/xml-generator.unit-spec.ts`

**Interfaces:**
- Consumes: `S2220EventPayload` (Task 13)
- Produces: `XmlGeneratorService.generate(payload: S2220EventPayload, eventId: string): string` — string XML com elemento raiz `<eSocial>` contendo `<evtMonit Id="{eventId}">...</evtMonit>` (o atributo `Id` é o que a assinatura enveloped referencia — Task 15).

- [ ] **Step 1: Escrever o teste falho**

```typescript
// backend/test/xml-generator.unit-spec.ts
import { XmlGeneratorService } from '../src/esocial/xml/xml-generator.service';
import { S2220EventPayload } from '../src/esocial/events/s2220-event.types';

const payload: S2220EventPayload = {
  ideEvento: { indRetif: 1, nrRecibo: null, ambiente: 'producao_restrita' },
  ideEmpregador: { tpInsc: '1', nrInsc: '00000000000191' },
  ideVinculo: { cpfTrab: '11122233344', matricula: 'MAT-001', categoria: '101' },
  exMedOcup: {
    tpExameOcup: 'periodico',
    aso: {
      dtAso: '2026-09-01',
      resAso: 'apto',
      indResult: true,
      exames: [{ procedimento: 'Audiometria', dtExame: '2026-09-01', resultado: 'normal' }],
      medico: { nmMed: 'Dra. Fulana', crm: '54321', ufCrm: 'SP' },
    },
    respMonit: null,
  },
};

describe('XmlGeneratorService', () => {
  const service = new XmlGeneratorService();

  it('gera XML bem formado com o Id no elemento evtMonit', () => {
    const xml = service.generate(payload, 'ID12345');
    expect(xml).toContain('<evtMonit Id="ID12345">');
    expect(xml).toContain('<cpfTrab>11122233344</cpfTrab>');
    expect(xml).toContain('<resAso>apto</resAso>');
    expect(xml).toContain('<procedimento>Audiometria</procedimento>');
  });

  it('omite respMonit quando null', () => {
    const xml = service.generate(payload, 'ID12345');
    expect(xml).not.toContain('<respMonit>');
  });

  it('escapa caracteres especiais em campos de texto livre', () => {
    const withSpecialChars: S2220EventPayload = {
      ...payload,
      exMedOcup: {
        ...payload.exMedOcup,
        aso: { ...payload.exMedOcup.aso, medico: { ...payload.exMedOcup.aso.medico, nmMed: 'Dr. A & B <Teste>' } },
      },
    };
    const xml = service.generate(withSpecialChars, 'ID12345');
    expect(xml).toContain('Dr. A &amp; B &lt;Teste&gt;');
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json xml-generator --forceExit`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar**

```typescript
// backend/src/esocial/xml/xml-generator.service.ts
import { Injectable } from '@nestjs/common';
import { S2220EventPayload } from '../events/s2220-event.types';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tag(name: string, value: string | number | boolean): string {
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

@Injectable()
export class XmlGeneratorService {
  generate(payload: S2220EventPayload, eventId: string): string {
    const { ideEvento, ideEmpregador, ideVinculo, exMedOcup } = payload;

    const exames = exMedOcup.aso.exames
      .map(
        (e) =>
          `<exame>${tag('procedimento', e.procedimento)}${tag('dtExame', e.dtExame)}${
            e.resultado ? tag('resultado', e.resultado) : ''
          }</exame>`,
      )
      .join('');

    const respMonit = exMedOcup.respMonit
      ? `<respMonit>${tag('cpfResp', exMedOcup.respMonit.cpfResp)}${tag('nmResp', exMedOcup.respMonit.nmResp)}${tag(
          'crm',
          exMedOcup.respMonit.crm,
        )}${tag('ufCrm', exMedOcup.respMonit.ufCrm)}</respMonit>`
      : '';

    return (
      '<?xml version="1.0" encoding="UTF-8"?>' +
      `<eSocial xmlns="http://www.esocial.gov.br/schema/evt/evtMonit/v_S_01_03_00">` +
      `<evtMonit Id="${eventId}">` +
      `<ideEvento>${tag('indRetif', ideEvento.indRetif)}${
        ideEvento.nrRecibo ? tag('nrRecibo', ideEvento.nrRecibo) : ''
      }${tag('tpAmb', ideEvento.ambiente === 'producao_restrita' ? '2' : '1')}</ideEvento>` +
      `<ideEmpregador>${tag('tpInsc', ideEmpregador.tpInsc)}${tag('nrInsc', ideEmpregador.nrInsc)}</ideEmpregador>` +
      `<ideVinculo>${tag('cpfTrab', ideVinculo.cpfTrab)}${tag('matricula', ideVinculo.matricula)}${tag(
        'categoria',
        ideVinculo.categoria,
      )}</ideVinculo>` +
      `<exMedOcup>${tag('tpExameOcup', exMedOcup.tpExameOcup)}` +
      `<aso>${tag('dtAso', exMedOcup.aso.dtAso)}${tag('resAso', exMedOcup.aso.resAso)}${tag(
        'indResult',
        exMedOcup.aso.indResult,
      )}${exames}<medico>${tag('nmMed', exMedOcup.aso.medico.nmMed)}${tag('crm', exMedOcup.aso.medico.crm)}${tag(
        'ufCrm',
        exMedOcup.aso.medico.ufCrm,
      )}</medico></aso>` +
      respMonit +
      `</exMedOcup>` +
      `</evtMonit>` +
      `</eSocial>`
    );
  }
}
```

Nota: o namespace `xmlns` e o campo `tpAmb` (2=Produção Restrita, 1=Produção) usados acima são **INFERIDOS** por convenção observada em outros eventos do eSocial (mesmo padrão de namespace por tipo de evento) — confirmar junto com o Step 0 da Task 13 contra o XSD real antes de usar este gerador contra o webservice de verdade.

- [ ] **Step 4: Rodar o teste de novo**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json xml-generator --forceExit`
Expected: PASS (3 testes)

- [ ] **Step 5: Commit**

```bash
git add backend/src/esocial/xml/xml-generator.service.ts backend/test/xml-generator.unit-spec.ts
git commit -m "feat(esocial): XmlGeneratorService — payload S-2220 para XML"
```

---

### Task 15: `xml-signer.service.ts` — assinatura XMLDSig

**Files:**
- Create: `backend/src/esocial/xml/xml-signer.service.ts`
- Test: `backend/test/xml-signer.unit-spec.ts`

**Interfaces:**
- Consumes: `xml-crypto` (adicionar a `backend/package.json`: `npm install xml-crypto @xmldom/xmldom --save` dentro de `backend/`), `certificatePem`/`privateKeyPem` de `CertificatesService.loadForSigning` (Task 11)
- Produces: `XmlSignerService.sign(xml: string, eventId: string, certificatePem: string, privateKeyPem: string): string` — XML com `<Signature>` embutida (enveloped).

- [ ] **Step 1: Instalar a dependência**

Run: `cd backend && npm install xml-crypto @xmldom/xmldom --save`

- [ ] **Step 2: Escrever o teste falho (assina e depois verifica a assinatura)**

```typescript
// backend/test/xml-signer.unit-spec.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { SignedXml } from 'xml-crypto';
import { XmlSignerService } from '../src/esocial/xml/xml-signer.service';
import { parsePkcs12 } from '../src/esocial/certificates/pkcs12.util';

describe('XmlSignerService', () => {
  const service = new XmlSignerService();
  const pfxBuffer = readFileSync(join(__dirname, 'fixtures/esocial/test-certificate.pfx'));
  const { certificatePem, privateKeyPem } = parsePkcs12(pfxBuffer, 'teste1234');

  const unsignedXml =
    '<?xml version="1.0" encoding="UTF-8"?><eSocial><evtMonit Id="ID999"><ideEvento><indRetif>1</indRetif></ideEvento></evtMonit></eSocial>';

  it('assina o XML e a assinatura resultante é válida contra o certificado', () => {
    const signedXml = service.sign(unsignedXml, 'ID999', certificatePem, privateKeyPem);
    expect(signedXml).toContain('<Signature');
    expect(signedXml).toContain('ID999');

    const verifier = new SignedXml({ publicCert: certificatePem });
    verifier.loadSignature(signedXml.match(/<Signature[\s\S]*?<\/Signature>/)![0]);
    const isValid = verifier.checkSignature(signedXml);
    expect(isValid).toBe(true);
  });

  it('a assinatura fica embutida dentro do elemento evtMonit (enveloped, não em arquivo separado)', () => {
    const signedXml = service.sign(unsignedXml, 'ID999', certificatePem, privateKeyPem);
    const evtMonitEnd = signedXml.indexOf('</evtMonit>');
    const signatureStart = signedXml.indexOf('<Signature');
    expect(signatureStart).toBeLessThan(evtMonitEnd);
  });
});
```

- [ ] **Step 3: Rodar o teste para confirmar que falha**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json xml-signer --forceExit`
Expected: FAIL — módulo não existe

- [ ] **Step 4: Implementar**

```typescript
// backend/src/esocial/xml/xml-signer.service.ts
import { Injectable } from '@nestjs/common';
import { SignedXml } from 'xml-crypto';

// XMLDSig enveloped + C14N + RSA-SHA256 — estrutura confirmada por convergência de
// múltiplas fontes técnicas (docs/specs/esocial-arquitetura.md, seção "Ambientes e
// transmissão"). Algoritmo exato (RSA-SHA256 vs. histórico SHA-1) marcado INFERIDO —
// reconfirmar contra o MOS vigente antes de assinar contra o webservice real.
@Injectable()
export class XmlSignerService {
  sign(xml: string, eventId: string, certificatePem: string, privateKeyPem: string): string {
    const sig = new SignedXml({ privateKey: privateKeyPem });

    sig.addReference({
      xpath: `//*[local-name(.)='evtMonit']`,
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
      ],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    });

    sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
    sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

    const certBody = certificatePem.replace(/-----[^-]+-----|\r|\n/g, '');
    sig.keyInfoProvider = {
      getKeyInfo: () => `<X509Data><X509Certificate>${certBody}</X509Certificate></X509Data>`,
      getKey: () => Buffer.from(privateKeyPem),
    };

    sig.computeSignature(xml, {
      location: { reference: `//*[local-name(.)='evtMonit']`, action: 'append' },
    });

    return sig.getSignedXml();
  }
}
```

- [ ] **Step 5: Rodar o teste de novo**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json xml-signer --forceExit`
Expected: PASS (2 testes)

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/esocial/xml/xml-signer.service.ts backend/test/xml-signer.unit-spec.ts
git commit -m "feat(esocial): XmlSignerService — assinatura XMLDSig enveloped com xml-crypto"
```

---

## Fase F — Diagnóstico

### Task 16: `esocial-diagnostics.service.ts` + controller

**Files:**
- Create: `backend/src/esocial/diagnostics/esocial-diagnostics.service.ts`
- Create: `backend/src/esocial/diagnostics/esocial-diagnostics.controller.ts`
- Modify: `backend/src/esocial/esocial.module.ts`
- Test: `backend/test/esocial-diagnostics.unit-spec.ts`

**Interfaces:**
- Produces: `EsocialDiagnosticsService.checkReadiness(client, asoRecordId): Promise<DiagnosticResult>` onde `DiagnosticResult = { ready: boolean; checks: DiagnosticCheck[] }` e `DiagnosticCheck = { key: string; label: string; passed: boolean; detail?: string }`. Rota: `GET /esocial/diagnostics/aso/:asoRecordId`.

- [ ] **Step 1: Escrever o teste falho (lógica pura, sem banco — recebe os dados já carregados)**

```typescript
// backend/test/esocial-diagnostics.unit-spec.ts
import { evaluateReadiness } from '../src/esocial/diagnostics/esocial-diagnostics.service';

const validInput = {
  employee: {
    cpf: '11122233344',
    registration_number: 'MAT-001',
    esocial_category_code: '101',
    esocial_vinculo_confirmed_at: '2026-09-01T00:00:00Z',
  },
  certificate: { status: 'ativo', not_after: '2027-01-01T00:00:00Z' },
  asoRecord: {
    exam_date: '2026-09-01', result: 'apto', doctor_name: 'Dra. Fulana',
    doctor_crm: '54321', doctor_crm_uf: 'SP',
  },
};

describe('evaluateReadiness', () => {
  it('retorna ready=true quando tudo está presente', () => {
    const result = evaluateReadiness(validInput);
    expect(result.ready).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it('retorna ready=false e aponta a falta de matrícula', () => {
    const result = evaluateReadiness({
      ...validInput,
      employee: { ...validInput.employee, registration_number: null },
    });
    expect(result.ready).toBe(false);
    const check = result.checks.find((c) => c.key === 'employee_registration_number');
    expect(check?.passed).toBe(false);
  });

  it('retorna ready=false quando não há confirmação de vínculo no eSocial', () => {
    const result = evaluateReadiness({
      ...validInput,
      employee: { ...validInput.employee, esocial_vinculo_confirmed_at: null },
    });
    expect(result.ready).toBe(false);
    const check = result.checks.find((c) => c.key === 'vinculo_confirmado');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toMatch(/confirmação/i);
  });

  it('retorna ready=false quando o certificado está expirado', () => {
    const result = evaluateReadiness({
      ...validInput,
      certificate: { status: 'ativo', not_after: '2020-01-01T00:00:00Z' },
    });
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.key === 'certificado_valido')?.passed).toBe(false);
  });

  it('retorna ready=false quando não há certificado cadastrado', () => {
    const result = evaluateReadiness({ ...validInput, certificate: null });
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.key === 'certificado_valido')?.passed).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json esocial-diagnostics --forceExit`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar a lógica pura + o service que busca os dados**

```typescript
// backend/src/esocial/diagnostics/esocial-diagnostics.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface DiagnosticCheck {
  key: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface DiagnosticResult {
  ready: boolean;
  checks: DiagnosticCheck[];
}

interface ReadinessInput {
  employee: {
    cpf: string | null;
    registration_number: string | null;
    esocial_category_code: string | null;
    esocial_vinculo_confirmed_at: string | null;
  };
  certificate: { status: string; not_after: string } | null;
  asoRecord: {
    exam_date: string | null;
    result: string | null;
    doctor_name: string | null;
    doctor_crm: string | null;
    doctor_crm_uf: string | null;
  };
}

// Lógica pura, sem I/O — testada isoladamente (unit-spec acima), consumida pelo
// service abaixo que carrega os dados reais do banco.
export function evaluateReadiness(input: ReadinessInput): DiagnosticResult {
  const checks: DiagnosticCheck[] = [
    { key: 'employee_cpf', label: 'CPF do trabalhador', passed: !!input.employee.cpf },
    {
      key: 'employee_registration_number',
      label: 'Matrícula do trabalhador',
      passed: !!input.employee.registration_number,
    },
    {
      key: 'employee_esocial_category',
      label: 'Categoria eSocial do trabalhador',
      passed: !!input.employee.esocial_category_code,
    },
    {
      key: 'vinculo_confirmado',
      label: 'Vínculo já registrado no eSocial (confirmação manual)',
      passed: !!input.employee.esocial_vinculo_confirmed_at,
      detail: input.employee.esocial_vinculo_confirmed_at
        ? undefined
        : 'Confirme que o sistema de folha do cliente já enviou o vínculo deste trabalhador ao eSocial (S-2200/S-2300/S-2190) antes de transmitir.',
    },
    {
      key: 'certificado_valido',
      label: 'Certificado digital ativo e dentro da validade',
      passed:
        !!input.certificate &&
        input.certificate.status === 'ativo' &&
        new Date(input.certificate.not_after).getTime() > Date.now(),
      detail: input.certificate ? undefined : 'Nenhum certificado digital cadastrado para esta empresa.',
    },
    { key: 'aso_exam_date', label: 'Data do exame', passed: !!input.asoRecord.exam_date },
    { key: 'aso_result', label: 'Resultado do exame', passed: !!input.asoRecord.result },
    { key: 'aso_doctor', label: 'Dados do médico (nome, CRM, UF)', passed: !!(input.asoRecord.doctor_name && input.asoRecord.doctor_crm && input.asoRecord.doctor_crm_uf) },
  ];

  return { ready: checks.every((c) => c.passed), checks };
}

@Injectable()
export class EsocialDiagnosticsService {
  async checkReadiness(client: PoolClient, asoRecordId: string): Promise<DiagnosticResult> {
    const asoResult = await client.query(
      `SELECT ar.*, e.cpf, e.registration_number, e.esocial_category_code, e.esocial_vinculo_confirmed_at
       FROM aso_records ar JOIN employees e ON e.id = ar.employee_id
       WHERE ar.id = $1`,
      [asoRecordId],
    );
    if (asoResult.rows.length === 0) throw new NotFoundException('Registro de ASO não encontrado');
    const row = asoResult.rows[0];

    const certResult = await client.query(
      `SELECT status, not_after FROM esocial_certificates WHERE status = 'ativo' ORDER BY created_at DESC LIMIT 1`,
    );

    return evaluateReadiness({
      employee: {
        cpf: row.cpf,
        registration_number: row.registration_number,
        esocial_category_code: row.esocial_category_code,
        esocial_vinculo_confirmed_at: row.esocial_vinculo_confirmed_at,
      },
      certificate: certResult.rows[0] ?? null,
      asoRecord: {
        exam_date: row.exam_date,
        result: row.result,
        doctor_name: row.doctor_name,
        doctor_crm: row.doctor_crm,
        doctor_crm_uf: row.doctor_crm_uf,
      },
    });
  }
}
```

```typescript
// backend/src/esocial/diagnostics/esocial-diagnostics.controller.ts
import { Controller, Get, Param, Req } from '@nestjs/common';
import { EsocialDiagnosticsService } from './esocial-diagnostics.service';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('esocial/diagnostics')
export class EsocialDiagnosticsController {
  constructor(private readonly diagnostics: EsocialDiagnosticsService) {}

  @Get('aso/:asoRecordId')
  @Roles('empresa', 'tecnico', 'admin')
  check(@Param('asoRecordId') asoRecordId: string, @Req() req: any) {
    return req.withTenantContext((client: any) => this.diagnostics.checkReadiness(client, asoRecordId));
  }
}
```

- [ ] **Step 4: Registrar no `esocial.module.ts`**

```typescript
// backend/src/esocial/esocial.module.ts (atualizar)
import { Module } from '@nestjs/common';
import { CertificatesModule } from './certificates/certificates.module';
import { EsocialDiagnosticsController } from './diagnostics/esocial-diagnostics.controller';
import { EsocialDiagnosticsService } from './diagnostics/esocial-diagnostics.service';

@Module({
  imports: [CertificatesModule],
  controllers: [EsocialDiagnosticsController],
  providers: [EsocialDiagnosticsService],
  exports: [CertificatesModule, EsocialDiagnosticsService],
})
export class EsocialModule {}
```

- [ ] **Step 5: Rodar o teste unitário de novo**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json esocial-diagnostics --forceExit`
Expected: PASS (5 testes)

- [ ] **Step 6: Commit**

```bash
git add backend/src/esocial/diagnostics/ backend/src/esocial/esocial.module.ts backend/test/esocial-diagnostics.unit-spec.ts
git commit -m "feat(esocial): motor de diagnóstico de prontidão para transmissão"
```

---

## Fase G — Transmissão

### Task 17: `soap-envelope.util.ts` (lógica pura) + `esocial-soap-client.service.ts`

**Files:**
- Create: `backend/src/esocial/transmission/soap-envelope.util.ts`
- Create: `backend/src/esocial/transmission/esocial-soap-client.service.ts`
- Test: `backend/test/soap-envelope-util.unit-spec.ts`

**Interfaces:**
- Produces: `buildEnvioEnvelope(signedEventXml: string): string`, `parseEnvioResponse(responseXml: string): { protocoloLote: string }`, `buildConsultaEnvelope(protocoloLote: string): string`, `parseConsultaResponse(responseXml: string): { status: 'processando' | 'processado' | 'rejeitado'; nrRecibo?: string; erroCodigo?: string; erroMensagem?: string }`. `EsocialSoapClientService.sendLote(envioUrl, signedXml, pfxBuffer, password): Promise<{protocoloLote: string}>`, `.consultLote(consultaUrl, protocoloLote, pfxBuffer, password): Promise<ConsultaResult>`.

- [ ] **Step 0 (OBRIGATÓRIO, não pular): a estrutura do envelope SOAP abaixo é INFERIDA**

Nomes de elemento (`EnviarLoteEventos`, `envioLoteEventos`, `eventos`/`evento`, `protocoloEnvio`, `ConsultarLoteEventos`, `situacao`, `nrRecibo`) seguem o padrão conhecido de outros webservices SPED/eSocial, mas **não foram confirmados contra o WSDL oficial** (o Pacote de Comunicação do eSocial baixado de `gov.br/esocial` traz os WSDLs exatos). Antes de usar este cliente contra o endpoint real de Produção Restrita (Task 24, validação manual): baixe o Pacote de Comunicação, confira os nomes de elemento/namespace exatos de `WsEnviarLoteEventos.svc?wsdl` e `WsConsultarLoteEventos.svc?wsdl`, e ajuste `soap-envelope.util.ts` se houver divergência — documentando a mudança como agora VERIFICADA.

- [ ] **Step 1: Escrever o teste falho das funções puras**

```typescript
// backend/test/soap-envelope-util.unit-spec.ts
import {
  buildEnvioEnvelope, parseEnvioResponse, buildConsultaEnvelope, parseConsultaResponse,
} from '../src/esocial/transmission/soap-envelope.util';

describe('soap-envelope.util', () => {
  it('buildEnvioEnvelope embute o XML assinado dentro do envelope SOAP', () => {
    const envelope = buildEnvioEnvelope('<evtMonit Id="ID1">conteudo</evtMonit>');
    expect(envelope).toContain('<soap:Envelope');
    expect(envelope).toContain('<evtMonit Id="ID1">conteudo</evtMonit>');
    expect(envelope).toContain('EnviarLoteEventos');
  });

  it('parseEnvioResponse extrai o protocoloEnvio', () => {
    const xml =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
      '<EnviarLoteEventosResponse><protocoloEnvio>PROTO-123</protocoloEnvio></EnviarLoteEventosResponse>' +
      '</soap:Body></soap:Envelope>';
    expect(parseEnvioResponse(xml).protocoloLote).toBe('PROTO-123');
  });

  it('parseEnvioResponse lança erro claro se a resposta não tiver protocoloEnvio', () => {
    expect(() => parseEnvioResponse('<soap:Envelope><soap:Body><Erro/></soap:Body></soap:Envelope>')).toThrow(
      /protocoloEnvio/,
    );
  });

  it('buildConsultaEnvelope inclui o protocolo de lote', () => {
    expect(buildConsultaEnvelope('PROTO-123')).toContain('PROTO-123');
  });

  it('parseConsultaResponse reconhece PROCESSADO com nrRecibo', () => {
    const xml =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
      '<ConsultarLoteEventosResponse><situacao>PROCESSADO</situacao>' +
      '<eventos><evento><nrRecibo>RECIBO-999</nrRecibo></evento></eventos>' +
      '</ConsultarLoteEventosResponse></soap:Body></soap:Envelope>';
    const result = parseConsultaResponse(xml);
    expect(result.status).toBe('processado');
    expect(result.nrRecibo).toBe('RECIBO-999');
  });

  it('parseConsultaResponse reconhece REJEITADO com código e mensagem de erro', () => {
    const xml =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
      '<ConsultarLoteEventosResponse><situacao>REJEITADO</situacao>' +
      '<eventos><evento><codigo>301</codigo><descricao>CPF inválido</descricao></evento></eventos>' +
      '</ConsultarLoteEventosResponse></soap:Body></soap:Envelope>';
    const result = parseConsultaResponse(xml);
    expect(result.status).toBe('rejeitado');
    expect(result.erroCodigo).toBe('301');
    expect(result.erroMensagem).toBe('CPF inválido');
  });

  it('parseConsultaResponse reconhece PROCESSANDO (ainda sem resultado final)', () => {
    const xml =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
      '<ConsultarLoteEventosResponse><situacao>EM_PROCESSAMENTO</situacao></ConsultarLoteEventosResponse>' +
      '</soap:Body></soap:Envelope>';
    expect(parseConsultaResponse(xml).status).toBe('processando');
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json soap-envelope-util --forceExit`
Expected: FAIL — módulo não existe

- [ ] **Step 3: Implementar as funções puras**

```typescript
// backend/src/esocial/transmission/soap-envelope.util.ts
export function buildEnvioEnvelope(signedEventXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <EnviarLoteEventos xmlns="http://esocial.gov.br/servicos/empregador/enviarloteeventos/v1_1_0">
      <loteEventos>
        <eSocial xmlns="http://www.esocial.gov.br/schema/lote/eventos/envio/v1_1_0">
          <envioLoteEventos>
            <eventos>
              <evento>${signedEventXml}</evento>
            </eventos>
          </envioLoteEventos>
        </eSocial>
      </loteEventos>
    </EnviarLoteEventos>
  </soap:Body>
</soap:Envelope>`;
}

export function parseEnvioResponse(responseXml: string): { protocoloLote: string } {
  const match = responseXml.match(/<protocoloEnvio>([^<]+)<\/protocoloEnvio>/);
  if (!match) {
    throw new Error(`Resposta do eSocial sem protocoloEnvio — resposta bruta: ${responseXml.slice(0, 500)}`);
  }
  return { protocoloLote: match[1] };
}

export function buildConsultaEnvelope(protocoloLote: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ConsultarLoteEventos xmlns="http://esocial.gov.br/servicos/empregador/consultarloteeventos/v1_1_0">
      <consultaLoteEventos>
        <protocoloEnvio>${protocoloLote}</protocoloEnvio>
      </consultaLoteEventos>
    </ConsultarLoteEventos>
  </soap:Body>
</soap:Envelope>`;
}

export interface ConsultaResult {
  status: 'processando' | 'processado' | 'rejeitado';
  nrRecibo?: string;
  erroCodigo?: string;
  erroMensagem?: string;
}

export function parseConsultaResponse(responseXml: string): ConsultaResult {
  const situacao = responseXml.match(/<situacao>([^<]+)<\/situacao>/)?.[1];
  if (situacao === 'PROCESSADO') {
    const nrRecibo = responseXml.match(/<nrRecibo>([^<]+)<\/nrRecibo>/)?.[1];
    return { status: 'processado', nrRecibo };
  }
  if (situacao === 'REJEITADO') {
    const erroCodigo = responseXml.match(/<codigo>([^<]+)<\/codigo>/)?.[1];
    const erroMensagem = responseXml.match(/<descricao>([^<]+)<\/descricao>/)?.[1];
    return { status: 'rejeitado', erroCodigo, erroMensagem };
  }
  return { status: 'processando' };
}
```

- [ ] **Step 4: Rodar o teste de novo**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json soap-envelope-util --forceExit`
Expected: PASS (7 testes)

- [ ] **Step 5: Implementar o cliente que usa as funções puras + mTLS**

```typescript
// backend/src/esocial/transmission/esocial-soap-client.service.ts
import { Injectable } from '@nestjs/common';
import { Agent } from 'https';
import axios from 'axios';
import {
  buildEnvioEnvelope, parseEnvioResponse, buildConsultaEnvelope, parseConsultaResponse, ConsultaResult,
} from './soap-envelope.util';

@Injectable()
export class EsocialSoapClientService {
  async sendLote(
    envioUrl: string,
    signedXml: string,
    pfxBuffer: Buffer,
    password: string,
  ): Promise<{ protocoloLote: string }> {
    const httpsAgent = new Agent({ pfx: pfxBuffer, passphrase: password });
    const response = await axios.post(envioUrl, buildEnvioEnvelope(signedXml), {
      httpsAgent,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
      timeout: 30_000,
    });
    return parseEnvioResponse(response.data);
  }

  async consultLote(
    consultaUrl: string,
    protocoloLote: string,
    pfxBuffer: Buffer,
    password: string,
  ): Promise<ConsultaResult> {
    const httpsAgent = new Agent({ pfx: pfxBuffer, passphrase: password });
    const response = await axios.post(consultaUrl, buildConsultaEnvelope(protocoloLote), {
      httpsAgent,
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
      timeout: 30_000,
    });
    return parseConsultaResponse(response.data);
  }
}
```

Nota: `EsocialSoapClientService` não tem teste unitário próprio de rede — a lógica de montagem/parsing já está 100% coberta nas funções puras (Step 1), e o comportamento de rede/mTLS real só é validado de fato na Task 24 (Produção Restrita real). A Task 18 testa a orquestração do cron com este service mockado via `overrideProvider`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/esocial/transmission/soap-envelope.util.ts backend/src/esocial/transmission/esocial-soap-client.service.ts backend/test/soap-envelope-util.unit-spec.ts
git commit -m "feat(esocial): envelope SOAP manual (não WSDL dinâmico) + cliente com mTLS"
```

---

### Task 18: `transmission-queue.cron.ts` — máquina de estados

**Files:**
- Create: `backend/src/esocial/transmission/transmission-queue.cron.ts`
- Modify: `backend/src/esocial/esocial.module.ts`
- Modify: `backend/test/tenant-context-callsites.unit-spec.ts` (adicionar à lista `ALLOWED`)
- Test: `backend/test/transmission-queue-cron.e2e-spec.ts`

**Interfaces:**
- Consumes: `DatabaseService` (ler `backend/src/common/database/database.service.ts` primeiro para confirmar a assinatura exata de `withTenantContext`, ver Step 0), `CertificatesService.loadForSigning`, `XmlGeneratorService.generate`, `XmlSignerService.sign`, `EsocialSoapClientService.sendLote/.consultLote`, `esocial_layout_versions` (URL por ambiente).
- Produces: transições de estado gravadas em `esocial_events.status` + uma linha por transição em `esocial_event_history`.

- [ ] **Step 0 (OBRIGATÓRIO): confirmar a assinatura exata de `DatabaseService.withTenantContext`**

Run: `grep -n "withTenantContext" backend/src/common/database/database.service.ts`

Ajuste as chamadas abaixo à assinatura real encontrada (o padrão documentado na spec é `withTenantContext(ctx: {tenantId?, userId?, role}, fn: (client) => Promise<T>): Promise<T>` mas confirme antes de codificar).

- [ ] **Step 1: Escrever o teste e2e falho (com todos os serviços de I/O externo mockados via `overrideProvider`)**

```typescript
// backend/test/transmission-queue-cron.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TransmissionQueueCron } from '../src/esocial/transmission/transmission-queue.cron';
import { EsocialSoapClientService } from '../src/esocial/transmission/esocial-soap-client.service';
import { CertificatesService } from '../src/esocial/certificates/certificates.service';
import { parsePkcs12 } from '../src/esocial/certificates/pkcs12.util';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('TransmissionQueueCron (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let cron: TransmissionQueueCron;

  // Mocka só os dois pontos de I/O externo real (rede/mTLS contra o eSocial e
  // decriptação do certificado do R2), mas usa o PEM/pfx REAIS do fixture de teste —
  // assim XmlSignerService (não mockado) executa a assinatura de verdade, e este
  // teste prova a orquestração ponta a ponta, não só a sequência de estados.
  const fixturePfx = readFileSync(join(__dirname, 'fixtures/esocial/test-certificate.pfx'));
  const parsedFixture = parsePkcs12(fixturePfx, 'teste1234');

  const mockSoapClient = {
    sendLote: jest.fn().mockResolvedValue({ protocoloLote: 'PROTO-E2E' }),
    consultLote: jest.fn().mockResolvedValue({ status: 'processado', nrRecibo: 'RECIBO-E2E' }),
  };
  const mockCertificates = {
    loadForSigning: jest.fn().mockResolvedValue({
      certificatePem: parsedFixture.certificatePem,
      privateKeyPem: parsedFixture.privateKeyPem,
    }),
    loadRawPfxForTransmission: jest.fn().mockResolvedValue({ pfxBuffer: fixturePfx, password: 'teste1234' }),
    list: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EsocialSoapClientService)
      .useValue(mockSoapClient)
      .overrideProvider(CertificatesService)
      .useValue(mockCertificates)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    cron = moduleRef.get(TransmissionQueueCron);
    db = new TestDb();
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('avança um evento de rascunho até processado numa única passada, gravando histórico', async () => {
    const tenant = await db.createTenantWithUser('cron-e2e');
    const asoRecordId = await db.insertMinimalAsoRecord(tenant);
    const certificateId = await db.insertMinimalCertificate(tenant);
    const eventId = await db.insertMinimalEsocialEvent(tenant, { asoRecordId, certificateId });

    await cron.processPendingEvents();
    // XML gerado/assinado é síncrono; transmissão+consulta também (mock resolve na hora) —
    // uma única passada do cron já deve levar o evento a 'processado' neste teste.
    await cron.processPendingEvents();

    const event = await db.getRawRow('esocial_events', eventId);
    expect(event.status).toBe('processado');
    expect(event.nr_recibo).toBe('RECIBO-E2E');

    const history = await db.getRawRows('esocial_event_history', { esocial_event_id: eventId });
    const statuses = history.map((h: any) => h.to_status);
    expect(statuses).toContain('assinado');
    expect(statuses).toContain('processado');
  });

  it('evento com idempotency_key repetida não gera segunda linha (constraint UNIQUE)', async () => {
    const tenant = await db.createTenantWithUser('cron-e2e-idem');
    const asoRecordId = await db.insertMinimalAsoRecord(tenant);
    const certificateId = await db.insertMinimalCertificate(tenant);
    await db.insertMinimalEsocialEvent(tenant, { asoRecordId, certificateId, idempotencyKey: 'chave-fixa' });

    await expect(
      db.insertMinimalEsocialEvent(tenant, { asoRecordId, certificateId, idempotencyKey: 'chave-fixa' }),
    ).rejects.toThrow();
  });
});
```

Nota: `insertMinimalEsocialEvent`, `getRawRow`, `getRawRows` são helpers a adicionar em `backend/test/db-test-helper.ts` neste mesmo task (Step 2).

- [ ] **Step 2: Adicionar helpers em `db-test-helper.ts`**

```typescript
// dentro da classe TestDb em backend/test/db-test-helper.ts
async insertMinimalEsocialEvent(
  tenant: { tenantId: string; employeeId: string; userId: string },
  opts: { asoRecordId: string; certificateId: string; idempotencyKey?: string },
): Promise<string> {
  const layoutVersion = await this.superuserClient.query(
    `SELECT id FROM esocial_layout_versions WHERE is_active = true LIMIT 1`,
  );
  const result = await this.superuserClient.query(
    `INSERT INTO esocial_events (
      tenant_id, event_type, aso_record_id, employee_id, certificate_id, layout_version_id,
      ambiente, idempotency_key, payload_json, created_by_user_id
    ) VALUES ($1, 'S-2220', $2, $3, $4, $5, 'producao_restrita', $6, '{}', $7)
    RETURNING id`,
    [
      tenant.tenantId, opts.asoRecordId, tenant.employeeId, opts.certificateId, layoutVersion.rows[0].id,
      opts.idempotencyKey ?? `test-${Date.now()}-${Math.random()}`, tenant.userId,
    ],
  );
  return result.rows[0].id;
}

async getRawRow(table: string, id: string) {
  const result = await this.superuserClient.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return result.rows[0];
}

async getRawRows(table: string, where: Record<string, string>) {
  const keys = Object.keys(where);
  const clause = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
  const result = await this.superuserClient.query(`SELECT * FROM ${table} WHERE ${clause}`, Object.values(where));
  return result.rows;
}
```

- [ ] **Step 3: Rodar o teste para confirmar que falha**

Use a receita de container (Task 10, Step 8), padrão `transmission-queue-cron`. Expected: FAIL — `TransmissionQueueCron` não existe.

- [ ] **Step 4: Implementar o cron**

```typescript
// backend/src/esocial/transmission/transmission-queue.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database/database.service';
import { CertificatesService } from '../certificates/certificates.service';
import { XmlGeneratorService } from '../xml/xml-generator.service';
import { XmlSignerService } from '../xml/xml-signer.service';
import { EsocialSoapClientService } from './esocial-soap-client.service';
import { buildS2220Payload } from '../events/s2220-event-builder';

const PENDING_STATUSES = ['rascunho', 'assinado', 'transmitido', 'processando'];

@Injectable()
export class TransmissionQueueCron {
  private readonly logger = new Logger(TransmissionQueueCron.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly certificates: CertificatesService,
    private readonly xmlGenerator: XmlGeneratorService,
    private readonly xmlSigner: XmlSignerService,
    private readonly soapClient: EsocialSoapClientService,
  ) {}

  @Cron('*/2 * * * *')
  async processPendingEvents(): Promise<void> {
    // Job de sistema, sem usuário HTTP — roda como role 'admin', mesmo padrão dos
    // outros crons do projeto (subscription-reconciliation, visit-reminder, etc.).
    // Entrada correspondente adicionada em tenant-context-callsites ALLOWED (Step 6).
    await this.db.withTenantContext({ role: 'admin' } as any, async (client) => {
      const pending = await client.query(
        `SELECT * FROM esocial_events WHERE status = ANY($1) ORDER BY created_at LIMIT 10`,
        [PENDING_STATUSES],
      );
      for (const event of pending.rows) {
        try {
          await this.advance(client, event);
        } catch (err: any) {
          this.logger.error(`Falha ao avançar evento ${event.id}: ${err.message}`);
          await this.transition(client, event.id, event.status, 'erro_tecnico', err.message?.slice(0, 500));
        }
      }
    });
  }

  private async advance(client: PoolClient, event: any): Promise<void> {
    if (event.status === 'rascunho') {
      const asoResult = await client.query(
        `SELECT ar.*, e.cpf AS employee_cpf, e.registration_number, e.esocial_category_code, t.cnpj AS tenant_cnpj
         FROM aso_records ar
         JOIN employees e ON e.id = ar.employee_id
         JOIN tenants t ON t.id = ar.tenant_id
         WHERE ar.id = $1`,
        [event.aso_record_id],
      );
      const aso = asoResult.rows[0];
      const examDetails = await client.query('SELECT * FROM aso_exam_details WHERE aso_record_id = $1', [
        event.aso_record_id,
      ]);
      const physician = aso.pcmso_physician_id
        ? (await client.query('SELECT * FROM tenant_pcmso_physicians WHERE id = $1', [aso.pcmso_physician_id])).rows[0]
        : null;

      const payload = buildS2220Payload({
        ambiente: event.ambiente,
        tenantCnpj: aso.tenant_cnpj,
        employeeCpf: aso.employee_cpf,
        employeeRegistrationNumber: aso.registration_number,
        employeeEsocialCategoryCode: aso.esocial_category_code,
        asoRecord: aso,
        examDetails: examDetails.rows,
        pcmsoPhysician: physician,
      });

      const xml = this.xmlGenerator.generate(payload, event.id);
      const { certificatePem, privateKeyPem } = await this.certificates.loadForSigning(client, event.certificate_id);
      const signedXml = this.xmlSigner.sign(xml, event.id, certificatePem, privateKeyPem);

      await client.query(
        `UPDATE esocial_events SET payload_json = $1, xml_generated = $2, xml_signed = $3, status = 'assinado', updated_at = now() WHERE id = $4`,
        [JSON.stringify(payload), xml, signedXml, event.id],
      );
      await this.transition(client, event.id, 'rascunho', 'assinado', null);
      return;
    }

    if (event.status === 'assinado') {
      const layoutVersion = await client.query('SELECT * FROM esocial_layout_versions WHERE id = $1', [
        event.layout_version_id,
      ]);
      const envioUrl = layoutVersion.rows[0].producao_restrita_envio_url;
      // Transmissão mTLS precisa do .pfx bruto + senha (não do PEM usado para assinar
      // o XML) — CertificatesService.loadRawPfxForTransmission (Task 11) devolve isso.
      const { pfxBuffer, password } = await this.certificates.loadRawPfxForTransmission(client, event.certificate_id);

      const { protocoloLote } = await this.soapClient.sendLote(envioUrl, event.xml_signed, pfxBuffer, password);
      await client.query(
        `UPDATE esocial_events SET protocolo_lote = $1, status = 'transmitido', updated_at = now() WHERE id = $2`,
        [protocoloLote, event.id],
      );
      await this.transition(client, event.id, 'assinado', 'transmitido', `protocolo=${protocoloLote}`);
      return;
    }

    if (event.status === 'transmitido' || event.status === 'processando') {
      const layoutVersion = await client.query('SELECT * FROM esocial_layout_versions WHERE id = $1', [
        event.layout_version_id,
      ]);
      const consultaUrl = layoutVersion.rows[0].producao_restrita_consulta_url;
      const { pfxBuffer, password } = await this.certificates.loadRawPfxForTransmission(client, event.certificate_id);
      const result = await this.soapClient.consultLote(consultaUrl, event.protocolo_lote, pfxBuffer, password);

      if (result.status === 'processando') {
        if (event.status !== 'processando') {
          await client.query(`UPDATE esocial_events SET status = 'processando', updated_at = now() WHERE id = $1`, [event.id]);
          await this.transition(client, event.id, event.status, 'processando', null);
        }
        return;
      }

      await client.query(
        `UPDATE esocial_events SET status = $1, nr_recibo = $2, erro_codigo = $3, erro_mensagem = $4, updated_at = now() WHERE id = $5`,
        [result.status, result.nrRecibo ?? null, result.erroCodigo ?? null, result.erroMensagem ?? null, event.id],
      );
      await this.transition(client, event.id, event.status, result.status, result.erroMensagem ?? result.nrRecibo ?? null);
    }
  }

  private async transition(
    client: PoolClient,
    eventId: string,
    fromStatus: string | null,
    toStatus: string,
    detail: string | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO esocial_event_history (tenant_id, esocial_event_id, from_status, to_status, detail)
       SELECT tenant_id, id, $2, $3, $4 FROM esocial_events WHERE id = $1`,
      [eventId, fromStatus, toStatus, detail],
    );
  }
}
```

- [ ] **Step 5: Registrar no `esocial.module.ts` (com `ScheduleModule` já global via `app.module.ts`)**

```typescript
// backend/src/esocial/esocial.module.ts (atualizar imports/providers)
import { Module } from '@nestjs/common';
import { CertificatesModule } from './certificates/certificates.module';
import { EsocialDiagnosticsController } from './diagnostics/esocial-diagnostics.controller';
import { EsocialDiagnosticsService } from './diagnostics/esocial-diagnostics.service';
import { XmlGeneratorService } from './xml/xml-generator.service';
import { XmlSignerService } from './xml/xml-signer.service';
import { EsocialSoapClientService } from './transmission/esocial-soap-client.service';
import { TransmissionQueueCron } from './transmission/transmission-queue.cron';
import { DatabaseModule } from '../common/database/database.module';

@Module({
  imports: [CertificatesModule, DatabaseModule],
  controllers: [EsocialDiagnosticsController],
  providers: [
    EsocialDiagnosticsService, XmlGeneratorService, XmlSignerService,
    EsocialSoapClientService, TransmissionQueueCron,
  ],
  exports: [CertificatesModule, EsocialDiagnosticsService],
})
export class EsocialModule {}
```

Confirme o nome exato do módulo que exporta `DatabaseService` (`grep -rn "class DatabaseModule" backend/src/common/`) e ajuste o import se o nome for diferente.

- [ ] **Step 6: Adicionar à lista `ALLOWED` de `tenant-context-callsites.unit-spec.ts`**

Leia o arquivo primeiro para copiar o formato exato das entradas existentes, depois adicione uma entrada para `transmission-queue.cron.ts` com o mesmo motivo já usado nos outros 4 crons do projeto ("job de sistema, sem usuário HTTP, roda como role 'admin'").

- [ ] **Step 7: Rodar os testes no container**

Padrão de spec: `transmission-queue-cron`. Expected: PASS (2 testes). Rode também `tenant-context-callsites` no host (unit) para confirmar que a nova entrada não quebra o teste estático.

- [ ] **Step 8: Commit**

```bash
git add backend/src/esocial/transmission/transmission-queue.cron.ts backend/src/esocial/esocial.module.ts backend/src/esocial/certificates/certificates.service.ts backend/test/transmission-queue-cron.e2e-spec.ts backend/test/db-test-helper.ts backend/test/tenant-context-callsites.unit-spec.ts
git commit -m "feat(esocial): cron da fila de transmissão — máquina de estados completa"
```

---

### Task 19: `esocial-status.controller.ts` — API de status mínima

**Files:**
- Create: `backend/src/esocial/esocial-status.controller.ts`
- Modify: `backend/src/esocial/esocial.module.ts`
- Test: `backend/test/esocial-status.e2e-spec.ts`

**Interfaces:**
- Produces: `GET /esocial/status` → `{ certificate: CertificateSummary | null; events: EventSummary[] }` onde `EventSummary = { id, eventType, status, examDate, nrRecibo, erroMensagem, createdAt }`.

- [ ] **Step 1: Escrever o teste e2e falho**

```typescript
// backend/test/esocial-status.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /esocial/status (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('retorna certificado e eventos do próprio tenant, nada de outro tenant', async () => {
    const tenant = await db.createTenantWithUser('status-a');
    const other = await db.createTenantWithUser('status-b');
    const asoRecordId = await db.insertMinimalAsoRecord(tenant);
    const certificateId = await db.insertMinimalCertificate(tenant);
    await db.insertMinimalEsocialEvent(tenant, { asoRecordId, certificateId });
    const otherAso = await db.insertMinimalAsoRecord(other);
    const otherCert = await db.insertMinimalCertificate(other);
    await db.insertMinimalEsocialEvent(other, { asoRecordId: otherAso, certificateId: otherCert });

    const res = await request(app.getHttpServer())
      .get('/esocial/status')
      .set('Authorization', `Bearer ${tenant.token}`);

    expect(res.status).toBe(200);
    expect(res.body.certificate.id).toBe(certificateId);
    expect(res.body.events).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Padrão de spec no container: `esocial-status`. Expected: FAIL — rota não existe.

- [ ] **Step 3: Implementar**

```typescript
// backend/src/esocial/esocial-status.controller.ts
import { Controller, Get, Req } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { CertificatesService } from './certificates/certificates.service';

@Controller('esocial/status')
export class EsocialStatusController {
  constructor(private readonly certificates: CertificatesService) {}

  @Get()
  @Roles('empresa', 'tecnico', 'admin')
  async status(@Req() req: any) {
    return req.withTenantContext(async (client: any) => {
      const certs = await this.certificates.list(client);
      const eventsResult = await client.query(
        `SELECT e.id, e.event_type, e.status, e.nr_recibo, e.erro_mensagem, e.created_at, ar.exam_date
         FROM esocial_events e JOIN aso_records ar ON ar.id = e.aso_record_id
         ORDER BY e.created_at DESC LIMIT 50`,
      );
      return {
        certificate: certs[0] ?? null,
        events: eventsResult.rows.map((r: any) => ({
          id: r.id,
          eventType: r.event_type,
          status: r.status,
          examDate: r.exam_date,
          nrRecibo: r.nr_recibo,
          erroMensagem: r.erro_mensagem,
          createdAt: r.created_at,
        })),
      };
    });
  }
}
```

- [ ] **Step 4: Registrar no `esocial.module.ts`**

Adicionar `EsocialStatusController` ao array `controllers` de `esocial.module.ts`.

- [ ] **Step 5: Rodar o teste de novo**

Padrão `esocial-status` no container. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/esocial/esocial-status.controller.ts backend/src/esocial/esocial.module.ts backend/test/esocial-status.e2e-spec.ts
git commit -m "feat(esocial): API de status mínima (certificado + lista de eventos)"
```

---

## Fase H — UI mínima e verificação final

### Task 20: Tela mínima de status no frontend

**Files:**
- Create: `frontend/src/app/(app)/esocial/page.tsx` (caminho exato a confirmar no Step 0)
- Test: manual (ver Step 2) — este sub-projeto não inclui teste automatizado de frontend (nenhum já existe no repo para copiar o padrão; fora de escopo introduzir a infra de teste de componente aqui).

**Interfaces:**
- Consumes: `GET /esocial/status` (Task 19) — resposta `{ certificate: {...} | null, events: [...] }`.

- [ ] **Step 0 (OBRIGATÓRIO): confirmar o padrão real de página autenticada antes de copiar cegamente o exemplo abaixo**

Run: `find frontend/src/app -maxdepth 3 -type d` e abra uma página existente que já faz fetch autenticado ao backend (ex. procure por `NEXT_PUBLIC_API_URL` com `grep -rn "NEXT_PUBLIC_API_URL" frontend/src`) para confirmar: (a) o caminho/route group real usado por páginas autenticadas, (b) como o token é anexado à chamada (cookie httpOnly vs. header, client component vs. server component), (c) o padrão de layout/estilo Tailwind já usado. Ajuste o exemplo abaixo para bater com o padrão real encontrado — o código a seguir é ilustrativo da estrutura de dados e conteúdo, não do mecanismo exato de autenticação do frontend (não auditado em profundidade nesta spec).

- [ ] **Step 1: Implementar a página (ajustar auth/layout conforme Step 0)**

```tsx
// frontend/src/app/(app)/esocial/page.tsx
'use client';

import { useEffect, useState } from 'react';

interface CertificateSummary {
  id: string;
  label: string;
  subjectCn: string;
  status: string;
  notAfter: string;
}

interface EventSummary {
  id: string;
  eventType: string;
  status: string;
  examDate: string | null;
  nrRecibo: string | null;
  erroMensagem: string | null;
  createdAt: string;
}

interface StatusResponse {
  certificate: CertificateSummary | null;
  events: EventSummary[];
}

const STATUS_LABELS: Record<string, string> = {
  rascunho: 'Rascunho', validando: 'Validando', assinado: 'Assinado',
  aguardando_transmissao: 'Aguardando transmissão', transmitindo: 'Transmitindo',
  transmitido: 'Transmitido', processando: 'Processando', processado: 'Processado',
  rejeitado: 'Rejeitado', erro_tecnico: 'Erro técnico',
};

export default function EsocialStatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/esocial/status', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Não foi possível carregar o status do eSocial');
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!data) return <div className="p-6">Carregando…</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">eSocial</h1>

      <section className="rounded border p-4">
        <h2 className="font-medium mb-2">Certificado digital</h2>
        {data.certificate ? (
          <div className="text-sm space-y-1">
            <p>{data.certificate.subjectCn}</p>
            <p>Status: {data.certificate.status === 'ativo' ? '🟢 Ativo' : '🔴 ' + data.certificate.status}</p>
            <p>Validade: {new Date(data.certificate.notAfter).toLocaleDateString('pt-BR')}</p>
          </div>
        ) : (
          <p className="text-sm text-gray-600">Nenhum certificado cadastrado.</p>
        )}
      </section>

      <section className="rounded border p-4">
        <h2 className="font-medium mb-2">Eventos</h2>
        {data.events.length === 0 ? (
          <p className="text-sm text-gray-600">Nenhum evento ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-1">Tipo</th>
                <th>Status</th>
                <th>Data do exame</th>
                <th>Recibo / erro</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((event) => (
                <tr key={event.id} className="border-b last:border-0">
                  <td className="py-1">{event.eventType}</td>
                  <td>{STATUS_LABELS[event.status] ?? event.status}</td>
                  <td>{event.examDate ? new Date(event.examDate).toLocaleDateString('pt-BR') : '—'}</td>
                  <td>{event.nrRecibo ?? event.erroMensagem ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verificação manual**

Suba o ambiente local (`docker compose up` — ambiente de desenvolvimento existente, não produção), acesse `/esocial` autenticado como um tenant `empresa` que já tenha certificado/eventos de teste, e confirme visualmente que a tela renderiza certificado e eventos corretamente, e que um tenant sem certificado vê "Nenhum certificado cadastrado" em vez de erro.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(app\)/esocial/page.tsx
git commit -m "feat(esocial): tela mínima de status (certificado + eventos)"
```

---

### Task 21: Rodar a suíte completa de testes deste sub-projeto

**Files:** nenhum arquivo novo — task de verificação.

- [ ] **Step 1: Rodar todos os unit tests novos no host**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json "esocial|aso|s2220|xml-|pkcs12|certificate-crypto|envelope-crypto|soap-envelope" --forceExit`
Expected: PASS em todos (confira que nenhum teste pré-existente quebrou — falhas pré-existentes conhecidas: `question-notices`, `normative-answer-shared`, `r2-get-object`, ver memória do projeto sobre execução de testes).

- [ ] **Step 2: Rodar `test:isolation` (RLS estático + varredura de catálogo) no container**

Use a receita de container (Task 10, Step 8), mas troque o comando final por: `npm run test:isolation`. Expected: PASS — confirma que toda tabela nova (`esocial_certificates`, `esocial_events`, `esocial_event_history`, `aso_records`, `aso_exam_details`, `tenant_pcmso_physicians`) tem FORCE RLS e nenhum call-site novo de `db.withTenantContext` escapou da lista `ALLOWED`.

- [ ] **Step 3: Rodar todos os e2e novos no container**

Padrão de spec: `esocial|aso`. Expected: PASS em todos. Se algo falhar, siga o systematic-debugging da sessão (não pule para "deve ser infra" sem investigar — a memória do projeto já documenta falhas pré-existentes esperadas, compare com essa lista antes de assumir regressão nova).

- [ ] **Step 4: Nenhum commit nesta task** — é só verificação. Se algo precisar de correção, volte para a task correspondente, corrija, rode o teste daquela task, e só então repita esta Task 21.

---

## Fase I — Fechamento

### Task 22: Atualizar `PRODUCT.md`

**Files:**
- Modify: `PRODUCT.md`

**Interfaces:** nenhuma (documentação).

- [ ] **Step 1: Ler o texto atual exato antes de editar**

Run: `grep -n "esocial\|eSocial" PRODUCT.md`

- [ ] **Step 2: Substituir a afirmação categórica por uma que reflita o novo estado (Produção Restrita, evento piloto S-2220)**

Edite o trecho encontrado no Step 1 (a linha 31 mencionada na auditoria e a linha 39 de reforço) para algo como:

```markdown
eSocial: integração real de transmissão em desenvolvimento. Hoje (Sub-projeto 1):
certificado digital A1 do cliente, diagnóstico de prontidão e o evento S-2220
(Monitoramento da Saúde do Trabalhador) funcionam de ponta a ponta em **Produção
Restrita** (ambiente de testes do governo, sem efeito legal). Não usar em Produção
real até o critério de aceite completo (`docs/specs/esocial-arquitetura.md`) ser
cumprido e autorizado pelo fundador. Demais eventos SST (S-2210, S-2240, S-3000) e
procuração eletrônica ainda não existem — roadmap em `docs/specs/esocial-arquitetura.md`.
```

- [ ] **Step 3: Commit**

```bash
git add PRODUCT.md
git commit -m "docs: atualiza PRODUCT.md — eSocial S-2220 funcional em Produção Restrita"
```

---

### Task 23: Validação manual em Produção Restrita (não automatizável)

**Files:** nenhum — task manual, requer certificado real e credenciamento no eSocial.

Esta task não pode ser feita por um agente/CI: exige um certificado A1 ICP-Brasil real (mesmo que de uma empresa de teste), inscrição válida em Produção Restrita, e confirmação humana de conformidade legal. **Não marque esta task como concluída sem essa validação real** — é o item que fecha o critério de aceite "Evento é transmitido em Produção Restrita" da spec.

- [ ] **Step 1: Obter um certificado A1 de teste real** (fornecido pelo dono do produto ou por uma AC de teste ICP-Brasil) e fazer upload via `POST /esocial/certificates` num tenant de teste real (não o fixture de unit test).

- [ ] **Step 2: Confirmar a estrutura exata do WSDL/envelope contra o Pacote de Comunicação oficial** (repetir a verificação da Task 13 Step 0 e Task 17 Step 0, agora com o documento em mãos) e ajustar `soap-envelope.util.ts`/`s2220-event-builder.ts`/`xml-generator.service.ts` se houver qualquer divergência encontrada — commitando cada ajuste separadamente com a fonte agora VERIFICADA citada na mensagem de commit.

- [ ] **Step 3: Criar um `aso_record` de teste real, rodar o Diagnóstico eSocial, confirmar `ready: true`.**

- [ ] **Step 4: Disparar a transmissão (aguardar o cron ou chamar `processPendingEvents()` manualmente num ambiente de teste) e observar o evento avançar até `processado` ou `rejeitado` contra o webservice real de Produção Restrita.**

- [ ] **Step 5: Se rejeitado, documentar o código/mensagem real de erro recebido** (isso vira a base factual — VERIFICADO — para a central de rejeições dos sub-projetos futuros, em vez de mensagens de erro inventadas).

- [ ] **Step 6: Registrar o resultado da validação** (sucesso ou lista de ajustes necessários) em `docs/specs/esocial-arquitetura.md`, seção "Riscos conhecidos", atualizando os itens que passam de INFERIDO/NÃO VERIFICADO para VERIFICADO.

- [ ] **Step 7: Só então marcar o critério de aceite do Sub-projeto 1 como cumprido** e comunicar ao dono do produto usando os rótulos VERIFICADO/NÃO VERIFICADO exigidos pelo AGENTS.md — nunca afirmar que a transmissão "funciona" sem esta validação real ter rodado.

---

## Self-Review

**1. Cobertura da spec:** `esocial-arquitetura.md` (módulos, fluxo, adapter, estados, ambientes, bibliotecas, riscos) → Tasks 1-23 cobrem cada seção. `esocial-mapeamento-dados.md` (tabelas/colunas novas) → Tasks 1-5 implementam exatamente o mapeamento. `esocial-seguranca.md` (envelope encryption, permissões, RLS, auditoria, logs) → Tasks 7-8 (crypto), Task 2/4 (RLS + `esocial_event_history` append-only), `@Roles(...)` em todo controller (Tasks 10/12/16/19), nenhum log de payload/senha introduzido em nenhuma task. Critério de aceite da spec → cada item tem uma task correspondente, fechado pela Task 23.

**2. Varredura de placeholders:** nenhum "TBD"/"implementar depois" — os únicos pontos deliberadamente deixados para confirmação humana (estrutura XSD, envelope SOAP, URLs de Produção real) são tratados como passos explícitos de verificação (Task 13 Step 0, Task 17 Step 0, Task 23), não como lacunas de código.

**3. Consistência de tipos:** `CertificateSummary`, `S2220EventPayload`, `DiagnosticResult`, `EsocialProvider`, `ConsultaResult` usados de forma consistente entre as tasks que os produzem e as que os consomem. Corrigido durante a escrita: `CertificatesService` precisava de `loadRawPfxForTransmission` (Task 18 dependia dele) — adicionado retroativamente à Task 11 em vez de deixado como lacuna; o teste e2e da Task 18 foi ajustado para usar o certificado de teste real (fixture da Task 9) em vez de PEM fictício, já que `XmlSignerService` real (não mockado) rejeitaria uma chave inválida.

---

**Plan complete and saved to `docs/superpowers/plans/2026-09-29-esocial-sst-subprojeto1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
