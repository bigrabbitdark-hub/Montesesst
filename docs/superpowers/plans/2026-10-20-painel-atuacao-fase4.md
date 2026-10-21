# Painel de Atuação — Fase 4 (financeiro somente leitura) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar aos sócios consulta financeira dos clientes Montese (indicadores, lista com situação e pendências, histórico por cliente) sem nenhum caminho de escrita — na API e no banco — e passar a auditar as tentativas de operação financeira negadas.

**Architecture:** Policy `SELECT` do `socio` em `payment_events` (limitada à carteira Montese), `trigger` que impede escrita em `plans` por papéis de aplicação (sem ligar RLS em `plans`, que tem leitura pública), auditoria das negações do `RolesGuard` para o sócio, e um módulo de leitura `financeiro` no `atuacao` com DTOs de saída explícitos. Frontend `/atuacao/financeiro` + cartão na ficha + KPI no painel.

**Tech Stack:** NestJS, TypeScript, PostgreSQL (`pg`), class-validator, Jest; Next.js, React, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-painel-atuacao-design.md` (§2.2, §4 Fluxo E, §6, §7); auditoria `docs/superpowers/audits/2026-10-20-painel-atuacao-fase4-financeiro.md`. **Pré-requisitos:** Fases 0–3B prontas.

## Definições assumidas (aguardam aprovação do proprietário — ver auditoria)
1. **Escopo:** o sócio vê somente clientes Montese (assinaturas com `tenant_id` Montese). Receita de técnicos fica fora.
2. **Pendência/inadimplência:** cliente com situação `ativa` (existe assinatura `authorized`) cujo **pagamento mais recente** tem status fora de `approved` está **com pendência**; `dias_em_atraso` = hoje (`America/Sao_Paulo`) − data desse pagamento. `inativa`/`trial`/`pendente` não são "inadimplentes".
3. **MRR:** soma de `plans.price_cents` das assinaturas `authorized` dos clientes Montese (preço atual do plano).
4. **Auditoria:** cada consulta registra `finance.viewed` (rota e ids, **sem valores**); negações registram `role.denied`/`permission.denied`.

## Global Constraints

- Sem `commit`/`push`/`reset`: "Checkpoint" só lista arquivos. Nada em produção; migrations só no Postgres descartável `socio_ensaio_pg`.
- Nunca ler `.env`/`ensaio.env`; **proibido** `/opt/Montese/run-backend-tests.sh` e docker fora do comando de migration indicado. Unit: `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão>`. E2E: somente `<scratchpad>/reset-redis.sh >/dev/null && <scratchpad>/run-e2e.sh <padrão> > <log> 2>&1`, uma suíte por vez. Se o ambiente não existir, recriar conforme a memória `reference_ensaio_descartavel_isolado`. Nunca passar senhas a subagentes.
- **Somente leitura:** só rotas `GET` exigem `finance.read`. Não existem (e não serão criadas) permissões `finance.write`, `billing.manage`, `payments.refund`. Nenhum `@Roles` existente passa a incluir `socio`.
- **Nunca expor ao sócio:** `mercadopago_payment_id`, `mercadopago_preapproval_id`, payloads/tokens do Mercado Pago, dados de técnicos, eventos sem assinatura. DTOs de saída explícitos; nada de `SELECT *`.
- Trigger/função novos: funções plpgsql comuns (não `SECURITY DEFINER`); migration `0095` (confirmar livre em todas as branches). A migration não pode quebrar seeds nem migrations futuras: contexto sem `app.role` (migrations, webhook por função `SECURITY DEFINER`) e `admin` continuam escrevendo em `plans`.
- Datas/horas: "hoje" = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`. Valores em centavos inteiros na API; formatação em reais só no frontend.
- Auditoria só com ids e nomes de rota/campos, nunca valores financeiros.
- Português do Brasil; rótulos VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
- Fora de escopo: exportação (CSV/PDF), receita de técnicos, edição de qualquer dado financeiro, tela de admin para a política de escopo, integração com o Mercado Pago.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/db/migrations/0095_financeiro_socio_leitura.sql` (criar) | Policy de leitura + trigger de `plans` |
| `backend/src/common/guards/roles.guard.ts` (modificar) | Auditar negações do sócio |
| `backend/src/atuacao/financeiro-regras.ts` (criar) | Funções puras (pendência, atraso, MRR) |
| `backend/src/atuacao/financeiro.service.ts`, `financeiro.controller.ts` (criar) | Consultas e rotas |
| `backend/src/atuacao/atuacao.module.ts` (modificar) | Registrar |
| `backend/test/financeiro-regras.unit-spec.ts`, `financeiro-service.unit-spec.ts`, `roles-guard-socio.unit-spec.ts` (criar/modificar) | Unit |
| `backend/test/socio-controller-sweep.unit-spec.ts` (modificar) | Nova regra |
| `backend/test/atuacao-financeiro.e2e-spec.ts` (criar) | E2E |
| `frontend/src/app/atuacao/financeiro/page.tsx` (criar) | Tela |
| `frontend/src/app/atuacao/page.tsx`, `clientes/[tenantId]/page.tsx`, `api.ts`, `lib/dashboard/menu-atuacao.ts` (modificar) | KPI, cartão, menu |
| `frontend/src/app/atuacao/__tests__/financeiro.test.tsx` (criar) | Vitest |

---

### Task 1: Migration 0095 — leitura de `payment_events` e guarda de escrita em `plans`

**Files:**
- Create: `backend/db/migrations/0095_financeiro_socio_leitura.sql`
- Test: `backend/test/atuacao-financeiro.e2e-spec.ts` (bloco banco)

- [ ] **Step 1: Confirmar 0095 livre** (comando das fases anteriores com `0095_`).

- [ ] **Step 2: E2E de banco que falha** (bootstrap de `atuacao-agenda.e2e-spec.ts`: `comoSocio()`, fixtures `userId`, tenant Montese e tenant de técnico, `plans` via `SELECT id FROM plans LIMIT 1`; cada caso lê o dado pelo superusuário `db.client`):
```ts
it('socio lê payment_events de assinatura de tenant Montese e NÃO os de técnico, de tenant de parceiro nem órfãos', async () => {});
it('socio não faz INSERT/UPDATE/DELETE em payment_events nem em subscriptions (0 linhas / erro RLS) e o dado fica intacto', async () => {});
it('socio não altera plans: UPDATE/INSERT/DELETE com app.role=socio levantam exceção e a linha fica intacta', async () => {});
it('empresa, técnico e parceiro também não alteram plans (exceção), mas leem plans normalmente', async () => {});
it('admin e contexto sem papel (migrations/superusuário) continuam alterando plans', async () => {});
it('função do webhook payments_record_payment_event continua gravando evento sem contexto de papel', async () => {});
it('empresa e técnico continuam lendo os próprios payment_events e não os de outros', async () => {});
```
Run → FAIL.

- [ ] **Step 3: Migration**
```sql
-- Painel de Atuação (Fase 4): financeiro somente leitura para o `socio`.
-- Rollback (descartável): DROP POLICY payment_events_socio_select ON payment_events;
--   DROP TRIGGER trg_plans_guard_role ON plans; DROP FUNCTION plans_guard_role();

