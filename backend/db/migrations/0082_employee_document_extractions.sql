-- 1) Categoria nova de documento. A CHECK vigente é LIDA e só ganha o valor novo: produção tem migrations
--    (0065–0079) que mexem em categorias e que este arquivo não conhece; reescrever a lista de memória
--    poderia bloquear categorias existentes. Se o formato da CHECK não for o esperado, a migration aborta
--    inteira (nada é alterado).
DO $$
DECLARE
  def TEXT;
  new_def TEXT;
  old_items TEXT[];
  new_items TEXT[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conname = 'documents_category_check' AND conrelid = 'documents'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'documents_category_check não encontrada';
  END IF;
  IF position('''cadastro_funcionarios''' in def) > 0 THEN
    RETURN;
  END IF;
  -- Formato estrito: uma única lista ARRAY[...] e nada além da comparação category = ANY (...).
  IF def !~ '^CHECK \(\(category = ANY \(\(?ARRAY\[[^\]]*\](\)::text\[\])?\)\)\)( NOT VALID)?$'
     OR array_length(regexp_split_to_array(def, 'ARRAY\['), 1) <> 2 THEN
    RAISE EXCEPTION 'formato inesperado da CHECK de categorias: %', def;
  END IF;
  SELECT array_agg(m[1]) INTO old_items FROM regexp_matches(def, '''([^'']+)''', 'g') AS m;
  -- Sem flag 'g': só o primeiro ']' (fim da lista, garantido pela âncora acima) é substituído.
  new_def := regexp_replace(def, '\]', ', ''cadastro_funcionarios''::text]');
  EXECUTE format('ALTER TABLE documents DROP CONSTRAINT documents_category_check, ADD CONSTRAINT documents_category_check %s', new_def);

  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conname = 'documents_category_check' AND conrelid = 'documents'::regclass;
  SELECT array_agg(m[1]) INTO new_items FROM regexp_matches(def, '''([^'']+)''', 'g') AS m;
  IF NOT (old_items <@ new_items) OR NOT ('cadastro_funcionarios' = ANY (new_items)) THEN
    RAISE EXCEPTION 'a nova CHECK de categorias perdeu itens ou não recebeu o novo: %', def;
  END IF;
END $$;

-- 2) Extrações de documentos cadastrais (spec §4). Valores brutos de novos/conflitos ficam em `candidates`
--    só até a resolução; itens inválidos guardam apenas linha e motivo.
CREATE TABLE employee_document_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processando', 'aplicado', 'requer_revisao', 'sem_dados', 'ilegivel', 'erro')),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- created_by/resolved_by sem FK (como na 0081): usuário apagado não pode quebrar a escrita; a trilha é histórica.
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  UNIQUE (tenant_id, document_id, content_hash)
);

CREATE INDEX employee_document_extractions_tenant_status_idx
  ON employee_document_extractions (tenant_id, status, created_at DESC);

ALTER TABLE employee_document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_document_extractions FORCE ROW LEVEL SECURITY;

-- Só empresa dona e admin enxergam/alteram; técnico e parceiro não.
CREATE POLICY employee_document_extractions_access ON employee_document_extractions
  USING (
    current_setting('app.role', true) = 'admin'
    OR (
      current_setting('app.role', true) = 'empresa'
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.role', true) = 'admin'
    OR (
      current_setting('app.role', true) = 'empresa'
      AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );

-- Sem DELETE para a aplicação (rastreabilidade); some junto com o documento/tenant por cascata.
REVOKE DELETE, TRUNCATE ON employee_document_extractions FROM montese_app;
