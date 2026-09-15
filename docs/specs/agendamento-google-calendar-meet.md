# Agendamento de Reunião/Visita — Google Calendar + Meet

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-15.
> Sub-projeto 2 da mensagem original que também gerou o "Relatório de
> Visita Técnica" (já fechado): "vamos adicionar o agendamento para
> reunião com o técnico ou uma visita, vamos usar google calendar e
> google meet, vamos adicionar na area de menu lateral e deixar
> funcional". Foi deliberadamente decomposto pra fora daquela spec e
> fica coberto aqui.
>
> **Achado central do brainstorming**: existe, desde a Fase 11
> (`backend/src/visits/`), um sistema completo de "empresa solicita,
> técnico confirma" — tabela `visit_requests` (status
> solicitado/confirmado/concluído/cancelado, `preferred_date`,
> `confirmed_date`, `motivo`, link opcional pra uma Inspeção),
> endpoints completos (`POST /visits`, `PATCH /visits/:id/confirmar` —
> já permite o técnico confirmar uma data **diferente** da sugerida —,
> `/cancelar`, `/concluir`), `TechnicianAgendaService.getMyDay()`
> (agrega "próximas visitas" + "pendentes de confirmar") e um cron de
> lembrete por e-mail 1 dia antes (`visit-reminder.cron.ts`). **Zero uso
> no frontend**, em nenhum dos dois lados. Esta spec não cria um sistema
> de agendamento do zero — estende essa base já testada e liga o
> Google Calendar/Meet e o frontend por cima.
>
> **Colisão de nome resolvida em brainstorming**: `/tecnico/agenda`
> já existe no menu do técnico, mas mostra vencimentos de
> documentos/EPI, não compromissos marcados. Renomeada pra "Vencimentos"
> nesta spec, liberando o nome "Agenda" pra tela nova de compromissos.

## 1. Objetivo e escopo

Permite que uma empresa solicite uma reunião (virtual, com Google Meet)
ou visita (presencial, numa filial) com o técnico ou parceiro vinculado
a ela, o técnico/parceiro confirme (podendo propor outro horário), e o
compromisso confirmado apareça automaticamente no Google Calendar
pessoal do técnico — com link do Meet quando for reunião.

Fecha 4 lacunas reais entre o que `visit_requests` já suporta desde a
Fase 11 e o que existe hoje:

1. **Horário do dia**: a tabela só guarda `DATE`, sem hora.
2. **Tipo de compromisso**: reunião (virtual) vs. visita (presencial) —
   não existe distinção hoje, tudo é implicitamente "visita".
3. **Filial**: nenhum vínculo com `company_units` — necessário pra uma
   visita presencial saber onde é.
4. **Integração com o Google**: 100% nova — OAuth por técnico,
   armazenamento/renovação de token, criação de evento com Meet.

E adiciona a capacidade nova: frontend completo dos dois lados (hoje
inexistente) e a integração de fato com o Google.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **OAuth individual por técnico** — cada técnico conecta sua própria
  conta Google (não uma conta de serviço única da Montese). O evento
  aparece na agenda pessoal dele, com ele como organizador.
- **Empresa solicita, técnico confirma** — a empresa sugere
  técnico/parceiro + tipo + data/hora preferida + motivo (+ filial se
  for visita); o técnico/parceiro vê o pedido e confirma um horário
  (o mesmo sugerido ou outro, digitado livremente — sem checar
  disponibilidade real do Google Calendar nesta fase).
- **Tipo escolhido pela empresa no pedido** — `reuniao` gera Meet,
  `visita` não gera Meet e exige filial.
- **Evento no Google criado automaticamente ao confirmar** — mesmo
  padrão de "acontece sozinho" já usado no projeto (PDF de visita
  técnica, planos de ação gerados ao concluir inspeção). Falha ao criar
  o evento (rede, token expirado, Google fora do ar) **nunca** impede a
  confirmação no Montese — só fica sem `google_event_id`/
  `google_meet_link`, logado como warning.
- **Só técnico conecta Google nesta fase, não parceiro** —
  `technician_user_id` em `visit_requests` pode apontar pra um técnico
  OU um parceiro (mesmo padrão de `isTechnicianLinked`), mas só técnico
  ganha a tela de conectar Google. Parceiro confirma normalmente, sem
  gerar evento no Google.
- **Sem sincronização de volta** — cancelar/reagendar no Montese depois
  de o evento já ter sido criado no Google não atualiza nem apaga o
  evento lá. Fica como follow-up.
