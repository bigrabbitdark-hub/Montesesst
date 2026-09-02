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
