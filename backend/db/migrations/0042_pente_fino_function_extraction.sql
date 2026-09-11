-- Fase 25: extração estruturada função→risco (PGR) e função→exame
-- (PCMSO), isolada por tenant. RLS via assigned_tenant_ids_for_current_user()
-- (já existe desde 0001_init.sql, cobre técnico+parceiro numa
-- subquery só) — padrão das migrations mais recentes antes desta
-- (0035-0039), não o EXISTS repetido em duas cláusulas separadas que
-- documents_isolation/company_document_chunks_isolation usam.

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

ALTER TABLE pgr_function_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pgr_function_risks FORCE ROW LEVEL SECURITY;
CREATE POLICY pgr_function_risks_isolation ON pgr_function_risks USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE pcmso_function_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE pcmso_function_exams FORCE ROW LEVEL SECURITY;
CREATE POLICY pcmso_function_exams_isolation ON pcmso_function_exams USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
