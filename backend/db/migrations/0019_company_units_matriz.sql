-- Onboarding guiado (2026-08-28): a matriz da empresa vira tecnicamente
-- uma company_unit também (marcada is_matriz), pra reaproveitar 100% do
-- código já existente de vínculo de funcionário/CSV/documento por
-- unidade — sem isso, "funcionário da matriz" exigiria um caminho
-- paralelo em cada lugar que hoje só conhece company_unit_id.
ALTER TABLE company_units
  ADD COLUMN is_matriz BOOLEAN NOT NULL DEFAULT false;

-- No máximo uma matriz por empresa — índice parcial (não é UNIQUE
-- normal, porque `false` pode repetir livremente entre filiais).
CREATE UNIQUE INDEX company_units_one_matriz_per_tenant
  ON company_units (tenant_id)
  WHERE is_matriz = true;
