# Fase 11 — Agenda de Visitas + "Meu Dia" do técnico

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-01.
> Terceiro sub-projeto da frente "Agentes + IA" (ver `docs/vision.md` e o
> brainstorming de 2026-08-28 que gerou as Fases 9 e 10). Corresponde ao
> item "Copiloto do técnico/Meu dia" da visão original — mas, diferente
> das Fases 9/10, esta fase não envolve nenhuma chamada de IA: é
> agendamento real de visita técnica (empresa solicita, técnico/parceiro
> confirma com data) mais um painel agregado ("Meu Dia") combinando essa
> agenda com as pendências das empresas vinculadas ao técnico.

## 1. Objetivo e escopo

Hoje não existe nenhum conceito de "visita futura" no sistema —
`inspections` só registra o relatório de uma visita **depois** de feita
(`status` `rascunho`/`concluida`), sem data de agendamento. Esta fase
adiciona:

1. Um fluxo de solicitação/confirmação de visita técnica, com data real.
2. Uma página "Meu Dia" pro técnico (responsável ou parceiro): agenda de
   visitas + pendências agregadas de todas as empresas vinculadas a ele,
   numa visão só.
3. Lembrete automático por e-mail no dia anterior à visita confirmada.

**Decisões já fechadas em brainstorming, não reabrir sem motivo novo:**

- Fluxo de estado: **empresa solicita → técnico/parceiro confirma**
  (não o inverso, não os dois simultâneos).
- Vale pra **técnico responsável e técnico parceiro** (não só parceiro).
- Visita agendada tem **vínculo opcional** com um registro de
  `inspections` (não são a mesma entidade, não são independentes).
- **Sem recorrência** nesta fase — toda visita é solicitada/confirmada
  individualmente. Uma regra de "repetir todo mês" fica para uma fase
  futura, se a demanda confirmar que vale a pena.
- "Meu Dia" **combina** agenda de visitas com pendências agregadas —
  não é só um calendário.

**Fora de escopo desta fase:**

- Qualquer chamada de IA — isto é agendamento determinístico, sem
  Assistente/Copiloto envolvido.
- Recorrência de visitas (ver acima).
- Notificação por outro canal além de e-mail (push, WhatsApp) — o
  e-mail já cobre o caso de uso mínimo; outros canais entram se/quando
  fizerem falta.
- Reagendamento automático em caso de conflito de agenda — o técnico
  resolve manualmente (cancela e o ciclo recomeça).

## 2. Reaproveitamento (sem infraestrutura nova)

- **RLS**: a policy da tabela nova copia, sem inventar nada, o padrão
  já em produção em `documents`/`inspections`/`action_plans`
  (`backend/db/migrations/0011_partner_access.sql`) — branch admin,
  branch empresa via `tenant_id`, branch técnico via
  `tenant_technicians`, branch parceiro via `tenant_partners`.
- **Identidade do técnico**: `technicians.user_id` e `partners.user_id`
  já referenciam `users(id)` de forma única — a tabela nova guarda um
  único `technician_user_id UUID REFERENCES users(id)`, não dois FKs
  separados por papel.
- **E-mail**: `EmailService.send()` (`backend/src/common/email/email.service.ts`)
  já existe e é genérico (hoje só usado pra confirmação de cadastro) —
  reaproveitado tal como está, sem mudança.
- **Cron**: `@nestjs/schedule` já está no projeto e em uso
  (`normative-monitor.service.ts`, Fase 9) — o job de lembrete usa o
  mesmo padrão, não é a primeira tarefa agendada do sistema.
- **"Meu Dia"**: reaproveita `DashboardService.getSummary(client,
  tenantId)` (`backend/src/dashboard/dashboard.service.ts`) **verbatim**,
  chamado uma vez por empresa vinculada ao técnico — zero mudança
  nesse serviço, mesmo padrão de reaproveitamento total já usado na
  Fase 10 com o Agente Operacional.
- **Padrão de controller/rotas**: segue exatamente o estilo de
  `inspections.controller.ts` — `@Roles(...)`, `req.withTenantContext(...)`,
  `ValidationPipe` com `transform/whitelist/forbidNonWhitelisted`, verbo
  de ação em português na rota (`/concluir`, não `/complete` — o
  precedente já existe em `inspections/:id/concluir`).

## 3. Modelo de dados

Migration nova: `backend/db/migrations/0022_visit_requests.sql`.

