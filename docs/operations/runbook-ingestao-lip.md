# Runbook — ingestão das fontes oficiais do LIP

> Origem: spec `docs/superpowers/specs/2026-10-09-base-normativa-lip-design.md`. Marcadores: VERIFICADO / NÃO VERIFICADO / RECOMENDADO.
> **Cada passo que grava em produção exige "pode" explícito do proprietário e backup antes (`bash ops/backup-postgres.sh`).** Nunca `docker compose down -v`.

## 0. O que já existe (VERIFICADO em 2026-10-09)

- `backend/db/seed-data/normative-sources/manifest.json` tem 36 NRs (NR-01, 03–26, 28–38), texto conferido por hash contra produção. Cobrem as NRs de apoio do LIP: **01, 06, 07, 09, 10, 15, 16, 17, 20, 23**.
- Os **anexos da NR-15 e da NR-16 estão no mesmo texto da norma** (uma fonte por NR; não cadastrar uma fonte por anexo).
- **Não há** no manifesto: **CLT (arts. 189–197)** e **NHOs da Fundacentro**. Estas precisam de fonte nova.
- **ALERTA (VERIFICADO no texto):** o `NR-15.txt` do manifesto lista alterações só até a Portaria SEPRT nº 1.359/2019 e traz "Este texto não substitui o publicado no DOU". Antes de tratá-lo como base vigente do LIP, **comparar com a página oficial atual do MTE** (passo 2). Idem NR-16 (o seu material cita atos até a Portaria MTE nº 2.021/2025 — NÃO VERIFICADO).

## 0.5 Ordem de release (obrigatória)

> Texto para o proprietário executar. **Nada aqui foi executado pelo agente.** Cada passo 🔒 exige "pode" explícito.

**Por que a ordem importa (VERIFICADO no código):** o backend novo chama `markDocumentProvisionsObsolete` dentro de
`finalizeApproval` (quando há versão vigente anterior) e de `retire` (`backend/src/normative/normative-documents.service.ts:185`
e `:279`), e essa função faz `UPDATE normative_rules …` e `UPDATE normative_provisions …` (`backend/src/normative/provision-lifecycle.ts`).
A `0072_lip_normative_base.sql` criou as tabelas (com os nomes `lip_rules`/`lip_rule_provisions`); a
`0073_normative_rules_generalization.sql` as renomeia para `normative_rules`/`normative_rule_provisions` e acrescenta `area`
(`lip` | `gro_pgr`). O backend desta árvore já usa os nomes novos. **Backend novo antes da `0072` e da `0073` ⇒ aprovar uma
nova versão de norma já vigente, ou retirar uma norma, dá erro 500** (a transação é desfeita; nada fica pela metade). As rotas
`/normative-provisions` e `/normative-rules` (era `/lip-rules`) também dariam 500. A `0072` é aditiva (só cria tabelas/trigger): o backend antigo
continua funcionando depois dela.

1. 🔒 **Backup:** `bash ops/backup-postgres.sh` e conferir o dump novo como em
   `docs/operations/release-conformidade-por-nr-2026-10-01.md` (Etapa 1: linha `[ok]`, sem `[ERRO] cópia externa`).
   Sem backup conferido, não segue.
2. **Conferir o estado das migrations:** `SELECT name FROM _migrations ORDER BY name DESC LIMIT 5;` — anotar a última aplicada
   e confirmar que a `0072` **não** está registrada.
3. 🔒 **Aplicar SÓ a `0072`.** **Não usar `npm run db:migrate`:** o runner aplica **todas** as `.sql` pendentes em ordem
   (`backend/db/migrate.ts:22-45`), e há migration fora deste pacote. **Estado medido em produção em 2026-10-09 (consulta somente leitura):** aplicadas até a `0071_work_accidents.sql` (inclui `0065_esocial_layout_versions` e `0066`–`0071` do eSocial/ASO, aplicadas em 2026-10-05/07) e **pendente a `0063_sst_audit_document_facts.sql`** (do pente-fino, não rastreada no git). Por isso a migration deste pacote foi numerada **`0072`** (a `0065` já pertence ao eSocial; confirmar de novo o próximo número livre antes de aplicar). `npm run db:migrate` aplicaria a `0063` junto — não usar.
   Usar o mesmo padrão da release anterior (`docs/operations/release-conformidade-por-nr-2026-10-01.md`, Etapa 2): superusuário,
   `--single-transaction`, `ON_ERROR_STOP=1` e o `INSERT INTO _migrations` na mesma transação. Adaptado (RECOMENDADO; conferir o
   caminho do arquivo no worktree/imagem de release antes):

   ```bash
   docker cp <worktree-da-release>/backend/db/migrations/0072_lip_normative_base.sql montese_postgres:/tmp/0072.sql
   docker exec montese_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction -v ON_ERROR_STOP=1 \
     -f /tmp/0072.sql -c "INSERT INTO _migrations (name) VALUES ('"'"'0072_lip_normative_base.sql'"'"')"; rm -f /tmp/0072.sql'
   ```

   Depois: `SELECT name FROM _migrations ORDER BY name DESC LIMIT 5;` deve mostrar a `0072` e **nenhuma** migration que não
   estava lá antes além dela.
4. **Conferir grants:** `\dp normative_provisions lip_rules lip_rule_provisions` (nomes da época da `0072`; depois da `0073`:
   `\dp normative_provisions normative_rules normative_rule_provisions` — o RENAME preserva os grants) — a role da aplicação precisa de
   `SELECT/INSERT/UPDATE/DELETE`. A `0072` não tem `GRANT` próprio; depende do `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT
   ALL ON TABLES` de `postgres/init/01-app-role.sh:26`, que vale para objetos criados pela role que rodou o init (o superusuário
   do container). Por isso aplicar como `$POSTGRES_USER` (passo 3). Na release anterior, o mesmo método resultou nos grants
   esperados (release-conformidade-por-nr, Etapa 2). Se faltar grant, **parar** e decidir com o proprietário.
4a. 🔒 **Aplicar SÓ a `0073`** (NÃO aplicada em produção até 2026-10-09), com backup do dia antes e pelo mesmo método do passo 3
   (trocar o arquivo e o nome no `INSERT INTO _migrations`). Ela tem uma guarda que aborta, sem alterar nada, se `lip_rules` não
   existir ou `normative_rules` já existir. Tem de vir **antes** do passo 5: o backend novo só conhece `normative_rules`.
   Aplicar como **`postgres`** (o `$POSTGRES_USER` do container, dono das tabelas): com `montese_app` os `ALTER TABLE … RENAME`
   falham com "must be owner". Limitar espera por lock e duração (RECOMENDADO; conferir o caminho do arquivo antes):

   ```bash
   docker cp <worktree-da-release>/backend/db/migrations/0073_normative_rules_generalization.sql montese_postgres:/tmp/0073.sql
   docker exec -e PGOPTIONS='-c lock_timeout=5000 -c statement_timeout=30000' montese_postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction -v ON_ERROR_STOP=1 \
     -f /tmp/0073.sql -c "INSERT INTO _migrations (name) VALUES ('"'"'0073_normative_rules_generalization.sql'"'"')"; rm -f /tmp/0073.sql'
   ```

   Depois da `0073`, a coluna `area` fica **sem DEFAULT** (linhas existentes recebem `lip`; INSERT sem `area` falha).
