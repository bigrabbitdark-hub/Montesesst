-- Painel de Atuação (Fase 2). Policies PERMISSIVAS e específicas do `socio`
-- (somem na ausência do papel; somam-se às existentes). Todas limitadas à
-- carteira Montese via is_montese_tenant() (SECURITY DEFINER, 0091), que lê os
-- vínculos sem passar por RLS — não há recursão.
-- Escrita do socio SÓ em tenants (UPDATE); a lista de colunas editáveis é
-- imposta na API (RLS não restringe colunas). subscriptions e company_units:
-- somente SELECT. Nenhum INSERT/DELETE para o socio em tabela alguma.
--
-- Rollback:
--   DROP POLICY tenants_socio_select ON tenants;
--   DROP POLICY tenants_socio_update ON tenants;
--   DROP POLICY subscriptions_socio_select ON subscriptions;
--   DROP POLICY company_units_socio_select ON company_units;

CREATE POLICY tenants_socio_select ON tenants FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(id));

CREATE POLICY tenants_socio_update ON tenants FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(id));

CREATE POLICY subscriptions_socio_select ON subscriptions FOR SELECT
  USING (current_setting('app.role', true) = 'socio'
         AND tenant_id IS NOT NULL AND is_montese_tenant(tenant_id));

CREATE POLICY company_units_socio_select ON company_units FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
