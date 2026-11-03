-- Painel dos sócios, E3a: checklists por serviço com aprovação técnica.
-- Modelos GLOBAIS e versionados (nascem VAZIOS; o conteúdo é cadastrado e aprovado pela engenheira, nunca semeado aqui):
--   checklist_templates -> checklist_template_versions (rascunho -> aprovado -> substituido) -> checklist_template_items.
-- Versão aprovada é imutável (itens e cabeçalho). Só versão aprovada pode ser instanciada.
-- Instâncias POR DOCUMENTO (rascunho do fluxo 0096), isoladas por tenant/carteira Montese:
--   document_checklists -> document_checklist_answers (valor validado pelo tipo do item).
-- Permissões novas (lista fechada do sócio): checklists.read, checklists.write, checklists.approve.
-- Depende da 0096 (document_drafts), da 0098 (CHECK de socio_permissions) e da 0101 (is_montese_tenant).
--
-- ROLLBACK (manual, só com autorização; destrutivo para modelos e respostas):
--   BEGIN;
--   DELETE FROM socio_permissions WHERE permission LIKE 'checklists.%';
--   ALTER TABLE socio_permissions DROP CONSTRAINT socio_permissions_permission_check;
--   ALTER TABLE socio_permissions ADD CONSTRAINT socio_permissions_permission_check CHECK (permission IN (
--     'clients.read','clients.update_operational','tasks.read','tasks.write','appointments.manage',
--     'documents.create_draft','documents.review','documents.sign','documents.read','documents.approve',
--     'documents.publish','documents.cancel','documents.view_registration','finance.read',
--     'empresas.read','empresas.documentos','pgr.read','pgr.write'));
--   DROP TABLE document_checklist_answers, document_checklists, checklist_template_items,
--     checklist_template_versions, checklist_templates;
--   DROP FUNCTION checklist_versions_guard(), checklist_items_guard(), document_checklists_guard(), checklist_answers_guard();
--   DELETE FROM _migrations WHERE name = '0103_checklists.sql';
--   COMMIT;
SET LOCAL lock_timeout = '5s';

ALTER TABLE socio_permissions DROP CONSTRAINT IF EXISTS socio_permissions_permission_check;
ALTER TABLE socio_permissions ADD CONSTRAINT socio_permissions_permission_check CHECK (permission IN (
  'clients.read','clients.update_operational','tasks.read','tasks.write','appointments.manage',
  'documents.create_draft','documents.review','documents.sign','documents.read','documents.approve',
  'documents.publish','documents.cancel','documents.view_registration','finance.read',
  'empresas.read','empresas.documentos','pgr.read','pgr.write',
  'checklists.read','checklists.write','checklists.approve'));

-- ---------------------------------------------------------------------------
-- Modelos (globais)
-- ---------------------------------------------------------------------------
CREATE TABLE checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL CHECK (service IN (
    'pgr','ltcat','laudo_insalubridade','laudo_periculosidade','relatorio_inspecao','apr','ordem_servico','outro')),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (service, name)
);

CREATE TABLE checklist_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  version_number INT NOT NULL CHECK (version_number >= 1),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','aprovado','substituido')),
  change_note TEXT CHECK (change_note IS NULL OR length(change_note) <= 1000),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  UNIQUE (template_id, version_number),
  CONSTRAINT checklist_versions_approval_chk CHECK ((status = 'rascunho') = (approved_by IS NULL AND approved_at IS NULL))
);
CREATE INDEX checklist_versions_template_idx ON checklist_template_versions (template_id, version_number DESC);
-- No máximo uma versão aprovada e um rascunho por modelo (o serviço já garante; o banco também).
CREATE UNIQUE INDEX checklist_versions_one_approved_idx ON checklist_template_versions (template_id) WHERE status = 'aprovado';
CREATE UNIQUE INDEX checklist_versions_one_draft_idx ON checklist_template_versions (template_id) WHERE status = 'rascunho';

CREATE TABLE checklist_template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id UUID NOT NULL REFERENCES checklist_template_versions(id) ON DELETE CASCADE,
  position INT NOT NULL CHECK (position >= 1),
  label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 300),
  instruction TEXT CHECK (instruction IS NULL OR length(instruction) <= 1000),
  kind TEXT NOT NULL CHECK (kind IN ('sim_nao_na','texto','numero','data')),
  required BOOLEAN NOT NULL DEFAULT true,
  blocks_review BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (version_id, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT checklist_items_blocks_chk CHECK (NOT blocks_review OR required)
);

-- ---------------------------------------------------------------------------
-- Instâncias por documento
-- ---------------------------------------------------------------------------
CREATE TABLE document_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES document_drafts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_version_id UUID NOT NULL REFERENCES checklist_template_versions(id),
  company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (draft_id, template_version_id)
);
CREATE INDEX document_checklists_tenant_idx ON document_checklists (tenant_id);

