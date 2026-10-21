# Painel de Atuação — Fase 5A (documentos: fluxo e assinatura interna, backend) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar, no backend, o fluxo de documentos técnicos da Montese (rascunho → revisão → aprovação → assinatura interna → publicação) com versões e hash, matriz de responsabilidades vazia por padrão, registros profissionais confirmados e histórico imutável — sem criar segunda linhagem de documentos (a publicação grava em `documents`).

**Architecture:** Tabelas novas e internas (RLS: só `socio` na carteira Montese e `admin`) + um módulo Nest `documentos-fluxo` dentro de `atuacao`. Regras de fluxo e permissões numa função pura testável; permissão em duas camadas: RBAC grossa (`PermissionsGuard`) e matriz por tipo/usuário/ação (serviço). A publicação insere em `documents` reaproveitando a mesma chave do arquivo no R2.

**Tech Stack:** NestJS, TypeScript, PostgreSQL (`pg`), class-validator, multer (já usado em `documents`), `R2Service`, Jest.

**Spec:** `docs/superpowers/specs/2026-10-20-painel-atuacao-fase5-documentos-design.md` (decisões vinculantes na §1). **Pré-requisitos:** Fases 0–4 prontas. **Fora desta parte (5B):** telas `/atuacao/documentos`.

## Global Constraints

