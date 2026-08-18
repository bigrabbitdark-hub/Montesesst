-- auth_confirm_email: ativa tenant+user depois da confirmação por e-mail.
-- Mesmo motivo de SECURITY DEFINER que auth_register_tenant_and_user
-- (0003_register_function.sql) — UPDATE em users também é bloqueado pela
-- RLS sem contexto de tenant/role. Idempotente por natureza: rodar duas
-- vezes com o mesmo p_user_id não quebra nada (RETURNING sempre traz a
-- linha, esteja ela indo de 'pendente' pra 'ativo' ou já 'ativo').
CREATE FUNCTION auth_confirm_email(p_user_id UUID)
RETURNS TABLE(user_id UUID, tenant_id UUID) AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  UPDATE users SET status = 'ativo'
  WHERE id = p_user_id AND role = 'empresa'
  RETURNING users.tenant_id INTO v_tenant_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE tenants SET status = 'ativo' WHERE id = v_tenant_id;

  RETURN QUERY SELECT p_user_id, v_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION auth_confirm_email(UUID) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_confirm_email(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_confirm_email(UUID) TO montese_app;

-- Mesmo motivo do GRANT INSERT em 0003_register_function.sql — BYPASSRLS
-- não substitui GRANT de tabela, e esta função faz UPDATE.
GRANT UPDATE ON tenants, users TO montese_auth_bypass;
