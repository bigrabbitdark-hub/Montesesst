-- auth_register_technician: cria users (role 'tecnico') + technicians
-- pendentes numa única operação atômica, sem exigir contexto de
-- tenant/role — mesmo motivo de auth_register_tenant_and_user
-- (0003_register_function.sql). status 'pendente' é diferente do default
-- atual da tabela technicians ('ativo'), porque esse default assume
-- criação confiada por admin (POST /technicians, @Roles('admin')) —
-- autocadastro não tem essa confiança ainda.
CREATE FUNCTION auth_register_technician(
  p_email TEXT,
  p_password_hash TEXT,
  p_full_name TEXT,
  p_phone TEXT,
  p_registration_number TEXT,
  p_specialization TEXT
) RETURNS TABLE(user_id UUID, technician_id UUID) AS $$
DECLARE
  v_user_id UUID;
  v_technician_id UUID;
BEGIN
  INSERT INTO users (tenant_id, role, email, password_hash, full_name, phone, status)
  VALUES (NULL, 'tecnico', p_email, p_password_hash, p_full_name, p_phone, 'pendente')
  RETURNING id INTO v_user_id;

  INSERT INTO technicians (user_id, registration_number, specialization, status)
  VALUES (v_user_id, p_registration_number, p_specialization, 'pendente')
  RETURNING id INTO v_technician_id;

  RETURN QUERY SELECT v_user_id, v_technician_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION auth_register_technician(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_register_technician(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_register_technician(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO montese_app;

-- montese_auth_bypass já tinha SELECT em technicians (0001_init.sql) —
-- falta INSERT (usado aqui) e UPDATE (usado pela versão generalizada de
-- auth_confirm_email, abaixo). SELECT também é necessário pra RETURNING.
GRANT INSERT, UPDATE, SELECT ON technicians TO montese_auth_bypass;
GRANT INSERT, SELECT ON users TO montese_auth_bypass;

-- auth_confirm_email generalizada: a versão da Fase 2 (0004) só ativava
-- 'empresa' (WHERE role = 'empresa' explícito) e devolvia
-- TABLE(user_id, tenant_id). Aqui ela descobre o role de qualquer usuário
-- e ativa o recurso certo — tenants pra 'empresa', technicians pra
-- 'tecnico'. DROP + CREATE (não CREATE OR REPLACE) porque o tipo de
-- retorno mudou (ganhou a coluna role) — Postgres não permite REPLACE
-- mudar o tipo de retorno de uma função existente.
DROP FUNCTION IF EXISTS auth_confirm_email(UUID);

CREATE FUNCTION auth_confirm_email(p_user_id UUID)
RETURNS TABLE(user_id UUID, tenant_id UUID, role user_role) AS $$
DECLARE
  v_tenant_id UUID;
  v_role user_role;
BEGIN
  UPDATE users SET status = 'ativo'
  WHERE id = p_user_id
  RETURNING users.tenant_id, users.role INTO v_tenant_id, v_role;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_role = 'empresa' THEN
    UPDATE tenants SET status = 'ativo' WHERE id = v_tenant_id;
  ELSIF v_role = 'tecnico' THEN
    UPDATE technicians SET status = 'ativo' WHERE technicians.user_id = p_user_id;
  END IF;

  RETURN QUERY SELECT p_user_id, v_tenant_id, v_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION auth_confirm_email(UUID) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_confirm_email(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_confirm_email(UUID) TO montese_app;
