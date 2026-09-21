# Admin — Montese Control (SP1): shell escuro + Visão Geral com dados reais

> Primeiro sub-projeto da reformulação do painel `/admin` inspirada na
> referência "Montese Control" fornecida pelo fundador. Decisões
> confirmadas em brainstorming de 2026-09-21. A especificação completa do
> fundador (`Montese_Control_Especificacao_Claude.md`, 8 fases) foi
> **decomposta**: esta entrega cobre só a interface (shell + Visão Geral) e
> o CNPJ/endereço comercial. O restante fica nos sub-projetos da seção 10.

## 1. Objetivo e escopo

O admin de hoje (`/admin/*`, 8 telas, tema claro verde, sidebar com emojis)
funciona, mas não dá uma visão única do sistema. Esta entrega traz:

1. **Shell novo** — tema escuro marinho + verde da marca, sidebar agrupada,
   topbar, drawer no mobile, logo da Montese.
2. **Visão Geral recomposta** na estrutura da referência, cada card com
   dado **real** ou um selo explícito "Em construção" (nunca número
   inventado).
3. **3 endpoints de leitura** novos no backend (financeiro, clientes
   recentes, alertas).
4. **CNPJ e endereço comercial** da Montese exibidos só onde faz sentido.
5. Correção do `PRODUCT.md` (diz que o Admin "não foi construído").

**Não é objetivo desta entrega:** RBAC além do papel `admin`, 2FA, busca
global de empresa/técnico, Control AI, Prometheus/Grafana/Loki, terminal ou
qualquer ação de risco (restart, restauração), histórico de infra,
custo de IA por modelo/agente, log de segurança, backups na tela, alertas
persistentes (reconhecer/silenciar), score de saúde numérico, alternância
de tema claro/escuro.

## 2. Decisões confirmadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Widgets da referência sem fonte de dados | **Só dado real + selo "Em construção"**; nenhum número fictício | `PRODUCT.md` (nunca apresentar roadmap como pronto) e §52 da spec do fundador (sem dados falsos junto da produção) |
| Cor de destaque | **Marinho + verde da marca**; azul só para informação, roxo só para IA | Identidade do logo; a referência já usa esses papéis semânticos |
| Escopo desta rodada | **SP1: shell + Visão Geral + CNPJ/endereço** | Spec do fundador tem 8 fases; cada uma ganha ciclo próprio (padrão da Fase 7) |
| Local do spec | `docs/specs/` (convenção atual do repo), não `docs/superpowers/specs/` | Specs recentes não usam o diretório `superpowers/` |

## 3. Correções desde o brainstorming

Ao verificar o código para escrever esta spec, sete pontos apresentados
antes mudaram. Registrados aqui para não haver divergência com o que foi
aprovado:

1. **Menu do usuário mostra "Administrador", sem nome/e-mail.** O JWT e
   `SessionUser` só têm `id`, `role`, `tenantId` (`GET /auth/me` devolve
   `req.user`). Mostrar nome exigiria endpoint novo — fora do SP1.
2. **Seletor 7/30/90 dias fica dentro do card financeiro**, não no topo.
   Só a série financeira aceita período; um seletor global enganaria.
3. **Card de IA usa as janelas fixas do endpoint existente**
   (`/api/admin/ai-usage`: total acumulado, últimos 7 dias, por
   capacidade). Não há total "do mês" hoje e não vamos alterar esse
   endpoint.
4. **`/alertas` não chama serviço externo** — a checagem de saldo do
   OpenRouter (timeout de 10 s) continua só no card de IA. Alertas são
   calculados na hora, sem persistência e sem "há X min" por item.
5. **"Último acesso" vem de `audit_log` (`login_success`)**, não de
   `users.last_login_at`: a coluna existe no schema mas **nenhum código a
   grava**, então seria sempre vazia.
6. **KPIs sem sparkline**, exceto o de IA (tokens dos últimos 7 dias).
   Não há histórico de MRR nem de clientes para desenhar tendência.
