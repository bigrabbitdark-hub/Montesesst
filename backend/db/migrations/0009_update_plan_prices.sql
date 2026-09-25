-- Atualiza os preços dos planos 'empresa' para os valores definidos pelo
-- fundador em 2026-08-24 (substitui os valores placeholder de
-- 0006_plans_subscriptions.sql, como já previsto no comentário daquela
-- migration: "ajustar depois via SQL direto"). Enterprise mantém um
-- price_cents simbólico (coluna é NOT NULL) — a página /planos trata esse
-- slug como "valores a combinar" e não dispara o fluxo de assinatura via
-- Mercado Pago para ele.
UPDATE plans SET price_cents = 39700 WHERE slug = 'empresa-start';
UPDATE plans SET price_cents = 79700 WHERE slug = 'empresa-premium';
UPDATE plans SET price_cents = 129700 WHERE slug = 'empresa-super-premium';
