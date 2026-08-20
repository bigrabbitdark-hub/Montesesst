-- Fase 3 (Onboarding): dados complementares da empresa, filiais e vínculo
-- de funcionário com filial. Ver docs/specs/fase-3-onboarding.md.

ALTER TABLE tenants ADD COLUMN sector TEXT;
ALTER TABLE tenants ADD COLUMN contact_name TEXT;
ALTER TABLE tenants ADD COLUMN contact_phone TEXT;

CREATE TABLE company_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address_street TEXT NOT NULL,
  address_number TEXT,
  address_city TEXT NOT NULL,
  address_state VARCHAR(2) NOT NULL,
  address_zip VARCHAR(8) NOT NULL,
  status record_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_company_units_updated_at BEFORE UPDATE ON company_units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE company_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_units FORCE ROW LEVEL SECURITY;
CREATE POLICY company_units_isolation ON company_units USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
);

ALTER TABLE employees ADD COLUMN company_unit_id UUID
  REFERENCES company_units(id) ON DELETE SET NULL;
