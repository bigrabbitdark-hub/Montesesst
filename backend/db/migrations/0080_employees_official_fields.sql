-- Campos do modelo oficial Montese SST (planilha "Cadastro Funcionários - Laudos e eSocial").
-- Aditiva: nenhuma coluna existente é alterada. Matrícula e CBO ficam como texto
-- (zeros à esquerda). Colunas novas nascem NULL, então o índice único parcial
-- não pode colidir com dados legados.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS esocial_registration TEXT,
  ADD COLUMN IF NOT EXISTS sex CHAR(1),
  ADD COLUMN IF NOT EXISTS cbo_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS activity_description TEXT;

ALTER TABLE employees
  ADD CONSTRAINT employees_sex_check CHECK (sex IS NULL OR sex IN ('F', 'M')),
  ADD CONSTRAINT employees_cbo_code_check CHECK (cbo_code IS NULL OR cbo_code ~ '^[0-9]{6}$'),
  ADD CONSTRAINT employees_esocial_registration_check
    CHECK (esocial_registration IS NULL OR esocial_registration ~ '^[A-Za-z0-9._-]{1,30}$');

CREATE UNIQUE INDEX IF NOT EXISTS employees_tenant_esocial_registration_uidx
  ON employees (tenant_id, esocial_registration)
  WHERE esocial_registration IS NOT NULL;