```sql
CREATE TABLE visit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  technician_user_id UUID NOT NULL REFERENCES users(id),
  requested_by_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'solicitado'
    CHECK (status IN ('solicitado', 'confirmado', 'concluido', 'cancelado')),
  preferred_date DATE,
  confirmed_date DATE,
  motivo TEXT,
  inspection_id UUID REFERENCES inspections(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX visit_requests_technician_idx ON visit_requests (technician_user_id);
CREATE INDEX visit_requests_tenant_idx ON visit_requests (tenant_id);
CREATE INDEX visit_requests_confirmed_date_idx ON visit_requests (confirmed_date)
  WHERE status = 'confirmado';

CREATE TRIGGER trg_visit_requests_updated_at BEFORE UPDATE ON visit_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE visit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY visit_requests_isolation ON visit_requests USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = visit_requests.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = visit_requests.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);
```

`preferred_date`/`confirmed_date` são `DATE`, não `TIMESTAMPTZ` — o
agendamento é por dia, não por horário exato (mesmo grão que
`documents.expires_at`/`tenant_epis.ca_valid_until`, já usados pelo
`DashboardService`). Se o fundador quiser hora exata numa fase futura,
é uma migration própria, não decidido aqui.

**Máquina de estados** (transições válidas, tudo mais é rejeitado com
400):

```
solicitado  --confirmar-->  confirmado
solicitado  --cancelar-->   cancelado
confirmado  --cancelar-->   cancelado
confirmado  --concluir-->   concluido
```

`concluido` e `cancelado` são estados finais — nenhuma transição sai
deles.

## 4. API (`VisitsModule` novo)

Todas as rotas abaixo entram em `backend/src/visits/visits.controller.ts`,
seguindo o padrão de `req.withTenantContext(...)` de
`inspections.controller.ts`.

- **`POST /visits`** — `@Roles('empresa')`. Body:
  `{ technician_user_id: string, preferred_date?: string, motivo?: string }`.
  Antes de inserir, `VisitsService.create` confirma que
  `technician_user_id` corresponde a um técnico OU parceiro
  **efetivamente vinculado ao tenant do chamador** (via
  `tenant_technicians`/`tenant_partners`, `status = 'ativo'`) — se não
  estiver, `403 ForbiddenException`. Esta checagem existe porque o
  roadmap já registrou um bug real nessa mesma família de operação
  (`POST/DELETE /technicians/:id/assign` permitiu por um tempo que
  qualquer empresa se vinculasse a qualquer técnico, sem teste — ver
  `docs/roadmap.md`, Fase 4A). Cria com `status = 'solicitado'`.