- **Renomear `/tecnico/agenda` pra "Vencimentos"** — libera "Agenda" pra
  esta feature nova no menu do técnico.

## 3. Modelo de dados

### Migration nova: `visit_requests` ganha colunas (todas nullable/com
default, não quebra as visitas já existentes)

```sql
ALTER TABLE visit_requests ADD COLUMN type TEXT NOT NULL DEFAULT 'visita'
  CHECK (type IN ('reuniao', 'visita'));
ALTER TABLE visit_requests ADD COLUMN preferred_time TIME;
ALTER TABLE visit_requests ADD COLUMN confirmed_time TIME;
ALTER TABLE visit_requests ADD COLUMN company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL;
ALTER TABLE visit_requests ADD COLUMN google_event_id TEXT;
ALTER TABLE visit_requests ADD COLUMN google_meet_link TEXT;
```

`company_unit_id` é validado como obrigatório-a-nível-de-DTO só quando
`type = 'visita'` (mesmo padrão condicional já usado no formulário de
Inspeções — validação de "obrigatório dado outro campo" fica no DTO
com `@ValidateIf`, não no schema).

### Tabela nova: `technician_google_accounts`

```sql
CREATE TABLE technician_google_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_technician_google_accounts_updated_at
  BEFORE UPDATE ON technician_google_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE technician_google_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_google_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY technician_google_accounts_isolation ON technician_google_accounts USING (
  current_setting('app.role', true) = 'admin'
  OR technician_user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
);
```

Só o próprio técnico (ou admin) pode ver/gerenciar sua própria conexão
— nenhuma empresa ou parceiro precisa enxergar essa linha.

`refresh_token_encrypted`: primeira credencial de terceiro armazenada
neste banco — o projeto não tem hoje nenhum utilitário de
criptografia em repouso. Novo módulo `common/crypto/secret-crypto.util.ts`
(AES-256-GCM, chave de 32 bytes em `GOOGLE_TOKEN_ENCRYPTION_KEY` no
`.env`, gerada uma vez com `openssl rand -hex 32`). Nunca logar o valor
decriptado; nunca devolver em nenhuma resposta de API (só
`google_email`/`connected_at` são expostos por `GET
/google-calendar/status`).

## 4. Backend

### DTOs

`CreateVisitDto` ganha:

```typescript
@IsIn(['reuniao', 'visita'])
type: 'reuniao' | 'visita';

@IsOptional()
@Matches(/^\d{2}:\d{2}$/)
preferred_time?: string;

@ValidateIf((dto) => dto.type === 'visita')
@IsUUID()
company_unit_id?: string;
```

`ConfirmVisitDto` ganha `confirmed_time` opcional (mesmo `@Matches`).

### `GET /tenant-technicians/minha-empresa` (endpoint novo)

Hoje só existe o inverso (`GET /tenant-technicians/me`, técnico lista
suas empresas). A empresa precisa listar os técnicos/parceiros
vinculados a ela pra escolher com quem agendar — novo método em
`TenantTechniciansService`, `@Roles('empresa')`, devolve
`{ user_id, full_name, role: 'tecnico' | 'parceiro' }[]` unindo
`tenant_technicians`+`technicians`+`users` e
`tenant_partners`+`partners`+`users`, filtrado por `status = 'ativo'`.

### Módulo novo `google-calendar`

Usa `googleapis` (adicionar como dependência — não instalado hoje).

- `GoogleCalendarService`:
  - `getAuthUrl(technicianUserId): string` — gera a URL de consentimento
    OAuth (scope `https://www.googleapis.com/auth/calendar.events`),
    com `state` assinado (JWT curto, reaproveita `JWT_SECRET`) contendo
    `technicianUserId` — evita precisar de sessão/cookie no callback.
  - `handleCallback(code, state): Promise<void>` — valida o `state`,
    troca o código pelo refresh token, busca o e-mail da conta Google
    (`oauth2.userinfo.get`), criptografa e faz `UPSERT` em
    `technician_google_accounts`.
  - `disconnect(technicianUserId): Promise<void>` — apaga a linha.
  - `getStatus(technicianUserId): Promise<{connected: boolean, google_email?: string}>`.
  - `createEvent(technicianUserId, params): Promise<{eventId, meetLink} | null>`
    — decripta o refresh token, monta um `OAuth2Client`, chama
    `calendar.events.insert` com `conferenceData.createRequest` só
    quando `params.type === 'reuniao'`. Devolve `null` (não lança) se o
    técnico não tem conta conectada — quem chama decide o que fazer.

