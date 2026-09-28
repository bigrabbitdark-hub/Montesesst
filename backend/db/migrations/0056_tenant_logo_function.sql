-- ITEM 009 (auditoria técnica pré-produção 2026-09-27), passo 1 de 2.
--
-- GET /tenants/:id/logo é PÚBLICO (o logo aparece em páginas/e-mails sem login)
-- e hoje lê `tenants` sem nenhum contexto de tenant. A migration seguinte
-- (0057) liga RLS em `tenants`; sem contexto, essa leitura passaria a devolver
-- 0 linhas (404 para todos). Esta função preserva exatamente o comportamento
-- atual — devolve só a chave do logo de um id — sem abrir o resto da tabela.
--
-- Ordem de implantação: esta migration é inofensiva com o código antigo (só
-- cria a função). A 0057 só pode ir depois que o código novo, que chama esta
-- função, estiver no ar — senão a rota de logo antiga quebra.
CREATE FUNCTION tenant_logo_file_key(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT logo_file_key FROM tenants WHERE id = p_tenant_id;
$$;

ALTER FUNCTION tenant_logo_file_key(uuid) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION tenant_logo_file_key(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_logo_file_key(uuid) TO montese_app;
