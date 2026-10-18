# Plano de release — Conformidade por NR — 2026-10-01

> **Status: NADA EXECUTADO.** Este documento só planeja. Cada etapa marcada 🔒 muda produção e exige
> autorização explícita do proprietário (AGENTS.md, seção Infraestrutura). Modelo: `release-backend-2026-09-30.md`.
> Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

## 0. Atualização (2026-10-04) — candidatas refeitas

As imagens `candidate-nr-20261001` **não existem mais** (VERIFICADO em 2026-10-04: `docker images -a` só tinha `latest`).
- **Backend:** `montese-backend:candidate-nr-20261004` (`d44575571ac1`), rebuild da worktree limpa `/opt/montese-release-nr`
  (`6b01a3992af6…`, 0 arquivos sujos). `nest build` passou; `db/migrations` termina em `0062…`/`0064…`, **sem `0063`**;
  `GIT_COMMIT` embutido = `6b01a399…`; `dist/src/nr-conformidade` presente. Usar no lugar de `candidate-nr-20261001` na Etapa 3.
- **Frontend:** não precisa de imagem própria. O commit `6b01a39` já está contido na `candidate-shell3-20261004`
  (ver `release-frontend-shell-empresa-2026-10-04.md`); na Etapa 4 aplicar a `shell3` (ou a que estiver em `latest` na época).
  O frontend antes do backend é seguro (cartão vira "indisponível").
- **Boot isolado REFEITO em 2026-10-05 (VERIFICADO), por método mais seguro:** Postgres + Redis **descartáveis e isolados** (rede própria, `tmpfs`, senhas aleatórias, chaves falsas de formato válido), sem ler credencial de produção e sem criar banco no Postgres de produção. 63 migrations aplicadas do zero, **sem a `0063`**, últimas `0062` e `0064`. A imagem `candidate-nr-20261004` subiu com `NODE_ENV=production`: `/health` **200** com `commit 6b01a3992af6…`; `GET /dashboard/nr-conformidade` e `/dashboard/nr-aplicaveis` → **401** sem login; rota inexistente → 404; **0 erros no boot** (as únicas linhas `warn` eram as próprias sondas). Ambiente removido ao final. **Ainda NÃO verificado:** smoke autenticado e navegador (Etapa 5).
- **Ordem inalterada:** backup → migration `0064` → backend → frontend. Backup antigo não vale: refazer a Etapa 1 no dia do release.

## 1. Por que isto é um release, e não só "deploy do frontend"

Mudança de schema + backend + frontend, **com dependência de ordem**:

- O backend novo lê `inspections.nrs_aplicaveis` em **toda** conclusão de inspeção
  (`SELECT nrs_aplicaveis FROM inspections`, em `inspections.service.ts`). **Sem a migration, toda conclusão de
  inspeção, de qualquer empresa, dá 500.**
- O frontend novo antes do backend é seguro (VERIFICADO no código): `/api/dashboard/nr-conformidade` com 404 vira
  "Dado indisponível no momento." e o bloco do técnico não aparece.
- A migration é **aditiva** (tabela nova + coluna nullable): o backend antigo continua funcionando depois dela.

**Ordem obrigatória:** backup → migration `0064` → backend → frontend.

## 2. O que entra e o que NÃO entra

| Entra (commit `6b01a39`, branch `feat/conformidade-por-nr`, 31 arquivos) | Fica de fora (outra frente, não commitada) |
|---|---|
| migration `0064_company_applicable_nrs.sql` | `0063_sst_audit_document_facts.sql` |
| `backend/src/nr-conformidade/*`, dashboard, inspeções | `pdf-text.util.ts`, `pdf-text-full.unit-spec.ts` |
| frontend: cartão, bloco do técnico, menu | `pente-fino-audit-facts-rls.e2e-spec.ts`, spec/plano do PDF |

Mudanças em Docker, compose, Nginx, `.env`: **nenhuma** (VERIFICADO: `git diff b516f21 6b01a39` em
`docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/next.config.js` = 0 linhas; 0 usos de
`process.env` nos arquivos novos). Não há variável de ambiente nova.

