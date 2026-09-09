-- Prevenção e Emergência, sub-projeto A: equipamentos contra incêndio.
-- Ver docs/specs/prevencao-emergencia-equipamentos.md. Uma tabela só
-- pra todos os ~11 tipos (decisão do fundador) — agente_extintor/
-- capacidade/classe_fogo só fazem sentido pra tipo='extintor', ficam
-- NULL pros demais (mesmo padrão de cipa_trainings.tipo_outro).

CREATE TABLE fire_safety_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'extintor', 'hidrante', 'mangueira', 'alarme', 'detector',
    'iluminacao_emergencia', 'saida_emergencia', 'porta_corta_fogo',
    'sprinkler', 'central_alarme', 'outro'
  )),
  codigo TEXT,
  localizacao TEXT,
  data_instalacao DATE,
  data_ultima_manutencao DATE,
  proxima_manutencao DATE,
  empresa_responsavel TEXT,
  observacoes TEXT,
  foto_r2_key TEXT,
  -- Só usados quando tipo = 'extintor'; NULL nos demais casos (mesmo
  -- padrão já usado em cipa_trainings.tipo_outro pra campo condicional).
  agente_extintor TEXT,
  capacidade TEXT,
  classe_fogo TEXT,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_fire_safety_equipment_updated_at BEFORE UPDATE ON fire_safety_equipment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE fire_safety_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_safety_equipment FORCE ROW LEVEL SECURITY;
CREATE POLICY fire_safety_equipment_isolation ON fire_safety_equipment USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
