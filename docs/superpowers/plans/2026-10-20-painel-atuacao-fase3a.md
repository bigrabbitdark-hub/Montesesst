# Painel de Atuação — Fase 3A (tarefas, equipe e responsáveis por cliente) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar aos sócios um módulo de tarefas internas da carteira Montese (responsável, prazo, prioridade, status, histórico imutável), a lista da equipe de sócios e a atribuição de responsáveis por cliente (feita pelo admin), com tela `/atuacao/tarefas` e indicadores no painel.

**Architecture:** Três tabelas novas (`tasks`, `task_events` append-only, `tenant_owners`) e uma função `SECURITY DEFINER` `list_socios()` (dono `montese_auth_bypass`), todas com RLS: o `socio` só enxerga e escreve em tenants Montese (`is_montese_tenant`). Regras de transição de status ficam numa função pura testável. Endpoints novos no módulo `atuacao` existente, com `@RequirePermission('tasks.read'|'tasks.write')`. Frontend reaproveita a casca `/atuacao`.

**Tech Stack:** NestJS, TypeScript, PostgreSQL (`pg`), class-validator, Jest; Next.js, React, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-painel-atuacao-design.md` (§5, §7). **Pré-requisitos:** Fases 0–2 prontas (`...-fase0-fase1.md`, `...-fase2.md`).

## Global Constraints

- Sem `commit`/`push`/`reset`: passos "Checkpoint" só listam arquivos. Nada em produção; migrations só no Postgres descartável (`socio_ensaio_pg`).
- Nunca ler `.env`/`ensaio.env`; é **proibido** `/opt/Montese/run-backend-tests.sh` e usar docker fora do comando de migration indicado. Unit: `cd /opt/Montese/backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão>`. E2E: somente `<scratchpad>/run-e2e.sh <padrão> > <log> 2>&1` (recriar o ambiente conforme a memória `reference_ensaio_descartavel_isolado` se não existir). Nunca passar senhas a subagentes.
- **Função `SECURITY DEFINER` que lê tabela com RLS** precisa de `ALTER FUNCTION ... OWNER TO montese_auth_bypass` e de `GRANT SELECT` ao dono nas tabelas lidas (aprendizado da Fase 2). Todo teste de função deve verificar `pg_proc.proowner` + `rolbypassrls`.
- Estados de tarefa (lista fechada): `pending`, `in_progress`, `blocked`, `awaiting_review`, `completed`, `cancelled`. Prioridades: `baixa`, `media`, `alta`, `urgente`.
- Concluir tarefa **nunca** aprova nem assina documento (nenhum vínculo com documentos nesta fase).
- Tarefas são internas da Montese: `empresa`, `tecnico` e `parceiro` não têm nenhum acesso (RLS + `@Roles`). `task_events` é append-only para todos os papéis exceto que o admin não edita nem apaga eventos (apenas SELECT/INSERT).
- Nenhum `@Roles` existente passa a incluir `socio`. Toda rota nova do `socio` usa `@Roles('socio')` + `@RequirePermission`. Rotas de atribuição de responsáveis são `@Roles('admin')`.
- Migration `0093` (confirmar livre em todas as branches). Português do Brasil; rótulos VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
- Fora de escopo (Fase 3B e seguintes): agenda, reuniões/interações, anexos de tarefa (R2), vínculo tarefa↔documento, tela de admin para atribuir responsáveis (só a API), notificações, trigger de colunas em `tenants` (decisão pendente do proprietário).

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/db/migrations/0093_tarefas_responsaveis.sql` (criar) | Tabelas, RLS, `list_socios()` |
| `backend/src/atuacao/tarefa-status.ts` (criar) | Transições e regras de nota |
| `backend/src/atuacao/tarefas.service.ts` (criar) | Regras de tarefa |
| `backend/src/atuacao/tarefas.controller.ts` (criar) | Rotas `/atuacao/tarefas*` |
| `backend/src/atuacao/dto/tarefa.dto.ts` (criar) | DTOs de entrada |
| `backend/src/atuacao/equipe.service.ts`, `responsaveis.controller.ts` (criar) | Equipe e responsáveis |
| `backend/src/atuacao/atuacao.service.ts` (modificar) | Ficha com `responsaveis`, filtro `meus` |
| `backend/src/atuacao/atuacao.module.ts` (modificar) | Registrar novos providers/controllers |
| `backend/test/tarefa-status.unit-spec.ts`, `tarefas-service.unit-spec.ts` (criar) | Unit |
| `backend/test/atuacao-tarefas.e2e-spec.ts` (criar) | E2E (RLS + HTTP) |
| `frontend/src/app/atuacao/tarefas/page.tsx`, `[id]/page.tsx` (criar) | Lista e detalhe |
| `frontend/src/app/atuacao/page.tsx`, `clientes/[tenantId]/page.tsx` (modificar) | KPIs e responsáveis |
| `frontend/src/lib/dashboard/menu-atuacao.ts` (modificar) | Item "Minhas tarefas" |
| `frontend/src/app/atuacao/__tests__/tarefas.test.tsx` (criar) | Vitest |

