# Catálogo de fontes — E2: tipo da fonte (`source_type`) — plano (PROVISÓRIO, sem código)

> **Status: plano provisório, nada executado.** Depende das decisões A–C da spec `docs/superpowers/specs/2026-10-08-catalogo-fontes-por-tipo-e-tema-design.md` (§5). Onde o proprietário ainda não decidiu, este plano usa o **padrão recomendado** e o marca **[DEFAULT]**; se a decisão vier diferente, só os itens marcados mudam.
> Marcadores: VERIFICADO / NÃO VERIFICADO / INFERIDO / RECOMENDADO. Fora de escopo aqui: temas (E3) e Assistente por tema/citação com tipo (E4).

## 1. Decisões assumidas

- **[DEFAULT] A:** fonte `nao_classificada` **continua citável** (comportamento de hoje) até o proprietário classificar; a tela mostra o contador "N fontes sem classificação". Só `descoberta` e `documento_empresa` ficam **fora** das respostas.
- **[DEFAULT] B:** valores de `source_type`: `norma_primaria`, `norma_trabalhista`, `norma_previdenciaria`, `jurisprudencia`, `esocial`, `orgao_oficial`, `descoberta`, `documento_empresa`, `nao_classificada` (padrão).
- **C (temas):** fora da E2.
- **Backfill:** a migration marca como `norma_trabalhista` apenas as fontes cujo `code` casa `^NR-[0-9]+` (VERIFICADO no seed que as NRs usam `NR-xx`); todo o resto fica `nao_classificada` para o proprietário classificar pela tela. Nada é inferido por IA (AGENTS.md: a IA não é autoridade normativa).

## 2. Escopo

1. **Migration aditiva** (número = próximo livre **depois** do merge com o eSocial; hoje a branch vai até `0065`, o eSocial usa até `0071`: conferir): `ALTER TABLE official_sources ADD COLUMN source_type text NOT NULL DEFAULT 'nao_classificada' CHECK (source_type IN (...))` + `UPDATE ... WHERE code ~ '^NR-[0-9]+'`. Sem RLS (a tabela é global). Reversível: `DROP COLUMN` ( ver §6).
2. **Backend:** `OfficialSource` ganha `source_type`; `CreateOfficialSourceDto`/`UpdateOfficialSourceDto` aceitam `source_type` (`@IsIn`, opcional no create → padrão); `OfficialSourcesService.create/update/findAll` o gravam/leem; **`searchReference`** (`normative-assistant.service.ts` ~L675) passa a exigir `s.source_type NOT IN ('descoberta','documento_empresa')` (junto do `s.active = true` da E1); conferir `provisions.service.ts` (gera dispositivos de um documento vigente por `code`; **não** é a busca do Assistente; decidir se também deve respeitar o tipo — INFERIDO que não).
3. **Estados calculados** (spec §2.2) no frontend, sem coluna: DESATIVADA / ERRO_EXTRACAO / PENDENTE_VALIDACAO / URL_ALTERADA / ATIVA — `PENDENTE_VALIDACAO` exige saber se a fonte tem documento aguardando: acrescentar `pending_count` ao `GET /normative-sources` (subconsulta `COUNT(*)` em `normative_documents`), sem N+1.
4. **Tela** (`FontesPanel`): coluna/seleção de tipo no cadastro e na edição; filtro por tipo e por estado; contador "N sem classificação"; aviso quando uma fonte `descoberta`/`documento_empresa` tem documento vigente ("fora das respostas").
5. **Testes:** DTOs; serviço (create/update com tipo; backfill por SQL fica no ensaio isolado); `searchReference` (SQL contém a exclusão de tipos, junto de `s.active = true`); controller (roles); frontend (seleção de tipo, filtros, contador, aviso).

## 3. Tarefas (subagent-driven, sem commits, como as fatias anteriores)

| # | Tarefa | Arquivos principais |
|---|---|---|
| 1 | Migration + `OfficialSource`/DTOs/serviço (`source_type`, `pending_count`) | `backend/db/migrations/00NN_official_sources_source_type.sql`, `official-sources.service.ts`, `dto/*.ts`, specs |
| 2 | `searchReference` exclui `descoberta`/`documento_empresa` (+ teste do SQL) | `normative-assistant.service.ts`, `test/normative-assistant-active-source.unit-spec.ts` (estender) |
| 3 | Tela: tipo, filtros, contador, estados calculados | `FontesPanel.tsx`, `api.ts`, testes |
| 4 | Verificação: tsc, suíte comparada (HEAD limpo vs HEAD+fatia), vitest/eslint/build, QA Playwright, **ensaio isolado da migration** (Postgres descartável: aplicar a migration do zero e sobre dados semeados; backfill `^NR-`), documentação | specs/docs |

## 4. Riscos

- **Número da migration** conflita com o eSocial se criada agora: **não criar o arquivo antes do merge**; este plano só descreve.
- **Excluir `descoberta`/`documento_empresa` das respostas reduz cobertura se alguma fonte útil for marcada errado:** a tela mostra quantas fontes ficaram fora e o proprietário classifica; classificar nunca é automático.
- **Mudança de comportamento do Assistente:** rodar a Camada A antes/depois no ensaio isolado (com autorização).
- **Release:** migration + backend + frontend, nessa ordem (frontend antigo ignora o campo; backend antigo ignora o tipo). Entra no plano de release do monitor (`docs/operations/release-monitor-normativo-2026-10-09.md`) como Etapa de migration.

## 5. Verificação mínima antes de entregar

`tsc` backend/frontend; testes unitários novos; comparação de suítes (as 8 falhas conhecidas do HEAD limpo); vitest/eslint/`next build`; migration aplicada do zero em Postgres descartável (nunca em produção) com checagem do CHECK e do backfill; QA visual 390/1440 px com API simulada.

## 6. Rollback

Aditivo: frontend/backend antigos ignoram a coluna. Reverter = voltar as imagens; remover a coluna (`DROP COLUMN source_type`) só com autorização e backup, e depois de voltar o backend (que passaria a selecionar a coluna).

## 7. Pendências do proprietário para sair de provisório

A (confirmar o padrão ou escolher fora-do-RAG), B (lista de tipos), C (temas, para a E3) e o commit/merge do eSocial (numeração da migration).
