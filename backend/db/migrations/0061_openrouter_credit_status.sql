-- ITEM 013 (auditoria técnica pré-produção 2026-09-27): o OpenRouter não tinha nenhum
-- monitoramento de crédito — quando a conta fica sem saldo, cada chamada (embeddings,
-- copiloto de checklist, provedor alternativo de resposta normativa) vira só um 502
-- genérico no log, sem avisar ninguém.
--
-- Linha única (id fixo em 1, via upsert), atualizada por um cron periódico que consulta
-- GET https://openrouter.ai/api/v1/key (endpoint oficial de saldo da própria conta —
-- ver OPENROUTER_CREDIT_KEY_ENDPOINT_URL no serviço). A rota de alertas do admin lê esta
-- tabela (leitura local, rápida) em vez de chamar o OpenRouter a cada request — mesma
-- regra já seguida por AdminDashboardService.getAlertas ("nada de OpenRouter etc., pro
-- sininho do topbar nunca travar por terceiro").
--
-- Dado operacional interno da CONTA (não de tenant) — mesma categoria de
-- minimax_usage_log/official_sources/caepi_records: sem tenant_id, sem RLS.
CREATE TABLE openrouter_credit_status (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  check_succeeded BOOLEAN NOT NULL,
  -- true quando a chave não tem teto configurado no OpenRouter (limit/limit_remaining
  -- vêm null na resposta deles) — nesse caso nunca há alerta de crédito baixo/zerado.
  is_unlimited BOOLEAN NOT NULL DEFAULT false,
  limit_remaining_usd NUMERIC(12, 4),
  limit_usd NUMERIC(12, 4),
  -- usage_daily da resposta do OpenRouter — gasto REAL de hoje na conta inteira
  -- (reaproveitado pelo alerta de teto de custo do ITEM 014, ver alert-rules.ts).
  usage_daily_usd NUMERIC(12, 4),
  error_message TEXT
);
