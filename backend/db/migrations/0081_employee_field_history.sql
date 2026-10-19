-- Histórico campo a campo dos dados cadastrais do funcionário. Aditiva: nada existente é alterado.
-- employee_id fica SEM chave estrangeira de propósito: o histórico sobrevive à exclusão do
-- funcionário (rastreabilidade); sai junto só se o tenant inteiro for apagado.
-- actor_user_id também fica SEM FK de propósito, pelo mesmo motivo: um JWT de usuário já apagado
-- não pode derrubar a escrita do funcionário, e o histórico é append-only.
CREATE TABLE employee_field_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  actor_user_id UUID,
  actor_role TEXT,
  source TEXT NOT NULL CHECK (source IN ('cadastro', 'tabela', 'importacao', 'documento', 'revisao')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX employee_field_history_employee_idx
  ON employee_field_history (employee_id, changed_at DESC);

ALTER TABLE employee_field_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_field_history FORCE ROW LEVEL SECURITY;

-- Leitura: admin vê tudo; empresa só o próprio tenant. Técnico/parceiro não leem (spec §3.2).
CREATE POLICY employee_field_history_select ON employee_field_history FOR SELECT USING (
  current_setting('app.role', true) = 'admin'
  OR (
    current_setting('app.role', true) = 'empresa'
    AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
);

-- Escrita: só INSERT, via gatilho. WITH CHECK (true) como no audit_log: um gatilho que falhasse por
-- RLS derrubaria a alteração do funcionário em contextos atípicos; a leitura segue restrita.
CREATE POLICY employee_field_history_insert ON employee_field_history FOR INSERT WITH CHECK (true);

-- Append-only: nem por bug da aplicação a role do backend altera ou apaga o histórico.
REVOKE UPDATE, DELETE, TRUNCATE ON employee_field_history FROM montese_app;

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
    'registration_number', 'cbo_code', 'activity_description', 'company_unit_id', 'status'
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

CREATE TRIGGER trg_employees_field_history
  AFTER INSERT OR UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION employee_field_history_capture();
