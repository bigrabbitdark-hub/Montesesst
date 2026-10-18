# Plano de release — Base normativa do LIP (complemento) — 2026-10-09

> **Status: planejamento; a migration `0072` JÁ foi aplicada (ver §1). O deploy do backend NÃO foi feito.** Este documento complementa
> `release-monitor-normativo-2026-10-09.md` e `release-conformidade-por-nr-2026-10-01.md` e só traz o que mudou. Cada etapa 🔒 muda
> produção e exige autorização explícita do proprietário (AGENTS.md). Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO.
> Runbook operacional da ingestão: `runbook-ingestao-lip.md`. Spec: `docs/superpowers/specs/2026-10-09-base-normativa-lip-design.md`.

## 1. Estado real de produção (VERIFICADO em 2026-10-09, consultas somente leitura)

| Item | Estado |
|---|---|
| Backend em produção | `/health` → `commit: 0969bb7-esocial-wip2`, imagem de 2026-10-07 |
| Migrations aplicadas | até `0071_work_accidents` — **inclui a `0064` (aplicada em 2026-10-01) e `0065_esocial_layout_versions`, `0066`–`0071` (2026-10-05/07)** |
| Migration **pendente** | `0063_sst_audit_document_facts.sql` (pente-fino; não rastreada no git) |
| **`0072_lip_normative_base.sql`** | **APLICADA em 2026-10-09** (após backup `montese-20261009-182048.dump`, local + R2); 3 tabelas vazias, sem RLS, grants do `montese_app` conferidos |
| `0073_normative_rules_generalization.sql` | **NÃO aplicada** (escrita em 2026-10-09, GRO/PGR Task 2): renomeia `lip_rules`/`lip_rule_provisions` → `normative_rules`/`normative_rule_provisions` e acrescenta `area` (`lip` \| `gro_pgr`); o backend desta árvore já usa os nomes novos |
| `0074_normative_rules_previdenciario.sql` | **NÃO aplicada** (escrita em 2026-10-10): acrescenta a área `previdenciario` aos CHECKs de `area` e de coerência área × categoria (`lip`/`gro_pgr` inalteradas); vem **depois da `0073` e antes do backend reconciliado** (runbook §0.5, passo 4b) |
| `0075_normative_rules_saude_ocupacional.sql` | **NÃO aplicada** (escrita em 2026-10-10): acrescenta a área `saude_ocupacional` aos CHECKs de `area` e de coerência área × categoria (`lip`/`gro_pgr`/`previdenciario` inalteradas); vem **depois da `0074` e antes do backend reconciliado** (runbook §0.5, passo 4c) |
| Texto NR-15 / NR-16 vigentes | sha256 completo idêntico ao de `backend/db/seed-data/normative-sources/` |

**Correção ao plano do monitor (2026-10-09):** o §3/§4 desse plano trata a `0064` e as migrations do eSocial como pendentes. Em produção elas
**já estão aplicadas**; a "Etapa 2 — Migration" dele, para esses arquivos, não tem mais o que fazer. (A migration do LIP também já foi.)

## 2. O que o LIP acrescenta ao release do backend

Código novo (todos em `backend/`, nenhum em Docker/Nginx/`.env`):
- `src/normative/`: `provision-parser.ts`, `provision-lifecycle.ts`, `provisions.service.ts`, `normative-rules.service.ts` (era `lip-rules.service.ts`
  até a `0073`), 2 controllers (`/normative-provisions`, `/normative-rules` — era `/lip-rules` —, **9 rotas, todas `@Roles('admin')`**), 4 DTOs;
  registro em `normative.module.ts`.
- **Gancho** em `normative-documents.service.ts` (+3 linhas): `finalizeApproval` e `retire` chamam `markDocumentProvisionsObsolete`. Esse é o único
  ponto que muda comportamento de código existente; ele faz `UPDATE normative_rules/normative_provisions` (por isso a `0072` — **já existe** — e a `0073`, que renomeia `lip_rules` para
  `normative_rules`, têm de existir antes; a `0073` **ainda não** foi aplicada).
- `db/generate-provisions.ts` + script `db:generate-provisions` (`package.json`, +1 linha). A imagem de produção só copia `dist` e `db`
  (`backend/Dockerfile:19-20`), então o CLI **não roda dentro dela**; usar a rota HTTP `POST /normative-provisions/generate/:documentId`.
