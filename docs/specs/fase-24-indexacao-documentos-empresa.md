# Fase 24 — Indexação de documentos da empresa (PGR/PCMSO/LTCAT/LIP) + upload de Word e Excel

> Spec aprovada por brainstorming em chat com o fundador em 2026-09-10.
> Primeira fatia real de uma visão ampla trazida pelo fundador nessa
> mesma conversa (documento "MONTESESST — Especificação Mestre do
> Sistema"): múltiplos agentes de IA cooperando, cruzamento de dados
> entre PGR/PCMSO/LTCAT/LIP (a auditoria "Pente-Fino"), upload de
> Word/Excel, RAG robusto sem alucinação. Escopo grande demais pra uma
> spec só — decomposto em 4 sub-projetos independentes, nesta ordem:
> **(A+B, esta spec)** ingestão Word/Excel + indexação de conteúdo dos
> documentos da empresa; **(C)** motor de cruzamento entre esses
> documentos (as 4 perguntas do Pente-Fino); **(D)** cooperação entre
> os agentes de IA existentes + memória de conversa. Ver
> `docs/assistente-montese-principios.md` pros princípios que esta
> capacidade herda (assistir não substituir, nunca inventar, interface
> por capacidade em vez de Model Gateway central).

## 1. Objetivo e escopo

Hoje o RAG normativo (Fase 9) só indexa **normas oficiais** — o
conteúdo de PGR, PCMSO, LTCAT e LIP que cada empresa envia
(`documents`, Fase 4/21) nunca é lido pelo Assistente, só existe como
arquivo bruto + categoria. `PGR`, `PCMSO`, `LTCAT`, `LIP` são hoje só
rótulos de categoria, sem nenhuma leitura de conteúdo por trás.

Esta fase extrai, indexa (chunking + embedding, mesmo padrão do RAG
normativo) e expõe no Assistente o conteúdo desses 4 tipos de
documento, por tenant. Também remove a trava que impede anexar Word
(.docx) e Excel (.xlsx) em qualquer lugar do sistema hoje — upload
formal de documento, e anexo efêmero de pergunta ao Assistente.

Depois desta fase, uma pergunta como "o que meu PGR diz sobre ruído?"
passa a ser respondida com uma citação real do documento da própria
empresa — do mesmo jeito que hoje já é respondida citando uma NR. O
cruzamento entre esses documentos entre si (isso é inconsistente com
aquilo) é a Fase C, spec própria, só depois que este conteúdo
existir para cruzar.

## 2. Decisões fechadas em brainstorming, não reabrir sem motivo novo

- **Só as 4 categorias centrais são indexadas**: `pgr`, `pcmso`,
  `ltcat`, `lip`. As outras 7 categorias já cadastradas (`laudo`,
  `ficha_epi`, `treinamento`, `cipa_*`) continuam sendo só arquivo
  armazenado, sem chunking/embedding, nesta fase.
- **Sem backfill.** Só documentos enviados a partir desta fase são
  indexados. Reindexar o histórico já enviado é uma tarefa separada,
  só depois deste pipeline estar validado em produção.
- **Estende `NormativeAssistantService`, não cria serviço novo.**
  Decisão explícita contra a alternativa de um serviço isolado pra
  documento de empresa: a Fase C (cruzamento) vai precisar combinar
  norma oficial + PGR da empresa + PCMSO da empresa na mesma resposta,
  então separar agora só criaria uma fusão pra desfazer depois. O
  custo aceito: o serviço já chamado "Normative" descreve cada vez
  menos o que faz (era só norma, ganhou dado operacional na Fase 10,
  ganha documento de empresa aqui) — renomear é pendência de baixa
  prioridade já registrada no projeto, não bloqueia esta fase.
- **Tabela nova `company_document_chunks`, isolada por tenant.** Nunca
  compartilha tabela com `normative_document_chunks` (que é conteúdo
  público entre tenants, sem RLS) — RLS obrigatória desde o dia 1,
  mesmo padrão não-negociável de todo o projeto.
- **DOCX via `mammoth`, XLSX via `exceljs`.** `exceljs` já é
  dependência do projeto (Fase 22, importação de planilha de
  funcionários) — reaproveitado, não uma escolha nova. `mammoth` é
  biblioteca nova (MIT, sem a controvérsia de licença que já baniu o
  `xlsx`/SheetJS deste projeto).
- **Planilha vira texto linha a linha antes de indexar**, usando o
  cabeçalho da própria planilha como rótulo de cada coluna (ex.: `"Aba:
  Ruído | Função: Soldador | Medição: 92 dB(A) | Data: 12/03/2026"`) —
  mesma ideia de "cabeçalho livre" do `spreadsheet-import.util.ts`
  (Fase 22), aqui virando texto pra embedding em vez de registro de
  funcionário. Chunking agrupa linhas próximas até o limite de
  tamanho, nunca quebra uma linha no meio.
- **Indexação síncrona, non-blocking em caso de falha.** Roda dentro
  do próprio `POST /documents`, mesma aceitação de latência já usada
  na classificação em lote (Fase 21). Falha de extração/embedding
  nunca impede o upload — o documento fica salvo sem chunks, e o
  Assistente informa que não conseguiu ler o conteúdo se perguntado
  sobre ele (mesma mensagem-padrão já usada pra PDF escaneado sem
  texto).
- **Word/Excel liberado pra todas as 11 categorias no upload formal**,
  não só as 4 indexadas — é mudança de allowlist de mimetype, sem
  custo real de restringir. A indexação continua restrita às 4
  categorias combinadas.
- **Anexo efêmero do Assistente (Fase 20) também ganha DOCX/XLSX**,
  mesmo limite de 5MB, nunca persistido, mesmos extratores novos desta
  fase.
- **Fora de escopo, explicitamente**: OCR (documento escaneado
  continua sem leitura, decisão já existente); ampliar formato da
  classificação em lote (Fase 21 continua só PDF); imagem como
  documento indexável (sem OCR, não há texto pra extrair de imagem).

## 3. Modelo de dados

Migration nova `0040_company_document_chunks.sql`:

```sql
CREATE TABLE company_document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('pgr', 'pcmso', 'ltcat', 'lip')),
  chunk_index int NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX company_document_chunks_embedding_idx
  ON company_document_chunks USING hnsw (embedding vector_cosine_ops);

ALTER TABLE company_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_document_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY company_document_chunks_isolation ON company_document_chunks USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = company_document_chunks.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
);
```

Mesma política de `documents` (Fase 4): empresa vê o próprio tenant,
técnico vê tenants vinculados via `tenant_technicians`. `category`
denormalizada de `documents.category` (evita join na hora do filtro de
retrieval). `tenant_id` denormalizado de `documents.tenant_id` (evita
depender de RLS de `documents` só pra filtrar chunk — a policy acima é
autossuficiente).

Nenhuma coluna nova em `documents` — a categoria já existe desde a
Fase 4.

## 4. Extração de conteúdo por formato

Novos utilitários compartilhados (mesmo padrão de
`common/pdf/pdf-text.util.ts`, usado tanto por `documents` quanto por
`normative`):

- `common/docx/docx-text.util.ts` — `extractDocxText(buffer)`, via
  `mammoth`, devolve texto corrido (títulos/parágrafos como quebras
  naturais).
- `common/xlsx/xlsx-text.util.ts` — `extractXlsxRows(buffer)`, via
  `exceljs`, devolve um array de linhas já formatadas como frase
  (cabeçalho como rótulo de coluna), uma aba por vez.
- PDF: reaproveita `extractPdfText`, sem mudança.

Falha de extração (arquivo corrompido, planilha sem cabeçalho
reconhecível, DOCX inválido) devolve vazio/`null` — nunca lança exceção
que derruba o upload.

## 5. Pipeline de indexação (novo `CompanyDocumentIndexerService`, módulo `documents`)

Disparado dentro de `DocumentsService.create`, depois que o arquivo já
foi salvo no R2 e o registro em `documents` já existe — só quando
`category` é uma das 4 e `mime_type` é PDF/DOCX/XLSX (imagem nunca
indexa, sem OCR):

1. Extrai texto (extrator correspondente ao mimetype).
2. Se não extraiu nada: encerra, documento fica sem chunks.
3. `splitIntoChunks` (reaproveitado de `normative/chunking.util.ts`,
   sem mudança no PDF/DOCX; entrada já vem pré-quebrada por linha no
   caso de XLSX, ver §2).
4. Pra cada chunk: `EmbeddingProvider.embed()` (mesma interface e
   provider — OpenRouter `text-embedding-3-small` — já usados pelo RAG
   normativo; `NormativeModule` passa a exportar `EMBEDDING_PROVIDER`
   pra `DocumentsModule` importar).
5. Insere em `company_document_chunks` (uma linha por chunk).

Falha em qualquer passo é capturada e logada, nunca propagada pra fora
do `POST /documents` — o response de upload não muda.

## 6. Integração no Assistente

`NormativeAssistantService.query()` ganha um terceiro branch de
retrieval, só pra `user.role === 'empresa'` ou `'tecnico'`/`'parceiro'`
com vínculo (mesmo escopo de tenant que já rege a visibilidade de
`documents`):

```sql
SELECT c.id AS chunk_id, c.content, c.document_id, c.category, d.title
FROM company_document_chunks c
JOIN documents d ON d.id = c.document_id
WHERE c.tenant_id = $1
ORDER BY c.embedding <=> $2::vector
LIMIT $3
```

Executada com `withTenantContext` (diferente do branch normativo, que
usa `withoutTenantContext` por não ter RLS) — a RLS de
`company_document_chunks` exige contexto de tenant setado.

Os chunks recuperados entram no prompt como um terceiro tipo de fonte,
ao lado dos trechos normativos e dos itens operacionais. `NormativeClaim`
ganha `company_chunk_ids: string[]` (mesmo formato de `chunk_ids` e
`operational_ref_ids`). O Verificador determinístico ganha a mesma
checagem que já existe pras outras duas listas: todo id citado precisa
pertencer ao conjunto realmente recuperado nesta pergunta, e "tem pelo
menos uma fonte" passa a considerar as três listas — nunca só duas
`every()` vazias passando de graça (mesma regra já testada na Fase 20).

Citação na resposta ganha um terceiro formato (ao lado de norma oficial
e item operacional): título do documento da empresa + categoria (ex.:
"PGR — Programa de Gerenciamento de Riscos 2026.docx").

## 7. Onde Word/Excel passam a ser aceitos

- **`POST /documents`** (Fase 4): `ALLOWED_MIME_TYPES` ganha
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
  (DOCX) e
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  (XLSX), pras 11 categorias já existentes.
- **`POST /assistant/normative-query`** (Fase 20, anexo efêmero):
  `ALLOWED_ATTACHMENT_MIME_TYPES` ganha os mesmos dois mimetypes.
  Extração usa os mesmos utilitários novos de §4. Mesmo limite de 5MB,
  nunca persistido — comportamento idêntico ao PDF hoje
  (`AttachmentInput.kind` ganha `'docx_text'`/`'xlsx_text'` ao lado de
  `'pdf_text'`/`'image'`).
- **`POST /documents/classify-batch`** (Fase 21): continua só PDF, sem
  mudança — fora de escopo desta fase (ver §2).

## 8. Testes

E2E real contra Postgres (`TestDb`), nunca mock, mesmo padrão de todo o
projeto:

- Upload de PGR em DOCX e em XLSX → chunks aparecem em
  `company_document_chunks` com `tenant_id`/`category` corretos.
- Isolamento cross-tenant: empresa A não recupera (nem via query
  direta, nem via resposta do Assistente) chunk de documento da
  empresa B — mesmo teste que já existe pra `documents` e pras tabelas
  normativas, replicado pra tabela nova.
- Técnico vinculado ao tenant recupera os chunks da empresa vinculada;
  técnico sem vínculo, não.
- Documento corrompido/sem conteúdo extraível → upload segue
  funcionando, Assistente responde "não consegui ler o conteúdo" em
  vez de inventar.
- Pergunta ao Assistente cobrindo as 3 fontes na mesma resposta (norma
  + operacional + documento da empresa) sem regressão no Verificador
  existente.
- Regressão completa das suítes de `documents`, `normative` e RLS já
  existentes.

## 9. Fora de escopo

- Motor de cruzamento entre PGR/PCMSO/LTCAT/LIP (Fase C, spec própria).
- Cooperação entre os agentes de IA existentes e memória de conversa
  (Fase D, spec própria).
- OCR de documento escaneado (Word/Excel/PDF sem texto real).
- Reindexação retroativa de documentos já enviados antes desta
  mudança.
- Ampliar formato aceito pela classificação em lote (Fase 21).
- Indexar as outras 7 categorias (`laudo`, `ficha_epi`, `treinamento`,
  `cipa_*`).
- Imagem como documento indexável.
- Model Gateway central (decisão já registrada em
  `docs/assistente-montese-principios.md`).
- Renomear `NormativeAssistantService`/`NormativeAssistantController`.