---

### Task 1: Migration 0093 — tabelas, RLS e `list_socios()`

**Files:**
- Create: `backend/db/migrations/0093_tarefas_responsaveis.sql`
- Test: `backend/test/atuacao-tarefas.e2e-spec.ts` (bloco RLS)

**Interfaces:**
- Produces: tabelas `tasks`, `task_events`, `tenant_owners`; função `list_socios() RETURNS TABLE(id uuid, full_name text)`.

- [ ] **Step 1: Confirmar 0093 livre** (mesmo comando da Task 1 da Fase 2, com `0093_`). Se colidir, usar o próximo número livre em todo o plano.

- [ ] **Step 2: Escrever o e2e de RLS que falha** em `atuacao-tarefas.e2e-spec.ts` (mesmo bootstrap de `atuacao-carteira.e2e-spec.ts`: `configureApp`, override do `MercadoPagoService`, `comoSocio()` via `pg` com `set_config`). Casos (cada um afirma dado correto/intacto lendo pelo superusuário `db.client`):
```ts
it('socio cria e lê tarefa em tenant Montese; não em tenant de técnico', async () => {});
it('socio não faz DELETE em tasks nem UPDATE/DELETE em task_events (append-only)', async () => {});
it('socio não consegue INSERT de tarefa com created_by de outro usuário', async () => {});
it('empresa, técnico e parceiro não leem tasks/task_events/tenant_owners (0 linhas)', async () => {});
it('socio lê tenant_owners de Montese e NÃO escreve nela; admin escreve', async () => {});
it('list_socios() devolve só socios ativos para socio/admin e vazio para empresa/técnico', async () => {});
it('list_socios() tem dono montese_auth_bypass com BYPASSRLS', async () => {
  // SELECT r.rolname, r.rolbypassrls FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = 'list_socios'
});
```
Use as fixtures reais (`TestUserFixture.userId`; tenant com técnico como na Fase 2). Run: `<scratchpad>/run-e2e.sh atuacao-tarefas > <scratchpad>/e2e-f3a-t1.log 2>&1` → FAIL.

