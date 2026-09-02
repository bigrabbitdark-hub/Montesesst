-- Fase 13: ata por IA (upload de áudio → transcrição → rascunho). Tabela
-- satélite de cipa_meetings, mesmo padrão de cipa_meeting_participants —
-- um rascunho de IA ativo por reunião (meeting_id UNIQUE), substituído
-- inteiro a cada novo upload de áudio (ON CONFLICT DO UPDATE em vez de
-- múltiplas linhas por reunião).
CREATE TABLE cipa_meeting_ata_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL UNIQUE REFERENCES cipa_meetings(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_unit_id UUID NOT NULL REFERENCES company_units(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('processando', 'concluido', 'falhou')),
  transcript TEXT,
  draft_pauta TEXT,
  draft_discussoes TEXT,
  draft_deliberacoes TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mesma política de cipa_meetings_isolation (0023_cipa_nucleo.sql) — esta
-- tabela tem tenant_id direto, igual cipa_meetings, então usa o mesmo
-- formato (diferente de cipa_meeting_participants, que não tem tenant_id
-- próprio e usa EXISTS contra cipa_meetings).
ALTER TABLE cipa_meeting_ata_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cipa_meeting_ata_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY cipa_meeting_ata_drafts_isolation ON cipa_meeting_ata_drafts USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = cipa_meeting_ata_drafts.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = cipa_meeting_ata_drafts.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);
