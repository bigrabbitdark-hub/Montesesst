-- Painel de Atuação (Fase 4): financeiro somente leitura para o `socio`.
-- Rollback (descartável): DROP POLICY payment_events_socio_select ON payment_events;
--   DROP TRIGGER trg_plans_guard_role ON plans; DROP FUNCTION plans_guard_role();

-- 1) Leitura de eventos de pagamento: só de assinaturas de tenants Montese. Eventos
--    órfãos (subscription_id nulo) e de técnicos (tenant_id nulo) ficam invisíveis.
--    A subconsulta passa pela policy de subscriptions do socio (0092).
CREATE POLICY payment_events_socio_select ON payment_events FOR SELECT
  USING (
    current_setting('app.role', true) = 'socio'
    AND EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.id = payment_events.subscription_id
        AND s.tenant_id IS NOT NULL
        AND is_montese_tenant(s.tenant_id)
    )
  );

-- 2) `plans` não tem RLS (leitura pública em GET /plans e JOINs em várias tabelas).
--    Em vez de ligá-la, bloqueia ESCRITA por papéis de aplicação. Contexto sem
--    papel (migrations, superusuário, funções SECURITY DEFINER) e `admin` passam; qualquer
--    outro valor (inclusive desconhecido) falha fechado (allowlist).
CREATE FUNCTION plans_guard_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('app.role', true), '') NOT IN ('', 'admin') THEN
    RAISE EXCEPTION 'plans: escrita não permitida para o papel %', current_setting('app.role', true)
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER trg_plans_guard_role BEFORE INSERT OR UPDATE OR DELETE ON plans
  FOR EACH ROW EXECUTE FUNCTION plans_guard_role();