- [ ] **Step 3: Escrever a migration**
```sql
-- Painel de Atuação (Fase 3A): tarefas internas, histórico e responsáveis por cliente.
-- Tudo limitado à carteira Montese via is_montese_tenant() (0091). empresa/tecnico/
-- parceiro NÃO têm policy: sem acesso. Rollback (descartável): DROP TABLE task_events,
-- tasks, tenant_owners; DROP FUNCTION list_socios().

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  assignee_user_id UUID NOT NULL REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa','media','alta','urgente')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','blocked','awaiting_review','completed','cancelled')),
  due_date DATE,
  category TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_tenant_idx ON tasks (tenant_id);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_user_id, status);
CREATE INDEX tasks_due_idx ON tasks (due_date) WHERE status NOT IN ('completed','cancelled');
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('created','updated','assigned','status_changed')),
  from_value TEXT,
  to_value TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX task_events_task_idx ON task_events (task_id, created_at);

CREATE TABLE tenant_owners (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX tenant_owners_user_idx ON tenant_owners (user_id);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;        ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE task_events ENABLE ROW LEVEL SECURITY;  ALTER TABLE task_events FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_owners ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant_owners FORCE ROW LEVEL SECURITY;

-- tasks
CREATE POLICY tasks_admin ON tasks FOR ALL
  USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY tasks_socio_select ON tasks FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY tasks_socio_insert ON tasks FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY tasks_socio_update ON tasks FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
-- (sem policy de DELETE para socio: cancelar em vez de apagar)

-- task_events: append-only (SELECT + INSERT apenas; nenhum UPDATE/DELETE para ninguém)
CREATE POLICY task_events_admin_select ON task_events FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY task_events_socio_select ON task_events FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY task_events_socio_insert ON task_events FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- tenant_owners: admin atribui; socio só lê (carteira Montese)
CREATE POLICY tenant_owners_admin ON tenant_owners FOR ALL
  USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY tenant_owners_socio_select ON tenant_owners FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

-- Equipe: id e nome dos sócios ativos, só para socio/admin. SECURITY DEFINER porque o
-- socio não lê `users` (RLS). Dono com BYPASSRLS + SELECT em users (0001:106).
CREATE FUNCTION list_socios() RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.full_name FROM users u
  WHERE u.role = 'socio' AND u.status = 'ativo'
    AND current_setting('app.role', true) IN ('socio', 'admin')
  ORDER BY u.full_name;
$$;
ALTER FUNCTION list_socios() OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION list_socios() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_socios() TO montese_app;
```
Conferir: `montese_auth_bypass` tem `SELECT` em `users` (0001:106 — VERIFICAR) e a policy `users` não impede (BYPASSRLS ignora). O `GRANT` de tabelas novas à role da aplicação vem de `ALTER DEFAULT PRIVILEGES` (`postgres/init/01-app-role.sh:26`).

- [ ] **Step 4: Aplicar só no descartável e ver passar**
`docker exec -i socio_ensaio_pg psql -U ensaio_su -d montese_ensaio -v ON_ERROR_STOP=1 --single-transaction -q -f - < backend/db/migrations/0093_tarefas_responsaveis.sql` (somente esse container). Atenção: como no descartável o superusuário é quem aplica, o teste do dono da função (último caso) é o que prova o cenário de produção. Run do Step 2 → PASS.

- [ ] **Step 5: Checkpoint** — listar arquivos.

---

### Task 2: Regras de status (função pura)

**Files:**
- Create: `backend/src/atuacao/tarefa-status.ts`
- Test: `backend/test/tarefa-status.unit-spec.ts`

**Interfaces:**
- Produces: `TAREFA_STATUS`, `type TarefaStatus`, `TAREFA_PRIORIDADES`, `transicaoPermitida(de, para): boolean`, `exigeNota(para): boolean`, `ABERTAS: readonly TarefaStatus[]` (`pending|in_progress|blocked|awaiting_review`).

- [ ] **Step 1: Teste que falha**
```ts
import { transicaoPermitida, exigeNota, TAREFA_STATUS } from '../src/atuacao/tarefa-status';

describe('tarefa-status', () => {
  it.each([
    ['pending', 'in_progress', true], ['pending', 'completed', false],
    ['in_progress', 'awaiting_review', true], ['in_progress', 'completed', true],
    ['blocked', 'completed', false], ['blocked', 'in_progress', true],
    ['awaiting_review', 'completed', true], ['completed', 'in_progress', true],
    ['completed', 'cancelled', false], ['cancelled', 'pending', true], ['cancelled', 'completed', false],
  ])('%s -> %s = %s', (de, para, esperado) => {
    expect(transicaoPermitida(de as any, para as any)).toBe(esperado);
  });
  it('nunca permite transição para o mesmo estado', () => {
    for (const s of TAREFA_STATUS) expect(transicaoPermitida(s, s)).toBe(false);
  });
  it('exige nota ao bloquear e ao cancelar, e só nesses', () => {
    expect(TAREFA_STATUS.filter((s) => exigeNota(s))).toEqual(['blocked', 'cancelled']);
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implementar**
```ts
export const TAREFA_STATUS = ['pending', 'in_progress', 'blocked', 'awaiting_review', 'completed', 'cancelled'] as const;
export type TarefaStatus = (typeof TAREFA_STATUS)[number];
export const TAREFA_PRIORIDADES = ['baixa', 'media', 'alta', 'urgente'] as const;
export const ABERTAS: readonly TarefaStatus[] = ['pending', 'in_progress', 'blocked', 'awaiting_review'];

