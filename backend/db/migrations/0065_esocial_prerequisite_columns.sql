-- Colunas de pré-requisito para o eSocial, todas nullable (não quebram cadastro
-- existente). Ver docs/specs/esocial-mapeamento-dados.md, seções 1-2.

ALTER TABLE company_units
  ADD COLUMN cnae VARCHAR(7),
  ADD COLUMN esocial_establishment_code TEXT;

ALTER TABLE employees
  ADD COLUMN registration_number TEXT,
  ADD COLUMN esocial_category_code TEXT,
  ADD COLUMN esocial_vinculo_confirmed_at TIMESTAMPTZ,
  ADD COLUMN esocial_vinculo_confirmed_by_user_id UUID REFERENCES users(id);

ALTER TABLE positions
  ADD COLUMN cbo_code VARCHAR(6);