-- 1) Leitura de eventos de pagamento: só de assinaturas de tenants Montese. Eventos
--    órfãos (subscription_id nulo) e de técnicos (tenant_id nulo) ficam invisíveis.
--    A subconsulta passa pela policy de subscriptions do socio (0092).
CREATE POLICY payment_events_socio_select ON payment_events FOR SELECT
  USING (
    current_setting('app.role', true) = 'socio'
    AND EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.id = payment_events.subscription_id
        AND s.tenant_id IS NOT NULL
        AND is_montese_tenant(s.tenant_id)
    )
  );

-- 2) `plans` não tem RLS (leitura pública em GET /plans e JOINs em várias tabelas).
--    Em vez de ligá-la, bloqueia ESCRITA por papéis de aplicação. Contexto sem
--    papel (migrations, superusuário, funções SECURITY DEFINER) e `admin` passam.
CREATE FUNCTION plans_guard_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.role', true) IN ('socio', 'empresa', 'tecnico', 'parceiro') THEN
    RAISE EXCEPTION 'plans: escrita não permitida para o papel %', current_setting('app.role', true)
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER trg_plans_guard_role BEFORE INSERT OR UPDATE OR DELETE ON plans
  FOR EACH ROW EXECUTE FUNCTION plans_guard_role();
