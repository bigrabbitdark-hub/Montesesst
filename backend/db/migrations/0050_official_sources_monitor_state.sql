-- Etapa 1 da Confiabilidade do Assistente (docs/specs/assistente-confiabilidade-etapa-1.md
-- §5): estado da última verificação de cada fonte oficial, gravado pelo
-- NormativeMonitorService, para o admin ver se o monitor está vivo e para
-- disparar alerta em falha repetida. Só aditiva: as fontes existentes ficam
-- com NULL/0 até a primeira execução do cron. Sem RLS (official_sources não
-- tem tenant_id). `last_checked_at` é também o futuro `data_verificacao` do
-- registry de fontes.
ALTER TABLE official_sources
  ADD COLUMN last_checked_at timestamptz,
  ADD COLUMN last_check_status text CHECK (last_check_status IN ('ok', 'erro')),
  ADD COLUMN last_error text,
  ADD COLUMN consecutive_failures int NOT NULL DEFAULT 0;
