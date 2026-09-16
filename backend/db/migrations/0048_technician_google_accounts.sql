-- Agendamento de Reunião/Visita (Google Calendar + Meet): primeira
-- credencial de terceiro armazenada neste banco. refresh_token_encrypted
-- nunca é devolvido em nenhuma resposta de API — só google_email e
-- connected_at (ver GoogleCalendarService.getStatus).
CREATE TABLE technician_google_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  google_email TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_technician_google_accounts_updated_at
  BEFORE UPDATE ON technician_google_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE technician_google_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_google_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY technician_google_accounts_isolation ON technician_google_accounts USING (
  current_setting('app.role', true) = 'admin'
  OR technician_user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
);