## 3. Pré-requisitos 🔒 (decisão do proprietário)

1. **Autorização do release** e janela de baixa atividade, com alguém acompanhando.
2. **Build SEMPRE de uma árvore limpa do commit `6b01a39`, nunca do working tree atual.** Motivo (VERIFICADO):
   o contexto do build é `./backend` inteiro, o `Dockerfile` faz `COPY db ./db` e `COPY . .`. Hoje a árvore contém a
   `0063_sst_audit_document_facts.sql` (não rastreada) e `pdf-text.util.ts` modificado. Um build daqui levaria a
   `0063` para dentro da imagem e o código do PDF para dentro do `dist`. **`ops/build-with-commit.sh` NÃO deve ser
   usado a partir do working tree atual.** Mesmo padrão do release do frontend de 2026-09-30 ("construído de árvore limpa").
   ```bash
   git worktree add /opt/montese-release-nr 6b01a39      # fora do repo; sem tocar o working tree
   ```
3. Decisão sobre a **`main`**: o release pode sair da branch sem merge. Fazer o merge antes ou depois é decisão sua
   (não é pré-requisito técnico). Sem push neste plano.
4. Confirmar que **não existe** `docker-compose.override.yml` (VERIFICADO hoje: não existe).
5. **A `0063` não vai junto.** A `0064` não depende dela (só usa `tenants`, `users`, `inspections` e
   `assigned_tenant_ids_for_current_user()`). Se a outra frente também for ao ar, é um release próprio.

## 4. Sequência

Cada passo tem critério de sucesso e de parada. Se algo falhar: **parar** e reportar; não improvisar em produção.

### Etapa 0 — Preparar e ensaiar (não altera produção)

1. Criar a worktree limpa (acima) e conferir `git -C /opt/montese-release-nr status --short` vazio e
   `ls /opt/montese-release-nr/backend/db/migrations | tail -2` = `0062…` e `0064…` (sem `0063`).
2. Buildar as imagens **candidatas** a partir da worktree (só buildam; não recriam containers). O build roda
   `nest build` e `next build`, o que fecha a lacuna "NÃO VERIFICADO" da verificação anterior:
   ```bash
   SHA=$(git -C /opt/montese-release-nr rev-parse HEAD)
   docker build --build-arg GIT_COMMIT=$SHA -t montese-backend:candidate-nr-20261001 /opt/montese-release-nr/backend
   docker build -t montese-frontend:candidate-nr-20261001 /opt/montese-release-nr/frontend
   ```
   Critério: os dois builds terminam sem erro. Conferir `docker run --rm montese-backend:candidate-nr-20261001 ls db/migrations | tail -2`
   (deve terminar em `0064`, sem `0063`).
3. **Boot isolado do backend candidato** (como no release anterior): container à parte na rede interna, banco =
   clone descartável já com a `0064`, Redis descartável, ambiente idêntico ao de produção sem imprimir segredos,
   chaves de Mercado Pago/Resend/MiniMax/OpenRouter trocadas por falsas, sem porta publicada. Critério: `/health` com o
   commit certo e 0 linhas de erro no boot. Apagar o clone (`DROP DATABASE`, nunca `down -v`) ao final.

**Resultado da Etapa 0 — ✅ EXECUTADA em 2026-10-01 (VERIFICADO; produção não foi tocada):**

- Worktree `/opt/montese-release-nr` em `6b01a39…`, 0 mudanças; migrations terminam em `0062` e `0064`, sem `0063`.
- **Builds:** backend e frontend com exit 0. O `next build` compilou, checou tipos e gerou 62/62 páginas; o `nest build` passou.
  Isso fecha a lacuna "build NÃO verificado". Imagens candidatas: `montese-backend:candidate-nr-20261001` (`85fc796c58fb`,
  `GIT_COMMIT=6b01a399…`, `db/migrations` termina em `0064`, sem `0063`) e `montese-frontend:candidate-nr-20261001` (`47c0af4a1d97`).
  O log do frontend tem avisos de download de fonte do Google com "Retrying"; a imagem candidata tem os mesmos 22 arquivos de fonte que a atual.
