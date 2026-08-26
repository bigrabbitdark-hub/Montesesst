# Fase 7 (sub-projeto A) — Gestão de tenants e vínculos

> Primeiro sub-projeto da Fase 7 (Dashboard Admin). Decisão confirmada em
> brainstorming de 2026-08-26: entre as frentes possíveis (gestão de
> tenants/vínculos, planos/assinaturas, visão geral/métricas), a gestão
> de tenants e vínculos vem primeiro — substitui as chamadas de API
> manuais que a Montese faz hoje pra cada nova empresa/técnico/parceiro.

## 1. Objetivo e escopo

O papel `admin` existe no banco desde a Fase 1 (`user_role` inclui
`'admin'`, RLS de toda tabela multi-tenant já tem bypass explícito pra
essa role), mas nunca teve tela própria nem, na prática, nenhum usuário
real — hoje não existe uma única linha com `role = 'admin'` na tabela
`users` em produção, e toda ação administrativa (criar técnico/parceiro,
vinculá-los a uma empresa) é feita chamando a API diretamente.

Esta entrega dá à Montese uma área `/admin/*` com três telas: lista de
empresas (somente leitura, com os vínculos técnico/parceiro agregados),
lista de técnicos (com criação e vínculo a empresa) e lista de parceiros
(mesmo padrão). A criação de técnico/parceiro e o vínculo a uma empresa
já existem como endpoints (`POST /technicians`, `POST /partners`,
`POST /technicians/:id/assign`, `POST /partners/:id/assign`, todos já
aceitando `tenant_id` explícito quando o chamador é admin) — o trabalho
real aqui é dar acesso ao papel `admin` (que hoje não existe de fato) e
construir a interface.

**Não é objetivo desta entrega:**
- Criar empresa manualmente — empresas continuam vindo só do
  autocadastro público (`/cadastro`). Decisão confirmada em
  brainstorming: "só listar/visualizar" venceu sobre dar ao admin um
  formulário de criar tenant.
- Desvincular ou desativar qualquer entidade (empresa, técnico, parceiro,
  vínculo) — decisão confirmada: "só vincular" venceu; desvincular fica
  para um sub-projeto seguinte da Fase 7, mesmo padrão de adiamento
  controlado usado no resto do projeto (ex.: catálogo de EPI adiado três
  vezes antes de ganhar sua própria entrega).
- Planos, preços e assinaturas (`plans`/`subscriptions`) — frente
  separada, não escolhida como prioridade nesta rodada de brainstorming.
- Métricas agregadas (contagem de empresas ativas, inspeções no mês,
  etc.) — frente separada, idem.
- Trilha de auditoria (`audit_log`) — já tem RLS pronta pra admin desde a
  Fase 1 (`0002_audit_log.sql`), mas nenhuma tela — fora de escopo aqui.
- Auto-cadastro de admin ou fluxo de convite — a primeira (e, por ora,
  única) conta admin é provisionada manualmente, ver seção 5.

## 2. Backend — um endpoint novo, dois ganham campos

### `GET /tenants` (novo, `@Roles('admin')`)

Hoje `backend/src/tenants/tenants.controller.ts` só tem `GET /tenants/me`
(`@Roles('empresa')`, restrito ao próprio tenant do chamador). Adiciona-se
`GET /tenants`, sem parâmetro, que devolve todos os tenants com os
vínculos técnico/parceiro agregados (um tenant pode ter mais de um
técnico e mais de um parceiro vinculado — `tenant_technicians` e
`tenant_partners` são muitos-para-muitos):

