-- Papel `socio` (Painel de Atuação Montese). Sozinho nesta migration: o runner
-- abre BEGIN/COMMIT por arquivo e um valor novo de enum não pode ser usado na
-- mesma transação em que foi criado. O uso (constraint, tabela) fica na 0091.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'socio';
