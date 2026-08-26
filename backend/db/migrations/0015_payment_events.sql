-- payment_events: histórico de cobranças de assinatura, populado pelo
-- webhook do Mercado Pago (tópico subscription_authorized_payment, ver
-- docs/specs/fase-7-financeiro.md secao 3). subscription_id é nullable
-- de propósito: um evento cujo preapproval_id não bate com nenhuma
-- assinatura nossa ainda é gravado (auditoria), nunca descartado —
-- mesmo espírito tolerante do branch subscription_preapproval já
-- existente em WebhookController.
CREATE TABLE payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
  mercadopago_payment_id TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_events_subscription_idx ON payment_events (subscription_id);

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events FORCE ROW LEVEL SECURITY;

-- Espelha subscriptions_isolation, mas via EXISTS (a tabela não tem
-- tenant_id/technician_user_id própria). Deixa o design pronto pra
-- empresa/técnico um dia verem o próprio histórico, mesmo que esta
-- entrega só construa a tela do admin.
CREATE POLICY payment_events_isolation ON payment_events USING (
  current_setting('app.role', true) = 'admin'
  OR EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.id = payment_events.subscription_id
      AND (
        s.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        OR s.technician_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      )
  )
);

-- payments_record_payment_event: usado pelo webhook do Mercado Pago,
-- que chega sem nenhum contexto de tenant/role — RLS bloquearia um
-- INSERT anônimo em payment_events. Mesma técnica de
-- payments_update_subscription_status (0006_plans_subscriptions.sql).
CREATE FUNCTION payments_record_payment_event(
  p_mercadopago_payment_id TEXT,
  p_preapproval_id TEXT,
  p_amount_cents INTEGER,
  p_status TEXT,
  p_occurred_at TIMESTAMPTZ
) RETURNS TABLE(id UUID, subscription_id UUID) AS $$
DECLARE
  v_subscription_id UUID;
  v_id UUID;
BEGIN
  -- Set admin role to bypass RLS policies for webhook processing
  -- (webhook arrives without tenant/user context).
  PERFORM set_config('app.role', 'admin', false);

  SELECT s.id INTO v_subscription_id FROM subscriptions s
    WHERE s.mercadopago_preapproval_id = p_preapproval_id;

  INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
  VALUES (v_subscription_id, p_mercadopago_payment_id, p_amount_cents, p_status, p_occurred_at)
  ON CONFLICT (mercadopago_payment_id) DO NOTHING
  RETURNING payment_events.id INTO v_id;

  RETURN QUERY SELECT v_id, v_subscription_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER FUNCTION payments_record_payment_event(TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION payments_record_payment_event(TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payments_record_payment_event(TEXT, TEXT, INTEGER, TEXT, TIMESTAMPTZ) TO montese_app;

-- montese_auth_bypass já tem SELECT em subscriptions desde
-- 0006_plans_subscriptions.sql — e também precisa de SELECT em
-- payment_events (para RETURNING e para o EXISTS check no RLS).
-- montese_app precisa de SELECT para que RLS policies filtrem suas queries.
GRANT SELECT, INSERT ON payment_events TO montese_auth_bypass;
GRANT SELECT ON payment_events TO montese_app;