- **Clone** criado do dump `montese-20261001-030001.dump` (62 migrations, igual à produção). A `0064` foi aplicada pelo método da
  Etapa 2 (superusuário, `--single-transaction`, `INSERT INTO _migrations`). Critérios da Etapa 2 conferidos no clone: RLS ativa e
  forçada (`t/t`), política `company_applicable_nrs_isolation`, índice único parcial + índice por tenant, `inspections.nrs_aplicaveis`
  `jsonb` nullable sem default, `montese_app` com `SELECT/INSERT/UPDATE/DELETE`, 63 migrations, sem `0063`.
- **Boot isolado** da imagem candidata (ambiente de produção reescrito para o clone e para um Redis descartável; chaves de Mercado
  Pago/Resend/OpenRouter/MiniMax/Groq/R2 trocadas por falsas de formato válido; sem porta publicada): `/health` `ok` com
  `commit 6b01a399…`, **0 linhas de erro** no boot; `GET /dashboard/nr-conformidade` e `/dashboard/nr-aplicaveis` → **401** sem login
  (rotas existem e estão protegidas), rota inexistente → 404.
- **Armadilhas do ensaio (não são defeitos da imagem):** (1) o validador de configuração rejeita chave sem o formato esperado
  (`RESEND_API_KEY` deve começar com `re_`, `OPENROUTER_API_KEY` com `sk-or-`): é o mesmo fail-fast da produção; (2) copiar o ambiente
  de produção para o ensaio traz `GIT_COMMIT` antigo, que sobrepõe o valor da imagem e faz o `/health` mostrar o commit errado;
  retirar essa variável do arquivo de ambiente do ensaio.
- **Limpeza:** container e Redis do ensaio removidos, banco do clone apagado com `DROP DATABASE`, arquivo de ambiente apagado.
  Produção intacta: backend `Up 15 h` e frontend `Up 13 h` sem reinício, `montese-backend:latest` = `949c5832d619` (inalterada).
  A worktree e as duas imagens candidatas **ficam** até o release.
- **Ainda NÃO verificado:** o smoke autenticado da imagem candidata (feito só nos e2e do código, no clone) e a Etapa 5 (navegador).

### Etapa 1 — Backup 🔒

`bash /opt/Montese/ops/backup-postgres.sh`. Conferir: dump novo em `/opt/montese-backups/postgres/`, tamanho coerente,
linha `[ok]`, ausência de `[ERRO] cópia externa`, MD5 local = remoto. **Sem backup conferido, não segue.**

**Resultado da Etapa 1 — ✅ EXECUTADA em 2026-10-01 11:31 UTC (VERIFICADO):** dump `montese-20261001-113139.dump`
(23 188 431 bytes) em `/opt/montese-backups/postgres/` e no R2 em `backups/postgres/montese-20261001-113139.dump`
(`bytes` reportado pelo envio = 23 188 431). MD5 local `d03905ab403d6a388feb7f76a04cd245` = MD5 informado pelo script de envio
(NÃO consultei o objeto no R2 por outro caminho; o MD5 remoto é o que o próprio script de envio reportou). `pg_restore --list` lê o dump
sem erro: 783 entradas, 60 tabelas com dados, incluindo `tenants`, `users`, `inspections`, `documents`, `employees`, `subscriptions`.
Sem `[ERRO] cópia externa`. Rotação remota: `total 7, deleted []` (nada apagado). Há também o dump automático de 03:00 UTC de hoje
(`montese-20261001-030001.dump`), anterior ao release. Banco e containers não foram alterados pelo backup.

### Etapa 2 — Migration `0064` 🔒

