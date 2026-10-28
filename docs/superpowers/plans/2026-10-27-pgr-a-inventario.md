# PGR — Sub-projeto A (biblioteca de perigos, GHE e inventário de riscos) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Danilo e Évelyn montam, em `/atuacao/pgr`, o inventário de riscos de um cliente Montese: biblioteca de perigos, GHEs ligados aos cargos existentes, riscos copiados da biblioteca, controles e medições, com completude e pendências por empresa.

**Architecture:** Seis tabelas novas (`pgr_*`) com RLS por papel `socio`/`admin` e `is_montese_tenant()`; a biblioteca global só o admin escreve. Backend em `backend/src/atuacao/pgr/**` com os padrões de `atuacao/empresas` (Roles('socio'), `@RequirePermission`, `req.withTenantContext`, auditoria na mesma transação). Frontend em `frontend/src/app/atuacao/pgr/**`. O perigo é COPIADO para o risco (editar a biblioteca não altera riscos existentes).

**Tech Stack:** NestJS + TypeScript, PostgreSQL (`pg`), Jest; Next.js/React/Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-pgr-subprojeto-a-design.md` (pré-requisito implementado: Z, migration 0097, permissões `empresas.read`).

## Global Constraints
- Base: worktree `/opt/montese-work/painel-release`; o sub-projeto Z precisa estar presente (migration 0097 aplicada no banco de ensaio). **Sem commit/push/reset/deploy** sem ordem expressa do proprietário; nada em produção; não ler `.env`/`ensaio.env`/`hom.env`; **proibido** `/opt/Montese/run-backend-tests.sh`; nunca passar senhas a subagentes; não tocar em `/opt/Montese`.
- Migrations a partir de **0098** (confirmar com `ls backend/db/migrations | tail`), aditivas, cabeçalho com SQL de rollback.
- A **biblioteca nasce vazia**: nenhum perigo, código da Tabela 24 ou limite de tolerância é inventado em seed/código/teste de produção; testes usam nomes `TESTE ...`.
- Código da Tabela 24 é texto opcional (tabela oficial é do sub-projeto D). Nenhum cálculo automático de nível de ação/limite.
- Escrita do sócio só nas tabelas `pgr_*` (e nada nos cadastros do cliente). Escrita na biblioteca **global**: só `admin`. Perigos `tenant` (personalizados): sócio com `pgr.write`, só em cliente Montese.
- Permissões novas na lista fechada: `pgr.read`, `pgr.write` (não sensíveis). O catálogo da tela `/admin/permissoes-socios` ganha o grupo "PGR" e a descrição de `pgr.read` diz: "Requer também 'Ver clientes' (clients.read) e 'Atender empresas clientes' (empresas.read)".
- Auditoria (`AuditService`/INSERT em `audit_log` na MESMA transação, `path = req.path`): `pgr.hazard.*`, `pgr.ghe.*`, `pgr.risk.*`; `detail` só com ids e nomes de campo, nunca texto livre nem dados de trabalhador.
- `tenant_id` do frontend nunca amplia o escopo: validar com a RLS/`exigirEmpresa` e conferir `tenant_id` da linha; empresa que não é cliente Montese ⇒ 404.
- Testes: backend na worktree — `cd /opt/montese-work/painel-release/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão>`; `npx tsc --noEmit -p tsconfig.json`. E2E SOMENTE: `H=/tmp/claude-0/-opt-Montese/bac8b5c8-7575-4e72-a1f2-42d204d1d1d3/scratchpad; $H/reset-redis.sh >/dev/null && $H/run-e2e-cand.sh <padrão> > $H/<log> 2>&1`, uma suíte por vez; migrations novas são aplicadas ao banco `montese_prodschema` (`docker exec -i socio_ensaio_pg psql -U ensaio_su -d montese_prodschema -v ON_ERROR_STOP=1`, em transação, `INSERT INTO _migrations(name)`). Frontend SOMENTE via `$H/sync-f7-front.sh <comando>`.
- Português do Brasil; rótulos VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO; sem "assinatura digital"/"ICP-Brasil".
- Fora de escopo: fotos/anexos, matriz de risco, plano de ação, emissão/PDF/versões, Tabela 24, S-2240, PCMSO, assinatura (sub-projetos B–E).

## Estrutura de arquivos
| Arquivo | Responsabilidade |
|---|---|
| `backend/db/migrations/0098_pgr_inventario.sql` | tabelas, RLS, CHECK de permissões ampliado |
| `backend/src/common/permissions.ts`, `backend/src/atuacao/permissoes/permissoes-catalogo.ts` | `pgr.read`, `pgr.write` |
| `backend/src/atuacao/pgr/perigos.{controller,service}.ts`, `dto/perigo.dto.ts` | biblioteca |
| `backend/src/atuacao/pgr/ghes.{controller,service}.ts`, `dto/ghe.dto.ts` | GHEs, cargos, expostos |
| `backend/src/atuacao/pgr/riscos.{controller,service}.ts`, `dto/risco.dto.ts` | riscos, controles, medições |
| `backend/src/atuacao/pgr/pgr-painel.service.ts` (+ rota no `ghes.controller`) | completude e pendências |
| `backend/src/atuacao/atuacao.module.ts` | registro |
| `frontend/src/app/atuacao/pgr/**`, `api.ts`, `lib/dashboard/menu-atuacao.ts` | telas e menu |
| testes `backend/test/pgr-*.{unit,e2e}-spec.ts`, `frontend/src/app/atuacao/__tests__/pgr-*.test.tsx` | cobertura |

---

### Task 1: Migration 0098 e RLS
**Files:** Create `backend/db/migrations/0098_pgr_inventario.sql`, `backend/test/pgr-rls.e2e-spec.ts`.
**Produces:** tabelas `pgr_hazards`, `pgr_ghes`, `pgr_ghe_positions`, `pgr_risks`, `pgr_risk_controls`, `pgr_risk_measurements`; CHECK de `socio_permissions` com 18 valores.
- [ ] **Step 1: e2e de RLS que falha** (padrão `atuacao-empresas-rls.e2e-spec.ts`, `comoSocio` com `ROLLBACK`): socio lê perigo global; socio **não** insere/atualiza/apaga perigo `global` (0 linhas/erro); socio insere perigo `tenant` só em cliente Montese e não em tenant de parceiro; socio CRUD em `pgr_ghes/pgr_risks/...` só de cliente Montese e nunca de parceiro; empresa/técnico/parceiro não leem nada; `scope='tenant'` exige `tenant_id`, `scope='global'` exige `tenant_id` nulo (CHECK); `pgr_ghe_positions` não aceita cargo de outro tenant (trigger ou FK composta — escolher e testar); CHECK de permissões aceita `pgr.read`/`pgr.write`; perigo `tenant` de A não aparece para consulta no contexto de outro tenant.
- [ ] **Step 2: ver FALHAR** (migration ausente).
- [ ] **Step 3: migration.** Cabeçalho com rollback. Núcleo (completar índices, triggers `set_updated_at` e demais colunas conforme a spec §4):
```sql
ALTER TABLE socio_permissions DROP CONSTRAINT IF EXISTS socio_permissions_permission_check;
ALTER TABLE socio_permissions ADD CONSTRAINT socio_permissions_permission_check CHECK (permission IN (
  'clients.read','clients.update_operational','tasks.read','tasks.write','appointments.manage',
  'documents.create_draft','documents.review','documents.sign','documents.read','documents.approve',
  'documents.publish','documents.cancel','documents.view_registration','finance.read',
  'empresas.read','empresas.documentos','pgr.read','pgr.write'));

CREATE TABLE pgr_hazards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('global','tenant')),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('fisico','quimico','biologico','ergonomico','acidente','psicossocial')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description TEXT, sources TEXT, health_effects TEXT,
  exposure_routes TEXT[] NOT NULL DEFAULT '{}',
  default_assessment TEXT CHECK (default_assessment IN ('qualitativa','quantitativa')),
  default_unit TEXT, tolerance_limit TEXT, tolerance_reference TEXT, suggested_controls TEXT,
  esocial_code TEXT CHECK (esocial_code IS NULL OR length(esocial_code) <= 20),
  psychosocial JSONB, active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((scope = 'global' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL))
);
CREATE UNIQUE INDEX pgr_hazards_unique_name ON pgr_hazards
  (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), category, lower(name));
ALTER TABLE pgr_hazards ENABLE ROW LEVEL SECURITY; ALTER TABLE pgr_hazards FORCE ROW LEVEL SECURITY;
CREATE POLICY pgr_hazards_admin ON pgr_hazards USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY pgr_hazards_socio_select ON pgr_hazards FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND (scope = 'global' OR is_montese_tenant(tenant_id)));
CREATE POLICY pgr_hazards_socio_write ON pgr_hazards FOR ALL
  USING (current_setting('app.role', true) = 'socio' AND scope = 'tenant' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND scope = 'tenant' AND is_montese_tenant(tenant_id));
```
As cinco tabelas por empresa (`pgr_ghes`, `pgr_ghe_positions`, `pgr_risks`, `pgr_risk_controls`, `pgr_risk_measurements`) seguem o mesmo molde: `tenant_id NOT NULL REFERENCES tenants ON DELETE CASCADE`, FORCE RLS, uma policy `*_admin` (leitura/escrita admin) e uma `*_socio FOR ALL` com `current_setting('app.role', true)='socio' AND is_montese_tenant(tenant_id)` em USING e WITH CHECK. Colunas conforme a spec §4 (GHE: `company_unit_id` opcional → `company_units`, `name`, `environment_description`, `process_description`, `activities`, `machines_products`, `notes`; risco: `ghe_id`, `hazard_id` `ON DELETE SET NULL`, cópia dos campos do perigo, `activity`, `exposure_type` CHECK (`habitual_permanente`,`intermitente`,`eventual`), `esocial_code`, `assessment_type`, `assessment_notes`; controle: `kind` CHECK (`epc`,`epi`,`administrativa`,`treinamento`), `description`, `status` CHECK (`existente`,`planejado`,`nao_implementado`), `effectiveness` CHECK (`eficaz`,`ineficaz`,`nao_avaliada`), `epi_catalog_item_id` → `epi_catalog_items`, `training_tipo` com o mesmo CHECK de `position_training_requirements.tipo`; medição: agente, valor, unidade, limite, referência, metodologia, equipamento, nº de série, datas, `responsible_name`, `professional_registration_id` → `professional_registrations` opcional). Garantir coerência de tenant entre filhos e pais (trigger `BEFORE INSERT/UPDATE` que compara `tenant_id` da linha com o do pai) e testá-la.
- [ ] **Step 4: aplicar no banco de ensaio e rodar** `pgr-rls` ⇒ PASS; regressão uma a uma: `atuacao-empresas-rls socio-access-matrix`. Sem commit.

### Task 2: Permissões `pgr.read` e `pgr.write`
**Files:** Modify `backend/src/common/permissions.ts`, `backend/src/atuacao/permissoes/permissoes-catalogo.ts`, `backend/test/documento-fluxo.unit-spec.ts` (o teste do CHECK passa a ler a **0098**, que redefine a lista), `backend/test/permissoes-admin-service.unit-spec.ts`, `backend/test/atuacao-permissoes.e2e-spec.ts` (grupos 5 → 6).
- [ ] **Step 1:** ajustar/estender os testes (16 → 18 permissões, grupo `pgr`, nenhuma sensível) ⇒ FAIL. **Step 2:** implementar (grupo `{ id: 'pgr', titulo: 'PGR — Programa de Gerenciamento de Riscos', itens: [i('pgr.read','Consultar o PGR','Biblioteca, GHEs e inventário de riscos das empresas clientes. Requer também \'Ver clientes\' (clients.read) e \'Atender empresas clientes\' (empresas.read).'), i('pgr.write','Elaborar o PGR','Criar e editar GHEs, riscos, controles e medições, e perigos personalizados. Só tem efeito junto com \'Consultar o PGR\' (pgr.read).')] }`). **Step 3:** unit `permissoes-admin-service documento-fluxo permissions-guard socio-controller-sweep` + `tsc` + e2e `atuacao-permissoes` ⇒ PASS.

### Task 3: Biblioteca de perigos (API)
**Files:** Create `backend/src/atuacao/pgr/perigos.controller.ts`, `perigos.service.ts`, `dto/perigo.dto.ts`; tests `backend/test/pgr-perigos.e2e-spec.ts`, `backend/test/pgr-perigos-service.unit-spec.ts`.
**Produces (HTTP, `@Controller('atuacao/pgr/perigos')`, `@Roles('socio','admin')`):** `GET ?q=&categoria=&ativo=&tenantId=` (`pgr.read` para sócio) → `{ id, scope, category, name, description, esocial_code, default_assessment, active }[]` (LIMIT 200, sem texto longo); `GET :id` (completo); `POST` `{tenant_id?, category, name, ...}` (`pgr.write`; sócio só `scope:'tenant'` com `tenant_id` Montese; admin pode `global`); `PATCH :id`; `POST :id/duplicar`; `PATCH :id/ativo` `{active}`; `GET exportar` (JSON); `POST importar` (admin, até 500 itens, validação linha a linha com relatório de erros, tudo-ou-nada em uma transação).
- [ ] **Step 1: testes (falham):** sócio sem `pgr.read` ⇒ 403; com `pgr.read` lê global e `tenant` do cliente Montese, não de parceiro; sócio `POST` global ⇒ 403/400 e nada gravado; admin cria global; nome duplicado na mesma categoria/escopo ⇒ 409; `esocial_code` > 20 ⇒ 400; categoria fora da lista ⇒ 400; duplicar cria cópia `tenant`/`global` conforme o chamador; inativar não apaga; importar com 1 linha inválida ⇒ nada gravado e relatório lista a linha; auditoria na mesma transação sem texto livre; biblioteca vazia ⇒ lista `[]`.
- [ ] **Steps 2–4:** ver falhar → implementar (padrão de `empresas.controller.ts` + auditoria transacional de `permissoes-admin.service.ts`) → rodar unit, tsc, e2e `pgr-perigos` e regressão `pgr-rls socio-access-matrix` ⇒ PASS. Sem commit.

### Task 4: GHEs, cargos e trabalhadores expostos (API)
**Files:** Create `backend/src/atuacao/pgr/ghes.controller.ts`, `ghes.service.ts`, `dto/ghe.dto.ts`; tests `backend/test/pgr-ghes.e2e-spec.ts`, `backend/test/pgr-ghes-service.unit-spec.ts`.
**Produces (`@Controller('atuacao/pgr/empresas/:tenantId')`):** `GET ghes` → `{ id, name, company_unit_id, positions: {id,name}[], expostos: number, riscos: number }[]`; `POST ghes`, `PATCH ghes/:id`, `DELETE ghes/:id` (só se sem riscos ⇒ senão 409), `PUT ghes/:id/cargos` `{ position_ids: string[] }` (cargos do mesmo tenant, senão 400); `GET resumo` → `{ empresa, importados: {cnpj,cnae,grau_risco,endereco,unidades,cargos,funcionarios}: boolean-or-count, pendencias: string[], ghes: number, riscos: number, completude: number }` (somente leitura de dados existentes; **correção de cadastro continua em `/atuacao/clientes/[id]`**).
- Expostos: `SELECT count(*) FROM employees e WHERE e.tenant_id=$1 AND e.status='ativo' AND e.position_id IN (SELECT position_id FROM pgr_ghe_positions WHERE ghe_id=$2)` e, se o GHE tem unidade, `AND e.company_unit_id = ghe.company_unit_id`. Nunca copiar funcionário; nunca listar nome/CPF.
- [ ] **Step 1: testes (falham):** cálculo de expostos (ativos/inativos, cargo sem vínculo, unidade diferente); cargo de outro tenant ⇒ 400; empresa de parceiro ⇒ 404; DELETE com riscos ⇒ 409; `resumo` lista pendências (ex.: sem CNAE/grau de risco/unidades/cargos) sem inventar dados; auditoria sem nomes de trabalhador; permissões (`pgr.write` para escrever).
- [ ] **Steps 2–4:** falhar → implementar → rodar ⇒ PASS.

### Task 5: Riscos, controles e medições (API)
**Files:** Create `backend/src/atuacao/pgr/riscos.controller.ts`, `riscos.service.ts`, `dto/risco.dto.ts`; tests `backend/test/pgr-riscos.e2e-spec.ts`, `backend/test/pgr-riscos-service.unit-spec.ts`.
**Produces (`@Controller('atuacao/pgr/empresas/:tenantId')`):** `GET ghes/:gheId/riscos`; `POST ghes/:gheId/riscos` `{ hazard_ids: string[] }` (copia os campos de cada perigo ativo e visível; ignora duplicados já presentes no GHE com a lista de ignorados na resposta); `PATCH riscos/:id`; `DELETE riscos/:id`; `POST riscos/:id/controles`, `PATCH/DELETE controles/:id`; `POST riscos/:id/medicoes`, `PATCH/DELETE medicoes/:id`; `POST ghes/:gheId/copiar-riscos` `{ from_ghe_id }`.
- Regras: copiar perigo = **cópia de valores**; editar o perigo da biblioteca depois NÃO altera o risco; `esocial_code` opcional; medição só se `assessment_type='quantitativa'` (senão 400); `professional_registration_id`, se informado, deve ser do mesmo sócio/registro confirmado (senão 400); `epi_catalog_item_id` deve existir; `training_tipo` ∈ vocabulário.
- [ ] **Step 1: testes (falham):** imutabilidade da cópia (PATCH no perigo não muda `pgr_risks`); hazard inativo ou de outro tenant ⇒ 400/404; copiar riscos entre GHEs do mesmo tenant e ⇒ 400 entre tenants; medição em risco qualitativo ⇒ 400; tenant de URL ≠ tenant do GHE ⇒ 404 (IDOR entre dois clientes Montese, verificando o banco); corpo vazio em PATCH ⇒ 400; auditoria na mesma transação (teste com trigger de falha que mantém o estado); sem `pgr.write` ⇒ 403.
- [ ] **Steps 2–4:** falhar → implementar → rodar ⇒ PASS; regressão `pgr-rls pgr-perigos pgr-ghes`.

### Task 6: Frontend — Biblioteca de Perigos e visão geral do PGR
**Files:** Create `frontend/src/app/atuacao/pgr/page.tsx` (visão geral/seletor), `pgr/perigos/page.tsx`, componentes `pgr/Perigos*.tsx`, tipos em `api.ts`, item "PGR — Programa de Gerenciamento de Riscos" em `frontend/src/lib/dashboard/menu-atuacao.ts`, teste `frontend/src/app/atuacao/__tests__/pgr-perigos.test.tsx`.
- Comportamento: lista pesquisável com filtros (categoria, ativo, escopo) e paginação simples; formulário de criação/edição por categoria (campos psicossociais só quando a categoria é psicossocial); duplicar, inativar; sócio vê "global" como somente leitura; estado vazio explícito "A biblioteca ainda não tem perigos. A carga inicial é fornecida pela equipe técnica."; 403 ⇒ mensagem específica sobre `pgr.read`; `role="alert"/"status"`, botões desabilitados em voo, sem corrida, 401 ⇒ `/login`; sem "assinatura digital"/"ICP-Brasil". Padrões: `src/app/atuacao/empresas/**` (ler primeiro).
- [ ] **Step 1: testes Vitest (falham)** ⇒ **Step 2:** implementar ⇒ **Step 3:** `$H/sync-f7-front.sh npx vitest run src/app/atuacao`, `npx tsc --noEmit`, `npx eslint --max-warnings 0 src/app/atuacao src/lib/dashboard`, `npm run build` ⇒ PASS.

### Task 7: Frontend — fluxo guiado (Empresa → Responsáveis → Ambientes → Riscos) e inventário
**Files:** Create `frontend/src/app/atuacao/pgr/empresas/[tenantId]/page.tsx` e componentes `Etapas.tsx`, `Ambientes.tsx`, `Riscos.tsx`, `ResumoEmpresa.tsx`; teste `frontend/src/app/atuacao/__tests__/pgr-fluxo.test.tsx`.
- Comportamento: barra de etapas com indicador de progresso e pendências (do `GET resumo`); **Empresa:** mostra o que foi importado e o que falta, com link para `/atuacao/clientes/[id]` para corrigir; **Responsáveis:** lista os sócios e seus registros profissionais **confirmados** (via API existente `GET /atuacao/documentos/...` somente se já exposta ao sócio; senão mostra "registro não cadastrado" — nunca inventar); representante da empresa em campo livre; **Ambientes:** CRUD de GHE, vínculo de cargos, expostos calculados; **Riscos:** selecionar vários perigos da biblioteca, editar a cópia, controles (EPI do catálogo existente, treinamento pelo vocabulário), medições quando quantitativo; cada etapa salva e pode ser retomada. Matriz, plano, emissão: cartões "em breve".
- [ ] **Steps 1–3:** testes (navegação entre etapas, salvar parcial, campos de medição só quando quantitativo, mensagens de erro do servidor, expostos exibidos sem nomes, empresa 404) ⇒ implementar ⇒ mesma sequência de verificação do Task 6 ⇒ PASS.

### Task 8: Verificação final, revisão de segurança e documentação
- [ ] Backend: unit completo (esperado: apenas as falhas pré-existentes `r2-get-object` e `tenant-context-callsites`; suítes lentas que estouram só sob carga devem ser re-rodadas isoladas), `tsc`, `npm run build`; e2e uma a uma com Redis zerado: `pgr-rls pgr-perigos pgr-ghes pgr-riscos atuacao-empresas-rls atuacao-empresas atuacao-permissoes atuacao-documentos socio-access-matrix tenant-isolation-sweep auth`; frontend completo (`vitest`, `tsc`, `eslint`, `build`).
- [ ] Varreduras: sem "assinatura digital"/"ICP-Brasil"; nenhum seed de perigo/limite; nenhuma coluna de CPF/nascimento nas respostas.
- [ ] Revisão independente: `montese-seguranca` (somente leitura) sobre `0098`, controllers/services e testes; corrigir achados numa única rodada com re-revisão restrita.
- [ ] Documentação: relatório `docs/superpowers/audits/<data>-pgr-a-inventario.md`, roteiro de release (backup → aplicar 0098 → trocar código → verificar) e memória do projeto. **Parar**: commit e liberação são do proprietário.

## Auto-revisão
- **Spec:** biblioteca (Task 3, 6), GHE/expostos/cargos (Task 4, 7), inventário/controles/medições (Task 5, 7), permissões (Task 2), RLS e coerência de tenant (Task 1), auditoria transacional (Tasks 3–5), fluxo guiado/rascunho/pendências (Task 4 `resumo`, Task 7). Fotos/anexos adiados (declarado). Responsáveis dependem de API de registros já exposta ao sócio; se não houver, a etapa mostra o estado "não cadastrado" (sem invenção).
- **Riscos:** (1) a biblioteca vazia deixa o módulo sem uso até a equipe técnica fornecer a carga; (2) as policies `FOR ALL` do sócio dependem de `PermissionsGuard` para separar leitura de escrita (padrão do projeto); (3) coerência de tenant entre pai e filho por trigger precisa de teste de regressão; (4) QA visual NÃO VERIFICADO.
