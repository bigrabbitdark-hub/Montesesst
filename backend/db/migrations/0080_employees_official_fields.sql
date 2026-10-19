-- Campos do modelo oficial Montese SST (planilha "Cadastro Funcionários - Laudos e eSocial").
-- DEPENDE DA 0069 (0069_esocial_prerequisite_columns.sql), que criou employees.registration_number.
--
-- Matrícula: employees.registration_number (já em produção desde a 0069, compartilhada com o eSocial e a
-- ficha de EPI) é a ÚNICA matrícula do funcionário. Esta migration NÃO cria outra coluna; só acrescenta
-- regra de formato e unicidade sobre ela, sem quebrar dados existentes (que não puderam ser consultados):
--   * CHECK de formato como NOT VALID: não valida as linhas antigas, vale para novas escritas. ATENÇÃO: no
--     Postgres uma CHECK NOT VALID é avaliada em TODO INSERT e em TODO UPDATE da linha (mesmo que o UPDATE
--     não mexa na matrícula). Por isso ela só é criada se nenhuma linha atual violar o formato; se houver
--     linhas fora do formato, a CHECK NÃO é criada (RAISE NOTICE com a contagem) e o formato fica garantido
--     só pela aplicação (DTOs + normalizeEmployeeInput) até o dono corrigir os dados e criar a CHECK.
--   * Índice único parcial (tenant_id, registration_number): só é criado se NÃO houver matrículas repetidas
--     no mesmo tenant. Se houver, o índice NÃO é criado (RAISE NOTICE com a contagem) e a unicidade passa a
--     ser garantida só pelo código (EmployeesService.assertRegistrationNumberAvailable, sem trava: duas
--     gravações simultâneas ainda podem passar) até o dono limpar os dados e criar o índice.
--   Para conferir depois: SELECT conname FROM pg_constraint WHERE conname = 'employees_registration_number_format_check';
--                         SELECT indexname FROM pg_indexes WHERE indexname = 'employees_tenant_registration_number_uidx';
--
-- RLS: employees tem FORCE RLS e o migrate.ts roda como montese_app SEM app.role/app.tenant_id; sem
-- contexto, os SELECTs de conferência abaixo enxergariam ZERO linhas (guarda cega). Por isso o bloco DO
-- faz set_config('app.role', 'admin', true): a policy employees_isolation (0001) libera tudo com
-- current_setting('app.role', true) = 'admin'. É local à transação desta migration (some no COMMIT).
-- lock_timeout local: se a tabela estiver ocupada, a migration falha em 5 s (rollback) em vez de travar o app.
--
-- Demais colunas: aditivas, nascem NULL. CBO fica como texto (zeros à esquerda). Constraints idempotentes.
--
-- ROLLBACK (manual, nesta ordem; apaga os dados de sexo/CBO/atividade gravados depois da migration):
--   DROP INDEX IF EXISTS employees_tenant_registration_number_uidx;
--   ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_registration_number_format_check,
--                         DROP CONSTRAINT IF EXISTS employees_sex_check,
--                         DROP CONSTRAINT IF EXISTS employees_cbo_code_check;
--   ALTER TABLE employees DROP COLUMN IF EXISTS sex, DROP COLUMN IF EXISTS cbo_code,
--                         DROP COLUMN IF EXISTS activity_description;
--   DELETE FROM _migrations WHERE name = '0080_employees_official_fields.sql';
--   (registration_number NÃO é removida: pertence à 0069. A 0081 usa sex/cbo_code/activity_description no
--    gatilho de histórico; desfazer a 0081 antes desta.)
SET LOCAL lock_timeout = '5s';

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS sex CHAR(1),
  ADD COLUMN IF NOT EXISTS cbo_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS activity_description TEXT;

DO $$
DECLARE
  bad_format BIGINT;
  dup_groups BIGINT;
BEGIN
  -- Ver o cabeçalho: sem isto a RLS esconde todas as linhas do montese_app e as contagens dariam 0.
  PERFORM set_config('app.role', 'admin', true);

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_sex_check' AND conrelid = 'employees'::regclass) THEN
    ALTER TABLE employees ADD CONSTRAINT employees_sex_check CHECK (sex IS NULL OR sex IN ('F', 'M'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_cbo_code_check' AND conrelid = 'employees'::regclass) THEN
    ALTER TABLE employees ADD CONSTRAINT employees_cbo_code_check CHECK (cbo_code IS NULL OR cbo_code ~ '^[0-9]{6}$');
  END IF;

  SELECT count(*) INTO bad_format
    FROM employees
   WHERE registration_number IS NOT NULL AND registration_number !~ '^[A-Za-z0-9._-]{1,30}$';
  IF bad_format > 0 THEN
    RAISE NOTICE '0080: % funcionário(s) com matrícula fora do formato; CHECK employees_registration_number_format_check NÃO criada (formato garantido só pela aplicação).', bad_format;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_registration_number_format_check' AND conrelid = 'employees'::regclass) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_registration_number_format_check
      CHECK (registration_number IS NULL OR registration_number ~ '^[A-Za-z0-9._-]{1,30}$') NOT VALID;
  END IF;

  SELECT count(*) INTO dup_groups FROM (
    SELECT 1 FROM employees
     WHERE registration_number IS NOT NULL
     GROUP BY tenant_id, registration_number
    HAVING count(*) > 1
  ) d;
  IF dup_groups > 0 THEN
    RAISE NOTICE '0080: % matrícula(s) repetida(s) no mesmo tenant; índice employees_tenant_registration_number_uidx NÃO criado (unicidade garantida só pelo código).', dup_groups;
  ELSE
    -- CREATE INDEX normal (não CONCURRENTLY): a migration roda dentro de transação.
    CREATE UNIQUE INDEX IF NOT EXISTS employees_tenant_registration_number_uidx
      ON employees (tenant_id, registration_number)
      WHERE registration_number IS NOT NULL;
  END IF;
END $$;