4b. 🔒 **Depois da `0073` e antes do passo 5, aplicar a `0074_normative_rules_previdenciario.sql`** (escrita em 2026-10-10; NÃO
   aplicada em produção), pelo mesmo método do passo 4a (trocar arquivo e nome no `INSERT INTO _migrations`), como `postgres`. Ela só
   troca os dois CHECKs (`normative_rules_area_check`, `normative_rules_area_categoria_coerente`, mesmos nomes) para aceitar a área
   `previdenciario` (categorias `aposentadoria_especial`, `ltcat`, `ppp`, `agentes_nocivos`, `esocial`, `cruzamento_documental`,
   `exposicao`); `lip` e `gro_pgr` ficam como na `0073`. A guarda aborta, sem alterar nada, se `normative_rules` não existir (falta a
   `0073`) ou se a área `previdenciario` já for aceita (`0074` já aplicada). Backend reconciliado sem a `0074` ⇒ cadastrar regra
   `previdenciario` falha no banco (INFERIDO: violação de CHECK vira 500).
4c. 🔒 **Depois da `0074` e antes do passo 5, aplicar a `0075_normative_rules_saude_ocupacional.sql`** (escrita em 2026-10-10; NÃO
   aplicada em produção), pelo mesmo método do passo 4a (trocar arquivo e nome no `INSERT INTO _migrations`), como `postgres`. Ela só
   troca os dois CHECKs (mesmos nomes) para aceitar a área `saude_ocupacional` (categorias `pcmso`, `exames_ocupacionais`, `aso`,
   `relatorio_analitico`, `excecao`, `privacidade_dados`, `cruzamento_documental_saude`); `lip`, `gro_pgr` e `previdenciario` ficam
   como na `0074`. A guarda aborta, sem alterar nada, se `normative_rules` não existir, se a área `previdenciario` ainda não for aceita
   (falta a `0074`) ou se a área `saude_ocupacional` já for aceita (`0075` já aplicada). Backend reconciliado sem a `0075` ⇒ cadastrar
   regra `saude_ocupacional` falha no banco (INFERIDO: violação de CHECK vira 500).
5. 🔒 **SÓ DEPOIS** subir o backend novo — **mas NÃO a partir do branch deste pacote isoladamente.** Medido em produção em
   2026-10-09 (leitura): `/health` do backend em produção responde `commit: 0969bb7-esocial-wip2`, imagem criada em 2026-10-07, e o
   banco já tem as migrations do eSocial (`0065_esocial_layout_versions`, `0066`–`0071`). Esse código vem do branch
   `feat/esocial-transmissao` (nasce em `0969bb7`, o mesmo ponto de onde sai `feat/conformidade-por-nr`, que NÃO tem o eSocial).
   Buildar e subir uma imagem só com este pacote **retiraria o código do eSocial de produção**. O backend com esta feature precisa
   sair de uma árvore **reconciliada** (produção atual + este pacote), decisão e merge do proprietário. Até lá, aplicar só a
   migration `0072` é seguro: ela é aditiva e o backend em produção (sem o gancho) simplesmente não a usa.
   Depois do deploy reconciliado, conferir `/health` e testar uma aprovação de norma numa fonte de teste.
6. Rollback: a `0072` pode ficar mesmo com o backend antigo no ar (aditiva). Remover a `0072` só com as tabelas vazias e com
   autorização explícita.

## 1. Cadastro das fontes novas (CLT, NHOs) — RECOMENDADO

1. Obter do proprietário/oficial as URLs: CLT (Planalto), catálogo de NHO (Fundacentro). **Não escolher URL de memória.**
2. Pela tela `/admin/normativa` (Fontes → "testar URL"), ou `POST /normative-sources/preview`: confirmar status 200, tipo de conteúdo e amostra de texto sem aviso de extração suspeita.
3. Cadastrar (`code`: `CLT`, `LEI-8213`, `LEI-8212`, `DEC-3048`, `DEC-4882`; NHO: `NHO 01`…). O parser de dispositivos cobre `NR-xx` e leis/decretos/códigos (`CLT`, `LEI-<n>`, `DEC-<n>`; LGPD = `LEI-13709`, ver §9); NHO fica como fonte/RAG sem dispositivos até existir parser.
4. Páginas-portal ("todas as NRs", portal do PGR, manuais eSocial): **não cadastrar como ativas** (decisão A da spec); servem só para conferência manual.

### 1.1 CLT — exigências antes de qualquer `--apply`

- **Risco (VERIFICADO no código):** `extractHtmlText` (`backend/src/normative/normative-monitor.service.ts:25`) troca toda tag
  HTML por espaço/quebra e **mantém o texto de dentro** — inclusive de `<strike>`. As páginas da CLT no Planalto mostram as
  redações revogadas riscadas junto com a redação vigente, então o mesmo artigo pode aparecer duas vezes no `raw_text` e as duas
  redações colidirem no parser (vira `item_ambiguo` ou, pior, a redação revogada fica com o endereço). Exemplo: o art. 193 teve
  a redação alterada pela Lei nº 12.740/2012 — **NÃO VERIFICADO** (o repositório não tem o texto da CLT; confirmar na página
  oficial).
- **Atualização (2026-10-10, base previdenciária Task 1 — `.superpowers/sdd/2026-10-09-base-normativa-lip/prev-task1-report.md`):**
  para URLs do `planalto.gov.br` o monitor agora extrai **sem o texto riscado** (`<strike>`, `<s>`, `line-through`;
  `backend/src/normative/html-struck.ts`) e trata a quebra de linha do código-fonte como espaço; dispositivo revogado inteiro
  fica só como "endereço + (Revogado…)" e não vira dispositivo. Medido nas páginas reais de 2026-10-09: CLT arts. 189–197,
  Lei 8.213 arts. 57–58 (§§ 1º–4º) e Decreto 3.048 arts. 64–69 com a redação vigente (o art. 70 do Decreto 3.048 está
  **revogado** pelo Decreto 10.410/2020); trechos reais em `backend/test/planalto-extract.unit-spec.ts`. As outras fontes
  mantêm a extração (e o hash) de antes. Os itens (a) e (c) abaixo continuam valendo; o (b) foi feito.
- **Exigido antes de `db:generate-provisions -- <id> --apply` para a CLT:**
  (a) baixar/ingerir o texto real da CLT pela fonte oficial cadastrada (passo 1) e aprová-lo;
  (b) acrescentar ao `backend/test/provision-parser.unit-spec.ts` um teste do parser com trecho **REAL** dos arts. 189–197
  (citando a origem), cobrindo a redação riscada — o teste atual de CLT é **SINTÉTICO** e só valida a estrutura;
  (c) dry-run (seção 4) com o relatório revisado pelo proprietário.

## 2. Conferir vigência das NRs já presentes

1. Para NR-15, NR-16 (e NR-01, 06, 07, 09, 10, 17, 20, 23): rodar o monitor/“verificar agora” da tela. Documento novo aparece como `aguardando_validacao` com diff de parágrafos.
2. O proprietário revisa o diff e aprova ou rejeita **um por vez**.
3. Registrar a data de verificação (fica em `official_sources.last_checked_at`). Datas de vigência citadas em material externo só valem se aparecerem no texto oficial.

## 3. Aprovação e indexação

1. Aprovar na tela existente (`/normative-documents/:id/approve`) — indexação vetorial depende do crédito de embeddings (OpenRouter). **Sem crédito, a aprovação falha na indexação**; resolver antes (decisão C da spec) ou adiar a aprovação.
2. Documento aprovado vira `vigente` e o anterior `substituido` (o gancho marca dispositivos antigos `obsoleto` e regras `revisada` ligadas voltam a `revisar`).