- Sem `commit`/`push`/`reset`: "Checkpoint" só lista arquivos. Nada em produção; migrations só no Postgres descartável `socio_ensaio_pg`.
- Nunca ler `.env`/`ensaio.env`; **proibido** `/opt/Montese/run-backend-tests.sh` e docker fora do comando de migration indicado. Unit: `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão>`. E2E: somente `<scratchpad>/reset-redis.sh >/dev/null && <scratchpad>/run-e2e.sh <padrão> > <log> 2>&1`, uma suíte por vez (e2e que enviem arquivo usam R2 **mockado** com `overrideProvider(R2Service)` — nunca R2 real). Se o ambiente não existir, recriar conforme a memória `reference_ensaio_descartavel_isolado`. Nunca passar senhas a subagentes.
- **Nenhum dado profissional real em migration, seed, teste ou código.** Testes usam registros fictícios claramente marcados (ex.: conselho `TESTE`, número `0000`). Nenhuma permissão técnica é presumida: matriz vazia ⇒ ação restrita negada, inclusive para o admin.
- **Textos fixos:** o aviso `AVISO_ASSINATURA_INTERNA` = "Registro de assinatura interna do sistema. Não é certificado digital ICP-Brasil e não garante, por si só, validade jurídica em todos os casos." é devolvido pela API em toda resposta de detalhe que envolva assinatura. Nenhum texto, rota, evento ou coluna usa "assinatura digital", "ICP-Brasil" (exceto dentro do aviso acima) ou afirma validade jurídica.
- Mensagem de bloqueio por matriz: "Ação não habilitada para este tipo de documento. Peça ao administrador para configurar as responsabilidades."
- Permissões RBAC novas (lista fechada, ampliar `PERMISSIONS` e o CHECK de `socio_permissions`): `documents.read`, `documents.approve`, `documents.publish` (as demais — `documents.create_draft`, `documents.review`, `documents.sign` — já existem).
- Nenhum `@Roles` existente passa a incluir `socio`. Rotas do sócio: `@Roles('socio')` + `@RequirePermission`. Rotas de matriz e registros: `@Roles('admin')` apenas.
- `documents.service.ts` (mudanças não commitadas de outra frente) **não pode ser modificado**; a publicação insere em `documents` por SQL no novo módulo. Indexação RAG pós-publicação fora da v1.
- Auditoria (`AuditService`): só ids e nomes de campos, nunca título, nota ou texto livre; `path` sem query string.
- Migration `0096` (confirmar livre em todas as branches). Português do Brasil; rótulos VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/db/migrations/0096_documentos_fluxo.sql` (criar) | Tabelas, RLS, triggers, `documents` (CHECK e policies), CHECK de permissões |
| `backend/src/common/permissions.ts` (modificar) | + 3 permissões |
| `backend/src/atuacao/documentos/documento-fluxo.ts` (criar) | Estados, transições, ações, separação de funções, textos fixos |
| `backend/src/atuacao/documentos/documentos.service.ts`, `documentos.controller.ts`, `dto/*.ts` (criar) | Fluxo do sócio |
| `backend/src/atuacao/documentos/documentos-admin.controller.ts`, `documentos-admin.service.ts` (criar) | Matriz e registros (admin) |
| `backend/src/atuacao/atuacao.module.ts` (modificar) | Registrar |
| `backend/test/documento-fluxo.unit-spec.ts`, `documentos-service.unit-spec.ts`, `documentos-admin-service.unit-spec.ts` (criar) | Unit |
| `backend/test/atuacao-documentos.e2e-spec.ts` (criar) | E2E |

---

### Task 1: Migration 0096 — fluxo, matriz, registros e abertura mínima de `documents`

**Files:**
- Create: `backend/db/migrations/0096_documentos_fluxo.sql`
- Test: `backend/test/atuacao-documentos.e2e-spec.ts` (bloco banco)

- [ ] **Step 1: Confirmar 0096 livre** (comando das fases anteriores com `0096_`).

- [ ] **Step 2: E2E de banco que falha** (bootstrap de `atuacao-financeiro.e2e-spec.ts`: `comoSocio()`, dois sócios, tenant Montese, tenant de técnico; cada caso lê o dado pelo superusuário `db.client`):
```ts
it('socio cria rascunho em tenant Montese e lê; não em tenant de técnico; empresa/técnico/parceiro leem 0 linhas', async () => {});
it('versões, eventos e assinaturas são append-only: UPDATE/DELETE por socio, admin e montese_app falham e a linha fica intacta', async () => {});
it('socio não altera tenant_id/created_by do rascunho nem faz transição de status inválida (trigger); rascunho publicado/cancelado é imutável', async () => {});
it('matriz e registros: socio lê SÓ as próprias linhas e não escreve; admin escreve; registro nasce pendente e só admin confirma', async () => {});
it('assinatura exige registro confirmado do próprio signatário (policy/trigger) e grava hash de 64 hex', async () => {});
it('documents aceita uploaded_by_role socio; socio insere/lê documents só de tenant Montese; não atualiza nem apaga; empresa continua vendo só o próprio tenant', async () => {});
it('CHECK de socio_permissions aceita documents.read|approve|publish e rejeita valores fora da lista', async () => {});
```
Run → FAIL.

- [ ] **Step 3: Migration** (esqueleto obrigatório; ajustar nomes de colunas conforme o spec §3, mantendo estes contratos):
```sql
-- Painel de Atuação (Fase 5A). Rollback (descartável): DROP TABLE document_draft_signatures,
-- document_draft_events, document_draft_versions, document_drafts, document_type_permissions,
-- professional_registrations; restaurar CHECKs e policies de documents/socio_permissions.

CREATE TABLE professional_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  council TEXT NOT NULL CHECK (char_length(council) BETWEEN 2 AND 20),
  registration_number TEXT NOT NULL CHECK (char_length(registration_number) BETWEEN 1 AND 30),
  uf CHAR(2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','confirmado')),
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, council, registration_number, uf),
  CHECK ((status = 'confirmado') = (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);

CREATE TABLE document_type_permissions (
  category TEXT NOT NULL,                       -- mesmo domínio de documents.category (validado no service)
  user_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('elaborar','revisar','aprovar','assinar','publicar')),
  granted_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (category, user_id, action)
);

CREATE TABLE document_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'em_elaboracao'
    CHECK (status IN ('em_elaboracao','em_revisao','aprovado','assinado','publicado','cancelado')),
  current_version_id UUID,                      -- FK adicionada após a tabela de versões
  published_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE document_draft_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES document_drafts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_number INT NOT NULL CHECK (version_number >= 1),
  file_key TEXT NOT NULL, file_name TEXT NOT NULL, mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  note TEXT, created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draft_id, version_number)
);
ALTER TABLE document_drafts ADD FOREIGN KEY (current_version_id) REFERENCES document_draft_versions(id);
CREATE TABLE document_draft_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES document_drafts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_id UUID REFERENCES document_draft_versions(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('created','version_added','submitted','returned','approved','signed','published','cancelled')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE document_draft_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES document_drafts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES document_draft_versions(id),
  signer_user_id UUID NOT NULL REFERENCES users(id),
  registration_id UUID NOT NULL REFERENCES professional_registrations(id),
  council TEXT NOT NULL, registration_number TEXT NOT NULL, uf CHAR(2) NOT NULL,   -- snapshot
  version_sha256 TEXT NOT NULL CHECK (version_sha256 ~ '^[0-9a-f]{64}$'),
  ip TEXT CHECK (ip IS NULL OR length(ip) <= 64),
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS: ENABLE + FORCE nas 6 tabelas.
--  * drafts: socio SELECT/INSERT(created_by = app.user_id)/UPDATE na carteira Montese (is_montese_tenant); admin SELECT; sem DELETE.
--  * versions/events/signatures: socio e admin SOMENTE SELECT/INSERT (INSERT do socio com autor = app.user_id e is_montese_tenant); nenhum UPDATE/DELETE.
--  * signatures INSERT: exige que (registration_id, signer_user_id) seja um registro 'confirmado' do próprio signatário (EXISTS na policy).
--  * document_type_permissions e professional_registrations: admin ALL; socio SELECT apenas das próprias linhas (user_id = app.user_id).
-- Triggers (plpgsql comum, nomes 'trg_a_guard_*'): em document_drafts bloqueiam mudança de tenant_id/created_by/category,
--  impõem a tabela de transições (em_elaboracao→em_revisao|cancelado; em_revisao→aprovado|em_elaboracao|cancelado;
--  aprovado→assinado|em_elaboracao|cancelado; assinado→publicado|em_elaboracao|cancelado) e tornam publicado/cancelado imutáveis;
--  em professional_registrations só permitem pendente→confirmado (nunca o contrário) e imutabilidade de user_id/council/number/uf.
-- documents: ALTER CHECK uploaded_by_role para ('empresa','tecnico','parceiro','socio');
--   policies documents_socio_select (SELECT) e documents_socio_insert (INSERT, uploaded_by_user_id = app.user_id) com is_montese_tenant(tenant_id).
-- socio_permissions: recriar o CHECK incluindo 'documents.read','documents.approve','documents.publish'.
```
Escreva o SQL completo das policies/triggers seguindo os padrões das migrations 0092–0095 (SELECT/INSERT/UPDATE separados, `WITH CHECK`, `is_montese_tenant()`, sem `SECURITY DEFINER` novo). Observação: a política de INSERT de assinatura usa `EXISTS` sobre `professional_registrations` — como o `socio` só lê as próprias linhas, a subconsulta é válida para o signatário.

- [ ] **Step 4: Aplicar só no descartável** (`docker exec -i socio_ensaio_pg psql -U ensaio_su -d montese_ensaio -v ON_ERROR_STOP=1 --single-transaction -q -f - < backend/db/migrations/0096_documentos_fluxo.sql`) e rodar o Step 2 → PASS. Provar também que 0001–0096 aplicam num banco novo (banco temporário no mesmo container, removido depois; extensões vector, pg_trgm, unaccent, pgcrypto) ou registrar NÃO VERIFICADO.
- [ ] **Step 5: Checkpoint** — listar arquivos.

---

### Task 2: Regras do fluxo (função pura)

**Files:**
- Create: `backend/src/atuacao/documentos/documento-fluxo.ts`, `backend/test/documento-fluxo.unit-spec.ts`
- Modify: `backend/src/common/permissions.ts` (+ `documents.read`, `documents.approve`, `documents.publish`)

**Interfaces (Produces):**
- `DOC_STATUS`, `type DocStatus`; `DOC_ACOES = ['elaborar','revisar','aprovar','assinar','publicar']`; `AVISO_ASSINATURA_INTERNA`; `MSG_ACAO_NAO_HABILITADA`.
- `transicaoDocPermitida(de, para): boolean` (tabela do spec §4).
- `avaliarAcao(input: { acao; draftStatus; versaoAutorId; usuarioId; temPermissaoMatriz: boolean; registroConfirmado?: boolean }): { ok: true } | { ok: false; codigo: 'MATRIZ'|'ESTADO'|'SEPARACAO'|'REGISTRO'; mensagem: string }` — ordem de avaliação: estado → matriz → separação de funções (revisar/aprovar... **apenas `revisar`**: autor da versão atual não revisa a própria versão) → registro confirmado (só `assinar`).
- `estadoAposNovaVersao(status): DocStatus` (volta a `em_elaboracao` exceto `publicado`/`cancelado`, que rejeitam nova versão).

- [ ] **Step 1: Testes que falham.** Tabela completa de transições (válidas e inválidas, inclusive mesmo estado e saída de terminais); cada ação em cada estado; matriz ausente ⇒ `MATRIZ`; autor tentando `revisar` a própria versão ⇒ `SEPARACAO`; autor pode `aprovar`/`assinar` se a matriz permitir; `assinar` sem registro confirmado ⇒ `REGISTRO`; nova versão em `aprovado`/`assinado`/`em_revisao` ⇒ `em_elaboracao`; em `publicado`/`cancelado` ⇒ rejeita; **teste de texto:** `AVISO_ASSINATURA_INTERNA` contém "não é certificado digital ICP-Brasil" e nenhum outro texto exportado do módulo contém "assinatura digital" ou "ICP-Brasil".
- [ ] **Step 2: Implementar** e rodar `documento-fluxo socio-controller-sweep` + `tsc`.
- [ ] **Step 3: Checkpoint** — listar arquivos.

---

### Task 3: Serviço e rotas do fluxo (sócio)

**Files:**
- Create: `backend/src/atuacao/documentos/documentos.service.ts`, `documentos.controller.ts`, `dto/documentos.dto.ts`
- Modify: `backend/src/atuacao/atuacao.module.ts`
- Test: `backend/test/documentos-service.unit-spec.ts`; ampliar `atuacao-documentos.e2e-spec.ts`

**Interfaces (HTTP, `@Controller('atuacao/documentos')`, `@Roles('socio')`; cada rota com `@RequirePermission`):**
- `GET ''` (`documents.read`; filtros `status`, `tenantId`, `category`; máx. 200) e `GET ':id'` (`documents.read`) → detalhe com `versoes`, `eventos`, `assinaturas`, `acoes_permitidas` (calculadas para o usuário pela mesma função pura) e `aviso_assinatura` quando houver assinatura.
- `POST ''` (`documents.create_draft`) `{ tenant_id, category, title, company_unit_id? }` — exige entrada `elaborar` na matriz para a categoria (senão 403 `MSG_ACAO_NAO_HABILITADA`); `category` deve estar entre as categorias de `documents`.
- `POST ':id/versoes'` (`documents.create_draft`; multipart `file` ≤ 10 MB, tipos e conteúdo validados como em `documents`; `note?`) — permissão `elaborar`; calcula SHA-256 no servidor; `R2Service.putObject` com chave `documents-fluxo/{tenantId}/{draftId}/{versao}-{uuid}`; aplica `estadoAposNovaVersao`; evento `version_added`.
- `POST ':id/enviar-revisao'` (`documents.create_draft`), `POST ':id/devolver'` (`documents.review`; `note` obrigatória), `POST ':id/aprovar'` (`documents.approve`), `POST ':id/assinar'` (`documents.sign`), `POST ':id/publicar'` (`documents.publish`; `expires_at?` data real), `POST ':id/cancelar'` (`documents.create_draft`; `note` obrigatória), `GET ':id/versoes/:versionId/download'` (`documents.read`) → URL temporária do R2 sob RLS.
- Toda transição: `SELECT ... FOR UPDATE` no rascunho, `avaliarAcao` (matriz + separação + registro), atualização de `status`, evento, auditoria `document_draft.<acao>` (ids e nomes apenas). `assinar`: grava `document_draft_signatures` com **snapshot do registro confirmado**, `version_sha256`, IP e user-agent. `publicar`: insere em `documents` (`category`, `title`, `file_key` da versão assinada, `file_name`, `mime_type`, `size_bytes`, `expires_at`, `uploaded_by_user_id`, `uploaded_by_role='socio'`, `company_unit_id`), grava `published_document_id`, evento `published`. Não toca em `documents.service.ts`.
- Mensagens de negação: `MSG_ACAO_NAO_HABILITADA` (403) para matriz; 409 para estado/separação; 403 para registro não confirmado ("Registro profissional não confirmado.").

- [ ] **Step 1: Testes que falham.** Unit (client `pg` e `R2Service` mockados): cada rota/ação ⇒ ordem das verificações; matriz vazia ⇒ nenhuma ação passa e nada é gravado; SHA-256 correto do buffer; autor não revisa a própria versão; nova versão invalida aprovação/assinatura (estado volta, assinaturas antigas permanecem); publicar só em `assinado`; `cancelar` exige nota. E2E (runner, R2 mockado, dois sócios com permissões RBAC e matriz semeadas via `db.client` **para a categoria de teste**; registros `TESTE/0000` confirmados): fluxo feliz completo A elabora → B revisa/aprova → B assina (com registro confirmado) → B publica, afirmando no banco cada estado, evento, hash, snapshot e a linha criada em `documents` (visível ao tenant e a mais ninguém); matriz vazia ⇒ 403 em todas as ações restritas e nada muda; registro pendente ⇒ assinar 403; autor revisando a própria versão ⇒ 409; nova versão após aprovação ⇒ `em_elaboracao` e a assinatura antiga não vale (publicar 409); tenant de técnico ⇒ 404; empresa/técnico/parceiro/admin ⇒ 403 nas rotas do sócio; arquivo com tipo/conteúdo inválido ⇒ 400; `created_by`/`tenant_id` no corpo de transições ⇒ 400; resposta de detalhe traz `aviso_assinatura` exatamente igual à constante; auditoria `document_draft.*` sem título/nota; download de versão sob RLS (tenant errado ⇒ 404).
- [ ] **Step 2: Implementar** (padrões de `tarefas.*`/`agenda.*`; `req.withTenantContext`; upload multipart como em `documents.controller.ts`; `FOR UPDATE`; nomes de usuários via `list_socios()`).
- [ ] **Step 3: Rodar** unit (`documento-fluxo documentos-service socio-controller-sweep tenant-context-callsites atuacao-service`), `tsc`, e2e `atuacao-documentos` e regressão (`atuacao-carteira socio-access-matrix`, e o e2e de upload de documentos existente se rodar sem R2 real — senão registrar), `npm run build`.
- [ ] **Step 4: Checkpoint** — listar arquivos.

---

### Task 4: Matriz e registros profissionais (admin)

**Files:**
- Create: `backend/src/atuacao/documentos/documentos-admin.service.ts`, `documentos-admin.controller.ts`, `dto/documentos-admin.dto.ts`
- Modify: `backend/src/atuacao/atuacao.module.ts`
- Test: `backend/test/documentos-admin-service.unit-spec.ts`; ampliar `atuacao-documentos.e2e-spec.ts`

**Interfaces (`@Controller('atuacao/admin/documentos')`, `@Roles('admin')`):**
- `GET matriz?category=` → `{ category, user_id, nome, acoes: string[] }[]`; `PUT matriz/:category/usuarios/:userId` body `{ acoes: ('elaborar'|'revisar'|'aprovar'|'assinar'|'publicar')[] }` (substitui o conjunto do par; vazio remove tudo); `category` ∈ categorias de `documents`; `userId` deve estar em `list_socios()`; 0..5 ações sem repetição.
- `GET registros?userId=`; `POST registros` body `{ user_id, council, registration_number, uf }` (nasce `pendente`; `user_id` é sócio ativo); `POST registros/:id/confirmar` (grava `confirmed_by` = admin do JWT; só `pendente → confirmado`).
- Auditoria `document_matrix.changed` (categoria, usuário, ações como nomes) e `professional_registration.created|confirmed` (ids; **sem** número do registro).
- O admin **não** recebe rotas para elaborar/revisar/aprovar/assinar/publicar.

- [ ] **Step 1: Testes que falham** (unit + e2e): PUT substitui o conjunto e é idempotente; usuário que não é sócio ⇒ 400; categoria inválida ⇒ 400; ações repetidas ou fora da lista ⇒ 400; matriz resultante é exatamente a lida do banco; `socio`/`empresa`/`tecnico` ⇒ 403 em todas as rotas; registro nasce `pendente` e só vira `confirmado` pela rota do admin; confirmar duas vezes ⇒ 409; tentativa de apagar/alterar registro confirmado (SQL direto) falha pelo trigger; admin chamando qualquer rota do fluxo do sócio ⇒ 403; auditoria sem o número do registro.
- [ ] **Step 2: Implementar.** **Step 3: Rodar** unit, `tsc`, e2e `atuacao-documentos`, regressão, `npm run build`. **Step 4: Checkpoint.**

---

### Task 5: Verificação final da Fase 5A

- [ ] **Step 1:** unit completo (esperado: só `r2-get-object` falhando, pré-existente), `tsc`, `npm run build`.
- [ ] **Step 2:** e2e, **uma suíte por vez com `reset-redis.sh` antes**: `atuacao-documentos atuacao-financeiro atuacao-agenda atuacao-tarefas atuacao-carteira socio-access-matrix subscription-status-guard tenant-isolation-sweep admin-dashboard-financeiro auth`.
- [ ] **Step 3:** bloco "Fase 5A — evidências" em `docs/superpowers/audits/2026-10-19-painel-atuacao-fase0.md` e atualização da memória `project_painel_atuacao_socios.md`.
- [ ] **Step 4:** parar para o proprietário: commit; aplicação das migrations `0090–0096` em produção (backup + autorização; `montese_auth_bypass`); **preenchimento da matriz** e **cadastro/confirmação dos registros profissionais** (dados fornecidos e conferidos por você); concessão das permissões RBAC (`documents.*`); decisão sobre a Fase 5B (telas).

---

## Auto-revisão contra a spec e as decisões

- **Decisão 1 (assinatura interna):** versão exata + hash + usuário + data/hora + histórico; aviso fixo exportado e testado; termos proibidos — Tasks 1–3.
- **Decisão 2 (matriz vazia, bloqueio, profissão não libera):** matriz sem seed; negação inclusive ao admin; teste do fluxo com matriz vazia — Tasks 1–4.
- **Decisão 3 (registros):** nenhum dado profissional no código/seed/teste real; só `confirmado` assina; confirmação só pelo admin; snapshot na assinatura — Tasks 1, 3, 4.
- **Decisão 4 (sem segunda linhagem):** publicação grava em `documents` com a mesma chave do R2; sem alterar `documents.service.ts`; a ata da CIPA, a inspeção e o EPI ficam como estão.
- **Decisão 5:** geração automática fora da v1.
- **Riscos declarados:** (1) a alteração do CHECK de `documents.uploaded_by_role` e as policies novas em `documents` podem conflitar no merge com as linhagens de validade/relatório de visita — mitigação: mudança mínima e isolada; (2) indexação RAG após publicar não ocorre (pendência); (3) separação de funções só para `revisar` — confirmar com o proprietário se também deve valer para `aprovar`/`assinar`; (4) registros fictícios `TESTE/0000` só em testes e banco descartável.
