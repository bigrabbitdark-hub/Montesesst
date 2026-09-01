-- Fase 12a (review de Task 1): a Global Constraint do plano exige
-- tenant_id E company_unit_id em toda tabela cipa_*, mas
-- 0023_cipa_nucleo.sql deixou cipa_meetings sem company_unit_id. Task 2
-- (MeetingsService) e a visão de calendário do Fase 12b vão precisar
-- filtrar reuniões por estabelecimento sem join contra cipa_committees
-- toda vez. 0023 já foi aplicada no banco real, então a correção é uma
-- migration nova (mesmo padrão de 0020_documents_company_unit.sql sobre
-- 0008_documents.sql) — nunca editar uma migration já aplicada.

ALTER TABLE cipa_meetings ADD COLUMN company_unit_id UUID REFERENCES company_units(id) ON DELETE CASCADE;

-- Backfill via join por committee_id — não deveria haver dado real em
-- produção ainda (só fixtures de teste, já limpas pelo afterAll de cada
-- spec), mas a evolução de schema é escrita como se houvesse.
UPDATE cipa_meetings m SET company_unit_id = c.company_unit_id
FROM cipa_committees c
WHERE c.id = m.committee_id AND m.company_unit_id IS NULL;

ALTER TABLE cipa_meetings ALTER COLUMN company_unit_id SET NOT NULL;

CREATE INDEX cipa_meetings_company_unit_idx ON cipa_meetings (company_unit_id);
