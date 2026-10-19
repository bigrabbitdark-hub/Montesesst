-- backend/db/migrations/0067_aso_module.sql
-- Módulo ASO: dado de SST puro, reaproveitável independente do eSocial (peer de
-- epi/caepi). exam_type e result seguem os valores inferidos do bloco exMedOcup/aso
-- do evento S-2220 (ver docs/specs/esocial-arquitetura.md — INFERIDO, confirmar
-- contra o XSD oficial antes da Task 13 gerar o payload do evento).

CREATE TABLE tenant_pcmso_physicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cpf VARCHAR(11) NOT NULL,
  name TEXT NOT NULL,
  crm TEXT NOT NULL,
  crm_uf CHAR(2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_pcmso_physicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_pcmso_physicians FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_pcmso_physicians_isolation ON tenant_pcmso_physicians USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE TABLE aso_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  exam_type TEXT NOT NULL CHECK (exam_type IN (
    'admissional', 'periodico', 'retorno_trabalho', 'mudanca_funcao',
    'monitoracao_pontual', 'demissional'
  )),
  exam_date DATE NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('apto', 'inapto')),
  result_disclosure_authorized BOOLEAN NOT NULL DEFAULT false,
  doctor_name TEXT NOT NULL,
  doctor_crm TEXT NOT NULL,
  doctor_crm_uf CHAR(2) NOT NULL,
  pcmso_physician_id UUID REFERENCES tenant_pcmso_physicians(id),
  file_key TEXT,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE aso_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE aso_records FORCE ROW LEVEL SECURITY;
CREATE POLICY aso_records_isolation ON aso_records USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE INDEX aso_records_tenant_id_idx ON aso_records(tenant_id);
CREATE INDEX aso_records_employee_id_idx ON aso_records(employee_id);

CREATE TABLE aso_exam_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  aso_record_id UUID NOT NULL REFERENCES aso_records(id) ON DELETE CASCADE,
  procedure_name TEXT NOT NULL,
  -- Código do procedimento na Tabela 27 do eSocial (4 dígitos), exigido em {procRealizado}.
  -- Quem informa é o médico/SST a partir da tabela oficial; o sistema nunca adivinha o código.
  procedure_code VARCHAR(4) CHECK (procedure_code ~ '^[0-9]{4}$'),
  -- {ordExame}: 1 inicial, 2 sequencial (obrigatório quando o código é 0281).
  order_exam SMALLINT CHECK (order_exam IN (1, 2)),
  -- {obsProc}: descrição de procedimento fora da tabela (usada com o código 9999). Máx. 999 caracteres.
  obs_proc TEXT CHECK (char_length(obs_proc) <= 999),
  exam_date DATE NOT NULL,
  -- Texto livre de cadastro; NUNCA enviado ao eSocial nem a IA (dado de saúde).
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE aso_exam_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE aso_exam_details FORCE ROW LEVEL SECURITY;
CREATE POLICY aso_exam_details_isolation ON aso_exam_details USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE INDEX aso_exam_details_aso_record_id_idx ON aso_exam_details(aso_record_id);
