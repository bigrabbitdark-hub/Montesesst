-- Fase 11 — agenda de visitas: fluxo empresa solicita / técnico ou
-- parceiro confirma. technician_user_id é um único FK pra users(id)
-- (não dois FKs separados por papel) porque technicians.user_id e
-- partners.user_id já apontam pra users de forma única (ver
-- 0001_init.sql). RLS copia exatamente o padrão de
-- 0011_partner_access.sql (branch empresa/técnico/parceiro).
CREATE TABLE visit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  technician_user_id UUID NOT NULL REFERENCES users(id),
  requested_by_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'solicitado'
    CHECK (status IN ('solicitado', 'confirmado', 'concluido', 'cancelado')),
  preferred_date DATE,
  confirmed_date DATE,
  motivo TEXT,
  inspection_id UUID REFERENCES inspections(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX visit_requests_technician_idx ON visit_requests (technician_user_id);
CREATE INDEX visit_requests_tenant_idx ON visit_requests (tenant_id);
CREATE INDEX visit_requests_confirmed_date_idx ON visit_requests (confirmed_date)
  WHERE status = 'confirmado';

CREATE TRIGGER trg_visit_requests_updated_at BEFORE UPDATE ON visit_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE visit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY visit_requests_isolation ON visit_requests USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = visit_requests.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = visit_requests.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);
