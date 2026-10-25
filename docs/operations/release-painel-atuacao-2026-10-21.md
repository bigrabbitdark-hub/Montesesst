# Release — Painel de Atuação Montese (roteiro e estado) — 2026-10-21

> **Estado:** preparação **concluída e ensaiada**; **nenhuma alteração foi feita em produção**. As etapas marcadas **[PRODUÇÃO]** só ocorrem com a confirmação explícita do proprietário no momento (janela escolhida por ele). Todo o ensaio rodou no Postgres/Redis **descartáveis** (`socio_ensaio_*`), com esquema (sem dados) restaurado de produção.

## 1. Achados que mudam como a liberação deve ser feita (VERIFICADO)

1. **A minha árvore de trabalho NÃO é base de release.** Produção roda o commit `92ac6a0` (branch `feat/relatorio-visita-etapa1`, só existe na worktree `/opt/montese-work/visita-etapa1`). A branch `feat/montese-ia-admin-config` (`5c1e730`, onde o painel foi desenvolvido) **não é descendente nem ancestral** dele: 31 commits de produção (eSocial, ASO, EPI, funcionários, validade de documentos) **não existem** nela. **Construir imagem a partir de `/opt/Montese` removeria funcionalidades em produção.**
2. **Produção tem 85 migrations aplicadas**, inclusive de outras linhagens (`0065`–`0071` eSocial/ASO, `0079_document_validity`, `0080`–`0085`). A árvore principal tem arquivos que **não** estão em produção (`0063`, `0073`–`0075`, `0079_ai_provider_configs`) — rodar o runner dela aplicaria migrations não revisadas para release.
3. **Solução adotada: candidato de release isolado** em `/opt/montese-work/painel-release` (worktree **detached** no commit `92ac6a0`) com **apenas** os arquivos do painel portados (115 novos + 12 alterados; nenhum arquivo de inspeções/documentos de outras frentes; sem `/admin/ia`). Único conflito do port (`nav.ts`) resolvido mantendo só o item novo.
4. **O compose de produção** é `/opt/Montese/docker-compose.yml` (projeto `montese`; containers criados em 19/10, **depois** da última mudança do arquivo em 18/10). `docker compose` rodado de **outro** diretório criaria uma pilha paralela com volumes vazios — **nunca** rodar compose na worktree do candidato.
5. **Sem `.dockerignore`** em `backend/` e `frontend/`: construir sempre a partir de **cópia limpa** (sem `node_modules`, `dist`, `.next`).
6. O código do painel **não lê nenhuma variável de ambiente nova**. As migrations são **aditivas** e compatíveis com o código antigo (o enum ganha `socio` sem uso; `chk_tenant_role` mantém a semântica para os papéis existentes; `documents_uploaded_by_role_check` vira superconjunto; categoria de `documents` **não** é alterada — mantém os 13 valores, inclusive `cadastro_funcionarios`).

## 2. Ensaio contra o esquema real de produção (VERIFICADO)

- `pg_dump --schema-only` (sem dados, sem PII) restaurado em `montese_prodschema` no Postgres descartável; `_migrations` preenchida com os 85 nomes reais e `plans` (5 linhas de configuração).
- Diferença exata candidato × produção: **pendentes = `0090`…`0096` (7 arquivos)**; nenhuma outra.
- As 7 foram aplicadas **uma por transação, com `SET LOCAL ROLE montese_app`** (o papel do runner de produção): **7/7 OK**. Privilégios confirmados em produção por consulta somente leitura: `montese_app` é dono das tabelas alteradas e do enum `user_role`, é **membro de `montese_auth_bypass`**, e este tem `CREATE` em `public` (necessário ao `ALTER FUNCTION … OWNER`).
- Estado final: enum com `socio`; `is_montese_tenant` e `list_socios` com dono `montese_auth_bypass` (BYPASSRLS); 12/12 tabelas novas com RLS ligado e forçado; 13 triggers de guarda; `documents_category_check` preservada (13 valores).
- **Candidato (base de produção + painel):** backend `tsc` e build OK; unit 118/120 suítes (as 2 falhas são **pré-existentes na própria base de produção**: `r2-get-object` e `tenant-context-callsites`, ver §5); frontend 83 arquivos / 1126 testes, `tsc` e build OK (10 rotas novas geradas).
- **e2e do candidato contra o esquema de produção restaurado:** `atuacao-documentos` 45, `atuacao-financeiro` 21, `atuacao-agenda` 29, `atuacao-tarefas` 28, `atuacao-carteira` 13, `socio-access-matrix` 13, `subscription-status-guard` 19, `tenant-isolation-sweep` 10, `admin-dashboard-financeiro` 5, `auth` 5 = **188 passando, 0 falhas**.
- Regressão ampla das suítes da linhagem de produção (autenticação, tenants, planos, assinaturas, pagamentos, documentos, funcionários, EPI, eSocial, visitas): ver §6 (resultado anexado ao final do ensaio).

