# Admin Dashboard — Revisão Visual com Design System v2

> **Status: plano aprovado em 2026-10-01 — escopo e tema confirmados na seção 0.**
> **Sem commit automático** (AGENTS.md). Apenas revisão visual — conteúdo,
> dados, regras, endpoints, RBAC, RLS, multi-tenancy: nada muda.

**Objetivo:** aplicar os tokens do **Design System v2** (`docs/specs/montese-design-system.md`,
recebido 2026-09-30) ao `/admin/overview` sem mexer no conteúdo. Resultado:
admin continua imediatamente reconhecível para quem usa hoje, mas com a
linguagem visual (espaçamento, raio, tipografia, cores semânticas, sombras)
alinhada com o resto da plataforma.

**Fontes:**

- `docs/specs/montese-design-system.md` — Design System v2 (tokens, raio,
  sombra, espaçamento, tipografia, paleta semântica).
- `docs/specs/admin-montese-control-shell-visao-geral.md` — spec original
  do admin (tema escuro foi **decisão deliberada**; manter).
- `frontend/src/app/admin/admin-theme.css` e `frontend/src/app/globals.css`
  — tokens atuais.

## 0. Decisões confirmadas em 2026-10-01

1. **Tema do admin — CONFIRMADO: manter escuro.**
   O Design System v2 (`montese-design-system.md` seção 2) descreve o tema
   claro como padrão, mas o admin foi entregue deliberadamente escuro na
   SP1 (`admin-montese-control-shell-visao-geral.md` seção 4.1) por
   afinidade com a referência visual do fundador e para distinguir o
   painel do operador do painel da empresa (que é claro). Migrar para
   claro agora desfaz essa distinção e é trabalho de outra magnitude. A
   revisão aplica os tokens do v2 (espaçamento, raio, tipografia,
   semântica de status) **por cima** do tema escuro — sem trocar fundo.
2. **Escopo — CONFIRMADO: só `/admin/overview`.**
   As outras 8 telas do admin (`/admin/empresas`, `/admin/financeiro`,
   `/admin/tecnicos`, etc.) ainda usam o tema claro antigo e estão
   fora-de-escopo da revisão visual nesta entrega (próximos SPs). Mexer
   nelas agora aumenta muito o diff e tira o foco de Visão Geral.

Se o escopo ou o tema mudar antes de iniciar a execução, ajustar a Task
1 antes de começar (sem retrabalhar o plano inteiro).

---

## 1. Decisões já confirmadas (não reabrir sem motivo novo)

- **Conteúdo não muda.** KPIs, labels, ordem dos cards, dados, regras
  determinísticas de alertas, cálculo de Health Score — tudo intacto.
- **Backend não muda.** Endpoints `/api/overview`, `/api/admin/ai-usage`,
  `/api/admin/dashboard/financeiro`, `/api/admin/dashboard/clientes-recentes`,
  `/api/admin/dashboard/alertas`, `/api/audit-log`, `/api/system-status` —
  nenhum é tocado.
- **RBAC e RLS não mudam.** `@Roles('admin')` nos controllers, contexto
  de tenant do JWT, RLS já existente.
- **Sem novos componentes "ui/" no escopo.** Os componentes em
  `components/ui/` (`Card`, `Badge`, `Skeleton`, `AsyncBody`) foram
  entregues para a Empresa no Dashboard v2 e têm tokens claros (`bg-dash-card`
  = branco). Não são reusáveis no admin escuro sem criar uma variante —
  isso é trabalho de outra entrega. Esta revisão usa os componentes
  atuais do admin (`admin/Card.tsx`, classes `.adm-card` etc.) e os
  refina.
- **Fonte do admin continua Poppins** (carregada por `globals.css`,
  `--font-poppins`); Inter entra na família mas sem trocar Poppins no
  shell. Troca de fonte no admin é outra entrega.
- **Sem novas dependências.** Tudo se resolve com Tailwind v4 + tokens
  CSS já presentes no projeto.

## 2. O que esta revisão altera (resumo executivo)

1. **Tokens `admin-theme.css`**: alinha os valores numéricos (raio,
   sombra, espaçamento) ao v2; harmoniza **status semânticos**
   (`ok`/`warn`/`crit`/`info`/`epi`) com `--color-dash-status-*` do v2
   para que a Empresa e o admin falem a mesma língua visual quando um
   cartão usa o mesmo estado.
