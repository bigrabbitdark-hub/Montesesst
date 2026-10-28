# Atuação por empresa (sub-projeto Z) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Danilo e Évelyn (papel `socio`) escolhem um cliente Montese na tela deles e, dentro dele, consultam visão geral, documentos, vencimentos, funcionários e EPI, e ajustam a vigência (vencimento) dos documentos, sem poder de escrita sobre os demais cadastros.

**Architecture:** Policies RLS **só de leitura** para `socio` nas tabelas da empresa, reutilizando `is_montese_tenant()` (já existe, dono `montese_auth_bypass`), mais **uma** policy de UPDATE em `documents` protegida por trigger que só deixa passar colunas de vigência. Rotas novas `/atuacao/empresas/:tenantId/*` num controller próprio reutilizam `DocumentsService`; o seletor de empresa reutiliza o `GET /atuacao/clientes` já existente. Duas permissões novas (`empresas.read`, `empresas.documentos`) concedidas pela tela `/admin/permissoes-socios`.

**Tech Stack:** NestJS 10 + TypeScript, PostgreSQL (`pg`), Jest (unit/e2e), Next.js/React/Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-pgr-subprojeto-z-atuacao-por-empresa-design.md` (e `...-pgr-subprojeto-a-design.md` §12).

## Global Constraints
- Base: worktree `/opt/montese-work/painel-release` (linhagem de produção). **Sem commit/push/reset/deploy** sem ordem expressa do proprietário. Nada em produção. Não ler `.env`/`ensaio.env`/`hom.env`; **proibido** `/opt/Montese/run-backend-tests.sh`. Nunca passar senhas a subagentes. Não tocar em `/opt/Montese` nem em outras linhagens.
- Migrations: número livre **a partir de 0097** (confirmar com `ls backend/db/migrations | tail`); aditivas; cabeçalho com SQL de rollback; aplicar por arquivo, em transação, com `SET LOCAL ROLE montese_app` quando aplicada à mão.
- Banco: `socio` **nunca** ganha INSERT/DELETE nem UPDATE em `employees`, `positions`, EPI, `tenants` (além dos 6 campos já existentes) nem em dados fiscais/pagamento. Em `documents`: **somente** SELECT (já existe, 0096) e UPDATE restrito a colunas de vigência. Sem DELETE.
- `tenant_id` vindo do frontend **nunca amplia o escopo**: a RLS e a verificação no servidor decidem. Empresa que não é cliente Montese ⇒ 404 (sem vazar existência).
- Funcionários: projeção **sem CPF e sem data de nascimento**. Documentos da categoria `cadastro_funcionarios` seguem ocultos ao sócio (policy RESTRICTIVE `documents_hide_employee_registry`, 0083, que só libera `empresa` e `admin`): **não alterar**.
- Auditoria (`AuditService.log`, `path` = `req.path`): `company.accessed` (detail: módulo) e `company.documents.changed` (detail: id do documento e nomes dos campos); sem texto livre e sem dados pessoais de trabalhador.
- Funções SECURITY DEFINER pertencem a `montese_auth_bypass`; testar `pg_proc.proowner` + `rolbypassrls` quando criar alguma (este plano não cria nenhuma).
- Testes: backend na worktree — unit `cd /opt/montese-work/painel-release/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão>`; `npx tsc --noEmit -p tsconfig.json`. E2E **somente** `H=/tmp/claude-0/-opt-Montese/bac8b5c8-7575-4e72-a1f2-42d204d1d1d3/scratchpad; $H/reset-redis.sh >/dev/null && $H/run-e2e-cand.sh <padrão> > <log> 2>&1`, uma suíte por vez, **contra o banco descartável `montese_prodschema`** (precisa receber a migration nova antes: `SET LOCAL ROLE montese_app` + `psql` no container `socio_ensaio_pg`). Frontend: `$H/sync-f7-front.sh <comando>` (cópia limpa com `node_modules` próprio): `npx vitest run ...`, `npx tsc --noEmit`, `npx eslint --max-warnings 0 <arquivos>`, `npm run build`.
- Português do Brasil; rótulos VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO. Sem "assinatura digital"/"ICP-Brasil" em texto novo.
- Fora de escopo: upload de documento pelo sócio (continua só pelo fluxo de publicação), exclusão de documento, edição de funcionários, CIPA/inspeções/eSocial por empresa, empresas de parceiros, PGR (sub-projeto A).

## Estrutura de arquivos
| Arquivo | Responsabilidade |
|---|---|
| `backend/db/migrations/0097_socio_empresa_acesso.sql` (criar) | CHECK de permissões ampliado; policies SELECT/UPDATE do socio; trigger de guarda de vigência |
| `backend/src/common/permissions.ts` (modificar) | + `empresas.read`, `empresas.documentos` |
| `backend/src/atuacao/permissoes/permissoes-catalogo.ts` (modificar) | grupo "Atuação por empresa" |
| `backend/src/atuacao/empresas/empresas.service.ts` (criar) | consultas de leitura da empresa e projeções |
| `backend/src/atuacao/empresas/empresas.controller.ts` (criar) | rotas `/atuacao/empresas/:tenantId/*`, permissões, auditoria |
| `backend/src/atuacao/empresas/dto/vigencia.dto.ts` (criar) | DTO de vigência |
| `backend/src/atuacao/atuacao.module.ts` (modificar) | registrar controller/service e importar `DocumentsModule` |
| `backend/test/atuacao-empresas-rls.e2e-spec.ts`, `backend/test/atuacao-empresas.e2e-spec.ts`, `backend/test/empresas-service.unit-spec.ts` (criar) | testes |
| `frontend/src/app/atuacao/empresas/page.tsx`, `empresas/[tenantId]/page.tsx`, `empresas/[tenantId]/Secoes.tsx` (criar) | seletor e telas da empresa |
| `frontend/src/app/atuacao/api.ts` (modificar) | tipos da empresa |
| menu do `AtuacaoShell` (modificar; localizar com `grep -rn "atuacao/tarefas" frontend/src/components`) | item "Empresas" |
| `frontend/src/app/atuacao/__tests__/empresas.test.tsx` (criar) | Vitest |

---

### Task 1: Migration 0097 e RLS (banco)

**Files:** Create `backend/db/migrations/0097_socio_empresa_acesso.sql`, `backend/test/atuacao-empresas-rls.e2e-spec.ts`.

**Interfaces — Produces:** policies `employees_socio_select`, `positions_socio_select`, `tenant_epis_socio_select`, `employee_epi_deliveries_socio_select`, `documents_socio_update`; função `guard_documents_socio_update()` + trigger `trg_b_guard_documents_socio_update`; permissões `empresas.read`/`empresas.documentos` aceitas no CHECK.

- [ ] **Step 1: Escrever o e2e de RLS (falha)** — padrão de `atuacao-carteira.e2e-spec.ts` (`comoSocio` com `set_config`, sempre `ROLLBACK`, conexão `DATABASE_URL`). Casos:
```ts
// montese = tenant sem vínculo; parceiro = tenant com tenant_partners (use db.createTenantWithUser e db.insertRawRow como em atuacao-carteira)
it('socio lê employees/positions/tenant_epis/employee_epi_deliveries do cliente Montese', async () => {
  const n = await comoSocio(socio.id, async (c) => (await c.query('SELECT count(*)::int AS n FROM employees WHERE tenant_id = $1', [montese.tenantId])).rows[0].n);
  expect(n).toBe(1);
});
it('socio NÃO lê employees de empresa de parceiro', async () => { /* mesma consulta com parceiro.tenantId => 0 */ });
it.each(['employees', 'positions', 'tenant_epis', 'employee_epi_deliveries'])('socio não escreve em %s', async (t) => {
  await comoSocio(socio.id, async (c) => {
    await expect(c.query(`UPDATE ${t} SET tenant_id = tenant_id WHERE tenant_id = $1`, [montese.tenantId])).resolves.toMatchObject({ rowCount: 0 });
    await expect(c.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [montese.tenantId])).resolves.toMatchObject({ rowCount: 0 });
  });
});
it('socio altera só a vigência de documents', async () => {
  // docMontese inserido via db.insertRawRow('documents', {...}) com category 'pgr'
  await comoSocio(socio.id, async (c) => {
    const ok = await c.query("UPDATE documents SET expires_at = '2030-01-01', expires_source = 'manual' WHERE id = $1", [docMontese]);
    expect(ok.rowCount).toBe(1);
    await expect(c.query("UPDATE documents SET title = 'x' WHERE id = $1", [docMontese])).rejects.toThrow(/vigência/);
    await expect(c.query("UPDATE documents SET tenant_id = $2 WHERE id = $1", [docMontese, parceiro.tenantId])).rejects.toThrow();
    const del = await c.query('DELETE FROM documents WHERE id = $1', [docMontese]);
    expect(del.rowCount).toBe(0);
  });
});
it('socio não vê documento da categoria cadastro_funcionarios (restritiva 0083)', async () => { /* insere doc nessa categoria; count = 0 */ });
it('socio não atualiza documento de empresa de parceiro', async () => { /* rowCount 0 */ });
it('CHECK aceita empresas.read e empresas.documentos', async () => {
  await db.grantSocioPermission(socio.id, 'empresas.read');
  await db.grantSocioPermission(socio.id, 'empresas.documentos');
});
```
- [ ] **Step 2: Rodar e ver falhar** — aplicar nada ainda; `run-e2e-cand.sh atuacao-empresas-rls`. Esperado: FAIL (0 linhas / CHECK recusa).
- [ ] **Step 3: Escrever a migration**
```sql
-- Painel de Atuação — Atuação por empresa (Z). Leitura da área da empresa pelo socio (carteira Montese) e
-- ajuste de vigência de documentos. Policies PERMISSIVAS e específicas do papel; nenhuma INSERT/DELETE.
-- Rollback:
--   DROP TRIGGER trg_b_guard_documents_socio_update ON documents; DROP FUNCTION guard_documents_socio_update();
--   DROP POLICY documents_socio_update ON documents;
--   DROP POLICY employees_socio_select ON employees; DROP POLICY positions_socio_select ON positions;
--   DROP POLICY tenant_epis_socio_select ON tenant_epis; DROP POLICY employee_epi_deliveries_socio_select ON employee_epi_deliveries;
--   (restaurar o CHECK de permissões da 0096)