7. **"Hoje" do card de IA não é o último item de `last_7_days`.** O
   endpoint agrupa por dia no fuso da sessão do Postgres (UTC) e **não
   devolve dias sem uso**; o último item pode ser de ontem. O cliente
   preenche os 7 dias com 0 e "Hoje" é o item com a data UTC de hoje.

## 4. Shell

### 4.1 Tema (escopado a `/admin`)

Novo arquivo `frontend/src/app/admin/admin-theme.css`, importado por
`admin/layout.tsx`. Não altera `globals.css` (que tem mudanças não
commitadas do redesign do site).

Um wrapper `.admin-theme` faz duas coisas:

- **Inverte a escala `--color-brand-*`** (50→superfície escura, 100→borda,
  700→texto secundário, 900→texto principal), de modo que as 8 telas
  atuais, que usam `text-brand-900`, `border-brand-100` etc., fiquem
  legíveis sem reescrita.
- **Define tokens do painel** (valores de partida, ajustados em QA visual
  com contraste ≥ 4,5:1 para texto):

| Token | Valor inicial | Uso |
|---|---|---|
| `--admin-bg` | `#0a1220` | fundo da página |
| `--admin-sidebar` | `#08101d` | sidebar |
| `--admin-surface` | `#0f1a2e` | cards |
| `--admin-surface-2` | `#14233b` | hover, cabeçalho de tabela |
| `--admin-border` | `#1e2f4a` | bordas |
| `--admin-text` / `-muted` / `-faint` | `#e6ecf7` / `#9db0cc` / `#7b8fb0` | textos |
| destaque (verde da marca) | `#2f9e5c` (hover `#3bb56c`) | menu ativo, botões, série "Aprovado" |
| info / IA / atenção / crítico | `#3b82f6` / `#8b5cf6` / `#f59e0b` / `#ef4444` | semântica |

**Verde de marca × verde de "ok":** são quase o mesmo tom. Regra: estado
nunca é comunicado só por cor — sempre ícone + texto ("Online", "Fora do
ar").

Superfícies claras herdadas das telas antigas (`bg-white`, `bg-green-50`,
`bg-red-50`, `bg-yellow-50` em badges e alertas) ganham ajuste pontual em
cada tela; isso é uma tarefa explícita do plano, verificada por screenshot.

### 4.2 Logo

- Novo asset `frontend/public/brand/logo-icon-mark.png`: **recorte do
  ícone** (montanha + escudo) do `logo-horizontal.jpg`, fundo removido para
  transparente. Gerado uma vez por script local (`sharp` só na máquina do
  dev, **sem dependência nova no projeto**); o PNG resultante é versionado.
- Componente novo `AdminBrand.tsx`: ícone + texto em Poppins branco —
  "MONTESE" (700), "CONTROL" (espaçado, verde) e "Centro de comando da
  Montese" (pequeno, `-muted`). **Não altera `Logo.tsx`** (mudanças do site
  em andamento).
- **Fallback:** se o recorte tiver borda serrilhada visível em screenshot,
  usar o `logo-horizontal.jpg` original sobre uma placa clara arredondada,
  como o `SiteFooter` já faz.

### 4.3 Sidebar e mobile

Substitui `components/AdminSidebar.tsx` (só o `admin/layout.tsx` a usa) por
`components/admin/AdminSidebar.tsx`. Grupos da referência, **só páginas que
existem**:

| Grupo | Itens |
|---|---|
| — | Visão Geral (`/admin/overview`) |
| Financeiro | Financeiro (`/admin/financeiro`) |
| Clientes | Empresas, Técnicos, Parceiros |
| Sistema | Base normativa, Checklist SST, Auditoria |

Itens futuros **não aparecem** (evita dezenas de links mortos). Ícones SVG
inline (sem biblioteca), item ativo com fundo verde translúcido e barra à
esquerda, rodapé com "Sair". Abaixo de 1024 px vira **drawer** com botão
hambúrguer, foco preso enquanto aberto, fecha com Esc e ao navegar.

