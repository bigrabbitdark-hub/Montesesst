-- Fase 28: extração estruturada de agentes de insalubridade do LIP,
-- múltiplas linhas por documento (zero a N agentes) — mesmo espírito de
-- pgr_function_risks/pcmso_function_exams (0042), não document_checklist_findings
-- (0043, sempre 1 linha). RLS idêntica ao padrão de 0042.

CREATE TABLE lip_agent_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  agent_name_raw text NOT NULL,
  agent_category text NOT NULL,
  measured_value_raw text,
  insalubre boolean,
  conclusion_excerpt text,
  source_excerpt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lip_agent_findings_tenant_id_idx ON lip_agent_findings (tenant_id);
CREATE INDEX lip_agent_findings_document_id_idx ON lip_agent_findings (document_id);

ALTER TABLE lip_agent_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lip_agent_findings FORCE ROW LEVEL SECURITY;
CREATE POLICY lip_agent_findings_isolation ON lip_agent_findings USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