## 3. Roteiro de liberação **[PRODUÇÃO]** (a executar só com a confirmação do proprietário)

Pré-requisito 0 — **commit do candidato** (decisão do proprietário; o agente não commita):
`git -C /opt/montese-work/painel-release add -A && git -C /opt/montese-work/painel-release commit -m "feat(painel): Painel de Atuação (sócios) sobre a base de produção 92ac6a0"` → o SHA vai para o rótulo `GIT_COMMIT` da imagem (campo `commit` de `/health`).

1. **Backup** (de `/opt/Montese`): `bash ops/backup-postgres.sh`. Confirmar `[ok] backup salvo em /opt/montese-backups/postgres/montese-*.dump` **e** `[ok] cópia externa enviada ao R2`. Banco ≈ 112 MB. **Parar se qualquer um falhar.**
2. **Tags de rollback das imagens atuais:** `docker tag montese-backend:latest montese-backend:rollback-20261021` e `docker tag montese-frontend:latest montese-frontend:rollback-20261021`.
3. **Construir as imagens a partir de cópia limpa do candidato** (sem tocar nos containers):
   `rsync -a --exclude node_modules --exclude dist --exclude .next /opt/montese-work/painel-release/backend/ /tmp/painel-build/backend/` (idem `frontend`);
   `docker build --build-arg GIT_COMMIT=<SHA do commit> -t montese-backend:latest /tmp/painel-build/backend`; `docker build -t montese-frontend:latest /tmp/painel-build/frontend`.
   (As imagens finais usam o `npm install --omit=dev` do próprio Dockerfile, como nos builds anteriores.)
4. **Migrations** (aditivas, compatíveis com o código antigo; **antes** de trocar o código): copiar **somente** `0090`…`0096` para o container atual e rodar o runner:
   `docker cp <cada arquivo> montese_backend:/app/db/migrations/` e `docker exec montese_backend npm run db:migrate`.
   Resultado esperado: aplica exatamente 7 arquivos; `select count(*) from _migrations` = **92**. Cada arquivo roda em transação: falha ⇒ rollback daquele arquivo e **parar** (o código antigo continua funcionando).
5. **Trocar o código** (somente backend e frontend, de `/opt/Montese`): `cd /opt/Montese && docker compose up -d --no-deps --no-build backend frontend`.
6. **Recarregar o nginx** (o upstream é resolvido na subida; o IP do backend muda ao recriar): `docker exec montese_nginx nginx -s reload` — sem alterar configuração.
7. **Verificação pós-liberação:** `/health` com o `commit` novo; página pública e `/api/plans` respondem; nenhum `ERROR` nos logs do backend/frontend nos primeiros minutos; `_migrations` = 92; login de um usuário existente funciona (feito por quem tem a credencial).
8. **Contas dos sócios** (etapa separada, ver §4): só depois do passo 7.

**Rollback:** `docker tag montese-backend:rollback-20261021 montese-backend:latest` (idem frontend) + `docker compose up -d --no-deps --no-build backend frontend` + `nginx -s reload`. As migrations são aditivas: o código antigo roda sobre o esquema novo; reversão de esquema só se necessário (cabeçalho de cada migration traz o SQL de rollback) ou, em último caso, restauração do dump do passo 1 (perde dados posteriores ao backup).

## 4. Contas dos sócios e permissões (etapa separada, **[PRODUÇÃO]**)

- Criar `socio.*` com **senha lida de variável de ambiente no momento da execução** (nunca em arquivo/seed/teste). As senhas informadas no chat não devem ser reaproveitadas como definitivas; alternativa: gerar senha temporária aleatória e usar o fluxo de redefinição por e-mail.
- Conceder as permissões RBAC (`clients.read`, `clients.update_operational`, `tasks.read`, `tasks.write`, `appointments.manage`, `finance.read`, `documents.*` conforme decisão) — **só o que o proprietário mandar**.
- **Matriz de responsabilidades vazia** e **registros profissionais a cadastrar e confirmar** pelo admin (tela `/admin/documentos-fluxo`), com dados fornecidos e conferidos pelo proprietário. Sem isso, nenhuma ação restrita de documentos funciona (comportamento intencional).

