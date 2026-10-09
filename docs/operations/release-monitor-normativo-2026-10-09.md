# Plano de release — Monitor normativo (fatias 1, 2a, 2b, E1 e extrator) — 2026-10-09

> **Status: NADA EXECUTADO.** Este documento só planeja. Cada etapa marcada 🔒 muda produção e exige autorização explícita do proprietário (AGENTS.md, seção Infraestrutura).
> Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
> Complementa `release-conformidade-por-nr-2026-10-01.md` (mesma branch) e `release-frontend-shell-empresa-2026-10-04.md` (§0.5–0.7). Não repete o que já está lá.

## 1. O que entra (commits da branch `feat/conformidade-por-nr`, todos no GitHub)

| Commit | O quê | Camada |
|---|---|---|
| `dbda6cb` | Fatia 1: parar o ruído (cabeçalhos do monitor, comparação normalizada, barreira de extração suspeita, pendente congelado, decodificação ISO-8859-1) | backend |
| `3e114fa` | Fatia 2a: guarda SSRF, `PATCH`/`check-now`/`preview` de fontes, tela de fontes (`FontesPanel`) | backend + frontend |
| `bb227e5` | E1: a busca do Assistente respeita `official_sources.active` | backend |
| `d7552a1` | Fatia 2b: `GET :id/diff`, `reject-batch`, `retire`, diff e lote na tela | backend + frontend |
| `130c920` | Extrator de HTML preserva quebras de bloco | backend |

**Sem migration nova nestes 5 commits** (VERIFICADO: nenhum arquivo em `backend/db/migrations`). Sem dependência nova, sem variável de ambiente nova, sem mudança de Docker/Nginx.

## 2. Por que ainda não dá para soltar (VERIFICADO em 2026-10-07/08, reconfirmar antes)

1. **A produção roda `0969bb7-esocial-wip2`**: backend com código do eSocial que **não está commitado** (36 itens não rastreados) e migrations `0065–0071` já aplicadas no banco. Subir um backend construído desta branch **removeria o eSocial** da produção.
2. A branch também carrega a **`0064` (conformidade por NR)**, que ainda não está aplicada em produção (ver o plano de 2026-10-01: sem a migration, toda conclusão de inspeção dá 500 com o backend novo).
3. Backend e frontend das fatias 2a/2b **dependem um do outro**: o frontend novo chama endpoints que só existem no backend novo. O inverso é seguro (backend novo + frontend antigo apenas não mostra a tela nova).

## 3. Pré-requisitos 🔒 (decisões do proprietário)

- [ ] **Commit do eSocial** em `feat/esocial-transmissao` e **merge** com `feat/conformidade-por-nr` (numeração de migrations: `0063` pente-fino não rastreada, `0064` conformidade, `0065–0071` eSocial; conferir conflitos).
- [ ] Decidir a ordem com o plano de conformidade: **este release herda a Etapa 2 (migration `0064`) do plano de 2026-10-01**; usar aquele plano para backup, migration, backend e rollback. O que muda aqui é só o conteúdo do backend e o que verificar depois.
- [ ] Backup do banco no dia (o plano de 2026-10-01 já tem a Etapa 1).
- [ ] Janela e responsável; nenhuma sessão paralela alterando produção (a produção já mudou sob mim duas vezes).

## 4. Sequência recomendada (resumo; detalhes no plano de 2026-10-01)

1. **Etapa 0 — Preparar, sem tocar produção.** Build das imagens candidatas a partir de uma **worktree limpa do commit de merge**, `nest build`, `next build`, boot isolado com Postgres/Redis descartáveis (método de `reference_ensaio_descartavel_isolado`). Neste ensaio, **rodar o e2e do monitor e a avaliação Camada A** (única forma de validar contra Postgres e Assistente reais), conferindo:
   - `normative-sources.e2e-spec.ts` e `normative-monitor.e2e-spec.ts` (reescrito na fatia 1, **nunca executado**);
   - a Camada A antes/depois da E1 (fontes inativas deixam de ser citáveis).
