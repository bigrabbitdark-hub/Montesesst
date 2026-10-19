-- Histórico por campo do funcionário passa a registrar o SETOR (employees.department, criado na
-- 0082_epi_ficha_documents). Depende da 0081_employee_field_history (função/gatilho) e da 0082_epi_ficha_documents.
--
-- Aditiva e idempotente: só substitui o CORPO da função do gatilho (CREATE OR REPLACE), acrescentando
-- 'department' à lista de campos. O gatilho trg_employees_field_history (0081) continua o mesmo e passa a usar a
-- nova versão. Nenhum dado é lido, alterado ou copiado (não há backfill: mudanças de setor anteriores a esta
-- migration não aparecem no histórico). Por isso não é preciso contexto de RLS (app.role) aqui.
-- lock_timeout local: se a função estiver em uso por uma transação longa, falha em 5 s em vez de travar o app.
--
-- ROLLBACK (manual): reexecutar o CREATE OR REPLACE FUNCTION da 0081 (mesmo corpo, sem 'department') e
--   DELETE FROM _migrations WHERE name = '0085_employee_history_department.sql';
--   As linhas de histórico com field = 'department' já gravadas permanecem (histórico é append-only; a tabela
--   revoga UPDATE/DELETE do montese_app). A tela mostra o rótulo "Setor" para elas.
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION employee_field_history_capture() RETURNS trigger AS $$
DECLARE
  f TEXT;
  o TEXT;
  n TEXT;
  old_j JSONB := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  new_j JSONB := to_jsonb(NEW);
  src TEXT := COALESCE(NULLIF(current_setting('app.change_source', true), ''), 'cadastro');
  uid UUID := NULLIF(current_setting('app.user_id', true), '')::uuid;
  rl TEXT := NULLIF(current_setting('app.role', true), '');
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'full_name', 'cpf', 'birth_date', 'sex', 'position', 'admission_date',
    'registration_number', 'cbo_code', 'activity_description', 'company_unit_id', 'status',
    'department'
  ] LOOP
    o := old_j ->> f;
    n := new_j ->> f;
    IF o IS DISTINCT FROM n THEN
      IF f = 'cpf' THEN
        o := CASE WHEN o IS NULL THEN NULL ELSE '***.***.***-' || right(o, 2) END;
        n := CASE WHEN n IS NULL THEN NULL ELSE '***.***.***-' || right(n, 2) END;
      END IF;
      INSERT INTO employee_field_history
        (tenant_id, employee_id, field, old_value, new_value, actor_user_id, actor_role, source)
      VALUES (NEW.tenant_id, NEW.id, f, o, n, uid, rl, src);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;
