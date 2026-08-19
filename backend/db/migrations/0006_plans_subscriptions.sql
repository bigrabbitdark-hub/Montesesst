-- plans: catálogo de planos, dado configurável — sem RLS própria (não é
-- dado de tenant, é catálogo público da plataforma; a página /planos
-- precisa listar preços sem autenticação, mesma categoria de `tenants`,
-- que também não tem RLS — ver comentário em 0001_init.sql).
CREATE TABLE plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience TEXT NOT NULL CHECK (audience IN ('empresa', 'tecnico')),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  employee_limit INTEGER,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_plans_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Valores de exemplo (placeholder, confirmado com o fundador em
-- brainstorming de 2026-08-18/19) — faixas baseadas no esboço
-- compartilhado, não são preços finais. Ajustar depois via SQL direto ou
-- futuramente uma tela de admin (Fase 7), sem precisar mexer em código.
INSERT INTO plans (audience, slug, name, price_cents, employee_limit) VALUES
  ('empresa', 'empresa-start', 'Start', 29900, 10),
  ('empresa', 'empresa-premium', 'Premium', 79900, 50),
  ('empresa', 'empresa-super-premium', 'Super Premium', 200000, 200),
  ('empresa', 'empresa-enterprise', 'Enterprise', 500000, NULL),
  ('tecnico', 'tecnico-start', 'Start Técnico', 9900, NULL);

-- subscriptions: uma linha por tentativa/assinatura. RLS habilitada — dado
-- sensível por tenant/técnico, mesma policy-shape de `users`.
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  technician_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'authorized', 'paused', 'cancelled')),
  mercadopago_preapproval_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_subscription_subject CHECK (
    (tenant_id IS NOT NULL AND technician_user_id IS NULL) OR
    (tenant_id IS NULL AND technician_user_id IS NOT NULL)
  )
);
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX subscriptions_tenant_idx ON subscriptions (tenant_id);
CREATE INDEX subscriptions_technician_idx ON subscriptions (technician_user_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_isolation ON subscriptions USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR technician_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
);

-- payments_update_subscription_status: usado pelo webhook do Mercado Pago
-- (Task 4), que chega sem nenhum contexto de tenant/role — RLS bloquearia
-- um UPDATE anônimo em subscriptions. Mesma técnica de auth_confirm_email
-- (0004_confirm_email_function.sql). Se a assinatura vira 'authorized' e é
-- de uma empresa, também atualiza tenants.plan (campo texto já existente)
-- pra manter coerente o que já é exibido hoje — sem equivalente pro
-- técnico, não existe (nem precisa existir) campo de plano em
-- users/technicians.
CREATE FUNCTION payments_update_subscription_status(
  p_preapproval_id TEXT,
  p_status TEXT
) RETURNS TABLE(subscription_id UUID, tenant_id UUID, plan_name TEXT) AS $$
DECLARE
  v_subscription_id UUID;
  v_tenant_id UUID;
  v_plan_name TEXT;
BEGIN
  UPDATE subscriptions s SET status = p_status
  WHERE s.mercadopago_preapproval_id = p_preapproval_id
  RETURNING s.id, s.tenant_id INTO v_subscription_id, v_tenant_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT p.name INTO v_plan_name FROM plans p
    JOIN subscriptions s ON s.plan_id = p.id
    WHERE s.id = v_subscription_id;

  IF p_status = 'authorized' AND v_tenant_id IS NOT NULL THEN
    UPDATE tenants SET plan = v_plan_name WHERE id = v_tenant_id;
  END IF;

  RETURN QUERY SELECT v_subscription_id, v_tenant_id, v_plan_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION payments_update_subscription_status(TEXT, TEXT) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION payments_update_subscription_status(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payments_update_subscription_status(TEXT, TEXT) TO montese_app;

-- montese_auth_bypass já tem UPDATE em tenants desde 0004_confirm_email_function.sql
-- — só falta o que é genuinamente novo aqui: subscriptions (tabela nova)
-- e plans (tabela nova, só leitura pro JOIN acima).
GRANT SELECT, UPDATE ON subscriptions TO montese_auth_bypass;
GRANT SELECT ON plans TO montese_auth_bypass;
