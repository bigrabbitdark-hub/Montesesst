-- Fase 6 (sub-projeto C — Catálogo de EPI): corrige um achado da revisão
-- final — apagar um tenant_epis não pode mais destruir silenciosamente o
-- histórico de entregas assinadas (registro legalmente relevante,
-- NR-06/CLT art. 166). Troca CASCADE por RESTRICT: só é possível apagar
-- um EPI que não tenha nenhuma entrega registrada. Ver
-- docs/specs/fase-6-catalogo-epi.md.

ALTER TABLE employee_epi_deliveries
  DROP CONSTRAINT employee_epi_deliveries_tenant_epi_id_fkey;

ALTER TABLE employee_epi_deliveries
  ADD CONSTRAINT employee_epi_deliveries_tenant_epi_id_fkey
  FOREIGN KEY (tenant_epi_id) REFERENCES tenant_epis(id) ON DELETE RESTRICT;
