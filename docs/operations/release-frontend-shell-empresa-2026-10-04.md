# Plano de release — Shell novo na área da empresa — 2026-10-04

> **Status: NADA EXECUTADO.** Este documento só planeja. Cada etapa marcada 🔒 muda produção e exige
> autorização explícita do proprietário (AGENTS.md, seção Infraestrutura). Modelo: `release-conformidade-por-nr-2026-10-01.md`.
> Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

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
2. Build candidata: `docker build -t montese-frontend:candidate-shell-20261004 /opt/montese-release-shell/frontend`
   (usar `GIT_COMMIT` como em `ops/build-with-commit.sh` se o frontend o consumir — NÃO VERIFICADO).
3. Boot isolado da candidata (rede interna, sem publicar porta) e `GET /login` = 200.
4. Aplicar: `docker tag montese-frontend:candidate-shell-20261004 montese-frontend:latest` e
   `docker compose up -d --no-deps frontend` (sem override; ver nota de segurança do compose).

**Rollback:** `docker tag montese-frontend:pre-shell-20261004 montese-frontend:latest` +
`docker compose up -d --no-deps frontend` (~segundos de indisponibilidade só do frontend).

## 5. Verificação pós-release (navegador, login real do proprietário)

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