- `GoogleCalendarController`:
  - `GET /google-calendar/auth-url` (`@Roles('tecnico')`)
  - `GET /google-calendar/callback` (sem guard de role — o `state`
    assinado é a prova de identidade nesse redirect vindo do Google)
  - `GET /google-calendar/status` (`@Roles('tecnico')`)
  - `DELETE /google-calendar/desconectar` (`@Roles('tecnico')`)

### `VisitsService.confirm()` — extensão

Depois de `UPDATE ... SET status = 'confirmado'`, chama
`this.googleCalendar.createEvent(...)` dentro de um `try/catch` que só
loga (`this.logger.warn`) e nunca relança — a confirmação já está
persistida e não deve ser desfeita por uma falha de rede com o Google
(diferente do caso do PDF na Task 3 do Relatório de Visita Técnica, não
precisa de `SAVEPOINT` aqui: a chamada ao Google acontece **depois** do
`UPDATE`, não durante uma transação com mais passos depois dela — se
falhar, não há nada que já tenha rodado nesta transação pra reverter
além do próprio `UPDATE`, que deve mesmo ficar de pé). Se
`createEvent` devolver um evento, um segundo `UPDATE` grava
`google_event_id`/`google_meet_link` na mesma linha.

### `visit-reminder.cron.ts`

Sem mudança de lógica — só o template do e-mail passa a incluir o link
do Meet quando `google_meet_link` não for nulo.

## 5. Frontend

### Sidebar do técnico (`TecnicoSidebar.tsx`)

- `/tecnico/agenda` (existente) renomeado pra **"Vencimentos"** no
  rótulo do menu (rota/arquivo continuam iguais — só o texto do link
  muda).
- Item novo **"Agenda"** (fica com o emoji 📅 que "Vencimentos" usava)
  aponta pra `/tecnico/agendamentos` (paralelo ao nome da rota do lado
  empresa, §5) — lista "Pedidos pendentes de confirmar" e
  "Próximos compromissos" (reaproveitando `getMyDay()`, que já separa
  exatamente essas duas listas), com ações de confirmar (input de
  data/hora, pré-preenchido com o preferido) e cancelar.
- Tela/seção de configurações do técnico ganha "Conectar Google
  Calendar" — mostra e-mail conectado + botão desconectar, ou botão
  conectar (redireciona pra `auth-url`, volta via `callback`).

### Sidebar da empresa (`EmpresaSidebar.tsx`)

- Item novo, grupo "Segurança": **"Reuniões e Visitas"** →
  `/empresa/agendamentos` — formulário de solicitação (técnico/parceiro
  via `GET /tenant-technicians/minha-empresa`, tipo reunião/visita,
  data/hora preferida, filial — só aparece se tipo=visita, via
  `company_units` já usado noutras telas — e motivo) + lista das
  solicitações da empresa com status e link do Meet quando existir.

## 6. Pré-requisito externo (só o fundador pode fazer)

Criar um projeto no Google Cloud Console com tela de consentimento
OAuth e credenciais "OAuth 2.0 Client ID" tipo "Web application",
`redirect_uri` apontando pra
`https://montesesst.com.br/api/google-calendar/callback`, scope
`calendar.events`. O plano de implementação vai incluir o passo a
passo exato — a criação em si é uma ação fora deste ambiente.

## 7. Testes

Backend: e2e reais (mesmo padrão do resto do projeto) cobrindo criação
de solicitação (reunião exige preferred_time, visita exige
company_unit_id), confirmação com horário diferente do sugerido,
cancelamento, RLS de `technician_google_accounts` (um técnico não
enxerga o token de outro), `createEvent` mockado via
`overrideProvider` (nenhuma chamada real ao Google em teste — mesmo
padrão de `R2Service` mockado no teste de resiliência do PDF), e o
caminho de resiliência (Google falha, confirmação continua de pé,
`google_event_id` fica null). Frontend: sem test runner automatizado,
verificação manual real em produção via Playwright — incluindo o fluxo
de conectar Google de verdade (usando uma conta de teste real, já que
é OAuth externo e não pode ser mockado no browser).

## 8. Fora de escopo

- Ver disponibilidade real (free/busy) do Google Calendar do técnico
  antes de a empresa escolher horário.
- Editar/apagar o evento no Google quando a visita é cancelada ou
  reagendada no Montese depois de já confirmada.
- Parceiro conectar Google (só técnico nesta fase).
- Notificação por Google Calendar nativa (convite automático pro
  e-mail da empresa como convidado do evento) — o e-mail de lembrete já
  existente (`visit-reminder.cron.ts`) continua sendo o canal, só ganha
  o link do Meet.
