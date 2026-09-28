-- ITEM 022 (auditoria técnica pré-produção 2026-09-27): recuperação de senha.
--
-- A redefinição acontece SEM sessão (o usuário esqueceu a senha), então não há
-- user_id/tenant_id pra popular o contexto de RLS de `users`. Mesmo padrão de
-- auth_confirm_email (0005): função SECURITY DEFINER, dona com BYPASSRLS.
--
-- Compare-and-swap no hash antigo: o token de redefinição carrega uma impressão
-- digital do hash vigente e o serviço já a conferiu, mas duas requisições
-- simultâneas com o MESMO token passariam nessa conferência. Aqui o UPDATE só
-- acerta a linha se o hash ainda for o que o serviço leu — a segunda requisição
-- não casa nenhuma linha e o token vale uma única vez, de forma atômica.
-- Só troca senha de usuário `ativo` (nunca de conta pendente/desativada).
CREATE FUNCTION auth_reset_password(p_user_id UUID, p_old_password_hash TEXT, p_new_password_hash TEXT)
RETURNS TABLE(user_id UUID, tenant_id UUID, role user_role)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  UPDATE users u
     SET password_hash = p_new_password_hash
   WHERE u.id = p_user_id
     AND u.password_hash = p_old_password_hash
     AND u.status = 'ativo'
  RETURNING u.id, u.tenant_id, u.role;
END;
$$;

ALTER FUNCTION auth_reset_password(uuid, text, text) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_reset_password(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_reset_password(uuid, text, text) TO montese_app;
