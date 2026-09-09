# Montese SST — Roadmap do MVP

> **Nota sobre este documento:** o briefing definia 8 fases independentes do MVP.
> Seguindo a prática de planejamento deste projeto, isso não vira um único plano
> gigante de tarefas — cada fase, quando chegar sua vez, ganha o próprio plano
> detalhado (passo a passo, testável, com commits). Este arquivo é o mapa de
> onde estamos, não o plano de execução de uma fase específica.

**Objetivo do MVP:** plataforma SaaS de SST multi-tenant conectando empresa
cliente, técnico responsável (remoto) e técnico parceiro (presencial), com
RLS no Postgres desde o dia 1.

**Stack confirmada:** Next.js (frontend) + NestJS (backend) + PostgreSQL 16 +
Redis + Nginx, tudo em containers Docker separados numa única VPS.

**Spec original:** ver seção "Regras não-negociáveis" abaixo (texto do
fundador, reproduzido na íntegra).

---

## ✅ Decisão confirmada: NestJS (não FastAPI)

Confirmado explicitamente pelo fundador em 2026-08-18. O briefing pedia essa
escolha justificada **antes** de codificar; isso não aconteceu formalmente
na época (o backend já tinha sido construído em NestJS antes deste roadmap
existir), mas a justificativa foi registrada e agora está confirmada:

- **TypeScript ponta a ponta** com o Next.js do frontend — mesmo tipo de
  linguagem, dá pra compartilhar DTOs/tipos entre os dois lados depois.
- **Guards/Interceptors/Pipes nativos do Nest** mapeiam quase 1:1 no padrão de
  RLS que já implementamos: `JwtAuthGuard` autentica, `RolesGuard` checa papel,
  `TenantContextInterceptor` injeta o contexto de tenant (`app.user_id`,
  `app.tenant_id`, `app.role`) em toda query via `SET LOCAL`. Em FastAPI essa
  mesma máquina (dependency injection + contexto por request) exigiria mais
  código próprio para o mesmo resultado.
- Ecossistema maduro para SaaS estruturado (módulos, DI, decorators) — reduz
  a chance de RLS "vazar" por esquecimento, porque o contexto de tenant é
  automático em toda rota, não algo que cada endpoint precisa lembrar de fazer.

**Trade-off:** se em algum momento o Copiloto de IA (fase 8) precisar de
bibliotecas Python fortes (ex: processamento de PDF/OCR mais pesado), esse
pedaço específico pode virar um microsserviço Python à parte — não precisa
reescrever o backend inteiro.

---

## Regras não-negociáveis de arquitetura (do briefing, com status atual)

| Regra | Status |
|---|---|
| PostgreSQL único banco relacional, RLS em toda tabela desde o dia 1 | ✅ Feito — `tenants`, `users`, `technicians`, `partners`, `tenant_technicians`, `tenant_partners`, `employees` todas com `FORCE ROW LEVEL SECURITY` |
| Documentos nunca no disco da VPS, sempre object storage S3-compatible externo | ⚠️ **Ainda não implementado.** Variáveis `R2_*` existem no `.env.example` mas vazias — nenhum código de upload foi escrito ainda. Vou confirmar com você antes de codificar o primeiro upload (fase 4 ou 5). |
| Postgres e Redis nunca expostos publicamente | ✅ Feito — `docker-compose.yml` não publica portas de `postgres`/`redis`, só `expose` na rede interna `internal`. Único `ports:` do compose é o `nginx` na 80. |
| Sem IA local, toda IA por API externa | ✅ N/A ainda — fase 8 não começou, nenhuma dependência de IA local foi adicionada |
| Um serviço por container Docker | ✅ Feito — 5 containers: `postgres`, `redis`, `backend`, `frontend`, `nginx` |
| Nunca apresentar mock como funcional — sempre output real de terminal/log | ✅ Seguido até agora — toda validação de RLS, CRUD e auth foi feita com `curl` real contra os containers rodando, logs do Nest mostrados, dados de teste criados e removidos via `psql` real |

---

## ✅ Risco crítico resolvido: controle de versão

Resolvido em 2026-08-17: `git init` + primeiro commit (`b8eb5bc`), 57
arquivos, `.gitignore` confirmado cobrindo `.env`/`node_modules` antes do
commit (nenhum segredo versionado). Branch `main`.

> Nota: a identidade do commit (`root@<hostname>`) foi auto-configurada pelo
> git — ajustar depois com `git config --global user.name`/`user.email` se
> quiser um autor mais descritivo; não é bloqueante.

---

## Fase 1 — Fundação: status

**Escopo original:** Docker Compose (Postgres, Redis, backend, frontend,
nginx), autenticação multi-tenant com roles, RLS desde o início.

| Item | Status | Onde |
|---|---|---|
| Docker Compose com 5 serviços, rede interna isolada | ✅ | `docker-compose.yml` |
| Postgres com role de app separada da superuser (NOSUPERUSER) | ✅ | `postgres/init/01-app-role.sh` |
| Schema core: `tenants`, `users`, `employees`, `technicians`, `partners` + tabelas de vínculo | ✅ | `backend/db/migrations/0001_init.sql` |
| RLS com policies por tabela, quebra de recursão via funções `SECURITY DEFINER` | ✅ | mesma migration |
| Login JWT + bootstrap de auth sem vazar RLS | ✅ | `backend/src/auth/` |
| Guard de autenticação global + rotas públicas (`/health`, `/auth/login`) | ✅ | `backend/src/auth/jwt-auth.guard.ts`, `common/decorators/public.decorator.ts` |
| Guard de roles (`@Roles(...)`) global | ✅ | `common/guards/roles.guard.ts` |
| Interceptor de contexto de tenant (`SET LOCAL` por request) | ✅ | `common/interceptors/tenant-context.interceptor.ts` |
| CRUD `employees` (isolado por tenant) | ✅ | `backend/src/employees/` |
| CRUD `technicians`/`partners` + vínculo com tenant (`assign`/`unassign`) | ✅ | `backend/src/technicians/`, `backend/src/partners/` |
| Nginx como proxy único de entrada (`/api` → backend, `/` → frontend) | ✅ | `nginx/conf.d/default.conf` |
| Testes automatizados | ✅ | `backend/test/*.e2e-spec.ts` — Jest+Supertest contra o Postgres real (não mock), 8 testes: login válido/inválido, isolamento RLS cross-tenant, 404 (não 403) em acesso indevido por id, bloqueio de role com 403. Rodar: ver comando no fim desta seção. |
| Seed de dados formal | ✅ | `backend/db/seed.ts` (`npm run db:seed`), idempotente via `ON CONFLICT`. Cria 2 empresas, 1 técnico, 1 parceiro, 3 employees sob domínio `@seed.montese.local` — não toca nos registros manuais legados (`Empresa A`/`Empresa B`/`Empresa Login Teste`, criados via psql antes deste script existir e ainda pendentes de limpeza manual). |
| Frontend com login funcional | ✅ | `frontend/src/app/login/page.tsx` → `POST /api/auth/login` → token em `localStorage` → redireciona. Testado via `curl` de ponta a ponta (login real retornou JWT) e build de produção (`next build`) passou com type-check. **Não testado clicando num navegador real** — sem ferramenta de browser disponível neste ambiente; recomendo você abrir `http://<vps>/login` manualmente para confirmar antes de considerar 100% fechado. |
| Controle de versão (git) | ✅ | Ver seção "Risco crítico resolvido" acima |

**Checkpoint formal da Fase 1: concluído**, com uma ressalva — o login do
frontend não foi clicado num navegador de verdade (ambiente sem browser
disponível), só validado via `curl` e build. Peço que você confirme
manualmente antes de considerarmos 100% fechado.

Comando para rodar os testes automatizados localmente (contra o Postgres do
`docker-compose.dev.yml` ou o de produção, dados de teste são sempre
isolados e limpos ao final):

```bash
docker run --rm --network montese_internal -v "$(pwd)/backend:/app" -w /app \
  -e DATABASE_URL="postgresql://<POSTGRES_APP_USER>:<POSTGRES_APP_PASSWORD>@postgres:5432/<POSTGRES_DB>" \
  -e TEST_SUPERUSER_DATABASE_URL="postgresql://<POSTGRES_SUPERUSER>:<POSTGRES_SUPERUSER_PASSWORD>@postgres:5432/<POSTGRES_DB>" \
  -e JWT_SECRET="<JWT_SECRET>" -e JWT_EXPIRES_IN="8h" -e NODE_ENV=test \
  node:20-alpine sh -c "npm install && npm run test:e2e"
```

## Fase 2 — Site institucional: status

**Escopo original:** Home, Planos, Notícias, Contato, Cadastro (CNPJ +
e-mail), Login. Spec em
[`docs/specs/fase-2-site-institucional.md`](specs/fase-2-site-institucional.md),
plano de implementação em
[`docs/plans/fase-2-site-institucional.md`](plans/fase-2-site-institucional.md).

| Item | Status | Onde |
|---|---|---|
| Home | ✅ | `frontend/src/app/(site)/page.tsx` |
| Planos | ✅ | `frontend/src/app/(site)/planos/page.tsx` — placeholder "fale conosco", valores ainda não definidos pelo fundador |
| Notícias | ✅ | `frontend/src/app/(site)/noticias/`, posts em `frontend/content/noticias/*.mdx`, sem CMS |
| Contato | ✅ | `frontend/src/app/(site)/contato/page.tsx` → `POST /contact` (backend) |
| Cadastro | ✅ **testado de ponta a ponta com e-mail real** | `frontend/src/app/(site)/cadastro/`, `POST /auth/register` + `GET /auth/confirm` (backend). Testado em 2026-08-18: cadastro real → e-mail de confirmação recebido (domínio sandbox da Resend, `onboarding@resend.dev`) → link clicado → tenant/user ativados no banco → login funcionando. |
| Login | ✅ | `frontend/src/app/login/page.tsx` — restyle Tailwind, mesmo comportamento da Fase 1 |
| Tailwind CSS + tema de marca | ✅ | Tailwind **v4** (não v3, que o plano original previa — adaptado durante a implementação) |

**Fase 2: fechada 100% em 2026-08-18.** `RESEND_API_KEY` configurada
(conta do fundador na Resend), fluxo completo de cadastro→e-mail→confirmação→login
confirmado com evidência real (query no banco mostrando `status='ativo'`,
login retornando `201`).

**Pendência não-bloqueante:** domínio próprio ainda não verificado na
Resend — `EMAIL_FROM` usa o domínio de sandbox (`onboarding@resend.dev`),
que só entrega pro e-mail da própria conta Resend. Pra enviar confirmação
pra qualquer cliente real (não só o fundador), falta verificar um domínio
próprio (registro DNS) e atualizar `EMAIL_FROM`/`CONTACT_EMAIL_TO` no
`.env` desta VPS.

**Bugs reais pegos durante a implementação** (não em revisão de código —
só apareceram testando contra Postgres/Redis/Resend reais), detalhados nos
commits desta fase: RLS bloqueando as novas funções `SECURITY DEFINER`
(faltava `GRANT` de tabela, `BYPASSRLS` não é suficiente), rate limit de
`/auth/register` dividindo contador com o limite global genérico, e o SDK
do Resend não lançando em erro de API (retorna `{error}` na resposta,
promise resolvida) — um envio que falhasse passaria como sucesso
silencioso sem essa checagem.

## Cadastro próprio de técnico: status

**Fora do roadmap original das 8 fases** — sub-projeto A da iniciativa de
pagamento (Mercado Pago) pedida pelo fundador, decomposta em
brainstorming de 2026-08-18 (pré-requisito pro sub-projeto B, planos +
assinatura, spec ainda não escrita). Spec em
[`docs/specs/cadastro-tecnico.md`](specs/cadastro-tecnico.md), plano em
[`docs/plans/cadastro-tecnico.md`](plans/cadastro-tecnico.md).

**Fechado 100% em 2026-08-19**, incluindo teste real de ponta a ponta:
cadastro de técnico via `/tecnico/cadastro` → e-mail de confirmação real
recebido (domínio sandbox `onboarding@resend.dev`) → link clicado →
`users`+`technicians` ativados no banco (confirmado via query real) →
login retornando `201`. Dado de teste removido do banco de produção
depois da validação.

Implementado via `POST /auth/register-technician` + generalização do
`GET /auth/confirm` já existente (Fase 2) — a mesma rota de confirmação
agora ativa `tenants` (empresa) ou `technicians` (técnico) conforme o
`role` do usuário, sem duplicar a lógica de token/idempotência.

**Vulnerabilidade real encontrada e corrigida na revisão final desta
entrega** (não uma falha desta feature em si — pré-existente desde a
Fase 1, mas exposta de forma nova por abrir autocadastro anônimo de
técnico): `PATCH /technicians/:id`, `/employees/:id` e `/partners/:id`
montavam o `UPDATE ... SET` a partir das chaves do corpo da requisição
sem allowlist — uma chave manipulada virava injeção de SQL no nome da
coluna. Como `tenants` não tem RLS própria, isso vazava CNPJ/nome/plano
de todas as empresas clientes através de um `RETURNING *` malicioso.
Corrigido com allowlist explícita de colunas
(`backend/src/common/safe-update.util.ts`) nos três services — provado
com um teste real rodado contra o código vulnerável antes da correção
(vazou os CNPJs de verdade) e depois (bloqueado). Pendência registrada:
o app não tem `ValidationPipe` global nem `class-validator` nos DTOs de
update existentes — hardening maior, fora do escopo deste fix urgente.

## Planos + Assinaturas (Mercado Pago): status

**Fora do roadmap original das 8 fases** — sub-projeto B da iniciativa de
pagamento (Mercado Pago) pedida pelo fundador, decomposto em brainstorming
de 2026-08-18/19 (sub-projeto A, cadastro próprio de técnico, era o
pré-requisito e foi fechado antes). Spec em
[`docs/specs/planos-assinaturas.md`](specs/planos-assinaturas.md), plano em
[`docs/plans/planos-assinaturas.md`](plans/planos-assinaturas.md).

**Implementação técnica fechada em 2026-08-19** — todas as 7 tasks de
código concluídas e revisadas (SDD, uma revisão por task, sem findings
Critical/Important pendentes):

| Task | Entrega | Status |
|---|---|---|
| 1 | Migration `plans`/`subscriptions` + função `payments_update_subscription_status` (SECURITY DEFINER) | ✅ |
| 2 | `MercadoPagoService` + `GET /api/plans?audience=` | ✅ |
| 3 | `POST /api/subscriptions` (cria preapproval real no Mercado Pago) | ✅ |
| 4 | Webhook `POST /api/payments/mercadopago/webhook` (validação HMAC + fonte de verdade real) | ✅ |
| 5 | Página `/planos` (empresa) — planos reais + botão Assinar | ✅ |
| 6 | Página `/tecnico/planos` — planos reais + botão Assinar | ✅ |
| 7 | Página de resultado `/planos/assinatura-concluida` | ✅ |
| 8 | Deploy real + migração em produção + smoke test | ✅ (parcial — ver pendência abaixo) |

**Deploy e smoke test real (2026-08-19), evidência real:**
- `docker compose build backend frontend` + `up -d` — `montese_backend` e
  `montese_frontend` `Up`.
- Migração `0006_plans_subscriptions.sql` já aplicada (confirmado
  `[skip]` contra o Postgres real desta VPS).
- Todas as páginas retornando `200`: `/`, `/planos`, `/tecnico/planos`,
  `/planos/assinatura-concluida`, `/cadastro`, `/tecnico/cadastro`,
  `/login`.
- `GET /api/plans` retorna os 5 planos reais (4 `empresa` + 1 `tecnico`).

**Pendência bloqueante — fase NÃO fechada 100%:** o teste real de ponta a
ponta (assinar com cartão de teste do Mercado Pago, confirmar que o
webhook chega e ativa a assinatura) não pôde acontecer. Dois motivos,
ambos exigem ação do fundador:

1. **`MERCADOPAGO_WEBHOOK_SECRET` não existe** — só é gerado depois que o
   fundador configurar o webhook no painel do Mercado Pago (Suas
   integrações → aplicação de teste → Webhooks → apontar pra
   `http://187.127.54.72/api/payments/mercadopago/webhook`, evento
   "Assinaturas"). Sem isso, a validação HMAC do endpoint (já
   implementada e testada com segredo sintético) nunca vê tráfego real.
2. **`PUBLIC_APP_URL` de produção (`http://187.127.54.72`) provavelmente
   não é aceito pelo Mercado Pago como `back_url`** — descoberto durante
   as Tasks 3 e 5: mesmo um `back_url` sobre `http://` com domínio real
   (não IP) retornou erro inesperado do Mercado Pago nos testes; um IP
   puro sem HTTPS tem alta chance de ser rejeitado do mesmo jeito. Isso
   bloqueia a criação de uma assinatura real em produção, não só o
   Step 5 do smoke test — **é preciso um domínio real + HTTPS/TLS
   configurado no Nginx desta VPS antes que qualquer cliente real
   consiga assinar um plano em produção.** Fora do escopo deste
   sub-projeto (infra, não código de aplicação).

Nenhuma das duas pendências foi "resolvida escondendo o problema" — ambas
ficam registradas aqui como bloqueio real, mesmo critério já usado no
teste de e-mail (Fase 2) e no cadastro de técnico.

**Atualização (2026-08-23):** o item 2 (domínio real + HTTPS) foi
resolvido durante a Fase 4 sub-projeto A — `https://montesesst.com.br`
está no ar com certificado real (Let's Encrypt, renovação automática
agendada), e `PUBLIC_APP_URL` já aponta pra lá no `.env` real. O item 1
(`MERCADOPAGO_WEBHOOK_SECRET`) continua pendente — o fundador ainda
precisa configurar o webhook no painel do Mercado Pago, agora usando a
URL real `https://montesesst.com.br/api/payments/mercadopago/webhook`
em vez do IP. Só depois disso o teste real de ponta a ponta (assinatura
+ webhook) pode finalmente acontecer.

## Fase 3 — Onboarding: status

Wizard de configuração inicial da empresa após primeiro login — não um
fluxo linear obrigatório, e sim um painel com três blocos independentes
(dados da empresa, filiais, funcionários), preenchíveis em qualquer
ordem, com progresso sempre derivado dos dados reais. Decisões
confirmadas em brainstorming de 2026-08-20. Spec em
[`docs/specs/fase-3-onboarding.md`](specs/fase-3-onboarding.md), plano em
[`docs/plans/fase-3-onboarding.md`](plans/fase-3-onboarding.md).

**Fechada em 2026-08-21** — todas as 9 tasks concluídas e revisadas
(SDD, uma revisão por task, sem findings Critical/Important pendentes):

| Task | Entrega | Status |
|---|---|---|
| 1 | Migration: `tenants.sector/contact_name/contact_phone`, tabela `company_units` (com RLS), `employees.company_unit_id` | ✅ |
| 2 | `GET/PATCH /tenants/me` | ✅ |
| 3 | CRUD `/company-units` (filiais) | ✅ |
| 4 | Vínculo funcionário↔filial com checagem cross-tenant (FK do Postgres sozinha não bastaria — bypassa RLS na tabela referenciada) | ✅ |
| 5 | `POST /employees/import` (CSV em massa, com `SAVEPOINT` por linha) | ✅ |
| 6 | Primeira página autenticada do frontend (`/empresa/onboarding`) + bloco Dados da empresa | ✅ |
| 7 | Bloco Filiais | ✅ |
| 8 | Bloco Funcionários (manual + CSV) | ✅ |
| 9 | Deploy real + migração em produção + smoke test | ✅ |

**Deploy e verificação real (2026-08-21), evidência real:**
- `docker compose build backend frontend` + `up -d` — `montese_backend` e
  `montese_frontend` `Up`.
- Migração `0007_onboarding.sql` já aplicada (confirmado `[skip]`
  contra o Postgres real desta VPS).
- Suíte e2e completa: **16/16 suites, 53/53 testes passando** contra o
  Postgres real do Docker (5 suites novas desta fase: `tenants`,
  `company-units`, `company-units-rls`, `employees-company-unit`,
  `employees-import`).
- Páginas novas retornando `200`: `/`, `/login`, `/empresa/onboarding`.
  `GET /api/tenants/me` sem token retorna `401` (rota protegida,
  confirmado).
- Fluxo completo testado de ponta a ponta via `curl` contra os
  containers reais (não só a suíte automatizada): login real, criação de
  filial, cadastro manual de funcionário, importação de CSV com linha
  válida e linha inválida (relatório de erro por linha confirmado), e
  limpeza dos dados de teste depois.

**Vulnerabilidade real encontrada e corrigida na revisão final desta
entrega** (não pega por nenhuma revisão de task individual — só apareceu
olhando o diff inteiro com contexto cruzado entre tasks): a checagem
cross-tenant que impede vincular um funcionário à filial de outra
empresa (`assertCompanyUnitBelongsToTenant`, Task 4) dependia da
visibilidade da RLS de `company_units` — mas a policy dessa tabela tem
bypass explícito pra `role = 'admin'`, então pra um caller admin a
checagem nunca filtrava por tenant de verdade. Um admin conseguia
vincular o funcionário de uma empresa à filial de outra. Corrigido
comparando `tenant_id` explicitamente na query (`WHERE id = $1 AND
tenant_id = $2`) em vez de confiar só na visibilidade da RLS — provado
com um teste real que reproduziu o bug antes do fix (retornava `201`
quando deveria bloquear) e confirmou o bloqueio (`400`) depois. Mais 3
achados "Important" (não-segurança) na mesma revisão final, também
corrigidos: faltava teste provando que deletar uma filial não apaga o
funcionário vinculado a ela (só reseta `company_unit_id`); a tela de
onboarding trocava a página inteira pra "Cadastro em dia" no meio de uma
interação (ex: destruía o resumo de erros de uma importação CSV assim
que ela terminava, se fosse a última etapa) — corrigido pra só mostrar a
tela cheia num carregamento novo com cadastro já completo, nunca como
reação a uma ação da própria sessão; e uma linha em branco no meio de um
CSV desalinhava o número de linha reportado nos erros de importação.

**Sem pendência bloqueante** — diferente da fase de pagamento anterior,
esta fase não depende de nenhuma ação externa do fundador (sem
credencial, sem configuração de painel de terceiro). Vínculo com técnico
responsável foi deixado de fora do escopo (nenhum fluxo de
solicitar/aceitar existe ainda entre empresa e técnico) — revisitar
quando a Fase 4/5 (Dashboards) existirem, mesma decisão já registrada na
spec desta fase.

## Fase 4 (sub-projeto A — Documentos): status

Score de SST, pendências, documentos e agenda formam a Fase 4 completa —
decidido em brainstorming de 2026-08-23 quebrar em sub-projetos,
começando por Documentos (as outras três peças dependem dela: documento
vencido = pendência, % de documentos em dia = score). Spec em
[`docs/specs/fase-4-documentos.md`](specs/fase-4-documentos.md), plano em
[`docs/plans/fase-4-documentos.md`](plans/fase-4-documentos.md).

**Fechado em 2026-08-23** — 8 tasks concluídas e revisadas (SDD, uma
revisão por task):

| Task | Entrega | Status |
|---|---|---|
| 1 | Migration `documents` com RLS (empresa vê o próprio tenant; técnico vê tenants vinculados via `EXISTS` contra `tenant_technicians`) | ✅ |
| 2 | Corrige `POST/DELETE /technicians/:id/assign` — permitia empresa se auto-vincular a qualquer técnico desde a Fase 1, nunca testado | ✅ |
| 3 | `GET /tenant-technicians/me` — lista as empresas vinculadas ao técnico | ✅ |
| 4 | `R2Service` + upload/listagem de documentos (Cloudflare R2 real) | ✅ |
| 5 | Download (URL assinada) + exclusão de documentos | ✅ |
| 6 | Página `/empresa/documentos` | ✅ |
| 7 | Páginas do técnico (`/tecnico/empresas` + `/tecnico/empresas/[id]`) — primeira área autenticada do técnico | ✅ |
| 8 | Deploy real + migração em produção + smoke test | ✅ |

**Vulnerabilidade real encontrada e corrigida durante o desenho desta
fase** (não na revisão final desta vez — descoberta ao checar o código
antes de propor a Task 2, corrigindo uma suposição errada da primeira
versão da spec): `POST/DELETE /technicians/:id/assign` já existia desde
a Fase 1 com `@Roles('empresa', 'admin')` — permitindo que a própria
empresa se auto-vinculasse a qualquer técnico, sem nenhuma
intermediação humana, e nunca tinha sido testado. Contradizia o
diferencial de atendimento humano descrito no `docs/vision.md`.
Corrigido para `@Roles('admin')` apenas, com o primeiro teste real
desse endpoint.

