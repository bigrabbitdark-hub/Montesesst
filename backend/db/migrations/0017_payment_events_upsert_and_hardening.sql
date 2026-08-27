-- Corrige 0015/0016: ON CONFLICT DO NOTHING descartava atualização de
-- status quando o Mercado Pago reenvia notificação pro MESMO invoice id
-- (recycling/retry de cobrança falha, confirmado pelos próprios tipos do
-- SDK: status 'recycling', campo retry_attempt) — o evento ficava
-- congelado no primeiro status reportado. Troca pra DO UPDATE, mantendo
-- idempotência pra reenvio literal (mesmos valores) mas permitindo
-- transição de status real passar. Também adiciona SET search_path
-- (hardening já padrão em 7 das 11 funções SECURITY DEFINER deste banco)
-- — sem isso, pg_temp é buscado antes de public, então quem já tiver
-- conseguido rodar SQL como montese_app poderia em tese desviar a
-- função com uma CREATE TEMP TABLE subscriptions forjada.
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
  ON CONFLICT (mercadopago_payment_id) DO UPDATE
    SET status = EXCLUDED.status,
        amount_cents = EXCLUDED.amount_cents,
        occurred_at = EXCLUDED.occurred_at
  RETURNING payment_events.id INTO v_id;

  RETURN QUERY SELECT v_id, v_subscription_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Mesma lacuna de search_path na função irmã (0006_plans_subscriptions.sql),
-- aproveitando esta migration já tocar o assunto.
ALTER FUNCTION payments_update_subscription_status(TEXT, TEXT) SET search_path = public, pg_temp;

-- ON CONFLICT DO UPDATE exige privilégio de UPDATE na tabela (checado pro
-- statement inteiro, mesmo quando o conflito não ocorre em tempo de
-- execução) — 0015_payment_events.sql só concedeu SELECT e INSERT pra
-- montese_auth_bypass (dono da função, suficiente pro antigo DO NOTHING).
-- Sem este GRANT, toda chamada à função passa a falhar com "permission
-- denied for table payment_events", confirmado rodando a suite e2e após
-- o CREATE OR REPLACE acima.
GRANT UPDATE ON payment_events TO montese_auth_bypass;
