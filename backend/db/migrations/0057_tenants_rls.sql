-- ITEM 009 (auditoria técnica pré-produção 2026-09-27), passo 2 de 2.
--
-- `tenants` era a ÚNICA das 59 tabelas sem RLS: o isolamento dependia 100% de
-- cada controller resolver o tenant certo (ver comentário em
-- tenants.controller.ts). Um bug futuro num controller — o mesmo tipo de erro
-- do bypass de /pente-fino/run — vazaria dados cadastrais de outras empresas
-- sem nenhuma segunda barreira no banco.
--
-- PRÉ-REQUISITO DE IMPLANTAÇÃO: o código que lê o logo público via
-- tenant_logo_file_key() (migration 0056) já deve estar no ar. Com o código
-- antigo, GET /tenants/:id/logo deixa de achar a linha (sem contexto = 0 linhas).
--
-- Quem lê `tenants` no código (levantado em 2026-09-28):
--  - admin (listagens, financeiro, overview, crons)      -> ramo 'admin'
--  - a própria empresa (GET/PATCH /tenants/me, logo)     -> ramo do próprio id
--  - técnico/parceiro vinculado (portfólio, documentos,
--    nome da empresa na CIPA)                            -> ramo "vinculados"
--  - rota pública do logo                                -> tenant_logo_file_key() (0056)
--  - registro e webhooks de pagamento                    -> funções SECURITY DEFINER
--    (dono com BYPASSRLS), não passam por esta policy.
-- A consulta por vínculo usa assigned_tenant_ids_for_current_user(), que lê
-- tenant_technicians/tenant_partners (não `tenants`), então não há recursão.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_isolation ON tenants USING (
  current_setting('app.role', true) = 'admin'
  OR id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR id IN (SELECT assigned_tenant_ids_for_current_user())
);
