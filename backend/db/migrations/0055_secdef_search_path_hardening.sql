-- ITEM 021 (auditoria técnica pré-produção 2026-09-27): funções SECURITY
-- DEFINER rodam com os privilégios do dono (montese_auth_bypass, BYPASSRLS).
-- Sem um search_path fixo, um objeto de mesmo nome criado no schema temporário
-- do chamador (que o Postgres pesquisa PRIMEIRO quando pg_temp não aparece
-- explícito) pode desviar as queries da função. A migration 0017 já corrigiu
-- isso para as 2 funções de pagamento; aqui vai o resto:
--  - as 3 de auto-registro/confirmação (pré-autenticação, chamáveis sem login)
--    estavam SEM nenhum search_path;
--  - as outras 7 tinham só `public`, sem `pg_temp` explícito (então o schema
--    temporário continuava sendo pesquisado primeiro).
-- Padrão único, igual ao da 0017: `public, pg_temp` (pg_temp por último).
-- ALTER FUNCTION exige ser dono ou membro da role dona — montese_app é membro
-- de montese_auth_bypass (postgres/init/01-app-role.sh), como na 0017.

ALTER FUNCTION auth_register_tenant_and_user(TEXT, TEXT, TEXT, TEXT, TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION auth_register_technician(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION auth_confirm_email(UUID) SET search_path = public, pg_temp;

ALTER FUNCTION auth_find_user_by_email(TEXT) SET search_path = public, pg_temp;
ALTER FUNCTION technician_ids_for_tenant(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION partner_ids_for_tenant(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION current_technician_id() SET search_path = public, pg_temp;
ALTER FUNCTION current_partner_id() SET search_path = public, pg_temp;
ALTER FUNCTION assigned_tenant_ids_for_current_user() SET search_path = public, pg_temp;
ALTER FUNCTION linked_technicians_for_tenant(UUID) SET search_path = public, pg_temp;
