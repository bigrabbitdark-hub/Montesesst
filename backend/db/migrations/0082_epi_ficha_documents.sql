-- Módulo EPI, subsistema 2: documentos emitidos da ficha de controle de EPI + matrícula/setor do funcionário.
-- Aditiva. Ver docs/superpowers/specs/2026-10-14-epi-ficha-pdf-design.md.

-- registration_number JÁ existe (0069, pré-requisitos do eSocial: mesma matrícula do trabalhador; limite de
-- 30 caracteres validado na aplicação), então aqui só se acrescenta department (com limite de tamanho).
ALTER TABLE employees
  ADD COLUMN department TEXT,
  ADD CONSTRAINT chk_employees_department_len CHECK (department IS NULL OR length(department) <= 120);

CREATE TABLE epi_ficha_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  version INT NOT NULL CHECK (version >= 1),
  document_code TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_sha256 TEXT NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_sha256 TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot JSONB NOT NULL,
  term_version TEXT NOT NULL,
  issued_by_user_id UUID NOT NULL REFERENCES users(id),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (tenant_id, employee_id, version),
  UNIQUE (tenant_id, document_code),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX idx_epi_ficha_documents_tenant ON epi_ficha_documents (tenant_id);
CREATE INDEX idx_epi_ficha_documents_employee ON epi_ficha_documents (employee_id, version DESC);

-- Imutabilidade (mesmo padrão da 0081): UPDATE nunca; DELETE direto nunca; a exclusão em cascata de um
-- tenant inteiro roda dentro do trigger de RI (pg_trigger_depth() > 1) e só vale com o tenant já removido
-- (epi_tenant_row_exists, SECURITY DEFINER da 0081, consulta sem RLS).
CREATE FUNCTION epi_ficha_documents_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 AND NOT epi_tenant_row_exists(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'epi_ficha_documents é imutável (emita uma nova versão)' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_epi_ficha_documents_immutable
  BEFORE UPDATE OR DELETE ON epi_ficha_documents
  FOR EACH ROW EXECUTE FUNCTION epi_ficha_documents_immutable();

ALTER TABLE epi_ficha_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE epi_ficha_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY epi_ficha_documents_isolation ON epi_ficha_documents USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

REVOKE TRUNCATE ON epi_ficha_documents FROM montese_app;