## 4. Geração de dispositivos

**Onde rodar o CLI (VERIFICADO no repositório):** a imagem de produção copia só `dist/` e `db/` (`backend/Dockerfile:19-20`); o
script `backend/db/generate-provisions.ts` importa `../src/normative/...` (linhas 3-4), e `src/` **não** está na imagem — então
`npm run db:generate-provisions` **não roda dentro do container de produção** (o `tsx` está em `dependencies`,
`backend/package.json:54`, mas falta o código-fonte). Alternativas (RECOMENDADO):
- container descartável `node:20-alpine` na rede interna do compose (`internal`, ver `docker-compose.yml`) com o repositório
  montado e `DATABASE_URL` passada por variável (sem imprimir), rodando `npm run db:generate-provisions -- <documentId>`; ou
- a rota HTTP `POST /normative-provisions/generate/:documentId` (somente admin; grava — equivale ao `--apply`).

1. Dry-run (somente leitura: `BEGIN READ ONLY`, parser em memória, nenhum lock de escrita): `npm run db:generate-provisions -- <documentId>`
   — conferir cobertura, anomalias e a lista **por anexo** (`anexo X: N dispositivos, P% do texto do anexo`; anexo sem
   dispositivo aparece como `anexo X: 0 dispositivos ⚠`; percentuais com piso, 99,6% aparece 99%).
   Depois da lista de anexos, o relatório imprime cada trecho em **quarentena** (`quarentena (linha N, "<cabeçalho>"): X
   caracteres sem dispositivo`) e o total — esse texto não entra no % de nenhum anexo.
   Medição do parser (rodada de pendências 2026-10-09, em memória sobre `db/seed-data/normative-sources`; detalhes em
   `.superpowers/sdd/2026-10-09-base-normativa-lip/parser-pending-report.md`): NR-15 = 316 dispositivos / 67%;
   NR-16 = 89 / 91%; NR-01 = 163 / 77,9% no texto antigo e 178 / 74,7% no texto vigente desde 26/05/2026 (medição
   da Task 1 do GRO/PGR; ver §7.3 — os anexos 1 e 2 da NR-01 são reconhecidos; o Anexo I é um glossário sem itens
   numerados e por isso não gera dispositivos). Texto depois de cabeçalho de anexo não reconhecido ou repetido (sub-anexos
   `ANEXO “A”`/`“B”`/`“C”` da NR-15, `ANEXO Nº 1`/`ANEXO II`/`ANEXO III` dentro do Anexo 12, `ANEXO V` repetido da NR-16)
   fica **fora** em vez de ser gravado com endereço errado. NR-15 Anexos 4, 5 e 14 saem com 0 dispositivos.
   - NR-16 `ANEXO (*)` (radiações ionizantes) é reconhecido como anexo de id literal **`(*)`** (a fonte não o numera):
     38 dispositivos (`(*)|1.1` … `(*)|7`). **`(*)|1` e `(*)|2` NÃO são gerados** (`item_ambiguo`): os itens 1 e 2 da
     "Nota Explicativa" (NR-16.txt:1061-1065) colidem com os do quadro.
   - NR-15 Anexo 12: **manganês** e **sílica** viram seções com endereço `12/MANGANÊS E SEUS COMPOSTOS|1…7` e
     `12/SÍLICA LIVRE CRISTALIZADA|1…8` (incl. `6.1`); os endereços do asbesto (`12|…`) não mudam.
   - NR-15 Anexo 13-A: o falso `13-A|2021` não existe mais; `13-A|7.4` termina em "(Alterado pela Portaria MTP nº 806…)".
   - NR-15 Anexo 13: o título `SUBSTÂNCIAS CANCERÍGENAS` (NR-15.txt:5344) encerra o `13|1`; esse bloco (sem item
     numerado) fica sem dispositivo e aparece como texto não coberto do anexo 13.
   🔒 **Trava no código (VERIFICADO em `backend/src/normative/provisions.service.ts`, `isGenerationAllowed`):** `generate()`
   (o `--apply` e a rota `POST /normative-provisions/generate/:documentId`) **recusa com 400** qualquer norma fora de
   NR-01, NR-07, NR-15, NR-16, CLT, LEI-8213, DEC-3048 e LEI-13709, antes de qualquer escrita, a menos que ela esteja listada na variável de ambiente
   `PROVISIONS_GENERATE_EXTRA_NORMAS` (separadas por vírgula, ex.: `NR-12,LEI-8212`; lida a cada chamada; padrão vazio). O
   dry-run continua liberado para qualquer norma (é somente leitura) e avisa `! <norma> não está liberada para --apply`.
   CLT, LEI-8213 e DEC-3048 foram liberadas depois do aceite com o texto real do Planalto (seção 1.1); LEI-8212 e DEC-4882
   têm parser mas **não** estão liberadas (sem aceite). NR-07 e LEI-13709 (LGPD) foram liberadas em 2026-10-10 depois do aceite
   em memória (`.superpowers/sdd/2026-10-09-base-normativa-lip/saude-task1-report.md`): título de quadro em duas linhas não
   abre mais seção e o `art. 5` da LGPD é reconhecido. Motivo da trava nas demais NRs: o parser
   reconhece `Anexo X da NR-xx` só nessa caixa mista (NR-01; medição em `.superpowers/sdd/2026-10-09-base-normativa-lip/gro-task1-report.md`),
   mas ainda não a forma em caixa alta `ANEXO X da NR-xx` nem títulos longos de anexo (várias NRs modernas perdem anexos). (O endereço
   errado da NR-07, `3/POEIRA CONTENDO SÍLICA…|3…3.7`, vindo de um título de quadro quebrado em duas linhas, foi corrigido:
   hoje os itens saem como `3|3…3.7`.) Liberar uma norma pela variável só depois de medir o dry-run dela e com autorização do proprietário.
2. Anomalias: `anexo_nao_reconhecido`/`anexo_repetido` (o texto seguinte fica em quarentena até o próximo anexo novo ou seção titulada),
   `item_ambiguo` (chave repetida sem vencedor estrutural — nenhuma ocorrência é gravada) e `item_repetido` (títulos de
   sumário descartados). Revisar as de anexos do LIP (NR-15 anexos 1, 2, 3, 8, 11, 12; NR-16 todos) e decidir se o parser
   precisa de ajuste. **Custo de uma nova `PARSER_VERSION` (VERIFICADO em `backend/src/normative/provisions.service.ts`,
   `generate()`):** ao rodar `generate` com versão nova, todos os dispositivos ativos do documento viram `obsoleto` e **todas
   as regras `revisada` ligadas a ele voltam para `revisar`** (exigem nova revisão do profissional). Subir a versão só com
   ganho claro e com o proprietário ciente desse retrabalho.
3. Com autorização: `npm run db:generate-provisions -- <documentId> --apply` (ou `POST /normative-provisions/generate/:documentId`).
   RECOMENDADO antes do `--apply` em banco com uso real: limitar a espera por lock, por exemplo definindo
   `PGOPTIONS='-c lock_timeout=5s'` no ambiente do container descartável (o `pg` lê `PGOPTIONS` — `node_modules/pg/lib/connection-parameters.js:83`; o script não define `lock_timeout` sozinho). Só
   documentos `vigente` geram dispositivos; a geração é idempotente (`ON CONFLICT … DO NOTHING`).

## 5. Matriz de regras (rascunhos)

