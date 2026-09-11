# Fase 25 — Motor de cruzamento "Pente-Fino": checklist de nomes + PGR↔PCMSO

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-11.
> Segunda fatia da visão trazida pelo fundador em 2026-09-10 (documento
> "MONTESESST — Especificação Mestre do Sistema"): múltiplos agentes de
> IA cooperando, cruzamento de dados entre PGR/PCMSO/LTCAT/LIP (a
> auditoria "Pente-Fino"), RAG robusto sem alucinação. A primeira fatia
> (ingestão Word/Excel + indexação de documentos da empresa) fechou como
> [Fase 24](fase-24-indexacao-documentos-empresa.md). Escopo do motor de
> cruzamento inteiro é grande demais pra uma spec só — o fundador
> descreveu 4 checagens (PGR↔PCMSO, PCMSO/LIP↔insalubridade,
> LIP↔LTCAT) mais um checklist preliminar (nomes de função, datas,
> assinatura de profissional habilitado). Esta fase cobre só o
> checklist preliminar de **nomes de função** + a checagem **PGR↔PCMSO**
> (risco sem exame correspondente). Datas, assinatura, insalubridade e
> LTCAT ficam pra fatias futuras — ver §7.

## 1. Objetivo e escopo

Hoje (pós-Fase 24) o conteúdo de PGR/PCMSO da empresa está indexado por
chunk pra busca semântica no Assistente — mas isso responde perguntas
soltas ("o que o PGR diz sobre ruído?"), não enumera sistematicamente
todas as funções da empresa pra comparar risco (PGR) contra exame
(PCMSO). Essa enumeração sistemática é o que o técnico faz hoje
manualmente, lendo os dois documentos lado a lado — e é exatamente o
trabalho que o fundador descreveu em detalhe como a "auditoria
Pente-Fino".

Esta fase constrói:
1. **Extração estruturada** — uma IA lê o PGR inteiro e devolve a lista
   `[{função, risco, trecho-fonte}]`; outra lê o PCMSO inteiro e devolve
   `[{função, exame, trecho-fonte}]`. Cada item citado é verificado
   deterministicamente contra o texto real do documento — nunca
   confia na IA sozinha.
2. **Casamento de função** — usa `positions` (Fase 23) como cargo
   canônico quando disponível; cai pra comparação direta de texto
   normalizado quando não.
3. **Relatório de achados**, sob demanda: função com risco sem exame
   correspondente, função com exame sem risco que o justifique, e nome
   de função sem correspondência entre os dois documentos.

**Princípio não-negociável desta fase:** o sistema nunca julga se um
exame específico é *tecnicamente adequado* pro risco (isso é
responsabilidade de médico do trabalho). Só aponta fatos mecânicos e
prováveis — "há risco e zero exames" — nunca "o exame X está errado
pro risco Y". Decisão do fundador, alinhada ao princípio já
documentado em `docs/assistente-montese-principios.md` (apoiar a
análise, nunca assumir responsabilidade técnica que é do profissional
habilitado) e ao padrão já escolhido pela Fase 23 (divergência sempre
por checagem determinística, nunca por julgamento de IA).

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Só checagem mecânica, sem tabela de regras risco→exame e sem IA
  julgando correspondência.** Cogitadas e descartadas: (a) uma tabela
  fixa risco→categoria-de-exame (exigiria manter conhecimento técnico
  real, tipo NR-7, dentro do sistema) e (b) uma IA julgando caso a caso
  se o conjunto de exames cobre o conjunto de riscos (o sistema
  emitindo opinião técnica). As duas ficam descartadas por decisão do
  fundador — nunca reabrir sem ele pedir explicitamente.
- **Extração roda sob demanda, não a cada upload.** Técnico/empresa
  dispara `POST /pente-fino/run`; a extração usa (ou reaproveita, se o
  documento não mudou) o PGR e o PCMSO mais recentes por categoria.
  Nunca dispara sozinha no upload.
- **Extração é sobre o texto completo do documento, não sobre os
  chunks da Fase 24.** Baixa o arquivo original do R2 e reaproveita
  `extractPdfTextFull`/`extractDocxText`/`extractXlsxRows` (Fase 24)
  direto — precisa enumerar todas as funções de uma vez, não buscar
  por similaridade a uma pergunta. Isso também desacopla esta fase da
  indexação por chunk: funciona mesmo se a indexação da Fase 24 tiver
  falhado pra aquele documento.
- **Só implementação MiniMax, sem par OpenRouter** — mesma decisão já
  tomada na Fase 21 pra capacidades novas a partir dali: a interface
  (`FunctionExtractionProvider`) garante trocabilidade futura via
  `useClass`, sem precisar escrever a segunda implementação agora.
- **Casamento de função usa `positions` como cargo canônico**,
  reaproveitando a mesma normalização de texto já usada na Fase 23
  (`normalizePositionText`: sem acento, minúsculo, trim, espaços
  colapsados) — extraída pra um util compartilhado nesta fase (ver
  §3), já que hoje é um método privado de `PositionsService`.
