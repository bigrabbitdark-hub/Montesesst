# Base normativa (LIP, GRO/PGR, previdenciário, saúde ocupacional) — plano de commit e sequência de release unificada

> **Status: NADA EXECUTADO.** Este documento só planeja. Quem decide commit/push/deploy é o proprietário (AGENTS.md). Cada passo 🔒 muda produção ou o git e exige
> autorização explícita. Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO. Estado medido em 2026-10-10 (somente leitura).
> Documentos por área (detalhes): `release-base-normativa-lip-2026-10-09.md`, `runbook-ingestao-lip.md` (§0.5, §7 NR-01, §8 previdenciário, §9 saúde ocupacional).

## 1. Estado atual

| Item | Estado (VERIFICADO) |
|---|---|
| Branch da árvore de trabalho | `feat/noticias-sstnews` (branch de site/notícias; **não é o lugar** destes arquivos — alguém trocou de branch durante a sessão) |
| Commits da base normativa | **nenhum** — tudo está não commitado/untracked |
| Produção (banco) | migrations até `0071` + **`0072` aplicada em 2026-10-09** (3 tabelas vazias); **`0073`, `0074` e `0075` NÃO aplicadas**; `0063` (pente-fino) pendente e não rastreada |
| Produção (backend) | `0969bb7-esocial-wip2` (código do eSocial; não tem nada desta entrega) |
| Backup antes da `0072` | `montese-20261009-182048.dump` (local + R2) — refazer no dia de qualquer nova migration |

## 2. O que é desta entrega e o que NÃO é (para não commitar trabalho alheio)

**Desta entrega (todos conferidos; arquivos rastreados modificados contêm só alterações minhas):**
- Modificados: `backend/package.json` (+2 scripts `db:*`), `backend/src/normative/{normative-documents.service.ts (+3 linhas, gancho), normative-monitor.service.ts, normative-text.util.ts, normative.module.ts}`, `backend/test/{normative-extract-html,normative-monitor-guard,normative-text}.unit-spec.ts`.
- Novos em `backend/src/normative/`: `html-struck.ts`, `provision-parser.ts`, `provision-lifecycle.ts`, `provisions.{service,controller}.ts`, `normative-rule-areas.ts`, `normative-rules.{service,controller}.ts`, `dto/{create,update,review}-normative-rule.dto.ts`, `dto/set-rule-provisions.dto.ts`.
- Novos em `backend/db/`: `migrations/{0072_lip_normative_base,0073_normative_rules_generalization,0074_normative_rules_previdenciario,0075_normative_rules_saude_ocupacional}.sql`, `generate-provisions.ts`, `import-normative-rules.ts`, `seed-data/normative-rules/{gro-pgr,previdenciario,saude-ocupacional-nr07,saude-ocupacional}.json`.
- Novos em `backend/test/`: `provision-parser`, `provisions-service`, `normative-rules-{service,controller,migration,previdenciario-migration}`, `lip-normative-migration`, `planalto-extract`, `import-normative-rules`, `gro-pgr-seed`, `previdenciario-seed`, `saude-ocupacional-seed`, `normative-rules-saude-ocupacional-migration` (`*.unit-spec.ts`), `normative-rules-base.e2e-spec.ts`, e `fixtures/{normative,planalto}/` (inclui `fixtures/normative/saude-ocupacional/`: `nr-07-itens.txt`, `clt-arts-168-169.txt`, `lgpd-arts-5-11-46-48.txt`, `README.md`).
- Também alterados nesta entrega (saúde ocupacional): `backend/src/normative/{provision-parser.ts, provisions.service.ts (lista liberada: +NR-07, +LEI-13709), normative-rule-areas.ts}`, `backend/db/import-normative-rules.ts` e os specs `provision-parser`, `provisions-service`, `normative-rules-{controller,service,previdenciario-migration}`, `import-normative-rules` (já nas listas acima).
- Docs: `docs/superpowers/{specs,plans}/2026-10-09-base-normativa-{lip,gro-pgr}*`, `…/2026-10-10-base-normativa-previdenciario*`, `docs/operations/{runbook-ingestao-lip,release-base-normativa-lip-2026-10-09,entrega-base-normativa-commit-e-release-2026-10-10}.md`, `docs/reference/{gro-pgr-modulo-insumos-2026-10-09,previdenciario-ltcat-ppp-insumos-2026-10-10,saude-ocupacional-pcmso-aso-insumos-2026-10-10}.md`, `docs/superpowers/{specs,plans}/2026-10-10-base-normativa-saude-ocupacional*`.

**NÃO são desta entrega (outras frentes; NÃO incluir nos commits):** `backend/src/pente-fino/*` (inclui `sst-audit-*`), `backend/src/common/pdf/pdf-text.util.ts`, `backend/test/{pdf-text-full,tenant-context-callsites}.unit-spec.ts`, `backend/test/{pente-fino-*,sst-audit-*}`, `backend/db/migrations/0063_sst_audit_document_facts.sql`, `frontend/src/components/{PenteFinoPanel.tsx,__tests__/PenteFinoPanel.test.tsx}`, **`docker-compose.yml`** (infra: AGENTS.md exige análise e autorização antes), `docs/business/`, `docs/audits/{analise-tst-microservico-2026-10-05,auditoria-esocial-2026-10-04}.md`, `docs/operations/{checklist-revisao-esocial,esocial-handoff-executor-rodada-2,orca-trabalho-paralelo,release-conformidade-por-nr-2026-10-01}.md`, `docs/specs/esocial-referencia-tst.md`, e os specs/plans de eSocial e de auditoria cruzada em `docs/superpowers/`.

