-- Fase 14: eleição de representantes da CIPA. Duas tabelas: a eleição em
-- si (uma "aberta" por estabelecimento por vez) e os candidatos dela.
CREATE TABLE cipa_elections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  ano INT NOT NULL,
  data_eleicao DATE,
  -- cipa_members.inicio_mandato/fim_mandato são NOT NULL (Fase 12a) — a
  -- eleição captura o período do mandato aqui pra poder alimentar os
  -- membros ao concluir (ElectionsService.conclude). Mesmo padrão já
  -- usado em cipa_committees.
  inicio_mandato DATE NOT NULL,
  fim_mandato DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'concluida')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cipa_elections_updated_at BEFORE UPDATE ON cipa_elections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Rede de segurança de banco pro invariante "uma eleição aberta por
-- estabelecimento" — a checagem de aplicação (FOR UPDATE em
-- company_units antes de checar isso) é o caminho principal de erro
-- claro (409), este índice é o backstop contra corrida de verdade,
-- mesmo raciocínio do índice único parcial de
-- 0025_cipa_meetings_unique_ordinaria.sql.
CREATE UNIQUE INDEX cipa_elections_one_open_per_unit
  ON cipa_elections (company_unit_id) WHERE status = 'aberta';

ALTER TABLE cipa_elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_elections FORCE ROW LEVEL SECURITY;
-- Mesma política de cipa_meetings_isolation (0023_cipa_nucleo.sql) —
-- esta tabela tem tenant_id direto, igual cipa_meetings.
CREATE POLICY cipa_elections_isolation ON cipa_elections USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_elections.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_elections.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

CREATE TABLE cipa_election_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id UUID NOT NULL REFERENCES cipa_elections(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  nome_livre TEXT,
  votos INT,
  eleito BOOLEAN NOT NULL DEFAULT false,
  titular_suplente TEXT CHECK (titular_suplente IN ('titular', 'suplente')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Backstop de banco — a checagem real acontece no controller
  -- (ElectionsController.addCandidate), mesmo padrão de
  -- cipa_meeting_participants (0023_cipa_nucleo.sql).
  CONSTRAINT chk_candidate_source CHECK (
    (employee_id IS NOT NULL AND nome_livre IS NULL)
    OR (employee_id IS NULL AND nome_livre IS NOT NULL)
  )
);
CREATE TRIGGER trg_cipa_election_candidates_updated_at BEFORE UPDATE ON cipa_election_candidates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX cipa_election_candidates_election_idx ON cipa_election_candidates (election_id);

ALTER TABLE cipa_election_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_election_candidates FORCE ROW LEVEL SECURITY;
-- Mesmo padrão de cipa_meeting_participants — esta tabela não tem
-- tenant_id próprio, isolamento via EXISTS contra cipa_elections.
CREATE POLICY cipa_election_candidates_isolation ON cipa_election_candidates USING (
  EXISTS (SELECT 1 FROM cipa_elections e WHERE e.id = cipa_election_candidates.election_id)
);
