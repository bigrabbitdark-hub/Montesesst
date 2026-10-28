-- PGR (sub-projeto A) — Inventário de riscos: biblioteca de perigos, GHE, cargos do GHE, riscos,
-- controles e medições. Aditiva; a biblioteca nasce VAZIA (sem seed de perigos, limites ou códigos
-- da Tabela 24 do eSocial). Acesso: admin (tudo) e socio (leitura da biblioteca global + CRUD só em
-- cliente da carteira Montese, via is_montese_tenant()). empresa/tecnico/parceiro: sem policy = sem acesso.
-- A autorização fina (pgr.read / pgr.write) é do PermissionsGuard no backend; o banco isola por tenant.
-- Rollback (descartável; destrutivo, só com autorização):
--   (o índice único pgr_risks_ghe_hazard_uidx cai junto com pgr_risks)
--   DROP TABLE pgr_risk_measurements, pgr_risk_controls, pgr_risks, pgr_ghe_positions, pgr_ghes, pgr_hazards;
--   DROP FUNCTION pgr_check_parent_tenant(); DROP FUNCTION pgr_check_hazard_tenant(); DROP FUNCTION pgr_guard_immutable_tenant();
--   DELETE FROM socio_permissions WHERE permission LIKE 'pgr.%';
--   ALTER TABLE socio_permissions DROP CONSTRAINT socio_permissions_permission_check;
--   ALTER TABLE socio_permissions ADD CONSTRAINT socio_permissions_permission_check CHECK (permission IN (
--     'clients.read','clients.update_operational','tasks.read','tasks.write','appointments.manage',
--     'documents.create_draft','documents.review','documents.sign','documents.read','documents.approve',
--     'documents.publish','documents.cancel','documents.view_registration','finance.read',
--     'empresas.read','empresas.documentos'));   -- CHECK de 16 valores da 0097

-- ---------------------------------------------------------------------------
-- Permissões do sócio (lista fechada): 16 da 0097 + pgr.read / pgr.write.
-- ---------------------------------------------------------------------------
ALTER TABLE socio_permissions DROP CONSTRAINT IF EXISTS socio_permissions_permission_check;
ALTER TABLE socio_permissions ADD CONSTRAINT socio_permissions_permission_check CHECK (permission IN (
  'clients.read','clients.update_operational','tasks.read','tasks.write','appointments.manage',
  'documents.create_draft','documents.review','documents.sign','documents.read','documents.approve',
  'documents.publish','documents.cancel','documents.view_registration','finance.read',
  'empresas.read','empresas.documentos','pgr.read','pgr.write'));

-- ---------------------------------------------------------------------------
-- Biblioteca de perigos: global (tenant_id nulo) ou do tenant.
-- ---------------------------------------------------------------------------
CREATE TABLE pgr_hazards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL CHECK (scope IN ('global','tenant')),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('fisico','quimico','biologico','ergonomico','acidente','psicossocial')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description TEXT, sources TEXT, health_effects TEXT,
  exposure_routes TEXT[] NOT NULL DEFAULT '{}',
  default_assessment TEXT CHECK (default_assessment IN ('qualitativa','quantitativa')),
  default_unit TEXT, tolerance_limit TEXT, tolerance_reference TEXT, suggested_controls TEXT,
  esocial_code TEXT CHECK (esocial_code IS NULL OR length(esocial_code) <= 20),
  psychosocial JSONB CHECK (psychosocial IS NULL OR octet_length(psychosocial::text) <= 12000),
  active BOOLEAN NOT NULL DEFAULT true,
  origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','importado','duplicado')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((scope = 'global' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL))
);
-- Perigos inativos (active=false) continuam reservando o nome: reativar/renomear em vez de recriar.
CREATE UNIQUE INDEX pgr_hazards_unique_name ON pgr_hazards
  (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), category, lower(name));
