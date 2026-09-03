-- Fase 15: Central da CIPA — Capacitação (Treinamentos, DDS, SIPAT).
-- Três subsistemas independentes por baixo, unidos só pela navegação
-- do frontend. Ver docs/specs/fase-15-cipa-capacitacao.md.

CREATE TABLE cipa_trainings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- RESTRICT, não SET NULL nem CASCADE — histórico de treinamento é
  -- registro de compliance NR, deve sobreviver mesmo se o funcionário
  -- for desligado/apagado depois. Apagar um funcionário com histórico
  -- de treinamento passa a exigir tratamento explícito no service
  -- (Task 2, mesmo padrão de EmployeesService.remove/EpiService.remove
  -- já usado pra cipa_election_candidates/employee_epi_deliveries).
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'nr-05', 'nr-06', 'nr-10', 'nr-11', 'nr-12', 'nr-18', 'nr-20',
    'nr-33', 'nr-35', 'outro'
  )),
  -- Preenchido só quando tipo = 'outro'; NULL nos demais casos.
  tipo_outro TEXT,
  data_realizacao DATE NOT NULL,
  -- Sugerida automaticamente a partir da tabela de validade padrão
  -- por tipo (constante no backend, Task 2), sempre editável antes de
  -- salvar. Guardada como valor final, não recalculada depois.
  data_validade DATE NOT NULL,
  carga_horaria INT,
  -- Link pro documents criado via DocumentsService.upload (categoria
  -- 'treinamento'), NULL quando não há certificado anexado. Mesmo
  -- padrão de cipa_meetings.ata_document_id (0026): SET NULL, não
  -- CASCADE — apagar o documents (rota genérica DELETE /documents/:id,
  -- já existente) não deveria arrastar o registro de treinamento
  -- junto, só desvincular o certificado.
  certificado_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_tipo_outro CHECK (
    (tipo = 'outro' AND tipo_outro IS NOT NULL)
    OR (tipo != 'outro' AND tipo_outro IS NULL)
  )
);
CREATE TRIGGER trg_cipa_trainings_updated_at BEFORE UPDATE ON cipa_trainings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX cipa_trainings_employee_idx ON cipa_trainings (employee_id);
CREATE INDEX cipa_trainings_validade_idx ON cipa_trainings (data_validade);

ALTER TABLE cipa_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_trainings FORCE ROW LEVEL SECURITY;
-- Tenant_id direto, mesmo padrão de cipa_elections_isolation.
CREATE POLICY cipa_trainings_isolation ON cipa_trainings USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_trainings.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_trainings.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

CREATE TABLE cipa_dds_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  tema TEXT NOT NULL,
  numero_participantes INT,
  responsavel TEXT,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cipa_dds_records_updated_at BEFORE UPDATE ON cipa_dds_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX cipa_dds_records_company_unit_idx ON cipa_dds_records (company_unit_id);

ALTER TABLE cipa_dds_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_dds_records FORCE ROW LEVEL SECURITY;
-- Mesma política de cipa_elections_isolation.
CREATE POLICY cipa_dds_records_isolation ON cipa_dds_records USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_dds_records.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_dds_records.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

CREATE TABLE cipa_sipat_editions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  ano INT NOT NULL,
  periodo_inicio DATE NOT NULL,
  periodo_fim DATE NOT NULL,
  tema TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cipa_sipat_editions_updated_at BEFORE UPDATE ON cipa_sipat_editions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Não faz sentido duas edições de SIPAT no mesmo ano pro mesmo
-- estabelecimento.
CREATE UNIQUE INDEX cipa_sipat_editions_unit_year
  ON cipa_sipat_editions (company_unit_id, ano);

ALTER TABLE cipa_sipat_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_sipat_editions FORCE ROW LEVEL SECURITY;
-- Mesma política de cipa_elections_isolation.
CREATE POLICY cipa_sipat_editions_isolation ON cipa_sipat_editions USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_sipat_editions.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_sipat_editions.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

CREATE TABLE cipa_sipat_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES cipa_sipat_editions(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  titulo TEXT NOT NULL,
  responsavel TEXT,
  publico_alvo TEXT,
  status TEXT NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada', 'realizada', 'cancelada')),
  numero_participantes INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cipa_sipat_activities_updated_at BEFORE UPDATE ON cipa_sipat_activities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX cipa_sipat_activities_edition_idx ON cipa_sipat_activities (edition_id);

ALTER TABLE cipa_sipat_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_sipat_activities FORCE ROW LEVEL SECURITY;
-- Mesmo padrão de cipa_election_candidates_isolation — sem tenant_id
-- próprio, isolamento via EXISTS contra cipa_sipat_editions (que já
-- tem sua própria RLS, então a composição escopa corretamente).
CREATE POLICY cipa_sipat_activities_isolation ON cipa_sipat_activities USING (
  EXISTS (SELECT 1 FROM cipa_sipat_editions e WHERE e.id = cipa_sipat_activities.edition_id)
);
