-- TTL dos candidatos pendentes: o status 'expirado' marca extrações que ficaram em 'requer_revisao' além do prazo.
-- Só a tabela desta feature (0082) é alterada. O nome da CHECK é lido do catálogo (a 0082 não a nomeou).
DO $$
DECLARE
  cname TEXT;
BEGIN
  FOR cname IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'employee_document_extractions'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE employee_document_extractions DROP CONSTRAINT %I', cname);
  END LOOP;
  ALTER TABLE employee_document_extractions
    ADD CONSTRAINT employee_document_extractions_status_check
    CHECK (status IN ('processando', 'aplicado', 'requer_revisao', 'sem_dados', 'ilegivel', 'erro', 'expirado'));
END $$;