Mesmo método da Etapa 2 do release anterior: superusuário do Postgres, em transação única, com o registro em
`_migrations` na mesma transação (o runner `npm run db:migrate` não é usado; ele aplicaria qualquer `.sql` pendente).
```bash
docker cp /opt/montese-release-nr/backend/db/migrations/0064_company_applicable_nrs.sql montese_postgres:/tmp/0064.sql
docker exec montese_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction -v ON_ERROR_STOP=1 \
  -f /tmp/0064.sql -c "INSERT INTO _migrations (name) VALUES ('"'"'0064_company_applicable_nrs.sql'"'"')"; rm -f /tmp/0064.sql'
```
Verificar (todos devem bater):
- `company_applicable_nrs` existe, RLS ativa **e forçada** (`relrowsecurity` e `relforcerowsecurity` = `t`), política
  `company_applicable_nrs_isolation`, índice único parcial `company_applicable_nrs_active_uq`.
- `inspections.nrs_aplicaveis` existe, `jsonb`, nullable, sem default.
- O papel `montese_app` tem `SELECT/INSERT/UPDATE/DELETE` na tabela nova (as permissões padrão do banco dão
  `arwdDxt` ao `montese_app` em tabelas criadas pelo `postgres`: VERIFICADO em `pg_default_acl` de produção; conferir de novo
  aqui).
- `_migrations` passou de 62 para 63 linhas. **A `0063` não pode aparecer.**
- Backend antigo **nunca reiniciado**: `/health` ok, 0 erros no log nos 5 minutos seguintes.
**Rollback desta etapa (antes do backend novo):** `DROP TABLE company_applicable_nrs; ALTER TABLE inspections DROP COLUMN nrs_aplicaveis;
DELETE FROM _migrations WHERE name = '0064_company_applicable_nrs.sql';` (a tabela estará vazia).

**Resultado da Etapa 2 — ✅ EXECUTADA em 2026-10-01 ~11:37 UTC (VERIFICADO):**
- Estado de partida conferido antes: banco `montese`, 62 migrations, tabela e coluna inexistentes, `0064` não registrada, backend `ok`.
- Arquivo copiado = arquivo da worktree (MD5 `19acca426c20…`, 31 linhas; sem `0063`). Aplicada pelo superusuário, `--single-transaction`,
  `ON_ERROR_STOP`, com `INSERT INTO _migrations` na mesma transação: `psql-exit=0`, 7 comandos DDL + 1 INSERT, arquivo temporário apagado.
- Depois: `company_applicable_nrs` com RLS **ativa e forçada** (`t/t`), política `company_applicable_nrs_isolation`, índices
  `…_active_uq` (único parcial), `…_pkey`, `…_tenant_idx`; `inspections.nrs_aplicaveis` `jsonb`, nullable, sem default; `montese_app` com
  `SELECT/INSERT/UPDATE/DELETE` (+ REFERENCES/TRIGGER/TRUNCATE do padrão do banco); 0 linhas na tabela nova; `_migrations` = **63**, última
  `0064…`, **sem `0063`**.
- Backend antigo **nunca reiniciado**: `Up 15 h`, `/health` `ok` (commit `0b2fe824`), 0 linhas de erro no log nos 5 min seguintes; frontend `Up 13 h`.
- Fato novo: a tabela `inspections` de produção tem **0 linhas** (contagem como superusuário, sem RLS), então nenhuma inspeção existente
  é afetada pelo ciclo "conclusão antes da migration" e as primeiras conclusões já nascem com o backend novo.

### Etapa 3 — Backend 🔒

