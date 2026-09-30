# Spec: Documentos de Referência SST (material sem fonte oficial)

## Contexto

O fundador tem PDFs de SST (cartilhas, guias, apostilas) que já subiu manualmente
para o bucket R2 `montese-documentos` — o mesmo bucket que o backend usa
(`R2_BUCKET` no `.env`, ver `backend/src/common/r2/r2.service.ts`). O objetivo é
que esse material vire conhecimento consultável pelo Assistente Montese SST.

Esses PDFs **não são normas oficiais** (confirmado com o fundador): não têm uma
URL pública fixa de uma entidade oficial (MTE, Fundacentro, TST, MPT), são
curadoria (cartilha/guia/apostila). Por isso **não podem** entrar em
`normative_documents`/`official_sources` — essa tabela é auditada por
`backend/src/normative/claim-support.ts` contra a hierarquia de fontes oficiais
declarada no `SYSTEM_PROMPT`, e o AGENTS.md do projeto exige: *"a IA não é a
autoridade normativa"* / *"nunca inventar normas"*. Misturar cartilha ali
quebraria essa garantia — o assistente poderia citar uma apostila com o mesmo
peso de uma NR.

Uma auditoria recente (`docs/audits/auditoria-assistente-montese-sst-2026-09-28.md`,
achado 003) já documentou que as ~36-38 NRs reais em produção foram cadastradas
manualmente, fora de qualquer migration versionada — dívida técnica que este
plano não deve repetir: tudo aqui nasce versionado (migration), nunca por
INSERT manual direto em produção.

O precedente mais próximo já existe no código: `sst_checklist_items` (301 itens,
NR-01→38) é conteúdo **curado pela Montese, não texto oficial da norma**, e já é
buscado, citado (`checklist_citations`) e rotulado como tal no prompt do
assistente, lado a lado com os trechos normativos oficiais. Este plano segue o
mesmo padrão arquitetural — mas como um fluxo de **documentos** (upload +
chunking + embedding), não um catálogo estruturado como o checklist.

## Objetivo

Um admin sobe um PDF de referência via endpoint dedicado, o documento passa por
aprovação humana (mesmo ciclo `aguardando_validacao → vigente/rejeitado` já
usado por `normative_documents`), é indexado (chunking + embedding, reaproveitando
a infra existente) e entra no retrieval do Assistente — **sempre rotulado como
material de referência complementar, nunca como norma vigente**, com sua própria
categoria de citação (`reference_citations`) separada de `citations` (normas
oficiais) e `checklist_citations` (checklist interno).

## Não-objetivos (fora de escopo deste plano)

- **UI de frontend** (página de upload/aprovação em `admin/`, renderização de
  `reference_citations` em `AssistantChat.tsx`). `normative_documents` também
  não tem endpoint de upload nem UI de upload hoje — esta entrega fica no mesmo
  nível de maturidade (API-only). Fica como plano seguinte, depois que o
  fundador validar o desenho do backend.
- **Scanner automático do bucket R2.** Nenhum processo varre o bucket procurando
  arquivo novo — cada documento entra explicitamente pelo endpoint de upload
  novo (`POST /reference-documents`), com metadados (título, categoria, origem)
  preenchidos por um humano. Os PDFs que já estão no bucket hoje (subidos pelo
  fundador via dashboard Cloudflare) precisam ser reenviados por este endpoint
  — o objeto já existente no bucket não é referenciado diretamente.
- **Corrigir o achado 003 da auditoria** (as ~36-38 NRs reais não
  reproduzíveis). Não relacionado a este plano.
- **Formatos além de PDF.** V1 aceita só `application/pdf` — mesma decisão que
  simplifica escopo; DOCX/XLSX podem ser um fast-follow se necessário.
- **Integração com o runner de avaliação** (`eval/run-eval.ts`, golden dataset).
  Sistema já documentado como imaturo na auditoria de 28/09 (gate de regressão
  vazio); não expandido aqui.

## Modelo de dados

Duas tabelas novas, sem `tenant_id` e sem RLS — mesma categoria de
`official_sources`/`normative_documents`/`sst_checklist_items`: conhecimento
compartilhado entre todos os tenants, não dado de uma empresa específica.

