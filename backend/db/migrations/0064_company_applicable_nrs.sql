-- Conformidade por NR (spec 2026-10-01): aplicabilidade das NRs por empresa,
-- marcada por técnico/parceiro no relatório de visita técnica.
-- Aditiva e sem alteração destrutiva. `nr_code` NÃO tem CHECK no banco: o
-- catálogo vive em código (backend/src/nr-conformidade/nr-catalog.ts) e é
-- validado no backend. Desmarcar grava `unmarked_at` (rastreabilidade).
CREATE TABLE company_applicable_nrs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nr_code TEXT NOT NULL,
  marked_by_user_id UUID NOT NULL REFERENCES users(id),
  source_inspection_id UUID REFERENCES inspections(id) ON DELETE SET NULL,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unmarked_at TIMESTAMPTZ
);

-- No máximo uma marcação VIGENTE por empresa + NR.
CREATE UNIQUE INDEX company_applicable_nrs_active_uq
  ON company_applicable_nrs (tenant_id, nr_code) WHERE unmarked_at IS NULL;
CREATE INDEX company_applicable_nrs_tenant_idx ON company_applicable_nrs (tenant_id);

ALTER TABLE company_applicable_nrs ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_applicable_nrs FORCE ROW LEVEL SECURITY;
CREATE POLICY company_applicable_nrs_isolation ON company_applicable_nrs USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

-- Rascunho da marcação enquanto a visita está aberta (lista de nr_code).
-- NULL = o técnico não mexeu no bloco; NULL em todas as inspeções antigas.
ALTER TABLE inspections ADD COLUMN nrs_aplicaveis JSONB;
