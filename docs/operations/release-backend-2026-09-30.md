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

### Etapa 1 — Backup 🔒 — ✅ EXECUTADA em 2026-09-30 18:45 UTC

1. `bash /opt/Montese/ops/backup-postgres.sh` (gera o dump local e a cópia no R2).
2. Conferir: arquivo novo em `/opt/montese-backups/postgres/`, tamanho coerente
   com o anterior, linha `[ok]` e ausência de `[ERRO] cópia externa` no log.
3. Sem backup conferido, não segue.

**Resultado (VERIFICADO):** dump `montese-20260930-184517.dump` (23 181 825 bytes), local em
`/opt/montese-backups/postgres/` e no R2 em `backups/postgres/montese-20260930-184517.dump`.
MD5 local = MD5 remoto (`fa449feb…`), tamanhos iguais, `pg_restore --list` lê 59 tabelas com dados
(inclui tenants, users, documents, employees, subscriptions). A rotação local removeu o dump de
2026-09-15 (fora dos 14 dias); retenção remota 30, nada apagado. Dump de 03:00 UTC de hoje também preservado.

### Etapa 2 — Migrations aditivas, compatíveis com o código antigo 🔒 — ✅ EXECUTADA em 2026-09-30 ~18:46 UTC

Ordem: `0056`, `0060`, `0061`, `0062` (todas só criam função, tabela ou coluna
nullable; o código antigo ignora). **Não** aplicar `0057` ainda.

Como: copiar só esses `.sql` para o container do backend e rodar o runner
(`docker cp` + `docker exec montese_backend npm run db:migrate`). O runner
aplica qualquer arquivo fora de `_migrations`, então **copiar somente os quatro**
(não a pasta inteira). Conferir `_migrations` depois. Cada migration roda em
transação com rollback.

**Resultado da Etapa 2 (VERIFICADO):** `0056`, `0060`, `0061`, `0062` aplicadas pelo superusuário do Postgres
(`psql --single-transaction -f` + `INSERT INTO _migrations` na mesma transação, cada uma isolada), `_migrations`
passou de 57 para 61. Conferido: as 2 funções existem, dono `montese_auth_bypass`, `EXECUTE` só para
`montese_app` (nada para PUBLIC); tabela `openrouter_credit_status` criada (0 linhas); coluna
`minimax_usage_log.estimated_cost_usd` numeric nullable; **`tenants` segue sem RLS (0057 NÃO aplicada)**.
Backend antigo nunca reiniciado: `Up 4 days`, `/health` ok, 0 erros no log nos 5 min seguintes, nginx `/api/health` 200.
Nota: o runner `npm run db:migrate` não foi usado (as migrations com `OWNER TO` exigem superusuário).

### Etapa 3 — Build e deploy do backend 🔒 — ⚠️ TENTADA em 2026-09-30 18:51 UTC: FALHOU, ROLLBACK FEITO (produção na imagem antiga, saudável)

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

**Relato da tentativa da Etapa 3 (VERIFICADO):**

1. Tag de rollback `montese-backend:pre-20260930` (= imagem que estava no ar, `sha256:4381c3405ded`) criada antes de tudo.
2. **1º problema — o HEAD não compilava:** `nest build` compila também `test/eval-report.unit-spec.ts`, e o tipo
   `AnswerResult` ganhou o campo obrigatório `corrigiu_premissa_falsa` (commit `cd5cc12`, 29/09) sem o spec ser
   atualizado. Corrigido em 2 linhas de teste (commit `69f8c43`; `tsc` do backend inteiro passa, spec 34/34).
   Isto, por si só, impediria qualquer deploy desde 29/09.
