-- Fase 14: corrige um achado da revisão final — ON DELETE SET NULL na FK de
-- employee_id fazia um UPDATE na linha filha ao apagar o funcionário, e o
-- CHECK chk_candidate_source (exige exatamente um de employee_id/nome_livre
-- não-nulo) é avaliado em UPDATE também: a linha virava (NULL, NULL) e
-- violava o CHECK (23514), deixando o funcionário travado (impossível de
-- apagar, pra sempre — não existe rota de apagar candidato). Troca pra
-- RESTRICT: só é possível apagar um funcionário que nunca foi candidato em
-- nenhuma eleição da CIPA. Mesmo padrão de
-- 0014_epi_delivery_delete_restrict.sql.
ALTER TABLE cipa_election_candidates
  DROP CONSTRAINT cipa_election_candidates_employee_id_fkey;

ALTER TABLE cipa_election_candidates
  ADD CONSTRAINT cipa_election_candidates_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;
