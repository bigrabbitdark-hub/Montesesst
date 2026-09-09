-- Fix: company_units_isolation (criada na migration 0007, antes do padrão
-- de "assigned_tenant_ids_for_current_user()" existir) nunca ganhou a
-- terceira cláusula que toda tabela tenant-scoped criada depois passou a
-- ter (employees, fire_safety_equipment, fire_brigade_members, etc.) —
-- sem ela, um tecnico/parceiro vinculado a um tenant via
-- tenant_technicians/tenant_partners nunca consegue ver as company_units
-- desse tenant (RLS bloqueia mesmo o SELECT explícito por id, já que
-- app.tenant_id fica vazio pra esses papéis). Descoberto ao implementar
-- FireBrigadeService.createMember, que valida company_unit_id contra
-- company_units usando o client com o contexto de tenant do usuário
-- autenticado (ver docs/specs/prevencao-emergencia-brigada.md).
DROP POLICY company_units_isolation ON company_units;
CREATE POLICY company_units_isolation ON company_units USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);