1. Criar regras por `POST /normative-rules` com `area: "lip"` (nascem `rascunho`), a partir do texto dos dispositivos gerados.
   A categoria tem de ser da área (LIP: `insalubridade`, `periculosidade`, `prevencao`, `previdenciario`); `area` não muda depois.
   Listar: `GET /normative-rules?area=lip`. (Até a `0073` as rotas eram `/lip-rules`.)
2. Vincular dispositivos: `PUT /normative-rules/:id/provisions`.
3. Revisão pelo responsável técnico: `POST /normative-rules/:id/review` com o registro profissional. Sem dispositivo ativo vinculado, o sistema recusa.
4. Percentuais (art. 192) e 30% (art. 193 §1º): são **dispositivos literais** da CLT; a regra de cálculo fica com `exige_revisao_profissional = true`.

## 6. Pendências de decisão do proprietário

A. Páginas-portal: não cadastrar (RECOMENDADO) ou cadastrar inativas.
B. Nome e registro do(s) profissional(is) revisor(es).
C. Crédito dos embeddings (OpenRouter) ou troca de provedor (exige autorização — AGENTS.md).

## 7. NR-01 / GRO-PGR

> Origem: spec `docs/superpowers/specs/2026-10-09-base-normativa-gro-pgr-design.md`; material do proprietário (não normativo) resumido em `docs/reference/gro-pgr-modulo-insumos-2026-10-09.md`.
> **Tudo que muda produção abaixo está marcado 🔒, é texto para o proprietário executar e NADA aqui foi executado pelo agente.** Medições abaixo: VERIFICADO em 2026-10-09 (leitura), salvo indicação.

### 7.1 A NR-01 em produção é o texto ANTIGO

- O sha256 do documento vigente da NR-01 em produção é idêntico ao do PDF "NR-1 (vigência até 25 de maio de 2026)"; o texto **não** contém "psicossocia".
- A URL da fonte da NR-01 no monitor termina em `nr-01-atualizada-2024-i-1.pdf`: esse PDF antigo continua online com conteúdo idêntico, então o monitor responde `ok` todo dia e **nunca vê a versão nova**.
- O texto atual é o PDF `nr-01-atualizada-2025-i-3.pdf`, sob `https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/normas-regulamentadoras-vigentes/` (HTTP 200, `application/pdf`, 21 páginas). O capítulo 1.5 vale desde 26/05/2026 (Portaria MTE nº 1.419/2024, adiada pela nº 765/2025); a página oficial `…/nr-1` constava atualizada em 06/08/2026.
- Fixture do texto novo (extraído em 2026-10-09): `backend/test/fixtures/normative/NR-01-vigente-2026-05-26.txt` — sha256 do texto extraído `afaf953765022672dd058ba385ace393be6b88f5612cbb03a8e5219a2d662fb0`; sha256 do PDF `39e0ced67472db5f6f93235ce5532701247a1b7dddf39fb866c379e605b32a21`.

### 7.2 Procedimento para o proprietário (nesta ordem)

1. 🔒 Na tela de fontes (`/admin/normativa`), editar a URL da fonte NR-01 para o PDF `nr-01-atualizada-2025-i-3.pdf` (endereço acima).
2. 🔒 "Verificar agora". O documento novo entra como `aguardando_validacao`. **Antes de aprovar**, conferir que o
   `content_hash` do documento pendente é `afaf953765022672dd058ba385ace393be6b88f5612cbb03a8e5219a2d662fb0` (sha256 do
   texto extraído do fixture). O `pdf-parse` da imagem de produção pode gerar texto diferente (INFERIDO); se o hash
   divergir, o importador (7.4) aborta de forma segura, mas é melhor saber antes de aprovar e decidir com o proprietário.
3. Revisar o diff de parágrafos (o texto novo inclui o fator psicossocial; conferir contra a fonte oficial).
4. 🔒 Aprovar. **Exige crédito de embeddings no OpenRouter** (seção 3, item 1); sem crédito a aprovação falha na indexação. Antes e depois da aprovação, rodar a Camada A do Assistente (as respostas sobre a NR-01 mudam; ver o plano de release).
5. 🔒 **Só então** gerar os dispositivos da NR-01 (seção 4; dry-run primeiro, depois `--apply` ou `POST /normative-provisions/generate/:documentId`) e, por último, o importador (7.4). Gerar antes de aprovar o texto novo produziria 163 endereços do texto antigo. Valem também as ressalvas da seção "Registro de execução": nada de gerar antes do deploy reconciliado do backend.

Cadastros relacionados (decisão do proprietário, RECOMENDADO tratar): existe uma fonte `NR1` apontando para a página `…/nr-1` que **nunca foi verificada** (desativar ou corrigir), e outra "NR-01, NR-06, NR-09, NR-17 e NRs setoriais" apontando para a página-índice.

### 7.3 Parser e lista liberada

- `GENERATION_ALLOWED_NORMAS` = **NR-01, NR-07, NR-15, NR-16, CLT, LEI-8213, DEC-3048, LEI-13709** (`provisions.service.ts`; NR-07 e LEI-13709 desde 2026-10-10); as demais normas só pelo dry-run ou por `PROVISIONS_GENERATE_EXTRA_NORMAS` (seção 4).
- Medição em memória (Task 1): NR-01 = 163 dispositivos / 77,9% no texto antigo e 178 / 74,7% no novo; anexos 1 e 2 reconhecidos. O **Anexo I é um glossário sem itens numerados**: não gera dispositivos, então definições (ex.: "perigo", "risco ocupacional") não têm endereço para ligação. NR-15 (316 / 67,7%) e NR-16 (89 / 91,3%) ficaram idênticas.
- `PARSER_VERSION` continua `/1` embora a saída da NR-01 tenha mudado — nada foi gravado em banco persistente; a partir do primeiro `--apply` em produção, QUALQUER mudança de saída do parser exige nova versão.

### 7.4 Importador das regras GRO/PGR

- Comando: `npm run db:import-normative-rules` (`backend/db/import-normative-rules.ts`); seed `backend/db/seed-data/normative-rules/gro-pgr.json`: **15 regras, 58 ligações, todas `rascunho`**; cada ligação tem um fragmento obrigatório `contem`, conferido contra o literal resolvido.
- **Dry-run por padrão** (`BEGIN READ ONLY`). `--apply` grava numa única transação; é idempotente; **nunca** toca regra `revisada`/`revisar`/`retirada` e **nunca** grava `revisada`. Aborta sem gravar NADA se qualquer ligação não resolver ou se o fragmento não estiver no texto.
- **Contra o texto atual de produção (NR-01 antiga) ele aborta**: 33 das 58 ligações são barradas (11 não encontradas + 22 com texto divergente; medição em memória de `backend/test/gro-pgr-seed.unit-spec.ts`). Isso é esperado e protetor; só passa depois de 7.2 (texto novo aprovado e dispositivos gerados).
- Atualizar uma regra `rascunho` **substitui** as ligações dela pelas do seed (ligações manuais nela se perdem).
- 🔒 Onde rodar: como o gerador, o importador precisa de `src` e `tsx`, que a imagem de produção não tem (seção 4). Rodar de um container descartável com o repositório montado (como no ensaio) ou pelo método que o proprietário escolher — **decisão do proprietário; NÃO VERIFICADO em produção**. O `--apply` em produção exige backup do dia e "pode" explícito.
- Testado em Postgres 16 descartável (VERIFICADO): dry-run gravou 0; `--apply` criou 15 regras / 58 ligações; segunda execução: 15 inalteradas; regra já revisada foi ignorada e manteve a edição manual.
- Revisão das regras: seção 5 (`POST /normative-rules/:id/review`; o corpo leva só `registro` — a área já está na regra e campo a mais devolve 400). Listar: `GET /normative-rules?area=gro_pgr`. Rascunho não é norma nem parecer; só profissional habilitado revisa.

