# Plano de release — Shell novo + skin (lotes 1 e 2) + admin DS v2 — 2026-10-04

> **Status: NADA EXECUTADO.** Este documento só planeja. Cada etapa marcada 🔒 muda produção e exige
> autorização explícita do proprietário (AGENTS.md, seção Infraestrutura). Modelo: `release-conformidade-por-nr-2026-10-01.md`.
> Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

## 0. Atualização (2026-10-04, noite) — candidata a aplicar: `shell3`

O release agora tem **3 camadas**, todas commitadas na `feat/conformidade-por-nr` (sem push):
`a22d36f` shell novo na área da empresa · `549bc5a` skin dos lotes 1 e 2 (18 páginas) · `0969bb7` revisão visual do
`/admin/overview` com o DS v2 (tema escuro mantido; só a Visão Geral).

A candidata a aplicar é **`montese-frontend:candidate-shell3-20261004`** (`b135d2ab6085`): build do commit `0969bb7`
em worktree limpa (`/opt/montese-release-shell`, 0 arquivos sujos), `next build` 62/62, 0 erros no log.
Boot isolado (VERIFICADO): `/login`, `/empresa/documentos`, `/empresa/cipa`, `/empresa/cipa/eleicao`, `/dashboard-v2`,
`/admin/overview` = 200; `/empresa/dashboard` = 307 → `/dashboard-v2`; o CSS da imagem contém os tokens do admin e o `.skin-dash`.
Alternativas mais conservadoras (descem camadas): `candidate-shell2-…` (sem admin) e `candidate-shell-…` (só o shell).
Onde o texto abaixo disser `candidate-shell-…` ou `candidate-shell2-…`, usar `candidate-shell3-…`.

**Admin (NÃO VERIFICADO com dados reais):** testado só com API simulada em 1440/1024/390 (cards 16px, sombra, indicador
`#34d399`, badge `#dc2626`, foco por teclado, 0 erros). O card "Saúde do Sistema" vaza a borda em 1280–1440px — já vazava
antes (coluna estreita de KPIs; não corrigido, exige mudar layout). Conferir `/admin/overview` com login real após o deploy.

## 0.1 Camada 4 — shell do técnico e skin do onboarding (2026-10-05) — COMMITADA (sem push, sem deploy)

Spec: `docs/superpowers/specs/2026-10-05-dashboard-novo-tecnico-design.md` · plano: `docs/superpowers/plans/2026-10-05-dashboard-novo-tecnico.md`.
Só frontend; sem migration, backend, Docker ou Nginx. **Commitado na branch `feat/conformidade-por-nr` (2026-10-06), sem push e sem aplicar em produção**; ao aplicar, a árvore mistura outras frentes
(PDF de auditoria, `0063`, `PenteFinoPanel`) — commitar **só** os arquivos abaixo e, se for aplicar, buildar de worktree limpa.

Arquivos (`frontend/src`): `lib/dashboard/menu-tecnico.ts` (+ teste), `components/dashboard/TecnicoShell.tsx`,
`components/dashboard/DashboardSidebar.tsx` e `DashboardHeader.tsx` (props `items`/`extraItems`/`extraLabel` e `iaHref`, defaults = empresa),
`components/dashboard/__tests__/tecnico-shell.test.tsx`, `app/tecnico/layout.tsx` (+ `__tests__/layout.test.tsx`),
`app/empresa/onboarding/page.tsx` (+ `__tests__/onboarding-skin.test.tsx`); **removido** `components/TecnicoSidebar.tsx` (0 referências).

- **VERIFICADO (2026-10-05):** `vitest` 152/152 (16 arquivos, rodado de novo após a correção da revisão final; os testes antigos de shell/menu/skin passaram sem edição); `tsc --noEmit` sem erros;
  `next build` compilou todas as rotas. eslint nos diretórios tocados: 0 erros e 1 aviso preexistente em `empresa/onboarding/MatrizForm.tsx:163`
  (`<img>`, arquivo não tocado) — com `--max-warnings=0` o comando falha por ele.
