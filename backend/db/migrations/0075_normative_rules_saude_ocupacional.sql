-- Área 'saude_ocupacional' nas regras interpretativas (docs/superpowers/specs/2026-10-10-base-normativa-saude-ocupacional-design.md §2, decisão 1).
-- Acrescenta a área 'saude_ocupacional' (PCMSO, exames ocupacionais, ASO, relatório analítico, LGPD…) ao CHECK de
-- área e o ramo correspondente ao CHECK de coerência area × categoria. Os ramos 'lip', 'gro_pgr' e 'previdenciario'
-- ficam EXATAMENTE como na 0074. A 0072, a 0073 e a 0074 NÃO são editadas. Conhecimento compartilhado entre
-- tenants: SEM tenant_id, SEM RLS.
-- Aditiva: só troca os dois CHECKs (DROP + ADD com o MESMO nome, na mesma transação); nenhum dado é alterado.
-- Só amplia o que é aceito, então toda linha existente continua válida. A coluna `area` não é tocada
-- (continua NOT NULL e sem valor padrão, como a 0073 deixou).
-- 'excecao' já é categoria da área gro_pgr (0073) e passa a ser também da área saude_ocupacional (ramo próprio);
-- as outras 6 categorias de saúde só existem nesta área. 'saude_ocupacional' não é categoria de nenhuma área.
-- Espelhado em backend/src/normative/normative-rule-areas.ts (o teste unitário compara TS × este SQL).
-- Sem BEGIN/COMMIT próprios: db/migrate.ts envolve cada arquivo em transação; com psql, usar
-- --single-transaction -v ON_ERROR_STOP=1. Aplicar como dono da tabela (postgres): com montese_app o ALTER
-- falha com "must be owner". ADD CONSTRAINT valida as linhas existentes sob lock exclusivo (tabela pequena).

-- Guarda: falha cedo, com mensagem clara, se o banco não estiver no estado deixado pela 0074.
DO $$
DECLARE
  def_area text;
BEGIN
  IF to_regclass('public.normative_rules') IS NULL THEN
    RAISE EXCEPTION '0075: normative_rules não existe; aplique a 0073 e a 0074 antes';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO def_area
  FROM pg_constraint
  WHERE conrelid = 'public.normative_rules'::regclass AND conname = 'normative_rules_area_check';
  IF def_area IS NULL THEN
    RAISE EXCEPTION '0075: CHECK normative_rules_area_check não encontrado; o banco não está no estado da 0074';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.normative_rules'::regclass AND conname = 'normative_rules_area_categoria_coerente'
  ) THEN
    RAISE EXCEPTION '0075: CHECK normative_rules_area_categoria_coerente não encontrado; o banco não está no estado da 0074';
  END IF;
  -- Só o CHECK de ÁREA é lido aqui: o de coerência cita previdenciario como categoria LIP desde a 0073.
  IF def_area NOT LIKE '%previdenciario%' THEN
    RAISE EXCEPTION '0075: a área previdenciario ainda não é aceita; aplique a 0074 antes';
  END IF;
  IF def_area LIKE '%saude_ocupacional%' THEN
    RAISE EXCEPTION '0075: a área saude_ocupacional já é aceita (0075 já aplicada?); nada foi alterado';
  END IF;
END;
$$;

-- 1. Área: lip | gro_pgr | previdenciario | saude_ocupacional (mesmo nome de constraint da 0073/0074).
ALTER TABLE normative_rules DROP CONSTRAINT normative_rules_area_check;
ALTER TABLE normative_rules ADD CONSTRAINT normative_rules_area_check CHECK (area IN ('lip', 'gro_pgr', 'previdenciario', 'saude_ocupacional'));

-- 2. Coerência area × categoria: ramos lip, gro_pgr e previdenciario idênticos aos da 0074 + ramo saude_ocupacional.
ALTER TABLE normative_rules DROP CONSTRAINT normative_rules_area_categoria_coerente;
ALTER TABLE normative_rules ADD CONSTRAINT normative_rules_area_categoria_coerente CHECK (
  (area = 'lip' AND categoria IN ('insalubridade', 'periculosidade', 'prevencao', 'previdenciario'))
  OR (area = 'gro_pgr' AND categoria IN ('identificacao_perigos', 'avaliacao_riscos', 'controle_riscos', 'plano_acao', 'inventario', 'revisao', 'excecao', 'psicossocial', 'estrutura_pgr'))
  OR (area = 'previdenciario' AND categoria IN ('aposentadoria_especial', 'ltcat', 'ppp', 'agentes_nocivos', 'esocial', 'cruzamento_documental', 'exposicao'))
  OR (area = 'saude_ocupacional' AND categoria IN ('pcmso', 'exames_ocupacionais', 'aso', 'relatorio_analitico', 'excecao', 'privacidade_dados', 'cruzamento_documental_saude'))
);