- Variável opcional `PROVISIONS_GENERATE_EXTRA_NORMAS` (padrão vazio = só NR-01, NR-07, NR-15, NR-16, CLT, LEI-8213, DEC-3048 e LEI-13709 geram). **Não** foi adicionada a nenhum compose/`.env`.

Backend antigo + `0072` aplicada = seguro (VERIFICADO: backend segue no ar após a migration). Backend novo sem a `0072` = aprovar/retirar norma dá 500 (já não é possível).
Backend novo sem a `0073` = o mesmo 500 (`relation "normative_rules" does not exist`) — INFERIDO do código; aplicar a `0073` antes do backend.
Backend antigo + `0073` = seguro (INFERIDO: o backend em produção não tem este código e não usa essas tabelas; elas estão vazias).

## 3. Bloqueio que continua: árvore reconciliada (decisão do proprietário)

1. **Produção ≠ git.** O backend em produção foi construído de código do eSocial que não está commitado: `/opt/montese-esocial` tem **39 itens não
   commitados hoje** (eram 36 no plano do monitor, 2026-10-07/08 — o WIP continua mudando). Um build feito do git perde esse código.
   **Pré-requisito:** commitar o eSocial em `feat/esocial-transmissao` e fixar o commit exato que corresponde ao que roda em produção.
2. **Custo do merge `feat/conformidade-por-nr` + `feat/esocial-transmissao` (VERIFICADO, leitura):** `git merge-tree` sem conflitos entre os commits
   existentes; o eSocial não alterou `normative.module.ts`, `normative-documents.service.ts` nem `package.json`; sem migration do eSocial acima da `0071`.
   (Os arquivos do LIP ainda **não estão commitados**; reconferir o merge depois do commit.)
3. **Arquivos do LIP não commitados** (a decisão e a execução do commit são do proprietário): a migration renumerada `0072`, o código
   de `backend/src/normative/`, `backend/db/generate-provisions.ts`, 7 specs, o runbook, esta spec/plano e o `package.json`/`normative.module.ts`/`normative-documents.service.ts` modificados.
4. **O merge também leva os commits do monitor normativo** (fatias 1, 2a, 2b, E1, extrator; `release-monitor-normativo-2026-10-09.md`): os 13 commits
   a mais da branch `feat/conformidade-por-nr` desde `0969bb7` (backend + frontend admin DS v2, dashboard, quem somos). Não é só o LIP.
5. Build **sempre de worktree limpa do commit de merge** (nunca do working tree), como nos planos anteriores; `0063` não pode entrar na imagem.

## 4. Sequência recomendada (reaproveita as etapas dos planos anteriores)

0. 🔒 *Decisões do proprietário:* commit do eSocial, merge, janela, quem acompanha.
1. *Preparar sem tocar produção:* build da imagem candidata da worktree do commit de merge; `nest build`; ensaio isolado (método de
   `reference_ensaio_descartavel_isolado`): rodar `normative-rules-base` (era `lip-normative-base`), `normative-documents-approval`, `tenant-isolation-sweep`, `normative-sources`
   e **`normative-monitor` com `R2Service` mockado** (hoje falha por R2 falso, não por defeito); Camada A do Assistente antes/depois.
2. 🔒 *Backup do dia* (`bash ops/backup-postgres.sh`, conferir `[ok]` e `pg_restore -l`). **Migration: aplicar SÓ a `0073`** (a `0072` já está; reconfirmar `SELECT max(name) FROM _migrations`), sozinha, pelo mesmo método da `0072`
   (runbook §0.5, passo 3: superusuário, `--single-transaction`, `ON_ERROR_STOP=1`, `INSERT INTO _migrations` na mesma transação; snippet da `0073` com `PGOPTIONS='-c lock_timeout=5000 -c statement_timeout=30000'` no passo 4a), como `postgres` (com `montese_app` falha com "must be owner"), ANTES do backend. Depois dela `area` fica sem DEFAULT.
   **Atualização 2026-10-10:** em seguida à `0073`, aplicar também a `0074` (área `previdenciario`), pelo mesmo método, ainda ANTES do backend (runbook §0.5, passo 4b). Depois da `0074`, aplicar a `0075` (área `saude_ocupacional`), pelo mesmo método, ainda ANTES do backend (runbook §0.5, passo 4c).
3. 🔒 *Backend* (imagem candidata). Conferir `/health` e o `commit` esperado.
4. 🔒 *Frontend* (depois do backend), conforme o plano do monitor.
5. *Verificação* (§5).

## 5. Verificação específica do LIP (depois do backend)

