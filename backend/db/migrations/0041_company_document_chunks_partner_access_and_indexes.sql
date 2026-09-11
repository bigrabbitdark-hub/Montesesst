-- Achados #2 e #5 da revisão final da Fase 24.
--
-- #2: a policy de RLS de company_document_chunks (0040) foi escrita
-- espelhando a versão de documents da Fase 4 — antes da Fase 6
-- (0011_partner_access.sql) ter estendido documents/inspections/
-- action_plans com um 4º branch pra 'parceiro' via tenant_partners.
-- Sem esse branch aqui, um parceiro consegue fazer upload de um
-- documento (RLS de `documents` permite), mas o INSERT de indexação em
-- company_document_chunks é silenciosamente rejeitado pela RLS —
-- documentos enviados por parceiro nunca ficam indexados, sem erro
-- visível (a falha é engolida por CompanyDocumentIndexerService, ver
-- Finding #4). ALTER POLICY ... USING substitui a expressão inteira,
-- por isso os 3 branches existentes são reafirmados aqui, não só o
-- novo — mesmo padrão já usado em 0011_partner_access.sql.
--
-- Esta é uma migration NOVA (não uma edição de 0040) porque o runner
-- deste projeto (db/migrate.ts) rastreia migrations aplicadas só pelo
-- nome do arquivo, sem checksum — editar 0040 não re-rodaria em nenhum
-- banco onde ela já foi aplicada.
ALTER POLICY company_document_chunks_isolation ON company_document_chunks USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR EXISTS (
    SELECT 1 FROM tenant_technicians tt
    JOIN technicians t ON t.id = tt.technician_id
    WHERE tt.tenant_id = company_document_chunks.tenant_id
      AND t.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'tecnico'
  )
  OR EXISTS (
    SELECT 1 FROM tenant_partners tp
    JOIN partners p ON p.id = tp.partner_id
    WHERE tp.tenant_id = company_document_chunks.tenant_id
      AND p.user_id = NULLIF(current_setting('app.user_id', true), '')::UUID
      AND current_setting('app.role', true) = 'parceiro'
  )
);

-- #5: faltavam índices btree em tenant_id e document_id — a tabela só
-- tinha o índice HNSW do embedding. Sem um índice em tenant_id, o filtro
-- de tenant que toda query desta tabela aplica (via RLS ou explícito)
-- degrada pra seq scan conforme a tabela cresce, mesmo com o HNSW
-- presente (ele indexa o vetor, não o tenant). document_id é alvo de FK
-- ON DELETE CASCADE (documents.id) e não tinha índice nenhum — todo
-- DELETE /documents/:id faz seq scan nesta tabela pra achar os chunks a
-- cascatear.
CREATE INDEX company_document_chunks_tenant_id_idx ON company_document_chunks (tenant_id);
CREATE INDEX company_document_chunks_document_id_idx ON company_document_chunks (document_id);