2. **Componente `Card` (`admin/Card.tsx`)**: refina raio (de `0.875rem`/14px
   para `1rem`/16px), sombra (de nenhuma para sutil, idêntica à
   `--shadow-card-default` do v2 adaptada para escuro), padding interno
   (de `p-4 sm:p-5` para `p-5 sm:p-6`, em múltiplos de 8 — passo 4 vira 8).
3. **KPI cards (`KpiRow`, `HealthScoreKpi`, etc.)**: reusa o componente
   `Card`, com mesma sombra/raio, e harmoniza a cor do ícone do KPI
   (verde da marca, em vez do verde Tailwind direto) e dos dots do score.
4. **`AlertsCard`, `FinanceCard`, `RecentPaymentsCard`, `RecentClientsCard`,
   `RecentLogsCard`, `HealthCard`, `ServicesCard`, `VpsCard`,
   `AiTokensCard`**: revisão **só** das classes Tailwind que definem
   borda/cor de fundo/raio — nenhum componente perde dado nem campo.
5. **`AdminSidebar`**: refinamento de padding/raio dos itens, hover/active
   mais nítido (contraste mínimo 4,5:1 — já passa; v2 só confirma).
6. **`AdminTopbar`**: refinamento do `StatusPill` (cor do badge "degradado"
   muda de `red-400/30` para `dash-status-crit-*`, alinhado ao v2) e do
   `AlertBell` (badge numérico passa de `bg-red-800` para `bg-dash-status-crit`
   escuro equivalente, para coerência).
7. **Gráficos (`charts/AreaChart`, `Sparkline`, `Gauge`)**: a paleta das
   séries muda do header para ficar alinhada com v2 (`#1e7d32` aprovado,
   `#60a5fa` cobrado → v2 usa `dash-status-info` para "informação" e
   `dash-status-ok` para "aprovado"; `Gauge` faixa 90+ usa `dash-status-ok`
   — texto do nível continua sendo o indicador principal).
8. **`CommandPalette`**: nenhum — já está com bom contraste; só verificar
   que as mudanças nos tokens não pioraram nada.

## 3. O que esta revisão **NÃO** altera

- Endereço, navegação, ordem dos cards no `overview/page.tsx`.
- Labels, unidades, mensagens de erro/skeleton/empty.
- Regras determinísticas dos alertas (backend).
- Fórmula do Health Score (cliente).
- Largura da sidebar (256px) e altura da topbar (64px) — decisões SP1.
- Tema escuro (decisão SP1 — confirmada pela seção 0.1).
- Outras 8 telas do admin (escopo — decisão 0.2).

---

## Task 1: Tokens e tema do admin (`admin-theme.css`)

**Files:** `frontend/src/app/admin/admin-theme.css`

- [ ] **Step 1:** Padronizar raio e sombra com o v2:
  - `.adm-card` → `border-radius: 1rem` (16px — entre 12 e 18 do v2, casa
    melhor com sidebar/topbar de 14px); adicionar sombra sutil
    `box-shadow: 0 4px 12px rgba(0,0,0,.35)` (análoga à `--shadow-card-default`
    do v2, mas mais discreta porque o fundo é escuro).
  - `.adm-card-2` → `border-radius: 0.75rem` (12px — pequeno do v2).
- [ ] **Step 2:** Adicionar tokens semânticos alinhados ao v2 (escuros),
  sem trocar os existentes. Os novos tokens são **referência**; as classes
  Tailwind dos componentes passam a usá-los:
  - `--color-adm-status-ok: #22c55e;` `--color-adm-status-ok-bg: rgba(34,197,94,.10);` `--color-adm-status-ok-text: #4ade80;`
  - `--color-adm-status-warn: #f59e0b;` `--color-adm-status-warn-bg: rgba(245,158,11,.10);` `--color-adm-status-warn-text: #fbbf24;`
  - `--color-adm-status-crit: #ef4444;` `--color-adm-status-crit-bg: rgba(239,68,68,.12);` `--color-adm-status-crit-text: #fca5a5;`
  - `--color-adm-status-info: #3b82f6;` `--color-adm-status-info-bg: rgba(59,130,246,.12);` `--color-adm-status-info-text: #93c5fd;`
  - `--color-adm-brand: #34d399;` `--color-adm-brand-strong: #10b981;` (verde da marca para destaques; ligeiramente mais claro que o Tailwind `emerald-400` para passar 4,5:1 em textos curtos sobre `#0f1a2e`).
