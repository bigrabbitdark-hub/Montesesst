-- Painel de Atuação (Fase 3B): agenda interna e histórico de reuniões/contatos.
-- Limitado à carteira Montese via is_montese_tenant() (0091). empresa/tecnico/parceiro
-- sem policy = sem acesso. Rollback (descartável): DROP TABLE client_interactions, agenda_events;

CREATE TABLE agenda_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id),
  created_by UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('reuniao','visita','ligacao','outro')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  event_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  location TEXT,
  meeting_link TEXT CHECK (meeting_link IS NULL OR meeting_link ~ '^https://'),
  company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','concluido','cancelado')),
  outcome_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time)
);
CREATE INDEX agenda_events_owner_date_idx ON agenda_events (owner_user_id, event_date);
CREATE INDEX agenda_events_tenant_idx ON agenda_events (tenant_id, event_date);
CREATE TRIGGER trg_agenda_events_updated_at BEFORE UPDATE ON agenda_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE client_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('reuniao','ligacao','email','visita','outro')),
  occurred_on DATE NOT NULL,
  participants TEXT,
  summary TEXT NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 4000),
  decisions TEXT,
  next_steps TEXT,
  agenda_event_id UUID REFERENCES agenda_events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX client_interactions_tenant_idx ON client_interactions (tenant_id, occurred_on DESC);
CREATE TRIGGER trg_client_interactions_updated_at BEFORE UPDATE ON client_interactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE agenda_events ENABLE ROW LEVEL SECURITY;       ALTER TABLE agenda_events FORCE ROW LEVEL SECURITY;
ALTER TABLE client_interactions ENABLE ROW LEVEL SECURITY; ALTER TABLE client_interactions FORCE ROW LEVEL SECURITY;

-- agenda_events: socio lê e escreve na carteira Montese (agenda compartilhada); admin só lê.
CREATE POLICY agenda_admin_select ON agenda_events FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY agenda_socio_select ON agenda_events FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY agenda_socio_insert ON agenda_events FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY agenda_socio_update ON agenda_events FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

-- client_interactions: socio lê e cria; edita só o que ele mesmo criou; admin só lê.
CREATE POLICY interactions_admin_select ON client_interactions FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY interactions_socio_select ON client_interactions FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY interactions_socio_insert ON client_interactions FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY interactions_socio_update ON client_interactions FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
         AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- Defesa em profundidade (RLS não limita colunas): triggers de linha, valem para todos os papéis.
-- Plpgsql comum (NÃO SECURITY DEFINER). Prefixo trg_a_guard_ => dispara ANTES de trg_*_updated_at.
-- Rollback (descartável): DROP TRIGGER trg_a_guard_agenda_events ON agenda_events;
--   DROP TRIGGER trg_a_guard_client_interactions ON client_interactions;
--   DROP FUNCTION guard_agenda_events_update(); DROP FUNCTION guard_client_interactions_update();
CREATE OR REPLACE FUNCTION guard_agenda_events_update() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'agenda_events: tenant_id e created_by são imutáveis';
  END IF;
  -- Evento encerrado (concluído/cancelado) é imutável, inclusive reabrir. Colunas de negócio
  -- comparadas explicitamente (updated_at sozinho não conta). company_unit_id -> NULL é
  -- permitido porque é a ação ON DELETE SET NULL da FK ao apagar a unidade.
  IF OLD.status <> 'agendado' AND (
       NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.type IS DISTINCT FROM OLD.type
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.event_date IS DISTINCT FROM OLD.event_date
    OR NEW.start_time IS DISTINCT FROM OLD.start_time
    OR NEW.end_time IS DISTINCT FROM OLD.end_time
    OR NEW.location IS DISTINCT FROM OLD.location
    OR NEW.meeting_link IS DISTINCT FROM OLD.meeting_link
    OR (NEW.company_unit_id IS DISTINCT FROM OLD.company_unit_id AND NEW.company_unit_id IS NOT NULL)
    OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.outcome_note IS DISTINCT FROM OLD.outcome_note
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'agenda_events: evento encerrado não pode ser alterado';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_a_guard_agenda_events BEFORE UPDATE ON agenda_events
  FOR EACH ROW EXECUTE FUNCTION guard_agenda_events_update();

CREATE OR REPLACE FUNCTION guard_client_interactions_update() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'client_interactions: tenant_id e created_by são imutáveis';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_a_guard_client_interactions BEFORE UPDATE ON client_interactions
  FOR EACH ROW EXECUTE FUNCTION guard_client_interactions_update();
