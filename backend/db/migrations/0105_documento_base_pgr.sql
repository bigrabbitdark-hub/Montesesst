-- Painel dos sócios, E5a: vínculo opcional entre LTCAT / LIP / laudo e o PGR-base da mesma empresa.
-- Aditivo: coluna nula por padrão; nada muda para rascunhos existentes. O vínculo é só informativo (avisos), não herda datas.
-- Depende da 0096 (document_drafts) e das 0102–0104 na ordem de release.
--
-- ROLLBACK (manual, só com autorização; perde os vínculos informados):
--   BEGIN;
--   DROP TRIGGER trg_c_document_drafts_base_guard ON document_drafts; DROP FUNCTION document_drafts_base_guard();
--   ALTER TABLE document_drafts DROP COLUMN base_draft_id;
--   DELETE FROM _migrations WHERE name = '0105_documento_base_pgr.sql';
--   COMMIT;
SET LOCAL lock_timeout = '5s';

ALTER TABLE document_drafts ADD COLUMN base_draft_id UUID REFERENCES document_drafts(id) ON DELETE SET NULL;
CREATE INDEX document_drafts_base_idx ON document_drafts (base_draft_id) WHERE base_draft_id IS NOT NULL;
COMMENT ON COLUMN document_drafts.base_draft_id IS 'PGR-base (mesma empresa) do qual este LTCAT/LIP/laudo deriva. Informativo: só gera avisos.';

-- A FK ignora RLS; a coerência de empresa e categoria fica na trigger (vale para todos os papéis).
CREATE FUNCTION document_drafts_base_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  b_cat TEXT; b_tenant UUID; b_status TEXT;
BEGIN
  IF NEW.base_draft_id IS NULL THEN
    -- Limpar o vínculo fora da elaboração só vale como efeito da FK (PGR-base já apagado), nunca por ação do usuário.
    IF TG_OP = 'UPDATE' AND OLD.base_draft_id IS NOT NULL AND OLD.status <> 'em_elaboracao'
       AND EXISTS (SELECT 1 FROM document_drafts b WHERE b.id = OLD.base_draft_id) THEN
      RAISE EXCEPTION 'document_drafts: o PGR-base só muda com o documento em elaboração';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.base_draft_id IS NOT DISTINCT FROM OLD.base_draft_id THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'em_elaboracao' THEN
    RAISE EXCEPTION 'document_drafts: o PGR-base só muda com o documento em elaboração';
  END IF;
  IF NEW.category NOT IN ('ltcat', 'lip', 'laudo') THEN
    RAISE EXCEPTION 'document_drafts: só LTCAT, LIP e laudo têm PGR-base';
  END IF;
  IF NEW.base_draft_id = NEW.id THEN
    RAISE EXCEPTION 'document_drafts: o documento não pode ser base de si mesmo';
  END IF;
  SELECT category, tenant_id, status INTO b_cat, b_tenant, b_status FROM document_drafts WHERE id = NEW.base_draft_id;
  IF NOT FOUND OR b_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'document_drafts: PGR-base inexistente ou de outra empresa';
  END IF;
  IF b_cat <> 'pgr' THEN
    RAISE EXCEPTION 'document_drafts: a base precisa ser um PGR';
  END IF;
  IF b_status = 'cancelado' THEN
    RAISE EXCEPTION 'document_drafts: o PGR-base está cancelado';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_c_document_drafts_base_guard BEFORE INSERT OR UPDATE OF base_draft_id ON document_drafts
  FOR EACH ROW EXECUTE FUNCTION document_drafts_base_guard();
