-- Painel dos sócios, E4a: antecedências de alerta por tipo de documento, registro de "revisão por mudança nas condições
-- de trabalho" e notificações internas. Tudo aditivo: a tabela de regras JÁ EXISTE (document_validity_rules, migration 0079:
-- category, validity_months, alert_days; escrita pelo admin) e é reaproveitada, só ganha colunas opcionais. Os meses
-- continuam sendo parâmetros operacionais do admin (calculam expires_at no upload); o sistema NÃO traz prazos legais.
-- Permissões novas (lista fechada do sócio): alertas.read, alertas.manage (sensível: edita e confirma regras, registra mudanças).
-- Depende da 0079 (document_validity_rules), da 0096 (categorias), da 0103 (CHECK de socio_permissions) e da 0101 (is_montese_tenant).
--
-- ROLLBACK (manual, só com autorização; destrutivo para regras, registros de mudança e notificações):
--   BEGIN;
--   DELETE FROM socio_permissions WHERE permission LIKE 'alertas.%';
--   ALTER TABLE socio_permissions DROP CONSTRAINT socio_permissions_permission_check;
--   ALTER TABLE socio_permissions ADD CONSTRAINT socio_permissions_permission_check CHECK (permission IN (
--     'clients.read','clients.update_operational','tasks.read','tasks.write','appointments.manage',
--     'documents.create_draft','documents.review','documents.sign','documents.read','documents.approve',
--     'documents.publish','documents.cancel','documents.view_registration','finance.read',
--     'empresas.read','empresas.documentos','pgr.read','pgr.write',
--     'checklists.read','checklists.write','checklists.approve'));
--   DROP TABLE notifications, document_change_flags;
--   DROP TRIGGER trg_a_document_validity_rules_socio_guard ON document_validity_rules; DROP FUNCTION document_validity_rules_socio_guard();
--   DROP POLICY validity_rules_select, validity_rules_admin_write, validity_rules_socio_update ON document_validity_rules;
--   ALTER TABLE document_validity_rules NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE document_validity_rules DROP COLUMN notice_days, DROP COLUMN source;
--   DROP FUNCTION notice_days_valid(int[]), change_flags_guard(), notifications_guard(), notifications_insert_batch(uuid[], text[], text[], text[], uuid[], text[], text[]);
--   DELETE FROM _migrations WHERE name = '0104_alertas_vencimento.sql';
--   COMMIT;
SET LOCAL lock_timeout = '5s';

ALTER TABLE socio_permissions DROP CONSTRAINT IF EXISTS socio_permissions_permission_check;
ALTER TABLE socio_permissions ADD CONSTRAINT socio_permissions_permission_check CHECK (permission IN (
  'clients.read','clients.update_operational','tasks.read','tasks.write','appointments.manage',
  'documents.create_draft','documents.review','documents.sign','documents.read','documents.approve',
  'documents.publish','documents.cancel','documents.view_registration','finance.read',
  'empresas.read','empresas.documentos','pgr.read','pgr.write',
  'checklists.read','checklists.write','checklists.approve',
  'alertas.read','alertas.manage'));