### 4.4 Topbar

- **Ctrl/Cmd+K** abre uma **paleta de navegação** entre as páginas do admin
  (combobox acessível). Não busca empresa/técnico — quando o campo aparecer
  como busca de entidades, será outro sub-projeto.
- **Pílula de estado:** "Sistema online" (verde) se Postgres, Redis e Site
  estão acessíveis em `/api/system-status`; "Degradado" (vermelho) se algum
  não está; "Sem resposta" (cinza) se a própria chamada falhar.
- **Sino:** contagem de alertas `critico` + `atencao` de `/alertas`
  (severidade `info` não conta). Clica → leva ao card de alertas da Visão
  Geral (`/admin/overview#alertas`).
- **Menu do usuário:** "Administrador" + "Sair".

`AdminStatusProvider` (contexto no shell) busca `system-status` e `alertas`
uma vez, com **polling de 60 s pausado quando a aba está oculta**
(`visibilitychange`), e os expõe à topbar e aos cards — sem chamadas
duplicadas.

### 4.5 Gráficos

SVG inline, sem biblioteca: `Sparkline`, `AreaChart` (2 séries, eixos,
tooltip acessível por foco) e `Gauge`. O frontend não tem lib de gráficos e
a spec do fundador (§52) pede não adicionar dependências desnecessárias.

## 5. Visão Geral — card a card

Cada card busca seu próprio endpoint, tem skeleton de carregamento e estado
de erro **isolado** com "Tentar novamente"; uma falha nunca derruba a
página. Topo da página: título, subtítulo, "Última atualização há Xs" e
botão **Atualizar** (recarrega todos os cards).

| Card | Fonte | Conteúdo |
|---|---|---|
| **MRR** | `GET /api/overview` → `receita_mensal_cents` | Valor em R$, rotulado "MRR" (soma dos planos com assinatura autorizada). Sem % de variação. |
| **Clientes ativos** | `overview` → `empresas_ativas` | Número + "N técnicos · N parceiros vinculados". |
| **Uso de IA** | `GET /api/admin/ai-usage` + `GET /api/ai-copilot/usage` | Principal: tokens dos últimos 7 dias (MiniMax) + sparkline dos 7 dias (dias sem uso preenchidos com 0 no cliente). Secundário: "OpenRouter: US$ X este mês" ou "OpenRouter não configurado". USD, sem conversão. Aviso de saldo baixo mantido. |
| **Saúde do sistema** | `system-status` | Lista real de Postgres, Redis, Site com ícone+texto. Linha "Score geral — em construção". |
| **Precisa da sua atenção** | `GET /api/admin/dashboard/alertas` | Lista por severidade com link para a tela relevante; estado vazio "Nenhum alerta — tudo certo". Ver seção 7. |
| **Faturamento e recebimentos** | `GET /api/admin/dashboard/financeiro?dias=` | Gráfico de área "Cobrado" × "Aprovado" com abas 7/30/90 dias; painéis Hoje / Mês / Pendente. |
| **Status dos serviços** | `system-status` | Postgres (com conexões ativas), Redis, Site. Linha de texto: "Qdrant, Docker, worker, WhatsApp e Mercado Pago: monitoramento em construção" — sem bolinha verde para o que não é medido. |
| **VPS** | `system-status` | Gauges: RAM e disco (`used_percent`), CPU como carga (`load_avg_1m / cores`, rotulado "Carga"). Rede e gráfico de 24 h: "Em construção". |
| **IA & tokens** | `admin/ai-usage` | Hoje (item de `last_7_days` com a data UTC de hoje, 0 se ausente), 7 dias (soma), total acumulado; "Por capacidade" com barras (o que existe no lugar de "Por agente"). |
| **Clientes recentes** | `GET /api/admin/dashboard/clientes-recentes` | Empresa, plano, status, MRR, último acesso. |
| **Pagamentos — Mercado Pago** | `financeiro` → `recentes` | Cliente, valor, status, data; resumo Hoje/Pendente/Mês. |
| **Logs recentes** | `GET /api/audit-log?limit=8` | Hora, recurso, ação, IP; nível derivado do `status_code` (≥ 500 ERRO, ≥ 400 AVISO, demais INFO), filtro por chip no cliente. **Não exibe `detail`** (contém e-mail em falhas de login). "Ver todos" → `/admin/auditoria`. Rotulado "Auditoria". |
| **Em construção** (3 cards) | — | "Uso de modelos e roteamento", "Segurança", "Backups": mesma moldura visual dos demais, selo "Em construção" e uma frase do que virá. Nenhum número. |

