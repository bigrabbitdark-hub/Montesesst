# Checklist SST como 4ª fonte de conhecimento do Assistente

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-16.
> O fundador colou uma base de conhecimento SST completa (checklist de
> documentação NR-01 a NR-38, derivado da planilha interna "Super
> Checklist Documentação SST — 26/05/2026") pedindo pra "acrescentar no
> conhecimento do assistente". O documento original foi preservado
> verbatim em `docs/reference/checklist-documentacao-sst.md`, mesmo
> papel que `docs/reference/modelos-relatorios-sst.md` e
> `docs/reference/catalogo-epi-nr06.md` já cumprem para outros
> sub-projetos.
>
> **Achado central do brainstorming**: o Assistente já tem um pipeline
> de RAG normativo completo desde a Fase 9 (`backend/src/normative/`),
> mas esse pipeline (`official_sources` → `normative_documents` →
> `normative_document_chunks`) foi desenhado especificamente para
> **textos oficiais de verdade**, baixados de URLs reais do governo, com
> fluxo de aprovação e monitoramento automático de mudanças. O checklist
> colado é uma **curadoria/interpretação interna** da Montese (valores
> de multa não validados, ações recomendadas, índices de infração
> calculados pela planilha) — não é o texto oficial da norma. O próprio
> documento já avisa isso explicitamente. Misturar as duas fontes faria
> o Assistente citar a curadoria interna com o mesmo peso de uma norma
> baixada do gov.br.

## 1. Objetivo e escopo

Dar ao Assistente MonteseSST uma 4ª fonte de conhecimento, distinta e
claramente rotulada, sobre "quais documentos uma empresa precisa ter
por NR" — sem misturar essa curadoria interna com o texto oficial das
normas (já indexado) nem com os documentos da própria empresa (Fase
24) nem com os itens de atenção do dashboard (already existente).

Cobre:
1. Um catálogo de referência (`sst_checklist_items`) com os ~280 itens
   do documento, um por linha, pesquisável por embedding.
2. Uma tela de admin pra gerenciar esse catálogo sem precisar de mim
   (criar/editar/excluir item).
3. Integração no fluxo de pergunta-resposta do Assistente já existente
   — uma 4ª fonte de citação ao lado das 3 já existentes
   (`chunk_ids`/normas oficiais, `company_chunk_ids`/documentos da
   empresa, `operational_ref_ids`/pendências do dashboard).

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Fonte separada, nunca misturada com `normative_documents`** — o
  checklist é curadoria interna, citado como tal, nunca como texto
  oficial da norma.
- **Granularidade por item, não por NR inteira** — cada linha do
  catálogo é um documento/requisito específico (ex.: "Prontuário de
  caldeira" da NR-13), não a NR inteira de uma vez. Sem chunking: cada
  item já é atômico (ao contrário de um PDF de norma inteira, que
  precisa ser fatiado).
- **Tabela compartilhada, sem `tenant_id`, sem RLS** — mesmo padrão já
  usado por `epi_catalog_items` (`0013_epi_catalog.sql`): um catálogo
  de referência igual para todos os clientes, não um dado por empresa.
- **Carga inicial embutida na migration, como INSERT direto** — mesmo
  padrão exato de `epi_catalog_items` (93 linhas de EPI inseridas
  diretamente na migration `0013`). O catálogo SST usa o mesmo modelo,
  com ~280 linhas geradas a partir de
  `docs/reference/checklist-documentacao-sst.md`. Embeddings NÃO entram
  na migration (não dá pra calcular embedding em SQL puro) — um script
  backend separado, rodado uma vez após a migration, preenche a coluna
  `embedding` de todas as linhas usando o `EMBEDDING_PROVIDER` já
  existente.
- **Tela de admin sem fluxo de aprovação** — diferente de
  `normative_documents` (que tem `aguardando_validacao`/`vigente`/etc.,
  porque lida com detecção automática de mudança em fonte externa),
  este catálogo é editado diretamente pelo admin — criar/editar/excluir
  já aplica na hora. Precisa recalcular o embedding ao editar
  `document_name`/`description`/`legal_requirement` (os campos que
  entram no texto embedado).
- **Sem determinação automática de aplicabilidade por CNAE** — o
  documento original pede isso ("determine quais NRs e itens são
  potencialmente aplicáveis com base em atividade, CNAE..."), mas isso
  é um motor de aplicabilidade separado, mais complexo, e fica de fora
  desta fase. O Assistente só recupera itens relevantes pra uma
  pergunta via busca semântica — não decide sozinho quais NRs "valem"
  pra uma empresa específica.
- **Sem validação de valores de multa** — os valores de multa do
  catálogo são os da planilha original, marcados como não-validados no
  próprio dado (`is_fine_validated: false`, ver §3). O Assistente nunca
  apresenta um valor de multa como atual/vigente sem esse aviso.

## 3. Modelo de dados

```sql
CREATE TABLE sst_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nr_code TEXT NOT NULL,              -- ex.: 'NR-01', 'NR-13'
  nr_title TEXT NOT NULL,             -- ex.: 'Disposições Gerais e GRO'
  nr_category TEXT NOT NULL CHECK (nr_category IN ('geral', 'especial', 'setorial', 'revogada')),
  document_name TEXT NOT NULL,        -- ex.: 'Prontuário de caldeira'
  description TEXT NOT NULL,
  legal_requirement TEXT NOT NULL,    -- texto do item normativo citado
  infraction_index INT,               -- 0-4, null quando não se aplica (NRs revogadas)
  is_fine_validated BOOLEAN NOT NULL DEFAULT false, -- sempre false na carga inicial
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sst_checklist_items_embedding_idx
  ON sst_checklist_items USING hnsw (embedding vector_cosine_ops);
CREATE INDEX sst_checklist_items_nr_code_idx ON sst_checklist_items (nr_code);

CREATE TRIGGER trg_sst_checklist_items_updated_at
  BEFORE UPDATE ON sst_checklist_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Sem `tenant_id`, sem RLS — mesmo modelo de confiança de
`epi_catalog_items`/`official_sources` (dado de referência, não dado de
cliente).

## 4. Backend

### Carga inicial (migration)

Uma migration nova (próximo número sequencial) com ~280 `INSERT`
diretos, gerados a partir de
`docs/reference/checklist-documentacao-sst.md` — cada `#### <item>`
dentro de cada `# NR <código> <título> (<categoria>)` vira uma linha.
Mapeamento de campos:
- `nr_code`/`nr_title`/`nr_category`: extraídos do cabeçalho `# NR ...`
  (categoria normalizada pro `CHECK`: "(Geral)"→`geral`,
  "(Especial)"→`especial`, "(Setorial)"→`setorial`,
  "(REVOGADA)"→`revogada`).
- `document_name`: texto do `####`.
- `description`/`legal_requirement`: campos homônimos do item.
- `infraction_index`: campo "Infração" quando for um número 0-4; `NULL`
  quando o valor for `False` (NRs revogadas, que não têm índice).
- `is_fine_validated`: sempre `false`.
- Campos do documento original não mapeados nesta fase (não têm coluna
  própria): "Conforme/Não conforme/Não aplicável" (são estados
  específicos de uma inspeção de uma empresa real, não do catálogo de
  referência), "Ação/avaliação na planilha", "Justificativa", "Valor de
  multa registrado", "Status" — esses são dados de uma AVALIAÇÃO
  específica já feita na planilha original, não fazem parte do
  catálogo de referência genérico que o Assistente consulta.

### Script de embedding (rodado uma vez, após a migration)

Novo script `backend/db/embed-sst-checklist.ts` (mesmo padrão de script
standalone já usado por `db/seed.ts`/`db/caepi-sync.ts`): busca todas as
linhas de `sst_checklist_items` com `embedding IS NULL`, monta o texto
a embedar (`` `${nr_code} — ${document_name}: ${description}` ``, mesmo
padrão de concatenação campo-a-campo já usado antes de gerar embedding
em `normative-documents.service.ts`), chama `EMBEDDING_PROVIDER`, grava
de volta. Roda uma vez manualmente (`npx tsx db/embed-sst-checklist.ts`)
depois da migration — não faz parte do boot da aplicação.

### Tela de admin — CRUD

Módulo novo `backend/src/sst-checklist/`:
- `SstChecklistService`: `findAll(client, nrCode?)`, `findOne`,
  `create` (recalcula embedding), `update` (recalcula embedding só se
  `document_name`/`description`/`legal_requirement` mudou), `remove`.
- `SstChecklistController`, `@Roles('admin')` em todas as rotas (mesmo
  padrão de `NormativeDocumentsController`):
  - `GET /admin/sst-checklist?nr_code=NR-13`
  - `GET /admin/sst-checklist/:id`
  - `POST /admin/sst-checklist`
  - `PATCH /admin/sst-checklist/:id`
  - `DELETE /admin/sst-checklist/:id`

### Integração no Assistente

`backend/src/normative/normative-answer-provider.interface.ts` ganha:

```typescript
export interface ChecklistItem {
  id: string;
  content: string; // "NR-13 — Prontuário de caldeira: <descrição>"
}
```

`NormativeAnswerProvider.answer(...)` ganha um 5º parâmetro
`checklistItems: ChecklistItem[]`. `NormativeClaim` ganha
`checklist_ref_ids: string[]`.

`NormativeAssistantService`: novo passo de busca (mesmo padrão da busca
em `normative_document_chunks` — embedding da pergunta, cosine
similarity, `LIMIT` análogo a `CHUNK_LIMIT_DEFAULT`/
`CHUNK_LIMIT_WITH_ATTACHMENT`) contra `sst_checklist_items`, sempre
executado (não depende de `tenantId`, ao contrário de
`operationalItems` — é conhecimento geral, não específico de uma
empresa).

`NormativeQueryResult` ganha:

```typescript
export interface ChecklistItemCitation {
  item_id: string;
  nr_code: string;
  document_name: string;
}
```
— `checklist_citations: ChecklistItemCitation[]` no resultado, ao lado
de `citations`/`company_citations` já existentes.

**Prompt** (nos dois provedores concretos, `minimax-normative-answer.service.ts`
e `openrouter-normative-answer.service.ts`): instrução explícita nova,
"os itens de `checklist` são a interpretação/checklist interno da
Montese sobre quais documentos uma empresa costuma precisar por NR —
NUNCA o texto oficial da norma. Se a pergunta for sobre o que a lei diz
literalmente, prefira os trechos normativos oficiais (`chunks`). Se a
pergunta for sobre quais documentos uma empresa precisa ter, o
checklist é a fonte principal."

`normative-answer-shared.ts` (validação de claims): mesmo tratamento já
dado a `operational_ref_ids`/`company_chunk_ids` — um `claim` com
`checklist_ref_ids` apontando pra um id que não veio na lista de itens
buscados é descartado (mesma defesa contra alucinação de id já
aplicada às outras 3 fontes).

### Frontend — exibição da citação

`DocumentsPanel`/tela do Assistente (onde as citações já aparecem):
`checklist_citations` renderizadas com um rótulo visualmente distinto
("Checklist interno Montese", não "Fonte oficial") — mesmo componente
de citação já usado pras outras 3 fontes, só com um selo/cor diferente
avisando que não é o texto da lei.

## 5. Frontend — tela de admin

`/admin/checklist-sst` (mesmo padrão de `/admin/normativa`): lista
filtrável por NR, formulário de criar/editar item (todos os campos do
§3 exceto `embedding`/`is_fine_validated`, que ficam ocultos — o
segundo sempre `false` nesta fase, recalculado no backend), botão de
excluir com confirmação. Item novo em `AdminSidebar.tsx`, grupo
"Sistema": `{ href: '/admin/checklist-sst', label: 'Checklist SST', emoji: '✅' }`.

## 6. Testes

Backend: e2e reais cobrindo CRUD do catálogo (`@Roles('admin')`
aplicado, recálculo de embedding ao editar campo relevante, não
recálculo ao editar campo irrelevante como `infraction_index`),
inclusão de `checklist_ref_ids`/`checklist_citations` na resposta do
Assistente (mockando `NORMATIVE_ANSWER_PROVIDER`, mesmo padrão já
usado pelos testes existentes de `normative-assistant.e2e-spec.ts`),
validação de claim descartada quando `checklist_ref_ids` aponta pra id
inexistente na lista buscada. Frontend: sem test runner automatizado,
verificação manual via Playwright.

## 7. Fora de escopo

- Determinar automaticamente quais NRs/itens se aplicam a uma empresa
  específica por CNAE/atividade/riscos — motor de aplicabilidade
  separado, decisão futura do fundador.
- Validar os valores de multa contra fonte oficial vigente — trabalho
  de curadoria humana, `is_fine_validated` fica `false` até alguém
  (fundador/admin) revisar e não há UI pra isso nesta fase (o valor de
  multa em si nem é armazenado no catálogo — ver §4, campos não
  mapeados).
- Gerar pendências/planos de ação automaticamente a partir do checklist
  (o documento original descreve esse fluxo completo de C/NC/NA — isso
  já existe como um conceito de PRODUTO diferente, os módulos de
  Inspeção/Checklist de prevenção já existentes, não este catálogo de
  referência).
- Reindexar automaticamente quando o admin edita um item em lote —
  cada edição individual recalcula seu próprio embedding, mas não há
  uma tela de "importar CSV novo" nesta fase.
