-- Fase 4 (sub-projeto A — Documentos): repositório de documentos de
-- conformidade em R2, com RLS que também cobre a visão do técnico
-- vinculado (não só do próprio tenant). Ver docs/specs/fase-4-documentos.md.

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (
    category IN ('pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento')
  ),
  title TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  expires_at DATE,
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id),
  uploaded_by_role TEXT NOT NULL CHECK (uploaded_by_role IN ('empresa', 'tecnico')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_isolation ON documents USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = documents.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
);
