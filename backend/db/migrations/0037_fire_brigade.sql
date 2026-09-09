-- Prevenção e Emergência, sub-projeto B: gestão da brigada de incêndio.
-- Ver docs/specs/prevencao-emergencia-brigada.md. Lista plana de
-- membros por filial, sem ciclo/mandato (diferente de cipa_members) —
-- brigadista é sempre um funcionário já cadastrado (employee_id).

CREATE TABLE fire_brigade_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  funcao_brigada TEXT NOT NULL CHECK (funcao_brigada IN ('lider', 'vice_lider', 'brigadista')),
  turno TEXT,
  telefone TEXT,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id)
);
CREATE INDEX fire_brigade_members_company_unit_idx ON fire_brigade_members (company_unit_id);
CREATE TRIGGER trg_fire_brigade_members_updated_at BEFORE UPDATE ON fire_brigade_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE fire_brigade_trainings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- CASCADE, não RESTRICT como cipa_trainings.employee_id — aqui o
  -- "dono" do histórico é o vínculo com a brigada, não o funcionário
  -- em si. Se o brigadista sai da brigada, o histórico de treinamento
  -- de brigada não tem mais sentido isolado.
  member_id UUID NOT NULL REFERENCES fire_brigade_members(id) ON DELETE CASCADE,
  data_realizacao DATE NOT NULL,
  data_validade DATE NOT NULL,
  carga_horaria INT,
  certificado_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fire_brigade_trainings_member_idx ON fire_brigade_trainings (member_id);
CREATE INDEX fire_brigade_trainings_validade_idx ON fire_brigade_trainings (data_validade);
CREATE TRIGGER trg_fire_brigade_trainings_updated_at BEFORE UPDATE ON fire_brigade_trainings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE fire_brigade_coverage_targets (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  quantidade_necessaria INT NOT NULL DEFAULT 0 CHECK (quantidade_necessaria >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_unit_id)
);
CREATE TRIGGER trg_fire_brigade_coverage_targets_updated_at BEFORE UPDATE ON fire_brigade_coverage_targets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE fire_brigade_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_brigade_members FORCE ROW LEVEL SECURITY;
CREATE POLICY fire_brigade_members_isolation ON fire_brigade_members USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE fire_brigade_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_brigade_trainings FORCE ROW LEVEL SECURITY;
CREATE POLICY fire_brigade_trainings_isolation ON fire_brigade_trainings USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE fire_brigade_coverage_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_brigade_coverage_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY fire_brigade_coverage_targets_isolation ON fire_brigade_coverage_targets USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