const TRANSICOES: Record<TarefaStatus, readonly TarefaStatus[]> = {
  pending: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['blocked', 'awaiting_review', 'completed', 'cancelled'],
  blocked: ['in_progress', 'cancelled'],
  awaiting_review: ['in_progress', 'completed', 'cancelled'],
  completed: ['in_progress'],
  cancelled: ['pending'],
};

export function transicaoPermitida(de: TarefaStatus, para: TarefaStatus): boolean {
  return TRANSICOES[de].includes(para);
}

// Bloquear e cancelar exigem justificativa registrada no histórico.
export function exigeNota(para: TarefaStatus): boolean {
  return para === 'blocked' || para === 'cancelled';
}
```
Run → PASS. Checkpoint.

---

### Task 3: Serviço e rotas de tarefas

**Files:**
- Create: `backend/src/atuacao/dto/tarefa.dto.ts`, `tarefas.service.ts`, `tarefas.controller.ts`
- Modify: `backend/src/atuacao/atuacao.module.ts` (registrar controller e service)
- Test: `backend/test/tarefas-service.unit-spec.ts`; ampliar `atuacao-tarefas.e2e-spec.ts`

**Interfaces:**
- Consumes: `transicaoPermitida`, `exigeNota`, `ABERTAS` (Task 2); `list_socios()`; `req.withTenantContext`; `AuditService`.
- Produces (HTTP, `@Roles('socio')`):
  - `GET /atuacao/tarefas?assignee=me|<uuid>&status=&tenantId=&vencidas=true` (`tasks.read`) → `TarefaResumo[]` (máx. 200)
  - `GET /atuacao/tarefas/resumo` (`tasks.read`) → `{ abertas, vencidas, hoje, bloqueadas }` das tarefas do usuário logado
  - `GET /atuacao/tarefas/:id` (`tasks.read`) → `TarefaDetalhe` (com `eventos`)
  - `POST /atuacao/tarefas` (`tasks.write`), `PATCH /atuacao/tarefas/:id` (`tasks.write`), `POST /atuacao/tarefas/:id/status` (`tasks.write`)
- Tipos: `TarefaResumo { id, tenant_id, tenant_name, title, priority, status, due_date, assignee_user_id, assignee_name, created_by_name, vencida: boolean }`; `TarefaDetalhe = TarefaResumo & { description, category, completed_at, created_at, eventos: { id, type, actor_name, from_value, to_value, note, created_at }[] }`.

- [ ] **Step 1: DTOs** (`dto/tarefa.dto.ts`):
```ts
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { TAREFA_PRIORIDADES, TAREFA_STATUS } from '../tarefa-status';

export class CreateTarefaDto {
  @IsUUID() tenant_id!: string;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsIn(TAREFA_PRIORIDADES as unknown as string[]) priority?: string;
  @IsOptional() @IsDateString() due_date?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsUUID() assignee_user_id!: string;
}

export class UpdateTarefaDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @IsIn(TAREFA_PRIORIDADES as unknown as string[]) priority?: string;
  @IsOptional() @IsDateString() due_date?: string;
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsUUID() assignee_user_id?: string;
}