- **VERIFICADO (Playwright, API simulada, sessão falsa, build local):** 12 rotas × desktop 1440 e mobile 390 = 24 casos (10 do técnico, `/empresa/onboarding`
  e 1 com papel parceiro): sidebar nova sem emoji nem `bg-brand-900`, item ativo correto (subrotas de `/tecnico/empresas/…` marcam "Suas empresas"),
  sem botão "IA SST", rótulo Técnico/Parceiro, 0 erros de JS, sem overflow da página, gaveta mobile abre. Servidor local encerrado.
- **Defeitos baixos (não corrigidos):** botão do WhatsApp cobre o fim do número no rodapé do desktop (global); emoji 🔎 no `h1` de `/tecnico/consulta-ca`;
  rótulo Técnico/Parceiro some no header mobile (só avatar); Escape não fecha a gaveta mobile; input de logo do onboarding sem estilo.
- **NÃO VERIFICADO:** dados reais/listas cheias, assinatura inativa dentro do shell, submissões de formulário, navegação por teclado, viewports intermediários, login real de técnico.
- **Revisão final (2026-10-05):** aprovada. Correção aplicada: o header do técnico não mostra busca nem sino (prop `comBuscaENotificacoes`, default `true` = empresa) por serem decorativos (AGENTS.md). Verificado depois dela (2026-10-05): `next build` recompilado e QA no Playwright (API simulada) em 1440 e 390 — técnico e parceiro sem busca, sino nem "IA SST", rótulo e avatar à direita, gaveta mobile abre; empresa (`/dashboard-v2`, `/empresa/documentos`) com busca (desktop), sino e "IA SST" como antes; 0 erros de JS, sem overflow. Não verificado: dados reais, tema escuro, outros breakpoints, teclado.
- **Pendências registradas:** pesquisa e sino do header da empresa continuam decorativos; `empresa/pente-fino` sem skin (WIP alheio no `PenteFinoPanel`); nome real do técnico no header exige fonte no backend (hoje só o papel).
- **Rollback:** frontend apenas — mesma rotina das camadas anteriores (tag `pre-*` da imagem anterior).

## 0.2 Camada 5 — admin DS v2, lote 1 (2026-10-05) — COMMITADA (sem push, sem deploy)

Spec: `docs/superpowers/specs/2026-10-05-admin-paginas-ds-v2-design.md` · plano: `docs/superpowers/plans/2026-10-05-admin-paginas-ds-v2-lote1.md`.
Só frontend; tema escuro mantido; sem migration, backend, Docker ou Nginx. **Commitado na branch `feat/conformidade-por-nr` (2026-10-06), sem push e sem aplicar em produção**: ao aplicar, usar build de worktree limpa.

Arquivos (`frontend/src`): `app/admin/admin-theme.css` (tokens `--admin-field-border`/`--admin-on-accent` e classes `.adm-input/.adm-btn/.adm-btn-primary/.adm-table/.adm-link`),
`app/admin/__tests__/admin-theme-contraste.test.ts` (só acréscimo), `components/admin/PageHeader.tsx`, `components/admin/status-tone.ts` (+ teste),
`app/admin/{empresas,auditoria,financeiro}/page.tsx` (+ testes de render e `__tests__/convencoes-paginas.test.ts`).

- **VERIFICADO (2026-10-05):** `vitest` 189/189 (21 arquivos; nenhum teste existente editado, exceto o acréscimo ao final do teste de contraste); `tsc --noEmit` sem erros; `next build` compilou.
  eslint em `src/app/admin` + `src/components/admin`: 0 erros e 1 aviso preexistente em `components/admin/AdminBrand.tsx:13` (`<img>`, arquivo não tocado) — com `--max-warnings=0` o comando falha por ele.
