-- backend/db/migrations/0071_work_accidents.sql
-- Acidente de trabalho (CAT) e o evento S-2210. Uma linha de work_accidents = uma CAT.
-- A CAT de reabertura/óbito é uma NOVA linha que aponta para o evento da CAT de origem.
-- Dado de saúde sensível (LGPD art. 5º, II): RLS forçada, nunca enviado a IA, leitura só
-- pela empresa, técnico vinculado e admin. Os códigos de tabela (13, 14, 15, 17) e o CID são
-- informados por quem emite a CAT; o sistema não adivinha código.

CREATE TABLE work_accidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,

  acid_date DATE NOT NULL,
  acid_type SMALLINT NOT NULL CHECK (acid_type IN (1, 2, 3)),            -- 1 típico, 2 doença, 3 trajeto
  acid_time VARCHAR(4) CHECK (acid_time ~ '^([01][0-9]|2[0-3])[0-5][0-9]$'),
  hours_worked_before VARCHAR(4) CHECK (hours_worked_before ~ '^[0-9]{2}[0-5][0-9]$'),
  cat_type SMALLINT NOT NULL CHECK (cat_type IN (1, 2, 3)),              -- 1 inicial, 2 reabertura, 3 óbito
  death BOOLEAN NOT NULL DEFAULT false,
  death_date DATE,
  police_notified BOOLEAN NOT NULL,
  causing_situation_code VARCHAR(9) NOT NULL CHECK (causing_situation_code ~ '^[0-9]{9}$'), -- Tabela 15
  cat_initiative SMALLINT NOT NULL CHECK (cat_initiative IN (1, 2, 3)),
  cat_notes TEXT CHECK (char_length(cat_notes) <= 999),
  last_work_day DATE,
  had_leave BOOLEAN,

  location_type SMALLINT NOT NULL CHECK (location_type IN (1, 2, 3, 4, 5, 6, 9)),
  location_description TEXT CHECK (char_length(location_description) <= 255),
  loc_street_type VARCHAR(4),
  loc_street TEXT NOT NULL,
  loc_number TEXT NOT NULL,
  loc_complement TEXT,
  loc_district TEXT,
  loc_cep VARCHAR(8) CHECK (loc_cep ~ '^[0-9]{8}$'),
  loc_city_code VARCHAR(7) CHECK (loc_city_code ~ '^[0-9]{7}$'),
  loc_uf CHAR(2),
  loc_country VARCHAR(3) CHECK (loc_country ~ '^[0-9]{3}$'),
  loc_postal_code TEXT,
  loc_inscription_type SMALLINT CHECK (loc_inscription_type IN (1, 3, 4)),
  loc_inscription_number VARCHAR(14),

  body_part_code VARCHAR(9) NOT NULL CHECK (body_part_code ~ '^[0-9]{9}$'),   -- Tabela 13
  laterality SMALLINT NOT NULL CHECK (laterality IN (0, 1, 2, 3)),
  causing_agent_code VARCHAR(9) NOT NULL CHECK (causing_agent_code ~ '^[0-9]{9}$'), -- Tabela 14/15

  att_date DATE NOT NULL,
  att_time VARCHAR(4) NOT NULL CHECK (att_time ~ '^([01][0-9]|2[0-3])[0-5][0-9]$'),
  att_hospitalized BOOLEAN NOT NULL,
  att_treatment_days INTEGER NOT NULL CHECK (att_treatment_days BETWEEN 0 AND 9999),
  att_leave BOOLEAN NOT NULL,
  att_injury_code VARCHAR(9) NOT NULL CHECK (att_injury_code ~ '^[0-9]{9}$'),     -- Tabela 17
  att_injury_detail TEXT CHECK (char_length(att_injury_detail) <= 200),
  att_probable_diagnosis TEXT CHECK (char_length(att_probable_diagnosis) <= 100),
  att_cid VARCHAR(4) NOT NULL CHECK (char_length(att_cid) >= 3),
  att_notes TEXT,
  att_issuer_name TEXT NOT NULL,
  att_issuer_council SMALLINT NOT NULL CHECK (att_issuer_council IN (1, 2, 3)),   -- 1 CRM, 2 CRO, 3 RMS
  att_issuer_number VARCHAR(14) NOT NULL,
  att_issuer_uf CHAR(2),

  origin_event_id UUID REFERENCES esocial_events(id) ON DELETE RESTRICT,         -- CAT de origem (cat_type 2 ou 3)

  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE work_accidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_accidents FORCE ROW LEVEL SECURITY;
CREATE POLICY work_accidents_isolation ON work_accidents USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
CREATE INDEX work_accidents_tenant_id_idx ON work_accidents(tenant_id);
CREATE INDEX work_accidents_employee_id_idx ON work_accidents(employee_id);
CREATE TRIGGER trg_work_accidents_updated_at BEFORE UPDATE ON work_accidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- esocial_events passa a aceitar o S-2210 ----
ALTER TABLE esocial_events DROP CONSTRAINT esocial_events_event_type_check;
ALTER TABLE esocial_events ADD CONSTRAINT esocial_events_event_type_check
  CHECK (event_type IN ('S-2220', 'S-2210', 'S-3000'));

ALTER TABLE esocial_events ALTER COLUMN aso_record_id DROP NOT NULL;
ALTER TABLE esocial_events ADD COLUMN accident_id UUID REFERENCES work_accidents(id) ON DELETE RESTRICT;
-- Cada tipo aponta para a sua origem: S-2220 → ASO, S-2210 → acidente, S-3000 → evento excluído.
ALTER TABLE esocial_events ADD CONSTRAINT esocial_events_source_chk CHECK (
  (event_type = 'S-2220' AND aso_record_id IS NOT NULL AND accident_id IS NULL)
  OR (event_type = 'S-2210' AND accident_id IS NOT NULL AND aso_record_id IS NULL)
  OR (event_type = 'S-3000' AND target_event_id IS NOT NULL)
);
CREATE UNIQUE INDEX esocial_events_accident_active_uniq ON esocial_events(tenant_id, accident_id)
  WHERE event_type = 'S-2210' AND status NOT IN ('rejeitado', 'erro_tecnico', 'excluido');
