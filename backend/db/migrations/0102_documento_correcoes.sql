-- Painel dos sócios, E2: correções estruturadas de documentos ("Devolver para correção").
-- Cada correção registra o que corrigir, quem solicitou (revisão interna, cliente ou interna), responsável (sócio ativo),
-- prazo e situação: aberta -> corrigida -> verificada (conferência antes de encerrar), ou cancelada. Nunca se apaga:
-- o histórico é o próprio registro. Aprovar, assinar e publicar ficam bloqueados (no serviço) enquanto houver correção
-- aberta ou corrigida e ainda não verificada.
-- Depende da 0096 (document_drafts, document_draft_versions), da 0093 (list_socios) e da 0098 (pgr_guard_immutable_tenant).
--
-- ROLLBACK (manual, só com autorização; destrutivo para as correções registradas):
--   BEGIN; DROP TRIGGER trg_0_document_drafts_block_pending_corrections ON document_drafts; DROP FUNCTION document_drafts_block_pending_corrections();
--   DROP TABLE document_corrections; DROP FUNCTION document_corrections_guard();
--   DELETE FROM _migrations WHERE name = '0102_documento_correcoes.sql'; COMMIT;
SET LOCAL lock_timeout = '5s';

CREATE TABLE document_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES document_drafts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_id UUID REFERENCES document_draft_versions(id),
  description TEXT NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 1000),
  origin TEXT NOT NULL CHECK (origin IN ('revisao', 'cliente', 'interna')),
  requester_label TEXT CHECK (requester_label IS NULL OR length(requester_label) <= 120), -- quem pediu, quando for o cliente
  requested_by UUID NOT NULL REFERENCES users(id),
  responsible_user_id UUID NOT NULL REFERENCES users(id),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'corrigida', 'verificada', 'cancelada')),
  corrected_by UUID REFERENCES users(id),
  corrected_at TIMESTAMPTZ,
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES users(id),     -- preenchido pelo guard (quem cancelou), não pelo serviço
  cancelled_at TIMESTAMPTZ,
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(resolution_note) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT document_corrections_corrected_chk CHECK ((corrected_by IS NULL) = (corrected_at IS NULL)),
  CONSTRAINT document_corrections_verified_chk CHECK ((verified_by IS NULL) = (verified_at IS NULL)),
  CONSTRAINT document_corrections_verified_status_chk CHECK ((status = 'verificada') = (verified_by IS NOT NULL))
);
CREATE INDEX document_corrections_draft_idx ON document_corrections (draft_id, created_at);
CREATE INDEX document_corrections_open_idx ON document_corrections (tenant_id, due_date) WHERE status IN ('aberta', 'corrigida');
CREATE INDEX document_corrections_responsible_idx ON document_corrections (responsible_user_id) WHERE status IN ('aberta', 'corrigida');

ALTER TABLE document_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_corrections FORCE ROW LEVEL SECURITY;

CREATE POLICY doc_corrections_admin_select ON document_corrections FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY doc_corrections_socio_select ON document_corrections FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY doc_corrections_socio_insert ON document_corrections FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND requested_by = NULLIF(current_setting('app.user_id', true), '')::uuid
              AND status = 'aberta');
CREATE POLICY doc_corrections_socio_update ON document_corrections FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
-- Sem policy de DELETE: correções não se apagam.

-- Guardas: coerência no INSERT (rascunho do mesmo tenant, versão do rascunho, responsável = sócio ativo, rascunho não
-- terminal) e no UPDATE (campos de origem imutáveis; só as transições previstas; carimbos de autoria consistentes).
CREATE FUNCTION document_corrections_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  d_status TEXT;
  uid UUID := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO d_status FROM document_drafts WHERE id = NEW.draft_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'document_corrections: rascunho inexistente ou de outro tenant';
    END IF;
    IF d_status IN ('publicado', 'cancelado') THEN
      RAISE EXCEPTION 'document_corrections: documento publicado ou cancelado não aceita correção';
    END IF;
    IF NEW.version_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM document_draft_versions v WHERE v.id = NEW.version_id AND v.draft_id = NEW.draft_id) THEN
      RAISE EXCEPTION 'document_corrections: version_id não pertence ao rascunho';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM list_socios() s WHERE s.id = NEW.responsible_user_id) THEN
      RAISE EXCEPTION 'document_corrections: o responsável precisa ser sócio ativo';
    END IF;
    IF NEW.origin = 'cliente' AND NEW.requester_label IS NULL THEN
      RAISE EXCEPTION 'document_corrections: informe quem do cliente solicitou';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.draft_id IS DISTINCT FROM OLD.draft_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.version_id IS DISTINCT FROM OLD.version_id OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.origin IS DISTINCT FROM OLD.origin OR NEW.requester_label IS DISTINCT FROM OLD.requester_label
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'document_corrections: campos de origem são imutáveis';
  END IF;
  IF OLD.status IN ('verificada', 'cancelada') THEN
    RAISE EXCEPTION 'document_corrections: correção encerrada não pode ser alterada';
  END IF;
  IF NEW.responsible_user_id IS DISTINCT FROM OLD.responsible_user_id
     AND NOT EXISTS (SELECT 1 FROM list_socios() s WHERE s.id = NEW.responsible_user_id) THEN
    RAISE EXCEPTION 'document_corrections: o responsável precisa ser sócio ativo';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'aberta'    AND NEW.status IN ('corrigida', 'cancelada'))
         OR (OLD.status = 'corrigida' AND NEW.status IN ('verificada', 'aberta', 'cancelada'))) THEN
      RAISE EXCEPTION 'document_corrections: transição inválida (% -> %)', OLD.status, NEW.status;
    END IF;
    IF NEW.status = 'corrigida' AND (NEW.corrected_by IS DISTINCT FROM uid OR NEW.corrected_at IS NULL) THEN
      RAISE EXCEPTION 'document_corrections: a autoria da correção deve ser a de quem a registra';
    END IF;
    IF NEW.status = 'verificada' AND NEW.verified_by IS DISTINCT FROM uid THEN
      RAISE EXCEPTION 'document_corrections: a autoria da verificação deve ser a de quem a registra';
    END IF;
    IF NEW.status = 'cancelada' THEN
      NEW.cancelled_by := uid; NEW.cancelled_at := clock_timestamp();
    END IF;
    IF NEW.status = 'aberta' THEN  -- reaberta na conferência: limpa os carimbos de correção
      NEW.corrected_by := NULL; NEW.corrected_at := NULL;
    END IF;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_a_document_corrections_guard BEFORE INSERT OR UPDATE ON document_corrections
  FOR EACH ROW EXECUTE FUNCTION document_corrections_guard();

-- Trava no banco (defesa em profundidade): rascunho com correção aberta/corrigida não avança para aprovado, assinado
-- nem publicado, mesmo que um caminho novo esqueça a checagem do serviço.
CREATE FUNCTION document_drafts_block_pending_corrections() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('aprovado', 'assinado', 'publicado')
     AND EXISTS (SELECT 1 FROM document_corrections c WHERE c.draft_id = NEW.id AND c.status IN ('aberta', 'corrigida')) THEN
    RAISE EXCEPTION 'document_drafts: há correções pendentes';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_0_document_drafts_block_pending_corrections BEFORE UPDATE OF status ON document_drafts
  FOR EACH ROW EXECUTE FUNCTION document_drafts_block_pending_corrections();

-- Privilégios da role da aplicação (sem DELETE). Guardado: a role pode não existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'montese_app') THEN
    GRANT SELECT, INSERT, UPDATE ON document_corrections TO montese_app;
  END IF;
END $$;
