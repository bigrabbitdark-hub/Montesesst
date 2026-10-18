-- Generalização da camada de regras interpretativas (docs/superpowers/specs/2026-10-09-base-normativa-gro-pgr-design.md §3.2).
-- A 0072 criou lip_rules/lip_rule_provisions (só LIP); esta migration as renomeia para normative_rules/
-- normative_rule_provisions e acrescenta `area` ('lip' | 'gro_pgr'), com CHECK de coerência area × categoria.
-- A 0072 NÃO é editada (já aplicada em produção). Conhecimento compartilhado entre tenants: SEM tenant_id, SEM RLS.
-- Aditiva: só RENAME, ADD COLUMN, troca do CHECK de categoria e o corpo da função do trigger; nenhum dado é apagado.
-- Sem BEGIN/COMMIT próprios: db/migrate.ts envolve cada arquivo em transação; com psql, usar --single-transaction.
-- Em produção as tabelas estavam vazias (verificado em 2026-10-09); a migration também funciona com linhas LIP,
-- que recebem area = 'lip' pelo DEFAULT temporário e já satisfazem o CHECK novo (o CHECK antigo só permitia
-- categorias LIP). O DEFAULT é removido logo em seguida: depois da 0073, INSERT sem `area` falha (NOT NULL).
-- Aplicar como dono das tabelas (postgres): com montese_app o ALTER falha com "must be owner".

-- Guarda: falha cedo, com mensagem clara, se o banco não estiver no estado deixado pela 0072.
DO $$
DECLARE
  fora integer;
BEGIN
  IF to_regclass('public.lip_rules') IS NULL OR to_regclass('public.lip_rule_provisions') IS NULL THEN
    RAISE EXCEPTION '0073: lip_rules/lip_rule_provisions não existem; aplique a 0072 antes (ou a 0073 já foi aplicada)';
  END IF;
  IF to_regclass('public.normative_rules') IS NOT NULL OR to_regclass('public.normative_rule_provisions') IS NOT NULL THEN
    RAISE EXCEPTION '0073: normative_rules/normative_rule_provisions já existem; nada foi alterado';
  END IF;
  SELECT count(*) INTO fora FROM lip_rules
  WHERE categoria NOT IN ('insalubridade', 'periculosidade', 'prevencao', 'previdenciario');
  IF fora > 0 THEN
    RAISE EXCEPTION '0073: % regra(s) em lip_rules com categoria fora das categorias LIP; corrija antes de aplicar', fora;
  END IF;
END;
$$;

-- 1. Tabelas.
ALTER TABLE lip_rules RENAME TO normative_rules;
ALTER TABLE lip_rule_provisions RENAME TO normative_rule_provisions;

-- 2. Constraints (nomes explícitos e implícitos gerados pelo Postgres na 0072). Renomear PK/UNIQUE renomeia o índice junto.
ALTER TABLE normative_rules RENAME CONSTRAINT lip_rules_pkey TO normative_rules_pkey;
ALTER TABLE normative_rules RENAME CONSTRAINT lip_rules_rule_key_key TO normative_rules_rule_key_key;
ALTER TABLE normative_rules RENAME CONSTRAINT lip_rules_metodo_avaliacao_check TO normative_rules_metodo_avaliacao_check;
ALTER TABLE normative_rules RENAME CONSTRAINT lip_rules_status_check TO normative_rules_status_check;
ALTER TABLE normative_rules RENAME CONSTRAINT lip_rules_reviewed_by_user_id_fkey TO normative_rules_reviewed_by_user_id_fkey;
ALTER TABLE normative_rules RENAME CONSTRAINT lip_rules_vigencia TO normative_rules_vigencia;
ALTER TABLE normative_rules RENAME CONSTRAINT lip_rules_revisada_exige_revisor TO normative_rules_revisada_exige_revisor;
ALTER TABLE normative_rule_provisions RENAME CONSTRAINT lip_rule_provisions_pkey TO normative_rule_provisions_pkey;
ALTER TABLE normative_rule_provisions RENAME CONSTRAINT lip_rule_provisions_rule_id_fkey TO normative_rule_provisions_rule_id_fkey;
ALTER TABLE normative_rule_provisions RENAME CONSTRAINT lip_rule_provisions_provision_id_fkey TO normative_rule_provisions_provision_id_fkey;
ALTER TABLE normative_rule_provisions RENAME CONSTRAINT lip_rule_provisions_papel_check TO normative_rule_provisions_papel_check;

-- 3. Índices avulsos.
ALTER INDEX lip_rules_categoria_status_idx RENAME TO normative_rules_categoria_status_idx;
ALTER INDEX lip_rule_provisions_provision_idx RENAME TO normative_rule_provisions_provision_idx;

-- 4. Área + coerência area × categoria. Linhas existentes (se houver) viram 'lip'.
ALTER TABLE normative_rules
  ADD COLUMN area text NOT NULL DEFAULT 'lip' CONSTRAINT normative_rules_area_check CHECK (area IN ('lip', 'gro_pgr'));

-- O DEFAULT só serve para preencher as linhas existentes; regra nova precisa declarar a área explicitamente.
ALTER TABLE normative_rules ALTER COLUMN area DROP DEFAULT;

-- O CHECK antigo (só categorias LIP) é substituído, nesta mesma migration, pelo CHECK de coerência.
ALTER TABLE normative_rules DROP CONSTRAINT lip_rules_categoria_check;
ALTER TABLE normative_rules ADD CONSTRAINT normative_rules_area_categoria_coerente CHECK (
  (area = 'lip' AND categoria IN ('insalubridade', 'periculosidade', 'prevencao', 'previdenciario'))
  OR (area = 'gro_pgr' AND categoria IN ('identificacao_perigos', 'avaliacao_riscos', 'controle_riscos', 'plano_acao', 'inventario', 'revisao', 'excecao', 'psicossocial', 'estrutura_pgr'))
);

-- 5. Trigger. O corpo plpgsql resolve nomes de tabela na EXECUÇÃO: sem trocar o corpo, o trigger passaria a
-- falhar (relation "lip_rule_provisions" does not exist) em todo INSERT/UPDATE de regra. Troca-se o corpo
-- primeiro (ainda com o nome antigo da função) e depois renomeiam-se função e trigger.
CREATE OR REPLACE FUNCTION lip_rules_require_active_provision() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'revisada' AND NOT EXISTS (
    SELECT 1
    FROM normative_rule_provisions rp
    JOIN normative_provisions p ON p.id = rp.provision_id
    WHERE rp.rule_id = NEW.id AND p.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'normative_rules: regra revisada exige ao menos um dispositivo literal ativo vinculado'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION lip_rules_require_active_provision() RENAME TO normative_rules_require_active_provision;
ALTER TRIGGER lip_rules_require_active_provision ON normative_rules RENAME TO normative_rules_require_active_provision;
