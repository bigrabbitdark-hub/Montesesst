-- Painel de Atuação (Fase 5A): fluxo de documentos (rascunho, versões, eventos, assinaturas
-- internas), matriz de responsabilidades, registros profissionais e abertura mínima de
-- `documents` para o `socio` (carteira Montese, via is_montese_tenant() da 0091).
--
-- Decisões (spec 2026-10-20-painel-atuacao-fase5-documentos-design.md):
--  * Assinatura = REGISTRO DE ASSINATURA INTERNA do sistema (usuário, data/hora, hash da
--    versão). Não é certificado digital ICP-Brasil; nenhum nome de coluna sugere isso.
--  * Matriz de responsabilidades e registros profissionais nascem VAZIOS: nenhuma linha é
--    semeada aqui. Sem linha na matriz = ação bloqueada (aplicado no service).
--  * Publicação grava em `documents` com a mesma file_key da versão assinada (sem cópia).
--    Campos NOT NULL de `documents` (0008/0020/0080): tenant_id, category, title, file_key,
--    file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role. Todos
--    existem em document_drafts/document_draft_versions (title/category no rascunho;
--    file_key/file_name/mime_type/size_bytes na versão assinada).
--  * Categoria: document_drafts.category e document_type_permissions.category usam um CHECK
--    IDÊNTICO ao atual de documents.category (0008+0023+0032+0046, 12 valores). Motivo:
--    falhar cedo (no rascunho) em vez de falhar só ao publicar, depois de assinar. Se o
--    CHECK de documents ganhar categorias, uma migration nova deve ampliar os três.
--
-- RLS: empresa/tecnico/parceiro NÃO têm policy nas tabelas novas (sem acesso). `socio`
-- opera só na carteira Montese; `admin` só LÊ o fluxo (não elabora, revisa, aprova, assina
-- nem publica: spec §1.2) e gerencia matriz e registros. Versões, eventos e assinaturas
-- são append-only (sem policy de UPDATE/DELETE + trigger que vale até para superusuário).
-- Funções plpgsql comuns (NÃO SECURITY DEFINER); triggers 'trg_a_guard_*' disparam antes de
-- trg_*_updated_at.
--
-- Rollback (descartável): DROP TABLE document_draft_signatures, document_draft_events,
--   document_draft_versions, document_drafts, document_type_permissions,
--   professional_registrations;
--   DROP FUNCTION guard_document_drafts_update(), guard_document_draft_versions_insert(),
--   guard_document_draft_events_insert(), guard_document_draft_signatures_insert(),
--   guard_append_only(), guard_professional_registrations_insert(),
--   guard_professional_registrations_update();
--   DROP TRIGGER trg_a_guard_documents_socio_publish ON documents; DROP FUNCTION guard_documents_socio_publish();
--   DROP POLICY documents_socio_select ON documents; DROP POLICY documents_socio_insert ON documents;
--   restaurar documents_uploaded_by_role_check (empresa,tecnico,parceiro) e o CHECK de
--   socio_permissions da 0091 (9 valores; apagar antes as linhas documents.read|approve|publish).

