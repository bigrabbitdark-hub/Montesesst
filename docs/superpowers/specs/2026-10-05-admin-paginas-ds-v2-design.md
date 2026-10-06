# Admin — 8 páginas com o Design System v2 (tema escuro mantido) — design

> Data: 2026-10-05 · Escopo: **só frontend** · Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
> Continuação de `docs/superpowers/plans/2026-10-01-admin-dashboard-revisao-visual-design-system-v2.md` (que cobriu só `/admin/overview`).

## 1. Objetivo

Levar às outras 8 páginas do `/admin` a mesma revisão visual já feita no `/admin/overview`: cards de 16 px com sombra,
tokens `--color-adm-*`, status como `Badge`, cabeçalho de página padronizado. O conteúdo, os dados, as regras, os endpoints,
o RBAC, a RLS e o multi-tenancy **não mudam**. Decisões do proprietário (2026-10-05): **tema escuro mantido**; abordagem **híbrida**
(primitivos CSS pequenos + `Card`/`Badge` por página), em **3 lotes**.

## 2. Estado atual (VERIFICADO no código em 2026-10-05)

- O admin tem casca própria (`AdminShell`, `AdminSidebar`, `AdminTopbar`, `CommandPalette`, `AdminStatusProvider`) e tema escuro
  (`app/admin/admin-theme.css`) que **inverte a escala `--color-brand-*`**; por isso as telas antigas são legíveis sem reescrita.
  (O plano de 2026-10-01 dizia "tema claro antigo": estava impreciso.)
- Nenhuma das 8 páginas usa `Card`/`.adm-card`; todas usam `brand-*` cruas (12–68 ocorrências) com `h2` + tabelas/formulários soltos.
- Padrões repetidos (contagem nas 8 páginas): bloco de seção `mt-8|mt-6 rounded-lg border border-brand-100 p-6` (17×); campo
  `rounded-md border border-brand-100 px-3 py-2` (21×); título de seção `text-lg font-bold text-brand-900` (17×); título de página
  `text-xl|text-2xl font-bold text-brand-900` (7×); tabelas `w-full text-left text-sm` com `border-b border-brand-100` (7×);
  ação em texto `text-brand-500 hover:underline` (11×); erro `text-red-600` (remapeado pelo tema); status como texto solto, ex. `({sub.status})`.
- `admin-theme.css` **não usa `@layer`**: vence qualquer utilitário do Tailwind na mesma propriedade. Não combinar `.adm-card`
  (nem as classes novas) com `rounded-*`/`bg-*`/`border-*` no mesmo elemento.
- Já existem: `components/admin/Card.tsx` (`Card`, `CardLink`, `CardSkeleton`, `CardError`, `CardEmpty`, `Badge`, `Tone`),
  tokens `--color-adm-status-*`/`--color-adm-brand*` em `globals.css`, teste `app/admin/__tests__/admin-theme-contraste.test.ts`.

## 3. Abordagem (C — híbrida)

1. **Primitivos em `admin-theme.css`, por classe e nunca por seletor genérico** (um seletor `.admin-theme input` quebraria o que
   já funciona): `.adm-input` (campo), `.adm-btn` e `.adm-btn-primary` (botões), `.adm-table` (tabela: cabeçalho, linhas, borda,
   hover), `.adm-link` (ação em texto), todos com raio/borda/foco do DS v2 e contraste ≥ 4,5:1 (texto) / 3:1 (borda de campo).
2. **Componente `AdminPageHeader`** (`components/admin/PageHeader.tsx`): título `h2` + descrição opcional + área de ações.
3. **Por página:** cabeçalho → `AdminPageHeader`; cada bloco `mt-* rounded-lg border p-6` → `Card` existente; campos e botões →
   classes `.adm-*`; tabelas → `.adm-table`; status solto → `Badge`. Lógica, `fetch`, estados, textos e ordem **intactos**.
4. **`Badge` e status:** o texto exibido é **sempre o valor original** vindo do backend. O tom (`ok/warn/bad/info/neutral`) só é
   atribuído a valores cuja semântica esteja confirmada no código/backend (levantar com `grep` no plano); valor desconhecido = `neutral`.
   Nada de traduzir ou inventar estados.

## 4. Lotes

| Lote | Páginas | Natureza |
|---|---|---|
| 1 | `empresas` (100 linhas), `auditoria` (224), `financeiro` (339) | listas/tabelas, quase sem escrita |
| 2 | `tecnicos` (310), `parceiros` (277), `normativa` (248), `checklist-sst` (286) | formulários que gravam dados |
| 3 | `empresas/[id]` (459) | a mais complexa: 4 tabelas, ações de assinatura |

O lote 1 também cria os primitivos e o `AdminPageHeader` (base dos demais). Cada lote termina com a verificação da seção 6 antes do próximo.

## 5. Fora do escopo

`/admin/overview` (já feita), `AdminShell`/sidebar/topbar/paleta de comandos, `components/ui/*` (variante clara da empresa), troca de tema,
backend, migrations, Docker, Nginx. Campo de busca e sino decorativos da empresa: não relacionados.

## 6. Verificação

- **Testes de render por lote** (padrão de `skin-paginas.test.tsx`, API simulada): título presente, blocos dentro de `Card`, nenhum
  `border-brand-100`/`rounded-lg ... p-6` cru sobrando, `Badge` com o texto original do status. Mocks como nos testes existentes.
- **Contraste:** estender `admin-theme-contraste.test.ts` para as classes `.adm-input`, `.adm-btn*`, `.adm-table`, `.adm-link`
  (lendo os tokens reais, como o teste atual). Checar também `text-brand-500` remapeado (#2f9e5c) sobre as superfícies, usado em 11 ações.
- **Comportamento preservado:** nenhum teste existente editado; formulários continuam enviando o mesmo corpo para os mesmos endpoints.
- `tsc --noEmit`, eslint dos diretórios tocados, `vitest` completo e `next build`.
- **QA no Playwright** (API simulada, sessão falsa `role: admin`, build local): desktop 1440 e mobile 390 em cada página do lote: sem erro de
  JS, sem overflow da página, tabelas largas rolando dentro do bloco, foco visível, legibilidade (ler os screenshots). Formulários: enviar com API
  simulada e conferir o corpo da requisição. NÃO VERIFICADO sem login real de admin: dados reais, listas longas, assinaturas em cada estado.
- Registrar no doc de release (`docs/operations/release-frontend-shell-empresa-2026-10-04.md`, nova camada) o que foi/não foi verificado.

## 7. Riscos e tratamento

- **Colisão `.adm-*` × utilitários Tailwind** (CSS fora de `@layer`): usar os primitivos sozinhos no elemento; teste que falha se
  houver `rounded-`/`bg-`/`border-` junto de `.adm-card`/`.adm-input`/`.adm-btn`/`.adm-table` nas 8 páginas.
- **Regressão em formulários que gravam** (lote 2 e 3): mudar só classes e wrappers; nenhuma alteração em handlers/estado; QA de envio com corpo conferido.
- **Diff grande no lote 3:** `empresas/[id]` tem 68 usos de `brand-*`; se o arquivo ficar difícil de revisar, dividir em subcomponentes só se o plano
  detalhar (não reestruturar por conta própria).
- **Árvore suja:** há WIP de outras frentes; tocar só nos arquivos listados no plano; nunca `git add -A`.

## 8. Git e release

Sem commit, push ou deploy automáticos (AGENTS.md). Entrega: diff + atualização do doc de release. Aplicação em produção só com autorização
explícita do proprietário, a partir de worktree limpa.
