-- Painel de Atuação — Atuação por empresa (Z). Leitura da área da empresa pelo socio (carteira Montese) e
-- ajuste de vigência de documentos. Policies PERMISSIVAS e específicas do papel; nenhuma INSERT/DELETE.
-- Rollback:
--   DROP TRIGGER trg_b_guard_documents_socio_update ON documents; DROP FUNCTION guard_documents_socio_update();
--   DROP POLICY documents_socio_update ON documents;
--   DROP POLICY employees_socio_select ON employees; DROP POLICY positions_socio_select ON positions;
--   DROP POLICY tenant_epis_socio_select ON tenant_epis;
--   DELETE FROM socio_permissions WHERE permission LIKE 'empresas.%';
--   (restaurar o CHECK de permissões da 0096)

ALTER TABLE socio_permissions DROP CONSTRAINT IF EXISTS socio_permissions_permission_check;
ALTER TABLE socio_permissions ADD CONSTRAINT socio_permissions_permission_check CHECK (permission IN (
  'clients.read','clients.update_operational','tasks.read','tasks.write','appointments.manage',
  'documents.create_draft','documents.review','documents.sign','documents.read','documents.approve',
  'documents.publish','documents.cancel','documents.view_registration','finance.read',
  'empresas.read','empresas.documentos'));

CREATE POLICY employees_socio_select ON employees FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY positions_socio_select ON positions FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY tenant_epis_socio_select ON tenant_epis FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

CREATE POLICY documents_socio_update ON documents FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

-- RLS não restringe colunas: o socio só pode mudar a vigência.
CREATE OR REPLACE FUNCTION guard_documents_socio_update() RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.role', true) = 'socio'
     AND (to_jsonb(NEW) - ARRAY['valid_from','expires_at','expires_source','validity_months_applied','updated_at'])
         IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['valid_from','expires_at','expires_source','validity_months_applied','updated_at']) THEN
    RAISE EXCEPTION 'socio só pode alterar a vigência do documento' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_b_guard_documents_socio_update BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION guard_documents_socio_update();
