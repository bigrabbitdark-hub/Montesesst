-- Prevenção e Emergência, sub-projeto C: checklist de prevenção +
-- simulado de emergência. Ver docs/specs/prevencao-emergencia-checklist-simulado.md.
-- Ações corretivas têm tabela própria, não reaproveita action_plans
-- (que tem inspection_id NOT NULL, exigiria alterar tabela em produção).

CREATE TABLE prevention_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  technician_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'concluida')),
  data_realizacao DATE NOT NULL,
  concluded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX prevention_checklists_company_unit_idx ON prevention_checklists (company_unit_id);
CREATE TRIGGER trg_prevention_checklists_updated_at BEFORE UPDATE ON prevention_checklists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE prevention_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES prevention_checklists(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  item_label TEXT NOT NULL,
  status TEXT CHECK (status IN ('C', 'NC', 'NA')),
  observacoes TEXT,
  foto_r2_key TEXT,
  UNIQUE (checklist_id, item_key)
);

CREATE TABLE emergency_drills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  data_realizacao DATE NOT NULL,
  horario TIME,
  tempo_evacuacao_segundos INT,
  ponto_encontro_adequado BOOLEAN,
  falhas_sinalizacao BOOLEAN NOT NULL DEFAULT false,
  falhas_iluminacao BOOLEAN NOT NULL DEFAULT false,
  portas_bloqueadas BOOLEAN NOT NULL DEFAULT false,
  extintores_obstruidos BOOLEAN NOT NULL DEFAULT false,
  observacoes TEXT,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX emergency_drills_company_unit_idx ON emergency_drills (company_unit_id);
CREATE TRIGGER trg_emergency_drills_updated_at BEFORE UPDATE ON emergency_drills
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE emergency_drill_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_id UUID NOT NULL REFERENCES emergency_drills(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  presente BOOLEAN NOT NULL,
  UNIQUE (drill_id, employee_id)
);

CREATE TABLE prevention_corrective_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  checklist_item_id UUID REFERENCES prevention_checklist_items(id) ON DELETE CASCADE,
  drill_id UUID REFERENCES emergency_drills(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  deadline DATE,
  responsible TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'resolvido')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_corrective_action_source CHECK (
    (checklist_item_id IS NOT NULL AND drill_id IS NULL)
    OR (checklist_item_id IS NULL AND drill_id IS NOT NULL)
  )
);

ALTER TABLE prevention_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE prevention_checklists FORCE ROW LEVEL SECURITY;
CREATE POLICY prevention_checklists_isolation ON prevention_checklists USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE prevention_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE prevention_checklist_items FORCE ROW LEVEL SECURITY;
CREATE POLICY prevention_checklist_items_isolation ON prevention_checklist_items USING (
  EXISTS (SELECT 1 FROM prevention_checklists c WHERE c.id = prevention_checklist_items.checklist_id)
);

ALTER TABLE emergency_drills ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_drills FORCE ROW LEVEL SECURITY;
CREATE POLICY emergency_drills_isolation ON emergency_drills USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE emergency_drill_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_drill_participants FORCE ROW LEVEL SECURITY;
CREATE POLICY emergency_drill_participants_isolation ON emergency_drill_participants USING (
  EXISTS (SELECT 1 FROM emergency_drills d WHERE d.id = emergency_drill_participants.drill_id)
);

ALTER TABLE prevention_corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prevention_corrective_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY prevention_corrective_actions_isolation ON prevention_corrective_actions USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
