# Painel de Atuação — Fase 3B (agenda interna e histórico de reuniões/contatos) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar aos sócios uma agenda interna de atendimentos (reuniões, visitas, ligações) por cliente Montese e um histórico de reuniões e contatos na ficha do cliente, com `/atuacao/agenda`, linha do tempo na ficha e indicador de próximos atendimentos no painel.

**Architecture:** Duas tabelas novas (`agenda_events`, `client_interactions`) com RLS do `socio` limitada à carteira Montese (`is_montese_tenant`); nenhum módulo de empresa/técnico/parceiro é tocado (decisão do proprietário em 2026-10-20: agenda interna, sem aviso ao cliente nesta versão). Endpoints no módulo `atuacao` existente com `@RequirePermission`. Frontend reaproveita a casca `/atuacao`.

**Tech Stack:** NestJS, TypeScript, PostgreSQL (`pg`), class-validator, Jest; Next.js, React, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-painel-atuacao-design.md` (§5, §7); auditoria `docs/superpowers/audits/2026-10-20-painel-atuacao-fase3b-agenda.md`. **Pré-requisitos:** Fases 0–3A prontas.

## Global Constraints

- Sem `commit`/`push`/`reset`: passos "Checkpoint" só listam arquivos. Nada em produção; migrations só no Postgres descartável `socio_ensaio_pg`.
- Nunca ler `.env`/`ensaio.env`; **proibido** `/opt/Montese/run-backend-tests.sh` e docker fora do comando de migration indicado. Unit: `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão>`. E2E: somente `<scratchpad>/run-e2e.sh <padrão> > <log> 2>&1`, **com `<scratchpad>/reset-redis.sh` antes de cada suíte** (o rate limit acumulado gera 429 falso). Se o ambiente descartável não existir, recriar conforme a memória `reference_ensaio_descartavel_isolado`. Nunca passar senhas a subagentes.
- Agenda e interações são internas da Montese: `empresa`, `tecnico` e `parceiro` sem acesso (RLS + `@Roles`). `visit_requests` e seus consumidores **não são alterados**.
- `socio` sem DELETE em nenhuma tabela nova (cancelar em vez de apagar). Permissões usadas (lista fechada, nenhuma nova): agenda = `appointments.manage` (leitura e escrita); interações = `clients.read` (ler) e `clients.update_operational` (criar/editar).
- Nenhum `@Roles` existente passa a incluir `socio`. Toda rota nova usa `@Roles('socio')` + `@RequirePermission`.
- Auditoria (`AuditService.log`): só ids e nomes de campos, nunca título, pauta, resumo ou texto livre. Texto livre pode conter dado pessoal: retenção/LGPD é decisão pendente do proprietário.
- Datas: `DATE`/`TIME` sem conversão de fuso; "hoje" = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`. Valores `null` em PATCH ⇒ 400 (usar `@ValidateIf(v => v !== undefined)`); datas reais (`IsDataReal` já existe em `dto/tarefa.dto.ts` — extrair para `dto/validators.ts` e reaproveitar, mantendo `tarefa.dto.ts` funcionando); strings com `trim`.
- Função `SECURITY DEFINER` nova: dono `montese_auth_bypass` e teste do dono (aprendizado da Fase 2). Esta fase não cria funções novas; reutiliza `list_socios()` e `is_montese_tenant()`.
- Migration `0094` (confirmar livre em todas as branches). Português do Brasil; rótulos VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
- Fora de escopo: Google Calendar/Meet, aviso ou visibilidade ao cliente, anexos (R2), recorrência, notificações, tela de admin.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/db/migrations/0094_agenda_interacoes.sql` (criar) | Tabelas e RLS |
| `backend/src/atuacao/agenda-status.ts` (criar) | Transições da agenda |
| `backend/src/atuacao/dto/validators.ts` (criar) | `IsDataReal` e `IsHoraReal` compartilhados |
| `backend/src/atuacao/dto/agenda.dto.ts`, `interacao.dto.ts` (criar) | DTOs |
| `backend/src/atuacao/agenda.service.ts`, `agenda.controller.ts` (criar) | Agenda |
| `backend/src/atuacao/interacoes.service.ts`, `interacoes.controller.ts` (criar) | Histórico |
| `backend/src/atuacao/atuacao.module.ts` (modificar) | Registrar |
| `backend/test/agenda-status.unit-spec.ts`, `agenda-service.unit-spec.ts`, `interacoes-service.unit-spec.ts` (criar) | Unit |
| `backend/test/atuacao-agenda.e2e-spec.ts` (criar) | E2E |
| `frontend/src/app/atuacao/agenda/page.tsx` (criar) | Agenda |
| `frontend/src/app/atuacao/clientes/[tenantId]/page.tsx`, `page.tsx`, `api.ts`, `lib/dashboard/menu-atuacao.ts` (modificar) | Linha do tempo, KPI, menu |
| `frontend/src/app/atuacao/__tests__/agenda.test.tsx` (criar) | Vitest |

---

### Task 1: Migration 0094 — `agenda_events` e `client_interactions`

**Files:**
- Create: `backend/db/migrations/0094_agenda_interacoes.sql`
- Test: `backend/test/atuacao-agenda.e2e-spec.ts` (bloco RLS)

**Interfaces:** Produces as tabelas abaixo.

- [ ] **Step 1: Confirmar 0094 livre** (comando das fases anteriores com `0094_`).

- [ ] **Step 2: E2E de RLS que falha** em `atuacao-agenda.e2e-spec.ts` (bootstrap de `atuacao-tarefas.e2e-spec.ts`: `configureApp`, override do `MercadoPagoService`, `comoSocio()` via `pg` com `set_config`, dois sócios, tenant Montese e tenant de técnico). Cada caso afirma o dado lendo pelo superusuário `db.client`:
```ts
it('socio cria e lê agenda_events de tenant Montese; não em tenant de técnico', async () => {});
it('socio não faz DELETE em agenda_events nem em client_interactions', async () => {});
it('socio não insere evento com created_by de outro usuário nem em tenant de técnico', async () => {});
it('empresa, técnico e parceiro leem 0 linhas de agenda_events e client_interactions (conexão própria com set_config)', async () => {});
it('admin lê as duas tabelas e não as altera', async () => {});
it('socio edita só a PRÓPRIA interação (outra: 0 linhas afetadas); edita qualquer agenda_event de Montese', async () => {});
```
Run (`reset-redis.sh` antes): `<scratchpad>/run-e2e.sh atuacao-agenda > <scratchpad>/e2e-f3b-t1.log 2>&1` → FAIL.

- [ ] **Step 3: Migration**
```sql
-- Painel de Atuação (Fase 3B): agenda interna e histórico de reuniões/contatos.
-- Limitado à carteira Montese via is_montese_tenant() (0091). empresa/tecnico/parceiro
-- sem policy = sem acesso. Rollback (descartável): DROP TABLE client_interactions, agenda_events;

