-- ITEM 014 (auditoria técnica pré-produção 2026-09-27): sem teto de custo de IA em
-- produção. A MiniMax não expõe endpoint de saldo/uso (comentário original de
-- 0034_minimax_usage_log.sql) — diferente do OpenRouter (ITEM 013, que tem endpoint
-- próprio e por isso não precisa de estimativa nenhuma), o único jeito de saber quanto
-- se gastou com ela é estimar a partir dos tokens já registrados aqui.
--
-- Nullable e sem backfill: linhas já existentes não têm preço confiável retroativo (o
-- preço pode ter mudado desde que foram gravadas) — ficam NULL, tratadas como 0 nas
-- somas (ver minimax-cost.util.ts).
ALTER TABLE minimax_usage_log ADD COLUMN estimated_cost_usd NUMERIC(12, 6);
