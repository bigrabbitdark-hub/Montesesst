-- Correção 2: filial passa a guardar os mesmos dados cadastrais da matriz, vindos
-- da consulta de CNPJ (razão social, bairro, complemento, CNAE) mais a Observação.
-- `name` continua sendo o rótulo interno da filial (ex.: "Sede"), por isso a razão
-- social ganha coluna própria. Só aditiva: colunas nullable, sem backfill, sem
-- tocar em dado existente. RLS/FORCE RLS de company_units não mudam.
ALTER TABLE company_units
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS address_neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS address_complement TEXT,
  ADD COLUMN IF NOT EXISTS cnae_code VARCHAR(7),
  ADD COLUMN IF NOT EXISTS cnae_description TEXT;