### 7.5 Migration 0073 (referência)

Segunda migration em produção (a `0072` já está aplicada, tabelas vazias): renomeia `lip_rules` → `normative_rules` e `lip_rule_provisions` → `normative_rule_provisions`, acrescenta `area` (`lip` | `gro_pgr`, **sem DEFAULT** depois da migration — linhas existentes ficam `lip`) e amplia `categoria` com CHECK área × categoria (GRO inclui `estrutura_pgr`). 🔒 Aplicar **sozinha**, após backup novo, como `postgres`, `--single-transaction`, **antes** do deploy do backend reconciliado — procedimento completo no passo 4a da seção 0.5 (não repetido aqui). Testada em Postgres 16 descartável (VERIFICADO): com regra LIP já `revisada`, dados, status e vínculo sobrevivem; repetir a `0073` aborta com mensagem clara; o trigger renomeado ainda barra `revisada` sem dispositivo ativo.

Depois dela vem a `0074` (área `previdenciario`; passo 4b da seção 0.5), também antes do backend reconciliado. Depois da `0074` vem a `0075` (área `saude_ocupacional`; passo 4c da seção 0.5), também antes do backend reconciliado.

### 7.6 Fontes em `erro` e descoberta de versões (pendência, também do LIP/CLT)

- Fontes com `last_check_status = erro` em produção em 2026-10-09 (consulta somente leitura): CLT `del5452.htm` (cadastrada como "NR-15 e NR-16"), `d3048.htm`, `d4882.htm`, `l8212cons.htm`, `l8213cons.htm`, e as entradas TNU "temas representativos" e STF "tema 555". **Causa NÃO estabelecida para as fontes não-Planalto; para as do Planalto ela foi estabelecida em 2026-10-10 (seção 8.1).** Pendência também para o LIP: o texto da CLT (arts. 189–197, seção 1.1) depende de uma fonte que funcione.
- A maioria das fontes de NR usa nome de arquivo versionado (ex.: `nr-09-atualizada-2026.pdf`): uma substituição publicada sob **nome novo** nunca é detectada (é o caso da NR-01, 7.1). RECOMENDADO (não implementado): descoberta de versões pela página-índice do MTE. Decisão e implementação futuras do proprietário.

## 8. Base previdenciária (Lei 8.213, Decreto 3.048, CLT)

> Origem: spec `docs/superpowers/specs/2026-10-10-base-normativa-previdenciario-design.md`, plano `docs/superpowers/plans/2026-10-10-base-normativa-previdenciario.md`, relatórios `.superpowers/sdd/2026-10-09-base-normativa-lip/prev-task{1,2,3}-report.md`; material do proprietário (não normativo): `docs/reference/previdenciario-ltcat-ppp-insumos-2026-10-10.md`.
> 🔒 = muda produção. **Tudo abaixo é texto para o proprietário executar; NADA foi executado pelo agente.** Medições: VERIFICADO pelo controlador em 2026-10-09/10, salvo indicação.

### 8.1 Estado de produção e causa do download

- As fontes previdenciárias estão cadastradas e **vazias**: Lei 8.213 (`l8213cons.htm`), Decreto 3.048 (`d3048.htm`), Decreto 4.882, Lei 8.212 e a CLT (`del5452.htm`, cadastrada com `code` "NR-15 e NR-16") estão com `last_check_status = erro` ("fetch failed", 8 falhas seguidas desde 2026-10-01) e **sem documento vigente**. As fontes "portalin" do INSS guardam 9 caracteres.
- **Causa (VERIFICADO, testado de dentro do container do backend de produção):** o Planalto derruba a conexão (ECONNRESET) em requisições **sem User-Agent**. O monitor implantado (`0969bb7-esocial-wip2`, `dist/src/normative/normative-monitor.service.js`, ~linha 132) chama `fetch(url, { signal })` sem cabeçalhos. Com o `MONITOR_FETCH_HEADERS` (User-Agent) do código novo, as três páginas respondem 200 (755 KB, 2,4 MB, 3,5 MB). **O download só é corrigido pelo deploy do backend reconciliado** (as fatias do monitor já previstas em `release-monitor-normativo-2026-10-09.md`).

### 8.2 Extração nova (só `*.planalto.gov.br`) e medições

- `extractHtmlText(..., PLANALTO_EXTRACT_OPTIONS)` descarta a redação revogada riscada (`<strike>`, `<s>`, `text-decoration: line-through`) e mantém "(Redação dada pela…)"; `decodeHtmlBuffer` passa a mapear os bytes 0x80–0x9F como pontuação windows-1252.
- Medido nas páginas reais: CLT arts. 189–197, Lei 8.213 arts. 57 e 58 (+§§ 1º–4º) e Decreto 3.048 arts. 64–69 saem com a redação **vigente**. Cobertura (medição da Task 1; números atuais no item "Rodada final" abaixo): CLT 93,9% (2163 dispositivos), Lei 8.213 93,3% (614), Decreto 3.048 94,3% (2281). O art. 70 do Decreto 3.048 está inteiramente revogado ("Art. 70. (Revogado pelo Decreto nº 10.410, de 2020).") — não há dispositivo, nada a citar. **Antes** da correção, os arts. 189, 190, 191, 194 e 195 da CLT saíam com a redação revogada. Os 36 textos de NR geram dispositivos idênticos. Os literais mantêm a forma da fonte (ex.: `Art. . 189 -`, `Art.194 -`, `§ 1 o`).
- A extração muda o hash do texto dos documentos do Planalto. Como nenhum está vigente, nenhuma aprovação é invalidada, mas **a extração nova precisa estar no ar ANTES da primeira aprovação**.
- **Rodada final de correções (2026-10-10, VERIFICADO em memória nas 3 páginas de 2026-10-09):** o modo Planalto também decodifica entidades HTML (`&quot;`, `&#150;` → "–", `a&#768;` → "à"; `decodeHtmlEntities` + NFC); o parser `lei` encerra o último artigo na cauda do documento (assinatura "Brasília, … da República.", "Este texto não substitui…", `ANEXO` / `A N E X O`) e registra a anomalia `cauda_nao_classificada`; `<br>` passa a separar dispositivos na regra do texto riscado (artigo vigente entre trechos riscados não vira revogação falsa) e `<strike>` não fechado termina na primeira quebra de linha. Números novos: **CLT 2189 dispositivos / 90,1%** (antes 2163 / 93,9%: o art. 922 tinha 24 314 caracteres com o Quadro do art. 577 — agora 172; +26 incisos com meia-risca `&#150;` que antes ficavam colados no pai, e o art. 2 deixa de ser ambíguo), **Lei 8.213 615 / 93,1%** (antes 614 / 93,3%: art. 156 sem assinaturas; +1 inciso `&#150;`), **Decreto 3.048 2281 / 94,1%** (antes 2281 / 94,3%: art. 382 sem o Anexo I). Os 36 textos de NR geram dispositivos idênticos. Detalhes: `.superpowers/sdd/2026-10-09-base-normativa-lip/prev-fixwave-report.md`.
- ⚠️ **ORDEM DE RELEASE (I2):** o User-Agent (`MONITOR_FETCH_HEADERS`) e um `decodeHtmlBuffer` SEM a correção dos bytes 0x80–0x9F já estão **commitados** no `dbda6cb` (branch `feat/conformidade-por-nr`, já no remoto). A extração nova do Planalto — `html-struck.ts`, `PLANALTO_EXTRACT_OPTIONS`, a correção windows-1252 do `decodeHtmlBuffer`, `decodeHtmlEntities` — **só existe na árvore de trabalho, sem commit**. Se as fatias do monitor subirem SEM ela, o download passa a funcionar e o Planalto gera pendentes pela extração **ANTIGA**: a CLT sai com os arts. 189, 190, 191, 194 e 195 na redação **REVOGADA**. **Não aprovar nenhum documento do Planalto que não tenha sido gerado pela extração nova; rejeitar pendentes anteriores a ela.** A trava de `generate()` olha só o nome da norma, não a versão do extrator. Rede de segurança só parcial: o `contem` das ligações do importador falharia contra a redação revogada (o importador aborta), mas a aprovação e a geração de dispositivos não são barradas.

