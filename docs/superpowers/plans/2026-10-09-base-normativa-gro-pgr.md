# Base normativa GRO/PGR (NR-01) Implementation Plan

> **For agentic workers:** execute task-by-task (superpowers:subagent-driven-development). Steps use checkbox syntax. **Desvio declarado do formato padrão:** as tasks abaixo trazem objetivo, interfaces e critérios de aceite (não o código inteiro); o implementador é um modelo capaz e decide o desenho dentro desses limites.

**Goal:** Generalizar a camada de regras para outras áreas, preparar a NR-01 vigente (26/05/2026) para gerar dispositivos e entregar regras GRO/PGR em rascunho, versionadas no git e ligadas a trechos literais.

**Architecture:** parser reconhece `Anexo X da NR-xx` → migration `0073` renomeia `lip_rules`→`normative_rules` e adiciona `area` → código/rotas renomeados → seed JSON + importador idempotente → docs. Nada em produção.

**Tech Stack:** NestJS, TypeScript, PostgreSQL (`pg`), class-validator, Jest, tsx.

**Spec:** docs/superpowers/specs/2026-10-09-base-normativa-gro-pgr-design.md

## Global Constraints
- **Sem escrita git** (add/commit/stash/checkout/reset) e **sem formatadores** (prettier etc.) — o proprietário decide commits; um incidente anterior reformatou arquivos alheios.
- **Sem banco de produção, sem docker, sem rede** nas tasks; testes unitários apenas (`NODE_OPTIONS=--experimental-vm-modules npx jest --config ./test/jest-unit.json <padrão> --forceExit`), `npx tsc --noEmit -p tsconfig.json`, `npm run build`, suíte unitária inteira (única falha aceita: `r2-get-object`). e2e/ensaio em banco descartável: o controlador roda (receita `reference_ensaio_descartavel_isolado`; migrations aplicadas como SUPERUSUÁRIO).
- Tabelas globais: **sem `tenant_id`, sem RLS**; rotas só `@Roles('admin')`; `req.withTenantContext`. Nunca inventar texto normativo: fixture real com origem e sha256; o que não for real, marcar SINTÉTICO. Não alterar provider/modelo/prompt de IA.
- Migration nova: `0073` (confirmar livre: produção tem até `0072`; o branch do eSocial não tem acima da `0071`). A `0072` NÃO é editada.
- Texto da NR-01 vigente (fixture): `backend/test/fixtures/normative/NR-01-vigente-2026-05-26.txt` — extraído com `pdf-parse` do PDF oficial `…/normas-regulamentadoras-vigentes/nr-01-atualizada-2025-i-3.pdf` (sha256 do PDF `39e0ced67472db5f6f93235ce5532701247a1b7dddf39fb866c379e605b32a21`; sha256 do texto extraído `afaf953765022672dd058ba385ace393be6b88f5612cbb03a8e5219a2d662fb0`; baixado em 2026-10-09). Texto antigo (produção): `backend/db/seed-data/normative-sources/NR-01.txt`.

## File Structure
Modify `backend/src/normative/provision-parser.ts`, `provisions.service.ts` (lista liberada), `provision-lifecycle.ts`, `lip-rules.service.ts`→`normative-rules.service.ts`, `lip-rules.controller.ts`→`normative-rules.controller.ts`, DTOs `*-lip-rule.dto.ts`→`*-normative-rule.dto.ts`, `normative.module.ts`, testes `lip-*`. Create `backend/db/migrations/0073_normative_rules_generalization.sql`, `backend/db/seed-data/normative-rules/gro-pgr.json`, `backend/db/import-normative-rules.ts` (+ script `db:import-normative-rules`), `docs/reference/gro-pgr-modulo-insumos-2026-10-09.md`; update `docs/operations/runbook-ingestao-lip.md` e `release-base-normativa-lip-2026-10-09.md`.

---
### Task 1: Parser reconhece `Anexo <id> da NR-<n>` e NR-01 liberada
- [ ] Teste (RED) com trecho REAL do fixture (linhas ~574 e ~692: `Anexo I da NR-01`, `Anexo II da NR-01`) e uma linha de sumário (`Anexo I - Termos e definições`, linha ~31) que NÃO pode virar anexo.
- [ ] Implementar no `provision-parser.ts`: linha curta e sozinha `Anexo <id> da NR-<n>` (sem pontuação final) = anexo novo (id normalizado: romano→arábico). Sem regressão.
- [ ] **Aceite medido em memória (script no scratchpad):** NR-01 (fixture novo e `NR-01.txt` antigo) sem `anexo_nao_reconhecido`; relatório por anexo mostra os anexos `1` e `2`; invariante 0 violações nas 36 NRs do seed; **NR-15 e NR-16 idênticas** (316 disp./67,7% e 89/91,3%; compare lista completa de (anexo,item_path,char_start,char_end) antes/depois para todas as 36 NRs e liste as que mudaram — mudança em outra NR deve ser justificada ou revertida). Informe a contagem de NRs afetadas.
- [ ] Se (e só se) o critério acima passar: acrescentar `'NR-01'` a `GENERATION_ALLOWED_NORMAS` em `provisions.service.ts` e ajustar os testes/mensagens ("validado para NR-01, NR-15 e NR-16"); runbook idem. Caso contrário, NÃO liberar e relatar o motivo.
- Produz: `parseProvisions` aceitando a nova forma; `GENERATION_ALLOWED_NORMAS` possivelmente com NR-01.