CREATE TABLE agenda_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id),
  created_by UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('reuniao','visita','ligacao','outro')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  event_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  location TEXT,
  meeting_link TEXT CHECK (meeting_link IS NULL OR meeting_link ~ '^https://'),
  company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','concluido','cancelado')),
  outcome_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time)
);
CREATE INDEX agenda_events_owner_date_idx ON agenda_events (owner_user_id, event_date);
CREATE INDEX agenda_events_tenant_idx ON agenda_events (tenant_id, event_date);
CREATE TRIGGER trg_agenda_events_updated_at BEFORE UPDATE ON agenda_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE client_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('reuniao','ligacao','email','visita','outro')),
  occurred_on DATE NOT NULL,
  participants TEXT,
  summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 4000),
  decisions TEXT,
  next_steps TEXT,
  agenda_event_id UUID REFERENCES agenda_events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX client_interactions_tenant_idx ON client_interactions (tenant_id, occurred_on DESC);
CREATE TRIGGER trg_client_interactions_updated_at BEFORE UPDATE ON client_interactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE agenda_events ENABLE ROW LEVEL SECURITY;       ALTER TABLE agenda_events FORCE ROW LEVEL SECURITY;
ALTER TABLE client_interactions ENABLE ROW LEVEL SECURITY; ALTER TABLE client_interactions FORCE ROW LEVEL SECURITY;