## 3. Branch e commits propostos (RECOMENDADO; nenhum executado)

**Branch:** criar um branch próprio a partir do que vai ser reconciliado com o eSocial — não commitar em `feat/noticias-sstnews`. Opção simples: `git switch -c feat/base-normativa-lip-gro-previdenciario feat/conformidade-por-nr`
(carrega a árvore de trabalho junto). **VERIFICADO em 2026-10-10:** os commits do monitor (`3e114fa`, `dbda6cb`) estão nos dois branches e nenhum dos arquivos rastreados desta entrega difere entre `feat/noticias-sstnews` e `feat/conformidade-por-nr` (`git diff --name-only` = 0 arquivos), então a troca não deve gerar conflito; se o git recusar mesmo assim, resolver antes — **não** usar `reset`/`checkout --force`.

**Sequência de commits** (cada um com `git add` por caminho — nunca `git add -A`; conferir `git diff --cached --stat` antes de cada commit; rodar `cd backend && npm run test:unit` ao final):
1. `feat(normative): extração do Planalto sem texto riscado e decodificação windows-1252` — `html-struck.ts`, `normative-monitor.service.ts`, `normative-text.util.ts`, `test/{normative-extract-html,normative-monitor-guard,normative-text,planalto-extract}.unit-spec.ts`, `test/fixtures/planalto/`.
2. `feat(normative): dispositivos literais, regras por área e gancho de obsolescência` — `provision-*.ts`, `provisions.*`, `normative-rule-areas.ts`, `normative-rules.*`, `dto/*-normative-rule.dto.ts`, `dto/set-rule-provisions.dto.ts`, `normative-documents.service.ts`, `normative.module.ts`, migrations `0072`/`0073`/`0074`/`0075`, `generate-provisions.ts`, `package.json`, a correção do parser da saúde ocupacional (`provision-parser.ts`: título de quadro em duas linhas e número de artigo partido; `provisions.service.ts`: NR-07 e LEI-13709 liberadas), os specs `provision-parser`, `provisions-service`, `normative-rules-*` (inclui `normative-rules-saude-ocupacional-migration`), `lip-normative-migration`, `normative-rules-base.e2e-spec.ts`.
3. `feat(normative): importador de regras em rascunho` — `import-normative-rules.ts`, `test/import-normative-rules.unit-spec.ts`.
4. `feat(normative): regras GRO/PGR (NR-01 de 26/05/2026) em rascunho` — `seed-data/normative-rules/gro-pgr.json`, `test/gro-pgr-seed.unit-spec.ts`, `test/fixtures/normative/NR-01-vigente-2026-05-26.txt`.
5. `feat(normative): regras previdenciárias (Lei 8.213, Decreto 3.048, CLT) em rascunho` — `seed-data/normative-rules/previdenciario.json`, `test/previdenciario-seed.unit-spec.ts`, `test/fixtures/normative/previdenciario/`.
6. `feat(normative): regras de saúde ocupacional (NR-07, CLT 168/169, LGPD, NR-01) em rascunho` — `seed-data/normative-rules/{saude-ocupacional-nr07,saude-ocupacional}.json`, `test/saude-ocupacional-seed.unit-spec.ts`, `test/fixtures/normative/saude-ocupacional/`.
7. `docs(normative): specs, planos, runbook e release da base normativa` — os docs da lista acima.
Os commits 1–6 só ficam todos verdes juntos (os testes se referenciam); se for preciso bisectabilidade, juntar 2–6. Co-autoria: seguir o trailer pedido pelo ambiente.

## 4. Sequência de release unificada (🔒 cada passo; a ordem importa)