```sql
SELECT
  t.id, t.name, t.cnpj, t.plan, t.status, t.created_at,
  COALESCE(
    (SELECT json_agg(jsonb_build_object('id', tech.id, 'name', tu.full_name))
     FROM tenant_technicians tt
     JOIN technicians tech ON tech.id = tt.technician_id
     JOIN users tu ON tu.id = tech.user_id
     WHERE tt.tenant_id = t.id AND tt.status = 'ativo'),
    '[]'
  ) AS technicians,
  COALESCE(
    (SELECT json_agg(jsonb_build_object('id', p.id, 'name', pu.full_name))
     FROM tenant_partners tp
     JOIN partners p ON p.id = tp.partner_id
     JOIN users pu ON pu.id = p.user_id
     WHERE tp.tenant_id = t.id AND tp.status = 'ativo'),
    '[]'
  ) AS partners
FROM tenants t
ORDER BY t.created_at DESC
```

(Subqueries correlacionadas em vez de `LEFT JOIN` + `GROUP BY` — evita
duplicar linhas de `tenants` quando um tenant tem vários vínculos, sem
precisar de `DISTINCT`/agregação sobre colunas não agregadas.)

`admin` já tem bypass de RLS em `tenants` desde a Fase 1
(`0001_init.sql`), então nenhuma policy nova é necessária — o endpoint só
precisa existir e estar atrás de `@Roles('admin')`.

### `GET /technicians` e `GET /partners` ganham `full_name`/`email`

Hoje `TechniciansService.findAll`/`findOne` fazem `SELECT * FROM
technicians` — sem `full_name`/`email`, que vivem em `users`. Nenhuma
tela hoje precisa desses campos (o técnico só vê o próprio registro via
`/tenant-technicians/me`, que já traz o nome do outro lado). Como
`/admin/tecnicos` precisa mostrar algo identificável além de um UUID,
`findAll`/`findOne` passam a fazer `JOIN users ON users.id =
technicians.user_id` e a interface `Technician` ganha `full_name: string`
e `email: string`. Mudança aditiva — nenhum campo existente sai, nenhum
consumidor atual quebra. Mesma mudança em `PartnersService`/`Partner`.

## 3. Frontend

### Login

`frontend/src/app/(site)/login/page.tsx` — o `if/else` de redirect por
`role` ganha um branch: `role === 'admin'` → `/admin/empresas` (no lugar
do fallback genérico `'/'`, que hoje é o destino de fato porque nenhum
usuário admin jamais logou).

### Três páginas novas, mesmo padrão "lista + formulário inline" do `EpisPanel`

- `frontend/src/app/admin/empresas/page.tsx` — `GET /tenants`, tabela
  somente leitura: nome, CNPJ, plano (`tenants.plan`), status, técnicos
  vinculados (nomes), parceiros vinculados (nomes). Sem ação de escrita.
- `frontend/src/app/admin/tecnicos/page.tsx` — `GET /technicians`
  (tabela com nome/e-mail/especialização/status) + formulário "Criar
  técnico" (`POST /technicians`, campos: e-mail, senha, nome, telefone
  opcional, registro opcional, especialização opcional) + ação por linha
  "Vincular a empresa" (seletor de tenant vindo de `GET /tenants` +
  `POST /technicians/:id/assign` com `{ tenant_id }`).
- `frontend/src/app/admin/parceiros/page.tsx` — mesmo padrão com
  `GET /partners`/`POST /partners`/`POST /partners/:id/assign` (campos:
  e-mail, senha, nome, telefone opcional, região de atendimento).

### Navegação

Sem shell/layout novo — as três páginas trocam entre si por um menu
simples de três links no topo de cada uma (Empresas / Técnicos /
Parceiros), mesmo espírito do menu que já existe em `/tecnico/*`.

### Guarda de acesso

Mesmo padrão mínimo de `/tecnico/*` — cada página só verifica se existe
`montese_token` no `localStorage` (se não, `router.push('/login')`); não
há checagem de `role` no cliente. A autorização real é o backend
(`@Roles('admin')` em `GET /tenants` e nos endpoints de escrita) — um
usuário não-admin que navegue manualmente pra `/admin/empresas` recebe
403 em cada fetch, mesma defesa em profundidade usada em toda a Fase 6.