## 5. Achados pré-existentes (não são do painel) para o proprietário

1. **Guarda ITEM 008 já vermelha na base de produção:** `tenant-context-callsites` falha em `92ac6a0` por 3 chamadores diretos de contexto **não revisados** (`employees/employees.controller.ts` ×2, `esocial/certificates/certificates.controller.ts`, `esocial/events/esocial-events.controller.ts`). Não editei a lista `ALLOWED` (exige revisar como o contexto é montado).
2. **`0072_lip_normative_base` está aplicada em produção, mas o arquivo não existe no commit de produção.** O runner ignora, mas o histórico fica sem fonte no repositório.
3. **A árvore `/opt/Montese` está desalinhada de produção** (branch `feat/montese-ia-admin-config`): `5c1e730` (painel `/admin/ia` + `0079_ai_provider_configs` + `AI_CONFIG_ENCRYPTION_KEY` no compose) **não está em produção**. O compose dessa árvore declara `AI_CONFIG_ENCRYPTION_KEY` sem valor padrão: antes de levar o `/admin/ia` a produção é preciso definir essa chave (64 hex) no `.env` — fora do escopo desta liberação.
4. Duas migrations com o mesmo número em várias linhagens (`0079`, `0081`, `0082`, `0083`): funciona (o runner usa o nome do arquivo), mas é fonte de confusão.

## 6. Anexo — regressão ampla da linhagem de produção contra o candidato (VERIFICADO)

62 suítes e2e (autenticação, rate limit, tenants, planos, assinaturas, pagamentos, webhook, documentos, funcionários, EPI, eSocial, visitas, agenda do técnico, dashboards, RLS), uma por vez com Redis zerado, contra o esquema de produção restaurado e migrado (0090–0096):

- **53 suítes sem nenhuma falha.**
- **9 suítes com falhas, IDÊNTICAS às do código puro de produção** (`92ac6a0`, sem o painel) rodado no mesmo banco, com a mesma contagem por suíte: `tenants-detail` 1/3, `tenants-logo` 3/9, `subscriptions` 2/4, `documents-validity` 18/31, `epi-stock-permissions` 6/6, `epi-tenant-scope` 4/4, `epi-catalog-rls` 3/3, `esocial-events-rls` 1/1, `dashboard-summary` 11/11. Causas observadas: fixtures que dependem de **dados de referência** que o esquema restaurado (sem dados) não traz (`Cannot read properties of undefined (reading 'id')`) e fluxos de upload que exigem o **R2** (inexistente no ambiente descartável). **Conclusão: nenhuma regressão introduzida pelo painel.**
- Limitação: essas 9 suítes ficam **NÃO VERIFICADAS** neste ensaio (nem com o painel nem sem ele); só um ambiente com dados de referência e R2 (ou mocks) as validaria. Recomenda-se rodá-las num clone completo de produção, se o proprietário quiser esse nível de garantia.
- Não rodadas (130 suítes restantes de 192): as não relacionadas a áreas tocadas pelo painel (IA/RAG normativo, CIPA, brigada, inspeções etc.). Os arquivos que o painel alterou na base são 12 (guard de papéis, tipos, auth, módulo raiz, estado de assinatura, helpers de teste e 4 do frontend admin/auth).

## 7. Teste de boot das imagens REAIS (Alpine, `NODE_ENV=production`) — VERIFICADO (2026-10-21)
Imagens construídas de **cópia limpa** do candidato com tags `montese-backend:painel-cand` / `montese-frontend:painel-cand` (rótulo `GIT_COMMIT=tree-5a6d1514…`, hash da árvore em staging; as tags `:latest` de produção **não foram tocadas** — ids `177fdc06…` e `cc4f5460…` iguais aos dos containers em execução). Boot isolado na rede descartável, contra `montese_prodschema` (esquema de produção + 0090–0096), com valores falsos de formato válido para `validateProductionEnv()`:
- Backend: `/health` 200 com o campo `commit`; **0 linhas `level:error`**; frontend: `/login`, `/atuacao`, `/admin/documentos-fluxo` = 200.
- `bcrypt` nativo (musl) funciona; login de admin e de sócio OK; sócio: `/auth/me` role=socio, `/atuacao/clientes` 200 (1 cliente), `/atuacao/financeiro/resumo` 200, `/atuacao/tarefas` sem permissão ⇒ 403 `PERMISSION_DENIED`, `PATCH /plans/:id` 403, `GET /admin/dashboard/financeiro` 403; admin: `/atuacao/admin/documentos/viabilidade` 200 (12 categorias), `/atuacao/clientes` 403; `GET /plans` público 200.
- Ambiente de teste removido (containers, arquivos de segredos, tags `:painel-cand`). **Produção continuou intacta durante todo o ensaio** (containers, imagens, 85 migrations, nginx 301→HTTPS).
- Na janela, o build real deve ser refeito com o SHA do commit do proprietário no `GIT_COMMIT`.