### 8.3 Códigos das fontes e procedimento (🔒, ordem obrigatória)

- Na tela de fontes (`/admin/normativa`) o proprietário define o `code`, que o gerador usa para resolver a norma (`resolveKind`): `CLT` (hoje "NR-15 e NR-16"), `LEI-8213`, `DEC-3048`. `GENERATION_ALLOWED_NORMAS` = NR-01, NR-07, NR-15, NR-16, CLT, LEI-8213, DEC-3048, LEI-13709. `LEI-8212` e `DEC-4882` têm parser mas **não** estão liberadas. `code` é UNIQUE (migration 0052): o valor antigo da CLT precisa ser trocado, não duplicado.
1. 🔒 Backup e migration `0074` (seção 0.5, passos 4a/4b), antes do backend.
2. 🔒 Deploy do backend reconciliado (passo 5 da seção 0.5) — corrige o download e traz a extração nova.
3. 🔒 Editar o `code` das três fontes.
4. 🔒 "Verificar agora"; conferir o tamanho do texto extraído (ordem de grandeza da seção 8.2) e o `content_hash` do documento pendente.
5. 🔒 Aprovar (exige crédito de embeddings no OpenRouter; ver 8.4).
6. 🔒 Gerar dispositivos: rota `POST /normative-provisions/generate/:documentId` (o CLI exige `src`/`tsx`, que a imagem de produção não tem — seção 4). Dry-run antes, quando possível fora de produção.
7. 🔒 Importador, com o caminho do seed: `npm run db:import-normative-rules -- db/seed-data/normative-rules/previdenciario.json` (dry-run) e depois `npm run db:import-normative-rules -- db/seed-data/normative-rules/previdenciario.json --apply`; mesmo local de execução da seção 7.4. **Os argumentos vão depois de `--` (M5):** sem ele o npm consome `--apply` como opção dele e o importador roda dry-run em silêncio (vale também para o seed GRO/PGR da seção 7.4).

### 8.4 Embeddings: volume e RISCO no tempo da aprovação

- **Volume (VERIFICADO, chunker do repositório: 2000 caracteres, sobreposição 200):** as três leis somam **782 chunks** (CLT 350, Lei 8.213 94, Decreto 3.048 338; a NR-01 nova tem 30). É **uma chamada de embedding por chunk, em sequência**, dentro de uma requisição HTTP síncrona (`POST /normative-documents/:id/approve`). `nginx/conf.d/default.conf:59` tem `proxy_read_timeout 300s`. O maior documento aprovado até hoje é uma NR (~100 chunks).
- **INFERIDO / NÃO MEDIDO:** aprovar a CLT ou o Decreto 3.048 pode passar de 300 s, dependendo da latência do provedor.
- **O que o código mostra (VERIFICADO em `normative-documents.controller.ts` ~53-58, `normative-documents.service.ts` e `common/embedding/openrouter-embedding.service.ts` ~29-52):** `approve` faz `prepareApproval` → `computeEmbeddedChunks` (todos os embeddings, **FORA** do `finalizeApproval` e sem transação aberta) → `finalizeApproval`. Cada embedding tem `AbortSignal.timeout(30_000)` (30 s por chunk), **sem retry**, e qualquer falha (rede, status não-2xx, JSON inválido, resposta sem vetor, falta de crédito) lança `502 BadGateway`.
- **Falha do provedor no meio da aprovação (I3, corrige a versão anterior desta seção):** UMA falha em qualquer uma das ~782 chamadas (ou a falta de crédito) **aborta a aprovação inteira** antes do `finalizeApproval`: o documento **CONTINUA `aguardando_validacao`**, nada é gravado e **todo o custo dos embeddings já calculados se perde** (não há cache nem retomada). O caso "`vigente` com `indexed_at` nulo" só ocorre em falha de **SQL** dentro do savepoint do `finalizeApproval`, não em falha do provedor. **Clicar de novo enquanto a primeira requisição ainda roda paga os embeddings em dobro** (o comentário em `nginx/conf.d/default.conf` diz que o backend termina o trabalho mesmo quando o cliente recebe 504; lido no código: a segunda requisição passa pelo `prepareApproval`, calcula todos os embeddings de novo e só no `finalizeApproval` encontra o status já mudado e termina em 409). **NÃO CONFIRMADO em execução:** comportamento exato do servidor quando o cliente desconecta — INFERIDO que o handler continue.
- RECOMENDADO (nada implementado; nenhuma mudança de infraestrutura pelo agente — decidir com o proprietário): (1) medir a latência por chunk num documento pequeno antes; (2) garantir crédito suficiente no OpenRouter **antes** de aprovar a CLT/Decreto/Lei; (3) **não clicar de novo** em "Aprovar" enquanto a primeira requisição pode estar rodando (mesmo depois de timeout do navegador/nginx); (4) depois, conferir `status` e `indexed_at`: `aguardando_validacao` = falhou (aprovar de novo só depois de resolver a causa); `vigente` com `indexed_at` preenchido = deu certo; **só** `vigente` com `indexed_at` nulo pede `POST /normative-documents/:id/reindex`. Opcional, só com autorização do proprietário: aprovar pela rede interna sem passar pelo nginx (`proxy_read_timeout 300s`, `nginx/conf.d/default.conf:59`).

### 8.5 Migration `0074` e seed

