-- Sócia cadastra empresa (senha temporária) e atua como empresa.
-- Rollback (aditivo; seguro):
--   DROP FUNCTION socio_can_act_on_tenant(uuid,uuid), socio_create_company(uuid,text,text,text,text,text),
--     auth_change_password(uuid,text,text), auth_own_password_hash(uuid), auth_user_must_change_password(uuid);
--   ALTER TABLE users DROP COLUMN must_change_password;
--   DELETE FROM socio_permissions WHERE permission IN ('empresas.criar','empresas.atuar');
--   (restaurar o CHECK da 0104, sem as duas permissões novas)
--   REVOKE SELECT ON socio_permissions FROM montese_auth_bypass;   (concedido por esta migration; não existia antes)
--   REVOKE INSERT ON tenant_owners FROM montese_auth_bypass;       (idem)
--   Restaurar auth_reset_password da 0058 (ANTES de remover a coluna; o corpo novo a referencia):
--     CREATE OR REPLACE FUNCTION auth_reset_password(p_user_id UUID, p_old_password_hash TEXT, p_new_password_hash TEXT)
--     RETURNS TABLE(user_id UUID, tenant_id UUID, role user_role)
--     LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
--     BEGIN
--       RETURN QUERY UPDATE users u SET password_hash = p_new_password_hash
--        WHERE u.id = p_user_id AND u.password_hash = p_old_password_hash AND u.status = 'ativo'
--       RETURNING u.id, u.tenant_id, u.role;
--     END; $$;
--     (CREATE OR REPLACE mantém dono montese_auth_bypass e o GRANT a montese_app)
--   DELETE FROM _migrations WHERE name = '0108_socio_cadastra_atua_empresa.sql';
SET LOCAL lock_timeout = '5s';

ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE socio_permissions DROP CONSTRAINT IF EXISTS socio_permissions_permission_check;
ALTER TABLE socio_permissions ADD CONSTRAINT socio_permissions_permission_check CHECK (permission IN (
  'clients.read','clients.update_operational','tasks.read','tasks.write','appointments.manage',
  'documents.create_draft','documents.review','documents.sign','documents.read','documents.approve',
  'documents.publish','documents.cancel','documents.view_registration','finance.read',
  'empresas.read','empresas.documentos','pgr.read','pgr.write',
  'checklists.read','checklists.write','checklists.approve',
  'alertas.read','alertas.manage',
  'empresas.criar','empresas.atuar'));

-- Privilégios mínimos para o dono (montese_auth_bypass) das funções abaixo (padrão 0003/0004/0058).
GRANT SELECT ON socio_permissions TO montese_auth_bypass;
GRANT INSERT ON tenant_owners TO montese_auth_bypass;