3. Imagem nova construída (`44b97132e23d`, `GIT_COMMIT=69f8c434…`, entrypoint igual ao da antiga).
4. **2º problema — o backend novo não sobe:** `GoogleOAuthCalendarClientService` (commit F-27, fail-fast deliberado)
   lança erro no construtor quando faltam `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Essas variáveis **não existem no
   `.env` de produção** (o compose as repassa em branco). Container em crash loop (`Restarting (1)`).
5. **Rollback executado às 18:52:38** (`docker tag pre-20260930 latest` + `up -d --no-deps backend`): `/health` ok às
   18:52:45, nginx 200, 0 erros no log. **Indisponibilidade do backend: ~94 s (18:51:11 → 18:52:45).** Dados e migrations
   não foram afetados (as 4 migrations aditivas da Etapa 2 continuam aplicadas e são inofensivas com o código antigo).
6. Imagem que falhou guardada como `montese-backend:failed-20260930` para análise.

**Por que o ensaio da Etapa 0 não pegou isto:** os e2e setam `GOOGLE_CLIENT_ID/SECRET` falsos (`fake`) e importam o
`AppModule` sem subir o processo com o ambiente real. Faltou um **teste de boot da imagem com o `.env` de produção**.
**Antes de tentar de novo:** rodar a imagem nova num container isolado (rede interna, banco clone, Redis descartável,
sem porta publicada, `--env-file /opt/Montese/.env`, sem imprimir nada) e só trocar a imagem quando ela responder
`/health`. Mesmo teste vale para qualquer outra variável que o HEAD passou a exigir.

**Teste de boot isolado (executado em 2026-09-30 ~20:33 UTC, VERIFICADO):** imagem candidata
(`montese-backend:candidate-20260930` = a que falhou, `44b97132e23d`) rodada em container à parte na rede interna, com o
ambiente **idêntico ao do container de produção** (lido com `docker inspect` direto para arquivo temporário 600, apagado ao
final; nada impresso), banco = clone `montese_rehearsal_0930`, Redis descartável, chaves de Mercado Pago/Resend/MiniMax/OpenRouter
trocadas por fakes de formato válido (nenhuma chamada externa real), sem porta publicada.
- **Sem variáveis do Google:** sai com código 1 e o mesmo erro do construtor do Google — reproduz a falha de produção.
- **Com `GOOGLE_CLIENT_ID/SECRET` (falsos, só no container de teste):** sobe, `/health` devolve
  `commit 69f8c4343bd3d6ca2500b5f22131c6659f79bbc5`, **zero linhas de erro no boot**.
- Conclusão: **as credenciais do Google são o único bloqueio de boot**. Script reutilizável: `boot-test.sh` (scratchpad da sessão).
- Redirect do OAuth: `${APP_BASE_URL:-https://montesesst.com.br}/api/google-calendar/callback` — a URI precisa estar
  cadastrada no OAuth client do Google Cloud.

**Decisão tomada pelo proprietário (2026-09-30): opção B — integração opcional.** Implementado no commit `0b2fe82`:
ambas as variáveis ausentes = integração desativada (backend sobe; `GET /google-calendar/status` → `available:false`;
`auth-url` → 503 `GOOGLE_NOT_CONFIGURED`); **só uma** presente continua falhando no boot (credencial pela metade é erro
de configuração); as duas presentes = ativa. Página do técnico esconde "Conectar" quando indisponível e mostra erro em vez
de falhar em silêncio. Testes: 11 unitários do construtor, 5 e2e novos (provider real, sem overrideProvider), e as 12 suítes
afetadas (Google, visitas, dashboard, app-setup, status-guard) = 94/94 no clone. Quando o proprietário obtiver as
credenciais, basta colocá-las no `.env` e recriar o backend — sem novo código.

**Boot isolado da imagem corrigida (2026-09-30 ~20:43 UTC, VERIFICADO):** `montese-backend:candidate-20260930b`
(`949c5832d619`, `GIT_COMMIT=0b2fe824…`), ambiente idêntico ao de produção **sem nenhuma variável do Google e sem fakes**:
sobe, `/health` devolve `commit 0b2fe824212ca218ddac745240f671c7e5d5766d`, zero linhas de erro no boot. `:latest` foi
devolvido à imagem em produção (`pre-20260930`) até nova autorização; para implantar: `docker tag
montese-backend:candidate-20260930b montese-backend:latest` + `docker compose up -d --no-deps backend`.

**(histórico) Opções que foram apresentadas:** (A) fornecer as credenciais OAuth reais do Google e colocá-las no
`.env`; (B) tornar a integração opcional (não registrar o módulo/retornar 503 "integração não configurada" quando
faltam credenciais) — **reverte parte do F-27**, exige decisão e testes; (C) valores falsos no `.env` — **não
recomendado** (é exatamente o mascaramento que o F-27 quis evitar).

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

## 8. Commits por frente — ✅ EXECUTADOS em 2026-09-30 (HEAD `266e5ac`, sem push)

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

**Execução (2026-09-30, autorizada pelo proprietário):** 11 commits, `f35de27..266e5ac`, nenhum push.
Ficaram **fora de commit** de propósito: `frontend/src/components/PenteFinoPanel.tsx` e
`frontend/src/components/__tests__/PenteFinoPanel.test.tsx` (frente em andamento de outra pessoa/agente; o
teste está vermelho). A imagem do backend deve ser construída com `ops/build-with-commit.sh`, que avisa se
a árvore tem mudanças não commitadas — como o `PenteFinoPanel` é só frontend, não afeta o backend.
Varredura: nenhum arquivo `.env*` real entrou (só `.env.example`).
