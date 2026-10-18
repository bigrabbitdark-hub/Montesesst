-- Auditoria cruzada SST: extrações page-aware e fatos rastreáveis por documento.
-- Cache tenant-scoped; não contém PDF nem histórico de relatórios.

CREATE TABLE sst_audit_document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  document_sha256 char(64) NOT NULL,
  extractor_version text NOT NULL,
  page_count integer NOT NULL CHECK (page_count >= 0),
  status text NOT NULL CHECK (status IN ('complete', 'partial', 'failed')),
  unevaluated_pages integer[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, document_sha256, extractor_version)
);

CREATE TABLE sst_audit_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  extraction_id uuid NOT NULL REFERENCES sst_audit_document_extractions(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  fact_type text NOT NULL,
  subject_type text NOT NULL,
  subject_raw text NOT NULL,
  subject_key text NOT NULL,
  value_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  unit text,
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('quoted_claim', 'direct_measurement', 'document_metadata')),
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  page_number integer NOT NULL CHECK (page_number > 0),
  source_excerpt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sst_audit_document_extractions_tenant_document_idx
  ON sst_audit_document_extractions (tenant_id, document_id);
CREATE INDEX sst_audit_facts_tenant_extraction_idx
  ON sst_audit_facts (tenant_id, extraction_id);
CREATE INDEX sst_audit_facts_document_page_idx
  ON sst_audit_facts (document_id, page_number);
CREATE INDEX sst_audit_facts_subject_idx
  ON sst_audit_facts (tenant_id, subject_type, subject_key);

ALTER TABLE sst_audit_document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sst_audit_document_extractions FORCE ROW LEVEL SECURITY;
CREATE POLICY sst_audit_document_extractions_isolation ON sst_audit_document_extractions USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE sst_audit_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sst_audit_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY sst_audit_facts_isolation ON sst_audit_facts USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);