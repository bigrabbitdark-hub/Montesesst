-- Fase 27: checklist preliminar do Pente-Fino (data de elaboração +
-- profissional habilitado), uma linha por documento — diferente de
-- pgr_function_risks/pcmso_function_exams (por função). RLS idêntica
-- ao padrão da Fase 25 (0042).

CREATE TABLE document_checklist_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  elaboration_date date,
  elaboration_date_source_excerpt text,
  professional_name text,
  professional_registro text,
  professional_papel text,
  professional_source_excerpt text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_checklist_findings_tenant_id_idx ON document_checklist_findings (tenant_id);
CREATE INDEX document_checklist_findings_document_id_idx ON document_checklist_findings (document_id);

ALTER TABLE document_checklist_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_checklist_findings FORCE ROW LEVEL SECURITY;
CREATE POLICY document_checklist_findings_isolation ON document_checklist_findings USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