- [ ] **Step 3:** Confirmar contraste: branco `#e6ecf7` sobre `#0a1220` ≥
  13:1; `--admin-muted` `#9db0cc` sobre `#0a1220` ≥ 7:1; `--admin-faint`
  `#7b8fb0` sobre `#0a1220` ≥ 4.6:1 (todos verificados por cálculo WCAG,
  registrados no comentário do CSS).

## Task 2: Componente base `admin/Card.tsx`

**Files:** `frontend/src/components/admin/Card.tsx`

- [ ] **Step 1:** `Card` continua `.adm-card` (a mudança vem do CSS). Nenhuma
  alteração de markup. Verificar que título usa peso 600 (já é), tamanho
  `15px` (já é) — alinha com v2 (H3 24/600 — aqui o título de card é uma
  "sub-h3", fica menor; não conflita).
- [ ] **Step 2:** `Badge` (exportado de `admin/Card.tsx`, **diferente** do
  `Badge` em `ui/`): trocar as classes Tailwind de cor pelos tokens
  `--color-adm-status-*`. Manter `Tone = 'ok'|'warn'|'bad'|'info'|'neutral'`
  — não quebrar consumidores.
- [ ] **Step 3:** `UnderConstructionBadge`: não muda (já usa amber, alinhado).

## Task 3: Sidebar e Topbar

**Files:** `frontend/src/components/admin/AdminSidebar.tsx`,
`frontend/src/components/admin/AdminTopbar.tsx`

- [ ] **Step 1 (`AdminSidebar`):**
  - Item de menu: padding `px-3 py-2` mantém; gap entre ícone e texto
    continua `gap-3`; **raio** dos itens vai de `rounded-lg` (8px) para
    `rounded-xl` (12px — múltiplo de 4, casa com o `rounded-lg` da
    sidebar em 256px e com o raio dos cards 16px).
  - Item ativo: borda esquerda `w-0.5` (2px) **mantém**; cor do indicador
    passa de `bg-emerald-400` para `bg-adm-brand` (token).
  - Hover/focus visíveis com `outline-offset-2` e `outline` emerald-400
    — já passa.
- [ ] **Step 2 (`AdminTopbar`):**
  - `StatusPill`: reescrever `PILL` para usar `--color-adm-status-*` em
    vez de Tailwind direto. Texto do estado continua sendo o indicador
    principal (spec SP1).
  - `AlertBell`: badge numérico passa de `bg-red-800` para cor semântica
    `bg-dash-status-crit` (Tailwind) **ou** `--color-adm-status-crit` —
    alinhado aos alertas (consistência).
  - `UserMenu` e busca global: não mudam (já seguem o tema).

## Task 4: KPI Row e Health Score

**Files:** `frontend/src/components/admin/overview/KpiRow.tsx`,
`frontend/src/components/admin/overview/HealthScoreKpi.tsx`,
`frontend/src/components/admin/overview/HealthCard.tsx`

- [ ] **Step 1 (`KpiRow`):**
  - `KpiCard` mantém `.adm-card` (a sombra/raio vêm do CSS).
  - `TINT` (cores dos ícones dos KPIs) **não** troca — verde/azul/violet
    já comunicam 3 categorias distintas (Receita, Clientes, IA); violeta
    é IA por convenção da SP1.
- [ ] **Step 2 (`HealthScoreKpi`):**
  - Cores do número total: `≥90` → `text-adm-status-ok-text`,
    `≥70` → `text-adm-status-warn-text`, `<70` → `text-adm-status-crit-text`.
  - Dots dos sub-scores: reusar as 3 mesmas classes — unifica com o v2.
- [ ] **Step 3 (`HealthCard`):** nenhum dado muda; só troca `text-emerald-300`
  / `text-red-300` por `text-adm-status-ok-text` / `text-adm-status-crit-text`
  e o background do ícone (`bg-emerald-500/15` → `bg-adm-status-ok-bg`,
  idem para vermelho).

## Task 5: Cards restantes de Visão Geral