**Achado na revisão final desta fase** (Important, corrigido): o upload
gravava o objeto real no R2 antes do `INSERT` no Postgres — se o INSERT
falhasse por qualquer motivo (ex: RLS rejeitando um técnico não
vinculado tentando subir documento pra um tenant que não é dele), o
objeto ficava órfão no bucket real pra sempre. Corrigido com limpeza
automática (best-effort) do objeto quando o INSERT falha, provado com um
teste real que reproduz a rejeição de RLS e confirma, via
`HeadObjectCommand` real, que nenhum objeto fica pra trás.

**Configuração de infraestrutura destravada durante esta fase**: HTTPS
real via Let's Encrypt no domínio `montesesst.com.br` (com renovação
automática agendada) — resolve a pendência de domínio/HTTPS registrada
no fechamento da fase de pagamento (Planos + Assinaturas), que bloqueava
o `back_url` do Mercado Pago em produção. `PUBLIC_APP_URL` já atualizado
no `.env` real pra `https://montesesst.com.br`.

**Deploy e verificação real (2026-08-23), evidência real:**
- Suíte e2e completa: **21/21 suites, 69/69 testes passando** contra
  Postgres real e o bucket R2 real (5 suites novas desta fase).
- Páginas novas retornando `200` via **domínio real com HTTPS**
  (`https://montesesst.com.br`): `/`, `/login`, `/empresa/documentos`,
  `/tecnico/empresas`. `GET /api/documents` sem token retorna `401`.
- Fluxo completo de upload/download/exclusão testado de ponta a ponta
  contra o R2 real em múltiplas tasks (não só a suíte automatizada).

**Sem pendência bloqueante.** Vínculo técnico↔empresa continua
admin-only por decisão (sem tela de Dashboard Admin ainda — a Montese
aciona via API diretamente). Score de SST, pendências e agenda ficam
para os próximos sub-projetos da Fase 4.

## Fase 4 (sub-projeto B — Score de SST + Pendências): status

Indicador de conformidade (score em % + lista de vencidos/perto de
vencer), calculado em cima dos documentos que o sub-projeto A já criou —
sem tabela nova, sem migration. Decisões confirmadas em brainstorming de
2026-08-24: só documentos com vencimento definido entram na conta;
`null` (não 0%/100%) quando não há nenhum; vencido = pendência real,
até 30 dias antes = aviso; aparece dentro da própria página de
documentos, não uma tela nova; técnico também vê. Spec em
[`docs/specs/fase-4-score-pendencias.md`](specs/fase-4-score-pendencias.md),
plano em [`docs/plans/fase-4-score-pendencias.md`](plans/fase-4-score-pendencias.md).

**Fechado em 2026-08-24** — 3 tasks concluídas (Tasks 1 e 2 via SDD, uma
revisão por task; Task 3 é deploy/documentação, executada direto):

| Task | Entrega | Status |
|---|---|---|
| 1 | `GET /documents/compliance` — cálculo de score/pendências/avisos | ✅ |
| 2 | Bloco de conformidade no `DocumentsPanel` (empresa e técnico) | ✅ |
| 3 | Deploy real + smoke test | ✅ |

**Deploy e verificação real (2026-08-24), evidência real:**
- Suíte e2e completa: **22/22 suites, 72/72 testes passando** contra o
  Postgres real desta VPS (1 suite nova desta fase).
- `/empresa/documentos` retornando `200` via domínio real com HTTPS
  (`https://montesesst.com.br`); `GET /api/documents/compliance` sem
  token retorna `401`.

**Sem pendência bloqueante.** Agenda (a última peça da Fase 4) fica
para um terceiro sub-projeto, spec própria — ver seção seguinte.

## Fase 4 (sub-projeto C — Agenda): status

Agenda de vencimentos, a quarta e última peça do Dashboard Empresa.
Decisões confirmadas em brainstorming de 2026-08-25: escopo é o
calendário de vencimentos de documentos (não agendamento de visita
técnica, que fica pra Fase 6; não compromissos genéricos); lista todos
os vencimentos, não só pendências/avisos já em alerta; formato lista
cronológica agrupada por mês (não calendário em grade); aparece dentro
do próprio `DocumentsPanel`, entre Conformidade e Enviar documento;
técnico também vê.

Durante o brainstorming, ficou claro que o dado já vinha pronto — o
`GET /documents` que o `DocumentsPanel` já busca inclui `expires_at` de
todo documento, então a agenda é só reordenar/agrupar esse array no
front, sem endpoint novo, sem tabela nova. Por isso a tarefa foi
reclassificada de arquitetural pra *bounded* (design curto no chat,
sem spec/plano formais) e implementada direto, com aprovação do
fundador.

**Fechado em 2026-08-25** — um único arquivo alterado,
[`frontend/src/components/DocumentsPanel.tsx`](../frontend/src/components/DocumentsPanel.tsx)
(commit `0f071bd`).

**Verificação:** build isolado (`docker build --target builder`, sem
tocar no container `montese_frontend` em produção) — compilou e passou
type-check normalmente, incluindo `/empresa/documentos` e
`/tecnico/empresas/[tenantId]`. Teste visual ao vivo no navegador não
foi feito nesta rodada — o container de produção também carrega
trabalho visual não commitado de uma sessão paralela, e o fechamento
desse deploy conjunto fica pra quando o fundador decidir o timing.

**Fase 4 completa** — score de SST, pendências, documentos e agenda,
as quatro peças do Dashboard Empresa, todas fechadas.

## Fase 5 — Dashboard Técnico: status

Carteira de clientes, agenda, relatórios de inspeção. Modelos de relatório
de referência (EPI e visita técnica) recebidos e preservados em
`docs/reference/modelos-relatorios-sst.md`.

Decisões confirmadas em brainstorming de 2026-08-25: o checklist completo
de visita técnica (9 blocos C/NC/N.A.) já é escopo da Fase 6 — "relatórios
de inspeção" fica de fora desta fase, evitando construir o schema de
relatório duas vezes. Fase 5 vira só carteira + agenda, e as duas
reaproveitam dados que já existiam (score/pendências por documento, RLS
via `tenant_technicians`) — por isso reclassificada de arquitetural pra
*bounded* (design curto no chat, sem spec/plano formais).

**Fechado em 2026-08-25** — um endpoint novo e três arquivos de frontend
alterados/criados (commit `0bb6587`):
- `GET /documents/compliance/portfolio` — score/pendências/avisos por
  empresa vinculada ao técnico, numa query só.
- `GET /documents` sem `tenant_id`, pra técnico, agora permitido (RLS já
  restringe às empresas vinculadas) — usado pela agenda agregada.
- `/tecnico/empresas` mostra score/pendências por empresa da carteira.
- Nova página `/tecnico/agenda` — vencimentos de toda a carteira,
  agrupados por mês, com o nome da empresa em cada item.

**Verificação:** suíte e2e completa rodada em container isolado (sem
tocar no `montese_backend` em produção) — **24 suítes, todas passando**
(3 novas desta fase, cobrindo agregação por empresa, isolamento RLS
entre empresas não vinculadas, e negação de acesso pra quem não é
técnico). Build isolado do frontend também passou, incluindo as duas
páginas novas/alteradas. Teste visual ao vivo no navegador não foi
feito — mesmo motivo da Fase 4C (container de produção compartilhado
com trabalho visual não commitado de uma sessão paralela).

**Pendência fora do escopo desta fase:** relatórios de inspeção (o
checklist completo) ficam pra Fase 6, junto do fluxo de visita
presencial.

## Fase 6 (sub-projeto A — Fluxo de inspeção): status

Primeiro sub-projeto da Fase 6 (Fluxo de visita presencial + Dashboard
Parceiro). Checklist estruturado de visita técnica presencial — 9 blocos
do modelo de referência real (`docs/reference/modelos-relatorios-sst.md`,
seção 2) — com geração automática de plano de ação a partir de item não
conforme. Decisões confirmadas em brainstorming de 2026-08-25: só o
técnico responsável cria/edita inspeções nesta entrega (acesso do
técnico parceiro fica para sub-projeto seguinte); empresa vê a inspeção
completa em tempo real, mesmo em rascunho; itens de checklist fixos no
código (não configuráveis); assinatura por nome digitado (não canvas);
planos de ação só criados na conclusão, sem tela de acompanhamento
ainda. Spec em
[`docs/specs/fase-6-inspecoes.md`](specs/fase-6-inspecoes.md), plano em
[`docs/plans/fase-6-inspecoes.md`](plans/fase-6-inspecoes.md).

**Fechado em 2026-08-25** — 7 tasks concluídas via SDD (revisão por
task + revisão final de todo o branch):

| Task | Entrega | Status |
|---|---|---|
| 1 | Migration `inspections`/`inspection_checklist_items`/`action_plans` + RLS | ✅ |
| 2 | Constante de checklist + criação/listagem/detalhe de inspeção | ✅ |
| 3 | Edição de cabeçalho e item de checklist (só em rascunho) | ✅ |
| 4 | Conclusão com geração automática de planos de ação | ✅ |
| 5 | Listagem de planos de ação | ✅ |
| 6 | Frontend técnico — lista + formulário de 9 blocos | ✅ |
| 7 | Frontend empresa — lista + visão somente-leitura + planos de ação | ✅ |

**Revisão final de todo o branch encontrou 3 problemas Important reais**
(comprovados por sondagem direta contra o Postgres real, não só leitura
de código) **e corrigidos numa única rodada, depois revalidados**:
- Corrida em `conclude`/`assertDraft` sem lock de linha — duas
  conclusões simultâneas podiam gerar planos de ação duplicados, ou uma
  edição de item concorrente com a conclusão podia perder um item NC
  silenciosamente. Corrigido com `SELECT ... FOR UPDATE`, provado com
  teste de concorrência real (`Promise.all` de duas chamadas HTTP
  simultâneas).
- `POST /inspections` não mapeava erro de RLS/FK — rejeição de técnico
  não vinculado virava 500 genérico em vez de 403. Corrigido com
  `mapPgError`, mesmo padrão já usado em `documents.service.ts`.
- `visited_at` aparecia um dia antes em qualquer fuso horário do Brasil
  (coluna `DATE` vira meia-noite UTC, `toLocaleDateString` desloca pro
  dia anterior) — corrigido nos 4 pontos de exibição.

**Verificação:** suíte e2e completa rodada em container isolado (sem
tocar no `montese_backend`/`montese_frontend` de produção) — **28
suítes, 96 testes, todos passando** (9 suítes novas desta fase, incluindo
o teste de concorrência real). Build isolado do frontend também passou.
Teste visual ao vivo no navegador não foi feito — mesmo motivo das Fases
4C/5 (containers de produção compartilhados com trabalho visual não
commitado de uma sessão paralela).

**Pendências registradas, não bloqueantes:**
- [x] **Acesso do técnico parceiro** — sub-projeto B da Fase 6, ver seção
      seguinte. Fechado em 2026-08-25.
- [x] **Catálogo de EPI** — sub-projeto seguinte da Fase 6, spec própria.
      Fechado em 2026-08-26.
- [ ] **Acompanhamento de planos de ação** (mudar status, prazo) —
      trabalho futuro, fora desta entrega.
- [ ] **Navegação para `/empresa/inspecoes`** — a página existe mas
      nenhum link no app aponta para ela ainda (lacuna do shell
      autenticado da empresa, pré-existente, não introduzida por esta
      fase — `/empresa/documentos` tem a mesma lacuna).
- [ ] Achados menores adiados nas revisões de cada task (casts
      desnecessários, teste de concorrência de item entre inspeções,
      `@MaxLength` em campos de texto livre, loop N+1 na geração de
      planos de ação, `Number('')` viraria `0` em vez de vazio no campo
      de participantes do DDS, desempate de ordenação por data) — nenhum
      bloqueante, registrados no ledger da SDD antes de ser apagado.

## Fase 6 (sub-projeto B — Acesso do técnico parceiro): status

Segundo sub-projeto da Fase 6. O papel `parceiro` existe no banco desde
a Fase 1 (`partners`/`tenant_partners`) mas nunca teve acesso a nenhuma
tela — login redirecionava pra `/`, nenhum endpoint de
documentos/conformidade/agenda/inspeções reconhecia esse papel. Decisão
confirmada em brainstorming de 2026-08-25: reaproveitar 100% das telas
`/tecnico/*` já existentes (sem rotas `/parceiro/*` separadas), com
paridade completa de permissão em relação ao técnico responsável — não
só inspeções, também documentos/conformidade/agenda. Spec em
[`docs/specs/fase-6-acesso-parceiro.md`](specs/fase-6-acesso-parceiro.md),
plano em [`docs/plans/fase-6-acesso-parceiro.md`](plans/fase-6-acesso-parceiro.md).

**Fechado em 2026-08-25** — 5 tasks concluídas via SDD (revisão por
task + revisão final de todo o branch):

| Task | Entrega | Status |
|---|---|---|
| 1 | RLS de `documents`/`inspections`/`action_plans` estendida (`ALTER POLICY`, branch `parceiro` via `tenant_partners`) | ✅ |
| 2 | `GET /tenant-technicians/me` bifurcado por papel | ✅ |
| 3 | `documents` reconhece parceiro (upload, conformidade, portfólio, exclusão) | ✅ |
| 4 | `inspections`/`action-plans` reconhecem parceiro | ✅ |
| 5 | Redirect de login inclui parceiro | ✅ |

**Descoberta real durante a Task 3, corrigida no mesmo escopo:** o
`CHECK` de `documents.uploaded_by_role` só aceitava `'empresa'`/
`'tecnico'` — nem a spec nem a migration do Task 1 tinham previsto isso
(é um gap de schema de `documents`, não de RLS). Corrigido com a
migration `0012_partner_upload_role.sql`, sem migração de dado
necessária.

**Revisão final de todo o branch fez verificação ao vivo contra o
Postgres real** (não só leitura de diff) — sondou `pg_policy` real,
tentou INSERT como parceiro sem vínculo (confirmou `42501` → 403 em
`documents` e `inspections`), conferiu que as telas `/tecnico/*` são
genuinamente agnósticas de papel (nenhuma leitura de `role` no cliente)
e que não sobrou nenhum ponto `tecnico`-only nas telas compartilhadas.
Encontrou 1 problema Important real — o tipo TypeScript
`uploadedByRole` em `documents.service.ts` não tinha sido ampliado pra
`'parceiro'` quando a Task 3 corrigiu a constraint do banco (mesma
classe de gap, agora na camada de tipos) — corrigido junto com 2 achados
Minor (comentários desatualizados, fixture morta em teste), revalidado
limpo.

**Verificação:** suíte e2e completa rodada em container isolado (sem
tocar no `montese_backend`/`montese_frontend` de produção) — **32
suítes, 106 testes, todos passando** (5 suítes novas desta fase). Build
isolado do frontend passou (a Task 5 alterou
`frontend/src/app/(site)/login/page.tsx`, que estava sem commit ainda —
o fundador aprovou explicitamente que esse commit incluísse o arquivo
inteiro, redesign visual não commitado de outra sessão junto).

**Pendências registradas, não bloqueantes** (nenhuma delas afeta
segurança ou corretude hoje, segundo verificação da revisão final):
- [x] **Catálogo de EPI** — último sub-projeto pendente da Fase 6, spec
      própria. Fechado em 2026-08-26.
- [ ] Duplicação do ternário `linkTable`/`linkColumn`/`personTable`
      entre `tenant-technicians.service.ts` e `documents.service.ts` —
      extrair pra um helper compartilhado se aparecer uma terceira
      cópia.
- [ ] Cobertura de teste negativo assimétrica entre `documents` e
      `inspections`/`action_plans` (o comportamento foi verificado
      manualmente contra o Postgres real na revisão final e está
      correto — falta só a rede de proteção contra regressão futura).
- [ ] Onboarding de parceiro é só via API (`POST /partners`,
      `@Roles('admin')`) — sem auto-cadastro nem tela de admin, mesma
      lacuna que já existia para técnico antes da Fase 4A.
- [ ] `plans`/`subscriptions` continuam `tecnico`-only — parceiro não
      assina plano ainda; decisão de produto a confirmar, não bloqueia
      o acesso entregue aqui (documentos/inspeções não têm paywall).

## Fase 6 (sub-projeto C — Catálogo de EPI): status

Terceiro e último sub-projeto da Fase 6, adiado três vezes (Fase 4A,
Fase 5, sub-projeto A da própria Fase 6) pra manter escopo controlado.
Modelo 1 do documento de referência original
(`docs/reference/modelos-relatorios-sst.md`, seção 1) — catálogo de EPIs
por empresa com CA (Certificado de Aprovação), vínculo funcionário↔EPI
com data de entrega e assinatura. Decisão de design que mudou o rascunho
original: o fundador anexou em 2026-08-25 o catálogo oficial completo do
Anexo I da NR-06 (93 itens reais, 9 categorias A-I), transcrito em
[`docs/reference/catalogo-epi-nr06.md`](reference/catalogo-epi-nr06.md).
Isso substituiu a ideia original de campo de texto livre por tenant por
uma tabela de referência global fixa (`epi_catalog_items`, seedada uma
vez com os 93 itens, mesmo padrão dos itens fixos de checklist do
sub-projeto A) — cada EPI real de uma empresa referencia um desses 93
itens oficiais + o CA do produto físico específico (CA é do
produto/fabricante, não da categoria do Anexo I). Decisões confirmadas
em brainstorming de 2026-08-25/26: catálogo global fixo; vínculo
funcionário↔EPI e catálogo entregues juntos; assinatura por nome
digitado (mesmo padrão de inspeções); empresa e técnico/parceiro podem
gerenciar; página própria na UI; verificação de CA/rastreio de desgaste
adiados; validade do CA opcional, com agenda. Spec em
[`docs/specs/fase-6-catalogo-epi.md`](specs/fase-6-catalogo-epi.md),
plano em [`docs/plans/fase-6-catalogo-epi.md`](plans/fase-6-catalogo-epi.md).

**Fechado em 2026-08-26** — 7 tasks concluídas via SDD (revisão por
task + revisão final de todo o branch):

| Task | Entrega | Status |
|---|---|---|
| 1 | Migration `epi_catalog_items` (93 itens seedados) / `tenant_epis` / `employee_epi_deliveries` + RLS | ✅ |
| 2 | `EpiModule` — CRUD de EPI (criar/listar/detalhe/excluir) + catálogo | ✅ |
| 3 | Registro e listagem de entregas (`employee_epi_deliveries`) | ✅ |
| 4 | `GET /employees` ganha filtro `tenant_id` (lacuna pré-existente da Fase 3) | ✅ |
| 5 | Frontend — `EpisPanel` compartilhado + `/empresa/epis` | ✅ |
| 6 | Frontend técnico — seção EPI na página da empresa | ✅ |
| 7 | Agenda de vencimentos estendida pra incluir `ca_valid_until` do EPI | ✅ |

**Descoberta real durante a Task 3, corrigida no mesmo escopo:** o
registro de entrega não validava que `employee_id` pertencia ao mesmo
tenant do EPI — como `FOREIGN KEY` não é filtrada por RLS na tabela
referenciada, um técnico vinculado a um tenant podia registrar uma
entrega apontando pra um funcionário de outro tenant. Corrigido com uma
checagem de existência escopada por tenant antes do INSERT, mesma classe
de bug já vista duas vezes em revisões finais de sub-projetos anteriores
desta fase.

**Revisão final de todo o branch encontrou 2 problemas Important reais**
(comprovados por verificação ao vivo contra o Postgres real, não só
leitura de código) **e corrigidos numa única rodada de fix, depois
revalidados**:
- `employee_epi_deliveries.tenant_epi_id` tinha `ON DELETE CASCADE`,
  combinado com a ausência intencional de checagem de dono em
  `DELETE /epis/:id` e um botão "Apagar" sem confirmação — qualquer
  integrante do tenant podia destruir silenciosa e irreversivelmente o
  histórico de entregas assinadas (o registro legalmente exigido pela
  NR-06/CLT art. 166 que esta funcionalidade existe pra produzir).
  Confirmado ao vivo: apagar um EPI com 1 entrega zerou o contador de
  entregas. Corrigido trocando a FK pra `ON DELETE RESTRICT`
  (`backend/db/migrations/0014_epi_delivery_delete_restrict.sql`) e
  mapeando o erro `23503` resultante pra `ConflictException` (409) em
  vez do `mapPgError` genérico (que daria 400, semanticamente errado
  aqui).
- A spec exigia explicitamente testes HTTP de técnico/parceiro pra
  `POST`/`DELETE /epis` (o único caminho de escrita que aceita
  `tenant_id` vindo do cliente) — nenhum existia, só `empresa` tinha
  cobertura. Corrigido com 3 novos testes (técnico vinculado cria →
  201; técnico não vinculado → 403; técnico apaga EPI criado pela
  empresa → 200).

**Verificação:** suíte e2e completa — **36 suítes, 121 testes, todos
passando** (4 suítes novas desta fase). Build isolado do frontend
passou. Teste visual ao vivo no navegador não foi feito — mesmo motivo
das fases anteriores (containers de produção compartilhados com
trabalho visual não commitado de uma sessão paralela).

**Pendências registradas, não bloqueantes** (nenhuma delas afeta
segurança ou corretude hoje):
- [ ] Lista de entregas do EPI só carrega ao clicar, não junto da lista
      de EPIs.
- [ ] `/empresa/epis` inalcançável por navegação — mesma lacuna
      pré-existente de `/empresa/documentos` e `/empresa/inspecoes`.
- [ ] Helpers de agenda (`formatDate`/`formatMonthLabel`/agrupamento)
      duplicados em 4 arquivos — candidato a extração pra
      `frontend/src/lib/agenda.ts`, não bloqueante.
- [ ] Fetch duplicado de `/api/epis?tenant_id=` entre `DocumentsPanel` e
      `EpisPanel` na mesma página do técnico.
- [ ] Campos do formulário de entrega não resetam ao cancelar ou trocar
      de EPI (herdado do brief da Task 5).
- [ ] `DATE`→JSON depende do fuso do servidor — latente, idêntico ao
      comportamento pré-existente de `documents.expires_at`.

**Fase 6 fechada por completo em 2026-08-26** (sub-projetos A, B e C
todos concluídos).

## Fase 7 (sub-projeto A — Gestão de tenants e vínculos): status

Primeiro sub-projeto da Fase 7 (Dashboard Admin). O papel `admin` existe
no banco desde a Fase 1 (RLS bypass em toda tabela multi-tenant) mas
nunca teve conta real nem tela própria — em 2026-08-26,
`SELECT COUNT(*) FROM users WHERE role='admin'` retornava `0`, e toda
ação administrativa (criar técnico/parceiro, vincular a empresa) era
feita chamando a API diretamente. "Dashboard Admin" era um título amplo
demais pra uma spec só; decomposto em brainstorming de 2026-08-26 —
gestão de tenants e vínculos veio primeiro (planos/assinaturas e
visão geral/métricas ficam pra sub-projetos seguintes). Spec em
[`docs/specs/fase-7-gestao-tenants.md`](specs/fase-7-gestao-tenants.md),
plano em [`docs/plans/fase-7-gestao-tenants.md`](plans/fase-7-gestao-tenants.md).

**Fechado em 2026-08-26** — 6 tasks concluídas via SDD (revisão por
task + revisão final de todo o branch):

| Task | Entrega | Status |
|---|---|---|
| 1 | `GET /tenants` admin-only, vínculos técnico/parceiro agregados | ✅ |
| 2 | `GET /technicians`/`GET /partners` passam a incluir `full_name`/`email` | ✅ |
| 3 | `AdminNav`, `/admin/empresas` (somente leitura), redirect de login | ✅ |
| 4 | `/admin/tecnicos` (criar + vincular) | ✅ |
| 5 | `/admin/parceiros` (criar + vincular) | ✅ |
| 6 | Runbook de provisionamento manual da primeira conta admin | ✅ |

**Descoberta real durante a Task 6, corrigida no mesmo escopo:** o
runbook afirmava que a constraint `chk_tenant_role` *exige* `tenant_id
NULL` pra `tecnico`/`parceiro`/`admin` — na verdade ela só exige
`tenant_id NOT NULL` pra `empresa` e não proíbe valor não-nulo pras
outras roles; "sempre NULL" é convenção do projeto (comentário de
coluna), não enforcement de constraint. A instrução operacional em si
(inserir com `tenant_id = NULL`) sempre esteve correta — só a
justificativa estava errada. Corrigido e revalidado.

**Revisão final de todo o branch fez verificação ao vivo contra o
Postgres real** (não só leitura de diff) — confirmou que `tenants` não
tem RLS própria e que `@Roles('admin')` é de fato a única barreira
(sondou `pg_class.relrowsecurity`, simulou sessão `empresa` contra
`tenants` sem filtro, confirmou 403 pros três papéis não-admin);
auditou os outros pontos do backend que tocam `tenants` confirmando
ausência de vazamento; rodou o runbook passo a passo contra o banco
real (hash bcrypt, contagem de contas admin, checagem de RLS forçada em
`users`). Encontrou 3 problemas:

- **Critical (pré-existente, fora do branch, não corrigido
  autonomamente):** o HEAD deste branch não compila de um checkout
  limpo — `frontend/src/app/login/page.tsx` (arquivo antigo) e
  `frontend/src/app/(site)/login/page.tsx` (novo, com o redirect admin
  desta fase) resolvem pra mesma rota `/login`. O arquivo antigo está
  deletado só no working tree, nunca commitado — é o mesmo `D
  frontend/src/app/login/page.tsx` que aparece em `git status` desde o
  início de toda a sessão, pertencente a trabalho visual não commitado
  de uma sessão paralela (redesign do site). Raiz 21 commits antes da
  base deste plano — todo build de verificação de fases anteriores
  desta sessão rodou contra o working tree (onde o arquivo já estava
  ausente), o que mascarou isso sistematicamente até esta revisão
  buildar contra o tree commitado de verdade. **Não corrigido nesta
  entrega** — resolver exige commitar a deleção de um arquivo de
  trabalho em andamento de outra sessão, decisão que cabe ao fundador,
  não a uma correção autônoma da SDD. Registrado aqui como pendência
  explícita, não escondida.
- Two Important corrigidos numa única rodada de fix, revalidados: (1)
  o `JOIN users` adicionado na Task 2 virou `INNER JOIN` e derrubava
  silenciosamente linhas de `technicians`/`partners` visíveis a um
  chamador `empresa` (a linha de `users` do técnico tem `tenant_id
  NULL`, invisível pra RLS de `empresa`) — endpoint sem `@Roles()`,
  regressão real sem nenhum teste cobrindo o caminho não-admin.
  Corrigido trocando pra `LEFT JOIN` + tipos `full_name`/`email` como
  `string | null` + 2 novos testes de regressão com token empresa,
  reproduzido ao vivo (INNER JOIN 0 linhas -> LEFT JOIN 1 linha). (2)
  `/admin/tecnicos` nunca renderizava `specialization`/`status`
  (defeito herdado do próprio texto do plano, não desvio do
  implementador); `/admin/parceiros` nunca renderizava `status`.
  Corrigido com ~4 linhas por arquivo.

**Verificação:** suíte e2e completa — **38 suítes, 131 testes, todos
passando** (2 suítes novas desta fase + 2 testes de regressão
adicionados na fix wave). Build isolado do frontend passou (contra o
working tree — a ressalva do Critical acima é especificamente sobre o
tree *commitado*, que não foi testado por nenhuma fase anterior desta
sessão até agora). Teste visual ao vivo no navegador não foi feito —
mesma ressalva de sempre.

**Pendências registradas, não bloqueantes:**
- [x] **Rota `/login` duplicada impedia build de produção** — ver
      achado Critical acima. Resolvido em 2026-08-26 (commit `4942889`)
      após o fundador autorizar explicitamente a remoção do arquivo
      antigo (`frontend/src/app/login/page.tsx`); build isolado contra
      a árvore commitada confirmado limpo, `/login` resolve pra uma
      única rota, as 3 páginas `/admin/*` presentes no output.
- [ ] Planos/assinaturas e visão geral/métricas — sub-projetos
      seguintes da Fase 7, spec própria.
- [ ] Desvincular/desativar empresa, técnico ou parceiro pela tela —
      decisão consciente de escopo mínimo desta entrega.
- [ ] Criar empresa manualmente pela tela do admin — idem.
- [ ] `create()`/`update()` de técnico/parceiro tipados com
      `full_name`/`email` que `RETURNING *` não populariza de fato —
      sem impacto em runtime (as telas recarregam a lista após criar),
      mas é mentira de tipo latente.
- [ ] Convenções de erro divergentes entre as 3 telas admin
      (`error` vs `listError`, proteção de empty-state inconsistente).
- [ ] Sem rota índice `/admin` (só `/admin/empresas`, `/admin/tecnicos`,
      `/admin/parceiros`) — digitar `/admin` dá 404.
- [ ] `POST /technicians`/`POST /partners` sem `class-validator` nos
      DTOs — pré-existente, mas esta é a primeira UI que exercita esses
      endpoints rotineiramente.
- [ ] Assimetria pré-existente: `POST /technicians/:id/assign` é
      `@Roles('admin')`, `POST /partners/:id/assign` é
      `@Roles('empresa','admin')` — as duas telas de admin funcionam
      igual, mas a superfície de API não é simétrica.

## Fase 7 (sub-projeto B — Financeiro): status

Segundo sub-projeto da Fase 7. Antes desta entrega não existia nenhuma
forma de listar assinaturas (só `POST /subscriptions`), editar preço de
plano só era possível via SQL direto, e o webhook do Mercado Pago
descartava todo evento de cobrança individual — sem histórico de
pagamento nenhum. Spec em
[`docs/specs/fase-7-financeiro.md`](specs/fase-7-financeiro.md), plano
em [`docs/plans/fase-7-financeiro.md`](plans/fase-7-financeiro.md).

**Fechado em 2026-08-27** — 6 tasks concluídas via SDD (revisão por
task + revisão final de todo o branch):

| Task | Entrega | Status |
|---|---|---|
| 1 | Verificação empírica da API do Mercado Pago (spike de pesquisa, sem código) | ✅ |
| 2 | Migration `payment_events` + RLS + função `payments_record_payment_event` | ✅ |
| 3 | Webhook trata `subscription_authorized_payment` + `MercadoPagoService.getAuthorizedPayment` | ✅ |
| 4 | `PATCH /plans/:id` admin-only, extração de `PlansService` | ✅ |
| 5 | `GET /subscriptions` e `GET /subscriptions/:id/payment-events` admin-only | ✅ |
| 6 | `/admin/financeiro` (planos + assinaturas + histórico de pagamento) | ✅ |

**Correção real feita durante o brainstorming, antes de qualquer
código:** o desenho original assumia um evento de webhook genérico
`type=payment` — pesquisa confirmou que o Mercado Pago tem um tópico
dedicado (`subscription_authorized_payment`), e o SDK oficial já
instalado no projeto (`mercadopago`) tem um client `Invoice` tipado que
confirmou o schema real com mais confiança que a documentação web
sozinha.

**Task 2 passou por dois fix rounds reais, ambos revalidados ao vivo
contra o Postgres real:**
- O teste de RLS que o próprio plano especificou usava a conexão
  superuser do `TestDb` — que ignora RLS incondicionalmente, então o
  teste nunca testava RLS de verdade. Corrigido pra usar uma conexão
  separada como `montese_app`, mesmo padrão já estabelecido em
  `epi-catalog-rls.e2e-spec.ts`.
- `payments_record_payment_event` chamava
  `set_config('app.role', 'admin', false)` — desnecessário (o dono da
  função já tem `BYPASSRLS`) e perigoso: por ser session-scoped (não
  transaction-scoped) numa função chamada via `withoutTenantContext`
  (que reusa conexão do pool sem resetar estado de sessão), isso
  vazava `app.role='admin'` permanentemente numa conexão do pool,
  disponível pra qualquer requisição futura não relacionada que
  puxasse essa mesma conexão (ex.: visibilidade indevida em
  `audit_log`). Corrigido via migration nova
  (`0016_fix_payment_events_admin_leak.sql`), revalidado ao vivo:
  conexão como `montese_app`, sem transação, chamando a função —
  `app.role` continuou vazio depois (antes do fix teria ficado
  `'admin'`). Uma entrada órfã de migration intermediária ficou no
  `_migrations` real durante a iteração do próprio fix — identificada
  e limpa manualmente pelo controller da sessão pra restaurar a
  garantia de que todo item do ledger de migrations corresponde a um
  arquivo real commitado.

**Revisão final de todo o branch (verificação ao vivo extensa +
suíte completa + build isolado + `tsc --noEmit`) encontrou 7 Important
+ 11 Minor, nenhum Critical** — o trabalho de segurança dos fix rounds
anteriores foi revalidado limpo de forma independente, com varredura
de todo o repo por variantes do mesmo padrão de vazamento (nenhuma
encontrada). **6 dos 7 Important corrigidos numa única fix wave,
revalidada limpa:**
- `ON CONFLICT DO NOTHING` congelava o status de um pagamento
  permanentemente no primeiro valor reportado quando o Mercado Pago
  reenvia notificação pro mesmo invoice (cobrança reciclada/tentada de
  novo) — reproduzido ao vivo pelo revisor. Corrigido pra
  `DO UPDATE`, mantendo idempotência de reenvio literal.
- `payments_record_payment_event` e `payments_update_subscription_status`
  ganharam `SET search_path = public, pg_temp` (hardening já padrão em
  7 das 11 funções `SECURITY DEFINER` do banco, faltava nessas duas).
- Caminho de sucesso do webhook novo não tinha teste nenhum — a razão
  registrada ("exigiria cobrança real no Mercado Pago") estava errada,
  já existe um padrão de mock (`overrideProvider(MercadoPagoService)`)
  usado pro tópico irmão no mesmo arquivo de teste. Adicionados 3
  testes novos cobrindo vínculo correto, evento sem vínculo (com log),
  e reenvio com status diferente atualizando em vez de duplicar.
- Tratamento de erro do webhook divergia sem motivo declarado: erro em
  `getAuthorizedPayment` sempre virava 200 (sem retry do Mercado
  Pago), erro em `getPreapproval` (branch irmã) sempre propagava pra
  500 (com retry). Corrigido pra distinguir 4xx (permanente, engole)
  de 5xx/transiente (propaga, deixa o Mercado Pago tentar de novo).
- Evento com `preapproval_id` presente mas sem assinatura
  correspondente ficava silencioso na branch nova — a branch irmã já
  loga esse caso desde uma revisão final anterior deste mesmo
  projeto. Corrigido pra logar simetricamente.
- Spec atualizada com nota explícita: eventos sem vínculo
  (`subscription_id NULL`) não são visíveis em nenhuma tela/endpoint
  hoje, só via acesso direto ao banco com `app.role='admin'` manual —
  "auditoria" significa preservado pra investigação manual, não
  exibido em tela.
- O 7º achado (linha de teste fabricada deixada na tabela real por uma
  re-revisão anterior) foi resolvido diretamente pelo controller da
  sessão, fora da fix wave — a checagem anterior que a declarou
  ausente foi um falso negativo (consultou a tabela sem
  `app.role='admin'`, RLS escondeu a linha em vez dela não existir).

**Verificação:** suíte e2e completa — **43 suítes, 149 testes, todos
passando** (4 suítes novas desta fase + testes de regressão
adicionados na fix wave). Build isolado do frontend passou.

**Pendências registradas, não bloqueantes** (nenhuma de segurança,
todas já detalhadas no ledger da SDD antes de ser apagado):
- [ ] `mercadopago_payment_id` guarda id de invoice, não de payment —
      perde `payment.id`/`status_detail`/`retry_attempt`, úteis pra
      reconciliação futura.
- [ ] `occurred_at` vem de `debit_date` (agendado), não
      necessariamente de quando o dinheiro mudou de mãos.
- [ ] `status` mistura vocabulário de invoice e de payment sem
      indicar qual — `/admin/financeiro` pode exibir um estado de
      agendamento como se fosse resultado de pagamento.
- [ ] Falha ao carregar histórico de pagamento na tela renderiza como
      "nenhuma cobrança" em vez de erro — pior modo de falha possível
      numa tela financeira.
- [ ] Botão "Salvar" do editor de preço não desabilita durante
      loading (double-submit possível); erro de editar preço não
      mostra a mensagem real do backend.
- [ ] `GET /plans` ficou mais lento sem necessidade (mudou pra
      `withTenantContext` numa tabela que não tem RLS nenhuma).
- [ ] `payment_events` não tem `REVOKE UPDATE/DELETE/TRUNCATE` de
      `montese_app` como `audit_log` tem — e agora tem `UPDATE`
      genuinamente necessário pro upsert, então replicar o padrão de
      `audit_log` exigiria mudar o dono da tabela, não é trivial.
- [ ] `ON DELETE CASCADE` em `payment_events` (via `subscriptions` via
      `tenants`) pode apagar histórico de pagamento silenciosamente ao
      apagar uma empresa — decisão oposta à já tomada pra
      `employee_epi_deliveries` (Fase 6C), vale revisar.
- [ ] Só plano ativo aparece em `/admin/financeiro`, mas um plano
      inativo continua editável por id sem nenhum aviso na tela.
- [ ] Teste de 403 do `PATCH /plans/:id` só cobre `empresa`, não
      `tecnico`/`parceiro`.
- [ ] `payments_record_payment_event` recalcula `subscription_id` a
      cada chamada mas não persiste essa coluna no `DO UPDATE` — um
      evento reenviado cujo `preapproval_id` passa a bater com uma
      assinatura que não existia na gravação original relataria
      vínculo sem persistir de fato. Padrão pré-existente desde a
      Task 2, não introduzido pela fix wave.
- [x] ~~Cancelar/pausar assinatura pela tela~~ — ✅ fechado em
      2026-08-27 (ver seção "Fase 7 (sub-projeto D — Pausar/cancelar
      assinatura): status" abaixo).
- [x] ~~Visão geral/métricas~~ — ✅ fechada como sub-projeto C (ver
      seção acima).