-- agenda_events: socio lê e escreve na carteira Montese (agenda compartilhada); admin só lê.
CREATE POLICY agenda_admin_select ON agenda_events FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY agenda_socio_select ON agenda_events FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY agenda_socio_insert ON agenda_events FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY agenda_socio_update ON agenda_events FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

-- client_interactions: socio lê e cria; edita só o que ele mesmo criou; admin só lê.
CREATE POLICY interactions_admin_select ON client_interactions FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY interactions_socio_select ON client_interactions FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY interactions_socio_insert ON client_interactions FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY interactions_socio_update ON client_interactions FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
         AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
```
O `GRANT` às tabelas novas vem de `ALTER DEFAULT PRIVILEGES` (`postgres/init/01-app-role.sh`).

- [ ] **Step 4: Aplicar só no descartável** (`docker exec -i socio_ensaio_pg psql -U ensaio_su -d montese_ensaio -v ON_ERROR_STOP=1 --single-transaction -q -f - < backend/db/migrations/0094_agenda_interacoes.sql`) e rodar o Step 2 → PASS.
- [ ] **Step 5: Checkpoint** — listar arquivos.

---

### Task 2: Agenda interna (regras, serviço e rotas)

**Files:**
- Create: `backend/src/atuacao/agenda-status.ts`, `dto/validators.ts`, `dto/agenda.dto.ts`, `agenda.service.ts`, `agenda.controller.ts`
- Modify: `backend/src/atuacao/dto/tarefa.dto.ts` (importar `IsDataReal` de `validators.ts`), `atuacao.module.ts`
- Test: `backend/test/agenda-status.unit-spec.ts`, `agenda-service.unit-spec.ts`; ampliar `atuacao-agenda.e2e-spec.ts`

**Interfaces:**
- Produces (`agenda-status.ts`): `AGENDA_STATUS = ['agendado','concluido','cancelado']`, `AGENDA_TIPOS = ['reuniao','visita','ligacao','outro']`, `transicaoAgendaPermitida(de, para)`: só `agendado → concluido|cancelado`; `exigeNotaAgenda(para)`: `cancelado` exige motivo.
- Produces (`validators.ts`): `IsDataReal` (data `YYYY-MM-DD` existente) e `IsHoraReal` (`HH:MM`, 00:00–23:59).
- HTTP (`@Roles('socio')`, tudo `@RequirePermission('appointments.manage')`):
  - `GET /atuacao/agenda?from=&to=&status=&tenantId=&owner=me|<uuid>` → `EventoResumo[]` (máx. 300, ordenado por `event_date`, `start_time`); `from`/`to` datas reais, `to >= from`
  - `GET /atuacao/agenda/:id` → `EventoDetalhe`; `POST /atuacao/agenda`; `PATCH /atuacao/agenda/:id`; `POST /atuacao/agenda/:id/status` `{ status: 'concluido'|'cancelado', note? }`
- Tipos: `EventoResumo { id, tenant_id, tenant_name, owner_user_id, owner_name, type, title, event_date, start_time, end_time, status }`; `EventoDetalhe = EventoResumo & { location, meeting_link, company_unit_id, notes, outcome_note, created_by_name, created_at }`.

- [ ] **Step 1: Testes que falham.** Unit de status (tabela completa: só `agendado → concluido|cancelado`; qualquer outra, inclusive mesmo estado e saída de terminais, é falsa; só `cancelado` exige nota). Unit do service (client `pg` mockado): criar valida tenant visível (`NotFound 'Cliente não encontrado'`), responsável em `list_socios()` (`'Responsável inválido'`; padrão = o usuário do JWT), `created_by` do JWT, `end_time > start_time`, unidade pertence ao tenant; atualizar só campos permitidos, `null` ⇒ 400, evento terminal não é editável (`BadRequest 'Evento encerrado'`); mudar status registra `outcome_note`; listar filtra no SQL e `LIMIT` depois do filtro. E2E (runner, `reset-redis.sh` antes): dois sócios criam/leem/atualizam; sem `appointments.manage` ⇒ 403 e nada criado; tenant de técnico ⇒ 404; `created_by` no corpo ⇒ 400; datas/horas inválidas ⇒ 400; `meeting_link` http ⇒ 400 e https ⇒ 201; cancelar sem nota ⇒ 400; concluir evento já cancelado ⇒ 400 e status intacto; `owner=me` e período; empresa/técnico/admin ⇒ 403; auditoria `agenda.created|rescheduled|cancelled|completed` sem título/pauta.
- [ ] **Step 2: Implementar** seguindo `tarefas.service.ts`/`tarefas.controller.ts` (mesmos padrões: `req.withTenantContext`, `buildSafeSetClause` com allowlist `['type','title','event_date','start_time','end_time','location','meeting_link','company_unit_id','notes','owner_user_id']`, `SELECT ... FOR UPDATE` em `mudarStatus`/`atualizar`, nomes via `LEFT JOIN list_socios()`, rotas na ordem fixa antes de `:id`). `agenda.rescheduled` quando `event_date`/`start_time` mudam.
- [ ] **Step 3: Rodar** unit (`agenda-status agenda-service tarefas-service socio-controller-sweep tenant-context-callsites atuacao-service`), `tsc`, e2e `atuacao-agenda` e regressão (`atuacao-tarefas atuacao-carteira socio-access-matrix`, cada uma com `reset-redis.sh` antes), `npm run build`.
- [ ] **Step 4: Checkpoint** — listar arquivos.

---

### Task 3: Histórico de reuniões e contatos

**Files:**
- Create: `backend/src/atuacao/dto/interacao.dto.ts`, `interacoes.service.ts`, `interacoes.controller.ts`
- Modify: `backend/src/atuacao/atuacao.module.ts`
- Test: `backend/test/interacoes-service.unit-spec.ts`; ampliar `atuacao-agenda.e2e-spec.ts`

**Interfaces:**
- HTTP (`@Roles('socio')`):
  - `GET /atuacao/clientes/:tenantId/interacoes` (`clients.read`) → `Interacao[]` (máx. 200, `occurred_on DESC`, `created_at DESC`)
  - `POST /atuacao/clientes/:tenantId/interacoes` (`clients.update_operational`) body `{ type, occurred_on, participants?, summary, decisions?, next_steps?, agenda_event_id? }`
  - `PATCH /atuacao/interacoes/:id` (`clients.update_operational`) — só o autor; mesmos campos (menos `type` vazio); `null` ⇒ 400
- Tipo: `Interacao { id, tenant_id, type, occurred_on, participants, summary, decisions, next_steps, agenda_event_id, created_by, created_by_name, created_at, updated_at, editavel: boolean }` (`editavel = created_by === usuário`).

- [ ] **Step 1: Testes que falham.** Unit + E2E: criar com `created_by` do JWT; tenant de técnico ⇒ 404; `agenda_event_id` de outro tenant ⇒ 400; `summary` vazio/só espaços ⇒ 400; `occurred_on` futura além de hoje ⇒ aceita (planejado) mas data inválida ⇒ 400; PATCH da interação de OUTRO sócio ⇒ 404 e dado intacto; PATCH próprio altera só campos enviados; GET devolve `editavel` correto para cada sócio; sem `clients.read` ⇒ 403; empresa/técnico/admin ⇒ 403; auditoria `client.interaction_created|updated` sem texto livre.
- [ ] **Step 2: Implementar** no mesmo padrão. A edição pelo autor é imposta pela policy (`created_by = app.user_id` no `USING`); o service ainda devolve 404 quando 0 linhas são afetadas.
- [ ] **Step 3: Rodar** unit, `tsc`, e2e `atuacao-agenda` (isolado), regressão `atuacao-carteira`, `npm run build`.
- [ ] **Step 4: Checkpoint** — listar arquivos.

---

### Task 4: Frontend — agenda, linha do tempo e KPI

**Files:**
- Create: `frontend/src/app/atuacao/agenda/page.tsx`, `frontend/src/app/atuacao/__tests__/agenda.test.tsx`
- Modify: `frontend/src/app/atuacao/api.ts`, `page.tsx`, `clientes/[tenantId]/page.tsx`, `frontend/src/lib/dashboard/menu-atuacao.ts`

**Interfaces:** consome a API das Tasks 2 e 3 e os helpers existentes (`api.ts`: token, `/api/atuacao`, 401 ⇒ limpa sessão e `/login`, 403 ⇒ "Você não tem permissão para esta ação.").

- [ ] **Step 1: Testes que falham (Vitest)**: menu ganha "Agenda" (`/atuacao/agenda`), só rotas existentes; lista agrupada por dia (data pt-BR `dd/mm/aaaa`, sem converter fuso), filtro de período (padrão: hoje + 14 dias) e de responsável (Meus / Todos), sem corrida de requisições (padrão `useRef`); criar compromisso (cliente via `GET /atuacao/clientes`, responsável via `GET /atuacao/equipe`, tipo, data, horas, local/link `https`, pauta) envia só os campos preenchidos e mantém o formulário em 400/403; concluir e cancelar (cancelar exige motivo; encerrado não mostra ações); marcação "de {nome}" em texto para eventos de outro sócio; ficha do cliente ganha a seção "Reuniões e contatos" com linha do tempo (mais recentes primeiro), formulário de novo registro, edição só quando `editavel`, e estado vazio; painel ganha o KPI "Próximos atendimentos (7 dias)" vindo de `GET /atuacao/agenda?owner=me&from=hoje&to=+7d&status=agendado` (contagem real, sem números fictícios, erro isolado do restante). Texto: nenhuma menção a aviso ao cliente.
- [ ] **Step 2: Implementar** seguindo os padrões da Fase 3A (`AsyncBody`, `KpiCard`, `PageHeader`, `Badge`, cartões no mobile, labels, `role="alert"`, foco visível, sem scroll horizontal da página).
- [ ] **Step 3: Rodar** `npx vitest run src/app/atuacao`, `npx vitest run`, `npx tsc --noEmit`, `npm run build`. QA visual: NÃO VERIFICADO salvo se o ambiente permitir.
- [ ] **Step 4: Checkpoint** — listar arquivos.

---

### Task 5: Verificação final da Fase 3B

- [ ] **Step 1:** unit completo (esperado: só `r2-get-object` falhando, pré-existente), `tsc`, `npm run build`.
- [ ] **Step 2:** e2e, **uma suíte por vez com `reset-redis.sh` antes**: `atuacao-agenda atuacao-tarefas atuacao-carteira socio-access-matrix subscription-status-guard tenant-isolation-sweep admin-dashboard-financeiro auth`.
- [ ] **Step 3:** `cd /opt/Montese/frontend && npx vitest run && npx tsc --noEmit`.
- [ ] **Step 4:** bloco "Fase 3B — evidências" em `docs/superpowers/audits/2026-10-19-painel-atuacao-fase0.md` e atualização da memória `project_painel_atuacao_socios.md`.
- [ ] **Step 5:** parar para o proprietário: commit; aplicação das migrations `0090–0094` em produção (backup + autorização; pré-requisito: o role que roda a migration ser membro de `montese_auth_bypass`); criação das contas dos sócios (senha em variável de ambiente) e concessão das permissões (`clients.read`, `clients.update_operational`, `tasks.read`, `tasks.write`, `appointments.manage`).

---

## Auto-revisão contra a spec e a decisão do proprietário

- **§5/§7 (agenda e reuniões, histórico do cliente, filtros por período/responsável):** Tasks 1–4. Decisão de 2026-10-20: agenda interna, sem visibilidade nem aviso ao cliente; `visit_requests` intocada.
- **§6 (auditoria):** alterações de agendamento — `agenda.created|rescheduled|cancelled|completed` (Task 2); interações — Task 3; sem texto livre.
- **Permissões:** nenhuma nova; `appointments.manage` e `clients.*` já existem.
- **Riscos declarados:** (1) texto livre sem política de retenção definida (decisão do proprietário); (2) qualquer sócio com `appointments.manage` edita compromissos do outro (carteira compartilhada; RECOMENDADO confirmar); (3) RLS não restringe colunas (`tenant_id`, `created_by` imutáveis só por service — trigger recomendado, decisão pendente); (4) dono das policies depende apenas de `is_montese_tenant()`, já com dono `montese_auth_bypass`.