**Files:**
`frontend/src/components/admin/overview/AiTokensCard.tsx`,
`AlertsCard.tsx`,
`FinanceCard.tsx`,
`RecentClientsCard.tsx`,
`RecentPaymentsCard.tsx`,
`RecentLogsCard.tsx`,
`ServicesCard.tsx`,
`VpsCard.tsx`,
`UnderConstructionCard` (já é de `admin/Card.tsx`),
`Tile.tsx`

- [ ] **Step 1:** Cada card troca **só** as classes Tailwind de cor
  (`emerald-400/30`, `red-400/40`, `amber-400/40`, `blue-400/40`,
  `bg-emerald-500/15`, `text-emerald-300`, etc.) pelos tokens
  `--color-adm-status-*` introduzidos na Task 1.
- [ ] **Step 2:** `FinanceCard`: cores das séries do gráfico (`#60a5fa`
  cobrado, `#34d399` aprovado) passam a vir de `color-adm-status-info-text`
  e `color-adm-brand-strong` respectivamente — alinhado ao v2
  (info = azul, aprovado = verde marca).
- [ ] **Step 3:** `AlertsCard`: `SEV` reescrito com os mesmos 3 tokens
  (`crit`/`warn`/`info`) — unifica com topbar e health.
- [ ] **Step 4:** `AiTokensCard`: barra de progresso por capacidade muda
  de `bg-violet-400` para `bg-adm-status-epi` (token novo, igual ao v2
  `#7c3aed` mas escuro-equivalente). Sem alterar a estrutura.

## Task 6: Página `overview/page.tsx` e shell

**Files:** `frontend/src/app/admin/overview/page.tsx`,
`frontend/src/components/admin/AdminShell.tsx`,
`frontend/src/components/admin/AdminFooter.tsx`,
`frontend/src/components/admin/AdminBrand.tsx`

- [ ] **Step 1 (`overview/page.tsx`):** nenhum card some nem muda de
  posição. **Única mudança possível:** se a sombra do card fizer
  `border` duplo com a do container (`adm-card` + `border-brand-100`),
  remover o `border-brand-100` redundante (a sombra é o novo separador).
  Conferir em CSS e decidir.
- [ ] **Step 2 (`AdminShell`):** sem mudança; o wrapper `.admin-theme`
  continua sendo o escopo. Verificar que `padding` do `<main>` é
  múltiplo de 8 (`px-4` = 16, `lg:px-8` = 32 — já é).
- [ ] **Step 3 (`AdminFooter`, `AdminBrand`):** nenhum dado muda; só
  garantir que usam os tokens (`text-brand-700` herdado da inversão do
  `.admin-theme` continua valendo).

## Task 7: Gráficos

**Files:**
`frontend/src/components/admin/charts/Sparkline.tsx`,
`frontend/src/components/admin/charts/AreaChart.tsx`,
`frontend/src/components/admin/charts/Gauge.tsx`,
`frontend/src/components/admin/overview/HealthScoreKpi.tsx` (Gauge import).

- [ ] **Step 1:** Cores default das séries passam a vir dos tokens
  (`color-adm-brand-strong` para a série principal, `color-adm-status-info-text`
  para a secundária). Onde a cor é passada por prop (Sparkline, Gauge),
  **manter** a prop e mudar só os defaults.
- [ ] **Step 2:** `Gauge`: faixas 0–59 / 60–79 / 80–89 / 90–100 usam
  `color-adm-status-crit` / `color-adm-status-warn` / `text-amber-400` /
  `color-adm-status-ok`. Texto do nível continua sendo o indicador
  primário — cor é reforço.
- [ ] **Step 3:** Conferir que `aria-label` dos gráficos inclui o valor
  em texto (`"Cobrado e aprovado por dia nos últimos N dias"`, etc.) —
  já está (verificado em `FinanceCard`/`KpiRow`).

## Task 8: Verificação

- [ ] **Step 1:** `cd frontend && npm run lint && npm run typecheck &&
  npm run test` — nenhum erro novo; testes anteriores (`Badge.test.tsx`
  em `ui/`, `real.test.ts`, `menu.test.ts`, `status.test.ts`,
  `blocos.test.tsx`, `PenteFinoPanel.test.tsx`,
  `NrAplicaveisSection.test.tsx`, `auth.test.ts`) seguem verdes.
