-- ITEM 020 (auditoria técnica pré-produção 2026-09-27): toda policy de RLS do
-- projeto filtra por tenant_id, e as listagens também. Levantamento no catálogo
-- do Postgres em produção (2026-09-28): 21 tabelas com tenant_id não tinham
-- NENHUM índice começando por essa coluna (a auditoria original listava 11; o
-- catálogo mostrou mais: CIPA, brigada, simulados, checklists). Hoje todas têm
-- dezenas de KB, então não há problema agora — mas cada query passa a varrer a
-- tabela inteira conforme o número de clientes cresce.
-- Padrão já usado a partir da 0042 (`<tabela>_tenant_id_idx`) e na 0053.
-- Fora de propósito: assistant_query_log (escrita a cada pergunta do Assistente,
-- leitura só de admin — o índice custaria mais do que ajuda).
-- `documents` já recebeu o seu na 0053. CREATE INDEX simples (o runner de
-- migrations é transacional, sem CONCURRENTLY): tabelas minúsculas, lock breve.
CREATE INDEX IF NOT EXISTS action_plans_tenant_id_idx ON action_plans (tenant_id);
CREATE INDEX IF NOT EXISTS cipa_committees_tenant_id_idx ON cipa_committees (tenant_id);
CREATE INDEX IF NOT EXISTS cipa_dds_records_tenant_id_idx ON cipa_dds_records (tenant_id);
CREATE INDEX IF NOT EXISTS cipa_elections_tenant_id_idx ON cipa_elections (tenant_id);
CREATE INDEX IF NOT EXISTS cipa_meeting_ata_drafts_tenant_id_idx ON cipa_meeting_ata_drafts (tenant_id);
CREATE INDEX IF NOT EXISTS cipa_meetings_tenant_id_idx ON cipa_meetings (tenant_id);
CREATE INDEX IF NOT EXISTS cipa_members_tenant_id_idx ON cipa_members (tenant_id);
CREATE INDEX IF NOT EXISTS cipa_pendencias_tenant_id_idx ON cipa_pendencias (tenant_id);
CREATE INDEX IF NOT EXISTS cipa_sipat_editions_tenant_id_idx ON cipa_sipat_editions (tenant_id);
CREATE INDEX IF NOT EXISTS cipa_trainings_tenant_id_idx ON cipa_trainings (tenant_id);
CREATE INDEX IF NOT EXISTS emergency_drills_tenant_id_idx ON emergency_drills (tenant_id);
CREATE INDEX IF NOT EXISTS employee_epi_deliveries_tenant_id_idx ON employee_epi_deliveries (tenant_id);
CREATE INDEX IF NOT EXISTS fire_brigade_coverage_targets_tenant_id_idx ON fire_brigade_coverage_targets (tenant_id);
CREATE INDEX IF NOT EXISTS fire_brigade_trainings_tenant_id_idx ON fire_brigade_trainings (tenant_id);
CREATE INDEX IF NOT EXISTS fire_safety_equipment_tenant_id_idx ON fire_safety_equipment (tenant_id);
CREATE INDEX IF NOT EXISTS inspections_tenant_id_idx ON inspections (tenant_id);
CREATE INDEX IF NOT EXISTS position_epi_requirements_tenant_id_idx ON position_epi_requirements (tenant_id);
CREATE INDEX IF NOT EXISTS position_training_requirements_tenant_id_idx ON position_training_requirements (tenant_id);
CREATE INDEX IF NOT EXISTS prevention_checklists_tenant_id_idx ON prevention_checklists (tenant_id);
CREATE INDEX IF NOT EXISTS prevention_corrective_actions_tenant_id_idx ON prevention_corrective_actions (tenant_id);
CREATE INDEX IF NOT EXISTS tenant_epis_tenant_id_idx ON tenant_epis (tenant_id);