- `0074_normative_rules_previdenciario.sql` é a terceira migration em produção (depois da `0072` e da `0073`): 🔒 aplicar **sozinha**, como `postgres`, `--single-transaction`, com `PGOPTIONS` de `lock_timeout`, após backup novo, antes do backend reconciliado (passo 4b da seção 0.5). **Não usar `npm run db:migrate` desta árvore (M6):** ele aplicaria junto a `0063_sst_audit_document_facts.sql` (outra feature, sem commit), a `0073` e a `0074` — só `psql`, **um arquivo por vez**. Testada em Postgres 16 descartável (VERIFICADO): a guarda aborta sem a `0073`; repetir aborta; regra LIP já `revisada` sobrevive; a matriz área × categoria é imposta pelo banco.
- Seed `backend/db/seed-data/normative-rules/previdenciario.json`: **21 regras, todas `rascunho`**, área `previdenciario`, **66 ligações** (CLT 2, LEI-8213 16, DEC-3048 48), cada uma com fragmento literal obrigatório `contem` (cada `contem` aparece 1 vez no documento inteiro, medido nas 3 páginas). (Antes da rodada final: 18 regras / 51 ligações; o ensaio em Postgres descartável — dry-run 0, `--apply` 18/51, segunda execução inalterada — foi com essa versão.) Contra o estado atual de produção (sem texto vigente) o importador **aborta sem gravar nada**. O importador também **aborta** se uma ligação cair em dispositivo revogado (`isRevokedLiteral`: "(Revogado…)", "Revogado.", "I - revogado;", "(Declarado inconstitucional…)").
- Idades: 55/58/60 são literais no Decreto 3.048 art. 64 I–III; o mesmo Decreto, **art. 188-P**, prevê para os filiados ao RGPS até 13/11/2019 pontos (66/76/86) e tempo de efetiva exposição (15/20/25), ressalvado o direito de opção (regra `PREV-APOSENTADORIA-ESPECIAL-TRANSICAO`). A conversão de tempo especial em comum (Lei 8.213 art. 57 § 5º) tem o limite literal do **Decreto 3.048 art. 188-P § 5º** ("aplica-se somente ao trabalho prestado até 13 de novembro de 2019"); a tabela desse § 5º é uma **imagem** na página e não foi extraída. A soma de atividades especiais diferentes (Decreto art. 66) é regra separada. O art. 188-P § 6º (legislação em vigor à época da prestação do serviço) tem regra própria.
- **Fora do seed por falta de base literal:** PPP eletrônico desde 01/01/2023, eSocial S-2240/Tabela 24, IN PRES/INSS 128/2022 (URL oficial NÃO VERIFICADA; a URL cadastrada do INSS devolve 9 caracteres) e "EPI não é prova automática". **Anexo IV do Decreto 3.048 (M8):** a remissão a ele é literal (Decreto art. 68: "é aquela constante do Anexo IV"); só o **conteúdo** do Anexo IV (tabela) não foi ingerido — o parser para no `A N E X O I` (cauda).
- Rascunho não é norma nem parecer; na área previdenciária a revisão exige também revisão previdenciária/jurídica por profissional habilitado.

### 8.6 Pendências do proprietário

Editar o `code` das três fontes; deploy reconciliado; crédito de embeddings; decidir o tratamento do risco da seção 8.4; fornecer/verificar URLs oficiais da IN PRES/INSS 128/2022 e do MOS/leiautes do eSocial; nome e registro do revisor (e revisão previdenciária/jurídica); fonte `NR1` nunca verificada; fontes em `erro` sem relação com o Planalto (CAEPI 403, STF 403, portal TNU).

## 9. Saúde ocupacional (NR-07, CLT 168/169, LGPD)

> Origem: spec `docs/superpowers/specs/2026-10-10-base-normativa-saude-ocupacional-design.md`, plano `docs/superpowers/plans/2026-10-10-base-normativa-saude-ocupacional.md`, relatórios `.superpowers/sdd/2026-10-09-base-normativa-lip/saude-task{1,2,3}-report.md`; material do proprietário (não normativo): `docs/reference/saude-ocupacional-pcmso-aso-insumos-2026-10-10.md`.
> 🔒 = muda produção. **Tudo abaixo é texto para o proprietário executar; NADA foi executado pelo agente.** Medições: VERIFICADO em 2026-10-10 (leitura / em memória), salvo indicação.

### 9.1 NR-07 em produção está ATUAL

- VERIFICADO: o texto vigente da NR-07 em produção é idêntico byte a byte ao PDF oficial `nr-07-atualizada-2022-1.pdf` (página do MTE atualizada em 02/06/2025; última portaria listada: SEPRT nº 8.873/2021). **Não há troca de URL nem nova aprovação para a NR-07** (ao contrário da NR-01, §7.1). Limite: vale até a data da página; **não substitui o DOU**.
- Falta só **gerar os dispositivos** da NR-07, e **somente depois do deploy reconciliado**: o backend em produção não tem o gancho de obsolescência (ver "Registro de execução"). Dry-run antes (seção 4).

### 9.2 LGPD (Lei 13.709/2018): fonte NÃO cadastrada

- 🔒 O proprietário cadastra a fonte na tela `/admin/normativa` com `code` = `LEI-13709` e URL `https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/L13709compilado.htm` (HTTP 200 com User-Agent; página compilada de 231 KB; texto extraído de 79 435 caracteres ≈45 chunks, aprovação pequena comparada à seção 8.4).
- O monitor precisa da extração nova e do User-Agent do deploy reconciliado (mesmo alerta da seção 8.2, I2): **nunca aprovar documento do Planalto gerado pela extração antiga.**
- A CLT (`code` `CLT`, a editar como na seção 8.3) fornece os arts. 168 e 169, com a redação vigente recuperada pela extração nova.

### 9.3 Parser e lista liberada

- Duas correções determinísticas no parser (Task 1): (a) o art. 5 da LGPD (definições, inclusive dado pessoal sensível) estava perdido porque o art. 57 vetado tem o número partido em dois `<span>` (`Art. 5` + `7.`), o que gerava um falso 2º `art. 5` e a colisão `item_ambiguo`; número partido por espaço seguido de `.`/`º`/`°` agora é um número só; (b) título de quadro em duas linhas (NR-07, Anexo 3) não abre mais seção: os itens saem como `3|3…3.7`, não `3/POEIRA CONTENDO SÍLICA, ASBESTO OU CARVÃO MINERAL|…`.
- `GENERATION_ALLOWED_NORMAS` = NR-01, NR-07, NR-15, NR-16, CLT, LEI-8213, DEC-3048, LEI-13709 (seção 4).
- Medição em memória: NR-07 = **198 dispositivos / 75,6%** (o Anexo I é de quadros: 0 dispositivos; itens do corpo recuperados, incl. 7.5.6, 7.5.8–7.5.11, 7.5.19, 7.5.19.1, 7.6.x); LGPD = **415 / 96,2%** (antes 414 / 96,1%). As outras 35 NRs, CLT, Lei 8.213 e Decreto 3.048 saem idênticas.
- `PARSER_VERSION` continua `/1` (nada gerado em banco persistente); a partir do primeiro `--apply` em produção qualquer mudança de saída exige nova versão (seção 7.3).
- Quirk conhecido (M8, VERIFICADO em memória, mantido de propósito): o literal do dispositivo `3|2.17.2` da NR-07 (Anexo 3) termina com a linha `QUADRO 1 - PERIODICIDADE DOS EXAMES RADIOLÓGICOS PARA EMPREGADOS EXPOSTOS`. Nenhuma regra liga esse dispositivo.

### 9.4 Migration `0075`

- `0075_normative_rules_saude_ocupacional.sql` é a quarta migration das regras (depois da `0072`–`0074`): 🔒 aplicar **sozinha**, como `postgres`, `--single-transaction`, com `PGOPTIONS` de `lock_timeout`, após backup novo, **estritamente depois da `0074`** e antes do backend reconciliado (passo 4c da seção 0.5). **Não usar `npm run db:migrate`:** arrastaria a `0063` e as demais — só `psql`, **um arquivo por vez**.
- Testada em Postgres 16 descartável (VERIFICADO): a guarda aborta sem a `0074`; repetir aborta; regras das três outras áreas preservadas; matriz área × categoria imposta pelo banco; e2e 20/20.

### 9.5 Seeds de saúde ocupacional e importador

