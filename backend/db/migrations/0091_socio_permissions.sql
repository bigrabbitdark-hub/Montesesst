-- Painel de Atuação (Fase 1). O valor `socio` do enum foi criado na 0090.
--
-- A semântica original (0001) de tecnico/parceiro/admin é preservada (qualquer
-- tenant_id), para o ADD CONSTRAINT nunca falhar com dados existentes. Só o
-- `socio` é restrito: exige tenant_id NULL.

ALTER TABLE users DROP CONSTRAINT chk_tenant_role;
ALTER TABLE users ADD CONSTRAINT chk_tenant_role CHECK (
  (role = 'empresa' AND tenant_id IS NOT NULL)
  OR role IN ('tecnico','parceiro','admin')
  OR (role = 'socio' AND tenant_id IS NULL)
);

CREATE TABLE socio_permissions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN (
    'clients.read','clients.update_operational','tasks.read','tasks.write',
    'appointments.manage','documents.create_draft','documents.review',
    'documents.sign','finance.read'
  )),
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);

-- Privilégios de tabela para montese_app vêm de ALTER DEFAULT PRIVILEGES
-- (postgres/init/01-app-role.sh); nenhuma migration de tabela faz GRANT
-- explícito, então não há GRANT aqui.
ALTER TABLE socio_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE socio_permissions FORCE ROW LEVEL SECURITY;

-- O próprio sócio lê só as suas permissões; só admin concede/revoga.
CREATE POLICY socio_permissions_select ON socio_permissions FOR SELECT USING (
  current_setting('app.role', true) = 'admin'
  OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
);
CREATE POLICY socio_permissions_admin_write ON socio_permissions
  FOR ALL USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');

-- Cliente Montese = tenant SEM nenhuma linha (qualquer status) em
-- tenant_technicians/tenant_partners. Usada nas policies SELECT do `socio`
-- (Fase 2). SECURITY DEFINER para enxergar os vínculos independentemente do RLS.
CREATE FUNCTION is_montese_tenant(p_tenant_id UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (SELECT 1 FROM tenant_technicians WHERE tenant_id = p_tenant_id)
     AND NOT EXISTS (SELECT 1 FROM tenant_partners WHERE tenant_id = p_tenant_id);
$$;
-- Dono montese_auth_bypass (BYPASSRLS, com SELECT em tenant_technicians/
-- tenant_partners desde a 0001), como nas demais SECURITY DEFINER (0001, 0047,
-- 0056). As migrations rodam como montese_app (sem BYPASSRLS): sem trocar o
-- dono, a função leria os vínculos sob FORCE RLS, enxergaria zero linhas e todo
-- tenant viraria "Montese" (vazamento entre carteiras).
ALTER FUNCTION is_montese_tenant(UUID) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION is_montese_tenant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_montese_tenant(UUID) TO montese_app;
