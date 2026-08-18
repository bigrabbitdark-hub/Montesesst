-- auth_register_tenant_and_user: cria tenant + user 'empresa' pendentes numa
-- única operação atômica (statement único = transação implícita), sem exigir
-- contexto de tenant/role — é o que está sendo criado. Mesma técnica de
-- auth_find_user_by_email (0001_init.sql): SECURITY DEFINER + dono
-- montese_auth_bypass (NOLOGIN BYPASSRLS, criado em postgres/init/01-app-role.sh).
-- CNPJ/e-mail duplicado propaga a violação de UNIQUE normalmente (SQLSTATE
-- 23505) — RegistrationService.register trata isso com mapPgError, igual ao
-- resto do backend.
CREATE FUNCTION auth_register_tenant_and_user(
  p_company_name TEXT,
  p_cnpj TEXT,
  p_email TEXT,
  p_password_hash TEXT,
  p_full_name TEXT
) RETURNS TABLE(tenant_id UUID, user_id UUID) AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
BEGIN
  INSERT INTO tenants (name, cnpj, plan, status)
  VALUES (p_company_name, p_cnpj, 'trial', 'pendente')
  RETURNING id INTO v_tenant_id;

  INSERT INTO users (tenant_id, role, email, password_hash, full_name, status)
  VALUES (v_tenant_id, 'empresa', p_email, p_password_hash, p_full_name, 'pendente')
  RETURNING id INTO v_user_id;

  RETURN QUERY SELECT v_tenant_id, v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION auth_register_tenant_and_user(TEXT, TEXT, TEXT, TEXT, TEXT) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_register_tenant_and_user(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_register_tenant_and_user(TEXT, TEXT, TEXT, TEXT, TEXT) TO montese_app;

-- BYPASSRLS só ignora as policies de RLS — a role ainda precisa do GRANT
-- normal de tabela pra poder fazer INSERT (mesma observação já registrada
-- em 0001_init.sql pro SELECT de auth_find_user_by_email). Sem isso, a
-- função falha com "permission denied for table tenants" mesmo sendo
-- SECURITY DEFINER com dono BYPASSRLS. SELECT em tenants também é
-- necessário aqui — RETURNING exige SELECT nas colunas retornadas, mesmo
-- dentro de um INSERT (users já tinha SELECT concedido em 0001_init.sql,
-- mas tenants nunca precisou até agora).
GRANT INSERT, SELECT ON tenants TO montese_auth_bypass;
GRANT INSERT ON users TO montese_auth_bypass;
