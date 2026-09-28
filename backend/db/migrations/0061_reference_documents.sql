-- Documentos de referência SST (cartilhas, guias, apostilas) SEM fonte
-- oficial formal — separado de normative_documents/official_sources de
-- propósito: normative_documents é auditado por claim-support.ts contra a
-- hierarquia de fontes oficiais (MTE/Fundacentro/TST/MPT) e não pode
-- misturar conteúdo não-oficial (ver docs/specs/documentos-referencia-sst.md).
-- Mesma categoria de official_sources/normative_documents/sst_checklist_items:
-- compartilhado entre todos os tenants, SEM tenant_id, SEM RLS.
CREATE TABLE reference_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL,
  -- Única rastreabilidade de proveniência que este tipo de documento tem
  -- (não tem official_url nem hash de nova-versão de fonte, ao contrário
  -- de normative_documents) — por isso é obrigatório, nunca opcional.
  origin_note text NOT NULL,
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

-- Evita reprocessar (e duplicar linha aguardando_validacao) o mesmo arquivo
-- enviado mais de uma vez — checado em ReferenceDocumentsService.create().
CREATE INDEX reference_documents_content_hash_idx ON reference_documents(content_hash);

CREATE TABLE reference_document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES reference_documents(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX reference_document_chunks_embedding_idx
  ON reference_document_chunks USING hnsw (embedding vector_cosine_ops);
