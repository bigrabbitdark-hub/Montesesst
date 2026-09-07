-- Registro de uso da API da MiniMax (tokens por chamada, por
-- capacidade) — a MiniMax não expõe endpoint de saldo/uso pra contas
-- pay-as-you-go (só painel web deles), então este é o único jeito de
-- ter visibilidade automática sobre consumo. Dado operacional interno,
-- não pertence a nenhum tenant — sem tenant_id, sem RLS, mesma
-- categoria de official_sources/caepi_records (dado/registro global
-- compartilhado, não de cliente).

CREATE TABLE minimax_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability TEXT NOT NULL,
  prompt_tokens INT NOT NULL,
  completion_tokens INT NOT NULL,
  total_tokens INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX minimax_usage_log_created_at_idx ON minimax_usage_log (created_at);
CREATE INDEX minimax_usage_log_capability_idx ON minimax_usage_log (capability);
