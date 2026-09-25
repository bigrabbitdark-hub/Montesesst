-- Fase A — Etapa 2 (docs/specs/assistente-evolucao-etapa-2.md): garante
-- unicidade do `code` em official_sources para que o seed consiga usar
-- ON CONFLICT (code) idempotentemente. Antes desta migration a coluna
-- `code` permitia duplicatas; era só uma etiqueta lógica.
--
-- A verificação é feita uma vez:
--   SELECT code, COUNT(*) FROM official_sources GROUP BY code HAVING COUNT(*) > 1;
-- Como a tabela está vazia no momento desta migration (a seed ainda vai
-- rodar), o índice UNIQUE é seguro. Caso um ambiente já tenha duplicatas
-- (improvável — ninguém cria official_sources em produção sem passar pelo
-- endpoint oficial), o usuário deve rodar a limpeza antes de aplicar.
DO $$
BEGIN
  -- Defesa em profundidade: se houver duplicatas (não deve), a constraint
  -- UNIQUE abaixo falharia com erro confuso ("could not create unique
  -- constraint"). Detectamos isso antes e falhamos com mensagem clara,
  -- preservando os dados para análise manual.
  IF EXISTS (
    SELECT 1 FROM official_sources
    WHERE code IS NOT NULL
    GROUP BY code
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'official_sources tem code duplicado antes da migration 0052. Resolva manualmente antes de aplicar: SELECT code, COUNT(*) FROM official_sources GROUP BY code HAVING COUNT(*) > 1;';
  END IF;
END $$;

ALTER TABLE official_sources
  ADD CONSTRAINT official_sources_code_unique UNIQUE (code);