- **VERIFICADO (Playwright, API simulada, sessão falsa de admin, build local, 1440 e 390):** `/admin/empresas`, `/admin/auditoria`, `/admin/financeiro` OK, `/admin/overview` (controle) sem mudança; 0 erros de JS, sem overflow da página,
  tabelas rolam dentro do cartão no mobile, Badges (auditoria 2xx verde / 4xx amarelo / 5xx vermelho; assinatura authorized verde / paused amarelo / cancelled neutro), foco visível por teclado,
  filtro envia `resource_type`, edição de preço envia `PATCH {"price_cents":1050}`, "Cancelar" mostra a confirmação (não confirmada). Servidor local encerrado.
- **Desvios aceitos:** status de assinatura perde os parênteses ao virar `Badge` (texto igual); status de empresa fica `neutral` (valores não confirmados); `empresas` e `auditoria` usam `div.adm-card` sem título novo.
- **Defeitos baixos (não deste lote):** botão do WhatsApp sobrepõe conteúdo no mobile; KPI "Receita Total" do overview cortado em 1440 com o mock do QA.
- **NÃO VERIFICADO:** dados reais e listas longas, hover das linhas, estados de erro/vazio, paginação "Carregar mais", tablet, contraste medido por ferramenta (só os tokens têm teste), login real de admin.
- **Pendências:** lote 2 (`tecnicos`, `parceiros`, `normativa`, `checklist-sst`) e lote 3 (`empresas/[id]`) com plano próprio; nos próximos testes de página usar `useRouter` **estável** (`vi.hoisted`), pois as páginas têm `[router]` nas deps do efeito e um mock novo a cada render gera loop;
  o teste de convenções só enxerga `className` literal/template (ternários e `cn()` passam batido); `text-red-600` e `text-brand-*` nas células seguem como tokens remapeados, polimento futuro; testes de limite HTTP (300/399/400/499) em `status-tone`.

## 0.3 Camada 6 — admin DS v2, lote 2 (2026-10-05) — COMMITADA (sem push, sem deploy)

Spec: `docs/superpowers/specs/2026-10-05-admin-paginas-ds-v2-design.md` · plano: `docs/superpowers/plans/2026-10-05-admin-paginas-ds-v2-lote2.md`.
Só frontend; tema escuro mantido; sem migration, backend, Docker ou Nginx. **Commitado na branch `feat/conformidade-por-nr` (2026-10-06), sem push e sem aplicar em produção**: ao aplicar, usar build de worktree limpa. Depende da camada 5 (lote 1: primitivos `.adm-*`, `AdminPageHeader`, `status-tone`).

Arquivos (`frontend/src`): `app/admin/admin-theme.css` (`.adm-btn-danger`), `app/admin/__tests__/admin-theme-contraste.test.ts` (acréscimo) e `convencoes-paginas.test.ts` (reescrito: regras de padding/fonte/cor/variantes + autoteste),
`app/admin/{tecnicos,parceiros,normativa,checklist-sst}/page.tsx` + `app/admin/__tests__/{tecnicos,parceiros,normativa,checklist-sst}-page.test.tsx`.

- **VERIFICADO (2026-10-05):** `vitest` 242/242 (25 arquivos; rodado de novo após a correção do QA); `tsc --noEmit` sem erros; `next build` compilou; eslint em `src/app/admin` + `src/components/admin`: 0 erros e 1 aviso preexistente em `components/admin/AdminBrand.tsx:13` (`<img>`, não tocado).
  Cada página tem teste de render que prova o MESMO corpo/URL de requisição de antes: técnicos (POST criar; 1 POST `/assign` por empresa, em ordem), parceiros (POST criar; POST `/assign`), normativa (POST fonte; `/approve`; `/reject {reason}`; `/reindex`), checklist (POST com `infraction_index: null`; PATCH; DELETE com confirmação; `?nr_code=`).