1. `docker tag montese-backend:latest montese-backend:pre-nr-20261001`
2. `docker tag montese-backend:candidate-nr-20261001 montese-backend:latest`
3. `docker compose up -d --no-deps backend` (sem override; reinício esperado de ~20 s)
4. Verificar: `GET /health` com `commit` = `6b01a39…`; 0 erros no boot; nginx `/api/health` 200.
5. Smoke ponta a ponta com fixtures temporárias, removidas ao final (confirmar 0 empresas/usuários novos):
   - empresa: `GET /dashboard/nr-conformidade` → 200 `{ nrs: [] }`; `GET /dashboard/summary` e `/overview` seguem 200;
   - técnico vinculado com `tenant_id` → 200; **não vinculado → 403**; empresa tentando `PATCH` de inspeção com
     `nrs_aplicaveis` → 403;
   - **concluir uma inspeção de teste sem mexer no bloco** (caminho de todas as inspeções antigas) → sem 500 e
     `company_applicable_nrs` inalterada; depois concluir outra **com** marcação e conferir a linha criada;
   - RLS na tabela nova, com o papel do app: sem contexto → 0 linhas; contexto da empresa B não enxerga a A.
**Rollback:** `docker tag montese-backend:pre-nr-20261001 montese-backend:latest` + `docker compose up -d --no-deps backend`.
A migration é aditiva e **fica** (o backend antigo ignora a tabela e a coluna).

### Etapa 4 — Frontend 🔒

1. `docker tag montese-frontend:latest montese-frontend:pre-nr-20261001`
2. `docker tag montese-frontend:candidate-nr-20261001 montese-frontend:latest`
3. `docker compose up -d --no-deps frontend`
4. Verificar: nginx `/dashboard-v2` 200, `/empresa/inspecoes` 200, `/empresa/dashboard` ainda 307 → `/dashboard-v2`.
**Rollback:** `docker tag montese-frontend:pre-nr-20261001 montese-frontend:latest` + `docker compose up -d --no-deps frontend`.

### Etapa 5 — Verificação em navegador (nunca foi feita)

Pelo domínio real (`--host-resolver-rules`, nunca `https://localhost`: CORS). Com uma empresa de teste e um técnico de
teste vinculado, removidos depois:
1. **Sidebar:** o item "Relatório de visita técnica" (27 caracteres) cabe na linha fixa de 42px ou quebra? Conferir em
   largura de desktop e de celular. Se quebrar: `leading-tight` ou `title` + `truncate` (frontend, novo ciclo).
2. **Cartão** no `/dashboard-v2`: estado vazio ("Nenhuma visita técnica registrou NRs aplicáveis…"); depois de uma
   visita concluída com NRs marcadas, linhas com status em texto, "Fonte oficial" abrindo o site do MTE em nova aba.
3. **Bloco do técnico:** marcar/desmarcar, "Salvando…" visível, concluir bloqueado durante o salvamento, caixas
   travadas na visita concluída; foco do teclado ao marcar (limitação conhecida: o checkbox desabilitado perde o foco).
4. 0 erros de JS no console e 0 respostas 5xx.

## 5. Rollback geral

| Situação | Ação |
|---|---|
| Backend novo não sobe ou conclusão de inspeção dá 500 | imagem `pre-nr-20261001` (Etapa 3). Migration fica. |
| Frontend com problema | imagem `pre-nr-20261001` (Etapa 4). |
| Migration errada, **antes** do backend novo | SQL de rollback da Etapa 2 (tabela vazia). |
| Dado corrompido | **Parar.** Restaurar dump só com autorização explícita e depois de confirmar o backup do dia. |

## 6. Depois do release

- Registrar aqui o resultado de cada etapa (VERIFICADO / NÃO VERIFICADO), como no release anterior.
- Apagar `/opt/montese-release-nr` (`git worktree remove`) e as imagens `candidate-*` quando não servirem mais.
- Conferir com uma empresa real quando um técnico marcar NRs pela primeira vez.
- Atualizar a memória do projeto com o commit em produção.
- Decidir o merge na `main` e o push (nenhum é feito por este plano).

## 7. O que este plano não cobre

- A `0063`/frente do PDF, rotação de segredos, TLS, DNS e Nginx.
- A fase B (aplicabilidade automática por CNAE), NRs setoriais, eSocial.
- Limitações conhecidas da feature: ver `docs/superpowers/specs/2026-10-01-conformidade-por-nr-design.md`, §12.