```
Atenção: `current_setting('app.role', true)` é `''` (string vazia) quando o contexto não define papel — não está na lista, então passa. Registrar no relatório o resultado do teste do webhook.

- [ ] **Step 4: Aplicar só no descartável** (`docker exec -i socio_ensaio_pg psql -U ensaio_su -d montese_ensaio -v ON_ERROR_STOP=1 --single-transaction -q -f - < backend/db/migrations/0095_financeiro_socio_leitura.sql`) e rodar o Step 2 → PASS. Regressão: `admin-dashboard-financeiro`, `subscription-status-guard`, `socio-access-matrix` (um por vez, Redis zerado) — o caso da Fase 1 que documentava "plans sem RLS (UPDATE afeta 1 linha)" **deve ser atualizado** para o novo comportamento (exceção) e continuar passando.
- [ ] **Step 5: Checkpoint** — listar arquivos.

---

### Task 2: Auditar as negações do sócio no `RolesGuard`

**Files:**
- Modify: `backend/src/common/guards/roles.guard.ts`
- Test: `backend/test/roles-guard-socio.unit-spec.ts`, `backend/test/atuacao-financeiro.e2e-spec.ts`

**Interfaces:**
- `RolesGuard` ganha o 2º parâmetro opcional do construtor `@Optional() private readonly audit?: AuditService` (testes existentes `new RolesGuard(reflector)` continuam válidos). Quando nega um usuário com `role === 'socio'`, chama `void this.audit?.log({ actorUserId, actorRole: 'socio', action: 'role.denied', resourceType: 'route', method, path: request.path, statusCode: 403, ipAddress: request.ip })`. Nenhum outro papel é auditado; nenhuma resposta muda.

- [ ] **Step 1: Testes que falham.** Unit: sócio negado em rota `@Roles('admin')` chama `audit.log` uma vez com `action:'role.denied'`, `path` sem query string e `statusCode:403`; sócio liberado não audita; `empresa` negada não audita; sem `audit` injetado não lança. E2E: sócio `PATCH /plans/:id` ⇒ 403, o preço no banco fica intacto e existe linha `audit_log` `role.denied` do sócio com `path` terminando em `/plans/<id>` sem `?`; sócio `PATCH /subscriptions/:id/status` e `POST /subscriptions` ⇒ 403, assinatura intacta e linha `role.denied`; `GET /admin/dashboard/financeiro` ⇒ 403 e `role.denied`; empresa na mesma rota ⇒ 403 **sem** linha `role.denied`.
- [ ] **Step 2: Implementar** (a decisão de negar não muda; só se acrescenta o registro assíncrono "fire and forget", que nunca lança — `AuditService.log` já captura erros). `AuditModule` é `@Global`, então a injeção opcional funciona no `APP_GUARD`.
- [ ] **Step 3: Rodar** unit (`roles-guard-socio permissions-guard socio-controller-sweep tenant-context-callsites`), `tsc`, e2e `atuacao-financeiro` e regressão (`socio-access-matrix`, `auth`), `npm run build`.
- [ ] **Step 4: Checkpoint** — listar arquivos.

---

### Task 3: Consulta financeira (regras, serviço e rotas)

**Files:**
- Create: `backend/src/atuacao/financeiro-regras.ts`, `financeiro.service.ts`, `financeiro.controller.ts`
- Modify: `backend/src/atuacao/atuacao.module.ts`, `backend/test/socio-controller-sweep.unit-spec.ts`
- Test: `backend/test/financeiro-regras.unit-spec.ts`, `financeiro-service.unit-spec.ts`; ampliar `atuacao-financeiro.e2e-spec.ts`

**Interfaces:**
- `financeiro-regras.ts`: `temPendencia(situacao: SubscriptionAccess, ultimoStatus: string | null): boolean` (verdadeiro só se `situacao==='ativa'`, há pagamento e `ultimoStatus` ∉ `APPROVED_STATUSES`); `diasEmAtraso(dataPagamento: string, hoje: string): number` (diferença de datas `YYYY-MM-DD`, mínimo 0); `somarMrr(precos: number[]): number`.
- HTTP (`@Controller('atuacao/financeiro')`, `@Roles('socio')`, tudo `@RequirePermission('finance.read')` e **somente `GET`**):
  - `GET resumo?dias=7|30|90` (padrão 30) → `{ periodo_dias, clientes: { total, ativos, trial, pendentes, inativos, com_pendencia }, mrr_cents, hoje: { cobrado_cents, aprovado_cents, pendente_cents }, mes: { cobrado_cents, aprovado_cents, pendente_cents, recusado_cents }, serie: { data, cobrado_cents, aprovado_cents }[] }`
  - `GET clientes?q=&situacao=&pendencia=true` → `ClienteFinanceiro[]` (máx. 200, filtros no SQL): `{ id, name, trade_name, situacao, plano: string|null, valor_mensal_cents: number|null, ultimo_pagamento: { data, status, valor_cents }|null, pendencia: boolean, dias_em_atraso: number|null }`
  - `GET clientes/:tenantId` (`ParseUUIDPipe`) → `ClienteFinanceiro & { assinaturas: { plano, status, valor_mensal_cents, desde }[], pagamentos: { data, status, valor_cents }[] }` (24 últimos pagamentos); tenant de parceiro ⇒ 404 `Cliente não encontrado`.
- DTOs de saída sem `mercadopago_*`. Auditoria `finance.viewed` por chamada (`detail`: nome da consulta + `tenantId` quando houver; **sem valores**; `path` sem query).

- [ ] **Step 1: Testes que falham.** Unit de regras (tabela: ativa+approved ⇒ não; ativa+rejected/pending/in_process/cancelled/refunded ⇒ sim; ativa sem pagamento ⇒ não; trial/pendente/inativa ⇒ nunca; atraso 0 no mesmo dia, N dias, nunca negativo). Unit do service (client `pg` mockado): classificação via `deriveAccessState`, filtros no SQL, `LIMIT 200` depois do filtro, DTOs sem chaves `mercadopago_*`. **Sweep:** nova regra — nenhuma rota que exija `finance.read` pode ser diferente de `GET`, e nenhuma rota de `payments/`/`admin-dashboard` pode listar `socio`. E2E (runner, dados controlados — 2 clientes Montese com assinaturas `authorized`/`cancelled`, pagamentos `approved`/`rejected` em datas fixas, 1 cliente de técnico com receita, 1 evento órfão, 1 assinatura de técnico): resumo bate **exatamente** com os valores semeados (clientes, MRR, hoje/mês/serie) e **não inclui** técnico nem órfão; lista traz `pendencia` e `dias_em_atraso` corretos; `situacao` e `pendencia` como filtros; ficha de cliente de parceiro ⇒ 404; sem `finance.read` ⇒ 403; empresa/técnico/admin ⇒ 403; corpo JSON de nenhuma resposta contém `mercadopago`; tentativas `POST|PATCH|PUT|DELETE /atuacao/financeiro/*` ⇒ 404/405 sem efeito; auditoria `finance.viewed` presente e sem valores.
- [ ] **Step 2: Implementar** (padrões de `atuacao.service.ts`/`tarefas.service.ts`; `req.withTenantContext`; RLS faz a restrição de carteira e o SQL repete `s.tenant_id IS NOT NULL` como defesa; reutilizar `APPROVED_STATUSES` etc. de `admin-dashboard/payment-status.ts` e `deriveAccessState`; série diária com `generate_series` no fuso `America/Sao_Paulo`, no estilo do `getFinanceiro` do admin; "último pagamento" via `LATERAL ... ORDER BY occurred_at DESC LIMIT 1` sobre as assinaturas do cliente).
- [ ] **Step 3: Rodar** unit (`financeiro socio-controller-sweep tenant-context-callsites atuacao-service`), `tsc`, e2e `atuacao-financeiro` e regressão (`atuacao-carteira admin-dashboard-financeiro`), `npm run build`.
- [ ] **Step 4: Checkpoint** — listar arquivos.

---

### Task 4: Frontend — Financeiro

**Files:**
- Create: `frontend/src/app/atuacao/financeiro/page.tsx`, `frontend/src/app/atuacao/__tests__/financeiro.test.tsx`
- Modify: `frontend/src/app/atuacao/api.ts`, `page.tsx`, `clientes/[tenantId]/page.tsx`, `frontend/src/lib/dashboard/menu-atuacao.ts`

- [ ] **Step 1: Testes que falham (Vitest)**: menu ganha "Financeiro" (`/atuacao/financeiro`); página mostra aviso fixo "Somente consulta"; KPIs (Clientes ativos, MRR, Clientes com pendência, Aprovado no mês) com valores em R$ pt-BR a partir de centavos (`R$ 299,00`), sem números fictícios, erro isolado; tabela/cartões de clientes com plano, valor mensal, situação, último pagamento (`dd/mm/aaaa`), "Em atraso há N dias" em texto; filtros (busca, situação, "Só com pendência") enviam `q`, `situacao`, `pendencia=true`; sem corrida de requisições (`useRef`); estado vazio; 403 ⇒ "Você não tem permissão para esta ação."; 401 ⇒ limpa sessão e `/login`. **Nenhum** botão, link ou campo de ação financeira (nada de cobrar, baixar, estornar, alterar plano) — teste afirma a ausência; a ficha do cliente ganha o cartão "Financeiro" (plano, valor, situação, pagamentos recentes) somente leitura; painel ganha o KPI "Clientes com pendência financeira" com erro isolado.
- [ ] **Step 2: Implementar** seguindo os padrões das fases anteriores (`AsyncBody`, `KpiCard`, `PageHeader`, `Badge`, cartões no mobile, labels, `role="alert"`, foco visível, sem scroll horizontal). Formatação monetária via `Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' })`; datas sem conversão de fuso.
- [ ] **Step 3: Rodar** `npx vitest run src/app/atuacao`, `npx vitest run`, `npx tsc --noEmit`, `npm run build`. QA visual: NÃO VERIFICADO salvo se o ambiente permitir.
- [ ] **Step 4: Checkpoint** — listar arquivos.

---

### Task 5: Verificação final da Fase 4

- [ ] **Step 1:** unit completo (esperado: só `r2-get-object` falhando, pré-existente), `tsc`, `npm run build`.
- [ ] **Step 2:** e2e, **uma suíte por vez com `reset-redis.sh` antes**: `atuacao-financeiro atuacao-agenda atuacao-tarefas atuacao-carteira socio-access-matrix subscription-status-guard tenant-isolation-sweep admin-dashboard-financeiro auth`.
- [ ] **Step 3:** `cd /opt/Montese/frontend && npx vitest run && npx tsc --noEmit`.
- [ ] **Step 4:** bloco "Fase 4 — evidências" em `docs/superpowers/audits/2026-10-19-painel-atuacao-fase0.md` e atualização da memória `project_painel_atuacao_socios.md` (incluindo: `plans` agora protegido por trigger; definições adotadas).
- [ ] **Step 5:** parar para o proprietário: commit; aplicação das migrations `0090–0095` em produção (backup + autorização; pré-requisito: o role que roda a migration ser membro de `montese_auth_bypass`); contas dos sócios (senha em variável de ambiente) e permissões (`finance.read` entre elas).

---

## Auto-revisão contra a spec

- **§2.2/Fluxo E (financeiro global em leitura, sem escrita na API e no banco):** `SELECT` em `payment_events`/`subscriptions`; nenhuma policy de escrita; trigger em `plans`; sweep impede rota de escrita com `finance.read` — Tasks 1 e 3.
- **§6 (acesso a dados financeiros; tentativas negadas):** `finance.viewed` e `role.denied` — Tasks 2 e 3.
- **§7 (indicadores de dados reais, definições consistentes):** definições explícitas e testadas contra dados semeados — Task 3.
- **Não exposto:** ids do Mercado Pago, técnicos, eventos órfãos.
- **Riscos declarados:** (1) definições 1–4 são do proprietário (INFERIDO); (2) o trigger de `plans` precisa passar na regressão do webhook/seeds (teste explícito); (3) MRR usa preço atual do plano; (4) a política `payment_events_socio_select` depende de `is_montese_tenant` (dono `montese_auth_bypass`, já validado).