- **Datas de documento e assinatura de profissional habilitado ficam
  de fora desta fatia** — decisão do fundador. `documents` não tem
  campo de "data de emissão" separado do upload, e extrair
  CREA/CRM/assinatura do texto é um problema à parte, sem garantia de
  estar legível no texto extraído. Fica pra fatia futura, com desenho
  próprio.
- **Acessível por `empresa` (vê a própria) e `técnico`/`parceiro`
  vinculados** (escolhendo a empresa via `tenant_id`) — mesmo padrão
  de visibilidade de `documents`/`company_document_chunks`. Resolve de
  quebra, só pra este endpoint, a limitação registrada na Fase 24 (o
  chat do Assistente não sabe pra qual empresa o técnico está
  perguntando) — aqui o endpoint já pede `tenant_id` explicitamente.
- **RLS cobrindo admin/tenant/técnico/parceiro desde a criação**, via
  `assigned_tenant_ids_for_current_user()` (função já existente desde
  `0001_init.sql`, padrão das migrations mais recentes antes desta) —
  não o EXISTS repetido em duas cláusulas separadas que
  `company_document_chunks_isolation` usa (mais antigo, e a Fase 24
  esqueceu o branch de parceiro nessa versão na primeira tentativa,
  corrigido depois numa migration separada). Esta fase usa o padrão
  atual certo desde o início.

## 3. Modelo de dados

Migration nova `0042_pente_fino_function_extraction.sql`:

```sql
CREATE TABLE pgr_function_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position_id uuid REFERENCES positions(id) ON DELETE SET NULL,
  function_text_raw text NOT NULL,
  risk_description text NOT NULL,
  source_excerpt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pcmso_function_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position_id uuid REFERENCES positions(id) ON DELETE SET NULL,
  function_text_raw text NOT NULL,
  exam_description text NOT NULL,
  source_excerpt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pgr_function_risks_tenant_id_idx ON pgr_function_risks (tenant_id);
CREATE INDEX pgr_function_risks_document_id_idx ON pgr_function_risks (document_id);
CREATE INDEX pcmso_function_exams_tenant_id_idx ON pcmso_function_exams (tenant_id);
CREATE INDEX pcmso_function_exams_document_id_idx ON pcmso_function_exams (document_id);

-- RLS: cobre admin/tenant/técnico/parceiro desde a criação, usando
-- assigned_tenant_ids_for_current_user() — função SQL já existente
-- desde 0001_init.sql (SECURITY DEFINER, une tenant_technicians e
-- tenant_partners numa única subquery), já é o padrão usado pelas
-- migrations mais recentes antes desta (0035-0039: positions,
-- fire_safety_equipment, fire_brigade, company_units,
-- prevention_checklist). Mais limpo que o EXISTS repetido em duas
-- cláusulas separadas que documents_isolation/company_document_chunks_isolation
-- usam (padrão mais antigo, pré-existente, não é o que esta fase
-- deveria copiar).
ALTER TABLE pgr_function_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pgr_function_risks FORCE ROW LEVEL SECURITY;
CREATE POLICY pgr_function_risks_isolation ON pgr_function_risks USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
-- (mesma policy, trocando o nome da tabela, em pcmso_function_exams)
```

`position_id` fica `NULL` quando a função extraída não bate com
nenhum cargo cadastrado — é justamente o sinal usado pro achado "nome
de função sem correspondência" (§5). `ON DELETE SET NULL` (não
CASCADE) — apagar um cargo não deve apagar o histórico de extração,
só descasar a referência.

## 4. Extração

Novo módulo `backend/src/pente-fino/`.

**`FunctionExtractionProvider`** (interface trocável, mesmo padrão de
`DocumentClassifierProvider`/`NormativeAnswerProvider`):
```typescript
interface ExtractedFunctionItem {
  function_text: string;
  description: string; // risco (PGR) ou exame (PCMSO), a chamada decide qual rótulo usar na UI
  source_excerpt: string;
}
interface FunctionExtractionProvider {
  extract(fullText: string, kind: 'risco' | 'exame'): Promise<ExtractedFunctionItem[]>;
}
```
Única implementação: `MiniMaxFunctionExtractionService` (mesmo padrão
de chamada HTTP/timeout/tratamento de erro já usado em
`minimax-document-classifier.service.ts`). Prompt e schema
compartilhados (`pente-fino-extraction-shared.ts`, mesmo padrão de
`document-classifier-shared.ts`): `SYSTEM_PROMPT` parametrizado por
`kind` (troca só o rótulo "risco"/"exame" e a instrução de contexto),
`TOOL_SCHEMA` com `items: array de {function_text, description,
source_excerpt}`, regra obrigatória "nunca invente um trecho que não
esteja literalmente no texto fornecido" (mesma regra de sempre).