### Task 2: Migration `0073` + renomeação `lip_*` → `normative_*`
- [ ] Escrever `0073_normative_rules_generalization.sql` (conforme spec §3.2): renomear tabelas, constraints, índices; `CREATE OR REPLACE FUNCTION` do trigger com corpo novo + renomear função e trigger; `area` com CHECK; `categoria` ampliada com CHECK de coerência `area`×`categoria`. Aditiva e transacional. **Não editar a `0072`.**
- [ ] Teste estático da migration (padrão de `lip-normative-migration.unit-spec.ts`: ignora comentários SQL; sem `tenant_id`/RLS; sem DROP/TRUNCATE de dados; contém o `CREATE OR REPLACE FUNCTION`).
- [ ] Renomear código: `NormativeRulesService`, controller `/normative-rules` com filtro `?area=`, DTOs (`area` obrigatório no create, ausente no update), `provision-lifecycle.ts` (SQL com os nomes novos), `normative.module.ts`, testes unitários e e2e (`lip-normative-base.e2e-spec.ts` → `normative-rules-base.e2e-spec.ts`, com casos novos: coerência `area`×`categoria`, regra `gro_pgr` não pode usar categoria LIP e vice-versa, regras `lip` continuam funcionando). Atualizar todas as referências textuais nos docs do LIP (runbook, release complementar, spec) sem reescrever a história: onde descrevem a `0072`, manter "0072 criou `lip_rules`; a `0073` renomeia".
- [ ] Aceite: unit verde, `tsc`/build limpos, grep sem `lip_rules`/`LipRules` fora de comentários históricos e da própria `0072`/migration `0073`; e2e **só type-check** (o controlador roda no ensaio).
- Consome: Task 1 (nada); Produz: tabelas/rotas/serviço `normative_rules`.

### Task 3: Seed de regras GRO/PGR + importador
- [ ] Localizar no fixture novo os itens literais (anotar item e linhas): composição do PGR, `1.4.1` alínea g (ordem I–IV) e `1.5.5.1.1` (quando adotar), `1.5.4.4.6`/`.6.1`, gatilhos de revisão, itens com "psicossocia", dispensas `1.8.x`, conteúdo do inventário e do plano de ação. Só entra regra com item literal confirmado.
- [ ] Escrever `gro-pgr.json` (campos da spec §3.4; todas `rascunho`; `interpretacao` curta e rotulada; afirmações do material sem item literal ficam **sem ligação** com nota "sem fundamento literal verificado" ou ficam de fora). `rule_key` com prefixo `GRO-`/`PGR-`.
- [ ] Importador `db/import-normative-rules.ts`: dry-run padrão (somente leitura, `BEGIN READ ONLY`), `--apply` grava em transação; idempotente por `rule_key` (upsert só de regras `rascunho`; **nunca altera regra `revisada`/`revisar`/`retirada`** nem grava `revisada`); resolve cada ligação por (norma, anexo, item_path) entre dispositivos `ativo` de documentos `vigente`; **falha sem gravar nada** se alguma ligação não existe; relatório (criadas/atualizadas/ignoradas/ligações). Exportar funções puras para teste (`validateSeed`, `planImport`).
- [ ] Testes: validação do seed contra o fixture (parser em memória → toda ligação existe; todas `rascunho`; `rule_key` únicos; categorias válidas para a área); importador com mock (idempotência, regra revisada intocada, ligação inexistente aborta).
- Consome: Task 2 (tabelas/nomes); Task 1 (dispositivos da NR-01).

### Task 4: Docs
- [ ] `docs/reference/gro-pgr-modulo-insumos-2026-10-09.md`: resumo, em palavras próprias, do desenho de produto do material (fluxo, campos do inventário e do plano de ação, alertas de revisão, exceções, regra central do Assistente), **marcado como material do proprietário, não normativo, NÃO VERIFICADO** onde não há item literal; apontar os itens literais já confirmados.
- [ ] Runbook (`runbook-ingestao-lip.md`): seção NR-01 (trocar a URL na tela de fontes para o PDF vigente; "verificar agora"; revisar diff; aprovar — exige crédito de embeddings), pendência das fontes em `erro` (CLT `del5452.htm`, `d3048`, `d4882`, `l8212cons`, `l8213cons`) e da página `nr-1` nunca verificada. Release complementar: migration `0073` (segunda migration em produção; renomeia tabelas vazias; antes do deploy reconciliado) e o importador.
- Aceite: nenhuma instrução de produção é executada; tudo marcado 🔒 onde muda produção.

## Self-review
Spec §3.1→T1, §3.2/3.3→T2, §3.4→T3, §3.5→T4. Interfaces: nomes `normative_rules`/`NormativeRulesService`/`GENERATION_ALLOWED_NORMAS` consistentes entre tasks.