ALTER TABLE socio_permissions DROP CONSTRAINT IF EXISTS socio_permissions_permission_check;
ALTER TABLE socio_permissions ADD CONSTRAINT socio_permissions_permission_check CHECK (permission IN (
  'clients.read','clients.update_operational','tasks.read','tasks.write','appointments.manage',
  'documents.create_draft','documents.review','documents.sign','documents.read','documents.approve',
  'documents.publish','documents.cancel','documents.view_registration','finance.read',
  'empresas.read','empresas.documentos'));

CREATE POLICY employees_socio_select ON employees FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY positions_socio_select ON positions FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY tenant_epis_socio_select ON tenant_epis FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY employee_epi_deliveries_socio_select ON employee_epi_deliveries FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

CREATE POLICY documents_socio_update ON documents FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

-- RLS não restringe colunas: o socio só pode mudar a vigência.
CREATE OR REPLACE FUNCTION guard_documents_socio_update() RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.role', true) = 'socio'
     AND (to_jsonb(NEW) - ARRAY['valid_from','expires_at','expires_source','validity_months_applied','updated_at'])
         IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['valid_from','expires_at','expires_source','validity_months_applied','updated_at']) THEN
    RAISE EXCEPTION 'socio só pode alterar a vigência do documento' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_b_guard_documents_socio_update BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION guard_documents_socio_update();