- `GET /normative-rules` (e `?area=lip` / `?area=gro_pgr`) e `GET /normative-provisions` com token **admin** → `200` e `[]`; com token de `empresa`/`tecnico` → `403` (VERIFICADO em unit
  que toda rota tem `@Roles('admin')`; confirmar em produção).
- Logs do backend sem `relation "normative_rules" does not exist` nem `permission denied for table` nas primeiras aprovações/retiradas reais.
- **Não criar dados de teste em produção** para exercitar o gancho (RECOMENDADO): ele foi exercitado no ensaio (aprovar, substituir, retirar, regra revisada → `revisar`).
- Só então gerar dispositivos (🔒, por documento, **um por vez**): `POST /normative-provisions/generate/<id>` para NR-15 `b3f5a9c3-d722-439e-99b4-0c82ad2421b8`
  e NR-16 `b37afd0e-3fa9-4831-87ed-774f204a823c` (ids VERIFICADOS em 2026-10-09; reconfirmar). Esperado (texto idêntico ao medido): NR-15 ≈ 316 dispositivos / 67,7%, NR-16 ≈ 89 / 91,3%.
  Conferir a resposta (`found`, `inserted`, `anomalies_total`) e a segunda chamada (`inserted: 0`).
- **Não gerar antes do deploy:** o backend atual não obsoleta dispositivos ao substituir/retirar norma.

## 6. Rollback

- **Backend:** voltar a tag anterior de `montese-backend`. As 3 tabelas (`normative_provisions` e, após a `0073`, `normative_rules`/`normative_rule_provisions`) ficam (aditivas; o backend antigo não as usa). `DROP` das tabelas só com elas vazias e autorização explícita.
- **Dispositivos já gerados:** se for preciso desfazer, marcar `obsoleto` (UPDATE) em vez de apagar; regras `revisada` ligadas voltam para `revisar` (o mesmo gancho faz isso).
- O dump `montese-20261009-182048.dump` (local + R2) é o ponto de retorno anterior à `0072`.

## 6.5 GRO/PGR: o que muda

> Detalhes e procedimento: `runbook-ingestao-lip.md` §7; material de produto: `docs/reference/gro-pgr-modulo-insumos-2026-10-09.md`. 🔒 = muda produção; **nada foi executado pelo agente**.

- **Migration `0073`** (segunda migration em produção): renomeia as tabelas (vazias) e acrescenta `area`. 🔒 Aplicar sozinha, após backup novo, como `postgres`, `--single-transaction`, **antes** do deploy do backend reconciliado (§4, etapa 2; runbook §0.5, passo 4a). Testada em Postgres 16 descartável: dados LIP já `revisada` sobrevivem; repetir a `0073` aborta com mensagem clara.
- **Importador** `npm run db:import-normative-rules` (15 regras GRO/PGR, 58 ligações, todas `rascunho`; dry-run por padrão). Contra o texto atual de produção (NR-01 antiga) ele aborta sem gravar (33 de 58 ligações barradas: 11 não encontradas + 22 com texto divergente). Roda fora da imagem de produção (precisa de `src` e `tsx`): método a decidir pelo proprietário, NÃO VERIFICADO em produção.
- **Ordem do texto da NR-01** (produção tem o texto antigo; o monitor não enxerga o novo porque a URL cadastrada aponta para o PDF antigo): 🔒 trocar a URL da fonte → "verificar agora" → revisar o diff → aprovar (exige crédito de embeddings no OpenRouter) → só então gerar dispositivos da NR-01 → só então o importador. Lista liberada do gerador: NR-01, NR-07, NR-15, NR-16, CLT, LEI-8213, DEC-3048 e LEI-13709 (ver §6.7).
- **Camada A do Assistente antes e depois de aprovar a NR-01 nova:** as respostas sobre GRO/PGR e psicossocial mudam com o texto (o antigo não tem "psicossocia"). Rodar antes e depois, em ensaio isolado, e comparar. Não executado.
- **Pendências:** fontes em `erro` (CLT `del5452.htm`, `d3048`, `d4882`, `l8212cons`, `l8213cons`, TNU, STF; causa das do Planalto estabelecida em 2026-10-10, ver §6.6; as demais não), fonte `NR1` (página `…/nr-1`) nunca verificada, e descoberta de versões com nome de arquivo novo — ver runbook §7.6.

## 6.6 Previdenciário: o que muda

> Detalhes: `runbook-ingestao-lip.md` §8; insumos: `docs/reference/previdenciario-ltcat-ppp-insumos-2026-10-10.md`. 🔒 = muda produção; **nada foi executado pelo agente**. Medições VERIFICADAS pelo controlador em 2026-10-09/10.

