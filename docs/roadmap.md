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
| Cadastro | ✅ código, ⚠️ **não testado de ponta a ponta com e-mail real** | `frontend/src/app/(site)/cadastro/`, `POST /auth/register` + `GET /auth/confirm` (backend). Cria tenant/user pendentes, mas o link de confirmação só chega de verdade quando `RESEND_API_KEY` for configurada — ver pendência abaixo. |
| Login | ✅ | `frontend/src/app/login/page.tsx` — restyle Tailwind, mesmo comportamento da Fase 1 |
| Tailwind CSS + tema de marca | ✅ | Tailwind **v4** (não v3, que o plano original previa — adaptado durante a implementação) |

**Pendência bloqueante pra fechar 100%:** `RESEND_API_KEY` (Resend) e
`EMAIL_FROM`/`CONTACT_EMAIL_TO`/domínio verificado ainda não existem —
confirmado ao vivo que cadastro e contato falham *honestamente* (500 com
log real) em vez de fingir sucesso, mas ninguém recebeu um e-mail de
verdade ainda. Assim que a credencial existir: configurar no `.env`,
reiniciar o backend, e rodar um cadastro real de ponta a ponta recebendo o
e-mail de confirmação — só aí a Fase 2 fecha 100%.

**Bugs reais pegos durante a implementação** (não em revisão de código —
só apareceram testando contra Postgres/Redis/Resend reais), detalhados nos
commits desta fase: RLS bloqueando as novas funções `SECURITY DEFINER`
(faltava `GRANT` de tabela, `BYPASSRLS` não é suficiente), rate limit de
`/auth/register` dividindo contador com o limite global genérico, e o SDK
do Resend não lançando em erro de API (retorna `{error}` na resposta,
promise resolvida) — um envio que falhasse passaria como sucesso
silencioso sem essa checagem.

## Fase 3 — Onboarding (não iniciada)

Wizard de configuração inicial da empresa após primeiro login. Depende da
Fase 2.

## Fase 4 — Dashboard Empresa (não iniciada)

Score de SST, pendências, documentos, agenda. **Primeiro ponto de contato
real com upload de documentos** — é aqui que a regra de object storage
(R2) precisa ser implementada e confirmada com você antes de codificar.

## Fase 5 — Dashboard Técnico (não iniciada)

Carteira de clientes, agenda, relatórios de inspeção. Modelos de relatório
de referência (EPI e visita técnica) já recebidos e preservados em
`docs/reference/modelos-relatorios-sst.md` — usar como base do schema
quando esta fase começar.

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
5. ~~Fase 2 (site institucional)~~ — ✅ código completo em 2026-08-18 (ver
   seção "Fase 2 — Site institucional: status" acima), ⚠️ pendência
   bloqueante: `RESEND_API_KEY` ainda não existe, então o fluxo de cadastro
   nunca foi confirmado com um e-mail real chegando de ponta a ponta.
6. Assim que a credencial da Resend existir: configurar
   `RESEND_API_KEY`/`EMAIL_FROM`/`CONTACT_EMAIL_TO` no `.env`, reiniciar o
   backend, rodar um cadastro real e confirmar o e-mail de verdade — aí sim
   a Fase 2 fecha 100% e o próximo passo natural é a Fase 3 (Onboarding).