-- ---------------------------------------------------------------------------
-- Regras de validade (EXISTENTE, 0079): antecedências múltiplas e fonte, opcionais
-- ---------------------------------------------------------------------------
-- notice_days NULL = usa o padrão das notificações (60, 30, 15, 7 e no dia). alert_days (único) segue valendo para o resto.
CREATE FUNCTION notice_days_valid(p INT[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p IS NULL OR (cardinality(p) BETWEEN 1 AND 8 AND NOT EXISTS (SELECT 1 FROM unnest(p) n WHERE n IS NULL OR n < 0 OR n > 365))
$$;
ALTER TABLE document_validity_rules ADD COLUMN IF NOT EXISTS notice_days INT[];
ALTER TABLE document_validity_rules ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE document_validity_rules ADD CONSTRAINT document_validity_rules_notice_days_chk CHECK (notice_days_valid(notice_days));
ALTER TABLE document_validity_rules ADD CONSTRAINT document_validity_rules_source_chk CHECK (source IS NULL OR length(source) <= 500);
COMMENT ON COLUMN document_validity_rules.notice_days IS 'Antecedências (dias) das notificações internas dos sócios. NULL = padrão 60/30/15/7/0. Parâmetro operacional, não prazo legal.';
COMMENT ON COLUMN document_validity_rules.source IS 'Fonte/referência informada pela engenharia para o prazo. Texto livre; não valida norma.';

-- ---------------------------------------------------------------------------
-- Revisão por mudança nas condições de trabalho (não altera vencimento)
-- ---------------------------------------------------------------------------
CREATE TABLE document_change_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  category TEXT CHECK (category IS NULL OR category IN (
    'pgr','pcmso','laudo','ficha_epi','treinamento','cipa_ata','cipa_comunicado','cipa_documento_eleitoral',
    'cipa_anexo','ltcat','lip','relatorio_visita')),
  reason TEXT NOT NULL CHECK (reason IN ('funcao','processo','equipamento','risco','estabelecimento','outro')),
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(resolution_note) <= 500),
  CONSTRAINT change_flags_target_chk CHECK (document_id IS NOT NULL OR category IS NOT NULL),
  CONSTRAINT change_flags_resolved_chk CHECK ((resolved_by IS NULL) = (resolved_at IS NULL))
);
CREATE INDEX change_flags_open_idx ON document_change_flags (tenant_id, created_at) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------------
-- Notificações internas (texto genérico: sem dado pessoal nem de saúde)
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'documento_vencendo','documento_vencido','tarefa_atrasada','correcao_atrasada','revisao_por_mudanca')),
  priority TEXT NOT NULL CHECK (priority IN ('baixa','media','alta')),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  href TEXT CHECK (href IS NULL OR (href ~ '^/atuacao/[A-Za-z0-9/_?=&.-]*$' AND href NOT LIKE '%..%')),
  dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  read_at TIMESTAMPTZ,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------------------
-- RLS (FORCE)
-- ---------------------------------------------------------------------------
ALTER TABLE document_change_flags ENABLE ROW LEVEL SECURITY;    ALTER TABLE document_change_flags FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;            ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY change_flags_admin_select ON document_change_flags FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY change_flags_socio_select ON document_change_flags FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY change_flags_socio_insert ON document_change_flags FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id)
              AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid AND resolved_at IS NULL);
CREATE POLICY change_flags_socio_update ON document_change_flags FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id))
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