```sql
CREATE TABLE reference_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL,
  origin_note text NOT NULL,     -- única rastreabilidade de proveniência
  status text NOT NULL DEFAULT 'aguardando_validacao'
    CHECK (status IN ('aguardando_validacao', 'vigente', 'rejeitado')),
  content_hash text NOT NULL,
  file_key text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  raw_text text NOT NULL,
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  reviewed_by_user_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reference_document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES reference_documents(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Diferenças deliberadas frente a `normative_documents`:
- Sem `source_id`/`official_url` — não existe "fonte oficial" pra apontar.
- Sem hash de nova-versão por fonte (`normative_documents_one_vigente_per_source`)
  — cada upload é um documento independente, não há "a versão vigente desta
  fonte". Vários `reference_documents` podem estar `vigente` ao mesmo tempo sem
  relação entre si.
- `origin_note` obrigatório (nunca opcional) — é a única proveniência que este
  tipo de documento carrega, já que não tem URL oficial.
- `status` sem `'substituido'` — não existe o conceito de uma versão substituir
  outra.

## Fluxo

1. Admin faz `POST /reference-documents` (multipart: `file` + `title` +
   `category` + `origin_note`) → extrai texto do PDF, valida magic-byte,
   verifica duplicata por hash, grava no R2, insere linha `aguardando_validacao`.
2. Admin revisa e aprova (`POST /reference-documents/:id/approve`) ou rejeita
   (`POST /reference-documents/:id/reject`) — approve dispara chunking +
   embedding (mesmo padrão 3-fases de `normative-documents.service.ts`: preparar
   fora de transação → computar embeddings fora de transação → finalizar em
   transação curta, pelo mesmo motivo documentado lá — nunca segurar conexão do
   pool presa durante chamada HTTP lenta ao provedor de embedding).
3. `GET /reference-documents/:id/download` devolve URL assinada do R2 (documento
   `vigente`).
4. `POST /reference-documents/:id/reindex` reprocessa chunking/embedding de um
   documento já `vigente` (ex.: mudança no algoritmo de chunking).

## Integração no Assistente

`backend/src/normative/normative-assistant.service.ts` ganha uma terceira busca
em `searchReference()` (ao lado de normas oficiais e checklist), sempre
executada via `withoutTenantContext` (sem tenant, conhecimento compartilhado).
Os candidatos acima do threshold viram `ReferenceItem[]` passados pro
`NormativeAnswerProvider.answer()` (novo parâmetro, ao lado de `checklistItems`),
que por sua vez os injeta como seção própria no prompt do MiniMax/OpenRouter,
claramente rotulada como *"material de referência sem fonte oficial — NÃO é
texto oficial de norma"* — mesmo tratamento textual que `checklistItems` já
recebe hoje.

O `NormativeClaim` ganha `reference_ref_ids: string[]`, verificado pelo mesmo
mecanismo de id-check + `checkClaimSupport` (`claim-support.ts`) que já protege
`checklist_ref_ids`/`company_chunk_ids` — nenhuma claim pode citar um id que não
veio da busca, e uma claim citando só material de referência ainda passa pelo
Verificador v2 contra o texto do próprio trecho citado.

A hierarquia de fontes do `SYSTEM_PROMPT` (`normative-answer-shared.ts`) ganha
um item novo explicando que material de referência é complementar, nunca
substitui norma oficial — mesma lógica já usada pro item de checklist interno e
pelo guia EPI-por-função.

## Segurança e rastreabilidade

- **Magic-byte check** (`verifyFileContent`, `backend/src/common/files/file-content.util.ts`)
  antes de gravar qualquer coisa no R2 — mesmo padrão já usado por
  `documents.service.ts`, `tenants.service.ts`, etc.
- **`origin_note` obrigatório** — proveniência mínima mesmo sem URL oficial.
- **Aprovação humana obrigatória** — nada é indexado/vigente sem um admin
  aprovar explicitamente; upload por si só não afeta o Assistente.
- **Sem RLS** — decisão consciente, mesma categoria de `official_sources` (é
  conhecimento compartilhado, não dado de tenant); não há vazamento
  cross-tenant possível porque não há tenant nenhum envolvido.
- **Rotulagem explícita no prompt** — nunca apresentado como norma vigente,
  reforça o princípio do AGENTS.md de que a IA não é autoridade normativa.

## Testes

- `backend/test/reference-documents-approval.e2e-spec.ts` — espelha
  `normative-documents-approval.e2e-spec.ts`: upload, approve, reject, reindex,
  download, id inexistente, transição de status inválida.
- `backend/test/normative-assistant-reference-documents.e2e-spec.ts` — espelha
  `normative-assistant-checklist.e2e-spec.ts`: claim citando `reference_ref_ids`
  válido aparece em `reference_citations`; id inventado descarta a claim; id
  válido + id inválido descarta a claim inteira; Verificador v2 aplica ao texto
  do trecho de referência.
- `backend/test/normative-answer-shared.unit-spec.ts` — novos casos pra seção de
  prompt de `referenceItems` e pro campo `reference_ref_ids` no `TOOL_SCHEMA`
  (adicionados como `describe` novo; não tocar nos testes já quebrados
  preexistentes — ver ITEM 041 da auditoria de 28/09, fora de escopo).

## Rollout

A migration **nunca** é aplicada à produção como parte automática deste plano.
Testar antes num banco descartável (clone/rehearsal), depois aplicar em
produção só com autorização explícita do fundador e backup prévio
(`bash ops/backup-postgres.sh`) — mesma regra que já vale pra qualquer migration
neste projeto (AGENTS.md, seção Banco).
