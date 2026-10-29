-- Painel de Atuação, D2 Task 1: estados de espera em tasks.status. Aditiva: só amplia o CHECK de
-- tasks.status (6 atuais + 'awaiting_client', 'awaiting_execution', 'awaiting_efficacy'). Nenhum dado é
-- lido, alterado ou copiado. RLS, policies, GRANTs, índices e triggers de tasks/task_events permanecem
-- iguais: tasks_due_idx (WHERE status NOT IN ('completed','cancelled')) já cobre os novos como abertos;
-- task_events.type não muda e from_value/to_value são TEXT livre (aceitam os novos valores);
-- tasks_assignee_idx indexa status sem lista. Não há view nem função que enumere os status.
-- Depende da 0093. Rótulos pt-BR são do frontend; valores técnicos em inglês.
--
-- ROLLBACK (manual, sem perder tarefas; ordem importa):
--   BEGIN;
--   UPDATE tasks SET status = 'blocked' WHERE status IN ('awaiting_client', 'awaiting_execution', 'awaiting_efficacy');
--   ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
--   ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('pending','in_progress','blocked','awaiting_review','completed','cancelled'));
--   DELETE FROM _migrations WHERE name = '0100_tarefas_status_espera.sql';
--   COMMIT;
--   As tarefas em espera viram 'blocked' (continuam abertas, mesma semântica de "parada"); o UPDATE dispara
--   trg_tasks_updated_at (updated_at muda) e exige app.role = 'admin' ou superusuário (policies de tasks).
--   task_events é append-only e não é tocado: eventos status_changed com to_value/from_value dos novos
--   status permanecem como texto histórico (não há CHECK sobre esses valores) e o histórico não registra a
--   conversão para 'blocked'. Se for preciso, anotar a conversão fora do banco.
SET LOCAL lock_timeout = '5s';

ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN (
  'pending','in_progress','blocked','awaiting_review','completed','cancelled',
  'awaiting_client','awaiting_execution','awaiting_efficacy'
));

-- Privilégios: inalterados (ALTER CONSTRAINT não altera GRANTs); reafirmados de forma idempotente e guardada.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'montese_app') THEN
    GRANT SELECT, INSERT, UPDATE ON tasks TO montese_app;
  END IF;
END $$;