- **VERIFICADO (Playwright, API simulada, sessão falsa de admin, build local, 1440 e 390):** as 4 páginas + `/admin/empresas` e `/admin/overview` (controle) sem erro de JS; fluxos acima conferidos no navegador; Tab com foco visível; `outline-adm-brand` do painel "Revisar versão" aparece (2 px verde; o fallback `outline-emerald-400` não foi necessário); "Rejeitar" esmaecido sem motivo.
  **Defeitos achados e corrigidos nesta camada:** (médio) a 390 px o botão "Vincular a empresa" quebrava em 3 linhas e causava overflow de página (399 > 390) em `/admin/tecnicos` — corrigido (`shrink-0 whitespace-nowrap`, linha com `flex-wrap`, texto `min-w-0 break-words`); medido de novo: `scrollWidth` 390 = largura, botão em 1 linha; (baixo) "Editar" no checklist rolava com o título do cartão atrás do header fixo — corrigido (`scroll-mt-20`; título a 101 px, header até 64 px).
- **Desvios aceitos:** botões perdem `px-*`/`text-xs` (o `.adm-btn` padroniza); links de ação sublinham só no hover; títulos de `normativa` e `checklist-sst` de `text-2xl` para `text-xl`; status de técnico/parceiro como `Badge` `neutral` (texto igual); `div` com `ref` envolvendo o `Card` no checklist (o `Card` não repassa `ref`; `useRef<HTMLDivElement>`); destaque do painel de revisão por `outline` (o `.adm-card` vence `border-*`).
- **NÃO VERIFICADO:** dados reais e login real de admin, listas longas, contraste medido por ferramenta (só os tokens têm teste), hover, tablet, estados de erro de cada formulário, confirmação real do `Excluir` (aceita automaticamente no QA).
- **Atenção ao commitar (camadas 5 e 6 se misturam):** `app/admin/admin-theme.css`, `app/admin/__tests__/admin-theme-contraste.test.ts` e `app/admin/__tests__/convencoes-paginas.test.ts` têm mudanças das duas camadas; o lote 2 **não funciona sem** o lote 1 (`PageHeader.tsx`, `status-tone.ts`, primitivos `.adm-*`). Commitar as camadas 5 e 6 juntas (ou separar com `git add -p`), nunca só a 6; e nunca `git add -A` (WIP alheio na árvore).
- **Defeito do plano (corrigido na execução):** os blocos de `return` de `normativa` e `checklist-sst` vinham sem a `}` que fecha o componente.
- **Pendências:** lote 3 (`empresas/[id]`) com plano próprio e testes de `/status` da assinatura; campos de `normativa` só têm `placeholder`, sem `label` (anterior a este lote; mudar exige decisão sobre texto); `classNames()` do teste de convenções só enxerga `className` literal/template; botão flutuante do WhatsApp cobre o canto inferior direito (global, preexistente).

## 0.4 Camada 7 — admin DS v2, lote 3 (2026-10-06) — COMMITADA (sem push, sem deploy)

Spec: `docs/superpowers/specs/2026-10-05-admin-paginas-ds-v2-design.md` · plano: `docs/superpowers/plans/2026-10-05-admin-paginas-ds-v2-lote3.md`.
Só frontend; tema escuro mantido; sem migration, backend, Docker ou Nginx. **Commitado na branch `feat/conformidade-por-nr` (2026-10-06), sem push e sem aplicar em produção.** Depende das camadas 5 e 6 (primitivos `.adm-*`, `AdminPageHeader`, `status-tone`, teste de convenções): commitar as três juntas ou separar com `git add -p`; nunca `git add -A` (WIP alheio); build de worktree limpa.

Arquivos (`frontend/src`): `app/admin/empresas/[id]/page.tsx`, `app/admin/__tests__/empresas-detalhe-page.test.tsx` (novo), `app/admin/__tests__/convencoes-paginas.test.ts` (só a lista `PAGINAS`), `app/admin/__tests__/financeiro-page.test.tsx` (acréscimo: ações de status da assinatura).