```
(Antes: confirmar com `grep -n "documents_socio" backend/db/migrations/*.sql` que não existe outra policy de UPDATE; confirmar os nomes de policy/colunas contra o esquema `montese_prodschema`.)
- [ ] **Step 4: Aplicar no descartável** (`psql` no `socio_ensaio_pg`, `SET LOCAL ROLE montese_app`, em transação) e rodar `atuacao-empresas-rls`: Esperado PASS. Rodar também `socio-access-matrix` e `atuacao-documentos` (regressão do trigger/policies de `documents`).
- [ ] **Step 5: Parar** — sem commit; registrar evidência no relatório.

---

### Task 2: Permissões `empresas.read` e `empresas.documentos`

**Files:** Modify `backend/src/common/permissions.ts`, `backend/src/atuacao/permissoes/permissoes-catalogo.ts`, `backend/test/permissoes-admin-service.unit-spec.ts` (e qualquer teste que afirme "14" permissões — `grep -rn "toHaveLength(14)\|14" backend/test | grep -i permiss`).

- [ ] **Step 1: Teste (falha)** no unit do catálogo: "o catálogo cobre exatamente `PERMISSIONS`" já existe — adicionar expectativa de que ambos os itens novos existem, `sensivel: false`, no grupo `empresas`.
- [ ] **Step 2: Rodar**: `... jest --config ./test/jest-unit.json permissoes-admin-service` ⇒ FAIL.
- [ ] **Step 3: Implementar** — acrescentar `'empresas.read', 'empresas.documentos'` ao fim de `PERMISSIONS`; no catálogo, novo grupo (helper `i(permissao, rotulo, descricao, sensivel=false)` já existente):
```ts
{ id: 'empresas', titulo: 'Atuação por empresa', itens: [
  i('empresas.read', 'Atender empresas clientes', 'Escolher uma empresa cliente e consultar visão geral, documentos, vencimentos, funcionários (sem CPF) e EPI.'),
  i('empresas.documentos', 'Ajustar vigência de documentos', 'Corrigir início e vencimento dos documentos de uma empresa cliente. Não envia nem apaga arquivos.'),
] },
```
Atualizar `ORDEM_PERMISSOES`/listas derivadas conforme o arquivo.
- [ ] **Step 4: Rodar** unit do catálogo, `permissions-guard`, `socio-controller-sweep`, `roles-guard-socio` ⇒ PASS; `npx tsc --noEmit -p tsconfig.json`.

---

### Task 3: Backend — `/atuacao/empresas/:tenantId/*`

**Files:** Create `backend/src/atuacao/empresas/empresas.service.ts`, `empresas.controller.ts`, `dto/vigencia.dto.ts`; Modify `atuacao.module.ts`; Tests `backend/test/empresas-service.unit-spec.ts`, `backend/test/atuacao-empresas.e2e-spec.ts`.

**Interfaces — Produces (HTTP, `@Controller('atuacao/empresas')`, `@Roles('socio')`, `ParseUUIDPipe` em `:tenantId`):**
- `GET :tenantId/visao-geral` (`empresas.read`) → `{ empresa: { id, name, trade_name, cnpj, situacao }, funcionarios_ativos: number, documentos: { total, vencidos, a_vencer_30d }, epis_cadastrados: number }`
- `GET :tenantId/documentos` (`empresas.read`) → `{ id, category, title, file_name, valid_from, expires_at, situacao }[]` (sem `file_key`)
- `GET :tenantId/documentos/:id/download` (`empresas.read`) → `{ url, file_name }`
- `GET :tenantId/vencimentos` (`empresas.read`) → `{ id, category, title, expires_at, dias_para_vencer }[]` (só com `expires_at`, ordem crescente)
- `PATCH :tenantId/documentos/:id/vigencia` (`empresas.documentos`) body `{ valid_from?: 'AAAA-MM-DD'|null, expires_at?: 'AAAA-MM-DD'|null }` → `Document` sem `file_key`
- `GET :tenantId/funcionarios` (`empresas.read`) → `{ id, full_name, cargo, department, company_unit_id, admission_date, status }[]` (limite 500; **sem cpf/birth_date**)
- `GET :tenantId/epi` (`empresas.read`) → `{ id, code, equipment_group, description }[]` (de `tenant_epis` ⨝ `epi_catalog_items`)
- Erros: empresa inexistente/não Montese ⇒ 404 "Empresa não encontrada"; documento de outra empresa ⇒ 404.

- [ ] **Step 1: Testes que falham.**
Unit (`empresas-service.unit-spec.ts`, client mockado): `exigirEmpresa` lança `NotFoundException` quando a consulta a `tenants` volta vazia; `listarFuncionarios` não contém `cpf` nem `birth_date` na SQL (`expect(sql).not.toMatch(/cpf|birth_date/)`); `vencimentos` calcula `dias_para_vencer` (data fixa injetada); projeção de documentos remove `file_key`.
E2E HTTP (padrão de `atuacao-permissoes.e2e-spec.ts`: `login`, `db.createUserWithRole('socio', ...)`, `db.grantSocioPermission`):
```ts
it('sem empresas.read ⇒ 403 PERMISSION_DENIED em todas as rotas de leitura');
it('empresa, técnico e parceiro ⇒ 403; admin ⇒ 403');
it('com empresas.read: visao-geral/documentos/vencimentos/funcionarios/epi da empresa Montese ⇒ 200 e dados do próprio tenant');
it('empresa de parceiro ⇒ 404 em todas as rotas (sem vazar dados)');
it('tenant inexistente (uuid aleatório) ⇒ 404; id não-uuid ⇒ 400');
it('funcionarios não retorna cpf nem birth_date, mesmo existindo no banco');
it('documentos não retornam file_key; categoria cadastro_funcionarios não aparece');
it('vigencia: com empresas.documentos ⇒ 200 e grava expires_at; sem a permissão ⇒ 403; documento de outra empresa ⇒ 404');
it('vigencia: tentar mandar title ⇒ 400 (forbidNonWhitelisted)');
it('auditoria: company.accessed e company.documents.changed existem, sem e-mail/nome/cpf no detail');
it('sócio não consegue DELETE nem upload: rotas inexistentes ⇒ 404; /documents ⇒ 403');
```
- [ ] **Step 2: Rodar** unit e e2e ⇒ FAIL (rotas/serviço inexistem).
- [ ] **Step 3: Implementar.**
`dto/vigencia.dto.ts`:
```ts
import { IsOptional, Matches, ValidateIf } from 'class-validator';
const DATA = /^\d{4}-\d{2}-\d{2}$/;
export class VigenciaDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATA, { message: 'valid_from inválida (esperado AAAA-MM-DD)' })
  valid_from?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATA, { message: 'expires_at inválida (esperado AAAA-MM-DD)' })
  expires_at?: string | null;
}
```
`empresas.service.ts` (cada método recebe `client: PoolClient` dentro do contexto do sócio; a RLS já esconde empresas não Montese):
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';

@Injectable()
export class EmpresasService {
  async exigirEmpresa(c: PoolClient, tenantId: string) {
    const r = await c.query('SELECT id, name, trade_name, cnpj FROM tenants WHERE id = $1', [tenantId]);
    if (!r.rows[0]) throw new NotFoundException('Empresa não encontrada');
    return r.rows[0] as { id: string; name: string; trade_name: string | null; cnpj: string };
  }
  async visaoGeral(c: PoolClient, tenantId: string, hoje = new Date()) {
    const empresa = await this.exigirEmpresa(c, tenantId);
    const f = await c.query("SELECT count(*)::int AS n FROM employees WHERE tenant_id = $1 AND status = 'ativo'", [tenantId]);
    const d = await c.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE expires_at < $2::date)::int AS vencidos,
              count(*) FILTER (WHERE expires_at >= $2::date AND expires_at <= $2::date + 30)::int AS a_vencer_30d
         FROM documents WHERE tenant_id = $1`, [tenantId, hoje.toISOString().slice(0, 10)]);
    const e = await c.query('SELECT count(*)::int AS n FROM tenant_epis WHERE tenant_id = $1', [tenantId]);
    return { empresa, funcionarios_ativos: f.rows[0].n, documentos: d.rows[0], epis_cadastrados: e.rows[0].n };
  }
  async funcionarios(c: PoolClient, tenantId: string) {
    await this.exigirEmpresa(c, tenantId);
    return (await c.query(
      `SELECT e.id, e.full_name, p.name AS cargo, e.department, e.company_unit_id, e.admission_date::text AS admission_date, e.status
         FROM employees e LEFT JOIN positions p ON p.id = e.position_id
        WHERE e.tenant_id = $1 ORDER BY e.full_name LIMIT 500`, [tenantId])).rows;
  }
  async epi(c: PoolClient, tenantId: string) {
    await this.exigirEmpresa(c, tenantId);
    return (await c.query(
      `SELECT t.id, i.code, i.equipment_group, i.description
         FROM tenant_epis t JOIN epi_catalog_items i ON i.id = t.epi_catalog_item_id
        WHERE t.tenant_id = $1 ORDER BY i.code, i.description`, [tenantId])).rows;
  }
  async vencimentos(c: PoolClient, tenantId: string, hoje = new Date()) {
    await this.exigirEmpresa(c, tenantId);
    const base = hoje.toISOString().slice(0, 10);
    return (await c.query(
      `SELECT id, category, title, expires_at::text AS expires_at, (expires_at - $2::date)::int AS dias_para_vencer
         FROM documents WHERE tenant_id = $1 AND expires_at IS NOT NULL ORDER BY expires_at, title LIMIT 500`,
      [tenantId, base])).rows;
  }
}
```
(Confirmar nomes de coluna de `tenant_epis` em `0013_epi_catalog.sql:115-128` antes de rodar.) Documentos e vigência **delegam** a `DocumentsService` (injetado; `findAll(client, tenantId)`, `getDownloadUrl(client, id)`, `updateValidity(client, id, userId, true, {validFrom, expiresAt})`). Em `documentos`, mapear para a projeção sem `file_key`. Antes de baixar/alterar um documento, conferir `doc.tenant_id === tenantId` (senão 404). Passar `isAdmin=true` a `updateValidity` apenas contorna a regra "só quem subiu"; a barreira real é a permissão `empresas.documentos` + RLS + trigger (comentar isso no código).
`empresas.controller.ts` (modelo: `atuacao.controller.ts`):
```ts
@Controller('atuacao/empresas')
@Roles('socio')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class EmpresasController {
  constructor(private readonly svc: EmpresasService, private readonly docs: DocumentsService, private readonly audit: AuditService) {}

  private async auditar(req: any, tenantId: string, action: string, detail: string) {
    await this.audit.log({ actorUserId: req.user.id, actorRole: req.user.role, action, resourceType: 'tenant', resourceId: tenantId,
      method: req.method, path: req.path, statusCode: 200, ipAddress: req.ip, detail });
  }
  @RequirePermission('empresas.read') @Get(':tenantId/visao-geral')
  async visao(@Param('tenantId', ParseUUIDPipe) t: string, @Req() req: any) {
    const out = await req.withTenantContext((c: any) => this.svc.visaoGeral(c, t));
    await this.auditar(req, t, 'company.accessed', 'modulo: visao-geral');
    return out;
  }
  // ... demais GETs idênticos, trocando o módulo; PATCH vigencia com @RequirePermission('empresas.documentos') e
  //     auditar('company.documents.changed', `documento: ${id}; campos: ${Object.keys(dto).join(', ')}`)
}
```
(Escrever todas as rotas listadas em Interfaces; o `detail` nunca inclui valores.) `atuacao.module.ts`: `imports: [DocumentsModule]` (exporta `DocumentsService`), `controllers` + `EmpresasController`, `providers` + `EmpresasService`.
- [ ] **Step 4: Rodar** unit; `tsc`; e2e `atuacao-empresas`; regressão e2e uma a uma: `atuacao-empresas-rls socio-access-matrix atuacao-documentos atuacao-carteira tenant-isolation-sweep`; unit `socio-controller-sweep tenant-context-callsites` (esperado: `tenant-context-callsites` continua falhando **só** pelos 3 chamadores pré-existentes; nenhum novo — as rotas usam `req.withTenantContext`).
- [ ] **Step 5: Parar** — sem commit.

---

### Task 4: Frontend — seletor de empresa e telas da empresa

**Files:** Create `frontend/src/app/atuacao/empresas/page.tsx`, `empresas/[tenantId]/page.tsx`, `empresas/[tenantId]/Secoes.tsx`, `frontend/src/app/atuacao/__tests__/empresas.test.tsx`; Modify `frontend/src/app/atuacao/api.ts`, menu do `AtuacaoShell`, `frontend/src/app/admin/__tests__/convencoes-paginas.test.ts` (somente se listar páginas de `atuacao`; ler antes).

**Interfaces — Consumes:** `atuacaoFetch<T>(path, init)` (`/api/atuacao` + path; lança `Error` com mensagem pronta; 401 ⇒ `/login`), `GET /atuacao/clientes?q=` (lista, já existente, tipo `ClienteResumo`), as rotas de Task 3.

- [ ] **Step 1: Testes que falham (Vitest, padrão de `src/app/atuacao/__tests__/documentos.test.tsx`)**: seletor lista clientes de `GET /clientes`, busca por texto refaz a chamada, link para `/atuacao/empresas/<id>`; página da empresa mostra o nome da empresa ativa sempre visível, abas **Visão geral, Documentos, Vencimentos, Funcionários, EPI** com `role="tablist"`; cada aba busca só sua rota (lazy) e mostra estado vazio/erro isolado (`role="alert"`); Funcionários **não** mostra CPF; Vencimentos destaca "vencido" **em texto**; botão "Ajustar vigência" só aparece quando a API/permissão permite (a tela tenta e exibe a mensagem do servidor em 403: `MSG_403`); diálogo de vigência valida `AAAA-MM-DD`, envia `PATCH` só com os campos alterados, mostra sucesso em `role="status"` e recarrega; 404 da empresa ⇒ mensagem "Empresa não encontrada"; botões desabilitados durante a requisição, sem corrida; varredura do DOM sem "assinatura digital"/"ICP-Brasil"; sem e-mail exibido.
- [ ] **Step 2: Rodar** `$H/sync-f7-front.sh npx vitest run src/app/atuacao/__tests__/empresas.test.tsx` ⇒ FAIL.
- [ ] **Step 3: Implementar** com os componentes do padrão atual (`AdminPageHeader`/`Card` de `@/components/admin` ou os usados por `src/app/atuacao/clientes/page.tsx` — **ler esse arquivo primeiro e copiar o padrão de listagem/estado**), `Dialogo` de `../documentos-fluxo` quando já usado em `/atuacao`. Tipos em `api.ts`:
```ts
export interface EmpresaVisaoGeral { empresa: { id: string; name: string; trade_name: string | null; cnpj: string; situacao?: Situacao };
  funcionarios_ativos: number; documentos: { total: number; vencidos: number; a_vencer_30d: number }; epis_cadastrados: number }
export interface EmpresaDocumento { id: string; category: string; title: string; file_name: string; valid_from: string | null; expires_at: string | null; situacao: string }
export interface EmpresaVencimento { id: string; category: string; title: string; expires_at: string; dias_para_vencer: number }
export interface EmpresaFuncionario { id: string; full_name: string; cargo: string | null; department: string | null; admission_date: string | null; status: string }
export interface EmpresaEpi { id: string; code: string; equipment_group: string; description: string }
```
Seletor: campo de busca (debounce simples), lista com nome, CNPJ formatado (`formatCnpj`) e situação (texto + tom), link para a empresa; lembra a última empresa em `localStorage` dentro de `try/catch` (conveniência, a tela funciona sem). Item de menu "Empresas" visível a todos os sócios; a API decide o acesso.
- [ ] **Step 4: Rodar** vitest do arquivo, depois `npx vitest run src/app/atuacao src/app/admin`, `npx tsc --noEmit`, `npx eslint --max-warnings 0 src/app/atuacao`, `npm run build` (a rota nova deve constar) ⇒ PASS.
- [ ] **Step 5: Parar** — sem commit. QA visual em navegador real: NÃO VERIFICADO (planejar na homologação).

---

### Task 5: Verificação final, revisão de segurança e documentação

- [ ] **Step 1:** unit completo (esperado: só `r2-get-object` e `tenant-context-callsites` pré-existentes), `tsc`, `npm run build` (backend); frontend completo (`npx vitest run`, tsc, eslint nos arquivos novos, build).
- [ ] **Step 2:** e2e, uma suíte por vez com Redis zerado: `atuacao-empresas-rls atuacao-empresas atuacao-permissoes atuacao-documentos atuacao-financeiro atuacao-agenda atuacao-tarefas atuacao-carteira socio-access-matrix subscription-status-guard tenant-isolation-sweep admin-dashboard-financeiro auth`. Esperado: todas verdes.
- [ ] **Step 3:** varredura estática: `grep -rniE "assinatura digital|ICP-?Brasil" backend/src/atuacao/empresas frontend/src/app/atuacao/empresas` ⇒ vazio; `grep -rn "cpf\|birth_date" backend/src/atuacao/empresas` ⇒ vazio.
- [ ] **Step 4: Revisão independente** — acionar o agente `montese-seguranca` (somente leitura) sobre `0097`, `empresas.*` e os testes; o implementador não aprova o próprio trabalho crítico. Corrigir achados em tarefa separada.
- [ ] **Step 5: Documentação** — relatório `docs/superpowers/audits/2026-10-27-pgr-z-atuacao-por-empresa.md` (evidências, arquivos, migration, riscos) e seção no runbook de release; atualizar a memória do projeto. **Parar**: commit e release são do proprietário (release exige backup, autorização e a migration 0097 aplicada **antes** do código novo, como nas fases anteriores; compatível com o código antigo por ser aditiva).

## Auto-revisão
- **Cobertura da spec:** seletor (Task 4 usa `/atuacao/clientes` existente); leitura por tabela (Task 1) com lista da primeira entrega; escrita só de vigência (Task 1 trigger + Task 3); permissões novas (Task 2); auditoria e 404 para não-Montese (Task 3); revisão independente (Task 5). **Diferença deliberada em relação à spec:** não se cria `socio_company_ids()`; usa-se `is_montese_tenant()`, que já existe e tem o dono correto (menos superfície).
- **Adiado e declarado:** upload de documento pelo sócio, CIPA/inspeções/eSocial por empresa, edição de funcionários, PGR (sub-projeto A).
- **Riscos:** (1) o trigger de vigência compara `to_jsonb(OLD/NEW)`: se outra migration adicionar colunas atualizadas por triggers próprios (ex.: `updated_at`), incluí-las na lista; (2) `updateValidity(..., isAdmin=true)` só afrouxa a regra "quem subiu"; (3) LGPD: registro formal da base legal e retenção seguem como pendência do proprietário.
