-- ITEM 005 (auditoria técnica pré-produção 2026-09-27): `documents` é a
-- tabela mais usada do sistema (30+ arquivos em backend/src a referenciam)
-- e nunca recebeu nenhum índice em nenhuma das 52 migrations anteriores —
-- toda listagem por tenant e toda checagem de "documento vencendo"
-- (dashboard/overview) fazia sequential scan na tabela inteira.
CREATE INDEX documents_tenant_id_idx ON documents (tenant_id);
CREATE INDEX documents_expires_at_idx ON documents (expires_at) WHERE expires_at IS NOT NULL;