- **Dois seeds** (rodada de correções de 2026-10-10; mesmos `rule_key`, nenhuma regra nos dois, área `saude_ocupacional`, todas `rascunho`, 21 regras / 65 ligações no total), cada ligação com fragmento literal obrigatório `contem`:
  - `backend/db/seed-data/normative-rules/saude-ocupacional-nr07.json`: **12 regras / 29 ligações, todas à NR-07**. Pode ser importado **assim que os dispositivos da NR-07 forem gerados** (NR-07 já vigente em produção; não exige aprovar nada novo).
  - `backend/db/seed-data/normative-rules/saude-ocupacional.json`: **9 regras / 36 ligações** (CLT 11, LEI-13709 19, NR-01 4, NR-07 2 — regras mistas ficam aqui). Só resolve depois de **CLT + NR-01 nova + LEI-13709 aprovadas e com dispositivos gerados**.
- O prefixo `SAU-` agora é imposto pelo **importador** (`PREFIXOS_POR_AREA`: `gro_pgr` GRO-/PGR-, `previdenciario` PREV-, `saude_ocupacional` SAU-; `lip` sem prefixo), além do teste.
- **Dependência da NR-01 (corrige a versão anterior):** contra a NR-01 **antiga** que está em produção, as ligações 1.8.6, 1.8.7 e 1.8.8 **resolvem** com o mesmo `contem`; **só a 1.8.7.1 falha** — na redação anterior o mesmo texto ("A dispensa do PCMSO não desobriga… exames médicos e emissão do ASO") é o **1.8.6.1**; no PDF oficial de 26/05/2026 ele aparece numerado **1.8.7.1 e antes do 1.8.7**. INFERIDO: provável erro de numeração do PDF. A regra `SAU-DISPENSA-PCMSO-MEI-ME-EPP` traz uma NOTA AO REVISOR: se o MTE corrigir a numeração, a ligação deixa de resolver e a regra deve ir para `revisar`. Fixado por teste (`saude-ocupacional-seed.unit-spec.ts`, plano com a NR-01 antiga).
- **A CLT é a aprovação mais arriscada** desta área: ≈350 chunks numa requisição síncrona, com o nginx em `proxy_read_timeout 300s` (seção 8.4). Por isso o seed só da NR-07 foi separado: não fica preso à CLT, à NR-01 nova nem à LGPD.
- O importador confere só o dispositivo do endereço (existe, é único, não revogado, contém o `contem`); ele **não** confere a unicidade do `contem` no documento inteiro. Essa unicidade é testada no teste unitário (NR-07 e NR-01 inteiras; CLT/LGPD só no trecho versionado — nas páginas inteiras do Planalto foi conferida fora do teste, VERIFICADO em memória em 2026-10-10).
- **Contra produção hoje o importador ABORTA sem gravar nada** (NR-07 sem dispositivos gerados; CLT/LGPD não aprovadas). Ensaio anterior à divisão, contra banco descartável com NR-07, NR-01 nova, CLT e LGPD vigentes (VERIFICADO pelo controlador): dry-run gravou 0; `--apply` criou 21 regras / 63 ligações; segunda execução inalterada. A divisão e as 2 ligações novas (LGPD art. 11 §4 incisos I e II) foram validadas só em memória (NÃO VERIFICADO em banco).
- 🔒 Comandos (fora da imagem de produção, como na seção 7.4; **dry-run primeiro**; os argumentos vão depois de `--`, senão o npm consome `--apply` e roda dry-run em silêncio):
  1. assim que os dispositivos da NR-07 existirem: `npm run db:import-normative-rules -- db/seed-data/normative-rules/saude-ocupacional-nr07.json` (dry-run); conferido o plano, `npm run db:import-normative-rules -- db/seed-data/normative-rules/saude-ocupacional-nr07.json --apply`;
  2. depois de CLT, NR-01 nova e LEI-13709 aprovadas e geradas: `npm run db:import-normative-rules -- db/seed-data/normative-rules/saude-ocupacional.json` (dry-run); conferido o plano, o mesmo com `--apply` no fim.
- **Lacuna da NR-07 (decisão do proprietário):** os itens 7.4.1, 7.5.2, 7.5.12–7.5.18 e 7.5.19.6 não estão ligados a nenhuma regra (inclui a periodicidade dos exames dos Quadros 1 e 2 do Anexo I, 7.5.13 e 7.5.14). Nenhuma regra nova foi criada nesta rodada.

### 9.6 Fora do seed por falta de base literal (NÃO VERIFICADO; nada ingerido)

- eSocial S-2220 e seu prazo (dia 15 do mês seguinte), MOS S-1.3 / Nota Orientativa nº 08/2026, Tabela 24, ANPD e listas "ilustrativas" de exames complementares.
- Princípios de IA ("a IA não diagnostica nem decide aptidão"; "não enviar prontuário a modelo externo"): princípios do Assistente/AGENTS.md, não norma; sem mudança de prompt ou modelo.
- O módulo eSocial S-2220 já existe no worktree `/opt/montese-esocial` (não está em produção) e o pente-fino tem a verificação PCMSO↔PGR: **não duplicar**.

### 9.7 Pendências do proprietário

Cadastrar `LEI-13709`; deploy reconciliado; crédito de embeddings (aprovação da LGPD ≈45 chunks, além das já listadas); trocar a URL da NR-01 (seção 7) para a ligação 1.8.7.1 resolver (as outras 3 já resolvem contra a antiga); decidir sobre a lacuna de itens da NR-07 (seção 9.5); autorizar a `0075` (depois da `0073`/`0074`); revisor = médico do trabalho/profissional habilitado (e revisão jurídica para as regras de LGPD); URLs oficiais do MOS/leiautes do eSocial e da ANPD. Rascunho não é norma nem parecer.

## Registro de execução (2026-10-09)

Passos 1–4 da §0.5 executados em produção com autorização do proprietário: backup `montese-20261009-182048.dump` (local + R2,
`pg_restore -l` íntegro), `0072_lip_normative_base.sql` aplicada sozinha como `postgres` em transação única, grants conferidos
(`montese_app` com `SELECT/INSERT/UPDATE/DELETE`), tabelas vazias, backend em produção inalterado (`0969bb7-esocial-wip2`).
**Passo 5 (deploy do backend com a feature) NÃO executado** — depende de árvore reconciliada com o eSocial (ver passo 5).

### Reconciliação e geração de dispositivos (medido em leitura, 2026-10-09)

- **Texto em produção = texto do repositório:** o `content_hash` completo (sha256) dos documentos vigentes NR-15 e NR-16 em produção é
  idêntico ao do arquivo em `backend/db/seed-data/normative-sources/`. O dry-run em produção reproduziria o já medido (NR-15 ≈ 316
  dispositivos / 67,7%; NR-16 ≈ 89 / 91,3%); por isso não foi necessário usar a credencial do banco de produção.
- **Custo da reconciliação (produção atual + este pacote):** `git merge-tree` entre `feat/conformidade-por-nr` e `feat/esocial-transmissao`
  não aponta conflito; o eSocial não alterou `normative.module.ts`, `normative-documents.service.ts` nem `package.json`, e não tem
  migration acima da `0071`. Atenção: `feat/conformidade-por-nr` está 13 commits à frente de `0969bb7` (o eSocial, 1), então o deploy
  reconciliado também levaria esses 13 commits — revisar o que são antes.
- **NÃO gerar dispositivos em produção antes do deploy do backend com o gancho.** O backend atual não obsoleta dispositivos quando uma norma
  é substituída ou retirada: aprovar uma nova versão da NR-15 por ele deixaria dispositivos `ativo` de um documento que já não vale.
  Gerar (`--apply`) só depois do deploy reconciliado.
