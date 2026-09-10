-- Fase 24: indexação de conteúdo de documentos da empresa (PGR/PCMSO/
-- LTCAT/LIP), isolada por tenant — DIFERENTE de normative_document_chunks
-- (Fase 9), que é conteúdo público (normas oficiais) sem RLS. Aqui é dado
-- da empresa, RLS obrigatória desde a criação. Extensão `vector` já
-- existe desde a Fase 9, nenhum setup novo necessário.

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
