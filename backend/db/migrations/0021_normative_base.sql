-- Fase 9 (RAG Normativo): base de normas oficiais de SST, compartilhada
-- entre todos os clientes — SEM tenant_id, SEM RLS (mesma categoria de
-- epi_catalog_items). A extensão `vector` já foi criada via superuser
-- antes desta migration (a role montese_app, que roda esta migration,
-- não tem privilégio garantido de CREATE EXTENSION). Ver
-- docs/specs/fase-9-rag-normativo.md e docs/plans/fase-9-rag-normativo.md
-- (Global Constraints).

CREATE TABLE official_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity text NOT NULL,
  code text,
  title text NOT NULL,
  official_url text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE normative_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES official_sources(id),
  status text NOT NULL DEFAULT 'aguardando_validacao'
    CHECK (status IN ('aguardando_validacao', 'vigente', 'rejeitado', 'substituido')),
  content_hash text NOT NULL,
  file_key text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  raw_text text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by_user_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  supersedes_document_id uuid REFERENCES normative_documents(id),
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX normative_documents_one_vigente_per_source
  ON normative_documents(source_id) WHERE status = 'vigente';

CREATE TABLE normative_document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES normative_documents(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX normative_document_chunks_embedding_idx
  ON normative_document_chunks USING hnsw (embedding vector_cosine_ops);
