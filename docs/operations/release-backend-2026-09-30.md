# Plano de release do backend — 2026-09-30

> **Status: PLANO. Nada deste documento foi executado em produção.** Cada etapa
> marcada com 🔒 só roda com autorização explícita do proprietário (AGENTS.md,
> seção Infraestrutura). Comandos banidos neste projeto: ver
> `feedback_docker_compose_override_safety` (nunca `docker compose config`,
> `down -v`, `docker volume rm/prune`, dump de env).

## 1. Por que isto é um release, e não "deploy do dashboard"

VERIFICADO em 2026-09-30:

- A imagem `montese-backend` em produção foi construída em **2026-09-21**.
  O repositório tem **65 commits** depois disso, mais mudanças não commitadas.
  O `/health` de produção não tem o campo `commit` (a imagem é anterior ao ITEM 009).
- **5 migrations não aplicadas** no banco real: `0056`, `0057`, `0060`, `0061`, `0062`.
- Publicar o que o dashboard novo precisa (`GET /dashboard/overview`,
  `summary.auditoria`) exige reconstruir o backend inteiro, e isso leva junto
  tudo o que está na árvore.

O frontend novo **já está no ar** e degrada bem sem o backend novo (KPIs "—",
Auditoria "dado indisponível").

## 2. O que entra no release

| Frente | Migrations | Risco de produção | Observação |
|---|---|---|---|
| Dashboard (overview + auditoria) | nenhuma | baixo | aditivo; 17/17 e2e no clone |
| Assistente normativo (Fase 10, evals, retry, recusa) | `0051`–`0054` já aplicadas | médio | 65 commits desde 09-21; specs `normative-*` defasados (ITEM 041) |
| Isolamento do `tenants` (ITEM 009) | `0056` → **código novo** → `0057` | **alto** | `0057` liga FORCE RLS em `tenants`; com o código antigo a rota pública do logo dá 404 |
| Cobrança: troca de plano cancela o preapproval anterior (ITEM 011) | `0060` | **alto** | mexe em Mercado Pago real; "a mais nova vence" |
| Reconciliação de assinaturas (cron a cada 6 h) | — | **alto** | passa a consultar o Mercado Pago sozinho (`subscription-reconciliation.cron.ts`) |
| Monitor de crédito OpenRouter / custo MiniMax (ITEM 013/014) | `0061`, `0062` | médio | novos crons externos; `0061` cria tabela, `0062` coluna nullable |
| `company-units`, `health`, `pente-fino`, `epi-by-function` | — | médio | mudanças não commitadas; revisar diff |
| Infra: `Dockerfile` (ARG `GIT_COMMIT`), `docker-compose.yml` (build arg) | — | baixo | só embute o commit; nunca falha o build |

## 3. Pré-requisitos (decisão do proprietário, antes de qualquer etapa 🔒)

1. **Commits por frente.** Hoje há mudança de várias frentes misturadas na árvore.
   Sem commit não há rastreabilidade do que foi ao ar (princípio RASTREABILIDADE).
   Sugestão de agrupamento (nenhum commit foi feito):
   - `feat(dashboard)`: `backend/src/dashboard/*`, `backend/test/dashboard-*`
   - `feat(pagamentos)`: `backend/src/payments/*`, `backend/test/subscription-*`
   - `fix(assistente)`: `backend/src/normative/*`, specs `claim-support`, `question-notices`, `epi-by-function`, `normative-*`
   - `fix(company-units)`: `company-units.*` e seu e2e
   - `chore(infra)`: `backend/Dockerfile`, `docker-compose.yml`, `ops/build-with-commit.sh`, `health.controller.ts`
   - `feat(frontend/dashboard-v2)`: `frontend/**` do dashboard, `docs/dashboard-v2`, `docs/specs/*dashboard*`, planos
   - `docs`: demais specs e planos
2. **Confirmar o `.env`:** as variáveis do compose ausentes do `.env` hoje são
   opcionais (têm `:-default`) ou já estavam em branco antes (`GROQ_API_KEY`,
   `GOOGLE_CLIENT_ID/SECRET`, `OPENROUTER_*` modelos). O release não pode
   introduzir uma dependência nova de segredo: conferir **só os nomes** em
   `git diff HEAD -- docker-compose.yml` antes de subir.
3. **Janela de baixa atividade** e alguém para acompanhar (o backend reinicia;
   queda de alguns segundos).

## 4. Sequência

Cada passo tem critério de sucesso e de parada. Se qualquer critério falhar,
**parar** e reportar; não improvisar correção em produção.

