# Fase 16 — Reconhecimento: Empresa Destaque

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-03.
> Quarta frente fora do núcleo da CIPA (`docs/specs/fase-12-central-cipa-nucleo.md`
> §1: "frentes futuras, na ordem acordada" — esta é a quarta da lista,
> logo depois da Fase 15, Capacitação, já em produção). **Diferente
> das três frentes anteriores, esta NÃO é uma funcionalidade da
> Central da CIPA** — o brainstorming revelou que "Troféu Montese" e
> "Empresa Destaque" reconhecem a empresa cliente como um todo, pela
> conformidade geral de documentos, não a atuação da CIPA
> especificamente. Fica fora de `/empresa/cipa/*`, dentro do dashboard
> principal já existente.

## 1. Objetivo e escopo

O produto já calcula um score de conformidade (0-100%) a partir dos
documentos da empresa (vencidos vs. em dia), exibido hoje no
dashboard da empresa e na lista de clientes do técnico. Esta fase
adiciona um reconhecimento visual — "Empresa Destaque" — pra quem
atinge o score máximo, sem inventar uma métrica nova nem um sistema de
pontuação paralelo.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **"Troféu Montese" e "Empresa Destaque" são o mesmo reconhecimento,
  não dois programas ou níveis distintos.** "Empresa Destaque" é o
  texto exibido na tela; "Troféu Montese" é o conceito/ícone visual do
  selo (🏆). Não existe uma segunda etapa/nível além deste selo único
  nesta fase.
- **Reconhece a empresa, não a CIPA.** Baseado no score de
  conformidade de documentos já calculado por `DocumentsService.getCompliance`
  (`backend/src/documents/documents.service.ts`) — o mesmo score que
  já aparece hoje no dashboard da empresa e na carteira do técnico.
  Não combina dados de outros módulos (CIPA, EPI, planos de ação) numa
  métrica nova.
- **Critério: `score === 100`, não `score >= limiar` nem `status === 'ok'`.**
  `status` (`ok`/`atencao`/`critico`) é hoje um cálculo separado que
  também considera EPI/planos de ação/inspeções — não é o que este
  selo usa. Um tenant sem nenhum documento com `expires_at` tem
  `score: null` (não é vacuamente "100%") e por isso não recebe o
  selo.
- **Reflete o score de agora, sem histórico/janela de tolerância.**
  Calculado na consulta, a partir do mesmo dado que já existe — sem
  tabela nova, sem migration, sem scheduler/job novo (mesma linha de
  decisão YAGNI já repetida em toda fase anterior deste projeto). Se
  a instabilidade dia-a-dia do selo aparecendo/sumindo virar problema
  real, uma janela de tolerância é melhoria candidata a frente futura.
- **Sem ranking entre empresas.** Só um selo individual, visível pra
  cada empresa sobre seus próprios dados (e pro técnico, sobre os
  clientes da própria carteira — o técnico já vê o score de cada
  cliente hoje, então já teria acesso a essa informação de qualquer
  forma). Nunca expõe o status de conformidade de uma empresa pra
  outra.
- **Sem indicador de progresso dedicado.** O score que a empresa já
  vê todo dia no próprio dashboard já cumpre esse papel — não precisa
  de uma barra "faltam N pontos" nova.
- **Só visual no dashboard, nada baixável/compartilhável nesta fase.**
  Sem geração de imagem/PDF do selo. Candidato a frente futura se
  virar necessidade real de marketing da empresa cliente.

## 3. Backend

Sem migration, sem tabela nova — `empresa_destaque: boolean` é
computado nos dois pontos onde o score de documentos já é calculado,
cada um usando exatamente a fórmula já existente ali (`score === 100`):

- **`DashboardSummary`** (`backend/src/dashboard/dashboard.service.ts`,
  método `getSummary`, servido por `GET /dashboard/summary`) — ganha
  o campo `empresa_destaque: boolean`, calculado a partir de
  `compliance.score` (já obtido via `this.documents.getCompliance(client, tenantId)`
  no início do método) — `compliance.score === 100`.
- **`PortfolioComplianceItem`** (`backend/src/documents/documents.service.ts`,
  método `getPortfolioCompliance`, servido por
  `GET /documents/compliance/portfolio`) — ganha o mesmo campo
  `empresa_destaque: boolean` por item da carteira, calculado da mesma
  forma a partir do `score` já calculado ali por tenant
  (`g.total === 0 ? null : Math.round((g.emDia / g.total) * 100)`).

Nenhum outro endpoint muda. Nenhuma rota nova.

## 4. Frontend

- **Dashboard da empresa** (`frontend/src/app/empresa/dashboard/page.tsx`):
  quando `empresa_destaque === true`, um banner/badge (🏆 "Empresa
  Destaque Montese") próximo ao indicador de score já existente na
  tela. Não aparece quando `false`.
- **Lista de empresas do técnico** (`frontend/src/app/tecnico/empresas/page.tsx`):
  um selo pequeno (🏆) ao lado do score de cada empresa com
  `empresa_destaque === true`, na mesma linha onde o score já é
  exibido hoje.

Sem página nova, sem rota nova.

## 5. Testes

Backend: extensão dos testes e2e já existentes
(`backend/test/dashboard-summary.e2e-spec.ts` e
`backend/test/documents-portfolio.e2e-spec.ts`, ambos já cobrem os
dois endpoints tocados por esta fase) cobrindo `empresa_destaque: true` quando
todos os documentos com `expires_at` estão em dia, `false` quando há
pelo menos um vencido/vencendo, e `false` (não `true`) quando não há
nenhum documento com `expires_at` (`score: null`). Frontend sem suíte
automatizada (estado real do projeto) — Playwright com sessão
sintética + mock de rota, contra a build de produção real, cobrindo
os dois pontos (dashboard da empresa e lista do técnico) nos dois
estados (com e sem o selo).

## 6. Fora de escopo desta fase

- Qualquer métrica de reconhecimento que combine módulos diferentes
  (CIPA, EPI, planos de ação) — só o score de documentos já existente.
- Ranking/comparação entre empresas.
- Histórico/janela de tolerância pro selo (persistência ao longo do
  tempo) — reflete só o score de agora.
- Indicador de progresso dedicado rumo ao selo.
- Geração de imagem/PDF baixável ou compartilhável do selo.
- Qualquer outro nível/etapa de reconhecimento além do selo único
  "Empresa Destaque".