- **Hoje em produção:** Lei 8.213, Decreto 3.048, Decreto 4.882, Lei 8.212 e CLT estão em `erro` (8 falhas desde 2026-10-01), sem documento vigente; fontes "portalin" do INSS com 9 caracteres. **Causa:** o Planalto derruba a conexão (ECONNRESET) sem User-Agent e o monitor implantado (`0969bb7-esocial-wip2`) não envia cabeçalhos; com o `MONITOR_FETCH_HEADERS` do código novo as páginas respondem 200. **Só o deploy reconciliado corrige o download.**
- **Extração nova (só `*.planalto.gov.br`):** descarta a redação revogada riscada, decodifica windows-1252 e (rodada final, 2026-10-10) as entidades HTML. CLT arts. 189–197, Lei 8.213 arts. 57–58 e Decreto 3.048 arts. 64–69 e 188-P saem com a redação vigente; o art. 70 do Decreto está revogado (sem dispositivo). Muda o hash dos documentos do Planalto: como nenhum é vigente, nada é invalidado, mas a extração nova tem de estar no ar **antes** da primeira aprovação. Números atuais (parser `lei` com a cauda do documento fechada): **CLT 2189 dispositivos / 90,1%**, **Lei 8.213 615 / 93,1%**, **Decreto 3.048 2281 / 94,1%** (antes 2163/93,9%, 614/93,3%, 2281/94,3%; a CLT "perde" cobertura porque o Quadro do art. 577 deixou de ser colado no art. 922).
- ⚠️ **ORDEM (I2):** o User-Agent (`MONITOR_FETCH_HEADERS`) e um `decodeHtmlBuffer` sem a correção 0x80–0x9F já estão **commitados** no `dbda6cb` (`feat/conformidade-por-nr`, no remoto); a extração nova (`html-struck.ts`, `PLANALTO_EXTRACT_OPTIONS`, correção windows-1252, `decodeHtmlEntities`) **só existe na árvore de trabalho, sem commit**. Se as fatias do monitor subirem sem ela, o Planalto passa a gerar pendentes pela extração **ANTIGA** (CLT com arts. 189/190/191/194/195 na redação **REVOGADA**). **Não aprovar documento do Planalto que não tenha sido gerado pela extração nova; rejeitar pendentes anteriores.** A trava de `generate()` olha só o nome da norma, não a versão do extrator; rede de segurança só parcial (o `contem` do importador falharia contra a redação revogada).
- **Migration `0074`:** terceira em produção (depois da `0072` e da `0073`). 🔒 Aplicar sozinha, como `postgres`, `--single-transaction`, com `PGOPTIONS` de `lock_timeout`, após backup novo e **antes** do backend reconciliado (§4, etapa 2; runbook §0.5, passo 4b). Testada em Postgres 16 descartável: guarda aborta sem a `0073`, repetir aborta, regra LIP `revisada` sobrevive, matriz área × categoria imposta pelo banco.
- **Seed `previdenciario.json`:** 21 regras, todas `rascunho`, 66 ligações (CLT 2, LEI-8213 16, DEC-3048 48), com fragmento literal obrigatório; o importador aborta se uma ligação cair em dispositivo revogado. Inclui o Decreto 3.048 art. 188-P (pontos para filiados até 13/11/2019; § 5º limita a conversão de tempo especial em comum ao trabalho prestado até 13/11/2019; § 6º legislação da época). Contra produção hoje o importador aborta sem gravar. Fora do seed (sem base literal): PPP eletrônico desde 2023, eSocial S-2240/Tabela 24, IN PRES/INSS 128/2022 (URL oficial NÃO VERIFICADA), "EPI não é prova automática". Anexo IV do Decreto 3.048: a remissão é literal (art. 68); só o conteúdo (tabela) não foi ingerido.
- **Migrations (M6):** não usar `npm run db:migrate` desta árvore — aplicaria junto a `0063` (outra feature, sem commit), a `0073` e a `0074`. Só `psql`, um arquivo por vez.
- **Ordem 🔒 (proprietário):** backup → `0074` → deploy reconciliado → editar `code` (`CLT`, `LEI-8213`, `DEC-3048`; `code` é UNIQUE) → "verificar agora" → conferir tamanho e `content_hash` → aprovar (exige crédito de embeddings) → gerar (`POST /normative-provisions/generate/:documentId`) → importador `npm run db:import-normative-rules -- db/seed-data/normative-rules/previdenciario.json` (dry-run), depois o mesmo com `--apply` no fim — **os argumentos vão depois de `--`**: sem ele o npm consome `--apply` e roda dry-run em silêncio (M5). `LEI-8212` e `DEC-4882` não estão liberadas no gerador.
- **RISCO (INFERIDO, NÃO MEDIDO):** as três leis somam 782 chunks (CLT 350, Lei 8.213 94, Decreto 3.048 338; contagem anterior à rodada final), um embedding por chunk em sequência numa requisição síncrona; o nginx tem `proxy_read_timeout 300s` (`nginx/conf.d/default.conf:59`) e o maior documento aprovado até hoje tem ~100 chunks. Aprovar a CLT ou o Decreto pode estourar 300 s.
- **Falha do provedor no meio da aprovação (I3, VERIFICADO no código; corrige a versão anterior):** `computeEmbeddedChunks` roda FORA do `finalizeApproval` (`normative-documents.controller.ts` ~53-58); `openrouter-embedding.service.ts` ~29-52 lança 502 a qualquer falha, 30 s por chunk, sem retry. UMA falha entre as ~782 chamadas (ou falta de crédito) aborta a aprovação inteira: o documento **continua `aguardando_validacao`** e todo o custo se perde. "`vigente` com `indexed_at` nulo" só ocorre em falha de SQL dentro do savepoint. Clicar de novo enquanto a primeira ainda roda paga os embeddings em dobro. Seguro: medir a latência num documento pequeno, garantir crédito antes, não clicar de novo, conferir `status`/`indexed_at` depois e só usar `POST /normative-documents/:id/reindex` se `vigente` com `indexed_at` nulo. Opcional, com autorização do proprietário: aprovar pela rede interna sem passar pelo nginx. Nenhuma mitigação implementada.
- **Pendências do proprietário:** `code` das três fontes; deploy; crédito de embeddings; tratamento do risco acima; URLs oficiais da IN PRES/INSS 128/2022 e do eSocial; revisor (nome/registro, com revisão previdenciária/jurídica); fonte `NR1`; fontes em `erro` sem relação com o Planalto (CAEPI 403, STF 403, portal TNU).