## 4. Provisionamento da primeira conta admin

Sem endpoint de cadastro (diferente de técnico/parceiro, que têm `POST
/technicians`/`POST /partners`) — decisão confirmada em brainstorming:
"insert manual documentado" venceu sobre um script CLI reexecutável, já
que só um punhado de pessoas da Montese será admin.

Uma task do plano de implementação:
1. Gera o hash bcrypt (custo 10, mesmo padrão de
   `TechniciansService.create`) rodando `node -e "..."` dentro do
   container do backend.
2. Documenta o `INSERT INTO users (role, email, password_hash, full_name,
   status) VALUES ('admin', $1, $2, $3, 'ativo')` — com `tenant_id NULL`
   (constraint `0001_init.sql:41` já permite `role IN
   ('tecnico','parceiro','admin')` sem tenant) — num runbook novo,
   `docs/operations/admin-provisioning.md`, no mesmo diretório de
   `backups.md`/`reliability.md`.
3. Executa esse INSERT uma vez em produção pra criar a primeira conta
   real, usada depois pra validar o fluxo de login → `/admin/empresas`
   manualmente.

## 5. Testes

Mesmo padrão do resto do projeto — e2e reais contra Postgres real
(containers desta VPS), sem mock:

- `GET /tenants`: `admin` vê todos os tenants existentes, com vínculos
  agregados corretos — casos com 0, 1 e 2+ técnicos/parceiros vinculados
  ao mesmo tenant. `empresa`/`tecnico`/`parceiro` recebem 403.
- `GET /technicians`/`GET /partners`: resposta inclui `full_name`/`email`
  corretos (join com `users`); teste de regressão confirmando que nenhum
  campo pré-existente (`registration_number`, `specialization`, `status`,
  etc.) sumiu da resposta.
- `POST /technicians` e `POST /technicians/:id/assign` chamados como
  `admin` com `tenant_id` explícito continuam funcionando (cobertura já
  existe desde a Fase 1/6B — só confirmar que não regrediu). Mesmo para
  `partners`.
- Build isolado do frontend (`docker run node:20-alpine npm run build`).
  Sem teste de navegador ao vivo — mesma ressalva de sempre (containers
  de produção compartilhados com trabalho visual não commitado de sessão
  paralela); o login manual com a conta provisionada na seção 4 é a
  única verificação ao vivo prevista.

## 6. Decisões confirmadas (brainstorming de 2026-08-26)

- Frente escolhida entre as opções possíveis da Fase 7: gestão de
  tenants e vínculos (não planos/assinaturas, não métricas).
- Provisionamento do admin: insert manual documentado em runbook, sem
  endpoint de cadastro novo.
- Empresas: só listar/visualizar — sem formulário de criar tenant.
- Vínculo técnico/parceiro↔empresa: só vincular — sem desvincular ou
  desativar nesta entrega.
- Estrutura de telas: área `/admin/*` nova e própria (não abas dentro de
  uma página só, não reaproveitamento de `/tecnico/*` — público
  claramente diferente, equipe interna Montese).

## 7. Pendências

Registradas aqui para não se perderem, mas deliberadamente fora desta
entrega:
- Desvincular/desativar empresa, técnico ou parceiro pela tela.
- Criar empresa manualmente pela tela do admin.
- Planos e assinaturas (visualizar/editar preços, status de assinatura
  por tenant/técnico) — a migration `0006_plans_subscriptions.sql` já
  citava "futuramente uma tela de admin (Fase 7)" como motivação
  original.
- Visão geral/métricas agregadas.
- Tela de trilha de auditoria (`audit_log` já tem RLS pronta pra admin
  desde a Fase 1, só falta a tela).
- Fluxo de convite/auto-cadastro de novas contas admin, caso a equipe
  Montese cresça além de "um punhado de pessoas".