**Grid (≥ 1280 px):** coluna principal (3/4) + coluna direita (1/4), como
na referência. Direita: Saúde do sistema, Precisa da sua atenção, Uso de
modelos (em construção), Backups (em construção). Principal: 3 KPIs → financeiro → serviços · VPS ·
IA → clientes · pagamentos · logs · segurança (em construção).
**768–1279 px:** 2 colunas. **< 768 px:** 1 coluna, com *Precisa da sua
atenção* primeiro (spec do fundador §40), depois KPIs; tabelas com scroll
horizontal.

## 6. Backend — 3 endpoints

Novo módulo `admin-dashboard` (`backend/src/admin-dashboard/`), todos
`@Roles('admin')`, somente leitura, via `req.withTenantContext` (as
políticas RLS de `payment_events`, `subscriptions` etc. já liberam
`app.role = 'admin'`). Nenhuma migration.

### `GET /admin/dashboard/financeiro?dias=30`

`dias` ∈ {7, 30, 90}; valor ausente ou inválido → 30. Fuso
`America/Sao_Paulo` para "dia", "hoje" e "mês" (mês calendário).

```json
{
  "periodo_dias": 30,
  "serie": [{ "data": "2026-09-01", "cobrado_cents": 0, "aprovado_cents": 0 }],
  "hoje": { "cobrado_cents": 0, "aprovado_cents": 0, "pendente_cents": 0 },
  "mes":  { "cobrado_cents": 0, "aprovado_cents": 0, "pendente_cents": 0, "recusado_cents": 0 },
  "recentes": [{ "id": "…", "mercadopago_payment_id": "…", "amount_cents": 0,
                 "status": "approved", "occurred_at": "…", "cliente": null, "plano": null }]
}
```

- `serie` tem **um item por dia**, com zeros nos dias sem evento
  (`generate_series`).
- **cobrado** = soma de todos os `payment_events` do período;
  **aprovado** = `status = 'approved'` (o `status` gravado vem de
  `payment.status`, não do agendamento — ver `fase-7-financeiro.md`);
  **pendente** = `pending`, `in_process`, `authorized`; **recusado** =
  `rejected`, `cancelled`. Outros status (`refunded`, `charged_back`,
  `in_mediation`) contam em *cobrado* e aparecem com o status bruto na lista.
- `recentes`: 5 últimos por `occurred_at`; `cliente` = nome da empresa ou do
  técnico (mesmo join de `SubscriptionsService`); `null` quando o evento foi
  gravado sem vínculo de assinatura.

### `GET /admin/dashboard/clientes-recentes?limit=5`

`limit` padrão 5, máximo 20. Ordena por `tenants.created_at DESC`.

```json
[{ "id": "…", "nome": "…", "plano": "Premium", "status": "ativo",
   "mrr_cents": 79700, "ultimo_acesso": "2026-09-20T13:02:00Z", "created_at": "…" }]
```

- `plano` e `mrr_cents`: plano da assinatura `authorized` mais recente do
  tenant; sem assinatura → `plano` = `tenants.plan` (texto, ex.: `trial`) e
  `mrr_cents` = `null`.