-- Usada no login (sem contexto de tenant): só devolve a flag do usuário já autenticado por senha.
CREATE FUNCTION auth_user_must_change_password(p_user_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT must_change_password FROM users WHERE id = p_user_id), false);
$$;
ALTER FUNCTION auth_user_must_change_password(uuid) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_user_must_change_password(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_user_must_change_password(uuid) TO montese_app;

-- O usuário só lê o PRÓPRIO hash (para conferir a senha atual na troca). Outro id => NULL.
CREATE FUNCTION auth_own_password_hash(p_user_id UUID) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.password_hash FROM users u
   WHERE u.id = p_user_id
     AND p_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;
ALTER FUNCTION auth_own_password_hash(uuid) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_own_password_hash(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_own_password_hash(uuid) TO montese_app;

-- Troca de senha autenticada: compare-and-swap no hash antigo (mesma técnica da 0058) e limpa a flag.
CREATE FUNCTION auth_change_password(p_user_id UUID, p_old_password_hash TEXT, p_new_password_hash TEXT)
RETURNS TABLE(user_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid THEN
    RETURN;
  END IF;
  RETURN QUERY
  UPDATE users u
     SET password_hash = p_new_password_hash, must_change_password = false
   WHERE u.id = p_user_id AND u.password_hash = p_old_password_hash AND u.status = 'ativo'
  RETURNING u.id;
END;
$$;
ALTER FUNCTION auth_change_password(uuid, text, text) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_change_password(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_change_password(uuid, text, text) TO montese_app;

-- Cadastro por sócio: tenant ATIVO (plano trial, como o autocadastro) + usuário 'empresa' ATIVO com troca de
-- senha obrigatória + carteira da sócia. Todas as checagens ficam no banco (defesa em profundidade).
CREATE FUNCTION socio_create_company(
  p_socio_id UUID, p_company_name TEXT, p_cnpj TEXT, p_email TEXT, p_password_hash TEXT, p_full_name TEXT
) RETURNS TABLE(tenant_id UUID, user_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
BEGIN
  IF current_setting('app.role', true) IS DISTINCT FROM 'socio'
     OR p_socio_id IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid
     OR NOT EXISTS (SELECT 1 FROM users s WHERE s.id = p_socio_id AND s.role = 'socio' AND s.status = 'ativo')
     OR NOT EXISTS (SELECT 1 FROM socio_permissions sp WHERE sp.user_id = p_socio_id AND sp.permission = 'empresas.criar')
  THEN
    RAISE EXCEPTION 'sem permissão para cadastrar empresa' USING ERRCODE = '42501';
  END IF;

  INSERT INTO tenants (name, cnpj, plan, status) VALUES (p_company_name, p_cnpj, 'trial', 'ativo')
  RETURNING id INTO v_tenant_id;

  INSERT INTO users (tenant_id, role, email, password_hash, full_name, status, must_change_password)
  VALUES (v_tenant_id, 'empresa', p_email, p_password_hash, p_full_name, 'ativo', true)
  RETURNING id INTO v_user_id;

  INSERT INTO tenant_owners (tenant_id, user_id, assigned_by) VALUES (v_tenant_id, p_socio_id, p_socio_id);

  RETURN QUERY SELECT v_tenant_id, v_user_id;
END;
$$;
ALTER FUNCTION socio_create_company(uuid, text, text, text, text, text) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION socio_create_company(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION socio_create_company(uuid, text, text, text, text, text) TO montese_app;

-- Única fonte da regra "a sócia pode atuar nesta empresa?". Reavaliada a CADA requisição pelo guard.
-- NÃO usa is_montese_tenant(): desde a 0101 ela inclui empresas marcadas em socio_portfolio MESMO com técnico/parceiro
-- vinculado (serve só à visibilidade do painel). Atuar como empresa exige empresa "da casa" de verdade: sem vínculo
-- técnico nem parceiro, independentemente do portfólio. Retorna sempre boolean não nulo (COALESCE).
CREATE FUNCTION socio_can_act_on_tenant(p_socio_id UUID, p_tenant_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
         current_setting('app.role', true) = 'socio'
     AND p_socio_id = NULLIF(current_setting('app.user_id', true), '')::uuid
     AND EXISTS (SELECT 1 FROM users s WHERE s.id = p_socio_id AND s.role = 'socio' AND s.status = 'ativo')
     AND EXISTS (SELECT 1 FROM socio_permissions sp WHERE sp.user_id = p_socio_id AND sp.permission = 'empresas.atuar')
     AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = p_tenant_id AND t.status = 'ativo')
     AND NOT EXISTS (SELECT 1 FROM tenant_technicians tt WHERE tt.tenant_id = p_tenant_id)
     AND NOT EXISTS (SELECT 1 FROM tenant_partners tp WHERE tp.tenant_id = p_tenant_id)
  ), false);
$$;
ALTER FUNCTION socio_can_act_on_tenant(uuid, uuid) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION socio_can_act_on_tenant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION socio_can_act_on_tenant(uuid, uuid) TO montese_app;

-- Ruling 21: o reset de senha por e-mail (0058) prova a posse do endereço; passa também a limpar a troca
-- obrigatória (senha temporária definida pela sócia). Mesma assinatura, retorno e propriedades da 0058
-- (SECURITY DEFINER, search_path fixo). CREATE OR REPLACE NÃO altera dono (montese_auth_bypass) nem ACL
-- (REVOKE PUBLIC / GRANT montese_app), mas os reafirmamos por clareza e idempotência.
CREATE OR REPLACE FUNCTION auth_reset_password(p_user_id UUID, p_old_password_hash TEXT, p_new_password_hash TEXT)
RETURNS TABLE(user_id UUID, tenant_id UUID, role user_role)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  UPDATE users u
     SET password_hash = p_new_password_hash,
         must_change_password = false
   WHERE u.id = p_user_id
     AND u.password_hash = p_old_password_hash
     AND u.status = 'ativo'
  RETURNING u.id, u.tenant_id, u.role;
END;
$$;
ALTER FUNCTION auth_reset_password(uuid, text, text) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_reset_password(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_reset_password(uuid, text, text) TO montese_app;