-- ---------------------------------------------------------------------------
-- professional_registrations: o sistema só guarda o que o admin cadastrar.
-- ---------------------------------------------------------------------------
CREATE TABLE professional_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  council TEXT NOT NULL CHECK (char_length(council) BETWEEN 2 AND 20),
  registration_number TEXT NOT NULL CHECK (char_length(registration_number) BETWEEN 1 AND 30),
  uf CHAR(2) NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','confirmado','revogado')),
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES users(id),         -- revogação pelo admin (confirmado -> revogado, terminal)
  revoked_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, council, registration_number, uf),
  CONSTRAINT professional_registrations_confirmation_check
    CHECK ((status IN ('confirmado','revogado')) = (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
  CONSTRAINT professional_registrations_revocation_check
    CHECK ((status = 'revogado') = (revoked_by IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE INDEX professional_registrations_confirmed_by_idx ON professional_registrations (confirmed_by)
  WHERE confirmed_by IS NOT NULL;
CREATE INDEX professional_registrations_revoked_by_idx ON professional_registrations (revoked_by)
  WHERE revoked_by IS NOT NULL;
CREATE INDEX professional_registrations_created_by_idx ON professional_registrations (created_by);

-- ---------------------------------------------------------------------------
-- document_type_permissions: matriz (categoria, usuário, ação). Vazia por padrão.
-- ---------------------------------------------------------------------------
CREATE TABLE document_type_permissions (
  category TEXT NOT NULL CHECK (category IN (
    'pgr','pcmso','laudo','ficha_epi','treinamento',
    'cipa_ata','cipa_comunicado','cipa_documento_eleitoral','cipa_anexo',
    'ltcat','lip','relatorio_visita'
  )),
  user_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('elaborar','revisar','aprovar','assinar','publicar')),
  granted_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (category, user_id, action)
);
CREATE INDEX document_type_permissions_user_idx ON document_type_permissions (user_id);
CREATE INDEX document_type_permissions_granted_by_idx ON document_type_permissions (granted_by);

-- ---------------------------------------------------------------------------
-- Rascunhos, versões, eventos, assinaturas
-- ---------------------------------------------------------------------------
CREATE TABLE document_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN (
    'pgr','pcmso','laudo','ficha_epi','treinamento',
    'cipa_ata','cipa_comunicado','cipa_documento_eleitoral','cipa_anexo',
    'ltcat','lip','relatorio_visita'
  )),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  company_unit_id UUID REFERENCES company_units(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'em_elaboracao'
    CHECK (status IN ('em_elaboracao','em_revisao','aprovado','assinado','publicado','cancelado')),
  current_version_id UUID,                      -- FK adicionada após a tabela de versões
  published_document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  publish_file_key TEXT,                        -- cópia do arquivo no R2 usada por `documents` (a chave da versão nunca é compartilhada)
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX document_drafts_tenant_status_idx ON document_drafts (tenant_id, status);
CREATE INDEX document_drafts_status_updated_idx ON document_drafts (status, updated_at DESC);
CREATE INDEX document_drafts_created_by_idx ON document_drafts (created_by);
CREATE INDEX document_drafts_company_unit_idx ON document_drafts (company_unit_id) WHERE company_unit_id IS NOT NULL;
CREATE INDEX document_drafts_published_doc_idx ON document_drafts (published_document_id) WHERE published_document_id IS NOT NULL;
CREATE TRIGGER trg_document_drafts_updated_at BEFORE UPDATE ON document_drafts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE document_draft_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES document_drafts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_number INT NOT NULL CHECK (version_number >= 1),
  file_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  note TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draft_id, version_number)
);
CREATE INDEX document_draft_versions_created_by_idx ON document_draft_versions (created_by);
ALTER TABLE document_drafts ADD CONSTRAINT document_drafts_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES document_draft_versions(id);
CREATE INDEX document_drafts_current_version_idx ON document_drafts (current_version_id)
  WHERE current_version_id IS NOT NULL;

CREATE TABLE document_draft_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES document_drafts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_id UUID REFERENCES document_draft_versions(id),
  actor_user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN (
    'created','version_added','submitted','returned','reviewed','approved','signed','published','cancelled'
  )),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX document_draft_events_draft_idx ON document_draft_events (draft_id, created_at);
CREATE INDEX document_draft_events_version_idx ON document_draft_events (version_id) WHERE version_id IS NOT NULL;
CREATE INDEX document_draft_events_actor_idx ON document_draft_events (actor_user_id);

