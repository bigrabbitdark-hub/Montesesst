-- Corrige 0015_payment_events.sql: payments_record_payment_event chamava
-- PERFORM set_config('app.role', 'admin', false) — desnecessário (o dono
-- da função, montese_auth_bypass, já tem BYPASSRLS desde 0001_init.sql,
-- igual a payments_update_subscription_status em 0006, que não precisa
-- disso) e perigoso: o terceiro argumento false torna a mudança
-- session-scoped, não transaction-scoped, e como esta função é chamada
-- via DatabaseService.withoutTenantContext (que não abre transação e
-- devolve a conexão pro pool sem resetar estado de sessão), isso vazava
-- app.role='admin' permanentemente numa conexão do pool, disponível pra
-- qualquer chamada futura não relacionada que reaproveitasse essa mesma
-- conexão.
CREATE OR REPLACE FUNCTION payments_record_payment_event(
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
  SELECT s.id INTO v_subscription_id FROM subscriptions s
    WHERE s.mercadopago_preapproval_id = p_preapproval_id;

  INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
  VALUES (v_subscription_id, p_mercadopago_payment_id, p_amount_cents, p_status, p_occurred_at)
  ON CONFLICT (mercadopago_payment_id) DO NOTHING
  RETURNING payment_events.id INTO v_id;

  RETURN QUERY SELECT v_id, v_subscription_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
