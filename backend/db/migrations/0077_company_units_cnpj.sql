-- Filial com CNPJ próprio. Coluna nullable porque as filiais já cadastradas não
-- têm CNPJ: a obrigatoriedade vale para filiais NOVAS (DTO) e para completar as
-- antigas (a API não deixa limpar o CNPJ depois de informado). Sem backfill.
-- A matriz continua usando tenants.cnpj (imutável); a coluna fica nula nela.
-- Unicidade só dentro da mesma empresa: checar entre empresas exigiria ler dado
-- de outro tenant (RLS) e vazaria informação.
ALTER TABLE company_units ADD COLUMN IF NOT EXISTS cnpj VARCHAR(14);

CREATE UNIQUE INDEX IF NOT EXISTS company_units_cnpj_per_tenant
  ON company_units (tenant_id, cnpj)
  WHERE cnpj IS NOT NULL;