## 6.7 Saúde ocupacional: o que muda

> Detalhes: `runbook-ingestao-lip.md` §9; spec `docs/superpowers/specs/2026-10-10-base-normativa-saude-ocupacional-design.md`; insumos: `docs/reference/saude-ocupacional-pcmso-aso-insumos-2026-10-10.md`. 🔒 = muda produção; **nada foi executado pelo agente**.

- **NR-07 em produção está ATUAL** (VERIFICADO): texto idêntico byte a byte ao PDF oficial `nr-07-atualizada-2022-1.pdf` (página atualizada em 02/06/2025; última portaria listada: SEPRT 8.873/2021). Sem troca de URL e sem nova aprovação; só gerar dispositivos **depois do deploy reconciliado** (o backend em produção não tem o gancho). Limite: vale até a data da página; não substitui o DOU.
- **LGPD (Lei 13.709/2018): fonte NÃO cadastrada.** 🔒 O proprietário cadastra `code` `LEI-13709`, URL `https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/L13709compilado.htm` (HTTP 200 com User-Agent; ≈45 chunks, aprovação pequena). Precisa da extração nova e do User-Agent do deploy reconciliado: nunca aprovar documento do Planalto gerado pela extração antiga (§6.6, I2). A CLT (com `code` editado) fornece os arts. 168/169.
- **Parser:** art. 5 da LGPD recuperado (o art. 57 vetado tinha o número partido em dois `<span>`) e rótulo falso `3/POEIRA…` da NR-07 corrigido (agora `3`). Medido em memória: NR-07 198 / 75,6% (Anexo I, de quadros, sem dispositivos), LGPD 415 / 96,2%; as outras 35 NRs, CLT, Lei 8.213 e Decreto 3.048 idênticas.
- **Migration `0075`:** quarta das regras. 🔒 Aplicar sozinha, como `postgres`, `--single-transaction`, `PGOPTIONS` de `lock_timeout`, após backup novo, **estritamente depois da `0074`** e antes do backend reconciliado (§4, etapa 2; runbook §0.5, passo 4c). Nunca `npm run db:migrate`. Testada em Postgres 16 descartável: guarda aborta sem a `0074`, repetir aborta, regras das outras áreas preservadas, matriz área × categoria imposta pelo banco, e2e 20/20.
- **Seeds de saúde ocupacional (divididos na rodada de correções de 2026-10-10):** 21 regras, todas `rascunho`, 65 ligações com fragmento literal obrigatório, em dois arquivos (mesmos `rule_key`, nenhuma regra nos dois). `saude-ocupacional-nr07.json` = 12 regras / 29 ligações, **só NR-07**: importável assim que os dispositivos da NR-07 forem gerados, sem aprovar nada novo. `saude-ocupacional.json` = 9 regras / 36 ligações (CLT 11, LEI-13709 19, NR-01 4, NR-07 2): depende de **CLT + NR-01 nova + LEI-13709 aprovadas e geradas**; a CLT é a aprovação mais arriscada (≈350 chunks, nginx `proxy_read_timeout 300s`, §6.6). **NR-01:** contra a NR-01 antiga de produção, as ligações 1.8.6, 1.8.7 e 1.8.8 resolvem com o mesmo `contem`; **só a 1.8.7.1 falha** (na redação anterior o texto é o 1.8.6.1; no PDF de 26/05/2026 aparece como 1.8.7.1, antes do 1.8.7 — INFERIDO: provável erro de numeração do PDF; a regra traz NOTA AO REVISOR: se o MTE corrigir, a ligação quebra e a regra vai para `revisar`). O importador agora impõe o prefixo `SAU-` (e `PREV-`, `GRO-`/`PGR-`) e confere só o dispositivo do endereço — a unicidade do `contem` no documento inteiro é do teste unitário. Contra produção hoje o importador aborta sem gravar. Ensaio anterior à divisão, contra banco descartável com NR-07, NR-01 nova, CLT e LGPD: dry-run 0; `--apply` 21/63; segunda execução inalterada (a divisão e as 2 ligações novas do art. 11 §4 da LGPD só foram validadas em memória). Comandos (fora da imagem de produção; os argumentos vão depois de `--`): **dry-run** `npm run db:import-normative-rules -- db/seed-data/normative-rules/saude-ocupacional-nr07.json`; conferido o plano, o passo seguinte é o mesmo comando com `--apply` no fim. Idem, depois das aprovações acima, para `db/seed-data/normative-rules/saude-ocupacional.json`.
- **Lacuna da NR-07 (decisão do proprietário):** itens 7.4.1, 7.5.2, 7.5.12–7.5.18 e 7.5.19.6 sem regra (inclui a periodicidade dos Quadros 1 e 2 do Anexo I, 7.5.13/7.5.14); nenhuma regra nova nesta rodada. Quirk mantido: o literal `3|2.17.2` da NR-07 termina na linha "QUADRO 1 - …" (não ligado a nenhuma regra).
- **Fora do seed (NÃO VERIFICADO; nada ingerido):** S-2220 e prazo, MOS S-1.3 / Nota Orientativa 08/2026, Tabela 24, ANPD, listas "ilustrativas" de exames e os princípios de IA (sem mudança de prompt/modelo). O módulo S-2220 já existe em `/opt/montese-esocial` (fora de produção) e o pente-fino tem a checagem PCMSO↔PGR: não duplicar.
- **Pendências do proprietário:** cadastrar `LEI-13709`; deploy reconciliado; crédito de embeddings (LGPD ≈45 chunks, CLT ≈350); troca de URL da NR-01 (runbook §7) para a ligação 1.8.7.1 resolver; lacuna de itens da NR-07; autorizar a `0075`; revisor (médico do trabalho/profissional habilitado; revisão jurídica para LGPD); URLs oficiais do eSocial (MOS/leiautes) e da ANPD.

## 7. O que este plano não cobre / NÃO VERIFICADO

- Conteúdo das regras do LIP (vem do proprietário; revisão por profissional habilitado).
- CLT e NHOs (faltam URLs oficiais e texto real; a CLT, a Lei 8.213 e o Decreto 3.048 estão liberados no gerador, mas as fontes estão vazias; ver §6.6).
- Crédito de embeddings (OpenRouter): sem ele, **aprovar** documentos novos falha no cálculo dos embeddings, ANTES de gravar — o documento continua `aguardando_validacao` e o custo das chamadas já feitas se perde (não afeta os já vigentes; ver §6.6, I3).
- Decisões pendentes: páginas-portal, revisor (nome/registro), histórico de vínculos regra↔dispositivo, corrida `review()`×aprovação (adiada).
- E2E do monitor com R2 mockado e Camada A: exigem ensaio isolado e autorização.