- **VERIFICADO (2026-10-06):** `vitest` 256/256 (26 arquivos); `tsc --noEmit` sem erros; `next build` compilou; eslint em `src/app/admin` + `src/components/admin`: 0 erros e 1 aviso preexistente em `components/admin/AdminBrand.tsx:13` (`<img>`, não tocado).
  Testes de render de `/admin/empresas/[id]`: nome como `h2`, 5 cartões, 4 tabelas, Badges (assinatura verde, inspeção neutro, HTTP 403 amarelo), `PATCH /status` com `{status:"paused"}` e `{status:"cancelled"}`, confirmação "Cancelar de vez?" (o "Não" não faz requisição), histórico de cobranças, 404. Pendência dos lotes 1–2 fechada: o mesmo fluxo de status (Pausar, Reativar, Cancelar, erro do PATCH) agora tem teste em `/admin/financeiro`.
- **VERIFICADO (Playwright, API simulada, sessão falsa de admin, build local, 1440 e 390, nomes longos):** `/admin/empresas/<id>` OK; `/admin/empresas` e `/admin/financeiro` (controle) sem erro; 0 erros de JS; `scrollWidth` = largura (também com o histórico aberto); tabelas de Documentos, EPIs e Auditoria rolam dentro do cartão no mobile; foco por teclado visível; Pausar → PATCH + botão vira Reativar; Cancelar → confirmação → PATCH; histórico alterna. Servidor local encerrado; produção (`cwd=/app`) intacta.
- **Defeito baixo (não corrigido):** no mobile o cartão de dados cadastrais mantém 2 colunas iguais (como no original) e valores longos quebram no meio da palavra (~6 linhas), sem overflow (no QA o "e-mail" veio do mock: a página só tem `contact_name`/`contact_phone`; o `break-words` evita overflow de página). Sugestão: rótulo acima do valor em telas estreitas (`grid-cols-1 sm:grid-cols-2`).
- **Desvios aceitos:** seções `h2` viram `Card` (`h3`) e o nome da empresa continua `h2` via `AdminPageHeader`; status da empresa e da inspeção como `Badge` `neutral`; status da assinatura sem parênteses; HTTP da auditoria como `Badge` só com o código; ações em verde viram `.adm-link`.
- **NÃO VERIFICADO:** dados reais e login real de admin; teclado nas ações em desktop; Pausar/Cancelar/histórico no mobile; estados de erro/vazio no navegador (cobertos só por teste); contraste medido por ferramenta; tablet.
- **Marco:** com esta camada todas as páginas do admin usam os primitivos DS v2, exceto `/admin/overview` (componentes próprios, feito em 2026-10-04).
- **Pendências:** campos de `normativa` só com `placeholder`, sem `label`; `li` com nome de arquivo longo em `normativa`/`checklist-sst` sem `flex-wrap`/`min-w-0`; "Excluir" do checklist e "Cancelar"/"Sim, cancelar" das assinaturas (`financeiro` e `empresas/[id]`) fora do `.adm-link` (continuam `text-red-600`, legíveis); `empresa/pente-fino` sem skin (WIP alheio no `PenteFinoPanel`); botão flutuante do WhatsApp cobre o canto inferior direito (global, preexistente).

## 1. O que é

Só frontend. Todas as páginas `/empresa/*` passam a usar a sidebar, o header e o rodapé do dashboard novo
(`EmpresaShell`); antes, só `/dashboard-v2` usava. Sem migration, sem backend, sem variável de ambiente nova,
sem mudança em Docker/compose/Nginx (INFERIDO: só `frontend/src` mudou — conferir com `git diff` no commit).

Arquivos (todos em `frontend/src`): `components/dashboard/EmpresaShell.tsx` (novo), `DashboardSidebar.tsx`,
`DashboardHeader.tsx`, `lib/dashboard/menu.ts`, `app/empresa/layout.tsx`, `app/dashboard-v2/layout.tsx`,
`app/dashboard-v2/page.tsx`, testes (`menu.test.ts`, `shell.test.tsx`); remove `components/EmpresaSidebar.tsx`.

## 2. Verificado em 2026-10-04