**`PenteFinoExtractorService.extractAndPersist(document)`:**
1. Baixa o arquivo original do R2 (`file_key` de `documents`).
2. Extrai texto completo (`extractPdfTextFull`/`extractDocxText`/
   `extractXlsxRows`, conforme `mime_type` — mesmos utilitários da
   Fase 24).
3. Chama `FunctionExtractionProvider.extract(text, kind)` (`kind` =
   `'risco'` se `document.category === 'pgr'`, `'exame'` se
   `'pcmso'`).
4. Pra cada item devolvido: verifica deterministicamente que
   `source_excerpt` (normalizado — colapsa espaços/quebras de linha)
   aparece como substring do texto completo extraído. Item que não
   bate é descartado, nunca persistido — mesmo princípio "nunca
   inventar" do Verificador, adaptado pra citação de trecho literal em
   vez de chunk_id.
5. Casa `function_text` contra `positions` (normalização compartilhada
   extraída de `PositionsService.normalizePositionText`, movida pra
   `common/text/normalize-position-text.util.ts` — reaproveitada nos
   dois lugares).
6. Apaga extrações antigas desse `document_id` (se `extractAndPersist`
   rodar de novo pro mesmo documento) e insere as novas — nunca
   acumula duplicata.

Nunca lança exceção pro chamador — mesmo padrão de
`CompanyDocumentIndexerService` (Fase 24, pós-correção): falha de
download, extração ou chamada de IA fica logada, a lista de itens
persistidos fica vazia pra aquele documento, e o relatório (§5) reporta
"não foi possível extrair este documento" em vez de travar.

## 5. Comparação e relatório

**`PenteFinoComparisonService.run(tenantId)`:**
1. Busca o PGR mais recente (`category = 'pgr'`, maior `created_at`) e
   o PCMSO mais recente (`category = 'pcmso'`) do tenant.
2. Se algum estiver ausente: relatório com aviso "PGR/PCMSO não
   encontrado" em vez de erro — mesmo princípio de "documento ausente"
   já usado no resto do projeto (nunca só "não encontrado", sempre
   explica o que fica limitado).
3. Chama `extractAndPersist` pra cada um, se ainda não tiver extração
   pra aquela versão exata do documento (`document_id`).
4. Agrupa `pgr_function_risks` e `pcmso_function_exams` por
   `position_id` (quando presente) ou por `function_text_raw`
   normalizado (quando ausente).
5. Pra cada grupo: `status = 'ok'` se tem pelo menos 1 risco E pelo
   menos 1 exame; `'risco_sem_exame'` se só risco; `'exame_sem_risco'`
   se só exame; `'nome_sem_correspondencia'` quando o grupo nunca teve
   `position_id` setado (não bateu com nenhum cargo, então não há
   garantia de que "sem risco"/"sem exame" nesse grupo seja um achado
   real, e não só duas funções com nomes diferentes pra mesma coisa —
   marcado separado, prioridade mais baixa que os outros dois).

**Resposta da API** (`POST /pente-fino/run`):
```json
{
  "pgr_document": { "id": "...", "title": "...", "extracted_at": "..." },
  "pcmso_document": { "id": "...", "title": "...", "extracted_at": "..." },
  "functions": [
    {
      "position_id": "...",
      "position_name": "Soldador",
      "status": "risco_sem_exame",
      "risks": [{ "description": "Fumos metálicos", "source_excerpt": "...", "document_title": "PGR 2026.pdf" }],
      "exams": []
    }
  ],
  "warnings": []
}
```

## 6. Endpoint e permissões

- `POST /pente-fino/run` — body `{ tenant_id }` quando quem chama é
  `tecnico`/`parceiro` (mesmo padrão de `documents`: usa o próprio
  tenant quando quem chama é `empresa`). `@Roles('empresa', 'tecnico',
  'parceiro')`.
- Sem rate limit dedicado nesta fatia — custo já limitado pelo fato de
  rodar só sob demanda e reaproveitar extração já feita pro mesmo
  `document_id`.

## 7. Fora de escopo

- Datas de documento e assinatura de profissional habilitado (checklist
  preliminar incompleto — só nome de função nesta fatia).
- PCMSO/LIP↔insalubridade (precisa extrair valores numéricos de
  medição e comparar com limites da NR-15 — problema diferente).
- LIP↔LTCAT (comparação de medições entre dois laudos).
- Qualquer tabela de regra risco→exame ou julgamento de IA sobre
  adequação técnica — decisão fechada, não reabrir sem o fundador
  pedir.
- Fase D (cooperação entre os agentes de IA existentes + memória de
  conversa) — sub-projeto separado, ainda sem spec.
- Exibir o relatório no chat do Assistente — só endpoint dedicado
  nesta fatia; integrar ao chat (pra técnico/parceiro perguntarem "meu
  PGR bate com o PCMSO?" em linguagem natural) fica pra quando o
  gap de `tenant_id` no endpoint do Assistente (registrado na Fase 24)
  for resolvido.
- Frontend — esta spec é backend-only, mesma decisão da Fase 24.