CREATE TABLE document_draft_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id UUID NOT NULL REFERENCES document_drafts(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES document_draft_versions(id),
  signer_user_id UUID NOT NULL REFERENCES users(id),
  registration_id UUID NOT NULL REFERENCES professional_registrations(id),
  council TEXT NOT NULL,                        -- snapshot do registro confirmado
  registration_number TEXT NOT NULL,
  uf CHAR(2) NOT NULL,
  version_sha256 TEXT NOT NULL CHECK (version_sha256 ~ '^[0-9a-f]{64}$'),
  ip TEXT CHECK (ip IS NULL OR length(ip) <= 64),
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX document_draft_signatures_draft_idx ON document_draft_signatures (draft_id, signed_at);
CREATE INDEX document_draft_signatures_version_idx ON document_draft_signatures (version_id);
CREATE INDEX document_draft_signatures_signer_idx ON document_draft_signatures (signer_user_id);
CREATE INDEX document_draft_signatures_registration_idx ON document_draft_signatures (registration_id);

-- ---------------------------------------------------------------------------
-- RLS: ENABLE + FORCE nas 6 tabelas novas.
-- ---------------------------------------------------------------------------
ALTER TABLE professional_registrations ENABLE ROW LEVEL SECURITY;  ALTER TABLE professional_registrations FORCE ROW LEVEL SECURITY;
ALTER TABLE document_type_permissions ENABLE ROW LEVEL SECURITY;   ALTER TABLE document_type_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE document_drafts ENABLE ROW LEVEL SECURITY;             ALTER TABLE document_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE document_draft_versions ENABLE ROW LEVEL SECURITY;     ALTER TABLE document_draft_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE document_draft_events ENABLE ROW LEVEL SECURITY;       ALTER TABLE document_draft_events FORCE ROW LEVEL SECURITY;
ALTER TABLE document_draft_signatures ENABLE ROW LEVEL SECURITY;   ALTER TABLE document_draft_signatures FORCE ROW LEVEL SECURITY;

-- professional_registrations: admin cadastra (sempre pendente), confirma e apaga só pendente;
-- socio lê apenas as próprias linhas.
CREATE POLICY prof_reg_admin_select ON professional_registrations FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY prof_reg_admin_insert ON professional_registrations FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'admin' AND status = 'pendente'
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY prof_reg_admin_update ON professional_registrations FOR UPDATE
  USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY prof_reg_admin_delete ON professional_registrations FOR DELETE
  USING (current_setting('app.role', true) = 'admin' AND status = 'pendente');
CREATE POLICY prof_reg_socio_select ON professional_registrations FOR SELECT
  USING (current_setting('app.role', true) = 'socio'
         AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- document_type_permissions: admin concede/revoga (sem UPDATE: revogar e conceder de novo);
-- socio lê só as próprias linhas.
CREATE POLICY doc_type_perm_admin_select ON document_type_permissions FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY doc_type_perm_admin_insert ON document_type_permissions FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'admin'
              AND granted_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY doc_type_perm_admin_delete ON document_type_permissions FOR DELETE
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY doc_type_perm_socio_select ON document_type_permissions FOR SELECT
  USING (current_setting('app.role', true) = 'socio'
         AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- document_drafts: socio lê/cria/atualiza na carteira Montese (sem DELETE: cancelar);
-- admin só lê. O rascunho nasce em elaboração, sem versão atual e sem documento publicado.
CREATE POLICY drafts_admin_select ON document_drafts FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY drafts_socio_select ON document_drafts FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY drafts_socio_insert ON document_drafts FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
              AND status = 'em_elaboracao' AND current_version_id IS NULL AND published_document_id IS NULL);
CREATE POLICY drafts_socio_update ON document_drafts FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

-- versions / events: append-only (SELECT + INSERT do socio; admin só SELECT). O INSERT exige
-- autor = usuário da sessão e rascunho existente no mesmo tenant.
CREATE POLICY draft_versions_admin_select ON document_draft_versions FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY draft_versions_socio_select ON document_draft_versions FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY draft_versions_socio_insert ON document_draft_versions FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
              AND EXISTS (SELECT 1 FROM document_drafts d WHERE d.id = draft_id AND d.tenant_id = document_draft_versions.tenant_id));

CREATE POLICY draft_events_admin_select ON document_draft_events FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY draft_events_socio_select ON document_draft_events FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY draft_events_socio_insert ON document_draft_events FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
              AND EXISTS (SELECT 1 FROM document_drafts d WHERE d.id = draft_id AND d.tenant_id = document_draft_events.tenant_id));

