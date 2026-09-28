-- ITEM 011 (auditoria técnica pré-produção 2026-09-27): trocar de plano (upgrade
-- ou downgrade) cria uma assinatura NOVA e nunca cancelava a anterior — o
-- cliente ficava com dois preapprovals cobrando ao mesmo tempo no Mercado Pago.
--
-- Quando o webhook confirma que uma assinatura virou 'authorized', o serviço
-- cancela as OUTRAS 'authorized' do mesmo sujeito (a empresa, ou o técnico). Esta
-- função devolve quais são. Precisa ser SECURITY DEFINER pelo mesmo motivo de
-- payments_update_subscription_status: o webhook chega sem sessão (sem contexto de
-- tenant) e `subscriptions` tem FORCE RLS — sem ela a consulta devolveria 0 linhas.
-- Só lê; nunca altera nada. Devolve apenas ids de preapproval de assinaturas do
-- MESMO sujeito da assinatura informada.
--
-- A MAIS NOVA VENCE (o.created_at < n.created_at): só entram as assinaturas criadas
-- ANTES da informada. Sem isso, dois webhooks quase simultâneos — o da nova e um aviso
-- atrasado da antiga, que ainda consta 'authorized' no Mercado Pago — fariam cada
-- uma cancelar a outra, e o cliente ficaria sem plano nenhum. Assim, o webhook da
-- antiga nunca consegue cancelar a nova.
CREATE FUNCTION payments_superseded_preapprovals(p_preapproval_id TEXT)
RETURNS TABLE(preapproval_id TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.mercadopago_preapproval_id
  FROM subscriptions n
  JOIN subscriptions o
    ON o.id <> n.id
   AND o.status = 'authorized'
   AND o.mercadopago_preapproval_id IS NOT NULL
   AND o.created_at < n.created_at
   AND (
        (n.tenant_id IS NOT NULL AND o.tenant_id = n.tenant_id)
     OR (n.technician_user_id IS NOT NULL AND o.technician_user_id = n.technician_user_id)
   )
  WHERE n.mercadopago_preapproval_id = p_preapproval_id
    AND n.status = 'authorized';
$$;

ALTER FUNCTION payments_superseded_preapprovals(text) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION payments_superseded_preapprovals(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION payments_superseded_preapprovals(text) TO montese_app;