2. **Etapa 1 — Backup 🔒.**
3. **Etapa 2 — Migration `0064` (e as do eSocial, se ainda não aplicadas) 🔒.**
4. **Etapa 3 — Backend 🔒** (imagem candidata).
5. **Etapa 4 — Frontend 🔒** (imagem candidata; depois do backend).
6. **Etapa 5 — Verificação 🔒/leitura**, abaixo.

## 5. Verificação específica deste release (depois da Etapa 4)

Leitura e navegador; nada disto altera dados, exceto onde indicado.
1. `GET /health` com o commit esperado; logs do backend sem erro de boot.
2. **Rotas novas protegidas:** `GET /api/normative-sources`, `PATCH /api/normative-sources/<uuid>`, `POST …/preview`, `POST …/check-now`, `GET /api/normative-documents/<uuid>/diff`, `POST …/reject-batch`, `POST …/retire` → **401 sem login**; com tenant não-admin → **403**.
3. **Navegador, com login de admin** (NÃO VERIFICADO até aqui, nunca foi feito): `/admin/normativa` carrega a tabela de fontes; "Testar URL" funciona numa URL pública conhecida; "Verificar agora" numa fonte saudável (cria no máximo um pendente, que o proprietário rejeita ou aprova); a revisão de um pendente mostra o diff (ou o aviso de truncado/lado a lado).
4. **Cron das 03:00:** no dia seguinte, `last_checked_at` das fontes atualizado e **sem leva de pendentes de ruído** (a fatia 1 deve ter parado isso). Atenção: com o extrator novo o texto das fontes HTML ganha quebras de linha, mas a comparação normalizada não gera pendente (VERIFICADO em 7 páginas reais).
5. **Assistente:** uma pergunta normativa conhecida continua citando a fonte certa; uma fonte desativada deixa de ser citada.

## 6. Rollback

- **Frontend:** voltar a tag anterior de `montese-frontend` (o plano de 2026-10-04 lista as tags `pre-*`). A tela antiga ignora os endpoints novos.
- **Backend:** voltar a tag anterior de `montese-backend`. **Não há migration destas fatias**, então o rollback destas 5 mudanças não exige reverter o banco. (A reversão da `0064`/eSocial segue o plano próprio; é aditiva e não deve ser desfeita sem necessidade.)
- **Dados criados pelas ações novas** ficam no banco e são compatíveis com a versão anterior: `rejeitado` com "Retirada: …" é um status já existente; fontes editadas/desativadas são colunas já existentes.
- Restaurar o backup só em último caso e com autorização.

## 7. Depois do release (ações do proprietário, na tela)

1. **TNU:** editar a fonte → URL `https://www.cjf.jus.br/phpdoc/virtus/listaSumulas.php` → "Testar URL (edição)" (leitura OK, caracteres suficientes, sem "Conteúdo suspeito") → Salvar → "Verificar agora" → revisar o pendente.
2. **Imprensa Nacional "Normas e Legislação":** desativar (a E1 a tira das respostas).
3. **LTCAT (2 fontes) e "EPI e custeio":** só após o proprietário identificar a norma de cada uma; nenhuma URL será escolhida pela Montese.
4. **Documentos vigentes ruins** (os de 9 caracteres e qualquer portal vigente): usar "Retirar" com motivo, depois de conferir o texto.
5. A primeira revisão de uma versão **depois** do extrator novo ainda mostra o diff degenerado (o vigente atual está sem quebras); após aprovar uma versão nova, os diffs seguintes ficam por parágrafo.

## 8. O que este plano não cobre / NÃO VERIFICADO

- E2E e avaliação Camada A (exigem ambiente isolado e autorização).
- As 51 URLs reais de produção contra a guarda SSRF (exige leitura de produção; o proprietário roda o export) e o comportamento da guarda com DNS real.
- DNS rebinding (risco residual declarado na spec 2a), concorrência entre "Verificar agora" e o cron (exigiria migration), PDFs reais no diff.
- Estado atual da produção (imagens, tags, migrations): reconfirmar com o proprietário no dia; as referências acima são de 2026-10-07/08.
- A spec do catálogo por tipo/tema (`2026-10-08-catalogo-fontes-por-tipo-e-tema-design.md`) **não** faz parte deste release.