0. **Decisões do proprietário** (§5) e janela; nenhuma sessão paralela mexendo em produção.
1. **Reconciliar a árvore:** commitar o eSocial (`/opt/montese-esocial`, hoje com dezenas de itens não commitados — a produção é feita dele, não do git), fazer o merge com o branch desta entrega (`git merge-tree` entre os commits existentes não apontou conflito; reconferir com os commits novos). O merge **também leva** os commits do monitor normativo e do frontend admin que estão à frente de `0969bb7`.
2. **Ensaio isolado** (método do ensaio descartável; migrations como superusuário): `0072`→`0075`, e2e `normative-rules-base`, aprovação, isolamento; Camada A do Assistente antes/depois (as respostas mudam quando a NR-01 de 2026 e as leis entram).
3. **Backup do dia** (`bash ops/backup-postgres.sh`, conferir `[ok]` e `pg_restore -l`).
4. **Migrations, uma por vez, como `postgres`, `--single-transaction`, `lock_timeout=5s`, antes do backend:** `0073` (renomeia as tabelas vazias da `0072`), depois `0074`, depois `0075`. **Nunca `npm run db:migrate`** (arrastaria a `0063` de outra frente e as migrations juntas). Conferir grants e `SELECT max(name) FROM _migrations`.
5. **Deploy do backend reconciliado** — **com a extração nova do Planalto no mesmo build.** O `User-Agent` do monitor já está no `dbda6cb`; a extração sem texto riscado, as entidades HTML e a correção 0x80–0x9F **só existem nesta árvore**. Subir o monitor sem elas faz o Planalto gerar documentos com redação REVOGADA. Conferir `/health` e o commit esperado.
6. **Frontend** (depois do backend), conforme `release-monitor-normativo-2026-10-09.md`.
7. **Fontes (tela de admin):** NR-01 → trocar a URL para `…/normas-regulamentadoras-vigentes/nr-01-atualizada-2025-i-3.pdf`; `code` `CLT`, `LEI-8213`, `DEC-3048` nas três fontes do Planalto; **cadastrar a fonte da LGPD** com `code` `LEI-13709` e URL `https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/L13709compilado.htm` (não cadastrada hoje; a NR-07 de produção já está atual, sem troca de URL — runbook §9); decidir sobre a fonte `NR1` (página `nr-1`, nunca verificada).
8. **Verificar agora → conferir tamanho e hash → aprovar** (NR-01 nova primeiro: 30 chunks; LGPD ≈45 chunks, CLT 350 e Decreto 338 depois, **um por vez**, com crédito de embeddings garantido; nunca clicar de novo; `/reindex` só se `vigente` com `indexed_at` nulo). Não aprovar nenhum documento do Planalto gerado pela extração antiga.
9. **Gerar dispositivos** (`POST /normative-provisions/generate/:id`, um documento por vez; a NR-07, já vigente, só depois do deploy reconciliado) e conferir `found/inserted/anomalies_total`.
10. **Importar as regras em rascunho:** para cada seed, **dry-run primeiro** e, conferido o plano, `--apply` (fora da imagem de produção; os argumentos vão depois de `--`): `gro-pgr.json`, `previdenciario.json`, `saude-ocupacional-nr07.json` e `saude-ocupacional.json`. O `saude-ocupacional-nr07.json` (12 regras, só NR-07) pode ir **assim que os dispositivos da NR-07 forem gerados**, sem aprovar nada novo. O `saude-ocupacional.json` (9 regras) depende de **CLT + NR-01 nova + LEI-13709 aprovadas e geradas** — a CLT é a aprovação mais arriscada (≈350 chunks, nginx `proxy_read_timeout 300s`). Contra a NR-01 antiga, as ligações 1.8.6, 1.8.7 e 1.8.8 resolvem; só a **1.8.7.1** falha (na antiga é 1.8.6.1; no PDF de 26/05/2026 aparece como 1.8.7.1 antes do 1.8.7 — INFERIDO: provável erro de numeração; ver a NOTA AO REVISOR na regra `SAU-DISPENSA-PCMSO-MEI-ME-EPP`). Contra produção hoje o importador aborta sem gravar.
11. **Revisão profissional:** só então regras podem virar `revisada` (revisor identificado; para o previdenciário, também revisão previdenciária/jurídica).

## 5. Decisões do proprietário (ordem sugerida)
1. Commit e branch (§3); reconciliação com o eSocial e janela do deploy (§4.1, §4.5).
2. Crédito de embeddings no OpenRouter (sem ele nenhuma aprovação, e portanto nenhuma geração/importação).
3. Autorizar as migrations `0073`, `0074` e `0075` em produção (§4.4) — hoje só a `0072` foi autorizada e aplicada.
4. Revisor(es): nome e registro profissional; revisão previdenciária/jurídica; médico do trabalho/profissional habilitado para a saúde ocupacional (e revisão jurídica das regras de LGPD).
5. Páginas-portal e fontes em `erro` não relacionadas ao Planalto (CAEPI 403, STF 403, TNU portal); a fonte `NR1`.
6. Como rodar o gerador/importador em produção (a imagem só tem `dist` e `db`); ideia: container descartável na rede interna, com o repositório montado.
7. Pendências de produto/normativas: histórico de vínculos regra↔dispositivo; URLs oficiais da IN PRES/INSS 128/2022, do eSocial (MOS/leiautes) e da ANPD; Anexo IV do Decreto 3.048; Lei 8.212 e Decreto 4.882 (extração não medida); descoberta de versões de NR publicadas sob nome de arquivo novo (as URLs versionadas não detectam substituição). Saúde ocupacional: lacuna de itens da NR-07 sem regra (7.4.1, 7.5.2, 7.5.12–7.5.18, 7.5.19.6) — criar regras ou não.

## 6. O que este plano não cobre
Módulos de produto (GRO/PGR, LTCAT/PPP, integração S-2240), alteração de prompt/modelo do Assistente e qualquer mudança de infraestrutura (Docker, Nginx, compose, Redis, TLS, DNS, backups) — exigem análise e autorização próprias.
