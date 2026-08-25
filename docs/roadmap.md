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

## Fase 6 — Fluxo de visita presencial + Dashboard Parceiro (não iniciada)

## Fase 7 — Dashboard Admin (não iniciada)

## Fase 8 — Copiloto de IA (não iniciada)

Relato em campo → relatório estruturado. API externa de IA (nunca local, já
confirmado como regra não-negociável).

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
