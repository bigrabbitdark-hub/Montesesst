-- Fase 23 (Mapa SST): cargo vira entidade real por tenant. Ver
-- docs/specs/fase-23-mapa-sst.md. `positions` é análoga a
-- `company_units` (nome, renomeável, mesmo padrão de updated_at +
-- trigger). As duas tabelas de requisito são junções puras
-- (nunca editadas linha a linha — sempre substituídas por inteiro via
-- PUT .../epi-requirements e .../training-requirements, Task 3), por
-- isso não têm updated_at, mesmo padrão já usado em
-- employee_epi_deliveries.

CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER trg_positions_updated_at BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions FORCE ROW LEVEL SECURITY;
CREATE POLICY positions_isolation ON positions USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

-- SET NULL, não CASCADE nem RESTRICT: apagar um cargo não pode apagar
-- nem bloquear a exclusão do funcionário — ele só perde o vínculo e
-- some do cálculo de divergência (mesmo comportamento de "sem cargo
-- vinculado").
ALTER TABLE employees ADD COLUMN position_id UUID REFERENCES positions(id) ON DELETE SET NULL;

CREATE TABLE position_epi_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  epi_catalog_item_id UUID NOT NULL REFERENCES epi_catalog_items(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (position_id, epi_catalog_item_id)
);

ALTER TABLE position_epi_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_epi_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY position_epi_requirements_isolation ON position_epi_requirements USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE TABLE position_training_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'nr-05', 'nr-06', 'nr-10', 'nr-11', 'nr-12', 'nr-18', 'nr-20',
    'nr-33', 'nr-35', 'outro'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (position_id, tipo)
);

ALTER TABLE position_training_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE position_training_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY position_training_requirements_isolation ON position_training_requirements USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
