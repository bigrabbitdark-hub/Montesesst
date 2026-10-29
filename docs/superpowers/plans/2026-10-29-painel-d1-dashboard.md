# Painel do Danilo — D1 (dashboard com dados reais, vencimentos da carteira e menu) — plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a tela inicial `/atuacao` responde "o que preciso fazer hoje": KPIs reais com link para a lista já filtrada, agenda do dia, pendências prioritárias e vencimentos de documentos da carteira Montese (vencidos e 7/15/30 dias), sem inventar números.
**Architecture:** um endpoint agregador somente leitura `GET /atuacao/painel` (reusa serviços de tarefas/agenda/documentos/clientes, cada bloco só aparece com a permissão correspondente) e `GET /atuacao/vencimentos` (lista da carteira, filtrável). Sem migration, sem permissão nova. Frontend: reaproveita `components/dashboard/*`.
**Spec/origem:** pedido do proprietário (painel do Danilo, §4 e §8) + auditoria 2026-10-29. Évelyn é sócia (mesmo papel do Danilo).

## Global Constraints
- Base: worktree `/opt/montese-work/painel-release` (commits 2e327a3 = Z+A, 2e3ec5f = B1). **Sem commit/push/reset/stash/deploy por agentes**; nada em produção; não ler `.env`/`ensaio.env`; proibido `/opt/Montese/run-backend-tests.sh`; não tocar `/opt/Montese`.
- **Sem migration e sem permissão nova** (lista fechada de 18). Somente leitura: nenhum POST/PATCH novo.
- Padrões do A/B1: `@Roles('socio')` (admin não usa este painel), `@RequirePermission(...)` por bloco, `req.withTenantContext`, `is_montese_tenant` via RLS do sócio (Z) — empresa de parceiro nunca aparece; auditoria de leitura só se o padrão do módulo (`finance.viewed`) exigir — aqui não, a menos que o módulo atuação já audite leituras de documentos (seguir `empresas.service`).
- **Nenhum dado inventado**: contagens vêm de consultas; bloco sem permissão ⇒ `null` e a tela diz "Sem permissão para este bloco"; sem dados ⇒ estado vazio explícito.
- Documentos: usar só colunas existentes (`documents.expires_at`, `valid_from`, `category`, `tenant_id`, `status`…) respeitando a RLS (categoria `cadastro_funcionarios` fica oculta ao sócio); **não** expor nome de arquivo com dados pessoais além do já exibido em `atuacao/empresas/:tenantId/documentos`.
- Testes backend: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão>`; `npx tsc --noEmit -p tsconfig.json`; `npm run build`. E2E SOMENTE: `H=/tmp/claude-0/-opt-Montese/bac8b5c8-7575-4e72-a1f2-42d204d1d1d3/scratchpad; $H/reset-redis.sh >/dev/null && $H/run-e2e-cand.sh <padrão> > $H/<log> 2>&1`, uma suíte por vez. Frontend SOMENTE via `$H/sync-f7-front.sh <comando>`.
- pt-BR; VERIFICADO / NÃO VERIFICADO / INFERIDO; sem "assinatura digital"/"ICP-Brasil"; QA visual NÃO VERIFICADO.

## Contrato (fixo; backend e frontend devem segui-lo)
`GET /atuacao/painel` (`socio`; `clients.read` obrigatório; demais blocos por permissão):
```
{ gerado_em: ISO,
  empresas:   { acessiveis: n } | null,                                  // clients.read
  tarefas:    { abertas, vencidas, hoje, bloqueadas } | null,           // tasks.read (reusar /tarefas/resumo)
  agenda:     { hoje: Evento[<=10], proximos_7_dias: n } | null,        // appointments.manage ou a permissão que o GET /agenda exige hoje
  documentos: { vencidos, vence_7, vence_15, vence_30, aguardando_acao } | null, // empresas.read (vencimentos) e documents.read (aguardando_acao; reusar contagem do fluxo 0096)
  pendencias: Pendencia[<=20] }                                          // união ordenada por urgência dos blocos permitidos
Evento    = { id, titulo, tipo, data, hora|null, tenant_id, empresa, status }
Pendencia = { tipo: 'tarefa_atrasada'|'documento_vencido'|'documento_vencendo'|'documento_aguardando',
              tenant_id, empresa, descricao, prazo|null, prioridade|null, href }   // href relativo do app (/atuacao/...), nunca URL externa
