-- Fase 6 (sub-projeto B — Acesso do técnico parceiro): amplia o CHECK de
-- uploaded_by_role pra aceitar 'parceiro', que hoje só aceita
-- 'empresa'/'tecnico' (0008_documents.sql). Sem migração de dado — nenhuma
-- linha existente podia ter uploaded_by_role='parceiro' antes desta
-- constraint existir. Ver docs/specs/fase-6-acesso-parceiro.md.

ALTER TABLE documents DROP CONSTRAINT documents_uploaded_by_role_check;
ALTER TABLE documents ADD CONSTRAINT documents_uploaded_by_role_check
  CHECK (uploaded_by_role IN ('empresa', 'tecnico', 'parceiro'));