CREATE TABLE document_checklist_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES document_checklists(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES checklist_template_items(id),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 1000),
  note TEXT CHECK (note IS NULL OR length(note) <= 1000),
  answered_by UUID NOT NULL REFERENCES users(id),
  answered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (checklist_id, item_id)
);
CREATE INDEX document_checklist_answers_tenant_idx ON document_checklist_answers (tenant_id);

-- ---------------------------------------------------------------------------
-- RLS (FORCE). Modelos: leitura por sócio/admin; escrita só de sócio (a permissão fina é do backend).
-- Instâncias: carteira Montese. Sem DELETE de respostas/instâncias pelo sócio (rastreabilidade).
-- ---------------------------------------------------------------------------
ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;          ALTER TABLE checklist_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE checklist_template_versions ENABLE ROW LEVEL SECURITY;  ALTER TABLE checklist_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE checklist_template_items ENABLE ROW LEVEL SECURITY;     ALTER TABLE checklist_template_items FORCE ROW LEVEL SECURITY;
ALTER TABLE document_checklists ENABLE ROW LEVEL SECURITY;          ALTER TABLE document_checklists FORCE ROW LEVEL SECURITY;
ALTER TABLE document_checklist_answers ENABLE ROW LEVEL SECURITY;   ALTER TABLE document_checklist_answers FORCE ROW LEVEL SECURITY;

CREATE POLICY checklist_templates_read ON checklist_templates FOR SELECT
  USING (current_setting('app.role', true) IN ('admin', 'socio'));
CREATE POLICY checklist_templates_socio_insert ON checklist_templates FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio'
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY checklist_versions_read ON checklist_template_versions FOR SELECT
  USING (current_setting('app.role', true) IN ('admin', 'socio'));
CREATE POLICY checklist_versions_socio_insert ON checklist_template_versions FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND status = 'rascunho'
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY checklist_versions_socio_update ON checklist_template_versions FOR UPDATE
  USING (current_setting('app.role', true) = 'socio')
  WITH CHECK (current_setting('app.role', true) = 'socio');
CREATE POLICY checklist_versions_socio_delete ON checklist_template_versions FOR DELETE
  USING (current_setting('app.role', true) = 'socio' AND status = 'rascunho');

CREATE POLICY checklist_items_read ON checklist_template_items FOR SELECT
  USING (current_setting('app.role', true) IN ('admin', 'socio'));
CREATE POLICY checklist_items_socio_write ON checklist_template_items FOR ALL
  USING (current_setting('app.role', true) = 'socio')
  WITH CHECK (current_setting('app.role', true) = 'socio');

CREATE POLICY doc_checklists_admin_select ON document_checklists FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY doc_checklists_socio_select ON document_checklists FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY doc_checklists_socio_insert ON document_checklists FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY doc_answers_admin_select ON document_checklist_answers FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY doc_answers_socio_select ON document_checklist_answers FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY doc_answers_socio_insert ON document_checklist_answers FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND answered_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY doc_answers_socio_update ON document_checklist_answers FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND answered_by = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Guardas
-- ---------------------------------------------------------------------------
-- Versão: nasce rascunho; transições rascunho->aprovado (com autoria = quem aprova e ao menos 1 item) e
-- aprovado->substituido; nada mais muda depois de aprovada.
CREATE FUNCTION checklist_versions_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE uid UUID := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.template_id IS DISTINCT FROM OLD.template_id OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'checklist_template_versions: campos de origem são imutáveis';
  END IF;
  IF OLD.status = 'substituido' THEN
    RAISE EXCEPTION 'checklist_template_versions: versão substituída não pode ser alterada';
  END IF;
  IF OLD.status = 'aprovado' THEN
    IF NEW.status <> 'substituido' OR NEW.change_note IS DISTINCT FROM OLD.change_note
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'checklist_template_versions: versão aprovada é imutável';
    END IF;
    RETURN NEW;
  END IF;
  -- OLD.status = 'rascunho'
  IF NEW.status = 'aprovado' THEN
    IF NEW.approved_by IS DISTINCT FROM uid THEN
      RAISE EXCEPTION 'checklist_template_versions: a autoria da aprovação deve ser a de quem aprova';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM checklist_template_items i WHERE i.version_id = OLD.id) THEN
      RAISE EXCEPTION 'checklist_template_versions: não é possível aprovar um modelo sem itens';
    END IF;
  ELSIF NEW.status <> 'rascunho' THEN
    RAISE EXCEPTION 'checklist_template_versions: transição inválida (% -> %)', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_a_checklist_versions_guard BEFORE INSERT OR UPDATE ON checklist_template_versions
  FOR EACH ROW EXECUTE FUNCTION checklist_versions_guard();