CREATE INDEX pgr_hazards_tenant_idx ON pgr_hazards (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX pgr_hazards_created_by_idx ON pgr_hazards (created_by) WHERE created_by IS NOT NULL;
CREATE TRIGGER trg_pgr_hazards_updated_at BEFORE UPDATE ON pgr_hazards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- GHE (grupo homogêneo de exposição) e vínculo com cargos.
-- ---------------------------------------------------------------------------
CREATE TABLE pgr_ghes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  environment_description TEXT, process_description TEXT, activities TEXT,
  machines_products TEXT, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pgr_ghes_tenant_idx ON pgr_ghes (tenant_id);
CREATE INDEX pgr_ghes_unit_idx ON pgr_ghes (company_unit_id) WHERE company_unit_id IS NOT NULL;
CREATE TRIGGER trg_pgr_ghes_updated_at BEFORE UPDATE ON pgr_ghes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE pgr_ghe_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ghe_id UUID NOT NULL REFERENCES pgr_ghes(id) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ghe_id, position_id)
);
CREATE INDEX pgr_ghe_positions_tenant_idx ON pgr_ghe_positions (tenant_id);
CREATE INDEX pgr_ghe_positions_position_idx ON pgr_ghe_positions (position_id);
CREATE TRIGGER trg_pgr_ghe_positions_updated_at BEFORE UPDATE ON pgr_ghe_positions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Riscos do GHE (campos do perigo COPIADOS: editar a biblioteca não altera riscos existentes).
-- ---------------------------------------------------------------------------
CREATE TABLE pgr_risks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ghe_id UUID NOT NULL REFERENCES pgr_ghes(id) ON DELETE CASCADE,
  hazard_id UUID REFERENCES pgr_hazards(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('fisico','quimico','biologico','ergonomico','acidente','psicossocial')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description TEXT, sources TEXT, health_effects TEXT,
  exposure_routes TEXT[] NOT NULL DEFAULT '{}',
  tolerance_limit TEXT, tolerance_reference TEXT,
  psychosocial JSONB CHECK (psychosocial IS NULL OR octet_length(psychosocial::text) <= 12000),
  activity TEXT,
  -- exposure_type nulo = ainda não informado (nenhum dado técnico presumido); status 'completo' exige preenchimento (API).
  exposure_type TEXT CHECK (exposure_type IS NULL OR exposure_type IN ('habitual_permanente','intermitente','eventual')),
  esocial_code TEXT CHECK (esocial_code IS NULL OR length(esocial_code) <= 20),
  assessment_type TEXT CHECK (assessment_type IN ('qualitativa','quantitativa')),
  assessment_notes TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','completo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pgr_risks_tenant_idx ON pgr_risks (tenant_id);
CREATE INDEX pgr_risks_ghe_idx ON pgr_risks (ghe_id);
CREATE INDEX pgr_risks_hazard_idx ON pgr_risks (hazard_id) WHERE hazard_id IS NOT NULL;
-- Um perigo da biblioteca entra no máximo uma vez por GHE (corrida de duas requisições ⇒ 23505).
CREATE UNIQUE INDEX pgr_risks_ghe_hazard_uidx ON pgr_risks (ghe_id, hazard_id) WHERE hazard_id IS NOT NULL;
CREATE TRIGGER trg_pgr_risks_updated_at BEFORE UPDATE ON pgr_risks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE pgr_risk_controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  risk_id UUID NOT NULL REFERENCES pgr_risks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('epc','epi','administrativa','treinamento')),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 2000),
  status TEXT NOT NULL CHECK (status IN ('existente','planejado','nao_implementado')),  -- sem padrão: informado pelo sócio
  effectiveness TEXT NOT NULL DEFAULT 'nao_avaliada' CHECK (effectiveness IN ('eficaz','ineficaz','nao_avaliada')),
  epi_catalog_item_id UUID REFERENCES epi_catalog_items(id) ON DELETE SET NULL,
  training_tipo TEXT CHECK (training_tipo IN (
    'nr-05','nr-06','nr-10','nr-11','nr-12','nr-18','nr-20','nr-33','nr-35','outro')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pgr_risk_controls_tenant_idx ON pgr_risk_controls (tenant_id);
CREATE INDEX pgr_risk_controls_risk_idx ON pgr_risk_controls (risk_id);
CREATE INDEX pgr_risk_controls_epi_idx ON pgr_risk_controls (epi_catalog_item_id) WHERE epi_catalog_item_id IS NOT NULL;
CREATE TRIGGER trg_pgr_risk_controls_updated_at BEFORE UPDATE ON pgr_risk_controls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE pgr_risk_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  risk_id UUID NOT NULL REFERENCES pgr_risks(id) ON DELETE CASCADE,
  agent TEXT NOT NULL CHECK (length(agent) BETWEEN 1 AND 200),
  value TEXT, unit TEXT, tolerance_limit TEXT, reference TEXT,
  methodology TEXT, equipment TEXT, equipment_serial TEXT,
  calibration_date DATE, evaluated_on DATE,
  responsible_name TEXT,
  professional_registration_id UUID REFERENCES professional_registrations(id) ON DELETE SET NULL,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pgr_risk_measurements_tenant_idx ON pgr_risk_measurements (tenant_id);
CREATE INDEX pgr_risk_measurements_risk_idx ON pgr_risk_measurements (risk_id);
CREATE INDEX pgr_risk_measurements_reg_idx ON pgr_risk_measurements (professional_registration_id)
  WHERE professional_registration_id IS NOT NULL;
CREATE INDEX pgr_risk_measurements_doc_idx ON pgr_risk_measurements (document_id) WHERE document_id IS NOT NULL;
CREATE TRIGGER trg_pgr_risk_measurements_updated_at BEFORE UPDATE ON pgr_risk_measurements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Coerência de tenant entre filho e pai. Funções SECURITY INVOKER: pai invisível pela RLS
-- (outro tenant) é tratado como inexistente, o que também barra o caso. RLS não valida FKs.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pgr_check_parent_tenant() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_parent_table TEXT := TG_ARGV[0];
  v_fk TEXT := TG_ARGV[1];
  v_parent_id UUID := (to_jsonb(NEW) ->> v_fk)::uuid;
  v_parent_tenant UUID;
BEGIN
  IF v_parent_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT tenant_id FROM %I WHERE id = $1', v_parent_table) INTO v_parent_tenant USING v_parent_id;
  IF v_parent_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant incoerente: % (%) não pertence ao tenant da linha', v_fk, v_parent_table
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- Perigo global (tenant nulo) pode ser copiado por qualquer tenant; perigo de tenant só pelo próprio.
CREATE FUNCTION pgr_check_hazard_tenant() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_found BOOLEAN;
  v_hazard_tenant UUID;
BEGIN
  IF NEW.hazard_id IS NULL THEN RETURN NEW; END IF;
  SELECT true, tenant_id INTO v_found, v_hazard_tenant FROM pgr_hazards WHERE id = NEW.hazard_id;
  IF v_found IS NOT TRUE OR (v_hazard_tenant IS NOT NULL AND v_hazard_tenant <> NEW.tenant_id) THEN
    RAISE EXCEPTION 'tenant incoerente: hazard_id (pgr_hazards) não pertence ao tenant da linha'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_a_pgr_ghes_tenant BEFORE INSERT OR UPDATE ON pgr_ghes
  FOR EACH ROW EXECUTE FUNCTION pgr_check_parent_tenant('company_units', 'company_unit_id');
CREATE TRIGGER trg_a_pgr_ghe_positions_ghe BEFORE INSERT OR UPDATE ON pgr_ghe_positions
  FOR EACH ROW EXECUTE FUNCTION pgr_check_parent_tenant('pgr_ghes', 'ghe_id');
CREATE TRIGGER trg_a_pgr_ghe_positions_pos BEFORE INSERT OR UPDATE ON pgr_ghe_positions
  FOR EACH ROW EXECUTE FUNCTION pgr_check_parent_tenant('positions', 'position_id');
CREATE TRIGGER trg_a_pgr_risks_ghe BEFORE INSERT OR UPDATE ON pgr_risks
  FOR EACH ROW EXECUTE FUNCTION pgr_check_parent_tenant('pgr_ghes', 'ghe_id');
CREATE TRIGGER trg_a_pgr_risks_hazard BEFORE INSERT OR UPDATE ON pgr_risks
  FOR EACH ROW EXECUTE FUNCTION pgr_check_hazard_tenant();
CREATE TRIGGER trg_a_pgr_risk_controls_risk BEFORE INSERT OR UPDATE ON pgr_risk_controls
  FOR EACH ROW EXECUTE FUNCTION pgr_check_parent_tenant('pgr_risks', 'risk_id');
CREATE TRIGGER trg_a_pgr_risk_measurements_risk BEFORE INSERT OR UPDATE ON pgr_risk_measurements
  FOR EACH ROW EXECUTE FUNCTION pgr_check_parent_tenant('pgr_risks', 'risk_id');


CREATE TRIGGER trg_a_pgr_risk_measurements_doc BEFORE INSERT OR UPDATE ON pgr_risk_measurements
  FOR EACH ROW EXECUTE FUNCTION pgr_check_parent_tenant('documents', 'document_id');

-- tenant_id (e scope, na biblioteca) é imutável: senão filhos ficariam apontando para pai de outro tenant.
CREATE FUNCTION pgr_guard_immutable_tenant() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id é imutável em %', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'pgr_hazards' THEN
    IF NEW.scope IS DISTINCT FROM OLD.scope THEN
      RAISE EXCEPTION 'scope é imutável em pgr_hazards' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_a_pgr_hazards_immutable_tenant BEFORE UPDATE ON pgr_hazards
  FOR EACH ROW EXECUTE FUNCTION pgr_guard_immutable_tenant();
CREATE TRIGGER trg_a_pgr_ghes_immutable_tenant BEFORE UPDATE ON pgr_ghes
  FOR EACH ROW EXECUTE FUNCTION pgr_guard_immutable_tenant();
CREATE TRIGGER trg_a_pgr_ghe_positions_immutable_tenant BEFORE UPDATE ON pgr_ghe_positions
  FOR EACH ROW EXECUTE FUNCTION pgr_guard_immutable_tenant();
CREATE TRIGGER trg_a_pgr_risks_immutable_tenant BEFORE UPDATE ON pgr_risks
  FOR EACH ROW EXECUTE FUNCTION pgr_guard_immutable_tenant();
CREATE TRIGGER trg_a_pgr_risk_controls_immutable_tenant BEFORE UPDATE ON pgr_risk_controls
  FOR EACH ROW EXECUTE FUNCTION pgr_guard_immutable_tenant();
CREATE TRIGGER trg_a_pgr_risk_measurements_immutable_tenant BEFORE UPDATE ON pgr_risk_measurements
  FOR EACH ROW EXECUTE FUNCTION pgr_guard_immutable_tenant();

-- ---------------------------------------------------------------------------
-- RLS: ENABLE + FORCE e policies por papel.
-- ---------------------------------------------------------------------------
ALTER TABLE pgr_hazards ENABLE ROW LEVEL SECURITY;           ALTER TABLE pgr_hazards FORCE ROW LEVEL SECURITY;
ALTER TABLE pgr_ghes ENABLE ROW LEVEL SECURITY;              ALTER TABLE pgr_ghes FORCE ROW LEVEL SECURITY;
ALTER TABLE pgr_ghe_positions ENABLE ROW LEVEL SECURITY;     ALTER TABLE pgr_ghe_positions FORCE ROW LEVEL SECURITY;
ALTER TABLE pgr_risks ENABLE ROW LEVEL SECURITY;             ALTER TABLE pgr_risks FORCE ROW LEVEL SECURITY;
ALTER TABLE pgr_risk_controls ENABLE ROW LEVEL SECURITY;     ALTER TABLE pgr_risk_controls FORCE ROW LEVEL SECURITY;
ALTER TABLE pgr_risk_measurements ENABLE ROW LEVEL SECURITY; ALTER TABLE pgr_risk_measurements FORCE ROW LEVEL SECURITY;

CREATE POLICY pgr_hazards_admin ON pgr_hazards USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY pgr_hazards_socio_select ON pgr_hazards FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND (scope = 'global' OR is_montese_tenant(tenant_id)));
CREATE POLICY pgr_hazards_socio_write ON pgr_hazards FOR ALL
  USING (current_setting('app.role', true) = 'socio' AND scope = 'tenant' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND scope = 'tenant' AND is_montese_tenant(tenant_id));

CREATE POLICY pgr_ghes_admin ON pgr_ghes USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY pgr_ghes_socio ON pgr_ghes FOR ALL
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

CREATE POLICY pgr_ghe_positions_admin ON pgr_ghe_positions USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY pgr_ghe_positions_socio ON pgr_ghe_positions FOR ALL
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

CREATE POLICY pgr_risks_admin ON pgr_risks USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY pgr_risks_socio ON pgr_risks FOR ALL
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

CREATE POLICY pgr_risk_controls_admin ON pgr_risk_controls USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY pgr_risk_controls_socio ON pgr_risk_controls FOR ALL
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

CREATE POLICY pgr_risk_measurements_admin ON pgr_risk_measurements USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY pgr_risk_measurements_socio ON pgr_risk_measurements FOR ALL
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
