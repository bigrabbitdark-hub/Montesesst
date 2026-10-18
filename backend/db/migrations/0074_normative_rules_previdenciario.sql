-- Área 'previdenciario' nas regras interpretativas (docs/superpowers/specs/2026-10-10-base-normativa-previdenciario-design.md §2, decisão 4).
-- Acrescenta a área 'previdenciario' (aposentadoria especial, LTCAT, PPP…) ao CHECK de área e o ramo
-- correspondente ao CHECK de coerência area × categoria. Os ramos 'lip' e 'gro_pgr' ficam EXATAMENTE como na 0073.
-- A 0072 e a 0073 NÃO são editadas. Conhecimento compartilhado entre tenants: SEM tenant_id, SEM RLS.
-- Aditiva: só troca os dois CHECKs (DROP + ADD com o MESMO nome, na mesma transação); nenhum dado é alterado.
-- Só amplia o que é aceito, então toda linha existente continua válida. A coluna `area` não é tocada
-- (continua NOT NULL e sem valor padrão, como a 0073 deixou).
-- 'previdenciario' também é uma CATEGORIA da área 'lip' (desde a 0072); continua sendo, inalterada.
-- Espelhado em backend/src/normative/normative-rule-areas.ts (o teste unitário compara TS × este SQL).
-- Sem BEGIN/COMMIT próprios: db/migrate.ts envolve cada arquivo em transação; com psql, usar
-- --single-transaction -v ON_ERROR_STOP=1. Aplicar como dono da tabela (postgres): com montese_app o ALTER
-- falha com "must be owner". ADD CONSTRAINT valida as linhas existentes sob lock exclusivo (tabela pequena).

-- Guarda: falha cedo, com mensagem clara, se o banco não estiver no estado deixado pela 0073.
DO $$
DECLARE
  def_area text;
BEGIN
  IF to_regclass('public.normative_rules') IS NULL THEN
    RAISE EXCEPTION '0074: normative_rules não existe; aplique a 0073 antes';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO def_area
  FROM pg_constraint
  WHERE conrelid = 'public.normative_rules'::regclass AND conname = 'normative_rules_area_check';
  IF def_area IS NULL THEN
    RAISE EXCEPTION '0074: CHECK normative_rules_area_check não encontrado; o banco não está no estado da 0073';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.normative_rules'::regclass AND conname = 'normative_rules_area_categoria_coerente'
  ) THEN
    RAISE EXCEPTION '0074: CHECK normative_rules_area_categoria_coerente não encontrado; o banco não está no estado da 0073';
  END IF;
  -- Só o CHECK de ÁREA é lido aqui: o de coerência já cita previdenciario como categoria LIP desde a 0073.
  IF def_area LIKE '%previdenciario%' THEN
    RAISE EXCEPTION '0074: a área previdenciario já é aceita (0074 já aplicada?); nada foi alterado';
  END IF;
END;
$$;

-- 1. Área: lip | gro_pgr | previdenciario (mesmo nome de constraint da 0073).
ALTER TABLE normative_rules DROP CONSTRAINT normative_rules_area_check;
ALTER TABLE normative_rules ADD CONSTRAINT normative_rules_area_check CHECK (area IN ('lip', 'gro_pgr', 'previdenciario'));

-- 2. Coerência area × categoria: ramos lip e gro_pgr idênticos aos da 0073 + ramo previdenciario.
ALTER TABLE normative_rules DROP CONSTRAINT normative_rules_area_categoria_coerente;
ALTER TABLE normative_rules ADD CONSTRAINT normative_rules_area_categoria_coerente CHECK (
  (area = 'lip' AND categoria IN ('insalubridade', 'periculosidade', 'prevencao', 'previdenciario'))
  OR (area = 'gro_pgr' AND categoria IN ('identificacao_perigos', 'avaliacao_riscos', 'controle_riscos', 'plano_acao', 'inventario', 'revisao', 'excecao', 'psicossocial', 'estrutura_pgr'))
  OR (area = 'previdenciario' AND categoria IN ('aposentadoria_especial', 'ltcat', 'ppp', 'agentes_nocivos', 'esocial', 'cruzamento_documental', 'exposicao'))
);
