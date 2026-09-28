-- ITEM 006 (auditoria técnica pré-produção 2026-09-27): CaepiService.search
-- faz ILIKE '%q%' (wildcard nas duas pontas) em 4 colunas de texto contra
-- caepi_records, que só tem PK em numero_ca — nenhum índice de apoio pra
-- busca textual. Como é espelho nacional do MTE (potencialmente centenas de
-- milhares de linhas), já é lento hoje, independente do número de tenants.
--
-- Requer que a extensão pg_trgm já tenha sido criada por um superuser ANTES
-- desta migration rodar — mesma limitação/padrão já documentado em
-- 0021_normative_base.sql para a extensão `vector` (montese_app, que roda as
-- migrations, não tem privilégio de CREATE EXTENSION). Comando (uma vez,
-- fora desta migration, como superuser):
--   CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX caepi_records_equipamento_trgm_idx
  ON caepi_records USING gin (equipamento gin_trgm_ops);
CREATE INDEX caepi_records_descricao_equipamento_trgm_idx
  ON caepi_records USING gin (descricao_equipamento gin_trgm_ops);
CREATE INDEX caepi_records_marca_ca_trgm_idx
  ON caepi_records USING gin (marca_ca gin_trgm_ops);
CREATE INDEX caepi_records_razao_social_trgm_idx
  ON caepi_records USING gin (razao_social gin_trgm_ops);