-- signatures: INSERT só do próprio signatário COM registro profissional CONFIRMADO dele
-- (o socio lê as próprias linhas de professional_registrations, então a subconsulta vale),
-- snapshot idêntico ao registro e hash idêntico ao da versão.
CREATE POLICY draft_signatures_admin_select ON document_draft_signatures FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY draft_signatures_socio_select ON document_draft_signatures FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY draft_signatures_socio_insert ON document_draft_signatures FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
    AND signer_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM professional_registrations r
      WHERE r.id = document_draft_signatures.registration_id
        AND r.user_id = document_draft_signatures.signer_user_id
        AND r.status = 'confirmado'
        AND r.council = document_draft_signatures.council
        AND r.registration_number = document_draft_signatures.registration_number
        AND r.uf = document_draft_signatures.uf)
    AND EXISTS (
      SELECT 1 FROM document_draft_versions v
      WHERE v.id = document_draft_signatures.version_id
        AND v.draft_id = document_draft_signatures.draft_id
        AND v.tenant_id = document_draft_signatures.tenant_id
        AND v.sha256 = document_draft_signatures.version_sha256));

-- ---------------------------------------------------------------------------
-- Triggers de guarda (valem para todos os papéis, inclusive superusuário).
-- ---------------------------------------------------------------------------