export class ChangeTarefaStatusDto {
  @IsIn(TAREFA_STATUS as unknown as string[]) status!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ListTarefasQuery {
  @IsOptional() @IsString() @MaxLength(40) assignee?: string; // 'me' ou uuid
  @IsOptional() @IsIn(TAREFA_STATUS as unknown as string[]) status?: string;
  @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @IsIn(['true']) vencidas?: string;
}
```
`tenant_id` e `created_by` nunca vêm do cliente além do `tenant_id` da tarefa (validado pelo RLS: tenant de parceiro = "Cliente não encontrado"); `created_by` é sempre `userId` do JWT.

- [ ] **Step 2: Testes unitários que falham** (`tarefas-service.unit-spec.ts`, client `pg` mockado no estilo de `atuacao-service.unit-spec.ts`):
```ts
it('criar: grava tarefa com created_by do usuário e evento created; assignee precisa ser socio', async () => {});
it('criar: tenant invisível pelo RLS => NotFound "Cliente não encontrado"', async () => {});
it('criar: assignee fora de list_socios => BadRequest "Responsável inválido"', async () => {});
it('mudarStatus: transição inválida => BadRequest e nenhum UPDATE', async () => {});
it('mudarStatus: bloquear/cancelar sem nota => BadRequest', async () => {});
it('mudarStatus: completed grava completed_at; reabrir limpa completed_at; ambos geram evento status_changed', async () => {});
it('atualizar: troca de responsável gera evento assigned com from/to; campos fora do DTO são ignorados', async () => {});
it('atualizar: campo setado para string vazia NÃO apaga (ignorado) e título vazio é rejeitado pelo DTO', async () => {});
it('listar: assignee=me usa o userId do JWT; vencidas=true filtra due_date < hoje (fuso America/Sao_Paulo) e só estados abertos', async () => {});
it('resumo: conta abertas, vencidas, hoje e bloqueadas só do usuário', async () => {});
```
Escreva os corpos com asserções sobre o SQL emitido e os parâmetros (como no spec da Fase 2). Run → FAIL.

- [ ] **Step 3: Service** (`tarefas.service.ts`) — esqueleto de regras, cada método usa o `client` do `req.withTenantContext`:
```ts
@Injectable()
export class TarefasService {
  private async assertSocio(client: PoolClient, userId: string) {
    const r = await client.query('SELECT 1 FROM list_socios() WHERE id = $1', [userId]);
    if (r.rowCount === 0) throw new BadRequestException('Responsável inválido');
  }