### Etapa 0 — Ensaio no clone (sem tocar em produção) — ✅ EXECUTADA em 2026-09-30

1. Restaurar o dump mais recente (`/opt/montese-backups/postgres/`) em um banco
   novo `montese_rehearsal` (receita em `reference_running_tests_in_throwaway_container`).
2. Aplicar **todas** as migrations pendentes no clone, na ordem `0056 → 0060 → 0061 → 0062 → 0057`.
3. Rodar no clone, com container descartável e Redis descartável: e2e de
   `dashboard-*`, `tenants*` (incluindo logo), `company-units`, `auth`,
   `pente-fino-*`, `subscriptions` **com Mercado Pago mockado**.
4. Sucesso: suítes verdes, exceto falhas já conhecidas e documentadas (ITEM 041).
   Falha nova → não segue.

**Resultado da Etapa 0 (VERIFICADO):**

- Banco `montese_rehearsal_0930` criado a partir do dump `montese-20260930-030002.dump`,
  idêntico ao real (31 tenants, 113 usuários, 32 documentos, 25 funcionários, 57 migrations).
  Redis descartável (`rehearsal_redis`, removido ao final); o banco e o Redis reais não foram usados.
- **As 5 migrations (0056, 0057, 0060, 0061, 0062) aplicam sem erro** no clone (runner padrão, em transação).
- Suítes rodadas: `tenants*`, `tenant-*`, `rls-isolation`, `company-units*`, `auth`, `register*`,
  `dashboard-*`, `overview`, `admin-dashboard-*`, `payment-events-rls`, `subscription*` (menos
  `subscriptions.e2e`, que chama o Mercado Pago), `mercadopago-webhook`, `webhook-authorized-payment`,
  `weekly-digest`, `assistant-query-log`, `pente-fino-*`, `ai-usage`, `system-status`, `documents-rls`.
  **223 de 227 testes passam (40 de 42 suítes).** Inclui `tenant-isolation-sweep` (toda tabela com
  tenant_id tem RLS ativa e forçada), `tenants-rls`, `subscription-supersede`, `subscription-reconciliation`.
- **As 4 falhas, todas explicadas e nenhuma regressão do release:**
  1. `tenants-logo` (3 testes): o container de teste não tem credenciais do R2 (`No value provided for
     input HTTP label: Bucket`). Falha esperada, documentada. Como o teste não prova a rota pública do
     logo com a `0057` ligada, provei direto no clone (SQL, em transação revertida): sem contexto,
     `SELECT FROM tenants` devolve 0 linhas, `tenant_logo_file_key(id)` devolve a chave, id inexistente
     devolve nulo, contexto da própria empresa enxerga 1 e contexto de outra enxerga 0.
     **Ainda falta:** upload/redirect reais do logo, que só dá para provar com o R2 (etapa de verificação
     em produção, item 5 da Etapa 3).
  2. `pente-fino-lip-insalubridade` (1 teste): o spec espera o objeto sem `source_excerpt`, mas o código
     já commitado em `lip-agent-extractor.service.ts` devolve esse campo. Spec desatualizado que já
     falhava antes; o arquivo não é alterado pelas mudanças pendentes. **Corrigir o spec** (não bloqueia o release).
- O erro `assistant_query_log_outcome_check` no log é de um teste deliberado (`outcome: 'invalido'`),
  que confirma que a falha de log não derruba a rota. Não é problema.
- Banco real conferido depois: 57 migrations, última `0059`, nenhuma empresa de teste sobrando.
- O banco `montese_rehearsal_0930` contém cópia de dados reais: **apagar (`DROP DATABASE`, nunca `down -v`)
  assim que o release terminar.** Existe também `montese_e2e_rehearsal`, de sessões anteriores: não é desta
  etapa, não foi tocado.

### Etapa 1 — Backup 🔒

1. `bash /opt/Montese/ops/backup-postgres.sh` (gera o dump local e a cópia no R2).
2. Conferir: arquivo novo em `/opt/montese-backups/postgres/`, tamanho coerente
   com o anterior, linha `[ok]` e ausência de `[ERRO] cópia externa` no log.
3. Sem backup conferido, não segue.

### Etapa 2 — Migrations aditivas, compatíveis com o código antigo 🔒

Ordem: `0056`, `0060`, `0061`, `0062` (todas só criam função, tabela ou coluna
nullable; o código antigo ignora). **Não** aplicar `0057` ainda.