```
`GET /atuacao/vencimentos?faixa=vencidos|7|15|30&tenantId=&page=` (`empresas.read` + `clients.read`): `{ itens: [{ documento_id, tenant_id, empresa, titulo, categoria, expires_at, dias, href }], total }` (LIMIT 100/página; ordenado por `expires_at`); `dias` = dias até o vencimento (negativo = vencido). `tenantId` ⇒ validar (Montese ⇒ senão 404).

### Task 1: Backend — `/atuacao/painel` e `/atuacao/vencimentos`
**Files:** Create `backend/src/atuacao/painel/painel.controller.ts`, `painel.service.ts`, `dto/painel.dto.ts`; register in `atuacao.module.ts`; tests `backend/test/painel-service.unit-spec.ts`, `backend/test/atuacao-painel.e2e-spec.ts`.
- [ ] Investigar e REUSAR os serviços existentes (`TarefasService.resumo`, `AgendaService`, `AtuacaoService.resumo`, `EmpresasService.vencimentos`, contagem de documentos aguardando ação do fluxo 0096) em vez de reescrever consultas; consultas novas só para a carteira (vencimentos de todas as empresas Montese). Cada bloco falha isolado (um bloco com erro não derruba os demais: devolve `null` + log, sem vazar detalhe) — decidir e testar.
- [ ] Testes (RED→GREEN): permissões por bloco (sócio só com `clients.read` recebe os demais `null`); parceiro nunca aparece; faixas de vencimento corretas nas bordas (hoje, 7, 8, 15, 30, 31 dias, vencido ontem) com datas fixas de teste; documento sem `expires_at` não conta; categoria `cadastro_funcionarios` não aparece; ordenação/`pendencias` ≤20 e determinística; `href` sempre relativo e válido; `tenantId` de parceiro ⇒ 404; empresa/técnico/parceiro ⇒ 403; desempenho: sem N+1 (número de queries por bloco constante — assert no unit).
- [ ] Verificar: unit, tsc, build, e2e `atuacao-painel`; regressões `atuacao-empresas`, `socio-access-matrix`, `tenant-isolation-sweep`.

### Task 2: Frontend — dashboard, vencimentos e menu
**Files:** `frontend/src/app/atuacao/page.tsx` (reescrever com os blocos reais), `frontend/src/app/atuacao/vencimentos/page.tsx`, componentes em `frontend/src/app/atuacao/painel/*`, tipos em `frontend/src/app/atuacao/api.ts`, `frontend/src/lib/dashboard/menu-atuacao.ts`, testes `frontend/src/app/atuacao/__tests__/painel.test.tsx`, `vencimentos.test.tsx`.
- [ ] Reaproveitar `components/dashboard/{PageHeader,KpiCard,PendenciasCard,VencimentosCard,ProximosEventosCard}`, `AsyncBody`, `AtuacaoShell`. KPIs (empresas acessíveis, tarefas abertas/vencidas/hoje/bloqueadas, documentos vencidos e 7/15/30 dias, documentos aguardando ação, compromissos hoje) — cada KPI é link: tarefas ⇒ `/atuacao/tarefas?vencidas=true` etc. (conferir os parâmetros que a tela de tarefas já aceita), documentos ⇒ `/atuacao/vencimentos?faixa=...`, agenda ⇒ `/atuacao/agenda`.
- [ ] Seções "Minha agenda" (hoje; vazio explícito) e "Pendências prioritárias" (lista com empresa, descrição, prioridade, prazo, link direto). Bloco `null` ⇒ cartão "Sem permissão para este bloco (peça ao administrador)". Erro de um bloco não apaga os outros. Nada de contagem fixa; 401 ⇒ /login; 403/404/erro com mensagem do servidor; carregamento/vazio/erro; stale-response guard.
- [ ] Página `/atuacao/vencimentos` (faixas, filtro por empresa, paginação, link para o documento da empresa).
- [ ] Menu: adicionar "Vencimentos" (rota nova). Itens do menu proposto sem tela (Visitas técnicas, Funcionários, EPI, Treinamentos, Ordens de Serviço, Histórico de atendimento) **não** entram como links mortos: ficam fora até existirem (funcionários e EPI continuam nas abas da ficha da empresa). Registrar isso no relatório.
- [ ] TDD; verificar via helper: `vitest run src/app/atuacao`, `tsc --noEmit`, `eslint --max-warnings 0 src/app/atuacao src/lib/dashboard`, `npm run build`.

### Task 3: Verificação, revisão de segurança e documentação
- [ ] Unit completo (falhas conhecidas: `r2-get-object`, `tenant-context-callsites`), e2e relevantes um a um, frontend completo; revisão independente (`montese-seguranca`) + uma rodada de correções + re-revisão restrita; relatório `docs/superpowers/audits/2026-10-29-painel-d1-dashboard.md`; atualizar memória. **Parar**: commit é do proprietário (já autorizado só para o B1).
