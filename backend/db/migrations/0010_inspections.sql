-- Fase 6 (sub-projeto A — Fluxo de inspeção): checklist estruturado de
-- visita técnica presencial (9 blocos do modelo de referência), com
-- geração automática de plano de ação a partir de item não conforme.
-- Ver docs/specs/fase-6-inspecoes.md.

CREATE TABLE inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  technician_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'concluida')),
  visited_at DATE NOT NULL,
  company_contact TEXT,
  dds_topic TEXT,
  dds_participants_count INTEGER,
  dds_notes TEXT,
  general_recommendations TEXT,
  technician_signature_name TEXT,
  technician_signature_at TIMESTAMPTZ,
  company_signature_name TEXT,
  company_signature_at TIMESTAMPTZ,
  concluded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_inspections_updated_at BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections FORCE ROW LEVEL SECURITY;
CREATE POLICY inspections_isolation ON inspections USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = inspections.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
);

CREATE TABLE inspection_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  block TEXT NOT NULL CHECK (block IN ('documentacao', 'epis', 'instalacoes', 'maquinas')),
  item_key TEXT NOT NULL,
  item_label TEXT NOT NULL,
  status TEXT CHECK (status IN ('C', 'NC', 'NA')),
  notes TEXT,
  UNIQUE (inspection_id, item_key)
);

ALTER TABLE inspection_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_checklist_items FORCE ROW LEVEL SECURITY;
CREATE POLICY inspection_checklist_items_isolation ON inspection_checklist_items USING (
  EXISTS (SELECT 1 FROM inspections i WHERE i.id = inspection_checklist_items.inspection_id)
);

CREATE TABLE action_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  checklist_item_id UUID REFERENCES inspection_checklist_items(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  deadline DATE,
  responsible TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'resolvido')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY action_plans_isolation ON action_plans USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = action_plans.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
);
