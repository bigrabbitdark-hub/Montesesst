# Painel do Danilo — D2 (tarefas com status de espera, histórico de atendimento global, encaminhar a outro sócio) — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** o sócio registra tarefas "aguardando cliente / execução / eficácia" sem marcá-las como concluídas, vê o histórico de atendimentos de toda a carteira em uma lista filtrável e encaminha uma tarefa a outro sócio (ex.: Danilo → Évelyn) de forma explícita e auditável; o painel passa a organizar pendências por essas categorias.
**Architecture:** migration **0100** amplia o CHECK de `tasks.status` (aditiva); backend estende `TarefasService`/DTOs (transições, resumo por categoria) e cria `GET /atuacao/interacoes` (lista global, somente leitura); frontend ajusta tarefas, nova página `/atuacao/atendimentos`, dashboard (pendências por categoria) e menu. Évelyn é sócia (mesmo papel), então a delegação reaproveita `assignee_user_id` e `list_socios()`.
**Origem:** pedido do proprietário §4, §5, §9, §11; auditoria 2026-10-29; autorização "pode prosseguir todas etapas" (2026-10-29) cobre migrations/permissões das fatias, **não** push/deploy/banco real.

## Global Constraints
- Base: worktree `/opt/montese-work/painel-release` (HEAD 63c95b5). **Sem commit/push/reset/stash/deploy por agentes**; nada em produção; não ler `.env`/`ensaio.env`; proibido `/opt/Montese/run-backend-tests.sh`; não tocar `/opt/Montese`.
- Migration **0100**: aditiva, cabeçalho com rollback SQL, aplicada só em `montese_prodschema` (`docker exec -i socio_ensaio_pg psql -U ensaio_su -d montese_prodschema -v ON_ERROR_STOP=1`, transação, GRANT como as anteriores, `INSERT INTO _migrations`). Sem permissão nova (usar `tasks.read`/`tasks.write`/`clients.read`; a lista permanece 18).
- Novos status de `tasks` (valores técnicos em inglês, rótulos pt-BR): `awaiting_client` "Aguardando cliente", `awaiting_execution` "Aguardando execução", `awaiting_efficacy` "Aguardando comprovação de eficácia". O existente `awaiting_review` é rotulado "Aguardando avaliação técnica" **se** o rótulo atual não contradisser seu uso (conferir `STATUS_LABEL` e os usos; relatar). Todos contam como **abertos** (não concluídos); "vencida" continua = prazo vencido e não concluída/cancelada.
- Encaminhar tarefa = mudar `assignee_user_id` para outro sócio ativo (validado por `list_socios()`), gerando `task_events` tipo `assigned` (campo antes/depois como o padrão atual) e auditoria; nunca por texto livre; só quem tem `tasks.write`.
- Padrões do A/B1/D1: `@Roles('socio')`, `@RequirePermission`, `req.withTenantContext`, empresa de parceiro ⇒ 404 (RLS Z), whitelist de colunas no serviço, auditoria na mesma transação com ids e nomes de campo (nunca texto livre), 404 uniforme, ParseUUIDPipe.
- Histórico de atendimento global: somente leitura de `client_interactions` (0094) das empresas Montese; `clients.read`; LIMIT/paginação; **não** devolver dados pessoais além do que `GET /atuacao/clientes/:id/interacoes` já devolve; sem texto livre na auditoria.
- Testes backend: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json --testPathPattern <caminho>` (cuidado: padrão simples casa com o caminho do worktree e roda tudo); `npx tsc --noEmit -p tsconfig.json`; `npm run build`. E2E SOMENTE: `H=/tmp/claude-0/-opt-Montese/bac8b5c8-7575-4e72-a1f2-42d204d1d1d3/scratchpad; $H/reset-redis.sh >/dev/null && $H/run-e2e-cand.sh <padrão> > $H/<log> 2>&1`, uma suíte por vez. Frontend SOMENTE via `$H/sync-f7-front.sh <comando>`.
- pt-BR; VERIFICADO / NÃO VERIFICADO / INFERIDO; QA visual NÃO VERIFICADO.

### Task 1: Migration 0100 (status de espera) e RLS
**Files:** Create `backend/db/migrations/0100_tarefas_status_espera.sql`, `backend/test/tarefas-status-espera.e2e-spec.ts`.
- [ ] Redefinir o CHECK de `tasks.status` com os 6 atuais + 3 novos; índices parciais (`tasks_due_idx`) que excluem `completed`/`cancelled` continuam válidos (conferir); `task_events` aceita `status_changed` com os novos valores (conferir CHECKs). Rollback no cabeçalho (converter linhas com novos status para `blocked`/`in_progress`? — definir e documentar; rollback não pode perder tarefas).
- [ ] e2e (RED→GREEN): sócio cria/atualiza tarefa para cada novo status; valor fora da lista ⇒ erro; RLS e policies existentes de `tasks` inalteradas (regressões `atuacao-agenda`/tarefas, `socio-access-matrix`, `atuacao-carteira`); aplicar no banco de ensaio.

### Task 2: Backend — tarefas (transições, resumo, encaminhar) e `GET /atuacao/interacoes`
**Files:** Modify `backend/src/atuacao/dto/tarefa.dto.ts`, `tarefas.service.ts`, `tarefas.controller.ts` (e o que for necessário); Create `backend/src/atuacao/interacoes/` lista global (reaproveitando `InteracoesService`), tests `backend/test/tarefas-espera.unit-spec.ts`, `atuacao-tarefas-espera.e2e-spec.ts`, `atuacao-interacoes-lista.e2e-spec.ts`; Modify `backend/src/atuacao/painel/painel.service.ts` (+ spec) to add the categories.
- [ ] Status novos aceitos pelo DTO/serviço (enum fechado), transições livres entre abertos (documentar), `completed`/`cancelled` continuam finais; `task_events` registra `status_changed`; resumo ganha contagens por categoria de espera.
- [ ] `PATCH` de encaminhar (reusar o PATCH de assignee existente se já houver; senão `POST /atuacao/tarefas/:id/encaminhar {assignee_user_id, nota?}`): valida sócio ativo, exige `tasks.write`, evento `assigned` com antes/depois, auditoria, 404 uniforme; nota curta (≤500) opcional gravada em `task_events` sem ir para a auditoria.
- [ ] `GET /atuacao/interacoes?tenantId=&tipo=&from=&to=&page=` (`clients.read`): lista global paginada (100), ordenada por data desc, com empresa; `tenantId` de parceiro ⇒ 404; testes de RLS/permissão/filtros/paginação.
- [ ] Painel (`/atuacao/painel`): `tarefas` ganha `aguardando_cliente`, `aguardando_avaliacao`, `aguardando_execucao`, `aguardando_eficacia` (contagens) e `pendencias` passa a incluir `tipo: 'tarefa_aguardando'` com `href`; compatível com o contrato D1 (campos novos aditivos).
- [ ] Verificar: unit, tsc, build, e2e novos + regressões `atuacao-painel`, `atuacao-agenda`, `atuacao-carteira`, `socio-access-matrix`, `tenant-isolation-sweep`.

### Task 3: Frontend
**Files:** `frontend/src/app/atuacao/tarefas/**`, `frontend/src/app/atuacao/atendimentos/page.tsx` (novo), `frontend/src/app/atuacao/api.ts`, `frontend/src/app/atuacao/page.tsx` + `painel/Blocos.tsx`, `frontend/src/lib/dashboard/menu-atuacao.ts`, testes.
- [ ] Tarefas: selecionar/mostrar os novos status (rótulos pt-BR), filtro por status inclui as categorias de espera, botão "Encaminhar a…" (lista de sócios de `/equipe`, confirmação, mensagem de sucesso, histórico visível), nada de concluir automaticamente.
- [ ] `/atuacao/atendimentos`: lista global de atendimentos (filtros empresa/tipo/período, paginação, link para a ficha do cliente), estados vazio/erro/403; menu "Histórico de atendimento".
- [ ] Dashboard: bloco "Pendências por categoria" (Aguardando cliente/avaliação técnica/execução/eficácia, com contagem e link `/atuacao/tarefas?status=...`) e pendências do tipo `tarefa_aguardando`.
- [ ] TDD; verificar via helper: `vitest run src/app/atuacao src/app/admin`, `tsc --noEmit`, `eslint --max-warnings 0 src/app/atuacao src/lib/dashboard`, `npm run build`.

### Task 4: Verificação, revisão de segurança e documentação
- [ ] Unit completo (falhas conhecidas: `r2-get-object`, `tenant-context-callsites`; `employee-document-text`/`epi-ficha-pdf` só sob carga), e2e relevantes, frontend completo; revisão independente + rodada de correções + re-revisão restrita; relatório `docs/superpowers/audits/2026-10-29-painel-d2-atendimentos-tarefas.md`; roteiro de release (0100 depois de 0099); memória.
