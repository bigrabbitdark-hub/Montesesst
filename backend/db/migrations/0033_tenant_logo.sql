-- Fase 19 — Logo da empresa no menu: coluna nova em `tenants`, mesmo
-- padrão de toda coluna simples já adicionada nessa tabela (ver
-- 0018_tenants_full_address.sql). Nullable, sem valor padrão — nem
-- toda empresa vai subir uma logo. Sem tabela nova, sem índice, sem
-- RLS própria (tenants já não tem RLS hoje).
ALTER TABLE tenants ADD COLUMN logo_file_key TEXT;