- **VERIFICADO:** `tsc --noEmit` sem erros; `vitest` 105/105; eslint dos diretórios tocados sem avisos; `next build` compilou.
- **VERIFICADO (Playwright, API simulada, sessão falsa, build de produção local na porta 3100):** 20 rotas × desktop e
  mobile = 40/40 com sidebar e header novos, sem sidebar antiga, 0 erros de JS, sem overflow horizontal da página,
  item certo ativo, menu mobile abre.
- **NÃO VERIFICADO:** dados reais em cada página, logo real da empresa no header, fluxo "Sair" completo, comportamento
  com assinatura inativa (`SubscriptionNotice` dentro do shell). Conferir no navegador após o release (seção 5).

## 3. Pré-requisitos 🔒

1. **Commit feito pelo proprietário** (AGENTS.md). A árvore atual mistura outras frentes (PDF de auditoria, `0063`,
   `admin-theme.css`, `PenteFinoPanel`). Commitar **só** os arquivos da seção 1.
2. **Build de árvore limpa do commit, nunca do working tree** (mesmo padrão dos releases anteriores).
3. **Atenção à herança:** a branch `feat/conformidade-por-nr` já contém o frontend da NR (`6b01a39`). Buildar este
   commit leva o frontend da NR junto. INFERIDO: seguro sem a migration `0064` (o cartão vira "Dado indisponível";
   o bloco do técnico não aparece — ver doc da NR, seção 1), **mas** o menu já mostra "Relatório de visita técnica".
   Se o proprietário quiser separar, aplicar o shell numa branch a partir de `main`.
4. **Tag de rollback antes de tudo** — as tags `pre-*` e `candidate-*` dos releases anteriores não existem mais
   (VERIFICADO em 2026-10-04: `docker images -a` só tem `latest`).

## 4. Etapas 🔒

0. Rollback primeiro: `docker tag montese-frontend:latest montese-frontend:pre-shell-20261004`
1. Worktree limpa do commit: `git worktree add /opt/montese-release-shell <commit>`
2. Build candidata: `docker build -t montese-frontend:candidate-shell3-20261004 /opt/montese-release-shell/frontend`
   (usar `GIT_COMMIT` como em `ops/build-with-commit.sh` se o frontend o consumir — NÃO VERIFICADO).
3. Boot isolado da candidata (rede interna, sem publicar porta) e `GET /login` = 200.
4. Aplicar: `docker tag montese-frontend:candidate-shell3-20261004 montese-frontend:latest` e
   `docker compose up -d --no-deps frontend` (sem override; ver nota de segurança do compose).

**Rollback:** `docker tag montese-frontend:pre-shell-20261004 montese-frontend:latest` +
`docker compose up -d --no-deps frontend` (~segundos de indisponibilidade só do frontend).

## 5. Verificação pós-release (navegador, login real do proprietário)

- Admin: abrir `/admin/overview` (login de admin) e conferir cards, sidebar, `StatusPill`, sino de alertas e gráfico financeiro.
- Percorrer todos os itens do menu (principal + "Mais ferramentas"): nenhum volta ao visual antigo.
- CIPA: Central, Reuniões, Membros, Eleição, Capacitação (as duas últimas só pela sidebar).
- Conta de empresa com logo enviado: aparece no header. Conta sem plano ativo: aviso de assinatura visível.
- "Sair" encerra a sessão. Menu mobile abre e fecha. Rodapé e botão do WhatsApp não cobrem conteúdo essencial.
- `docker logs montese_frontend` sem erros nos 5 min seguintes.

## 6. Limitações conhecidas (fora deste release)

- Conteúdo interno das páginas continua no estilo antigo (restilização por lotes, fase futura).
- Em celular, tabelas/selects largos de Brigada, Consulta de CA, Equip. contra incêndio e Capacitação da CIPA rolam
  na horizontal dentro da área principal (contido pelo shell; não arrasta a página).
- Rótulos longos na sidebar (ex.: "Relatório de visita técnica") ocupam a linha toda de 42 px — olhar no navegador.