- **`GET /visits`** — sem `@Roles` (todo papel autenticado acessa, RLS
  filtra). Empresa vê as da própria `tenant_id`; técnico/parceiro vê as
  suas, agregadas entre todas as empresas vinculadas (RLS já resolve
  isso, não precisa de `tenant_id` obrigatório na query como
  `inspections` exige — aqui o filtro natural já é "as minhas", não "as
  de uma empresa por vez").

- **`PATCH /visits/:id/confirmar`** — `@Roles('tecnico', 'parceiro')`.
  Body: `{ confirmed_date: string }`. Só o `technician_user_id` da
  própria visita pode confirmar (`VisitsService` compara
  `req.user.id` contra o campo — outro técnico vinculado à mesma
  empresa não pode confirmar visita alheia). Exige `status =
  'solicitado'`, senão `409 ConflictException`.

- **`PATCH /visits/:id/cancelar`** — sem `@Roles` fixo: empresa dona OU
  o `technician_user_id` da visita (checagem em `VisitsService`, não no
  decorator, porque os dois lados legítimos têm papéis diferentes).
  Exige `status IN ('solicitado', 'confirmado')`, senão `409`.

- **`PATCH /visits/:id/concluir`** — `@Roles('tecnico', 'parceiro')`,
  só o `technician_user_id` da própria visita. Body opcional:
  `{ inspection_id?: string }` — se vier, `VisitsService` confirma que
  esse `inspection_id` pertence ao mesmo `tenant_id` da visita antes de
  gravar (mesmo princípio de nunca aceitar um id sem validar que é
  "deste contexto", já visto no Verificador da Fase 9/10). Exige
  `status = 'confirmado'`, senão `409`.

Todas as rotas de mutação usam `ValidationPipe({ transform: true,
whitelist: true, forbidNonWhitelisted: true })`, igual
`inspections.controller.ts`.

## 5. "Meu Dia" — `GET /visits/me/day`

`@Roles('tecnico', 'parceiro')`. Novo `TechnicianAgendaService`:

```ts
export interface MyDayResult {
  visitas: {
    proximas: VisitRequestSummary[];   // status='confirmado', confirmed_date >= hoje, próximos 7 dias
    pendentes_de_confirmar: VisitRequestSummary[]; // status='solicitado'
  };
  empresas: {
    tenant_id: string;
    tenant_name: string;
    resumo: DashboardSummary;
  }[];
}
```

Implementação:
1. Busca `visit_requests` do próprio `technician_user_id` (RLS já
   escopa), separadas por status conforme acima.
2. Busca tenants vinculados (via `tenant_technicians` ou
   `tenant_partners`, conforme `req.user.role` — mesma query que já
   existe pra `GET /tenant-technicians/me`).
3. Pra cada tenant vinculado, chama `this.dashboard.getSummary(client,
   tenantId)` — em paralelo (`Promise.all`), mesmo padrão que o próprio
   `DashboardService.getSummary` já usa internamente pras suas
   subconsultas.
4. Retorna tudo agregado, cada resumo de empresa com `tenant_name`
   anexado (pra o frontend conseguir agrupar visualmente).

Nenhuma mudança em `DashboardService` — reaproveitado exatamente como
está, mesma decisão de design da Fase 10.

## 6. Lembrete por e-mail

Novo `VisitReminderCron`, mesmo módulo, `@Cron('0 8 * * *')` (8h da
manhã, horário do servidor — mesmo fuso já assumido pelo resto do
sistema, sem tratamento de fuso por tenant nesta fase):

1. `SELECT ... FROM visit_requests WHERE status = 'confirmado' AND
   confirmed_date = CURRENT_DATE + INTERVAL '1 day'` (join com `tenants`
   e `users`) — é um job de sistema, sem usuário autenticado, mas
   `visit_requests`/`users` têm `FORCE ROW LEVEL SECURITY` e a role da
   aplicação não tem `BYPASSRLS`; `withoutTenantContext` (sem
   `app.role` setado) filtraria todas as linhas. Por isso a consulta
   usa `db.withTenantContext({ role: 'admin' }, ...)` — o mesmo
   contexto que `TenantContextInterceptor` monta pra uma requisição
   autenticada de admin, que já é liberado em toda policy desta base,
   com `SET LOCAL` escopado à transação (sem risco de vazar pro
   próximo uso da conexão do pool) — diferente do retrieval normativo
   da Fase 9/10, cujas tabelas (`official_sources`,
   `normative_documents`, `normative_document_chunks`) não têm RLS,
   então `withoutTenantContext` funciona sem contexto ali.
2. Pra cada visita encontrada, `EmailService.send()` duas vezes: pro
   e-mail do `requested_by_user_id` (empresa) e pro e-mail do
   `technician_user_id` (técnico/parceiro) — textos diferentes
   (empresa recebe "sua visita confirmada é amanhã", técnico recebe
   "você tem visita confirmada amanhã na empresa X").
3. Falha ao enviar um e-mail específico é logada e não interrompe o
   loop — mesma postura defensiva que já existe em
   `normative-monitor.service.ts` pra não deixar uma falha isolada
   derrubar o job inteiro.

## 7. Testes

Mesma disciplina do projeto inteiro — Postgres real,
`backend/test/*.e2e-spec.ts`, sem mock de banco:

- Fluxo feliz completo: solicitar → confirmar → concluir (com e sem
  `inspection_id`).
- Empresa solicita visita pra técnico **não vinculado** ao seu tenant
  → `403` (o caso histórico citado na seção 4).
- Confirmar/cancelar/concluir fora do estado válido → `409`.
- Técnico A não confirma/cancela/conclui visita atribuída ao técnico B
  (mesmo estando ambos vinculados à mesma empresa) → `403`.
- Isolamento RLS: empresa não vê visita de outro tenant; técnico não
  vinculado a um tenant não vê visita daquele tenant.
- `GET /visits/me/day`: pendências de uma empresa vinculada nunca
  aparecem misturadas nas de outra (mesmo teste de isolamento entre
  tenants já usado na Fase 10, adaptado pra 2+ empresas vinculadas ao
  mesmo técnico).
- Cron de lembrete: dispara e-mail só pra visita `confirmado` com
  `confirmed_date` = amanhã exatamente; não dispara pra `solicitado`,
  `concluido`, `cancelado`, ou data diferente de amanhã.

## 8. Pendências

- [ ] Fuso horário por tenant/técnico (hoje assume o fuso do servidor)
      — sem indicação de que seja um problema real ainda; registrado
      caso vire.
- [ ] Recorrência de visitas — deliberadamente fora de escopo (seção
      1); entra como spec própria se a demanda confirmar necessidade.
- [ ] Reagendamento em conflito de agenda (dois compromissos no mesmo
      dia pro mesmo técnico) — nenhuma validação de conflito nesta
      fase; o técnico enxerga via "Meu Dia" e resolve manualmente.
- [ ] Canal de notificação além de e-mail (push, WhatsApp) — fora de
      escopo, ver seção 1.
