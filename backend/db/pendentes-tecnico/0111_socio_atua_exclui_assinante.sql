-- PENDENTE (não está em db/migrations de propósito): só aplicar junto/depois da 0109_tecnico_assinante_isolamento
-- (que cria tenants.owner_technician_id). Sem a coluna, falha. Ver docs/operations/integracao-socio-atua-com-tecnico-assinante.md.
-- ROLLBACK: reaplicar o corpo de socio_can_act_on_tenant da 0108_socio_cadastra_atua_empresa.sql e
--   DELETE FROM _migrations WHERE name = '0111_socio_atua_exclui_assinante.sql';
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION socio_can_act_on_tenant(p_socio_id UUID, p_tenant_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
         current_setting('app.role', true) = 'socio'
     AND p_socio_id = NULLIF(current_setting('app.user_id', true), '')::uuid
     AND EXISTS (SELECT 1 FROM users s WHERE s.id = p_socio_id AND s.role = 'socio' AND s.status = 'ativo')
     AND EXISTS (SELECT 1 FROM socio_permissions sp WHERE sp.user_id = p_socio_id AND sp.permission = 'empresas.atuar')
     AND EXISTS (SELECT 1 FROM tenants t WHERE t.id = p_tenant_id AND t.status = 'ativo'
                                           AND t.owner_technician_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM tenant_technicians tt WHERE tt.tenant_id = p_tenant_id)
     AND NOT EXISTS (SELECT 1 FROM tenant_partners tp WHERE tp.tenant_id = p_tenant_id)
  ), false);
$$;