## 8. Execução em produção (registro, 2026-10-21) — FEITO
- **Release aplicado pelo proprietário** (commit `9047b32`): backup `montese-20261021-174211.dump` (25 MB), imagens `painel-9047b32` → `:latest`, migrations `0090`–`0096` (total **92**), backend/frontend recriados (17:46 UTC), `/health` com `commit=9047b32…`.
- **Verificação (somente leitura), 18:14 UTC:** nginx HTTPS 200 em `/`, `/login`, `/api/health`, `/api/plans`, `/atuacao`, `/admin/documentos-fluxo`; **0** `level:error` em 60 min (backend), 0 erros no frontend, 0 respostas 502/504; 0 reinícios; enum com `socio`; funções com dono `montese_auth_bypass`; 12/12 tabelas novas com RLS forçado; 13 triggers de guarda; `documents_category_check` com 13 valores; dados preservados (120 usuários, 36 tenants, 38 documentos).
- **Contas dos sócios criadas** (transação única, sem senha utilizável — hash de valor aleatório descartado): `Danilo Berto` (`tecnico.montesesst@…`) e `Évelyn Souza` (`eng.evelynsouza@…`), papel `socio`, ativas, `tenant_id` nulo, **8 permissões operacionais** cada: `clients.read`, `clients.update_operational`, `tasks.read`, `tasks.write`, `appointments.manage`, `finance.read`, `documents.read`, `documents.create_draft`. **Não concedidas (decisão do proprietário):** `documents.review`, `documents.approve`, `documents.sign`, `documents.publish`, `documents.cancel`, `documents.view_registration`. Nenhum e-mail foi disparado; cada pessoa define a senha pelo "Esqueci minha senha" na tela de login. Auditoria: 2 linhas `user.provisioned`.
- **Pendências do proprietário:** (1) as duas pessoas definirem a senha; (2) cadastrar/confirmar os registros profissionais e preencher a matriz em `/admin/documentos-fluxo`; (3) conceder as permissões de documentos que quiser (hoje **não existe tela/API para conceder permissões RBAC**: é por SQL) — recomendada uma tela de admin para isso; (4) trocar a senha de qualquer conta cujas credenciais tenham sido escritas em chat.

## Fase 7 — tela do admin para permissões dos sócios (2026-10-21, NÃO commitada, NÃO em produção)

- **O quê:** `GET/PUT /atuacao/admin/permissoes[/:userId]` (somente admin) e a tela `/admin/permissoes-socios` (menu Sistema → "Permissões dos sócios"). Sem migration: usa `socio_permissions` e a policy de admin já existentes.
- **Regras (VERIFICADO por testes):** só o admin altera; lista fechada de 14 permissões; conceder qualquer permissão sensível exige `confirmar_sensiveis: true` (backend) e caixa de confirmação com o texto obrigatório (tela); sócio inativo só tem permissões removidas; auditoria `socio_permissions.changed` na mesma transação, só com ids e nomes de permissão; trava consultiva por usuário; `granted_by` = admin do JWT.
- **Efeito real (VERIFICADO e2e):** conceder `tasks.read` muda 403 → 200 em `/atuacao/tarefas` e remover volta a 403.
- **Para liberar:** commit do proprietário + build das imagens backend e frontend; nenhuma migration a aplicar. Depois, o admin concede as permissões pela tela (as sensíveis seguem NÃO concedidas até decisão do dono; a matriz de documentos continua obrigatória).
- **Verificação (esta fase):** unit backend 1843 ok, 2 falhas pré-existentes (`r2-get-object`, `tenant-context-callsites`); tsc e build ok; frontend 84 arquivos / 1153 testes, tsc, eslint e build ok; e2e conforme logs da sessão. QA visual em navegador: NÃO VERIFICADO.
