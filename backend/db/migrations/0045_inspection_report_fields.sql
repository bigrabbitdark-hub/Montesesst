-- Fecha o gap entre docs/reference/modelos-relatorios-sst.md (seção 2,
-- "Identificação": empresa, CNPJ, endereço, horário da visita) e o que
-- inspections.visited_at sozinho (só data) suporta hoje. Nullable: não
-- quebra as inspeções já existentes em produção sem esse dado — o DTO
-- de criação exige o campo pra toda inspeção NOVA, a coluna em si fica
-- nullable no schema.
ALTER TABLE inspections ADD COLUMN company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL;
ALTER TABLE inspections ADD COLUMN started_at TIME;
ALTER TABLE inspections ADD COLUMN ended_at TIME;

CREATE INDEX inspections_company_unit_id_idx ON inspections (company_unit_id);
