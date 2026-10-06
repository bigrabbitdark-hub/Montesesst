# Dashboard novo na área do técnico (e fecho da empresa) — design

> Data: 2026-10-05 · Escopo: **só frontend** · Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.

## 1. Objetivo

Levar o modelo novo do dashboard (Design System v2: `docs/specs/montese-design-system.md`) para as telas que ainda
usam a casca antiga: a área do **técnico/parceiro** (`/tecnico/*`, 10 páginas) e o que falta na área da **empresa**.
O admin fica fora desta rodada (decisão do proprietário, 2026-10-05; tema escuro mantido).

## 2. Estado atual (VERIFICADO no código em 2026-10-05)

- `/empresa/*` usa `EmpresaShell`. O skin (`.skin-dash` em `globals.css`, via `<DashSkin>`) cobre 12 páginas
  + `/empresa/cipa/*` (via `cipa/layout.tsx`). `em-construcao` já usa tokens `dash-*`.
- Faltam na empresa: `onboarding` (sem skin) e `pente-fino` (usa `PenteFinoPanel`, com **alterações não commitadas de
  outra frente** — fora deste trabalho).
- `/tecnico/*` usa `TecnicoSidebar` (`bg-brand-900`, emojis) + `DashboardFooter`, sem shell novo e sem skin.
- `DashboardSidebar` e `DashboardHeader` têm menu, papel e link "IA SST" fixos para a empresa. O link
  (`/empresa/assistente`) é barrado pelo `RoleGuard` para o técnico.
- `SessionUser` (`lib/auth.ts`) tem `id`, `role`, `tenantId`; **não tem nome**.

## 3. Abordagem escolhida (A)

Reaproveitar sidebar/header do DS v2, parametrizados, num novo `TecnicoShell`, e aplicar o skin existente no layout do
técnico para as 10 páginas herdarem os tokens novos sem reescrever JSX. Descartada a reescrita do markup das páginas
(risco alto, `inspecoes/[id]` tem 562 linhas, ganho pequeno).

## 4. Componentes (frontend/src)

| Arquivo | Mudança |
|---|---|
| `lib/dashboard/menu.ts` | Sem mudança de dados. `itemAtivo` já aceita lista arbitrária. |
| `lib/dashboard/menu-tecnico.ts` (novo) | `TECNICO_MENU_ITEMS`: Suas empresas, Agenda, Vencimentos, Consulta de CA, Configurações — mesmos hrefs de hoje, ícones lucide no lugar de emojis. |
| `components/dashboard/DashboardSidebar.tsx` | Props opcionais `items` e `extraItems` (+ rótulo da seção extra). Default = menu da empresa, então o comportamento atual e os testes existentes não mudam. |
| `components/dashboard/DashboardHeader.tsx` | Prop opcional `iaHref?: string \| null`. Default = `/empresa/assistente`; `null` esconde o botão "IA SST". |
| `components/dashboard/TecnicoShell.tsx` (novo) | Sidebar (menu do técnico) + header (`papel` = "Técnico" ou "Parceiro" por `getUser().role`, sem botão IA) + `SubscriptionNotice` + `DashboardFooter`. |
| `app/tecnico/layout.tsx` | `RoleGuard` → `TecnicoShell` → `<DashSkin>` com `max-w-6xl` em volta de `{children}`; mantém `WhatsAppButton`. Remove `TecnicoSidebar`. |
| `components/TecnicoSidebar.tsx` | Removido quando nenhuma referência restar (`grep`). |
| `app/empresa/onboarding/page.tsx` | Miolo dentro de `<DashSkin>`, título fora (padrão de `skin-paginas.test.tsx`). |

Nome do usuário no header do técnico: como a sessão não tem nome e **não vou inventar endpoint**, o header mostra o
papel ("Técnico"/"Parceiro") e iniciais derivadas dele. INFERIDO: aceitável nesta rodada; nome real = melhoria futura
(exige confirmar a fonte no backend).

## 5. Fora do escopo (explícito)

- Admin (exceto `/admin/overview`, já feito), `(site)` público, `pente-fino` da empresa e `PenteFinoPanel`.
- Campo de pesquisa e sino do header: já são decorativos na empresa; não ampliar. **Pendência registrada**
  (AGENTS.md: "não criar elementos visuais sem função").
- Backend, migrations, Docker, Nginx, RLS, autenticação: sem mudança. `RoleGuard` continua só UX; a autorização é do backend.

## 6. Tratamento de risco

- **Regressão na empresa:** props com default; testes atuais (`shell.test.tsx`, `menu.test.ts`, `skin-paginas`) devem passar sem edição.
- **Skin e contraste:** o skin já tem teste de contraste (`skin.test.ts`). Telas do técnico com cores fixas fora dos tokens
  `brand-*` podem ficar inconsistentes → tratadas caso a caso após QA visual, só se ficarem ilegíveis.
- **Tabelas largas no mobile:** o `<main>` do shell já usa `overflow-x-auto`; conferir na QA.
- **Árvore suja:** há WIP de outras frentes no working tree. Alterar só os arquivos da seção 4; nunca `git add -A`.

## 7. Verificação

1. vitest: testes novos (`menu-tecnico`, `TecnicoShell`: item ativo em subrota `/tecnico/empresas/[id]/…`, papel
   Técnico vs Parceiro, ausência do botão IA, logout, gaveta mobile) + suíte existente completa.
2. `tsc --noEmit`, eslint dos diretórios tocados, `next build`.
3. Playwright (API simulada, desktop 1440 e mobile 390) nas rotas do técnico: sem sidebar antiga, sem erro de JS,
   sem overflow horizontal da página, item correto ativo, menu mobile abre. Ferramentas e armadilhas: memória
   `project_visual_qa_tooling`.
4. NÃO VERIFICADO até haver login real de técnico: dados reais por página, assinatura inativa dentro do shell.

## 8. Git e release

Sem commit, push ou deploy automáticos (AGENTS.md). Entrega: diff + atualização de
`docs/operations/release-frontend-shell-empresa-2026-10-04.md` com a nova camada (shell do técnico). Release de
produção só com autorização explícita.