-- document_drafts: imutabilidade de tenant_id/created_by/category, tabela de transições do
-- spec §4, estados terminais imutáveis e coerência de versão/documento publicado.
CREATE OR REPLACE FUNCTION guard_document_drafts_update() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.category IS DISTINCT FROM OLD.category THEN
    RAISE EXCEPTION 'document_drafts: tenant_id, created_by e category são imutáveis';
  END IF;

  -- publicado e cancelado são terminais. Exceções: as ações ON DELETE SET NULL das FKs
  -- (published_document_id e company_unit_id -> NULL) ao apagar o documento/a unidade.
  IF OLD.status IN ('publicado', 'cancelado') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.current_version_id IS DISTINCT FROM OLD.current_version_id
       OR NEW.publish_file_key IS DISTINCT FROM OLD.publish_file_key
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR (NEW.published_document_id IS DISTINCT FROM OLD.published_document_id AND NEW.published_document_id IS NOT NULL)
       OR (NEW.company_unit_id IS DISTINCT FROM OLD.company_unit_id AND NEW.company_unit_id IS NOT NULL) THEN
      RAISE EXCEPTION 'document_drafts: rascunho publicado/cancelado é imutável';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'em_elaboracao' AND NEW.status IN ('em_revisao', 'cancelado'))
      OR (OLD.status = 'em_revisao'    AND NEW.status IN ('aprovado', 'em_elaboracao', 'cancelado'))
      OR (OLD.status = 'aprovado'      AND NEW.status IN ('assinado', 'em_elaboracao', 'cancelado'))
      OR (OLD.status = 'assinado'      AND NEW.status IN ('publicado', 'em_elaboracao', 'cancelado'))
    ) THEN
      RAISE EXCEPTION 'document_drafts: transição de status inválida (% -> %)', OLD.status, NEW.status;
    END IF;
    IF NEW.status = 'em_revisao' AND NEW.current_version_id IS NULL THEN
      RAISE EXCEPTION 'document_drafts: submeter para revisão exige ao menos uma versão';
    END IF;
    IF NEW.status = 'aprovado' AND NOT EXISTS (
         SELECT 1 FROM document_draft_events e
         WHERE e.draft_id = NEW.id AND e.version_id = NEW.current_version_id AND e.type = 'approved') THEN
      RAISE EXCEPTION 'document_drafts: aprovar exige o evento approved da versão atual';
    END IF;
    IF NEW.status = 'assinado' AND NOT EXISTS (
         SELECT 1 FROM document_draft_signatures sg
         WHERE sg.draft_id = NEW.id AND sg.version_id = NEW.current_version_id) THEN
      RAISE EXCEPTION 'document_drafts: assinar exige o registro de assinatura da versão atual';
    END IF;
    IF NEW.status = 'publicado' AND NEW.published_document_id IS NULL THEN
      RAISE EXCEPTION 'document_drafts: publicar exige published_document_id';
    END IF;
  END IF;

  -- publish_file_key: definida UMA vez (NULL -> valor), só com o rascunho 'assinado'; depois imutável.
  IF NEW.publish_file_key IS DISTINCT FROM OLD.publish_file_key THEN
    IF OLD.publish_file_key IS NOT NULL OR NEW.publish_file_key IS NULL OR OLD.status <> 'assinado' THEN
      RAISE EXCEPTION 'document_drafts: publish_file_key só é definida uma vez, com o rascunho assinado';
    END IF;
  END IF;

  IF NEW.published_document_id IS DISTINCT FROM OLD.published_document_id
     AND NEW.published_document_id IS NOT NULL AND NEW.status <> 'publicado' THEN
    RAISE EXCEPTION 'document_drafts: published_document_id só é definido ao publicar';
  END IF;

  IF NEW.current_version_id IS DISTINCT FROM OLD.current_version_id THEN
    -- Nova versão invalida revisão/aprovação/assinatura anteriores (spec §4).
    IF OLD.status <> 'em_elaboracao' AND NEW.status <> 'em_elaboracao' THEN
      RAISE EXCEPTION 'document_drafts: nova versão devolve o rascunho para em_elaboracao';
    END IF;
    IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM document_draft_versions v WHERE v.id = NEW.current_version_id AND v.draft_id = NEW.id) THEN
      RAISE EXCEPTION 'document_drafts: current_version_id deve ser versão do próprio rascunho';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_a_guard_document_drafts BEFORE UPDATE ON document_drafts
  FOR EACH ROW EXECUTE FUNCTION guard_document_drafts_update();

-- Versões só entram em rascunho existente, do mesmo tenant e não encerrado.
CREATE OR REPLACE FUNCTION guard_document_draft_versions_insert() RETURNS TRIGGER AS $$
DECLARE
  d_status TEXT;
  d_tenant UUID;
BEGIN
  SELECT status, tenant_id INTO d_status, d_tenant FROM document_drafts WHERE id = NEW.draft_id;
  IF NOT FOUND OR d_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'document_draft_versions: rascunho inexistente ou de outro tenant';
  END IF;
  IF d_status IN ('publicado', 'cancelado') THEN
    RAISE EXCEPTION 'document_draft_versions: rascunho publicado/cancelado (terminal) não recebe versões';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_a_guard_document_draft_versions_ins BEFORE INSERT ON document_draft_versions
  FOR EACH ROW EXECUTE FUNCTION guard_document_draft_versions_insert();

-- Eventos: mesmo tenant do rascunho e, se houver, versão do próprio rascunho. (Eventos de
-- publicação/cancelamento são gravados depois da mudança de status, por isso sem checagem
-- de estado terminal.)
CREATE OR REPLACE FUNCTION guard_document_draft_events_insert() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM document_drafts d WHERE d.id = NEW.draft_id AND d.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'document_draft_events: rascunho inexistente ou de outro tenant';
  END IF;
  IF NEW.version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM document_draft_versions v WHERE v.id = NEW.version_id AND v.draft_id = NEW.draft_id) THEN
    RAISE EXCEPTION 'document_draft_events: version_id não pertence ao rascunho';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_a_guard_document_draft_events_ins BEFORE INSERT ON document_draft_events
  FOR EACH ROW EXECUTE FUNCTION guard_document_draft_events_insert();