  async criar(client: PoolClient, actorId: string, dto: CreateTarefaDto): Promise<TarefaDetalhe> {
    const t = await client.query('SELECT id FROM tenants WHERE id = $1', [dto.tenant_id]);
    if (t.rowCount === 0) throw new NotFoundException('Cliente não encontrado');
    await this.assertSocio(client, dto.assignee_user_id);
    const ins = await client.query<{ id: string }>(
      `INSERT INTO tasks (tenant_id, title, description, created_by, assignee_user_id, priority, due_date, category)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'media'),$7,$8) RETURNING id`,
      [dto.tenant_id, dto.title, dto.description ?? null, actorId, dto.assignee_user_id, dto.priority ?? null, dto.due_date ?? null, dto.category ?? null],
    );
    await this.evento(client, ins.rows[0].id, dto.tenant_id, actorId, 'created', null, 'pending', null);
    return this.obter(client, ins.rows[0].id);
  }
  // atualizar(), mudarStatus(), listar(), resumo(), obter(), evento() seguem o mesmo padrão:
}
```
Regras obrigatórias a implementar (sem exceção): `mudarStatus` lê a linha (`SELECT ... WHERE id=$1 FOR UPDATE`; 0 linhas ⇒ `NotFoundException('Tarefa não encontrada')`), valida `transicaoPermitida` (senão `BadRequestException('Transição de status não permitida')`) e `exigeNota` (senão `BadRequestException('Informe o motivo')`), atualiza `status` e `completed_at = CASE WHEN $2='completed' THEN now() ELSE NULL END`, e grava evento `status_changed` com `from_value`, `to_value` e `note`. `atualizar` monta o SET com `buildSafeSetClause(data, ['title','description','priority','due_date','category','assignee_user_id'], 2)`, valida o novo responsável com `assertSocio`, e grava um evento `assigned` (from/to = ids) quando o responsável muda e um evento `updated` com `to_value` = nomes dos campos alterados (nunca os valores). `listar`: `JOIN tenants`, `LEFT JOIN list_socios()` para `assignee_name`/`created_by_name`, `vencida = (due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date AND status = ANY($ABERTAS))`, `ORDER BY` estados abertos primeiro, depois `due_date NULLS LAST, prioridade`, `LIMIT 200` **depois** do filtro (filtros no SQL, não em memória). `resumo`: um único SELECT com `COUNT(*) FILTER (...)`.

- [ ] **Step 4: Controller** (`tarefas.controller.ts`, `@Controller('atuacao/tarefas')`, `@Roles('socio')`). Rotas na ordem: `GET resumo`, `GET ''`, `GET ':id'` (`ParseUUIDPipe`), `POST ''`, `PATCH ':id'`, `POST ':id/status'`. Cada uma com `@RequirePermission` como na tabela de Interfaces. Resolver `assignee=me` para `req.user.id`. Auditoria (`AuditService.log`, só nomes/ids, nunca texto livre): `task.created`, `task.reassigned`, `task.completed`. Registrar no `AtuacaoModule`.

- [ ] **Step 5: Rodar unit + tipos**: `tarefas-service tarefa-status socio-controller-sweep tenant-context-callsites atuacao-service` e `npx tsc --noEmit -p tsconfig.json` → PASS.

- [ ] **Step 6: E2E HTTP** (ampliar `atuacao-tarefas.e2e-spec.ts`; conceder `tasks.read`/`tasks.write` com `db.grantSocioPermission`; dois sócios para testar atribuição):
```ts
it('criar tarefa para outro socio; ele a vê em assignee=me; o criador também a vê na lista geral', async () => {});
it('sem tasks.write => 403 e nada é criado; sem tasks.read => 403', async () => {});
it('tenant de técnico => 404; assignee que não é socio => 400; created_by sempre do JWT (corpo com created_by => 400)', async () => {});
it('fluxo: pending -> in_progress -> blocked (sem nota 400; com nota 200) -> in_progress -> awaiting_review -> completed; histórico tem 1 evento por passo, em ordem, com ator correto', async () => {});
it('transição inválida (pending -> completed) => 400 e status inalterado no banco', async () => {});
it('reabrir completed limpa completed_at', async () => {});
it('resumo bate com a contagem real (abertas, vencidas, hoje, bloqueadas) com datas controladas', async () => {});
it('empresa, técnico e admin => 403 em /atuacao/tarefas*', async () => {});
it('auditoria task.created/task.reassigned/task.completed existe e não contém título nem descrição', async () => {});
```
Run via runner descartável → PASS. Regressão: `atuacao-carteira socio-access-matrix subscription-status-guard tenant-isolation-sweep` e `npm run build`.

- [ ] **Step 7: Checkpoint** — listar arquivos.

---

### Task 4: Equipe e responsáveis por cliente

**Files:**
- Create: `backend/src/atuacao/equipe.service.ts`, `backend/src/atuacao/responsaveis.controller.ts`, `dto/responsaveis.dto.ts`
- Modify: `backend/src/atuacao/atuacao.service.ts`, `atuacao.controller.ts`, `atuacao.module.ts`
- Test: ampliar `atuacao-service.unit-spec.ts` e `atuacao-tarefas.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `GET /atuacao/equipe` (`@Roles('socio')`, `tasks.read`) → `{ id, full_name }[]` (via `list_socios()`)
  - `PUT /atuacao/admin/clientes/:tenantId/responsaveis` (`@Roles('admin')`) body `{ user_ids: string[] }` (0 a 5 UUIDs, sem repetição) → `{ tenant_id, responsaveis: { id, full_name }[] }`; troca o conjunto inteiro numa transação; cada id deve estar em `list_socios()`; tenant deve ser Montese (`is_montese_tenant`), senão 404.
  - `ClienteFicha` ganha `responsaveis: { id: string; full_name: string }[]`; `GET /atuacao/clientes?meus=true` filtra clientes em que o usuário é responsável.

- [ ] **Step 1: Testes que falham** (unit do service + e2e): ficha traz `responsaveis` corretos; `meus=true` retorna só os atribuídos ao usuário; PUT por admin troca o conjunto e audita `client.owners_changed` (ids, não nomes); PUT por `socio`, `empresa`, `tecnico` ⇒ 403; PUT com id que não é socio ⇒ 400; PUT em tenant de parceiro ⇒ 404; `user_ids` repetidos ou > 5 ⇒ 400; `GET /atuacao/equipe` devolve só sócios ativos.

- [ ] **Step 2: Implementar.** `ficha()` acrescenta `SELECT o.user_id AS id, s.full_name FROM tenant_owners o JOIN list_socios() s ON s.id = o.user_id WHERE o.tenant_id = $1`. `listar()` aceita `meus` (`EXISTS (SELECT 1 FROM tenant_owners o WHERE o.tenant_id = t.id AND o.user_id = $2)`). A rota admin usa `req.withTenantContext` (contexto `admin`); valida cada id com `list_socios()`, valida o tenant com `SELECT 1 FROM tenants WHERE id=$1 AND is_montese_tenant(id)`, faz `DELETE FROM tenant_owners WHERE tenant_id=$1` + `INSERT ... SELECT unnest($2::uuid[])` na mesma transação do contexto. `ListarClientesQuery` ganha `@IsOptional() @IsIn(['true']) meus?: string`.

- [ ] **Step 3: Rodar** unit + e2e + `socio-controller-sweep` (a rota admin não pode listar `socio` em `@Roles`) + regressão da Fase 2 (`atuacao-carteira`). `npm run build`.

- [ ] **Step 4: Checkpoint** — listar arquivos.

---

### Task 5: Frontend — tarefas, KPIs e responsáveis

**Files:**
- Modify: `frontend/src/lib/dashboard/menu-atuacao.ts`, `frontend/src/app/atuacao/page.tsx`, `frontend/src/app/atuacao/clientes/[tenantId]/page.tsx`, `frontend/src/app/atuacao/api.ts` (helpers)
- Create: `frontend/src/app/atuacao/tarefas/page.tsx`, `frontend/src/app/atuacao/tarefas/[id]/page.tsx`
- Test: `frontend/src/app/atuacao/__tests__/tarefas.test.tsx`

**Interfaces:**
- Consumes: API da Task 3 e 4; helpers de `api.ts` da Fase 2 (token, `/api/atuacao`, 401 ⇒ limpa sessão e vai a `/login`, 403 ⇒ "Você não tem permissão para esta ação.").

- [ ] **Step 1: Testes que falham (Vitest)**, cobrindo:
  - Menu ganha "Minhas tarefas" (`/atuacao/tarefas`); permanece só com rotas existentes.
  - Lista: carrega `assignee=me` por padrão; alternar "Todas" chama sem `assignee`; filtros de status e "Somente vencidas" enviam os parâmetros; tarefas do outro sócio têm marcação visual distinta (texto "de {nome}", não só cor); vencida mostra o selo "Vencida"; estado vazio e erro com "Tentar novamente"; **sem corrida** (resposta antiga não sobrescreve a nova — mesmo padrão `useRef` da lista de clientes).
  - Criar tarefa (formulário com cliente — select alimentado por `GET /atuacao/clientes` —, título, responsável — select de `GET /atuacao/equipe` —, prazo, prioridade): envia exatamente os campos preenchidos; 400/403 mantêm o formulário com mensagem clara.
  - Detalhe: mostra campos, histórico em ordem, e ações de status **somente as transições permitidas** (replicar a tabela de `tarefa-status.ts` em constante do frontend apenas para UX; o servidor decide); bloquear/cancelar abre campo de motivo obrigatório; concluir não exibe nada sobre aprovar/assinar documento.
  - Painel: KPIs "Minhas tarefas abertas", "Vencidas", "Para hoje" e "Bloqueadas" vindos de `/atuacao/tarefas/resumo` (sem números fictícios; erro tratado).
  - Ficha do cliente: lista os responsáveis (texto), com link "Ver tarefas deste cliente" (`/atuacao/tarefas?tenantId=...`); sem edição de responsáveis (isso é do admin).
Run: `cd /opt/Montese/frontend && npx vitest run src/app/atuacao` → FAIL.

- [ ] **Step 2: Implementar** seguindo os padrões da Fase 2 (casca `AtuacaoShell`, `RoleGuard allow={['socio']}` já no layout, `AsyncBody`, `KpiCard`, `PageHeader`, `Badge`). Acessibilidade: labels, `role="alert"`, foco visível, tabela vira cartões abaixo de `md`, nada de scroll horizontal da página no mobile. Datas exibidas em pt-BR (`dd/mm/aaaa`), sem converter fuso do `due_date` (é `DATE`).

- [ ] **Step 3: Rodar** `npx vitest run src/app/atuacao`, `npx vitest run`, `npx tsc --noEmit`, `npm run build` → sem erros. QA visual: NÃO VERIFICADO a menos que o ambiente permita (memória `project_visual_qa_tooling`).

- [ ] **Step 4: Checkpoint** — listar arquivos.

---

### Task 6: Verificação final da Fase 3A

- [ ] **Step 1:** unit completo (`jest-unit.json`; esperado: só `r2-get-object` falhando, pré-existente), `tsc`, `npm run build`.
- [ ] **Step 2:** via runner descartável: `atuacao-tarefas atuacao-carteira socio-access-matrix subscription-status-guard tenant-isolation-sweep admin-dashboard-financeiro auth`.
- [ ] **Step 3:** `cd /opt/Montese/frontend && npx vitest run && npx tsc --noEmit`.
- [ ] **Step 4:** adicionar bloco "Fase 3A — evidências" ao `docs/superpowers/audits/2026-10-19-painel-atuacao-fase0.md` e atualizar a memória `project_painel_atuacao_socios.md`.
- [ ] **Step 5:** parar para o proprietário: commit; aplicação das migrations `0090–0093` em produção (backup + autorização; pré-requisito: o role que roda a migration ser membro de `montese_auth_bypass`); criação das contas dos sócios (senha lida de variável de ambiente) e concessão de `clients.read`, `clients.update_operational`, `tasks.read`, `tasks.write`; atribuição de responsáveis por cliente via API admin (ainda sem tela).

---

## Auto-revisão contra a spec

- **§5 (tarefas):** cliente, título, descrição, criador, responsável, prioridade, status, criação, prazo, histórico, categoria — Tasks 1–3. Estados da spec — Task 2. "Concluir não aprova nem assina" — restrição global (sem vínculo com documentos).
- **§7 (usabilidade):** filtros por cliente/responsável/status/período parcial (cliente, responsável, status, vencidas; período fica para a 3B junto com a agenda), prazos vencidos e bloqueadas, abrir cadastro a partir da tarefa (link no detalhe — incluir no Step 2 da Task 5), tarefas próprias × dos demais, histórico, mensagens de negação — Tasks 3 e 5.
- **§6 (auditoria):** criação, reatribuição e conclusão de tarefas — Task 3; troca de responsáveis por cliente — Task 4.
- **§2.2:** `tasks.read`/`tasks.write` já existem em `PERMISSIONS`; nenhuma permissão nova.
- **Fora desta parte:** agenda, interações, anexos, tela de admin para responsáveis, notificações.
- **Riscos declarados:** (1) `list_socios()` depende do dono `montese_auth_bypass` em produção — NÃO VERIFICADO; (2) `due_date` usa o fuso `America/Sao_Paulo` para "vencida" — INFERIDO como regra de negócio correta; (3) sem DELETE de tarefa por desenho (cancelar); (4) qualquer sócio com `tasks.write` pode editar tarefas de outro — decisão assumida para a carteira compartilhada (RECOMENDADO confirmar com o proprietário).