-- Itens: só mudam enquanto a versão é rascunho.
CREATE FUNCTION checklist_items_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE vid UUID; st TEXT;
BEGIN
  vid := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  SELECT status INTO st FROM checklist_template_versions WHERE id = vid;
  IF st IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;   -- exclusão em cascata da versão rascunho
    RAISE EXCEPTION 'checklist_template_items: versão inexistente';
  END IF;
  IF st <> 'rascunho' THEN
    RAISE EXCEPTION 'checklist_template_items: versão aprovada é imutável';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.version_id IS DISTINCT FROM OLD.version_id THEN
    RAISE EXCEPTION 'checklist_template_items: version_id é imutável';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER trg_a_checklist_items_guard BEFORE INSERT OR UPDATE OR DELETE ON checklist_template_items
  FOR EACH ROW EXECUTE FUNCTION checklist_items_guard();

-- Instância: mesmo tenant do rascunho, rascunho não terminal, modelo APROVADO, unidade do mesmo tenant; imutável.
CREATE FUNCTION document_checklists_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE d_status TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'document_checklists: instância é imutável';
  END IF;
  SELECT status INTO d_status FROM document_drafts WHERE id = NEW.draft_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_checklists: rascunho inexistente ou de outro tenant';
  END IF;
  IF d_status IN ('publicado', 'cancelado') THEN
    RAISE EXCEPTION 'document_checklists: documento publicado ou cancelado não aceita checklist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM checklist_template_versions v WHERE v.id = NEW.template_version_id AND v.status = 'aprovado') THEN
    RAISE EXCEPTION 'document_checklists: só modelo aprovado e vigente pode ser usado';
  END IF;
  IF NEW.company_unit_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM company_units u WHERE u.id = NEW.company_unit_id AND u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'document_checklists: unidade de outro tenant';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_a_document_checklists_guard BEFORE INSERT OR UPDATE ON document_checklists
  FOR EACH ROW EXECUTE FUNCTION document_checklists_guard();

-- Resposta: item da versão da instância, valor coerente com o tipo, documento não terminal, autoria e origem imutáveis.
CREATE FUNCTION checklist_answers_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE c RECORD; k TEXT; d_status TEXT;
BEGIN
  SELECT dc.tenant_id, dc.draft_id, dc.template_version_id INTO c FROM document_checklists dc WHERE dc.id = NEW.checklist_id;
  IF NOT FOUND OR c.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'document_checklist_answers: checklist inexistente ou de outro tenant';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.checklist_id IS DISTINCT FROM OLD.checklist_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
                           OR NEW.item_id IS DISTINCT FROM OLD.item_id) THEN
    RAISE EXCEPTION 'document_checklist_answers: campos de origem são imutáveis';
  END IF;
  SELECT status INTO d_status FROM document_drafts WHERE id = c.draft_id;
  IF d_status IN ('publicado', 'cancelado') THEN
    RAISE EXCEPTION 'document_checklist_answers: documento publicado ou cancelado não aceita alteração';
  END IF;
  SELECT i.kind INTO k FROM checklist_template_items i WHERE i.id = NEW.item_id AND i.version_id = c.template_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_checklist_answers: item não pertence ao modelo do checklist';
  END IF;
  IF k = 'sim_nao_na' AND NEW.value NOT IN ('sim', 'nao', 'na') THEN
    RAISE EXCEPTION 'document_checklist_answers: valor inválido para sim/não/NA';
  ELSIF k = 'numero' AND NEW.value !~ '^-?[0-9]+([.,][0-9]+)?$' THEN
    RAISE EXCEPTION 'document_checklist_answers: valor numérico inválido';
  ELSIF k = 'data' THEN
    BEGIN
      PERFORM NEW.value::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'document_checklist_answers: data inválida';
    END;
    IF NEW.value !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'document_checklist_answers: data inválida';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.answered_at := clock_timestamp(); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_a_checklist_answers_guard BEFORE INSERT OR UPDATE ON document_checklist_answers
  FOR EACH ROW EXECUTE FUNCTION checklist_answers_guard();

-- Privilégios da role da aplicação. Guardado: a role pode não existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'montese_app') THEN
    GRANT SELECT, INSERT ON checklist_templates TO montese_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_template_versions, checklist_template_items TO montese_app;
    GRANT SELECT, INSERT ON document_checklists TO montese_app;
    GRANT SELECT, INSERT, UPDATE ON document_checklist_answers TO montese_app;
  END IF;
END $$;
