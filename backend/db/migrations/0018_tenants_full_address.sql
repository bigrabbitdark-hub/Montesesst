-- Onboarding guiado (feedback de teste real, 2026-08-28): a matriz da
-- empresa tinha menos dado estruturado que uma filial (company_units já
-- tem endereço completo desde a Fase 3, tenants só tinha setor/contato/
-- telefone). Adiciona nome fantasia, endereço completo e cargo de quem
-- representa. CNPJ e razão social (name) continuam imutáveis depois do
-- cadastro — não entram nas colunas atualizáveis do service.
ALTER TABLE tenants
  ADD COLUMN trade_name TEXT,
  ADD COLUMN contact_role TEXT,
  ADD COLUMN address_street TEXT,
  ADD COLUMN address_number TEXT,
  ADD COLUMN address_city TEXT,
  ADD COLUMN address_state VARCHAR(2),
  ADD COLUMN address_zip VARCHAR(8);