Como: copiar só esses `.sql` para o container do backend e rodar o runner
(`docker cp` + `docker exec montese_backend npm run db:migrate`). O runner
aplica qualquer arquivo fora de `_migrations`, então **copiar somente os quatro**
(não a pasta inteira). Conferir `_migrations` depois. Cada migration roda em
transação com rollback.

### Etapa 3 — Build e deploy do backend 🔒

1. Guardar a imagem atual para rollback: `docker tag montese-backend:latest montese-backend:pre-20260930`.
2. Confirmar que **não existe** `docker-compose.override.yml` (incidente 1).
3. Build com commit embutido: `bash ops/build-with-commit.sh` (só builda).
4. Subir só o backend: `docker compose up -d --no-deps backend`.
5. Verificar (sem ler variáveis de ambiente): `GET /health` com `commit` igual a
   `git rev-parse HEAD`; logs do container sem stack trace de boot; login de um
   usuário de teste; `GET /tenants/<id>/logo` público responde como antes;
   `GET /dashboard/summary` e `/dashboard/overview` com sessão de empresa
   respondem 200 (o painel `/dashboard-v2` passa a mostrar as contagens).
6. Crons novos: conferir no log, na primeira hora, a reconciliação de
   assinaturas (a cada 6 h) e o monitor de crédito do OpenRouter, e que nenhum
   cancelou assinatura indevidamente.

### Etapa 4 — `0057` (RLS em `tenants`) 🔒 — só depois da Etapa 3 verificada

1. Aplicar `0057`.
2. Verificar de imediato: logo público, login de empresa, `GET/PATCH /tenants/me`,
   listagem do admin, portfólio do técnico, cadastro novo, webhook de pagamento (logs).
3. **Rollback de 1 comando** se algo quebrar:
   ```sql
   DROP POLICY tenants_isolation ON tenants;
   ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE tenants DISABLE ROW LEVEL SECURITY;
   DELETE FROM _migrations WHERE name = '0057_tenants_rls.sql';
   ```

## 5. Rollback geral

| Situação | Ação |
|---|---|
| Backend novo não sobe / quebra | `docker tag montese-backend:pre-20260930 montese-backend:latest` e `docker compose up -d --no-deps backend`. As migrations 0056/0060/0061/0062 são aditivas e ficam. |
| `0057` quebra algo | SQL acima. |
| Dado corrompido | **Parar.** Restaurar dump só com autorização explícita e depois de confirmar o backup do dia (`pg_restore --clean` sobrescreve produção). |

## 6. Depois do release

- `/dashboard-v2` com KPIs reais; conferir com uma empresa real.
- Só então decidir a troca do `/empresa/dashboard` (Task 6 da Fase 3).
- Atualizar `docs/operations/` e a memória do projeto com o commit em produção.

## 7. O que este plano não cobre

- Rotação de segredos, TLS, DNS, Nginx (nenhum muda neste release).
- Falhas já conhecidas dos specs `normative-*` (ITEM 041): tratadas à parte.
- Execução: nada aqui foi rodado. O ensaio (Etapa 0) é o primeiro passo seguro
  e pode começar sem nenhuma autorização de produção.

## 8. Commits por frente (preparados, NÃO executados)

Script revisável: [`commits-2026-09-30.sh`](commits-2026-09-30.sh) — 11 commits (dashboard, pagamentos,
assistente, company-units, pente-fino, custo-ia, infra, normative seed, frontend/dashboard v2,
frontend assistente/planos, docs). `--dry-run` monta e desfaz o índice; **sem push**. Validado em
simulação: todos os 11 grupos montam e o índice volta limpo.

Antes de rodar de verdade:

- **A árvore está sendo editada em paralelo** (apareceram, durante esta sessão, `0061`/`0062`, o cron de
  crédito do OpenRouter, `ai-usage`, `PenteFinoPanel` e um teste novo). Coordenar para ninguém editar
  durante os commits e rodar `git status` logo antes.
- `frontend/src/components/__tests__/PenteFinoPanel.test.tsx` **falha hoje** (frente em andamento de outra
  pessoa/agente); decidir se entra no commit ou fica de fora até passar.
- `0061` e `0062` **não estão commitadas** hoje (o plano assumia que sim): entram no commit `custo-ia`.
  O release só vale com elas commitadas, porque a imagem é construída do repositório.
- Varredura de segredos nos 148 arquivos pendentes: nenhum segredo real. Um falso positivo (senha de
  exemplo num trecho de teste de um plano de eSocial). `.env.example` só acrescenta nomes comentados.