-- Assinaturas: registro CONFIRMADO do próprio signatário, snapshot idêntico, versão do
-- rascunho e hash idêntico ao da versão (vale também para o superusuário).
CREATE OR REPLACE FUNCTION guard_document_draft_signatures_insert() RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM professional_registrations r
       WHERE r.id = NEW.registration_id AND r.user_id = NEW.signer_user_id
         AND r.status = 'confirmado'
         AND r.council = NEW.council AND r.registration_number = NEW.registration_number AND r.uf = NEW.uf) THEN
    RAISE EXCEPTION 'document_draft_signatures: exige registro profissional confirmado do próprio signatário (snapshot idêntico)';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM document_draft_versions v
       WHERE v.id = NEW.version_id AND v.draft_id = NEW.draft_id AND v.tenant_id = NEW.tenant_id
         AND v.sha256 = NEW.version_sha256) THEN
    RAISE EXCEPTION 'document_draft_signatures: versão/hash não correspondem ao rascunho';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_a_guard_document_draft_signatures_ins BEFORE INSERT ON document_draft_signatures
  FOR EACH ROW EXECUTE FUNCTION guard_document_draft_signatures_insert();

-- Append-only para TODOS (inclusive superusuário, que ignora RLS): UPDATE sempre falha;
-- DELETE direto falha. DELETE em cascata (profundidade de trigger > 1: ação de FK ao apagar
-- o rascunho ou o tenant) é permitido, para não impedir a remoção de um tenant.
CREATE OR REPLACE FUNCTION guard_append_only() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '%: tabela append-only (% não permitido)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_a_guard_document_draft_versions_ao BEFORE UPDATE OR DELETE ON document_draft_versions
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER trg_a_guard_document_draft_events_ao BEFORE UPDATE OR DELETE ON document_draft_events
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();
CREATE TRIGGER trg_a_guard_document_draft_signatures_ao BEFORE UPDATE OR DELETE ON document_draft_signatures
  FOR EACH ROW EXECUTE FUNCTION guard_append_only();

-- professional_registrations: nasce sempre pendente; só pendente -> confirmado; nunca o
-- contrário; identidade (user/conselho/número/UF) imutável; ninguém confirma o próprio.
CREATE OR REPLACE FUNCTION guard_professional_registrations_insert() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status <> 'pendente' THEN
    RAISE EXCEPTION 'professional_registrations: o registro nasce pendente; a confirmação é uma etapa separada';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_a_guard_professional_registrations_ins BEFORE INSERT ON professional_registrations
  FOR EACH ROW EXECUTE FUNCTION guard_professional_registrations_insert();

