-- Painel de Atuação (Fase 3A): tarefas internas, histórico e responsáveis por cliente.
-- Tudo limitado à carteira Montese via is_montese_tenant() (0091). empresa/tecnico/
-- parceiro NÃO têm policy: sem acesso. Rollback (descartável): DROP TABLE task_events,
-- tasks, tenant_owners; DROP FUNCTION list_socios().

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  assignee_user_id UUID NOT NULL REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'media' CHECK (priority IN ('baixa','media','alta','urgente')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','blocked','awaiting_review','completed','cancelled')),
  due_date DATE,
  category TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_tenant_idx ON tasks (tenant_id);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_user_id, status);
CREATE INDEX tasks_due_idx ON tasks (due_date) WHERE status NOT IN ('completed','cancelled');
CREATE TRIGGER trg_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('created','updated','assigned','status_changed')),
  from_value TEXT,
  to_value TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX task_events_task_idx ON task_events (task_id, created_at);

CREATE TABLE tenant_owners (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX tenant_owners_user_idx ON tenant_owners (user_id);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;        ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE task_events ENABLE ROW LEVEL SECURITY;  ALTER TABLE task_events FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_owners ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant_owners FORCE ROW LEVEL SECURITY;

-- tasks
CREATE POLICY tasks_admin ON tasks FOR ALL
  USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY tasks_socio_select ON tasks FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY tasks_socio_insert ON tasks FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY tasks_socio_update ON tasks FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
-- (sem policy de DELETE para socio: cancelar em vez de apagar)

-- task_events: append-only (SELECT + INSERT apenas; nenhum UPDATE/DELETE para ninguém)
CREATE POLICY task_events_admin_select ON task_events FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY task_events_socio_select ON task_events FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY task_events_socio_insert ON task_events FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- tenant_owners: admin atribui; socio só lê (carteira Montese)
CREATE POLICY tenant_owners_admin ON tenant_owners FOR ALL
  USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY tenant_owners_socio_select ON tenant_owners FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

-- Equipe: id e nome dos sócios ativos, só para socio/admin. SECURITY DEFINER porque o
-- socio não lê `users` (RLS). Dono com BYPASSRLS + SELECT em users (0001:106).
CREATE FUNCTION list_socios() RETURNS TABLE (id uuid, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.full_name FROM users u
  WHERE u.role = 'socio' AND u.status = 'ativo'
    AND current_setting('app.role', true) IN ('socio', 'admin')
  ORDER BY u.full_name;
$$;
ALTER FUNCTION list_socios() OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION list_socios() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_socios() TO montese_app;