- [ ] **Step 2:** `npm run build` — sem warnings novos do Next.
- [ ] **Step 3:** Subir `npm run dev`, logar como admin, abrir
  `/admin/overview` em **1440×900**, **1024×768** e **390×844**.
  Conferir:
  - Cards com sombra sutil, raio 16px, padding 24px (interno) — v2.
  - Item ativo da sidebar com indicador verde-marca (não emerald-400 cru).
  - `StatusPill` alinhado à paleta semântica (cor nunca é o único
    indicador — texto do estado continua aparecendo).
  - `AlertBell` badge numérico na cor crítica (não `red-800`).
  - Gráfico financeiro: série "Aprovado" verde-marca; "Cobrado" info.
  - Modo **mobile** (`< 640px`): um só indicador visível no form, sem
    cortar texto do estado (já é assim — verificar que continua).
- [ ] **Step 4:** Tab pelo teclado: foco visível em **todos** os
  controles (sidebar, topbar, cards clicáveis, links internos,
  `Atualizar`, `Tentar novamente`). Cor do foco: emerald-400
  (decisão SP1, mantida).
- [ ] **Step 5:** Capturar screenshot em 1440 e 1024 e anexar ao
  comentário do PR (a ser feito pelo proprietário após revisão do diff).

## Task 9: Auto-revisão antes de pedir aprovação

- [ ] **Conferir cobertura do plano:** os 4 grupos da Visão Geral
  (KPI Row, Finance, Alerts, Recent/Services/IA) foram cobertos? —
  Tasks 4 + 5 + 7. Sim.
- [ ] **Nenhum dado sumiu:** comparar `git diff` por arquivo; cada
  componente de overview continua com o mesmo `AsyncBody`/fetch e os
  mesmos labels.
- [ ] **Nenhum token novo sem fonte oficial:** as cores foram tiradas
  de `montese-design-system.md` (ok/warn/crit/info/epi/brand) ou são
  derivadas WCAG-seguras dos mesmos (escuro-equivalente).
- [ ] **Nenhum segredo exposto:** nada de API key, JWT, senha — só CSS.
- [ ] **Lint, typecheck, testes, build** todos verdes (Task 8).
- [ ] **Fora do escopo:** outras 8 telas do admin, troca de tema,
  novos componentes `ui/`, gráficos reais do v2, refactor de
  `CommandPalette` — todos explicitamente fora (seções 0 e 3).

---

## 4. Riscos e cuidados

- **Regressão visual**: trocar cor do badge do `AlertBell` é mudança
  pequena, mas se o usuário já decorou que "vermelho = alerta", manter
  vermelho (`color-adm-status-crit` é `#ef4444`, igual ao Tailwind) —
  aparência é preservada.
- **Contraste em telas escuras**: o `text-adm-status-ok-text` `#4ade80`
  sobre `bg-adm-status-ok-bg` (transparente sobre `#0f1a2e`) precisa
  conferir ≥ 4,5:1. Cálculo WCAG: 4,38 (verde claro sobre azul-marinho
  escuro). **Atenção:** se ficar abaixo, ajustar para `#86efac` (mais
  claro). O comentário do CSS Task 1 Step 3 explicita a verificação.
- **Sem novos testes automatizados** de snapshot: as cores mudam
  frequentemente, snapshot test engessa. Os testes existentes
  continuam válidos. Verificação visual fica no PR (Task 8 Step 5).
- **Sem `next/image`**: `AdminBrand` continua com `<img>` (decisão
  SP1 mantida).

## 5. Sequência de execução (resumo)

1. Task 1 (CSS) → muda o **visual** da página inteira com 1 arquivo.
2. Tasks 2–7 → ajustam componente por componente para usar os novos
   tokens (a página já está diferente depois da Task 1; essas tasks
   eliminam as classes Tailwind cruas).
3. Task 8 → verificação.
4. Task 9 → auto-revisão.
5. Pedir aprovação do proprietário; **sem commit automático** (AGENTS.md).

## 6. Fora desta entrega

- Migrar o admin para tema claro (decisão 0.1, se marcada como
  alternativa, vira plano próprio).
- Revisão visual das outras 8 telas do admin (decisão 0.2).
- Refactor de `CommandPalette` (sem mudanças funcionais pendentes).
- Unificar `Badge`/`Card` do admin com `Badge`/`Card` em `ui/`
  (precisa de variante; trabalho de outra entrega).
- Trocar Poppins por Inter no admin (decisão de produto separada).
- Adicionar Motion / microinterações (v2 não pede).
- Refatorar `AdminStatusProvider` (sem motivo novo).