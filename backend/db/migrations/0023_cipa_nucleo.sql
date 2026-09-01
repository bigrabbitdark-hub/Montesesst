-- Fase 12a — núcleo da Central da CIPA. tenant_id em toda tabela (padrão
-- de RLS já usado no projeto inteiro) + company_unit_id (uma CIPA por
-- estabelecimento — exigência legal real, não é escolha de design
-- arbitrária). Ordem de criação importa por causa de FK: committees →
-- meetings → members → meeting_participants (depende dos dois
-- anteriores) → pendencias.

CREATE TABLE cipa_committees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  ano INTEGER NOT NULL,
  data_inicio DATE NOT NULL,
  data_termino DATE NOT NULL,
  responsavel_user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'encerrada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cipa_committees_company_unit_idx ON cipa_committees (company_unit_id);
CREATE TRIGGER trg_cipa_committees_updated_at BEFORE UPDATE ON cipa_committees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cipa_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  committee_id UUID NOT NULL REFERENCES cipa_committees(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('ordinaria', 'extraordinaria')),
  numero INTEGER,
  titulo TEXT,
  data DATE,
  hora TIME,
  local TEXT,
  modalidade TEXT CHECK (modalidade IN ('presencial', 'online', 'hibrida')),
  motivo TEXT,
  responsavel_user_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'planejada'
    CHECK (status IN ('planejada', 'agendada', 'realizada', 'cancelada', 'reagendada')),
  chk_pauta_definida BOOLEAN NOT NULL DEFAULT false,
  chk_participantes_convocados BOOLEAN NOT NULL DEFAULT false,
  chk_local_confirmado BOOLEAN NOT NULL DEFAULT false,
  chk_presenca_registrada BOOLEAN NOT NULL DEFAULT false,
  chk_assuntos_discutidos BOOLEAN NOT NULL DEFAULT false,
  chk_decisoes_registradas BOOLEAN NOT NULL DEFAULT false,
  chk_ata_criada BOOLEAN NOT NULL DEFAULT false,
  chk_acoes_distribuidas BOOLEAN NOT NULL DEFAULT false,
  chk_pendencias_registradas BOOLEAN NOT NULL DEFAULT false,
  pauta TEXT,
  discussoes TEXT,
  deliberacoes TEXT,
  proxima_reuniao_data DATE,
  status_ata TEXT NOT NULL DEFAULT 'rascunho' CHECK (status_ata IN ('rascunho', 'aprovada')),
  aprovado_por_user_id UUID REFERENCES users(id),
  aprovado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ordinaria_numero CHECK (
    (tipo = 'ordinaria' AND numero IS NOT NULL AND titulo IS NULL)
    OR (tipo = 'extraordinaria' AND numero IS NULL AND titulo IS NOT NULL)
  )
);
CREATE INDEX cipa_meetings_committee_idx ON cipa_meetings (committee_id);
CREATE TRIGGER trg_cipa_meetings_updated_at BEFORE UPDATE ON cipa_meetings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cipa_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  funcao_empresa TEXT,
  setor TEXT,
  funcao_cipa TEXT NOT NULL CHECK (funcao_cipa IN ('presidente', 'vice_presidente', 'secretario', 'membro')),
  titular_suplente TEXT NOT NULL CHECK (titular_suplente IN ('titular', 'suplente')),
  representacao TEXT NOT NULL CHECK (representacao IN ('empregador', 'empregados')),
  inicio_mandato DATE NOT NULL,
  fim_mandato DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cipa_members_company_unit_idx ON cipa_members (company_unit_id);
CREATE TRIGGER trg_cipa_members_updated_at BEFORE UPDATE ON cipa_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cipa_meeting_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES cipa_meetings(id) ON DELETE CASCADE,
  cipa_member_id UUID REFERENCES cipa_members(id) ON DELETE SET NULL,
  nome_livre TEXT,
  presente BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT chk_participant_source CHECK (
    (cipa_member_id IS NOT NULL AND nome_livre IS NULL)
    OR (cipa_member_id IS NULL AND nome_livre IS NOT NULL)
  )
);
CREATE INDEX cipa_meeting_participants_meeting_idx ON cipa_meeting_participants (meeting_id);

CREATE TABLE cipa_pendencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  meeting_id UUID REFERENCES cipa_meetings(id) ON DELETE SET NULL,
  descricao TEXT NOT NULL,
  responsavel_user_id UUID REFERENCES users(id),
  prazo DATE,
  prioridade TEXT NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta', 'media', 'baixa')),
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'andamento', 'concluida', 'atrasada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cipa_pendencias_company_unit_idx ON cipa_pendencias (company_unit_id);
CREATE TRIGGER trg_cipa_pendencias_updated_at BEFORE UPDATE ON cipa_pendencias
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS — cópia exata do padrão de 0011_partner_access.sql em cada tabela
-- com tenant_id própria. cipa_meeting_participants não tem tenant_id
-- (igual inspection_checklist_items) — delega via EXISTS contra
-- cipa_meetings.

ALTER TABLE cipa_committees ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_committees FORCE ROW LEVEL SECURITY;
CREATE POLICY cipa_committees_isolation ON cipa_committees USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_committees.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_committees.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

ALTER TABLE cipa_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_meetings FORCE ROW LEVEL SECURITY;
CREATE POLICY cipa_meetings_isolation ON cipa_meetings USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_meetings.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_meetings.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

ALTER TABLE cipa_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_members FORCE ROW LEVEL SECURITY;
CREATE POLICY cipa_members_isolation ON cipa_members USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_members.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_members.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

ALTER TABLE cipa_pendencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_pendencias FORCE ROW LEVEL SECURITY;
CREATE POLICY cipa_pendencias_isolation ON cipa_pendencias USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_pendencias.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_pendencias.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

ALTER TABLE cipa_meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_meeting_participants FORCE ROW LEVEL SECURITY;
CREATE POLICY cipa_meeting_participants_isolation ON cipa_meeting_participants USING (
  EXISTS (SELECT 1 FROM cipa_meetings m WHERE m.id = cipa_meeting_participants.meeting_id)
);

-- Extensão do CHECK de category em documents — Documentos da CIPA
-- reaproveitam esta tabela, sem módulo de biblioteca novo.
ALTER TABLE documents DROP CONSTRAINT documents_category_check;
ALTER TABLE documents ADD CONSTRAINT documents_category_check CHECK (
  category IN ('pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento',
               'cipa_ata', 'cipa_comunicado', 'cipa_documento_eleitoral', 'cipa_anexo')
);