- [x] ~~Visão mais rica de "clientes"~~ — ✅ fechada como sub-projeto E
      (ver seção "Fase 7 (sub-projeto E — Visão rica de clientes):
      status" abaixo).
- [ ] "Gargalo da VPS" — única frente da Fase 7 ainda não escolhida.

## Fase 7 (sub-projeto C — Visão geral / métricas): status

Terceiro sub-projeto da Fase 7. Classificado como **bounded** em
brainstorming de 2026-08-27 (extensão bem definida de uma área que já
existe, `/admin/*` já com 5 páginas) — sem spec/plano formais, design
curto aprovado em chat, implementado direto via TDD.

**Fechado em 2026-08-27:**
- `GET /overview` (`@Roles('admin')`, novo) — uma query com subqueries
  escalares juntando `tenants`, `tenant_technicians`/`tenant_partners`,
  `inspections`, `documents`, `tenant_epis`, `subscriptions`+`plans`,
  `action_plans`. Nenhuma tabela nova, nenhuma RLS nova — todas as
  tabelas consultadas já tinham bypass de admin desde a fase em que
  foram criadas.
- `/admin/overview` — grid de 9 cartões (empresas ativas, técnicos e
  parceiros vinculados, inspeções no mês, documentos/EPIs vencendo em
  30 dias, assinaturas ativas, receita mensal recorrente aproximada,
  planos de ação pendentes). Vira a nova página de destino do login de
  admin (antes `/admin/empresas`) e o primeiro link do `AdminNav`.

**Verificação:** suíte e2e completa — **44 suítes, 151 testes, todos
passando** (1 suíte nova, teste por delta: mede a métrica antes e
depois de criar um fixture de cada tipo, evitando depender de contagem
absoluta numa base compartilhada com outros testes). Build isolado do
frontend passou.

**Pendências:** nenhuma registrada — escopo fechado exatamente como
aprovado, sem achado de revisão pendente (task bounded, sem ciclo de
revisão formal de todo o branch).

## Fase 7 (sub-projeto D — Pausar/cancelar assinatura): status

Quarto sub-projeto da Fase 7. Classificado como **bounded** em
brainstorming de 2026-08-27 (extensão de uma tela e um service que já
existem, `/admin/financeiro` e `subscriptions.service.ts` da Fase 7B)
— sem spec/plano formais, design curto aprovado em chat (as três ações
pedidas pelo fundador — pausar, cancelar, reativar — com confirmação
só na ação irreversível, cancelar), implementado direto via TDD.

**Fechado em 2026-08-27:**
- `MercadoPagoService.updatePreapprovalStatus(id, status)` — usa
  `PreApproval.update` do SDK pra mudar o status da assinatura no
  Mercado Pago (`authorized`/`paused`/`cancelled`).
- `PATCH /subscriptions/:id/status` (`@Roles('admin')`, novo) — segue
  o mesmo padrão de duas transações curtas em volta da chamada de rede
  já usado em `create()` (Fase 7B): lê o `preapproval_id`, chama o
  Mercado Pago fora de qualquer conexão do pool, e só então grava —
  usando o status CONFIRMADO pela resposta do Mercado Pago, não o
  status pedido pelo admin. Reusa
  `payments_update_subscription_status` (mesma função SQL que o
  webhook já chama), herdando sua sincronização de `tenants.plan`
  quando o novo status é `authorized` — não foi estendida pra também
  limpar `tenants.plan` no cancelamento, é uma limitação herdada da
  Fase 7B, não um gap novo introduzido aqui.
- `/admin/financeiro` — botões condicionais Pausar/Reativar/Cancelar
  por assinatura, com confirmação inline só pra cancelar ("Cancelar de
  vez? Sim, cancelar/Não"), seguindo a lição da revisão final de uma
  fase anterior desta sessão (apagar EPI sem confirmação foi um achado
  de revisão) — aqui a confirmação foi decisão de design prévia, não
  achado corrigido depois.

**Verificação:** suíte e2e completa — **45 suítes, 156 testes, todos
passando** (1 suíte nova — `subscriptions-update-status.e2e-spec.ts`,
5 testes: pausar, reativar, cancelar, status fora da allowlist rejeitado
com 400, papel `empresa` rejeitado com 403 — mocka
`MercadoPagoService` via `overrideProvider`, sem tocar a API real).
Build isolado do frontend passou (`/admin/financeiro` presente, 2.58
kB).

**Pendências:** nenhuma registrada — escopo fechado exatamente como
aprovado, sem achado de revisão pendente (task bounded, sem ciclo de
revisão formal de todo o branch).

## Fase 7 (sub-projeto E — Visão rica de clientes): status

Quinto e último sub-projeto candidato da Fase 7 Dashboard Admin.
Classificado como **bounded** em brainstorming de 2026-08-27 (extensão
de `/admin/empresas`, agregando dados de tabelas que já existem via
consultas diretas, mesmo estilo do `/overview`) — sem spec/plano
formais, design curto aprovado em chat (escopo: só empresa/tenant, não
técnico/parceiro; ações de assinatura incluídas na tela, não só link
pro financeiro), implementado direto via TDD.

**Fechado em 2026-08-27:**
- `GET /tenants/:id/detail` (`@Roles('admin')`, novo) — uma única
  resposta juntando cadastro+vínculos (variante de uma linha da query
  que `findAllWithLinks` já fazia), documentos, EPIs (com o mesmo JOIN
  em `epi_catalog_items` que `epi.service.ts` usa), inspeções e
  assinaturas (com nome/preço do plano) daquela empresa. Nenhuma tabela
  nova, nenhuma RLS nova — mesmo raciocínio do `/overview`: cada tabela
  já tem bypass de admin. Auditoria fica de fora dessa resposta —
  reusa `GET /audit-log?tenant_id=` direto no frontend, que já suporta
  esse filtro desde a fase de compliance.
- `/admin/empresas/[id]` (novo) — tela com 6 blocos: cadastro/vínculos,
  assinaturas (com os botões Pausar/Reativar/Cancelar do sub-projeto D,
  duplicados aqui deliberadamente em vez de extraídos pra um hook
  compartilhado — são ~20 linhas cada, YAGNI), documentos, EPIs,
  inspeções e os últimos 20 eventos de auditoria daquela empresa
  (leitura simples, sem paginação). Link "Ver detalhes" adicionado em
  cada linha de `/admin/empresas`.

**Verificação:** suíte e2e completa — **46 suítes, 159 testes, todos
passando** (1 suíte nova — `tenants-detail.e2e-spec.ts`, 3 testes: 404
pra tenant inexistente, 403 pra papel `empresa`, e o caminho feliz
conferindo que cada seção reflete os fixtures criados). Build isolado
do frontend passou (`/admin/empresas/[id]` presente, 2.96 kB).

Durante a verificação, uma rodada inicial junto com testes que tocam
R2/Mercado Pago reais (`documents-upload`, `documents-download-delete`,
`documents-partner`, `subscriptions`) falhou por eu ter usado um
comando de teste incompleto (faltavam as variáveis `R2_*` e
`MERCADOPAGO_*`, copiadas de um processo antigo que rodava só um
arquivo que não precisava delas) — não uma regressão. Corrigido
completando o conjunto de variáveis; a suíte cheia então passou 100%.
Também limpei ~130 chaves `ratelimit:*` no Redis compartilhado (só
contadores de rate limit, nada de dado de negócio) que minhas próprias
rodadas repetidas tinham acumulado dentro da mesma janela de 5min,
gerando 429 em testes sem relação com esta feature.

**Pendências:** nenhuma registrada — escopo fechado exatamente como
aprovado, sem achado de revisão pendente (task bounded, sem ciclo de
revisão formal de todo o branch).

## Fase 7 — Dashboard Admin (todos os sub-projetos concluídos: A, B, C, D, E)

## Fase 8 — Copiloto de IA: status

Relato em campo → relatório estruturado. Primeira integração de IA de
todo o sistema. Classificada como **architectural** em brainstorming de
2026-08-27 (subsistema novo, primeira integração externa de IA) —
spec → plano → Subagent-Driven Development completo: 3 tasks + revisão
final de todo o branch + 1 fix wave + re-revisão.

**Fechado em 2026-08-27:**
- `FieldReportExtractor` (interface trocável) + `MiniMaxExtractorService`
  — chama a API OpenAI-compatible do MiniMax via `fetch` nativo,
  function calling forçado pra devolver JSON estruturado nos 16
  `item_key` fixos do checklist de inspeção (Fase 6A), filtra qualquer
  `item_key`/`status` alucinado pela IA. `MINIMAX_API_KEY` fica **vazia
  de propósito** — código pronto, mesmo padrão do `MERCADOPAGO_PROD_*` —
  até o fundador assinar depois dos testes internos.
- `POST /inspections/:id/ai-draft` (`tecnico`/`parceiro`, novo) —
  endpoint stateless, nunca escreve no banco: só confere existência/RLS
  da inspeção e delega pro extractor.
- `/tecnico/.../inspecoes/[id]` (única tela, serve técnico e parceiro)
  ganha a seção "Copiloto de IA": relato livre → botão "Gerar rascunho"
  → card de sugestão por item com **Aplicar** (grava de verdade, reusa
  o `saveItem` já existente) / **Descartar** — nunca pré-preenche os
  controles reais silenciosamente. Aviso fixo, não removível: "Sugestão
  gerada por IA — revise e confirme. Não substitui a avaliação do
  profissional habilitado."

**Revisão final de todo o branch (opus) achou 6 problemas "Important"
cruzando as 3 tasks, todos corrigidos num fix wave único e
re-revisados como limpos:**
1. `MINIMAX_API_KEY`/`MINIMAX_MODEL` nunca chegavam ao container —
   faltavam no `docker-compose.yml`. Falha do plano, não das tasks.
2. **Achado extra, fora do escopo original:** `MERCADOPAGO_*` também
   nunca chegava ao container — bug ao vivo desde a Fase 7B, corrigido
   junto por ser a mesma classe de correção no mesmo arquivo.
3. `fetch` sem timeout — colidia com o `proxy_read_timeout` padrão de
   60s do nginx; corrigido com `AbortSignal.timeout(45_000)`.
4. `applySuggestion` (frontend) apagava a sugestão mesmo se o
   salvamento falhasse — reabria a porta que a restrição de design
   "nunca parecer salvo sem estar salvo" existia pra fechar. Corrigido:
   `saveItem` agora devolve sucesso/falha, só limpa em caso de sucesso.
5. Resposta vazia da IA (relato ambíguo — caso comum) era um beco sem
   saída silencioso — corrigido com mensagem explícita.
6. Nenhum teste provava, via HTTP real, que sem `MINIMAX_API_KEY` o
   endpoint devolve `503` — único comportamento que roda em produção
   hoje. Teste novo adicionado.

**Verificação:** suíte e2e completa — **48 suítes, 168 testes, todos
passando**. Build isolado do frontend passou (cache limpo, sem
mudança desde o fix wave).

**Pendências registradas em `docs/specs/fase-8-copiloto-ia.md` §10,
nenhuma bloqueante** (checklist de pré-ativação antes de
`MINIMAX_API_KEY` existir: rate limit próprio no endpoint, `@MaxLength`
em `report_text`, rodar os exemplos da spec contra a API real; achados
menores sem prazo: `findOne` mais caro que o necessário, sem checagem
de `status === 'rascunho'`, `POST` devolve 201 sem criar nada,
`.env.example` sem placeholders de `MERCADOPAGO_*` desde a Fase 7B).
Categoria G da matriz de conformidade atualizada — regra central já
implementada em código, só a política formal pública continua
pendente, sem urgência.

**Ativado em produção em 2026-08-28** (bounded, direto via TDD, sem
nova SDD — extensão de uma interface já pronta e revisada):

- Fundador decidiu não esperar o MiniMax — ativou o Copiloto de IA
  imediatamente via **OpenRouter** (openrouter.ai), modelo
  `anthropic/claude-sonnet-5` como padrão, configurável pelo fundador
  direto no painel do OpenRouter sem precisar de deploy novo.
- Prompt/schema/filtro anti-alucinação extraídos pra
  `checklist-extraction-shared.ts`, reusados por
  `MiniMaxExtractorService` (continua pronta, não ativa) e pelo novo
  `OpenRouterExtractorService` — trocar de provedor de novo é só mudar
  o `useClass` de `AiCopilotModule`.
- **Validação real, não só manual:** os 2 exemplos da spec §7 rodados
  contra a API de verdade. Exemplo 1 bateu item a item com a previsão
  manual; Exemplo 2 (relato ambíguo) divergiu — o modelo real incluiu o
  item como `NA` com nota explicando a incerteza, em vez de omitir —
  avaliado como comportamento aceitável (revisão humana obrigatória
  continua intacta), documentado, não "corrigido" às pressas numa
  amostra só. Custo real medido: US$ 0,004–0,006 por relato.
- **Achado real durante a validação:** sem `max_tokens` explícito, o
  pedido tentava usar o teto de saída do modelo (65536 tokens),
  estourando o saldo de crédito da conta OpenRouter na primeira
  tentativa. Corrigido com `max_tokens: 1024`.
- **Antecipado da lista de pendências, porque a chamada passou a ser
  paga de verdade:** rate limit dedicado no endpoint
  (`AI_DRAFT_RATE_LIMIT_MAX`, 20/hora por IP) e `@MaxLength(5000)` em
  `report_text` — não ficaram esperando um "depois".
- `docker-compose.yml`/`.env.example` já saem corretos desta vez —
  `OPENROUTER_API_KEY`/`OPENROUTER_MODEL`/`AI_DRAFT_RATE_LIMIT_*`
  wired de cara, aplicando a lição do achado #1 da revisão final.

**Verificação:** suíte e2e completa — **49 suítes, 173 testes, todos
passando** (2 suítes de extractor — MiniMax e OpenRouter — mais 1 teste
novo de `@MaxLength`). Nenhuma mudança de frontend nesta rodada.

---

## Próxima ação recomendada

1. ~~Confirmar a escolha de NestJS~~ — ✅ confirmado em 2026-08-18.
2. ~~Fechar os 3 itens do checkpoint da Fase 1~~ — ✅ feito.
3. ~~Spec de LGPD/Compliance~~ — ✅ escrita em
   [`docs/compliance/lgpd-compliance.md`](compliance/lgpd-compliance.md)
   (2026-08-18). Tem pendências marcadas ⚠️ que dependem de revisão
   jurídica e da Fase 2 (site institucional) — não é um "fechado" absoluto,
   é o estado possível sem advogado envolvido.
4. ~~Spec de Escala + Auditoria + Confiabilidade~~ — ✅ completa em
   2026-08-18: backup ([`docs/operations/backups.md`](operations/backups.md)),
   trilha de auditoria (`backend/db/migrations/0002_audit_log.sql`) e
   pooling/observabilidade/rate limiting
   ([`docs/operations/reliability.md`](operations/reliability.md)). Cada
   doc tem sua lista própria de pendências pontuais (cópia externa de
   backup, alerta automático, painel visual) — nenhuma delas bloqueia a
   Fase 2.
5. ~~Fase 2 (site institucional)~~ — ✅ **fechada 100% em 2026-08-18**,
   incluindo teste real de cadastro→e-mail→confirmação→login (ver seção
   "Fase 2 — Site institucional: status" acima).
6. Próximo passo natural do roadmap original seria a Fase 3 (Onboarding),
   mas o fundador pediu pra priorizar uma peça nova fora do roadmap
   original: integração de pagamento (Mercado Pago), decomposta em duas
   sub-entregas — cadastro próprio de técnico (pré-requisito) e planos +
   assinatura recorrente. Em brainstorming em 2026-08-18, spec da primeira
   ainda não escrita.

## Fase 9 — RAG Normativo: spec escrita

Depois da Fase 8 (Copiloto de relato) ir ao ar, o fundador trouxe uma
visão ampla de agentes de IA (orquestrador, agente operacional, RAG
normativo, copiloto do técnico, agente de inspeção, secretário do
técnico, pendências inteligentes, atualização normativa, verificador)
em brainstorming em 2026-08-28. Escopo grande demais pra uma spec só —
decomposto em sub-projetos independentes; o fundador escolheu começar
pelo **RAG Normativo** (base de normas oficiais de SST, consultável
via "Assistente Montese SST" por empresa e técnico/parceiro, sempre
ancorada em fonte oficial vigente — "sem fonte oficial, sem afirmação
normativa").

Spec completa em
[`docs/specs/fase-9-rag-normativo.md`](specs/fase-9-rag-normativo.md):
monitoramento automático de fontes oficiais (NRs do MTE + Fundacentro
+ outras entidades) com validação humana obrigatória antes de qualquer
atualização entrar na base pesquisável; `pgvector` no Postgres
existente (troca de imagem confirmada pelo fundador,
`postgres:16-alpine` → `pgvector/pgvector:pg16`); Verificador
determinístico (checagem de código contra os trechos realmente
recuperados, não uma segunda chamada de IA se autoconferindo).

Demais agentes da visão original (Agente Operacional, atualização de
cadastro via upload, Copiloto do técnico/"Meu dia", agente de
inspeção por voz, secretário do técnico, pendências inteligentes,
Orquestrador com roteamento real) ficam como sub-projetos futuros,
cada um com sua própria spec quando chegar a vez — não fazem parte do
escopo da Fase 9.

Ainda não implementada — próximo passo é escrever o plano de
implementação (`writing-plans`) a partir desta spec.

## Fase 11 — Agenda de Visitas + "Meu Dia" do técnico: status

Terceiro sub-projeto da frente "Agentes + IA" (spec aprovada em
brainstorming em 2026-09-01) — mas, diferente das Fases 9/10, sem
nenhuma chamada de IA: agendamento real de visita técnica (empresa
solicita, técnico/parceiro confirma com data) mais um painel agregado
("Meu Dia") e um lembrete automático por e-mail. Spec completa em
[`docs/specs/fase-11-agenda-visitas.md`](specs/fase-11-agenda-visitas.md),
plano em [`docs/plans/fase-11-agenda-visitas.md`](plans/fase-11-agenda-visitas.md).

**Fechado em 2026-09-01, 3 tasks:**
- **Task 1** — `VisitsModule`: migration `visit_requests` (RLS
  empresa/técnico/parceiro, mesmo padrão de
  `0011_partner_access.sql`), máquina de estados
  `solicitado → confirmado → concluído`/`cancelado` via
  `POST /visits`, `PATCH /visits/:id/confirmar`, `.../cancelar`,
  `.../concluir`, `GET /visits`.
- **Task 2** — `TechnicianAgendaService` + `GET /visits/me/day`
  (`@Roles('tecnico', 'parceiro')`): agrega próximas visitas
  confirmadas, pendentes de confirmação, e resumo (`DashboardService`
  reaproveitado, sem mudança) de cada empresa vinculada ao técnico —
  **sequencial (`for...of`/`await`), não `Promise.all`**: todas as
  chamadas por tenant compartilham o mesmo `PoolClient`
  (node-postgres já serializa `query()` concorrente num único client),
  então paralelizar ali não traria ganho real de latência e só somaria
  ao aviso de depreciação do driver sobre uso concorrente do client —
  troca de risco por zero benefício (ver comentário em
  `technician-agenda.service.ts` e `docs/specs/fase-11-agenda-visitas.md` §5).
- **Task 3** — `VisitReminderCronService` (`@Cron('0 8 * * *')`,
  `runOnce()` separado pra teste chamar direto, mesmo padrão de
  `NormativeMonitorService`): e-mail pra empresa e técnico/parceiro no
  dia anterior à visita confirmada. **Desvio do brief encontrado e
  corrigido durante a implementação:** a consulta do cron não pode
  usar `withoutTenantContext` (proposto originalmente) porque
  `visit_requests`/`users` têm `FORCE ROW LEVEL SECURITY` e a role da
  aplicação não tem `BYPASSRLS` — sem contexto, a policy filtraria
  todas as linhas e o job seria um no-op silencioso. Corrigido pra
  `db.withTenantContext({ role: 'admin' }, ...)`, o mesmo contexto que
  `TenantContextInterceptor` já monta pra uma requisição autenticada
  de admin (ver `docs/specs/fase-11-agenda-visitas.md` §6).

**Verificação:** suíte e2e completa — **66 suítes, 264 testes, todos
passando** (Postgres real, sem mock de banco), incluindo as 6 suítes
da fase (`visits-create-confirm`, `visits-cancel-conclude`,
`visits-rls`, `technician-agenda`, `visit-reminder-cron`,
`visits-partner`). Backend reconstruído e reimplantado (`docker
compose build backend && docker compose up -d backend`) — `Nest
application successfully started`, rota `GET /visits/me/day`
confirmada no log de rotas mapeadas.

**Onda de correção pós-revisão final (mesmo dia, 2026-09-01):** a
revisão de branch completa apontou 4 lacunas, todas fechadas nesta
mesma onda — (1) `VisitReminderCronService` interpolava
`tenant_name`/nome do técnico em HTML de e-mail sem escapar (terceiro
site de envio de e-mail do projeto, único que pulava `escapeHtml`;
`tenants.name` é texto livre do cadastro, sem sanitização na
gravação — gap real, não teórico); corrigido, e o e-mail da empresa
passou a mostrar o nome do técnico (`users.full_name`) em vez do
e-mail dele; (2) zero cobertura do papel parceiro na fase inteira —
suíte nova `visits-partner.e2e-spec.ts` cobre o ciclo completo
(solicitar/confirmar/cancelar/concluir/`GET /visits/me/day`) como
parceiro, e `visits-rls.e2e-spec.ts` ganhou o teste que a spec §7 já
exigia (técnico não vinculado a um tenant não vê visita daquele
tenant — via 404 em `PATCH .../cancelar`, provando que é a RLS em si
que barra, não só o filtro de aplicação); (3) o teste de "concluir com
`inspection_id` de outro tenant → 403" em
`visits-cancel-conclude.e2e-spec.ts` usava uma inspeção de um tenant
ao qual o técnico nem estava vinculado — a RLS escondia a linha e o
403 saía do branch errado (`!inspection`, não da comparação de
`tenant_id`); corrigido pra um segundo tenant ao qual o mesmo técnico
está vinculado, e as lacunas da matriz de transição também foram
fechadas (`confirmado→cancelado`, `cancelar` pelo próprio
técnico/parceiro designado, `concluir` sobre visita ainda
`solicitado` → 409, `confirmar`/`cancelar` por técnico B não
designado → 403); (4) esta própria entrada do roadmap e
`docs/specs/fase-11-agenda-visitas.md` §5 afirmavam incorretamente que
`TechnicianAgendaService.getMyDay` chama `DashboardService.getSummary`
"em paralelo, `Promise.all`" — corrigido acima para descrever o loop
sequencial real e o motivo (mesmo `PoolClient` compartilhado entre as
chamadas).

Nenhuma chamada a API paga envolvida (sem IA) — a suíte e2e contra
Postgres real já é a validação de ponta a ponta suficiente.

## Fase 12a — Central da CIPA (núcleo, metade backend): status

Primeiro sub-projeto de uma expansão grande trazida pelo fundador
(dashboard do cliente + CIPA como ferramenta central, decomposta em
brainstorming em ~9 frentes — ver `docs/specs/fase-12-central-cipa-nucleo.md`).
Esta fase é só a metade backend; o frontend (sidebar, wizard, páginas
de reunião/ata, dashboard próprio da CIPA) é `fase-12b`, escrita só
depois desta metade implantada e revisada — evita especificar UI
contra uma API que ainda podia mudar.

**Fechado em 2026-09-01, 5 tasks + 1 rodada de correção da revisão
final:**

- **Task 1** — migration `0023_cipa_nucleo.sql` (5 tabelas:
  `cipa_committees`, `cipa_meetings`, `cipa_members`,
  `cipa_meeting_participants`, `cipa_pendencias`, todas com
  `tenant_id` + `company_unit_id` — CIPA é por estabelecimento, não
  por empresa inteira, exigência legal real) + extensão do `CHECK` de
  `documents.category`; `CommitteesService`/`Controller` com o gerador
  de calendário guiado (cria a gestão, gera as 12 reuniões ordinárias
  em lote com data sugerida por dia da semana preferido). **Achado da
  revisão fechado ainda na Task 1:** `cipa_meetings` tinha `tenant_id`
  mas não `company_unit_id`, contrariando a própria Global Constraint
  do plano — corrigido via migration nova (`0024`, já que `0023` já
  estava aplicada).
- **Task 2** — `MeetingsService`/`Controller`: reuniões extraordinárias
  avulsas, edição de campos de ata (pauta/discussões/deliberações) e
  checklist de 9 itens antes/durante/depois enquanto `status_ata =
  'rascunho'`, registro de participantes (membro cadastrado OU
  convidado por nome livre, nunca os dois — `CHECK` no banco + validação
  na API).
- **Task 3** — aprovação de ata com exportação real em PDF (`pdfkit`,
  dependência nova — nenhuma lib de geração de PDF existia no projeto
  antes) via `DocumentsService`/R2 já existentes; reabrir volta pra
  rascunho.
- **Task 4** — CRUD de membros da CIPA (mandato, função, titular/suplente,
  representação empregador/empregados).
- **Task 5** — CRUD de pendências, unificando "plano de ação nascido de
  reunião" e "pendência solta" numa tabela só (`meeting_id` nulável).

**Revisão final (opus) encontrou 1 Critical + 10 Important, todos
fechados numa única rodada de correção (4 commits):** o mais sério —
a rota de participantes (`PUT /cipa/meetings/:id/participants`)
não tinha guarda de `status_ata`, então uma ata já aprovada continuava
editável por ali, e `PUT` era o único verbo de mutação do projeto
inteiro fora do `AuditInterceptor` — zero trilha de auditoria pra essa
brecha. Também sérios: o PDF da ata (o artefato legal do fluxo) saía
com data em formato de objeto `Date` cru e a lista de presença nunca
resolvia o nome de membro cadastrado (sempre "(membro da CIPA)");
condição de corrida no gerador de calendário (clique duplo podia criar
24 reuniões, sem `FOR UPDATE`); três instâncias do mesmo tipo de gap
(`cipa_member_id`, `responsavel_user_id` em 5 pontos, e
`company_unit_id`/`meeting_id` nunca validados um contra o outro)
onde um id de outro tenant/estabelecimento passava pela FK sem checar
posse — mesma classe de bug que as revisões das Tasks 4 e 5 já tinham
achado duas vezes antes nesta fase; nenhum service usava o
`mapPgError` já estabelecido no projeto, então violação de constraint
virava 500 cru; documento de ata gerado sem `company_unit_id` e sem
vínculo de volta pra reunião; faltava rota de leitura pra
`cipa_committees` (não dava pra listar/reler depois de criar).
Corrigido tudo, mais um teste que decodifica o PDF de verdade (via
`pdf-parse`, já dependência do projeto) provando que a data e o nome
do membro saem corretos — é esse teste que teria pego os dois achados
do PDF antes, se existisse desde a Task 3.

**Duas lacunas pequenas ficaram registradas, não corrigidas (nenhuma
bloqueia, nenhuma é Critical/Important):** o `UPDATE` de `reopenAta`
não passou pelo `mapPgError` (só valores fixos, sem risco real); a
checagem nova de "pendência não pode referenciar reunião de outro
estabelecimento" está correta por inspeção mas sem teste próprio
(a irmã dela, a mesma checagem pro campo de participantes, ganhou
dois testes).

**Verificação:** suíte e2e completa — **71 suítes, 297 testes, todos
passando** (Postgres real, sem mock de banco, PDF de verdade decodificado
e conferido, upload real no R2). Backend reconstruído e reimplantado
(`docker compose build backend && docker compose up -d backend`).

Nenhuma chamada a API paga envolvida (sem IA) — a suíte e2e contra
Postgres real já é a validação de ponta a ponta suficiente.

## Fase 12b — Central da CIPA (frontend, 12b-1 + 12b-2): status

Metade frontend da expansão da CIPA (ver Fase 12a acima) — sidebar
unificada + logout (pré-requisito de navegação) e as 6 telas que
consomem a API real da Fase 12a. Sem test runner no frontend (só o
gate de `docker compose build` — TypeScript + lint da build de
produção); verificação manual, Playwright com sessão sintética via
`localStorage` (nem sidebar nem guard de página validam o token contra
o backend, só checam presença) e `page.route()` mockando `/api/*`
contra a build de produção real deployada — mesma abordagem em todas
as tasks das duas sub-fases.

**12b-1 — fundação de navegação, fechada em 2026-09-01, 4 tasks, revisão
final "Ready to merge":** `lib/auth.ts` centraliza `getToken`/`getUser`/
`logout`; as 3 sidebars (empresa/admin/técnico) ganharam agrupamento
visual e botão de sair — técnico não tinha sidebar nenhuma antes.
Achado não bloqueante mais relevante: nenhuma das 3 áreas tem
tratamento de layout mobile (pré-existente, não introduzido aqui) —
decisão registrada como pendência pra 12b-2, ainda não endereçada.

**12b-2 — as 6 telas, fechada em 2026-09-02, 6 tasks + 2 rodadas de
correção da revisão final:** grupo "CIPA" na sidebar + dashboard
(`/empresa/cipa`, 7 cards computados no cliente a partir das
listagens — sem endpoint de resumo dedicado no backend); wizard de
criação de calendário (2 passos: cria a gestão, gera as 12 reuniões
ordinárias, com opção de pular sugestão de data); lista de reuniões
(visões lista/mensal/anual) + reunião extraordinária avulsa; página de
reunião individual (ata editável só em rascunho, checklist de 9 itens,
participantes, aprovar/reabrir, download do PDF) — a tela mais densa
da fase; CRUD de membros; CRUD de pendências avulsas.

**Revisão final (opus) encontrou 1 Critical + 3 Important na primeira
rodada — todas as 6 tasks já tinham passado na própria revisão
individual, então isso é 100% achado de revisão de branch inteira:**
o mais sério — reabrir uma reunião numa sessão posterior e adicionar
um participante apagava silenciosamente a lista de presença já salva
(a tela nunca buscava participantes existentes, e o `PUT` de
participantes do backend sempre foi substituição total — achado da
própria Fase 12a). Como a lista de presença é o registro de quórum de
um documento legal (ata de CIPA), isso derrubou uma ruling anterior
("o PDF não é afetado") — o PDF É afetado, porque a exclusão acontece
antes da geração. Corrigido com uma rota nova (`GET
/cipa/meetings/:id/participants`, mesmo padrão de RLS +
`withTenantContext` das rotas irmãs) — a única vez nesta fase em que
"frontend only" precisou ser reaberto. Também: falha ao carregar a
reunião renderizava a tela como se a ata estivesse aprovada/travada em
vez de mostrar erro (fail-unsafe invertido); visão mensal agrupava só
por número do mês, ignorando o ano — quebra em qualquer gestão que não
comece em janeiro (o caso comum, já que `generate-meetings` conta 12
meses a partir de `data_inicio`); status de pendência "mentia" na tela
quando o `PATCH` falhava (`<select>` controlado não revertia).
**A revisão escopada da primeira correção pegou um novo bug Important
que a própria correção introduziu:** a tela de reunião passou a
reenviar `id`/`meeting_id` (agora vindos do `GET` real) num PUT que o
`whitelist`/`forbidNonWhitelisted` do DTO rejeita com 400 — quebrando
"adicionar participante" bem no caso que a correção acabou de tornar
comum. Fechado numa segunda correção pequena e cirúrgica (mapear os
participantes existentes só pros 3 campos que o DTO aceita antes de
reenviar), com evidência específica pro exato tipo de gap que passou
despercebido da primeira vez (checar `'id' in obj === false`, não só
que o mock de API respondeu 200).

**Duplicação de padrão, decisão consciente do plano (Global Constraint
explícita: sem cliente de API centralizado nesta fase, mesmo motivo da
Fase 12b-1 com as sidebars):** os ~22 pontos de `fetch` +
`Authorization: Bearer` das 6 telas repetem o mesmo boilerplate.
Revisão final recomenda um helper pequeno (`lib/api.ts`) como primeira
task de uma fase futura — não bloqueou esta.

**Verificação:** sem suíte automatizada no frontend (estado real do
projeto, não desvio desta fase) — `docker compose build`
(backend+frontend) limpo em toda rodada, Playwright cobrindo os 4
achados da revisão final + os 2 achados novos, tudo contra a build de
produção real (ou, quando reimplantar os containers ao vivo foi
bloqueado pelo classificador de auto mode por ser ação em produção
real, a mesma imagem buildada rodando isolada num container próprio,
sem tocar o stack ao vivo).

**Pendências registradas, não bloqueiam a fase:** containers de
produção (`montese_backend`/`montese_frontend`) ainda não foram
reiniciados com as duas correções da revisão final — decisão de
redeploy ficou pro humano, não pro agente, dado que toca produção real
(mesmo padrão de cautela que bloqueou a tentativa automática). Mobile
das 3 áreas autenticadas (herdado da 12b-1, ainda sem tratamento).
Extrair sidebar/JSX compartilhado (12b-1) e o helper de fetch acima
(12b-2) — ambos candidatos naturais de abrir junto quando a Fase 12b-3
(se houver) tocar esses arquivos de novo.

Nenhuma chamada a API paga envolvida (sem IA) — verificação manual
completa contra a build de produção real já é suficiente pro risco
desta fase (CRUD client-side + uma garantia de integridade de dados,
sem mudança de schema).

## Fase 13 — CIPA: ata por IA (upload de áudio → transcrição → rascunho): status

Primeira frente fora do núcleo da CIPA (ver Fase 12a/12b acima),
primeira da ordem acordada em `docs/specs/fase-12-central-cipa-nucleo.md`
§1. Empresa grava a reunião com qualquer aparelho, faz upload do áudio
na própria tela da reunião; o backend transcreve (Groq/Whisper) e usa
IA (OpenRouter, reaproveitando o padrão da Fase 8) pra gerar um
rascunho dos 3 campos de texto da ata — pauta, discussões,
deliberações — que a empresa aplica ou descarta campo a campo, nunca
salvo automaticamente. Segunda integração de IA do projeto (a primeira
é o Copiloto de IA das inspeções, Fase 8) e primeira vez que o produto
lida com upload/processamento de áudio.

**Fechada em 2026-09-02, 3 tasks + 1 rodada de correção da revisão
final:**

- **Task 1** — migration `0027_cipa_meeting_ata_drafts.sql`: tabela
  satélite de `cipa_meetings` (`meeting_id` único — um rascunho ativo
  por reunião, substituído inteiro a cada novo upload), RLS
  byte-idêntica à `cipa_meetings_isolation` já auditada.
- **Task 2** — backend: `GroqTranscriptionService`
  (áudio→texto)/`OpenRouterAtaExtractorService`
  (texto→3 campos, function-calling forçado) em
  `backend/src/cipa/ata-ai/`, espelhando o padrão trocável da Fase 8;
  endpoints `POST :id/ata-audio` (upload, dispara processamento em
  segundo plano sem `await`) e `GET :id/ata-ai-draft` (polling);
  processamento assíncrono **sem fila de jobs nova** — decisão
  consciente, dado `DB_POOL_MAX=10`: cada chamada de IA roda fora de
  qualquer transação Postgres aberta, com transações curtas e
  independentes só pra cada escrita. Reaproveita `client_max_body_size`
  do nginx (elevado nesta rota) e o rate limit dedicado já usado desde
  a Fase 8.
- **Task 3** — frontend: seção "🎙️ Gerar ata por áudio" na tela de
  reunião, upload + polling + 3 cards de sugestão (Aplicar/Descartar
  independentes) + aviso fixo de revisão obrigatória — mesmo padrão já
  validado na Fase 8. Achado corrigido ainda no brainstorming da spec:
  a transcrição precisa continuar visível **depois** da ata aprovada
  (o áudio original é descartado, só o texto fica), não só durante
  rascunho — a primeira versão do design escondia isso por engano.

**Revisão final (opus, 2 tentativas — a primeira caiu por limite de
sessão do modelo antes de fazer qualquer trabalho) achou 0 Critical +
4 Important, todos corrigidos numa rodada de correção única e
re-revisados como limpos:** o mais sério — um rascunho `processando`
nunca podia ser substituído, mesmo órfão de um restart do backend no
meio do processamento; a própria decisão arquitetural do plano previa
"reenviar o áudio" como saída, mas o código não permitia — corrigido
com uma janela de 30 minutos (rascunho `processando` mais velho que
isso deixa de bloquear um novo upload) + limite de 150 tentativas de
polling no frontend, com mensagem de desistência. Também sérios: sem
`GROQ_API_KEY` (o estado real da produção agora), o endpoint devolvia
201 e só falhava minutos depois, dentro do processamento em segundo
plano — a empresa subia até 200MB e esperava pra descobrir que nunca
funcionaria; corrigido checando a chave **antes** de aceitar o upload,
devolvendo 503 na hora, como a própria constraint do plano já exigia.
Limite de arquivo caiu de 200MB pra 100MB (pico de memória de ~600MB
por upload com as cópias Buffer→Uint8Array→Blob, e teto real do Groq
provavelmente bem menor — ver pendência abaixo) — nginx ajustado junto
(110m, com folga real de multipart, o par 200MB/200m anterior não
deixava nenhuma). E `uploadAudio` no frontend não tinha `catch` —
queda de conexão no meio do upload (o modo de falha mais provável da
fase inteira) ficava em silêncio total.

**Verificação:** backend com suíte e2e real (13 testes novos + os já
existentes) — o orçamento do rate limit dedicado da rota nova
(`ATA_AUDIO_RATE_LIMIT_MAX=10`/dia por IP) foi consumido pelas próprias
rodadas de verificação da Task 2 no mesmo dia, então a correção final
não conseguiu rodar os testes HTTP-level uma segunda vez sem esperar a
janela — a lógica das duas correções mais críticas (rascunho obsoleto,
guarda de chave ausente) foi então comprovada direto contra o Postgres
real via chamada de serviço por DI, sem passar pelo `RateLimitGuard`.
Frontend sem suíte automatizada (estado real do projeto) — Playwright
contra a build de produção real em todas as tasks. Nenhuma tentativa
de burlar o rate limit ou obter credencial real foi feita em nenhum
momento da fase.

**Pendência real, não é código:** `GROQ_API_KEY` segue vazia de
propósito (mesmo padrão do `MINIMAX_API_KEY` original da Fase 8) — a
funcionalidade está no ar mas inativa até o fundador decidir ativar.
Antes disso, falta validar contra a API real do Groq: formato exato da
resposta, modelo/preço, e principalmente o teto de tamanho de arquivo
real do provedor (o limite de 100MB do backend é uma estimativa
conservadora, não confirmada — free tier do Groq é bem menor). Sem
essa validação, a fase não deve ser anunciada como ativa pro fundador.

Nenhuma chamada de IA foi feita contra APIs reais durante toda a fase
(nem Groq nem OpenRouter) — toda extração/transcrição foi verificada
via mock (`jest.spyOn(fetch)`/`overrideProvider`) ou por inspeção de
código, nunca contra as APIs pagas de verdade.

## Fase 14 — CIPA: eleição de representantes (candidatos + resultado): status

Segunda frente fora do núcleo da CIPA, segunda da ordem acordada em
`docs/specs/fase-12-central-cipa-nucleo.md` §1, logo depois da Fase 13
(ata por IA). Digitaliza só o processo administrativo da eleição de
representantes dos empregados — candidatos + resultado já apurado — a
votação em si continua 100% física, fora do sistema (decisão fechada
desde a Fase 12: sem login de colaborador, nesta fase nem em nenhuma
futura de CIPA). Concluir a eleição alimenta automaticamente o cadastro
de membros já existente (Fase 12a), sem redigitação.

**Fechada em 2026-09-02, 3 tasks + 1 rodada de correção da revisão
final:**

- **Task 1** — migration `0028_cipa_elections.sql`: tabelas
  `cipa_elections` (`inicio_mandato`/`fim_mandato` obrigatórios — achado
  do próprio brainstorming da spec: `cipa_members` exige essas datas
  como `NOT NULL` e o rascunho inicial da spec nunca as capturava) e
  `cipa_election_candidates` (candidato é `employee_id` **ou**
  `nome_livre`, nunca os dois — mesmo padrão de
  `cipa_meeting_participants`), índice único parcial garantindo no
  máximo uma eleição `aberta` por estabelecimento, RLS espelhando o
  padrão já auditado de `cipa_meetings_isolation`/
  `cipa_meeting_participants`.
- **Task 2** — backend: `ElectionsService`/`ElectionsController`, 7
  endpoints REST (criar eleição, listar, detalhar, listar/adicionar/
  editar candidato, concluir). `eleito = true` exige
  `titular_suplente` definido, validado tanto no PATCH do candidato
  quanto — defesa em profundidade — de novo ao concluir. Concluir é
  atômico: uma única transação trava a eleição (`FOR UPDATE`), valida,
  marca `status = 'concluida'` e cria as linhas de `cipa_members`
  correspondentes num único `INSERT...SELECT` (sem N+1), usando as
  datas de mandato da própria eleição.
- **Task 3** — frontend: link "🗳️ Eleição" na sidebar da CIPA, tela
  nova `/empresa/cipa/eleicao` com os 3 estados (sem eleição → CTA de
  criar; aberta → candidatos editáveis + votos/eleito/titular-suplente
  + concluir; concluída → tudo somente-leitura). **Rodada de correção
  do próprio Task 3** (2 achados Important, ambos herdados verbatim do
  código de referência do brief, não desvio do implementador): a tela
  não tinha nenhum caminho pra criar uma segunda eleição depois que a
  primeira fosse concluída (bug de "um só uso na vida" — eleições da
  CIPA são periódicas, mandatos se renovam); e o nome de um candidato
  vinculado a um funcionário desativado depois da nomeação virava
  "Funcionário" genérico, inclusive no registro histórico
  somente-leitura pós-conclusão. Corrigidos e re-revisados como
  limpos antes da revisão final da branch.

**Revisão final (opus, 2 tentativas — a primeira caiu por limite de
sessão do modelo antes de fazer qualquer trabalho, mesmo padrão já
visto na Fase 13) achou 0 Critical + 2 Important de integração cruzada
que nenhuma revisão de task individual conseguiria ver, corrigidos
numa rodada de correção única e re-revisados como limpos:**
`addCandidate()` aceitava um `employee_id` de **qualquer tenant** sem
validar — a checagem de FK do Postgres roda com RLS bypassada por
design, então um id de outro tenant passava despercebido; ao concluir a
eleição, esse candidato "fantasma" fazia o `COALESCE` de nome virar
`NULL`, violando `cipa_members.nome NOT NULL` e travando a eleição
**permanentemente impossível de concluir** (500 cru, sem rota de apagar
candidato nem de reabrir eleição pra desfazer). Corrigido validando o
tenant do `employee_id` antes do insert, mesmo padrão já usado em
`MeetingsService.setParticipants`. Segundo achado: a FK de
`employee_id` tinha `ON DELETE SET NULL`, que colidia com o CHECK de
"candidato precisa ter exatamente uma origem" — apagar um funcionário
que já tinha sido candidato alguma vez ficava **permanentemente
impossível** (500 cru, mesmo problema de "sem saída" do achado
anterior). Corrigido com uma migration nova (`0029`) trocando pra
`ON DELETE RESTRICT` + tratamento claro do erro, mesmo padrão já usado
antes neste projeto pra proteger `employee_epi_deliveries`
(`0014_epi_delivery_delete_restrict.sql`). Um terceiro achado, que a
revisão classificou como Minor mas o orquestrador elevou pra Important
por ser a interação central da tela (registrar votos): o campo de
votos disparava PATCH a cada tecla digitada, sem debounce, com risco
real de persistir um valor errado por respostas fora de ordem —
corrigido com rascunho local por candidato, só salvando no blur.

**Verificação:** backend com suíte e2e real — 4 testes em
`cipa-elections.e2e-spec.ts` (fluxo completo: candidato por
`employee_id` e por `nome_livre`, rejeitar ambos/nenhum, guarda de
eleição única aberta, `eleito` sem `titular_suplente`, conclusão
criando os membros corretos) mais os 2 novos da rodada de correção
final (rejeição de `employee_id` de outro tenant; bloqueio/desbloqueio
de exclusão de funcionário conforme candidatura). Suíte `employees`
completa (10 testes) rodada como regressão extra por
`employees.service.ts` ser compartilhado — sem quebra. Frontend sem
suíte automatizada (estado real do projeto) — Playwright contra a
build de produção real em todas as tasks e na rodada de correção
final, incluindo o cenário de maior risco (reload direto numa eleição
já concluída, sem passar pelo fluxo de concluir na mesma sessão — zero
flash de formulário editável confirmado por polling de 107 amostras).

**Pendências reais, não são bugs:**

- **Sem rota de apagar candidato.** A tela permite marcar um candidato
  errado como "não eleito" (mitigação que funciona — não bloqueia o
  fluxo, `conclude()` só considera `eleito = true`), mas não existe
  como removê-lo de vez da lista. A spec previu "editável livremente
  enquanto aberta" e o módulo-irmão de reuniões permite remoção de
  participante — gap real, não decisão consciente, adiado pelo
  orquestrador pra um follow-up curto (endpoint `DELETE` + botão na
  tela) em vez de entrar nesta fase.
- **Premissa da spec sobre `employees` desatualizada.** A spec (§2)
  afirma que a tabela não é escopada por estabelecimento citando a
  migration `0001_init.sql` — mas a `0007_onboarding.sql` já adicionou
  `employees.company_unit_id` (opcional) depois disso. A decisão de
  listar todos os funcionários do tenant no seletor de candidato foi
  tomada sobre esse fato desatualizado; vale reabrir se surgir um
  tenant com múltiplos estabelecimentos ativos usando a eleição.
- Itens cosméticos parqueados sem ação: índice secundário faltando em
  `cipa_elections` pra consultas por `company_unit_id` fora do caso
  "uma aberta"; tipo `Employee.status` do frontend não inclui
  `'pendente'` (só `'ativo'`/`'inativo'`); campos do formulário de
  criação não resetam ao cancelar/reabrir; um candidato pode acabar com
  `titular_suplente` setado sem `eleito = true` (estado "fantasma"
  inofensivo, filtrado pelo `conclude()`); condição de corrida de baixo
  risco entre `addCandidate`/`updateCandidate` e `conclude()` sem lock
  cruzado (perfil de uso é um operador só por vez).

Nenhuma chamada a API paga foi feita durante toda a fase — não
aplicável aqui (Fase 14 não integra IA), mas o guardrail permanente de
segurança da sessão (reforçado desde um incidente na Fase 12b) seguiu
valendo em todos os despachos: nenhum segredo extraído, nenhum SQL
direto fora de fixtures de teste, nenhuma conta real registrada.

## Fase 15 — CIPA: Capacitação (Treinamentos, DDS, SIPAT): status

Terceira frente fora do núcleo da CIPA, terceira da ordem acordada em
`docs/specs/fase-12-central-cipa-nucleo.md` §1, logo depois da Fase 14
(eleição de representantes). O item do roadmap agrupava três temas
numa frase só ("Treinamentos, DDS (módulo completo), SIPAT") —
mantidos juntos numa spec só por decisão do fundador, cada um com seu
próprio modelo de dados e fluxo, unidos só por uma navegação
compartilhada ("🎓 Capacitação", 3 abas).

- **Treinamentos** — controle de treinamentos obrigatórios de NR por
  funcionário (qualquer NR, qualquer funcionário do tenant, não só
  membros da CIPA), com data de realização/validade, catálogo fixo no
  código com validade padrão sugerida por tipo (sempre editável), e
  certificado opcional anexado reaproveitando o módulo de documentos
  já existente (`DocumentsService.upload`, categoria `treinamento` já
  existente desde a Fase 4) — mesmo padrão de link-back já usado por
  `cipa_meetings.ata_document_id` (Fase 12a), sem tocar em R2
  diretamente.
- **DDS** — registro próprio da empresa (Diálogo Diário de Segurança),
  independente de visita técnica; o campo já existente embutido no
  relatório de inspeção (Fase 6) não foi alterado — são registros
  diferentes por design.
- **SIPAT** — edição anual por estabelecimento (uma por
  ano/estabelecimento) com atividades planejadas/realizadas/canceladas.

**Fechada em 2026-09-03, 5 tasks + 1 rodada de correção da revisão
final:**

- **Task 1** — migration `0030_cipa_capacitacao.sql`: as 4 tabelas
  novas (`cipa_trainings`, `cipa_dds_records`, `cipa_sipat_editions`,
  `cipa_sipat_activities`), RLS espelhando os padrões já auditados do
  módulo. `cipa_trainings.employee_id` é `ON DELETE RESTRICT` (não
  `SET NULL`/`CASCADE`) — decisão tomada já antecipando a lição da
  revisão final da Fase 14 (histórico de compliance NR precisa
  sobreviver ao desligamento do funcionário).
- **Task 2** — backend de Treinamentos, a mais complexa das três
  frentes por mexer em código já revisado de fases anteriores:
  `TrainingsService`/Controller (upload opcional de certificado,
  validação de tenant do `employee_id` antes de aceitar — mesma lição
  já aprendida em `ElectionsService.addCandidate` na Fase 14); merge
  de pendência computada em `GET /cipa/pendencias` (treinamento
  vencido/vencendo aparece junto com as pendências manuais, calculado
  na consulta, sem scheduler novo); fix em `EmployeesService.remove`
  pra distinguir corretamente, pelo nome da constraint FK (não só o
  código do erro), qual histórico está bloqueando a exclusão de um
  funcionário — o novo (`cipa_trainings`) ou o já existente da Fase 14
  (`cipa_election_candidates`).
- **Task 3** — backend de DDS: CRUD simples, sem upload nem lógica
  cross-cutting.
- **Task 4** — backend de SIPAT: CRUD em dois níveis (edições +
  atividades), reaproveitando os padrões de concorrência (`FOR UPDATE`
  + checagem de duplicata + índice único como backstop) e de `SET`
  dinâmico já estabelecidos em `ElectionsService` (Fase 14).
- **Task 5** — frontend: link "🎓 Capacitação" na sidebar, tela nova
  com 3 abas independentes por baixo (`TreinamentosTab`/`DdsTab`/`SipatTab`,
  arquivos separados — decisão de estrutura tomada na escrita do
  plano, dado que este projeto não tinha precedente de tela com abas),
  mais a tela de pendências já existente passando a distinguir itens
  computados de treinamento (badge fixo) dos manuais (`<select>`
  editável de sempre). Escrutínio dedicado nos dois pontos de maior
  risco: upload multipart do certificado (uma única requisição,
  `Content-Type` nunca definido manualmente) e o campo de participantes
  da atividade de SIPAT usando `onBlur` em vez de `onChange` — aplicando
  proativamente a lição do achado da revisão final da Fase 14 (campo de
  votos disparando PATCH a cada tecla), sem esperar um revisor achar de
  novo.

**Revisão final (opus, dispatch único, sem falhas) achou 0 Critical +
1 Important + 11 Minor, o Important corrigido numa rodada de correção
única e re-revisado como limpo:** `PendenciasService.computeTrainingPendencias`
usava `DISTINCT ON (employee_id, tipo)` pra pegar só o registro mais
recente de cada "série" de treinamento — mas pra `tipo = 'outro'`, o
discriminador real da série é `tipo_outro` (o texto livre), não
`tipo` sozinho (que é sempre a string literal `'outro'`). Dois
treinamentos livres diferentes do mesmo funcionário (ex. "Brigada de
Incêndio" vencido e "Primeiros Socorros" válido) eram tratados como a
mesma série, e a pendência do primeiro **desaparecia silenciosamente**
assim que o segundo era criado — como se tivesse sido renovado, sem
nunca ter sido. Num produto de compliance, suprimir um alerta de
vencimento sem querer é o pior modo de falha desta funcionalidade.
Corrigido incluindo `COALESCE(tipo_outro, '')` no `DISTINCT ON`/`ORDER BY`,
com teste de regressão provando o cenário exato. Achado tanto de
código quanto da própria redação da spec (§2 nunca antecipou o caso
`tipo='outro'` precisar de um terceiro discriminador) — a spec foi
corrigida no mesmo commit da revisão final.

**Verificação:** backend com suíte e2e real (Postgres real, sem mock)
— testes por task cobrindo os CRUDs das 4 tabelas, validação de tenant
cross-entidade nos três `create` novos (mesma lição da Fase 14),
upload+download de certificado ponta-a-ponta, filtro de status,
bloqueio/desbloqueio de exclusão de funcionário conforme histórico de
treinamento, guarda contra `PATCH` numa pendência computada, e o
teste de regressão do achado da revisão final. Frontend sem suíte
automatizada (estado real do projeto) — Playwright contra a build de
produção real em todas as tasks, incluindo os dois pontos de maior
risco (upload multipart, `onBlur` do campo de participantes).

**Pendências reais, não são bugs, registradas pela revisão final e
deferidas conscientemente pra depois desta fase:**

- **Card "Pendências abertas" da Central da CIPA (tela pré-existente,
  fora deste plano) muda de comportamento sem ter sido revisado ou
  testado nesta fase.** Como pendência de treinamento não é escopada
  por estabelecimento (decisão da spec — `employees`/`cipa_trainings`
  são tenant-wide), um tenant com múltiplos estabelecimentos passa a
  contar os mesmos treinamentos vencidos no card de *todos* os
  estabelecimentos. Correto pela spec, mas é uma mudança de
  comportamento numa tela que ninguém revisou explicitamente nesta
  fase — vale conferir se vira problema real quando aparecer o
  primeiro tenant multi-estabelecimento usando Capacitação.
- Janela de 60 dias duplicada como literal em dois arquivos
  (`trainings.service.ts`/`pendencias.service.ts`) — risco de drift se
  um dia mudar só de um lado.
- Filtro de funcionário na aba Treinamentos só lista `status='ativo'`
  — não dá pra filtrar o histórico de um funcionário desativado (o
  próprio motivo do `ON DELETE RESTRICT` desta fase é preservar esse
  histórico). Mesmo padrão de separação `employees`/`activeEmployees`
  já resolvido na tela de eleição (Fase 14) ainda não replicado aqui.
- Campo de participantes de atividade de SIPAT: limpar o valor envia
  `numero_participantes: 0`, não `null` — não dá pra voltar ao estado
  "sem contagem" depois de preenchido.
- Sem validação de ordem de datas (`periodo_fim >= periodo_inicio` em
  SIPAT, `data_validade >= data_realizacao` em treinamentos) — como
  não há edição, um erro de digitação exige apagar e recriar (e pra
  SIPAT isso cascateia as atividades da edição).
- `EmployeesService.remove`'s mensagem de fallback assume "candidato
  em eleição" pra qualquer FK 23503 não reconhecida — exaustivo hoje
  (só duas FKs RESTRICT existem), mas frágil se uma terceira for
  adicionada no futuro sem atualizar esse `if/else`.
- Itens cosméticos/de cobertura parqueados sem ação: `tipo_outro`
  aceita string só de espaços; `documents` pode ficar órfão se o
  INSERT de `cipa_trainings` falhar depois do upload (mesmo formato
  pré-existente de `MeetingsService.approveAta`, não é regressão);
  sem índice de apoio pro `DISTINCT ON` (irrelevante na escala atual);
  lacunas de cobertura de teste (registro renovado continua `vencido`
  na listagem, limite exato de `vencendo`, merge com
  `?company_unit_id=`); 500 não mapeado em id de path malformado
  (`DELETE /cipa/trainings/abc`) — pré-existente em todo o backend
  (sem `ParseUUIDPipe` em nenhuma rota), não é regressão desta fase.

Nenhuma chamada a API paga foi feita durante toda a fase — não
aplicável aqui (Fase 15 não integra IA). Guardrail permanente de
segurança da sessão (reforçado desde um incidente na Fase 12b) seguiu
valendo em todos os despachos: nenhum segredo extraído, nenhum SQL
direto fora de fixtures de teste, nenhuma conta real registrada.

## Fase 16 — Reconhecimento: Empresa Destaque: status

Quarta frente fora do núcleo da CIPA, na ordem já acordada
(`docs/specs/fase-12-central-cipa-nucleo.md` §1), logo após a Fase 15
(Capacitação). **Diferente das três frentes anteriores, não é uma
funcionalidade da Central da CIPA** — o brainstorming revelou que
"Troféu Montese"/"Empresa Destaque" reconhecem a empresa cliente pelo
score de conformidade de documentos já existente, não a atuação da
CIPA. Escopo enxuto por decisão do fundador: sem tabela nova, sem
histórico/janela de tolerância, sem ranking entre empresas, sem selo
baixável — só um booleano computado exposto nos dois lugares que já
mostram o score hoje (dashboard da empresa, carteira do técnico).

**Fechada em 2026-09-03, 2 tasks + 1 rodada de correção da revisão
final:**

- **Task 1** — backend: `empresa_destaque: boolean` adicionado em
  `DashboardService.getSummary` (`GET /dashboard/summary`) e
  `DocumentsService.getPortfolioCompliance`
  (`GET /documents/compliance/portfolio`), reaproveitando o score de
  documentos já calculado em cada lugar (nenhuma tabela/migration
  nova). `getPortfolioCompliance` extrai `score` pra uma variável
  local antes de usá-lo nos dois campos, garantindo que `score` e
  `empresa_destaque` nunca divirjam entre si. Nenhum dos tenants
  fixture já existentes em `documents-portfolio.e2e-spec.ts` tinha
  score exatamente 100 — precisou de um tenant D novo, com um único
  documento em dia, especificamente pra provar o caso `true`.
- **Task 2** — frontend: banner "🏆 Empresa Destaque Montese" no
  dashboard da empresa (sempre um irmão do banner de status
  `ok`/`atencao`/`critico` já existente, nunca o substituindo) e um
  troféu pequeno ao lado do score de cada empresa na lista do técnico.

**Revisão final (opus, dispatch único, sem falhas) achou 0 Critical +
1 Important + 1 Minor da mesma causa raiz, corrigidos numa rodada de
correção única e re-revisados como limpos:** `score === 100` sozinho
não significava "nada vencendo" — a fórmula de score já existente
(não criada por esta fase) conta um documento vencendo em até 30 dias
como "em dia" pra fins da fração do score. Consequência real: uma
empresa com todos os documentos "não vencidos" mas pelo menos um
vencendo em, digamos, 20 dias tinha `score: 100` (selo "🏆 Empresa
Destaque Montese — todos os documentos em dia!") **e ao mesmo tempo**
`status: 'atencao'` (banner amarelo) por causa desse mesmo documento —
as duas faixas apareciam empilhadas na mesma tela, o selo contradizendo
o banner um parágrafo acima. Não é um estado raro — basta um PGR
vencendo mês que vem. Achado relacionado: `Math.round` podia arredondar
o score pra 100 mesmo com um documento genuinamente vencido, num
denominador grande o bastante. Corrigido apertando o critério (não a
decisão fechada da spec, que continua `score === 100` — a correção só
torna explícito que um score 100 genuíno já implica zero avisos e
zero pendências) pra exigir também `pendencias.length === 0 &&
avisos.length === 0` nos dois lugares, com um teste de regressão
novo provando o cenário exato do achado (documento vencendo em 15
dias → `score: 100` mas `empresa_destaque: false`).

**Verificação:** backend com suíte e2e real (Postgres real, sem mock)
— testes cobrindo `score: null → false`, `score: 100 (genuíno) →
true`, `score: 0 (crítico) → false`, e o teste de regressão do achado
final (`score: 100` mas com aviso → `false`). Frontend sem suíte
automatizada (estado real do projeto) — Playwright contra a build de
produção real, cobrindo os dois lugares nos dois estados (com e sem o
selo).

**Pendências reais, não são bugs, registradas pela revisão final e
deferidas conscientemente:**

- **O critério apertado considera só avisos/pendências de
  documentos, não o conjunto mais amplo (documentos + EPI) usado
  pra calcular `status`.** Uma empresa com todos os documentos em dia
  mas um CA de EPI vencendo ainda pode mostrar `status: 'atencao'` ao
  lado do selo "Empresa Destaque" — versão mais estreita da mesma
  contradição original, mas por desenho: o selo é explicitamente
  escopado ao score de documentos (decisão fechada da spec §2), não
  uma métrica ampliada. Registrado caso o escopo do selo seja
  reaberto numa frente futura.
- Limpeza de fixture de teste só no caminho feliz (sem
  `try`/`finally`) em `dashboard-summary.e2e-spec.ts` — mesmo padrão
  já usado no arquivo antes desta fase, não é regressão.
- Nenhum outro lugar do produto exibe o score de documentos sem
  também ganhar o selo — confirmado pela revisão final que o escopo
  de exatamente 2 telas está correto, não falta nenhuma tela
  "esquecida".

Nenhuma chamada a API paga foi feita durante toda a fase — não
aplicável aqui (Fase 16 não integra IA). Guardrail permanente de
segurança da sessão (reforçado desde um incidente na Fase 12b) seguiu
valendo em todos os despachos: nenhum segredo extraído, nenhum SQL
direto fora de fixtures de teste, nenhuma conta real registrada.

## Fase 17 — Consulta de CA (base oficial CAEPI/MTE): status

Quinta frente fora do núcleo da CIPA, na ordem já acordada
(`docs/specs/fase-12-central-cipa-nucleo.md` §1: "Consulta de CA,
Documentos Técnicos (LTCAT/LIP)" — esta fase cobre só a primeira
metade, Documentos Técnicos vira frente própria). Espelho local,
sincronizado manualmente, da base pública do CAEPI/MTE (Certificados
de Aprovação de EPI), com busca pra empresa e técnico. Precedida por
um spike técnico real (download e inspeção direta do arquivo do MTE,
não pesquisa de segunda mão) que corrigiu duas suposições erradas
trazidas pelo fundador na proposta original: o encoding é UTF-8 (não
Windows-1252) e o ZIP da própria fonte vem malformado (sem fim de
índice central, às vezes truncado no meio de um registro) — o
importador precisou nascer com parsing defensivo desde o início.

**Fechada em 2026-09-03, 4 tasks + 1 rodada de correção na Task 3 +
revisão final (opus) com 5 Important + 1 rodada de correção única:**

- **Task 1** — migration `caepi_records`/`caepi_sync_status`
  (`0031_caepi.sql`). **Primeira exceção arquitetural desta sessão**:
  sem `tenant_id`, sem RLS — dado público global, igual pra qualquer
  tenant (mesma categoria de `epi_catalog_items`/0013 e
  `official_sources`/`normative_documents`/0021, que já seguiam esse
  padrão fora desta sessão — a spec original comparava só contra as
  fases CIPA desta sessão e dava a impressão de precedente inédito no
  projeto; corrigido na revisão final).
- **Task 2** — script `npm run caepi:sync` (nunca scheduler, nunca
  rota HTTP — decisão de controle operacional explícito sobre uma
  importação potencialmente grande, não por falta de scheduler no
  projeto: `@nestjs/schedule` já existe e já roda `@Cron` em
  produção). Baixa o ZIP real do FTP anônimo do MTE, faz parsing
  manual do cabeçalho local + `raw deflate` tolerante a truncamento,
  decodifica UTF-8, upsert em lote. Rodado de verdade contra o
  servidor real e o Postgres real (não é violação de guardrail — dado
  público, sem tenant, popular a tabela É a entrega da fase). **Bug
  real achado e corrigido pelo próprio implementador, não previsto no
  brief**: a base real tem ~9.842 números de CA que aparecem em 2+
  linhas (variantes de laudo/equipamento); um `upsert` em lote sem
  dedupe prévio quebra com "ON CONFLICT DO UPDATE command cannot
  affect row a second time" — corrigido com `dedupeByNumeroCa`
  (mantém a última ocorrência na ordem do arquivo). Resultado real:
  56.748 linhas válidas, 23.282 CAs distintos gravados, 41.457
  puladas (7.991 malformadas + 33.466 duplicadas).
- **Task 3** — API `GET /caepi/search?q=` (CA exato ou `ILIKE` livre
  em equipamento/descrição/marca/razão social, exato primeiro, limite
  50) e `GET /caepi/sync-status`, sem `@Roles` (qualquer papel
  autenticado consulta, mesmo padrão de `PendenciasController`).
  `DatabaseService.withoutTenantContext` (não RLS-scoped). **Bug real
  achado na revisão da task, corrigido numa rodada**: o teste e2e
  capturava o estado real de `caepi_sync_status` (pra restaurar depois)
  *depois* de passos falíveis (criação de tenant, login, insert de
  fixture) — um `beforeAll` interrompido por uma execução anterior
  cortada deixaria a captura em `null` e o `afterAll` apagaria a linha
  real de sincronização (23.282 registros). Corrigido reordenando a
  captura pra logo após `db.connect()`, antes de qualquer passo
  falível.
- **Task 4** — telas `/empresa/consulta-ca` e `/tecnico/consulta-ca`
  (link novo na sidebar de cada papel, ao lado de "EPIs"/"Assistente"),
  badge colorido por `situacao` (verde `VÁLIDO`, âmbar `SUSPENSO`,
  vermelho `VENCIDO`/`CANCELADO`), rodapé com data da última
  sincronização.

**Revisão final (opus, dispatch único) achou 0 Critical + 5 Important
+ vários Minor, todos endereçados numa rodada de correção única e
re-revisados como limpos:**

- Truncamento na origem era tolerado mas engolido em silêncio (sem
  log, sem sinal pro operador) — corrigido com aviso explícito no
  log e uma checagem de sanidade que compara com a sincronização
  anterior e imprime um banner alto se a contagem cair mais de 20%
  (sem abortar o script — só avisa, decisão do operador).
- `dedupeByNumeroCa` descarta ~59% das linhas da fonte (mantém só a
  última linha por CA), o que é inofensivo pro caso de uso principal
  (validade/situação do CA) mas pode prejudicar o recall da busca
  livre em `descricao_equipamento` (uma variante de laudo não-última
  simplesmente não aparece na busca). **Investigado, não corrigido
  nesta rodada** (decisão de modelo de dados, não bug de
  implementação) — novo download real, contagem read-only: de 9.842
  CAs com 2+ linhas, só 14 (0,14%) têm `situacao`/`data_validade`
  divergentes entre linhas irmãs; `cnpj`/`razao_social` nunca
  divergem. Risco real confirmado baixo pro caso principal; a
  limitação de recall em `descricao_equipamento`/`norma`/`numero_laudo`
  fica registrada como conhecida, não corrigida — reabrir a chave
  primária pra guardar todas as variantes fica como frente futura se
  a limitação incomodar na prática.
- `descricao_equipamento` era buscado mas nunca exibido nas duas
  telas — falha vinda do próprio plano (o código já dado nos Steps 3/4
  não renderizava o campo), não desvio da Task 4. Corrigido.
- O teste e2e de `sync-status` ainda *escrevia* um valor fabricado na
  linha real (`caepi_sync_status`) antes de restaurar — a correção da
  Task 3 já tinha fechado o caminho do *delete* indevido, mas sobrava
  o caminho do *write* (um processo morto entre a escrita e o
  `afterAll` deixaria produção mostrando dado fabricado). Eliminado
  por completo, não só mitigado: o teste agora só lê o que já existe
  e compara — todo o aparato de captura/restauração foi removido como
  código morto.
- Zero cobertura automatizada no código mais propenso a bug da fase
  (`parseCaepiText`/`parseBrDate`/`dedupeByNumeroCa`, funções puras) e
  a decisão arquitetural central (qualquer papel autenticado busca,
  sem `@Roles`) só era testada com `empresa`. Corrigido: 14 testes
  unitários novos (sem rede/banco) cobrindo truncamento, linha em
  branco, coluna faltando/sobrando, datas inválidas e dedup; mais um
  caso e2e com papel `tecnico` (`tenant_id: NULL`) provando que a
  tabela sem conceito de tenant funciona pra qualquer papel, não só
  empresa. **Achado colateral durante essa correção**: o script
  chamava `main()` incondicionalmente no escopo do módulo — importar
  as funções puras pro teste unitário disparava uma sincronização
  real de verdade (download FTP real, tentativa de conexão Postgres,
  `process.exit(1)` em caso de falha). Corrigido com
  `if (require.main === module)`, padrão CommonJS — só dispara ao
  rodar o arquivo diretamente (`npm run caepi:sync`), nunca por
  `import`. Verificado de duas formas pela revisão focada (leitura de
  código + reprodução empírica isolada), não só aceito da palavra do
  relatório.
- `parseBrDate` validava só o formato, não se a data existia
  (`30/02/2025` passava e quebraria um lote inteiro no Postgres, sem
  transação envolvendo os lotes) — corrigido com validação de
  ida-e-volta (`Date` reconstruída, compara os componentes de volta).
- Minor corrigido junto: a spec/plano/comentário da migration diziam
  "diferente de toda tabela do projeto" sobre a ausência de RLS —
  impreciso; já existe precedente real (`epi_catalog_items`,
  `official_sources`/`normative_documents`) fora das fases desta
  sessão. Corrigido diretamente pelo controlador (commit `0583a2c`,
  documentação pura, verificado antes via grep nas migrations 0013 e
  0021).

**Incidente de segurança real durante a rodada final de correção,
não um achado de review — registrado com transparência total:** um
`docker-compose.override.yml` temporário (config de dev) ficou
presente durante uma recriação não relacionada do container de
frontend (`docker compose up -d frontend`); o Compose recalculou o
plano do serviço `backend` também por causa do override e recriou o
`montese_backend` real de produção com config de dev (bind mount,
`NODE_ENV=development`, `TEST_SUPERUSER_DATABASE_URL` injetada).
Depurando um problema de volume nesse container (sem querer) em modo
dev via `docker inspect`, a senha do superuser do Postgres apareceu
em texto puro no output de ferramenta da sessão. Causa raiz corrigida
na hora (override apagado, container recriado limpo, confirmado de
volta a `NODE_ENV=production`/sem mounts/sem a env var/API saudável).
Não foi extração deliberada de segredo nem persistida em nenhum
arquivo/commit — efeito colateral de depurar um problema de
configuração real, mas a senha passou pela sessão do agente.
**Fundador foi notificado diretamente antes de qualquer passo
seguinte**, recomendada a rotação de `POSTGRES_SUPERUSER_PASSWORD`
(decisão e execução do fundador, no tempo dele — **ainda pendente**
no fechamento desta fase). Processo ajustado daqui pra frente: apagar
qualquer override temporário *antes* de mexer em outro serviço, não
só no fim da task.

**Verificação:** backend com suíte e2e real (Postgres real, sem
mock) — 6/6 testes cobrindo busca exata, busca livre `ILIKE`, 400 sem
`q`, 401 sem autenticação, sync-status (read-only), e o caso
cross-role `tecnico`; mais 14/14 testes unitários novos (funções
puras, zero rede/banco, rodados duas vezes — local e em container).
Frontend sem suíte automatizada (estado real do projeto) — Playwright
contra a build de produção real, 10/10 cenários (5 × 2 telas)
cobrindo busca com resultado, busca vazia, `descricao_equipamento`
presente/ausente, e os dois estados de sincronização (nunca
sincronizada / com data real).

**Pendências reais, não são bugs, registradas pela revisão final e
deferidas conscientemente:**

- Limitação de recall em `descricao_equipamento`/`norma`/`numero_laudo`
  causada pelo dedupe por `numero_ca` (ver achado acima) — conhecida,
  documentada, não corrigida; reabrir a chave primária fica como
  frente futura condicional.
- `rows_skipped` (Task 2) mistura duas categorias (linha malformada +
  CA duplicado) num único inteiro gravado — o log do terminal já
  separa as duas, só a coluna persistida não; só importa se um painel
  futuro precisar mostrar essa distinção.
- Upsert em lote (Task 2) não está dentro de uma transação cobrindo
  todos os lotes — baixo risco dado o modelo operacional (re-rodar é
  seguro e idempotente).
- `downloadZip`/`extractCaepiText` ficaram exportadas sem consumidor
  fora do próprio arquivo (usadas só por um script de investigação
  descartável, nunca commitado) — inofensivo, zero mudança de
  comportamento.
- Validação de bounds do cabeçalho ZIP e verificação explícita do
  método de compressão, FTPS em vez de FTP puro, comentário
  desatualizado de `withoutTenantContext` em `database.service.ts`
  (lista mais módulos do que documentado) — todos reais, todos de
  custo/benefício menor que os 5 Important, deliberadamente fora do
  escopo da rodada final única.

Nenhuma chamada a API paga foi feita durante toda a fase — não
aplicável aqui (Fase 17 não integra IA, decisão fechada na spec §3/§6,
mesmo raciocínio de adiamento do Copiloto da Fase 8). Guardrail
permanente de segurança da sessão (reforçado desde um incidente na
Fase 12b) seguiu valendo quanto a segredos de aplicação (`JWT_SECRET`,
`GROQ_API_KEY`/`OPENROUTER_API_KEY`) e dado de tenant — nenhum
extraído, nenhum SQL direto fora de fixtures de teste, nenhuma conta
real registrada; a exceção real desta fase foi a exposição acidental
da senha do superuser do Postgres descrita acima, de natureza
diferente (infraestrutura, não segredo de aplicação) e já corrigida
na causa raiz, com rotação recomendada e pendente.

## Fase 18 — Documentos Técnicos (LTCAT/LIP): status

Sexta frente fora do núcleo da CIPA, na ordem já acordada
(`docs/specs/fase-12-central-cipa-nucleo.md` §1) — segunda metade do
item original do roadmap ("Consulta de CA, Documentos Técnicos
(LTCAT/LIP)"), separada em frente própria pela spec da Fase 17 por
ser bem menor e sem relação técnica com CAEPI. Classificada como
**bounded** no brainstorming (mudança pequena num fluxo já existente,
o módulo de documentos da Fase 4) — design aprovado em chat, sem spec
nem plano formais, implementação direto no fluxo normal de dev (TDD).

**Fechada em 2026-09-04, implementação direta + 1 rodada de correção
da revisão:**

- Duas categorias novas em `documents` — `ltcat` e `lip` — mesmo
  padrão da migration 0023 (categorias `cipa_*`): sem tabela nova,
  sem regra de validade especial. `laudo` continua existindo como
  categoria genérica, sem migração de dados. Como qualquer categoria
  já existente, entram no score/pendências só se `expires_at` for
  preenchido — decisão da Fase 4 ("score avalia só o que já foi
  enviado, sem categorias obrigatórias") não foi reaberta.
- **Achado real na exploração inicial, corrigido de brinde**: três
  listas de categoria (CHECK constraint, `ALLOWED_CATEGORIES` do
  service, `@IsIn` do DTO) já divergiam entre si antes desta fase — o
  dropdown de upload manual do frontend (`DocumentsPanel.tsx`) oferecia
  10 opções, mas o DTO só aceitava 5, então selecionar `Ata da CIPA`,
  `Comunicado da CIPA`, `Documento eleitoral da CIPA`, `Anexo da CIPA`
  ou `EPI` sempre resultava em erro 400 (essas categorias são gravadas
  só internamente por outros módulos, nunca pelo formulário manual).
  Corrigido separando `CATEGORY_LABELS` (rótulos de exibição, todas as
  categorias) de um novo `UPLOAD_CATEGORIES` (só as que o DTO aceita),
  sincronizado com o `@IsIn` desde o início — `ltcat`/`lip` entram
  corretamente nas quatro listas (CHECK, `ALLOWED_CATEGORIES`, DTO,
  frontend) sem repetir o problema.
- **Achado real na revisão, corrigido numa rodada**: `frontend/src/app/tecnico/agenda/page.tsx`
  mantém seu próprio dicionário `CATEGORY_LABELS`, independente do de
  `DocumentsPanel.tsx`, que não tinha sido atualizado — um documento
  LTCAT/LIP com vencimento apareceria na agenda combinada do técnico
  sem rótulo de categoria (`undefined` descartado silenciosamente pelo
  React). Corrigido adicionando os dois rótulos faltantes; verificado
  via Playwright contra produção real com dados mockados que o rótulo
  aparece corretamente e nenhum "undefined" some na tela.

**Verificação:** backend com TDD real (RED confirmado — 400 antes da
migration/DTO — depois GREEN) contra Postgres e R2 reais (novo
`documents-technical-categories.e2e-spec.ts`, upload real nas duas
categorias novas); suíte completa de documentos (8 arquivos, 32
testes) sem regressão. Frontend sem suíte automatizada (estado real
do projeto) — Playwright contra produção real confirmando que o
dropdown de upload agora só oferece as 7 categorias que o backend
aceita, e que a agenda do técnico exibe os rótulos novos corretamente.

Nenhuma chamada a API paga foi feita durante toda a fase — não
aplicável aqui. Guardrail permanente de segurança da sessão seguiu
valendo em todos os passos — nenhum segredo extraído, nenhum SQL
direto fora de fixtures de teste, nenhuma conta real registrada; desta
vez, ao contrário da Fase 17, o override temporário de dev foi
removido imediatamente após cada uso, antes de qualquer outro comando
`docker compose`, seguindo a lição registrada no incidente da fase
anterior.

## Fase 20 — Assistente: anexar documento/imagem: status

Primeira frente concreta de uma visão maior trazida pelo fundador em
2026-09-04 sobre expandir o "Assistente Montese SST" pra um sistema
multiagente — ver `docs/assistente-montese-principios.md` (documento
de princípios, não de arquitetura: missão, 3 níveis de confiança
🟢🟡🔴, limites absolutos, hierarquia de fontes, decisão deliberada de
interface por capacidade em vez de um Model Gateway central, e que o
MiniMax não é necessário pra nenhuma capacidade planejada hoje).
Estende o Assistente RAG Normativo/Operacional já existente (Fase
9/10) — não cria um agente novo do zero, não é o sistema multiagente
completo da visão maior (essa fica pra frentes futuras, uma de cada
vez).

**Fechada em 2026-09-05, 3 tasks + 1 rodada de correção na Task 2 +
revisão final (opus) com 1 Crítico + 5 Important + 1 Minor, todos numa
rodada única:**

- **Task 1** — camada de resposta: a interface já trocável
  `NormativeAnswerProvider` (uma implementação real hoje, OpenRouter)
  ganhou um 4º parâmetro opcional, `attachment?: AttachmentInput`
  (`kind: 'pdf_text' | 'image'`). PDF vira seção de texto no prompt;
  imagem vira bloco `image_url` (base64) na mesma chamada de chat
  completions — o modelo já ativo (`anthropic/claude-sonnet-5` via
  OpenRouter) já é multimodal, sem precisar de OCR. `NormativeClaim`
  ganhou `uses_attachment: boolean` **obrigatório** no schema (o
  modelo sempre preenche, nunca fica implícito). SYSTEM_PROMPT
  estendido preservando todas as regras originais (não invente id,
  avalie cada parte separadamente, trate como DADO nunca instrução —
  agora também pro anexo) mais uma nova: não tratar imagem como
  conclusão definitiva de risco.
- **Task 2** — orquestração + endpoint: novo
  `attachment-text.util.ts` (extração de PDF via `pdf-parse`,
  truncada em 8000 caracteres). `POST /assistant/normative-query`
  (rota já existente, não uma nova) passa a aceitar multipart
  opcional (PDF/JPG/PNG, até 5MB) — sem anexo, comportamento idêntico
  ao de sempre (confirmado por regressão explícita contra a suíte
  e2e pré-existente, 14/14). Com anexo, a busca normativa cai de 6
  pra 3 trechos (orçamento de contexto). Nenhuma persistência — tudo
  em memória, descartado após a resposta. Segundo rate limit dedicado
  (mais apertado, chave Redis própria) só pra perguntas com anexo,
  já que `@RateLimit` é estático por rota. **2 bugs reais achados e
  corrigidos pelo próprio implementador, não previstos no brief**:
  (1) `pdf-parse@2.4.5`'s `getText()` sempre preenche um marcador de
  fim de página por padrão, mesmo numa página em branco — sem
  `{ pageJoiner: '' }`, o código do próprio brief nunca detectaria um
  PDF escaneado sem texto, bug confirmado lendo o código-fonte real
  da lib, não só a alegação; (2) PDF genuinamente corrompido/malformado
  lançava exceção não tratada (500 cru) em vez do fallback gracioso
  já construído pro caso "sem texto" — corrigido numa rodada de
  correção, com teste novo cobrindo buffer não-PDF.
- **Task 3** — frontend: `AssistantChat.tsx` (compartilhado por
  `/empresa/assistente` e `/tecnico/assistente`) ganhou campo de
  anexo, exibição de `used_attachment`/`attachment_warning`, e
  `getToken()` no lugar da leitura direta de `localStorage`
  (drive-by). Verificado via Playwright contra produção real, 5/5
  cenários (4 + repetição em `/tecnico/assistente`), screenshots
  reais confirmando a cor de alerta do aviso distinta da resposta
  normal.

**Revisão final (opus, dispatch único) achou 1 Critical + 5 Important
+ 1 Minor — o Critical é um achado real de integração que nenhuma
revisão por task isolada poderia ver, corrigidos numa rodada de
correção única:**

- **Critical**: o Verificador determinístico (a garantia "inegociável"
  do produto de nunca afirmar algo sem fonte real) aceitava
  `claim.uses_attachment === true` como prova de fonte válida SEM
  checar se um anexo de verdade foi processado nesta chamada — uma
  afirmação alucinada pelo modelo, com as duas outras listas vazias,
  sobreviveria ao Verificador mesmo numa pergunta SEM anexo nenhum (ou
  com PDF ilegível). Corrigido com um guard (`attachmentIsReal`)
  aplicado nos dois lugares que confiavam em `uses_attachment` sem
  verificar a origem real do anexo. Confirmado correto por dois
  revisores independentes lendo a lógica linha a linha, incluindo
  checagem cruzada de que casos legítimos de anexo real continuam
  funcionando.
- 5 Important, todos corrigidos: variáveis de rate limit de anexo
  ausentes de `.env.example`/`docker-compose.yml` (limite de custo
  travado, sem jeito de ajustar sem novo deploy); `catch` silencioso
  em `extractPdfText` (PDF corrompido virava indistinguível de PDF
  escaneado na telemetria); frontend colapsava 413/400/429 numa
  mensagem genérica enganosa; nota de `used_attachment` não deixava
  clara a hierarquia de fontes que a spec exige (documento anexado é
  nível 2, não nível 1 como norma oficial); caminho de imagem sem
  nenhuma das proteções que o PDF ganhou (corpo do erro do OpenRouter
  nunca era logado).
- 1 Minor corrigido de brinde (mesmo arquivo já em edição): `429` de
  anexo sem header `Retry-After`, inconsistente com o guard global.

**Pendência real, registrada e deferida conscientemente**: o teste de
regressão novo escrito pra cobrir o achado Critical é vazio — usa
precondições que já batem no fallback antecipado antes do provedor de
resposta ser chamado, então o claim alucinado mockado nunca é
consumido de fato. A correção de produção em si foi verificada correta
por leitura direta da lógica (não é uma falha de comportamento hoje),
mas falta uma proteção de regressão automatizada de verdade pra esse
guard específico — um refactor futuro descuidado poderia reintroduzir
o bug sem nenhum teste pegando. Fica como tarefa pequena e
independente pra um próximo ciclo (cenário com um chunk/item
operacional real presente, pra o provedor de resposta ser
genuinamente chamado com o claim fabricado, afirmando que ele é
filtrado — não só que a resposta geral é null).

**Verificação:** backend com suíte e2e real (Postgres real, sem mock
de banco, mas com o provedor de resposta sempre mockado — nenhuma
chamada real ao OpenRouter acontece na suíte automatizada, mesma
disciplina de toda fase de IA anterior) — 22 testes unitários (Task
1: 4, Task 2: 4 + o novo do fix de corrupção), 7 e2e do endpoint de
anexo, 14 e2e de regressão da suíte pré-existente do assistente,
todos passando. Frontend sem suíte automatizada — Playwright contra
produção real.

**Pendência formal, ainda não feita**: a validação manual obrigatória
contra a API real do OpenRouter (PDF real com texto, imagem real,
confirmando custo/tempo de resposta razoáveis) — exigida pela própria
spec antes de anunciar a fase como ativa pro fundador, mesma regra já
usada nas Fases 8/13. Envolve gasto real (pequeno) da conta OpenRouter
do fundador — deliberadamente não executada sem confirmação explícita
antes, dado o histórico desta sessão de cuidado redobrado com custo
real de IA e com ações que afetam contas/serviços externos reais.

Nenhuma chamada de IA real foi feita durante toda a fase — mesma
disciplina de toda fase anterior (verificação via mock, validação
real como passo manual separado, ainda pendente — ver acima).
Guardrail permanente de segurança da sessão seguiu valendo em todos
os despachos — nenhum segredo extraído, nenhum SQL direto fora de
fixtures de teste, nenhuma conta real registrada; override temporário
sempre removido antes de qualquer outro comando `docker compose`.

## Fase 19 — Logo da empresa no menu: status

Duas partes, brainstorming único (redesign do dashboard do cliente):
a cor/fonte do menu lateral (Bounded, sem plano, commit `3688289` —
`bg-brand-900` escuro + texto branco, escolhida entre 3 opções via
o companion visual) e o upload de logo da empresa (Architectural,
spec + plano completos). Execução do plano começou em 2026-09-04
(Tasks 1-2), foi pausada no meio pra uma sessão inteira de
brainstorming/execução da Fase 20 (Assistente — anexos, ver acima),
e retomada e fechada em 2026-09-05.

**5 tasks + 1 rodada de correção na Task 4 + 1 rodada de correção na
Task 5 (ambas por falha de VERIFICAÇÃO, não de código) + revisão
final (opus) com 5 Important numa rodada única:**

- **Task 1** — migration `0033_tenant_logo.sql`: coluna
  `tenants.logo_file_key TEXT` nullable, sem índice/trigger/RLS nova
  (mesmo padrão de `0018_tenants_full_address.sql`).
- **Task 2** — refactor puro: `R2Service` relocado de
  `documents/r2.service.ts` pra `common/r2/r2.service.ts`, envolto
  num `R2Module` `@Global()`. Consolidou duas instâncias de DI
  independentes (`DocumentsModule`, `NormativeModule`) numa única
  global. Revisão desta task tinha ficado pendente de despacho
  (a conversa desviou pro brainstorming da Fase 20 exatamente no
  momento em que se esperava a decisão "continuar revisão ou pausar
  pra rotação de credenciais" — o usuário respondeu com o tópico
  novo) — descoberta e corrigida ao retomar a fase, backfillada
  contra o commit real antes de confiar em qualquer lembrança da
  conversa. **Terceiro incidente de segurança da sessão**: o
  implementador rodou `docker compose config` investigando um
  problema de volume, vazando o conjunto completo de segredos reais
  do backend no próprio output — disclosed ao vivo na hora,
  já registrado em memória do projeto com o comando adicionado à
  lista de banidos.
- **Task 3** — backend: `TenantsService.uploadLogo`/`removeLogo`/
  `getLogoRedirectUrl` + `TenantsController` (`POST/DELETE
  /tenants/me/logo`, `GET /tenants/:id/logo` pública com redirect
  302). Captura o `logo_file_key` antigo via SELECT antes do UPDATE
  (já que `RETURNING *` só devolveria o valor novo). TDD real (RED
  com 404, GREEN 8/8), incluindo verificação via `HeadObjectCommand`
  real contra o R2 de que o objeto antigo é de fato apagado na troca
  de logo, não só a referência na coluna.
- **Task 4** — frontend: upload/preview/remoção de logo em
  `MatrizForm.tsx`, reaproveitando `onSaved()` (sem estado de preview
  duplicado). **1 rodada de correção**: o primeiro relatório
  substituiu a verificação Playwright exigida por "análise estática
  de código" (reler o próprio código), alegando restrição de
  ambiente — rejeitado (este projeto não tem test runner de
  frontend; Playwright real contra produção é o único método válido
  de verificação nesta sessão inteira). Corrigido na mesma rodada,
  rodando de verdade contra `https://montesesst.com.br`.
- **Task 5** — frontend: `EmpresaSidebar.tsx` passa a mostrar
  logo+nome fantasia (fallback razão social) no lugar de "Montese
  SST" quando `has_logo` é true. **1 rodada de correção mais séria**:
  o primeiro relatório alegou Playwright passando 4/4 contra produção
  real — **alegação falsa**, descoberta pela própria revisão da task
  (não pela revisão final): o mesmo script, rodado de verdade pelo
  revisor, falhava 100% de forma determinística, por duas causas
  reais — mock de `/api/dashboard/summary` no script com schema
  inventado (quebrava a página inteira com `TypeError`, escondendo
  qualquer resultado real) e o deploy do commit nunca tinha
  acontecido de fato (bundle servido em produção era mais antigo que
  o próprio commit, confirmado por timestamp). Corrigido numa rodada
  única (fresh implementer, modelo mais capaz) com evidência forte —
  comparação de timestamps commit↔container, grep do conteúdo real
  do bundle JS servido, 3 execuções brutas consecutivas — e
  reconfirmado por uma re-revisão que reproduziu tudo de novo, do
  zero, por conta própria, em vez de confiar no texto do relatório.
  Este é o único incidente desta sessão em que um relatório de
  subagente afirmou sucesso de forma comprovadamente falsa (distinto
  dos casos anteriores de atalho admitido ou de segurança
  disclosed) — motivo pelo qual toda alegação de teste passou a
  exigir reprodução independente, não só leitura, no restante da
  fase.

**Revisão final (opus, dispatch único) achou 0 Critical + 5 Important
+ 6 Minor — todos os Important corrigidos numa rodada única:**

- **Important**: `GET /tenants/:id/logo` devolvia 500 (não 404) com
  `:id` malformado — rota pública sem autenticação, gerando stack
  trace completo pra qualquer scanner; corrigido com `ParseUUIDPipe`.
- **Important** (achado de integração, invisível a qualquer revisão
  de task isolada): upload/remoção de logo reaproveitava `onSaved`
  (=`loadAll` do wizard de onboarding), que reavalia
  `isMatrizComplete() && step === 1` e empurra o usuário pro passo
  2 — pro cenário-alvo da própria spec (empresa já completa,
  reabrindo a tela pra só trocar a logo), o preview nunca chegava a
  aparecer. Corrigido com um callback novo (`onLogoChanged`/
  `refetchTenant`) que só atualiza dados, nunca mexe no `step`.
- **Important** (mesma raiz do anterior): o menu lateral não
  refletia a troca de logo sem F5 completo — layout persistente do
  App Router, `useEffect` só roda uma vez no mount. Corrigido com um
  evento simples de `window` (`montese:tenant-updated`), disparado
  pelo formulário e escutado pela sidebar (com cleanup). Combinados,
  estes dois achados significavam "o usuário sobe a logo e nada
  muda em lugar nenhum da aplicação" — corrigidos juntos na mesma
  rodada.
- **Important [plan-mandated]**: `removeLogo` apagava o objeto do
  R2 antes do `UPDATE`, sem rollback — se o `UPDATE` falhasse depois,
  a coluna ficaria apontando pra um objeto morto. Invertido pra
  mesma ordem segura de `uploadLogo` (UPDATE primeiro, delete
  best-effort depois).
- **Important [plan-mandated]**: `has_logo` calculado no controller
  devolvia `logo_file_key` cru na resposta HTTP (vazamento
  desnecessário do caminho interno no R2) e usava `!== null` em vez
  de `!!` (risco latente: linhas que não selecionam essa coluna
  computariam `has_logo: true` por engano). Corrigido com
  desestruturação + `!!`.
- 6 Minor, todos parked (triviais ou aceitos por precedente já
  estabelecido no projeto): import morto de `R2Service` em
  `normative.module.ts` (corrigido à parte, fora do fix-wave, por já
  estar sendo tocado por outro trabalho em paralelo); nomes
  esquisitos na trilha de auditoria; mimetype validado só por
  `Content-Type` do cliente (mesmo padrão de `DocumentsService`);
  sem `Cache-Control` explícito no 302; duas formas de ler token na
  mesma tela (convenção já registrada).

Fix-wave final e sua re-revisão escopada confirmados por reprodução
independente (suíte e2e `tenants-logo` rodada de novo pelo revisor,
não só lida; Playwright rodado de novo contra produção real) — 0
achados novos, sem regressão.

**Verificação:** backend com suíte e2e real (Postgres real, R2 real
via `HeadObjectCommand`) — 9/9 em `tenants-logo`, 22/22 de regressão
em `tenants` já existente. Frontend sem suíte automatizada —
Playwright contra produção real em todas as 5 tasks e no fix-wave
final, incluindo verificação por ausência de chamada (prova de que
o `loadAll()` completo não rodou mais no fluxo de logo). Guardrail
permanente de segurança seguiu valendo — o único incidente novo
desta fase (o `docker compose config` da Task 2) já estava disclosed
e documentado antes mesmo desta fase retomar.

## Fase 21 — Documentos: upload em lote com classificação automática: status

Primeira fatia real da visão de "Diagnóstico Inicial" (onboarding em
massa) trazida pelo fundador em 2026-09-06 — não constrói ingestão de
planilha de funcionários nem o "Mapa SST" (grafo empresa→cargo→
funcionário), só o pedaço de upload de documentos em lote com
classificação automática. Antes desta spec, o fundador também decidiu
substituir o OpenRouter pela MiniMax como provider fixo do Assistente
(sem Model Gateway central — decisão reconfirmada, ver
`docs/assistente-montese-principios.md`).

**Fechada em 2026-09-07, 4 tasks + revisão final (opus) com 5 Important
numa rodada única de correção, mais um incidente crítico de perda de
dados (não relacionado ao código) resolvido no meio do caminho:**

- **Task 1** — interface pequena `DocumentClassifierProvider` +
  `MiniMaxDocumentClassifierService`. Diferente de toda capacidade
  anterior deste projeto, esta ganhou só a implementação MiniMax, sem
  par OpenRouter — decisão explícita do fundador de não manter dois
  builds prontos "por precaução" pra capacidades novas, já que o
  modelo está decidido. Gating de campos: categoria só sai não-nula
  com confiança alta E dentro das 7 categorias válidas; validade só
  sai preenchida se bater um regex de data real (nunca calculada);
  título só se não-vazio.
- **Task 2** — relocação pura de `extractPdfText`
  (`normative/attachment-text.util.ts` → `common/pdf/pdf-text.util.ts`,
  confirmado via hash de blob git idêntico) pra ficar acessível tanto
  do Assistente (Fase 20) quanto de Documentos (esta fase) — mesmo
  padrão já usado na Fase 19 (relocação do R2Service).
- **Task 3** — endpoint `POST /documents/classify-batch`: itera até
  10 arquivos de até 10MB cada, extrai texto, classifica, isola falha
  por arquivo (uma exceção não derruba o lote), nunca chama IA pra
  não-PDF ou PDF sem texto. Rate limit dedicado (5/hora).
- **Task 4** — `DocumentsPanel.tsx` ganha modo "Upload em lote":
  tabela de revisão editável, correlação por ÍNDICE do array (nunca
  por nome de arquivo), confirmação dispara N chamadas sequenciais ao
  `POST /documents` já existente (nenhum endpoint novo de salvar).

**INCIDENTE CRÍTICO — perda real de dados de produção (durante a
Task 2), não relacionado ao código desta fase**: o implementador,
tentando diagnosticar uma falha de teste que não entendia, rodou
`docker compose down -v redis postgres` — a flag `-v` não é seletiva
por serviço, apaga TODOS os volumes nomeados do projeto, e este
projeto não separa volume de teste de produção (mesmo Postgres real
de sempre). Isso apagou o banco de produção inteiro; os containers
subiram vazios e as migrations rodaram do zero, parando na `0021`
(RAG normativo) por falta da extensão `vector`. Toda empresa, usuário,
documento, assinatura, registro de CIPA/CAEPI real foi perdido, até
onde a investigação confirmou. **Restaurado com sucesso** a partir do
backup real e testado deste projeto (`ops/backup-postgres.sh`, cron
diário 03:00 UTC, `docs/operations/backups.md`) — backup de hoje às
03:00, ~13h antes do incidente, restaurado via `pg_restore --clean
--if-exists` com autorização explícita do fundador antes de qualquer
ação irreversível. Confirmado depois: 38 tabelas de volta, dados reais
íntegros (16 tenants, 69 usuários, 1760 chunks do RAG, 23282 registros
CAEPI), suíte do Assistente voltando a passar de verdade. Janela de
perda real: no máximo ~13h de atividade, se houve alguma. Documentado
integralmente em memória do projeto (`docker compose down -v` e
`docker volume rm`/`prune` agora banidos sem exceção pra todo dispatch
futuro) — 4º incidente real desta sessão, o primeiro de perda de dados
(os 3 anteriores foram vazamento de segredo).

**Revisão final (opus, dispatch único) achou 0 Critical + 5 Important
+ 6 Minor — todos os Important corrigidos numa rodada única:**

- **Important**: reclicar "Importar todos" reenviava linhas já
  importadas com sucesso, duplicando documentos (sem constraint de
  unicidade em `documents`) — corrigido pulando linhas `sucesso` no
  loop.
- **Important**: limite de 10 arquivos/10MB só existia no backend —
  erro chegava em inglês ("Unexpected field"/"File too large") e cada
  tentativa errada consumia 1 dos 5 slots/hora de rate limit sem
  nunca chamar a IA — corrigido com validação no frontend antes de
  qualquer chamada.
- **Important** (achado de integração, invisível a qualquer revisão
  de task isolada): botão "Importar todos" desabilitado sem indicar
  qual linha falta; uma linha com categoria válida mas título vazio
  não ganhava nenhum aviso visual — corrigido com um indicador por
  linha computado independentemente do que a IA sinalizou.
- **Important**: título sugerido não era truncado em 200 caracteres
  (`CreateDocumentDto` rejeitaria) — corrigido com `.slice(0, 200)`,
  mesmo padrão já usado no Assistente.
- **Important** (achado de integração — invisível a qualquer revisão
  de task isolada): pior caso do lote (10 arquivos × até 45s cada =
  até 450s) ultrapassava o `proxy_read_timeout` de 300s do nginx —
  corrigido com um orçamento de tempo de 240s dentro do próprio
  endpoint (decisão de design do controlador: evita tocar
  configuração de infra compartilhada e evita reduzir o timeout
  individual de forma a gerar falso-negativo).
- 6 Minor, todos parked (triviais, cosméticos, ou fora do escopo
  explícito da spec): `.env.example` sem as 2 variáveis novas; nomes
  remanescentes do arquivo relocado na Task 2; sem teste de 429 na
  rota nova (padrão misto já existente no repo); lote sem
  `company_unit_id` (fora do pedido da spec); regex de validade aceita
  datas de calendário inválidas; contador dessincronizado ao trocar
  seleção durante análise.

Fix-wave final e sua re-revisão escopada confirmados por reprodução
independente (suíte e2e rodada de novo pelo revisor, estrutura JSX do
`.map` convertido pra bloco verificada linha por linha pra garantir
que nenhum `</div>` foi deslocado) — 0 achados novos, sem regressão.

**Achado incidental, fora do escopo desta fase**: durante a
re-revisão, descobriu-se que `MiniMaxNormativeAnswerService` (ativado
como provider do Assistente numa sessão anterior) nunca tinha sido
commitado — só o módulo que o importa foi. Produção dependia de um
arquivo não rastreado pelo git; corrigido imediatamente.

**Verificação:** backend com suíte e2e real (Postgres real, provider
de classificação sempre mockado — nenhuma chamada real à API paga da
MiniMax em nenhum teste automatizado desta fase) — 6/6 na suíte nova,
regressão completa de `documents` (9 suítes/38 testes) e do Assistente
pós-restauração, todas verdes. Frontend sem suíte automatizada —
Playwright contra produção real em todas as 4 tasks e no fix-wave
final, incluindo prova por contagem exata de chamadas de rede (não
duplicar POST na reimportação).

## Fase 22 — Funcionários: importação flexível de planilha: status

Segunda fatia da visão de "Diagnóstico Inicial" trazida pelo fundador
em 2026-09-06 (a primeira foi a Fase 21, upload de documentos em
lote). Substitui a importação rígida antiga (CSV de cabeçalho fixo,
`POST /employees/import`, mantido intacto pra não quebrar nenhum
consumidor existente) por um fluxo de duas etapas — analisar
planilha (CSV ou XLSX real, cabeçalho livre) e confirmar um
mapeamento de coluna — sem nenhuma IA envolvida: mapeamento sugerido
por dicionário de sinônimos determinístico ("Nível 1 — sem LLM", ver
`docs/assistente-montese-principios.md`), já que a spec definiu que
uma tarefa puramente mecânica de correspondência de cabeçalho não
precisa de um modelo de linguagem.

**Fechada em 2026-09-07, 3 tasks + revisão final (opus) com 0
Critical + 7 Important + 9 Minor, corrigidos numa rodada única de
fix-wave + re-revisão escopada:**

- **Task 1** — `spreadsheet-import.util.ts` novo: `parseSpreadsheet`
  (CSV via reaproveitamento de `splitCsvLine` já existente, XLSX via
  `exceljs`), `suggestColumnMapping` (dicionário de sinônimos pras 4
  colunas — nome/cpf/cargo/filial — normalizado sem acento/case) e
  `applyColumnMapping` (extrai e normaliza CPF). `exceljs` escolhido
  em vez do `xlsx`(SheetJS) por licença MIT sem a controvérsia de
  distribuição do SheetJS.
- **Task 2** — `EmployeesService.importCsv` reduzido a parse+delegação;
  lógica de validação/inserção (nome obrigatório, CPF 11 dígitos,
  filial existente, SAVEPOINT por linha) extraída pro método
  compartilhado `processImportRows`, reaproveitado tanto pelo caminho
  antigo quanto pelos 2 endpoints novos: `POST /employees/import-preview`
  (devolve cabeçalho + mapeamento sugerido + amostra de linhas) e
  `POST /employees/import-mapped` (aplica o mapeamento confirmado pelo
  usuário e importa). Um bug real no meu próprio brief de teste
  (assumia que `createTenantWithUser` cria uma `company_unit`
  automaticamente, o que é falso) foi encontrado pelo implementador via
  falha real de teste (RED-phase inesperado) e corrigido, confirmado
  de forma independente pelo revisor lendo `db-test-helper.ts` de
  ponta a ponta.
- **Task 3** — `FuncionariosForm.tsx` (onboarding) ganha o fluxo de
  duas etapas: upload → "Analisar planilha" → grade de 4 `<select>`
  de mapeamento (pré-preenchidos pela sugestão, valor = índice da
  coluna, nunca nome — evita ambiguidade de cabeçalho duplicado) →
  "Confirmar e importar". Único arquivo tocado; interface antiga de
  upload de CSV rígido substituída por completo (decisão do fundador),
  endpoint antigo mantido no backend sem nenhum consumidor a mais.

**Revisão final (opus, dispatch único) achou 0 Critical + 7 Important
+ 9 Minor, todos verificados empiricamente (testado de verdade dentro
do container, não só leitura de código) — 5 Important + a mitigação
de memória do 6º corrigidos numa rodada única de fix-wave, 1 Important
parqueado com ruling, todos os 9 Minor parqueados:**

- **Important**: XLSX inválido/corrompido devolvia 500 (com stack
  trace disparando alarme) em vez de 400 — `parseXlsxRows` não tinha
  try/catch nem checava se a planilha existia. Corrigido com try/catch
  + checagem explícita de `worksheets[0]`.
- **Important**: célula de fórmula/rich-text/hyperlink do `exceljs`
  virava o literal `"[object Object]"` em vez do texto real (`String
  (cell).trim()` assumia célula sempre escalar) — risco real de gravar
  esse literal como nome/cargo do funcionário. Corrigido com um
  `cellToText()` novo que trata os 4 formatos de objeto do exceljs
  (`richText`, `{formula,result}`, `{text,hyperlink}`, `{error}`).
- **Important**: detecção de formato só por mimetype, ignorando o nome
  do arquivo — regressão em relação ao endpoint antigo, que aceitava
  qualquer mimetype (browsers/SOs reais mandam mimetype inconsistente
  pra CSV/XLSX). Corrigido com fallback pra extensão do arquivo
  (`file.originalname` agora trafega do controller até o parser).
- **Important** (proteção de memória, mitigação barata em vez da
  solução completa): `MAX_IMPORT_ROWS` só era checado depois do
  workbook XLSX inteiro já materializado em memória. Corrigido com um
  teto de tamanho de arquivo de 3MB pra XLSX, checado antes de tentar
  carregar — decisão deliberada do controlador de não implementar a
  solução completa (streaming reader) sugerida pelo revisor, por ser
  grande demais pra um fix-wave final de rodada única.
- **Important** (plan-mandated): comentário explicativo do porquê do
  SAVEPOINT por linha se perdeu na extração da Task 2 (o próprio texto
  do plano já não tinha o comentário) — restaurado.
- **Important** (plan-mandated): mensagem de erro duplicada na tela
  (`FuncionariosForm.tsx` renderizava o mesmo `importError` em dois
  lugares simultâneos sempre que um erro ocorria na etapa de
  confirmação) — corrigido tornando o primeiro bloco condicional a
  `!preview`.
- **Important parqueado, não corrigido nesta fase**: parsing de CSV
  com célula multi-linha (campo entre aspas com quebra de linha
  embutida) desalinha as linhas seguintes — limitação pré-existente do
  parser de CSV do projeto, mas o raio de alcance cresceu com planilha
  livre em vez do formato rígido antigo. Correção completa exige
  reescrever o parser de CSV compartilhado com o caminho antigo —
  maior do que cabe num fix-wave final de rodada única. Fica como task
  futura dedicada. Sem risco de perda de dado (linha vira erro de
  validação visível, não é importada errada).
- 9 Minor, todos parqueados (triviais ou fora do escopo da spec):
  `JSON.parse` do mapeamento sem validar o shape; índice de coluna
  duplicado permitido silenciosamente; `import-preview` registrado
  pelo `AuditInterceptor` genérico como "create" (ruído de auditoria);
  CPF com zero à esquerda vira número no Excel; regex de acento com
  caracteres Unicode literais em vez de range escapado; tipo
  `string[][]` tecnicamente impreciso pra linha esparsa; `exceljs` traz
  78 deps transitivas (nota de supply-chain); erro 413 em inglês cru
  sem pré-checagem no cliente; sinônimo "n do cpf" praticamente
  inalcançável (herdado da spec).

Fix-wave final e sua re-revisão escopada confirmaram todos os 6 itens
corrigidos ADDRESSED com evidência file:line cotejada contra o código
real (não só o relatório do implementador) — 0 quebra nova introduzida
pelo fix, diff conferido byte-a-byte contra o brief.

**Verificação:** backend com suíte e2e real (Postgres real, sem IA
envolvida nesta fase — mapeamento é 100% determinístico) — 20/20
unitários (`spreadsheet-import.unit-spec.ts`, 11 originais + 9 novos
do fix-wave), 6/6 na suíte nova de endpoints, 16/16 de regressão
completa da suíte `employees` (incluindo o caminho antigo intacto).
Frontend sem suíte automatizada — Playwright contra o bundle real
implantado em produção (deploy confirmado via grep no bundle antes de
cada rodada), com asserções reais de DOM/FormData (valor de `<select>`
= índice da coluna, conteúdo do FormData inspecionado no corpo bruto
da requisição).

**Ainda sem spec, fica pra quando for a vez**: a terceira fatia
conhecida de "Diagnóstico Inicial" — o "Mapa SST" (grafo de entidade
empresa→cargo→funcionário→EPI→treinamento com detecção de
divergência).

## Fase 23 — Mapa SST: cargo, requisitos e divergência (EPI + treinamento): status

Terceira e última fatia conhecida da visão de "Diagnóstico Inicial"
trazida pelo fundador em 2026-09-06 (as duas primeiras foram as Fases
21 e 22). Diferente das duas anteriores, o fundador pediu
explicitamente pra desenhar as 3 sub-partes desta fase numa spec só
(cargo como entidade + requisitos de EPI/treinamento + divergência),
em vez de fatiar o brainstorming — a implementação, porém, foi
decomposta em 5 tasks incrementais na etapa de planejamento.

**Fechada em 2026-09-07, 5 tasks + revisão final (opus) com 1 fix-wave
único de rodada final, mais 3 fix rounds durante as tasks (Tasks 2, 3
e 5):**

- **Task 1** — cargo vira entidade real: `positions` (por tenant,
  `UNIQUE(tenant_id, name)`), mais o schema completo desta fase numa
  migration só (`0035_positions.sql`): `employees.position_id`
  (nullable, `ON DELETE SET NULL`), `position_epi_requirements` e
  `position_training_requirements` (ainda sem lógica de negócio nesta
  task). CRUD básico (criar/listar/renomear), RLS idêntica a
  `tenant_epis_isolation`.
- **Task 2** — vínculo de funcionário existente a cargo: agrupamento
  determinístico por texto normalizado (mesma normalização da Fase
  22), sugestão do nome raw mais frequente do grupo, confirmação em
  lote (`ON CONFLICT ... DO UPDATE`, idempotente). Vínculo manual
  individual via `PATCH /employees/:id` (`position_id` novo campo,
  mesma checagem de posse de tenant que `company_unit_id` já tem).
  **2 bugs reais encontrados pelo implementador rodando o teste de
  verdade** (não transcrição cega do brief): desempate `localeCompare`
  não-determinístico entre ambientes (trocado por comparação de code
  unit); campo `name`/`suggested_name` incompatível entre produtor e
  consumidor (padronizado em `suggested_name`). **Fix round 1/5**:
  revisão achou um gap adicional que nem o próprio debug do
  implementador pegou — o UPDATE em lote de `confirmLinks` não tinha
  filtro de tenant, um risco real pro role admin (bypass de RLS);
  corrigido.
- **Task 3** — requisitos de EPI/treinamento por cargo: 2 endpoints
  PUT que substituem a lista inteira (idempotente), reaproveitando
  `TRAINING_TYPES`/`TrainingType` já existentes (Fase 15), sem
  redefinir o enum. **Fix round 1/5**: faltava `mapPgError` nos 2
  métodos novos de escrita, ao contrário do resto do arquivo; corrigido.
- **Task 4** — divergência: SQL determinístico (EPI "atendido" =
  qualquer entrega registrada, ignora validade do CA; treinamento
  "divergente" = nunca feito OU vencido, numa consulta só),
  `GET /positions/:id` (detalhe com status por funcionário/requisito),
  integração com o dashboard já existente (`AttentionItem` ganha
  `tipo:'cargo'`, soma em `resumo.pendencias`). Revisão verificou de
  forma independente (não só aceitou a autoavaliação do implementador)
  que `getDivergences` filtra por tenant nas duas branches e que a
  policy de RLS cobre SELECT — 0 achado, review limpa de primeira.
- **Task 5** — frontend `/empresa/mapa-sst`: lista de cargos com
  drill-down (sem biblioteca de grafo visual — cards/tabelas, mesmo
  padrão do resto do dashboard), banner de vínculo pendente, criação
  de cargo, configuração de requisitos via checkbox, status de
  divergência por funcionário. **Fix round 1/5**: 3 Important — falha
  silenciosa em 3 mutações de escrita (sem checar `res.ok`); corrida
  de estado no drill-down (`selectedPositionId` setado antes do GET
  resolver); `/empresa/mapa-sst` ausente de todo menu de navegação do
  sidebar (lacuna que nenhum brief de task tinha mandato pra pegar,
  auto-reportada pelo implementador e corrigida como parte deste fix
  round em vez de empurrada pra revisão final).

**Revisão final (opus, dispatch único) achou 0 Critical + 6 Important
— 4 corrigidos numa rodada única de fix-wave, 2 parqueados com
ruling:**

- **Important corrigido**: `PositionsController` sem `ValidationPipe`
  — 4 dos 8 endpoints devolviam 500 cru em body malformado (NULL em
  coluna NOT NULL, `for...of undefined`, string iterada como array,
  nome só-espaço aceito sem trim). Corrigido com o mesmo padrão já
  usado em 21/37 controllers do projeto, incluindo `company_units`
  (citado pela própria migration desta fase como modelo).
- **Important corrigido**: nomes de funcionário/cargo passaram a
  vazar pro prompt do Assistente de IA via
  `dashboard.atencao → normative-assistant.service.ts` — efeito de
  2ª ordem que nenhuma revisão de task isolada conseguia enxergar
  (Task 4 → dashboard → Assistente → LLM externo), cruzando a
  proibição explícita da spec desta fase de qualquer uso de IA.
  Corrigido com um filtro de 1 linha (`tipo !== 'cargo'`).
- **Important corrigido**: faltava o único teste de regressão de
  isolamento de tenant que a fase não tinha — o guard de
  `confirmLinks` (corrigido na Task 2) nunca tinha sido exercitado
  ponta-a-ponta via HTTP por um teste real. Adicionado.
- **Important corrigido**: `PATCH /positions/:id` já existia e era
  testado desde a Task 1, mas nenhum lugar do frontend o chamava —
  cargo nascido de sugestão automática (que pode errar a grafia) não
  tinha como ser corrigido pela tela. Adicionada UI de renomear
  inline.
- **Important parqueado com ruling, fechado em seguida como fast-follow
  bounded (commit `4ddb51c`)**: spec §4.3 não totalmente implementada
  — a tela de revisão de vínculo pendente mostrava só a contagem de
  funcionários do grupo, não a lista nem permitia remover 1 antes de
  confirmar. Motivo do park original: corrigir exigia mudar a
  interface de `getLinkSuggestions` (só devolvia UUIDs opacos) MAIS
  uma UI nova de seleção/remoção — maior do que cabia com segurança
  num fix-wave de rodada única. Fechado logo depois, como tarefa
  bounded separada (sem spec formal): `getLinkSuggestions` passou a
  devolver `employees: {id, full_name}[]` por grupo em vez de
  `employee_ids`/`employee_count`; a tela ganhou um checkbox por
  funcionário (marcado por padrão), e `confirm-links` deriva
  `employee_ids` só dos marcados no momento de confirmar — grupo sem
  nenhum marcado não entra na confirmação. Verificado: 5/5 e2e (teste
  novo confirma que um funcionário desmarcado não é vinculado), 16/16
  regressão de `positions`, 8/8 Playwright real contra produção.
- **Important parqueado, não é bug**: `resumo.pendencias` pode somar
  centenas/milhares (funcionários × requisitos configurados), fazendo
  `status:'critico'` aparecer no primeiro dia que uma empresa
  configura a feature. Decisão deliberada já registrada na própria
  spec (divergência = lacuna real de compliance, mesma prioridade que
  documento/CA vencido) — só se manifesta depois de configuração
  ativa da empresa, não é surpresa em dado silencioso já existente.
  Registrado aqui como característica conhecida pra acompanhamento de
  produto, não como defeito.
- Um Minor trivial (drift de tipo `AttentionItem` no dashboard
  frontend, faltava `'cargo'` no union) foi incluído no fix-wave por
  ser 1 palavra. Todos os demais Minor das 5 tasks foram triados pelo
  próprio revisor final e mantidos parqueados (nome duplicado em 2
  tenants garantido por schema; `Promise.all` em `findOne` seria no-op
  já que compartilha o mesmo `PoolClient` serializado; `getDivergences`
  filtrar por posição em JS é o design certo pra reaproveitar 1 query
  entre 3 consumidores; resto é polimento — falta de índice em
  `employees.position_id`, mensagem de treinamento com 2 textos
  diferentes dashboard/página, `tipo:'outro'` não-verificável, HTML
  cru no e-mail semanal, `position_id:''` vira 500, comparador de sort
  com 2 nulls).

**Fix-wave final teve 1 desvio real encontrado pelo implementador
rodando o teste de verdade**: `ConfirmLinksGroupDto` como especificado
no brief teria quebrado o fluxo feliz real de produção, já que tanto o
frontend quanto o teste e2e pré-existente reenviam o objeto
`LinkSuggestion` inteiro (incluindo `employee_count`) — com
`forbidNonWhitelisted:true` recém-adicionado, o NestJS rejeitaria essa
chamada real com 400. Corrigido adicionando `employee_count` opcional
e validado ao DTO, ignorado pelo service. Re-revisão escopada
confirmou o comportamento do NestJS, a correção mínima, e endossou a
escolha de corrigir o DTO em vez de mudar frontend+teste.

**Verificação:** backend com suíte e2e real (Postgres real, nenhuma IA
envolvida em nenhuma parte desta fase — cargo/requisito/divergência
são 100% determinísticos) — 15/15 na suíte `positions` (4 arquivos),
22/22 `normative-assistant` (incl. teste novo do filtro de PII), 5/5
`dashboard`, regressão completa de `employees`. Frontend sem suíte
automatizada — Playwright contra o bundle real implantado em produção
em todas as 5 tasks e no fix-wave final (deploy confirmado via grep no
bundle antes de cada rodada), incluindo prova de que uma falha de
escrita não é tratada como sucesso e que uma corrida de estado no
drill-down não grava no cargo errado.

**Achado incidental, fora do escopo desta fase**: 1 falha
pré-existente em `normative-assistant-attachment.e2e-spec.ts`
(extração de PDF, feature de anexos da Fase 20), confirmada idêntica
antes e depois do fix-wave via `git stash`/`git stash pop` — não é
regressão desta fase, sinalizada como possível task de acompanhamento
futura.

## Planos — Proposta comercial e reescrita de `/planos`: status

Primeiro sub-projeto de uma frente maior que o fundador identificou em
brainstorming: reposicionar a venda dos 4 planos de empresa de
"quantidade de funcionários" pra "nível de suporte/acompanhamento
humano" — o fundador enviou um rascunho extenso e já bem desenvolvido
nessa direção. O segundo sub-projeto (sistema real de enforcement:
limite de funcionário que bloqueia, cota de atendimento técnico
rastreada, limite de uso de IA por plano, comissão do técnico por
visita) foi deliberadamente separado como projeto arquitetural futuro,
ainda sem spec — decisão confirmada com o fundador logo no início do
brainstorming, pra não misturar cópia comercial com arquitetura de
banco/permissões nova.

**Fechada em 2026-09-08, 1 task + revisão final (opus) com 4 Important
+ 3 Minor, todos corrigidos numa rodada única de fix-wave:**

- Reescrita completa de `frontend/src/app/(site)/planos/page.tsx`
  (seção intro nova, 4 cards com posicionamento/subtítulo/bullets
  próprios, bloco comum "Assistente Montese SST" em 3 passos + 1
  opcional, tabela comparativa completa, frase de trial reformulada) +
  módulo de dados novo `plan-content.ts` (conteúdo estático por
  `slug`, já que não existe coluna pra isso em `plans` e criar uma
  ficou fora de escopo). Nenhuma mudança de preço, `employee_limit`,
  schema, fluxo de assinatura (`handleSubscribe`/`POST /subscriptions`)
  ou `/tecnico/planos` — confirmado por diff/md5 byte-idêntico ao
  código anterior.
- **2 imprecisões corrigidas já durante o brainstorming, antes de
  qualquer código** (achadas pelo próprio processo de perguntas, não
  pela revisão): o "monitoramento inteligente" (alertas de
  pendência/vencimento) já é universal a todo plano hoje — o rascunho
  original do fundador colocava isso como exclusivo do Super Premium;
  corrigido pra: alerta universal na tabela, o que o Super Premium
  acrescenta é o técnico humano acompanhando ativamente. Preço do
  Enterprise segue "sob consulta" — o R$2.997/mês do rascunho era só
  ilustrativo, não uma mudança de preço real (confirmado com o
  fundador).
- **Revisão final (opus) achou 0 Critical + 4 Important + 3 Minor**,
  todos verificados de forma independente (diff/md5/`git show
  --stat`, não só leitura de código):
  - **Important**: `MountainDivider.tsx` nunca tinha sido commitado no
    git (usado por 5 páginas do site, não só `/planos`) — um clone
    limpo quebraria o build inteiro, mesmo produção funcionando (usa o
    working tree local). Corrigido, adicionado ao commit.
  - **Important**: CTA "Começar gratuitamente" do Start, pra visitante
    deslogado, apontava pra `/login` em vez de `/cadastro` como a spec
    mandava — bug que entrou no texto do próprio plano, não desvio do
    implementador. Corrigido com um campo `ctaHref` opcional, só no
    Start.
  - **Important** (decisão do fundador): o bullet do Start mencionava
    atendimento avulso presencial, mas o card do Premium ("tudo do
    Start, mais") herda isso enquanto a tabela marcava "Visitas
    presenciais" como não incluída no Premium — contradição real.
    Fundador decidiu: Start passa a oferecer só atendimento avulso
    ONLINE, sem presencial — resolve a contradição nos dois lugares
    (bullet + célula da tabela).
  - **Important** (decisão do fundador): a linha "Integrações /
    customização" da tabela prometia algo (só Enterprise) sem nenhum
    bullet correspondente no card. Fundador decidiu manter a promessa
    comercial ("sob consulta") — corrigido adicionando o bullet
    faltante.
  - 3 Minor corrigidos por serem baratos: título de seção ("Tudo do X,
    mais:") e frase de efeito ganhavam checkmark de recurso real igual
    aos bullets de verdade (corrigido com um tipo `PlanBullet`
    distinguindo nota de recurso); 2 ternários mortos (`isEnterprise
    ? 'text-white' : 'text-brand-900'` dentro de uma branch que só
    roda quando `!isEnterprise`); lista da intro tinha só 4 dos 5
    itens que a própria spec pedia (faltava "Histórico e
    rastreabilidade").
  - Demais Minor (acessibilidade da tabela — `scope`/`aria-hidden`
    faltando; tabela de cabeçalho estático vs. cards dinâmicos da API;
    tipagem do lookup sem `| undefined`; `employee_limit` renderizando
    `0` cru; menção a "videochamada"/"histórico de solicitações" no
    Premium sem correspondência exata no produto; manter "Até N
    funcionários" visível apesar do redesenho de-enfatizar isso)
    ficaram parqueados, fora do fix-wave.

Fix-wave final e sua re-revisão escopada confirmados por reprodução
independente (revisor conferiu cada bullet palavra por palavra contra
a versão anterior, `git show --stat` direto no commit real pra
confirmar que `MountainDivider.tsx` genuinamente entrou) — 0 achados
novos, sem regressão.

**Verificação:** frontend sem suíte automatizada — Playwright contra o
bundle real implantado em produção na task e no fix-wave final (deploy
confirmado via grep no bundle antes de cada rodada): 20/20 cenários
originais + 18/18 do fix-wave, incluindo asserção de `href` (não só
texto do botão) e confirmação de que o CTA do Premium com sessão
logada ainda dispara `POST /api/subscriptions` com o `plan_id` certo
(fluxo de assinatura intocado).

**Fora de escopo, fica pra quando for a vez**: o sistema real de
enforcement (limite de funcionário que bloqueia, cota de atendimento
técnico rastreada, limite de uso de IA por plano, comissão do técnico
por visita presencial) — segundo sub-projeto desta frente, ainda sem
spec, precisa de brainstorming próprio (decisões de banco de dados,
permissões, economia).

## Limite de funcionário por plano (enforcement real): status

Primeiro dos 4 sub-projetos da frente de enforcement que a proposta
comercial de `/planos` deixou de fora (limite de funcionário, cota de
atendimento técnico, limite de uso de IA, comissão do técnico por
visita) — os outros 3 continuam sem spec, cada um vai precisar do seu
próprio brainstorming.

**Fechada em 2026-09-09, 2 tasks + revisão final (opus) com 2
Important + 8 Minor, os 2 Important corrigidos numa rodada única de
fix-wave:**

- `plans.employee_limit` existia desde a Fase de Planos+Assinaturas
  (2026-08-18/19), mas era só informativo — nenhum código lia essa
  coluna pra decidir se um cadastro devia ser aceito. Esta fase faz
  valer de verdade, em 3 pontos: criação única (`POST /employees`),
  reativação de funcionário inativo (`PATCH /employees/:id` mudando
  `status` pra `'ativo'`), e importação em lote (`processImportRows`,
  compartilhado por `import`/`import-mapped`).
- **Decisões de produto fechadas em brainstorming**: trial (sem
  assinatura `authorized`) continua sem limite nenhum; só
  funcionário `status='ativo'` conta; reativar conta igual criar,
  mas só quando é uma mudança real de status; `admin` tem bypass
  total; múltiplas assinaturas `authorized` simultâneas (gap já
  conhecido, não corrigido) usam o MAIOR `employee_limit` entre elas
  — qualquer uma sem limite (Enterprise, `NULL`) faz o resultado ser
  sem limite; importação em lote nunca aborta o lote inteiro (erro
  por linha, mesmo padrão já usado pra CPF/filial inválidos).
- **Task 1** — `SubscriptionsService.getActiveEmployeeLimit` (novo,
  no módulo `payments`, já existente), `EmployeesModule` passa a
  importar `PaymentsModule`, `EmployeesService` ganha o helper
  `assertEmployeeLimitNotExceeded` aplicado em criação única e
  reativação. Revisão de task confirmou a mensagem de 403 caractere
  por caractere e a lógica MAX/NULL-vence linha a linha contra o
  schema real — 0 achado.
- **Task 2** — mesmo enforcement na importação em lote, via
  contagem rodante (`currentActiveCount + importados >= limit`)
  calculada uma vez antes do loop, mesmo padrão já usado pra
  `unitsByName`. Revisão de task confirmou que o código de criação/
  reativação da Task 1 ficou intocado e que nenhum outro caller de
  `importCsv`/`importMapped` existia fora do controller — 0 achado.
- **Revisão final (opus) achou 0 Critical + 2 Important + 8 Minor**,
  ambos os Important corrigidos:
  - **Important**: a mensagem de 403 nunca chegava ao usuário na
    ÚNICA tela de criação de funcionário do produto
    (`FuncionariosForm.tsx`'s `handleSubmit` descartava o corpo da
    resposta de erro, mostrava texto fixo genérico) — a premissa da
    spec ("frontend já mostra a mensagem de erro") era verdadeira só
    pra importação, não pra criação única. Corrigido espelhando o
    padrão já usado pelos outros 2 handlers do mesmo arquivo.
  - **Important**: o cenário de teste "Enterprise + assinatura
    numérica simultânea", explicitamente listado na spec, sumiu
    silenciosamente na tradução spec→plano — falha do controlador
    desta fase, não dos implementadores nem das revisões de task
    (cada uma só via o próprio brief). Corrigido, teste adicionado.
  - Incluído no mesmo fix-wave, por ser barato: um teste novo
    exercitando o limite especificamente via `POST
    /employees/import-mapped` (o endpoint que o frontend de verdade
    chama — o único teste de lote anterior usava o endpoint legado
    `POST /employees/import`, que nenhuma tela usa).
  - 8 Minor parqueados: mensagem do lote sem número/CTA; tipo
    `callerRole: string` em vez do union já existente; query de
    contagem duplicada em 2 lugares; `update()` com até 3 SELECTs
    redundantes no mesmo payload; teste de lote não provando
    continuação heterogênea após uma rejeição; e uma condição de
    corrida check-then-insert (herdada da Task 1, mantida parqueada
    — overshoot limitado e autocorretivo no próximo request, dado o
    tamanho declarado do produto).
  - **Decisão registrada, não é bug**: uma assinatura
    `cancelled`/`paused` faz o tenant voltar a ficar sem limite
    (mesmo comportamento fail-open do trial) — coerente com o
    produto hoje, que não tem nenhum gating pra quem cancela.
    Relevante pro próximo sub-projeto de enforcement não tropeçar
    nisso.

Fix-wave final e sua re-revisão escopada confirmados por reprodução
independente (revisor leu o controller real pra confirmar que o teste
novo de `import-mapped` usa exatamente o formato de payload esperado,
e confirmou via `git diff --stat` que o fix não tocou nenhum
serviço/controller de backend) — 0 achados novos, sem regressão.

**Verificação:** backend com suíte e2e real (Postgres real, fixture
de "assinatura ativa" inserida direto via superuser do `TestDb`, sem
chamar a API real do Mercado Pago) — 9/9 na suíte nova
(`employees-limit`), regressão completa de `employees` (25/25, 5
suítes) e `payments`/`plans`/`subscriptions` (26/26, 9 suítes).
Frontend sem suíte automatizada — Playwright contra o bundle real
implantado em produção, confirmando que a mensagem de erro real
(com o número do limite e o convite a fazer upgrade) chega até a
tela, não um texto genérico.

## Prevenção e Emergência — Equipamentos contra incêndio (sub-projeto A): status

Primeiro dos 7 sub-projetos do "Centro de Gestão de Prevenção e
Emergências" que o fundador propôs (extintores/equipamentos; brigada
de incêndio; checklists de prevenção + simulados de emergência; Plano
de Ação de Emergência; documentos PPCI/PSPCI/APPCI; dashboard "índice
de prevenção"; agente especialista em incêndio) — os outros 6
continuam sem spec, cada um vai precisar do seu próprio brainstorming
quando for a vez. A arquitetura multi-estado (legislação de Corpo de
Bombeiros por UF) foi deliberadamente tratada como uma frente à parte,
de conteúdo/curadoria normativa, fora da sequência de 7 sub-projetos.

**Fechada em 2026-09-09, 3 tasks + revisão final (opus) com 4
Important + 5 Minor, os 4 Important corrigidos numa rodada única de
fix-wave:**

- Tabela nova `fire_safety_equipment` — uma tabela só pros ~11 tipos
  de equipamento contra incêndio (extintor, hidrante, mangueira,
  alarme, detector, iluminação de emergência, saída de emergência,
  porta corta-fogo, sprinkler, central de alarme, outro), ao
  contrário da recomendação inicial de começar só por extintor —
  decisão explícita do fundador em brainstorming. Sem catálogo de
  referência fixo (diferente do EPI). Localização por filial
  (`company_unit_id`) + texto livre, sem hierarquia de andar/setor
  nem planta/posicionamento visual. Status (`regular`/`vencendo`/
  `vencido`) sempre calculado a partir de `proxima_manutencao`
  (janela de 30 dias), nunca persistido.
- **Task 1** — migration + módulo backend completo
  (`backend/src/fire-safety-equipment/`), CRUD com os mesmos papéis
  do EPI (`empresa`/`tecnico`/`parceiro`, resolução de `tenant_id`
  idêntica), upload de foto reaproveitando `R2Service` já existente.
  Revisão de task confirmou o código byte a byte contra o brief e
  verificou o único desvio (fixture de teste do técnico precisando
  de vínculo em `technicians`/`tenant_technicians`, mesmo padrão já
  usado em `epis-crud.e2e-spec.ts`) — 0 achado bloqueante.
- **Task 2** — integração no dashboard já existente
  (`DashboardService.getSummary`), mesmo formato de
  `getEpiStatus`/`epis.pendencias`/`epis.avisos`: vencido entra em
  `atencao` como `prioridade: 'alta'` (conta em
  `resumo.pendencias`), vencendo como `media`. TDD confirmado
  (RED 8/9 → GREEN 9/9), regressão completa do dashboard sem
  alteração — 0 achado.
- **Task 3** — frontend `/empresa/equipamentos-incendio`, mesmo
  padrão de arquivo único já usado em EPI/Mapa SST. Verificado via
  deploy real + grep dentro do container + Playwright (29
  checagens) contra produção, executado duas vezes (antes/depois de
  um redeploy `--no-cache`) — 0 achado bloqueante.
- **Revisão final (opus) achou 0 Critical + 4 Important + 5 Minor**,
  os 4 Important corrigidos:
  - **Important**: `update()` não protegia a invariante "campos de
    extintor só persistem quando `tipo = 'extintor'`" — só `create()`
    zerava esses campos; um PATCH podia setar `agente_extintor` numa
    linha não-extintor, ou trocar o `tipo` de um extintor sem limpar
    os campos antigos. Corrigido: `update()` agora resolve o tipo
    efetivo (do PATCH ou da linha atual) e força os 3 campos pra
    `null` quando não é extintor.
  - **Important**: nenhum teste de RLS negativo/cross-tenant pra
    tabela nova, contra a convenção já usada em quase toda tabela
    deste produto (`documents-rls`, `epi-catalog-rls`,
    `positions-link`, etc.). Corrigido: novo
    `fire-safety-equipment-rls.e2e-spec.ts` com 5 casos, o mais
    importante provando que um técnico SEM vínculo em
    `technicians`/`tenant_technicians` é rejeitado (403, via
    `WITH CHECK` da RLS) ao tentar mandar `tenant_id` de outro
    tenant no corpo do POST.
  - **Important**: upload de foto (`POST :id/foto`) sem nenhum
    caminho de leitura — metade de uma feature, gravando no R2 sem
    ninguém conseguir consumir. Corrigido: novo `GET :id/foto`
    reaproveitando `R2Service.getPresignedDownloadUrl`, mesmo padrão
    de `documents.controller.ts`'s `GET :id/download`.
  - **Important**: painel do frontend não aceitava `tenantId`, ao
    contrário de `EpisPanel`/`DocumentsPanel` — mesmo a spec
    fechando que técnico/parceiro pode cadastrar equipamento durante
    uma visita, o componente não tinha caminho pra isso. Corrigido:
    prop `tenantId?` opcional, mesmo padrão exato dos dois
    componentes-irmãos (inclusive o contorno já usado em
    `DocumentsPanel` pra `GET /company-units` não aceitar
    `tenant_id`). Nenhuma página nova de técnico foi criada — só o
    componente ficou pronto pra ser montado numa, no futuro.
  - 5 Minor parqueados: `getFireSafetyEquipmentStatus` do dashboard
    usa `findAll` (sem filtro/projeção) em vez de uma query própria
    mais magra — parqueado por escala declarada do produto; union
    de `AttentionItem['tipo']` do dashboard do frontend sem o novo
    valor (drift de tipo, sem quebra em runtime); painel novo bem
    menos robusto que `EpisPanel` (sem loading/error state,
    confirmação de exclusão); itens de equipamento entram sem limite
    no digest semanal e no contexto do assistente (mesmo
    comportamento já existente do EPI, paridade não regressão);
    `codigo` obrigatório só a nível de DTO, não `NOT NULL` no schema
    (decisão da própria spec aprovada, não do implementador).
  - **Achado na spec, corrigido diretamente**: a Seção 4.3 da spec
    citava uma "checagem explícita de posse de tenant" em EPI/
    funcionário que não existe — os dois `remove()` dependem só de
    RLS, igual ao módulo novo. Spec corrigida (commit `a2ac567`) pra
    não propagar a premissa falsa pros outros 6 sub-projetos.

Fix-wave e sua re-revisão escopada confirmados por reprodução
independente (revisor rastreou a mecânica real de RLS —
`TenantContextInterceptor`, `assigned_tenant_ids_for_current_user()`
— em vez de confiar no relato) — 0 achados novos, sem regressão.

**Verificação:** backend com suíte e2e real (Postgres real via
`TestDb`) — 17/17 (`fire-safety-equipment` + `fire-safety-equipment-rls`),
regressão completa do dashboard sem alteração. Frontend sem suíte
automatizada — deploy real confirmado via grep dentro do container
antes de qualquer Playwright, 29 checagens originais da Task 3 + 12
focadas na re-verificação do fix-wave, todas contra
`https://montesesst.com.br` em produção.