CREATE OR REPLACE FUNCTION guard_professional_registrations_update() RETURNS TRIGGER AS $$
DECLARE
  uid UUID := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.council IS DISTINCT FROM OLD.council
     OR NEW.registration_number IS DISTINCT FROM OLD.registration_number
     OR NEW.uf IS DISTINCT FROM OLD.uf
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'professional_registrations: user_id, conselho, número, UF e autoria são imutáveis';
  END IF;
  IF OLD.status = 'revogado' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
      RAISE EXCEPTION 'professional_registrations: registro revogado é terminal e imutável';
    END IF;
  ELSIF OLD.status = 'confirmado' THEN
    IF NEW.status = 'revogado' THEN
      IF NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
        RAISE EXCEPTION 'professional_registrations: registro confirmado é imutável (a única mudança permitida é a revogação)';
      END IF;
      IF uid IS NOT NULL AND NEW.revoked_by IS DISTINCT FROM uid THEN
        RAISE EXCEPTION 'professional_registrations: revoked_by deve ser o usuário que revoga';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
       OR NEW.revoked_by IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'professional_registrations: registro confirmado é imutável';
    END IF;
  ELSIF NEW.status = 'confirmado' THEN
    IF NEW.confirmed_by = OLD.user_id THEN
      RAISE EXCEPTION 'professional_registrations: ninguém confirma o próprio registro';
    END IF;
    IF uid IS NOT NULL AND NEW.confirmed_by IS DISTINCT FROM uid THEN
      RAISE EXCEPTION 'professional_registrations: confirmed_by deve ser o usuário que confirma';
    END IF;
    IF NEW.revoked_by IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'professional_registrations: registro recém-confirmado não tem dados de revogação';
    END IF;
  ELSIF NEW.status = 'revogado' THEN
    RAISE EXCEPTION 'professional_registrations: só registro confirmado pode ser revogado';
  ELSIF NEW.confirmed_by IS NOT NULL OR NEW.confirmed_at IS NOT NULL OR NEW.revoked_by IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'professional_registrations: registro pendente não tem dados de confirmação';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_a_guard_professional_registrations_upd BEFORE UPDATE ON professional_registrations
  FOR EACH ROW EXECUTE FUNCTION guard_professional_registrations_update();

-- ---------------------------------------------------------------------------
-- documents: única alteração = uploaded_by_role aceita 'socio' + policies do socio
-- (carteira Montese). Sem UPDATE/DELETE para o socio. documents_isolation (0008) intacta.
-- ---------------------------------------------------------------------------
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_uploaded_by_role_check;
ALTER TABLE documents ADD CONSTRAINT documents_uploaded_by_role_check
  CHECK (uploaded_by_role IN ('empresa', 'tecnico', 'parceiro', 'socio'));

CREATE POLICY documents_socio_select ON documents FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY documents_socio_insert ON documents FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND uploaded_by_role = 'socio'
              AND uploaded_by_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- Defesa em profundidade da publicação: inserção em documents com uploaded_by_role='socio'
-- só a partir de rascunho ASSINADO do mesmo tenant/categoria cuja publish_file_key (a CÓPIA do
-- arquivo; a chave da versão nunca é compartilhada com documents) é a file_key inserida. Outros papéis (empresa/tecnico/parceiro, webhooks, migrations) não são afetados.
-- Plpgsql comum: a subconsulta roda com os privilégios do chamador (o socio lê rascunhos e
-- versões da carteira Montese; superusuário não sofre RLS).
CREATE OR REPLACE FUNCTION guard_documents_socio_publish() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.uploaded_by_role = 'socio' AND NOT EXISTS (
       SELECT 1
       FROM document_drafts d
       WHERE d.status = 'assinado'
         AND d.tenant_id = NEW.tenant_id
         AND d.category = NEW.category
         AND d.publish_file_key = NEW.file_key) THEN
    RAISE EXCEPTION 'documents: inserção de socio só é permitida a partir de rascunho assinado'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_a_guard_documents_socio_publish BEFORE INSERT ON documents
  FOR EACH ROW EXECUTE FUNCTION guard_documents_socio_publish();

-- ---------------------------------------------------------------------------
-- socio_permissions: lista fechada ampliada (documents.read|approve|publish).
-- ---------------------------------------------------------------------------
ALTER TABLE socio_permissions DROP CONSTRAINT IF EXISTS socio_permissions_permission_check;
ALTER TABLE socio_permissions ADD CONSTRAINT socio_permissions_permission_check CHECK (permission IN (
  'clients.read','clients.update_operational','tasks.read','tasks.write',
  'appointments.manage','documents.create_draft','documents.review',
  'documents.sign','finance.read',
  'documents.read','documents.approve','documents.publish',
  'documents.cancel','documents.view_registration'
));
