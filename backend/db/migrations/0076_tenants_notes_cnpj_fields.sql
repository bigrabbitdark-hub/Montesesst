-- Correção 1 (cadastro): "Nome fantasia" sai do formulário e vira "Observação".
-- trade_name NÃO é reaproveitado: ele é usado como nome de exibição (dashboard,
-- EmpresaShell, e-mail do resumo semanal) e os valores já gravados continuam
-- intactos. A observação ganha coluna própria.
-- Os demais campos vêm da consulta de CNPJ (bairro, complemento, CNAE principal).
-- Migration só aditiva: colunas nullable, sem backfill, sem DROP/ALTER de dados.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS address_neighborhood TEXT,
  ADD COLUMN IF NOT EXISTS address_complement TEXT,
  ADD COLUMN IF NOT EXISTS cnae_code VARCHAR(7),
  ADD COLUMN IF NOT EXISTS cnae_description TEXT;