- `ultimo_acesso`: `max(occurred_at)` de `audit_log` com
  `action = 'login_success'` e `actor_tenant_id = tenants.id`; `null` se
  nunca houve (a auditoria de login só cobre o período desde que passou a
  ser gravada).

### `GET /admin/dashboard/alertas`

```json
{ "gerado_em": "…",
  "contagem": { "critico": 0, "atencao": 0, "info": 0 },
  "itens": [{ "id": "disk_high", "severidade": "atencao",
              "titulo": "Disco em 84%", "detalhe": "…", "href": "/admin/overview" }] }
```

Compõe `SystemStatusService.getStatus()`, `OverviewService.getMetrics()` e
uma consulta a `payment_events`; **só banco e `os`, nenhuma chamada
externa**. A lógica é uma função pura `computeAlerts(entrada)` em
`alert-rules.ts`, com limites em constantes no mesmo arquivo.

## 7. Regras de alerta (determinísticas)

| Id | Condição | Severidade | Destino |
|---|---|---|---|
| `postgres_down` / `redis_down` / `site_down` | serviço inacessível | crítico | `/admin/overview` |
| `disk_high` | disco ≥ 90% crítico; ≥ 80% atenção | crítico / atenção | `/admin/overview` |
| `ram_high` | RAM ≥ 95% crítico; ≥ 90% atenção | crítico / atenção | `/admin/overview` |
| `payments_rejected` | ≥ 1 evento `rejected`/`cancelled` nos últimos 7 dias | atenção | `/admin/financeiro` |
| `payments_pending_stale` | ≥ 1 evento `pending`/`in_process` com mais de 3 dias | atenção | `/admin/financeiro` |
| `documents_expiring` / `epis_expiring` | `documentos_vencendo` / `epis_vencendo` > 0 | info | `/admin/empresas` |

**Por que `payments_pending_stale` é confiável:** a função vigente
`payments_record_payment_event` (migration `0017`) faz `ON CONFLICT … DO
UPDATE`, então uma transição `pending` → `approved` reenviada pelo Mercado
Pago é aplicada. Um evento que continua `pending` depois de 3 dias
realmente não recebeu atualização. Como o `DO UPDATE` também sobrescreve
`occurred_at`, a série "por dia" reflete a data do último status conhecido.

**Ressalva da regra de RAM:** `used_percent` sai de `os.freemem()`, que em
Linux pode ignorar cache de página e superestimar o uso. Antes de ligar a
regra, o plano confere o valor contra `free -h` (`MemAvailable`) na VPS. Se
não bater, `ram_high` é entregue **desligada** por constante
(`RAM_ALERT_ENABLED = false`) e o achado vai para o roadmap — sem alterar
`system-status` nesta entrega.

## 8. CNPJ e endereço comercial

**Dados fornecidos pelo fundador (2026-09-21):** CNPJ `69.203.754/0001-45`
(dígitos verificadores conferidos — válido); endereço: Avenida Marcolino
Martins Cabral, nº 2644, Bairro Aeroporto, Tubarão/SC, CEP 88705-004.

- **Fonte única:** `frontend/src/lib/company.ts` (CNPJ formatado, endereço
  estruturado e uma função que o formata em linha). **Razão social não é
  inventada** — o arquivo só a ganha quando o fundador informar.
- **CNPJ exibido em:** `SiteFooter`, `DashboardFooter` (que continua
  sendo o rodapé de empresa e técnico), telas de pagamento (`/planos`,
  `/tecnico/planos`, `/planos/assinatura-concluida`) junto ao resumo de
  valor/CTA da assinatura, e o topo de `/admin/financeiro` ("Recebedor").
  O shell do admin deixa de usar o `DashboardFooter` e ganha um rodapé
  enxuto próprio, também com o CNPJ.