-- Notificações: cada sócio lê e marca como lida SÓ as próprias; quem gera é o job (contexto admin, só INSERT).
CREATE POLICY notifications_socio_select ON notifications FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY notifications_socio_update ON notifications FOR UPDATE
  USING (current_setting('app.role', true) = 'socio' AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (current_setting('app.role', true) = 'socio' AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
-- Quem gera é o job (contexto admin) por notifications_insert_batch(): ON CONFLICT DO NOTHING exige policy de SELECT visível
-- quando há conflito, e o admin NÃO deve ler as notificações dos sócios; por isso a inserção em lote é uma função
-- SECURITY DEFINER estreita (dono com BYPASSRLS), que só aceita app.role = 'admin' e só insere.

-- ---------------------------------------------------------------------------
-- Guardas
-- ---------------------------------------------------------------------------
-- Registro de mudança: documento (se informado) do mesmo tenant; origem imutável; resolução única e do próprio usuário.
CREATE FUNCTION change_flags_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE uid UUID := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.document_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM documents d WHERE d.id = NEW.document_id AND d.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'document_change_flags: documento inexistente ou de outro tenant';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.category IS DISTINCT FROM OLD.category OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'document_change_flags: campos de origem são imutáveis';
  END IF;
  IF OLD.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'document_change_flags: registro já resolvido não pode ser alterado';
  END IF;
  IF NEW.resolved_by IS DISTINCT FROM uid OR NEW.resolved_at IS NULL THEN
    RAISE EXCEPTION 'document_change_flags: a resolução deve ser registrada por quem a faz';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_a_change_flags_guard BEFORE INSERT OR UPDATE ON document_change_flags
  FOR EACH ROW EXECUTE FUNCTION change_flags_guard();

-- Notificação: depois de criada, só read_at muda (e só de NULL para um instante; nunca volta a não lida).
CREATE FUNCTION notifications_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.type IS DISTINCT FROM OLD.type OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.title IS DISTINCT FROM OLD.title OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.href IS DISTINCT FROM OLD.href
     OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'notifications: só read_at pode ser alterado';
  END IF;
  IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    RAISE EXCEPTION 'notifications: notificação lida não volta a não lida';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_a_notifications_guard BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION notifications_guard();

CREATE FUNCTION notifications_insert_batch(
  p_user_ids uuid[], p_types text[], p_priorities text[], p_titles text[], p_tenant_ids uuid[], p_hrefs text[], p_keys text[]
) RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH ins AS (
    INSERT INTO notifications (user_id, type, priority, title, tenant_id, href, dedupe_key)
    SELECT u, ty, pr, ti, te, h, k
      FROM unnest(p_user_ids, p_types, p_priorities, p_titles, p_tenant_ids, p_hrefs, p_keys) AS x(u, ty, pr, ti, te, h, k)
     WHERE current_setting('app.role', true) = 'admin'
    ON CONFLICT (user_id, dedupe_key) DO NOTHING
    RETURNING 1)
  SELECT count(*)::int FROM ins
$$;
REVOKE ALL ON FUNCTION notifications_insert_batch(uuid[], text[], text[], text[], uuid[], text[], text[]) FROM PUBLIC;

-- Privilégios da role da aplicação. Guardado: as roles podem não existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'montese_auth_bypass') THEN
    GRANT SELECT, INSERT ON notifications TO montese_auth_bypass;
    ALTER FUNCTION notifications_insert_batch(uuid[], text[], text[], text[], uuid[], text[], text[]) OWNER TO montese_auth_bypass;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'montese_app') THEN
    -- Em ambiente com a role da aplicação, a função SECURITY DEFINER não pode ficar com o dono da migration.
    RAISE EXCEPTION '0104: role montese_auth_bypass inexistente; a função notifications_insert_batch ficaria com o dono da migration';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'montese_app') THEN
    GRANT EXECUTE ON FUNCTION notifications_insert_batch(uuid[], text[], text[], text[], uuid[], text[], text[]) TO montese_app;
  END IF;
END $$;

-- Privilégios da role da aplicação nas tabelas. Guardado: a role pode não existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'montese_app') THEN
    GRANT SELECT, INSERT, UPDATE ON document_change_flags TO montese_app;
    GRANT SELECT, INSERT, UPDATE ON notifications TO montese_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS em document_validity_rules (revisão de segurança E2–E4): a tabela é global e, até a 0079, só o admin escrevia.
-- Agora o sócio (alertas.manage) também escreve; o banco passa a limitar o que ele pode mudar.
-- ---------------------------------------------------------------------------
ALTER TABLE document_validity_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_validity_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY validity_rules_select ON document_validity_rules FOR SELECT USING (true);
CREATE POLICY validity_rules_admin_write ON document_validity_rules FOR ALL
  USING (current_setting('app.role', true) = 'admin') WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY validity_rules_socio_update ON document_validity_rules FOR UPDATE
  USING (current_setting('app.role', true) = 'socio') WITH CHECK (current_setting('app.role', true) = 'socio');

-- O sócio só altera antecedências e fonte; meses de validade, alert_days e categoria ficam com o admin.
CREATE FUNCTION document_validity_rules_socio_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('app.role', true) = 'socio' AND (
       NEW.category IS DISTINCT FROM OLD.category OR NEW.validity_months IS DISTINCT FROM OLD.validity_months
       OR NEW.alert_days IS DISTINCT FROM OLD.alert_days) THEN
    RAISE EXCEPTION 'document_validity_rules: o sócio só altera antecedências e fonte';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_a_document_validity_rules_socio_guard BEFORE UPDATE ON document_validity_rules
  FOR EACH ROW EXECUTE FUNCTION document_validity_rules_socio_guard();