- **Endereço exibido só em** `content/legal/termos.mdx` e
  `content/legal/privacidade.mdx`, na identificação do controlador — hoje o
  placeholder `[RAZÃO SOCIAL/CNPJ — PREENCHER]` (Termos linha 18, Privacidade
  linha 13). Fora do rodapé, da home e do contato. As páginas MDX consomem
  `company.ts` via `scope` do `next-mdx-remote` se o componente que as
  renderiza já o suportar; senão o texto vai literal com comentário
  apontando para o arquivo.
- **Pendências do fundador, deliberadamente não preenchidas:** a **razão
  social** (continua `[RAZÃO SOCIAL — PREENCHER]` no texto legal) e o
  **foro** da linha 103 dos Termos (`[CIDADE/ESTADO — PREENCHER]`). O foro
  é uma escolha jurídica; o endereço da sede não a determina.
- **Docs:** atualizar `PRODUCT.md` (remove "Admin não construído" e a
  proibição de endereço) e `docs/compliance/matriz-conformidade.md` (linhas
  42 e 211: CNPJ e endereço preenchidos, faltam razão social e foro).
  `docs/compliance/lgpd-compliance.md` tem mudanças não commitadas do
  fundador e **não é tocado**.

## 9. Verificação

- **Unitário** (`npm run test:unit`): `computeAlerts` — limites exatos de
  disco/RAM (79/80/89/90), serviço caído, combinações, lista vazia.
- **E2E** (`test:e2e`, padrão de `audit-log.e2e-spec.ts`): os 3 endpoints
  respondem 401 sem token e 403 para não-admin; base vazia devolve zeros,
  `serie` completa e listas vazias (não erro); `dias` inválido cai em 30;
  classificação de status; fuso America/Sao_Paulo na virada do dia;
  `clientes-recentes` com e sem assinatura e com/sem `login_success`.
- **Frontend:** `next build` (tipos e rotas) e screenshots Playwright em
  1440, 820 e 390 px das 9 telas do admin comparadas com a referência,
  incluindo estados de erro e vazio; navegação por teclado (drawer,
  paleta, abas do gráfico), foco visível e contraste ≥ 4,5:1.
- **Dados reais:** só leitura; sem override de `docker-compose` e sem
  publicar portas (regras de segurança do repositório).

## 10. Fora do escopo — próximos sub-projetos

| Sub-projeto | Conteúdo |
|---|---|
| SP2 — IA & Tokens | custo por modelo/agente; exige migration (`minimax_usage_log` não guarda o modelo) |
| SP3 — Infraestrutura | histórico de CPU/RAM (coletor periódico + tabela), rede, uptime, Qdrant/Docker |
| SP4 — Logs & Segurança | o `audit_log` já tem `login_success`/`login_failure` com IP, o que torna "tentativas" e "falhas" baratas de expor; IPs bloqueados e sessões ativas ainda não existem |
| SP5 — Backups, alertas persistentes, Control AI | status de backup (hoje só script em `ops/`), reconhecer/silenciar, agente administrativo |

## 11. Riscos

1. **Inversão de escala nas 8 telas atuais** pode deixar superfícies claras
   soltas (`bg-white`, badges `*-50`); mitigação: revisão por screenshot de
   cada tela como tarefa do plano. Se o Tailwind v4 não repassar a
   sobrescrita às utilities dentro do wrapper, cai-se para classes
   explícitas por tela.
2. **Recorte do logo** pode ficar serrilhado (fallback na seção 4.2).
3. **RAM superestimada** (seção 7).
4. **Árvore de trabalho com mudanças não commitadas** em `globals.css`,
   `Logo.tsx`, `SiteHeader`, páginas de planos etc.: os commits desta
   entrega incluem só os trechos próprios (`git add -p`); o `PRODUCT.md` é
   não versionado hoje e não entra nos commits.
5. **Produção pré-escala:** `payment_events` e `audit_log` de login podem
   estar quase vazios; todo card tem estado vazio honesto ("Nenhuma cobrança
   no período").
