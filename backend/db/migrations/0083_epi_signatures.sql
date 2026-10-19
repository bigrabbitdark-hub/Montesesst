-- Módulo EPI, subsistema 3: assinatura eletrônica mobile. Ver docs/superpowers/specs/2026-10-15-epi-assinatura-eletronica-design.md.
-- Aditiva. As rotas públicas não têm contexto de empresa: usam funções SECURITY DEFINER (dono montese_auth_bypass, BYPASSRLS),
-- no padrão auth_* (0058). Só o hash do token e do código é guardado.

CREATE TABLE epi_signature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  pin_hash TEXT NOT NULL CHECK (pin_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','assinada','recusada','expirada','revogada','bloqueada')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  term_version TEXT NOT NULL,
  term_text_sha256 TEXT NOT NULL CHECK (term_text_sha256 ~ '^[0-9a-f]{64}$'),
  refusal_reason TEXT CHECK (refusal_reason IS NULL OR length(refusal_reason) <= 300),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX idx_epi_sig_requests_employee ON epi_signature_requests (employee_id, created_at DESC);

CREATE TABLE epi_signature_request_items (
  request_id UUID NOT NULL REFERENCES epi_signature_requests(id) ON DELETE CASCADE,
  -- NO ACTION adiada (e não RESTRICT): protege a entrega contra DELETE direto, mas deixa o cascade de tenant
  -- remover itens e entregas (a ordem dos cascades é indefinida; RESTRICT/NO ACTION imediatos falhariam conforme a ordem).
  delivery_id UUID NOT NULL REFERENCES employee_epi_deliveries(id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY (request_id, delivery_id)
);
CREATE INDEX idx_epi_sig_items_delivery ON epi_signature_request_items (delivery_id);

CREATE TABLE epi_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  request_id UUID NOT NULL UNIQUE REFERENCES epi_signature_requests(id) ON DELETE RESTRICT,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  signed_at TIMESTAMPTZ NOT NULL,
  accepted BOOLEAN NOT NULL CHECK (accepted),
  term_version TEXT NOT NULL,
  term_text_sha256 TEXT NOT NULL CHECK (term_text_sha256 ~ '^[0-9a-f]{64}$'),
  items_snapshot JSONB NOT NULL,
  signature_file_key TEXT NOT NULL,
  signature_sha256 TEXT NOT NULL CHECK (signature_sha256 ~ '^[0-9a-f]{64}$'),
  ip TEXT CHECK (ip IS NULL OR length(ip) <= 64),
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  code_verified BOOLEAN NOT NULL CHECK (code_verified),
  evidence_payload JSONB NOT NULL,
  evidence_sha256 TEXT NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_code TEXT NOT NULL,
  UNIQUE (tenant_id, receipt_code)
);
CREATE INDEX idx_epi_signatures_employee ON epi_signatures (employee_id, signed_at DESC);

-- Imutabilidade da evidência (mesmo padrão de epi_ficha_documents).
CREATE FUNCTION epi_signatures_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 AND NOT epi_tenant_row_exists(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'epi_signatures é imutável' USING ERRCODE = '42501';
END;
$$;
-- Só epi_sig_sign (SECURITY DEFINER, current_user = montese_auth_bypass) cria evidência. montese_app herda os privilégios de
-- tabela de montese_auth_bypass (pertença de role), então a ACL sozinha não basta: um INSERT direto da aplicação roda com
-- current_user = montese_app e é recusado aqui. (SET ROLE explícito continua possível: limite da arquitetura auth_*, ver 0058.)
CREATE FUNCTION epi_signatures_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'montese_auth_bypass' AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'permission denied: epi_signatures só é gravada por epi_sig_sign' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_epi_signatures_insert_guard BEFORE INSERT ON epi_signatures
  FOR EACH ROW EXECUTE FUNCTION epi_signatures_insert_guard();
CREATE TRIGGER trg_epi_signatures_immutable BEFORE UPDATE OR DELETE ON epi_signatures
  FOR EACH ROW EXECUTE FUNCTION epi_signatures_immutable();

-- Guarda dos itens: a entrega precisa ser pendente e do mesmo funcionário/empresa da requisição ativa; depois que a
-- requisição deixa de ser ativa os itens são imutáveis (a cascata de um tenant removido continua permitida).
CREATE FUNCTION epi_sig_items_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r RECORD; d RECORD;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    IF pg_trigger_depth() > 1 AND NOT epi_tenant_row_exists((SELECT tenant_id FROM epi_signature_requests WHERE id = OLD.request_id)) THEN
      RETURN OLD;
    END IF;
    SELECT status INTO r FROM epi_signature_requests WHERE id = OLD.request_id;
    -- requisição já removida (cascata de DELETE da própria requisição): nada a proteger aqui
    IF NOT FOUND THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
    IF r.status <> 'ativa' THEN
      RAISE EXCEPTION 'itens de requisição já encerrada são imutáveis' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  END IF;
  SELECT tenant_id, employee_id, status INTO r FROM epi_signature_requests WHERE id = NEW.request_id;
  SELECT tenant_id, employee_id, signature_status INTO d FROM employee_epi_deliveries WHERE id = NEW.delivery_id;
  IF r IS NULL OR d IS NULL OR r.status <> 'ativa' OR d.tenant_id <> r.tenant_id OR d.employee_id <> r.employee_id
     OR d.signature_status <> 'pendente' THEN
    RAISE EXCEPTION 'item inválido: a entrega deve ser pendente e do mesmo funcionário da requisição ativa' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_epi_sig_items_guard BEFORE INSERT OR UPDATE OR DELETE ON epi_signature_request_items
  FOR EACH ROW EXECUTE FUNCTION epi_sig_items_guard();

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['epi_signature_requests','epi_signature_request_items','epi_signatures'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
CREATE POLICY epi_sig_requests_isolation ON epi_signature_requests USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user()));
CREATE POLICY epi_sig_items_isolation ON epi_signature_request_items USING (
  EXISTS (SELECT 1 FROM epi_signature_requests r WHERE r.id = request_id));
CREATE POLICY epi_signatures_isolation ON epi_signatures USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user()));
REVOKE TRUNCATE ON epi_signature_requests, epi_signature_request_items, epi_signatures FROM montese_app;

-- Assinatura PRESENCIAL (sem imagem nem evidência eletrônica): o registro guarda autor, testemunha, motivo e data;
-- as entregas ficam com signature_status = 'presencial'. Imutável como a evidência eletrônica.
CREATE TABLE epi_in_person_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  witness_name TEXT NOT NULL CHECK (length(btrim(witness_name)) BETWEEN 3 AND 120),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 300),
  registered_by_user_id UUID NOT NULL REFERENCES users(id),
  term_version TEXT NOT NULL,   -- versão do termo vigente quando o presencial foi registrado (o termo em rascunho precisa estar liberado)
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_epi_in_person_employee ON epi_in_person_signatures (employee_id, registered_at DESC);

CREATE TABLE epi_in_person_signature_items (
  in_person_id UUID NOT NULL REFERENCES epi_in_person_signatures(id) ON DELETE CASCADE,
  -- NO ACTION adiada: mesmo tratamento de epi_signature_request_items.delivery_id (cascade de tenant com ordem indefinida).
  delivery_id UUID NOT NULL REFERENCES employee_epi_deliveries(id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY (in_person_id, delivery_id),
  UNIQUE (delivery_id)   -- uma entrega só é registrada como presencial uma vez
);

-- Imutabilidade: UPDATE/DELETE direto -> 42501. A cascata de um tenant removido continua permitida (padrão epi_signatures_immutable).
CREATE FUNCTION epi_in_person_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    IF TG_TABLE_NAME = 'epi_in_person_signatures' THEN
      IF NOT epi_tenant_row_exists(OLD.tenant_id) THEN RETURN OLD; END IF;
    -- itens: só caem pela cascata do registro (que já foi removido)
    ELSIF NOT EXISTS (SELECT 1 FROM epi_in_person_signatures WHERE id = OLD.in_person_id) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION '% é imutável', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_epi_in_person_immutable BEFORE UPDATE OR DELETE ON epi_in_person_signatures
  FOR EACH ROW EXECUTE FUNCTION epi_in_person_immutable();
CREATE TRIGGER trg_epi_in_person_items_immutable BEFORE UPDATE OR DELETE ON epi_in_person_signature_items
  FOR EACH ROW EXECUTE FUNCTION epi_in_person_immutable();

ALTER TABLE epi_in_person_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE epi_in_person_signatures FORCE ROW LEVEL SECURITY;
ALTER TABLE epi_in_person_signature_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE epi_in_person_signature_items FORCE ROW LEVEL SECURITY;
CREATE POLICY epi_in_person_isolation ON epi_in_person_signatures USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user()));
CREATE POLICY epi_in_person_items_isolation ON epi_in_person_signature_items USING (
  EXISTS (SELECT 1 FROM epi_in_person_signatures p WHERE p.id = in_person_id));
REVOKE TRUNCATE ON epi_in_person_signatures, epi_in_person_signature_items FROM montese_app;
GRANT SELECT, INSERT ON epi_in_person_signatures, epi_in_person_signature_items TO montese_app;

-- Guardas do registro presencial (mesmo tenant/funcionário; a entrega precisa terminar 'presencial'; registro sem itens é inválido).
CREATE FUNCTION epi_in_person_items_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p RECORD; d RECORD;
BEGIN
  SELECT tenant_id, employee_id INTO p FROM epi_in_person_signatures WHERE id = NEW.in_person_id;
  SELECT tenant_id, employee_id INTO d FROM employee_epi_deliveries WHERE id = NEW.delivery_id;
  IF p IS NULL OR d IS NULL OR d.tenant_id <> p.tenant_id OR d.employee_id <> p.employee_id THEN
    RAISE EXCEPTION 'item inválido: a entrega deve ser do mesmo tenant e funcionário do registro presencial' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_epi_in_person_items_guard BEFORE INSERT ON epi_in_person_signature_items
  FOR EACH ROW EXECUTE FUNCTION epi_in_person_items_guard();
-- Deferidas (conferidas no COMMIT): o item é gravado antes do UPDATE da entrega, e a entrega tem de terminar 'presencial'.
CREATE FUNCTION epi_in_person_items_final_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM employee_epi_deliveries WHERE id = NEW.delivery_id AND signature_status = 'presencial') THEN
    RAISE EXCEPTION 'item inválido: a entrega do registro presencial deve estar presencial' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_epi_in_person_items_final AFTER INSERT ON epi_in_person_signature_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION epi_in_person_items_final_check();
CREATE FUNCTION epi_in_person_final_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM epi_in_person_signature_items WHERE in_person_id = NEW.id) THEN
    RAISE EXCEPTION 'registro presencial sem entregas' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_epi_in_person_final AFTER INSERT ON epi_in_person_signatures
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION epi_in_person_final_check();

-- Garantias de estado por trigger ('assinada' implica evidência; 'presencial' implica registro). Protegem contra BUG e contra a
-- aplicação comum; NÃO contra a credencial de montese_app (dona das tabelas: pode DISABLE TRIGGER). Ver docs/architecture/epi-assinatura.md.
CREATE FUNCTION epi_deliveries_signature_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.signature_status IS NOT DISTINCT FROM OLD.signature_status THEN RETURN NEW; END IF;
  -- 'assinada' só pelas funções epi_sig_* (current_user = montese_auth_bypass) ou superusuário (fixtures de teste)
  IF NEW.signature_status = 'assinada' AND current_user <> 'montese_auth_bypass'
     AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'permission denied: a entrega só vira assinada por epi_sig_sign' USING ERRCODE = '42501';
  END IF;
  -- assinada/presencial só saem para 'estornada' (estorno do livro)
  IF OLD.signature_status IN ('assinada', 'presencial') AND NEW.signature_status <> 'estornada' THEN
    RAISE EXCEPTION 'entrega % só pode ser estornada', OLD.signature_status USING ERRCODE = '42501';
  END IF;
  -- IF aninhado (e não AND): a consulta só roda, e só exige privilégio na tabela, quando a entrega vai a 'presencial'
  IF NEW.signature_status = 'presencial' THEN
    IF NOT EXISTS (SELECT 1 FROM epi_in_person_signature_items WHERE delivery_id = NEW.id) THEN
      RAISE EXCEPTION 'entrega presencial exige registro em epi_in_person_signatures' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_epi_deliveries_signature_guard BEFORE UPDATE OF signature_status ON employee_epi_deliveries
  FOR EACH ROW EXECUTE FUNCTION epi_deliveries_signature_guard();

CREATE FUNCTION epi_signature_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE privileged BOOLEAN := current_user = 'montese_auth_bypass'
  OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user);
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- só a cascata de um tenant já removido (padrão epi_signatures_immutable); a recusa/assinatura não pode ser apagada
    IF pg_trigger_depth() > 1 AND NOT epi_tenant_row_exists(OLD.tenant_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'epi_signature_requests não pode ser apagada' USING ERRCODE = '42501';
  END IF;
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.pin_hash IS DISTINCT FROM OLD.pin_hash
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.term_version IS DISTINCT FROM OLD.term_version OR NEW.term_text_sha256 IS DISTINCT FROM OLD.term_text_sha256
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION 'campos da requisição de assinatura são imutáveis' USING ERRCODE = '42501';
  END IF;
  IF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'attempts só cresce' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'ativa' THEN
    RAISE EXCEPTION 'requisição encerrada não muda de status' USING ERRCODE = '42501';
  END IF;
  IF NOT privileged THEN
    -- a aplicação só revoga: ativa -> revogada; nenhum outro campo muda
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'revogada' THEN
      RAISE EXCEPTION 'a aplicação só pode revogar requisições' USING ERRCODE = '42501';
    END IF;
    IF NEW.attempts <> OLD.attempts OR NEW.used_at IS DISTINCT FROM OLD.used_at
       OR NEW.refusal_reason IS DISTINCT FROM OLD.refusal_reason OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      RAISE EXCEPTION 'a aplicação só pode revogar requisições' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_epi_signature_requests_guard BEFORE UPDATE OR DELETE ON epi_signature_requests
  FOR EACH ROW EXECUTE FUNCTION epi_signature_requests_guard();

-- A role BYPASSRLS das funções precisa de privilégios de tabela (BYPASSRLS não os concede). Mínimos, por coluna onde dá.
GRANT SELECT ON epi_signature_requests, epi_signature_request_items TO montese_auth_bypass;
GRANT UPDATE (status, attempts, used_at, refusal_reason) ON epi_signature_requests TO montese_auth_bypass;
GRANT SELECT, INSERT ON epi_signatures TO montese_auth_bypass;
GRANT SELECT ON employee_epi_deliveries TO montese_auth_bypass;
GRANT UPDATE (signature_status, signed_at, signed_by_name) ON employee_epi_deliveries TO montese_auth_bypass;
GRANT SELECT (id, full_name) ON employees TO montese_auth_bypass;   -- sem CPF nem outros dados pessoais
GRANT SELECT ON tenants, tenant_epis, epi_catalog_items TO montese_auth_bypass;
-- A evidência só nasce por epi_sig_sign: a aplicação não insere nem altera diretamente (DELETE fica para a cascata do tenant).
REVOKE INSERT, UPDATE ON epi_signatures FROM montese_app;

-- Interna: trava a requisição e confere token/código. NÃO executável pela aplicação.
CREATE FUNCTION epi_sig_check(p_token_hash TEXT, p_pin_hash TEXT)
RETURNS TABLE(result TEXT, attempts_left INT, req_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r epi_signature_requests%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL THEN RETURN QUERY SELECT 'invalid'::text, 0, NULL::uuid; RETURN; END IF;
  SELECT * INTO r FROM epi_signature_requests WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'invalid'::text, 0, NULL::uuid; RETURN; END IF;
  IF r.status = 'ativa' AND r.expires_at <= now() THEN
    UPDATE epi_signature_requests SET status = 'expirada' WHERE id = r.id;
    RETURN QUERY SELECT 'invalid'::text, 0, NULL::uuid; RETURN;
  END IF;
  IF r.status = 'bloqueada' THEN RETURN QUERY SELECT 'locked'::text, 0, NULL::uuid; RETURN; END IF;
  IF r.status <> 'ativa' THEN RETURN QUERY SELECT 'invalid'::text, 0, NULL::uuid; RETURN; END IF;
  IF r.attempts >= 5 THEN
    UPDATE epi_signature_requests SET status = 'bloqueada' WHERE id = r.id;
    RETURN QUERY SELECT 'locked'::text, 0, NULL::uuid; RETURN;
  END IF;
  -- código ausente (NULL) conta como tentativa errada; nunca passa como correto
  IF p_pin_hash IS NULL OR r.pin_hash IS DISTINCT FROM p_pin_hash THEN
    UPDATE epi_signature_requests
       SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= 5 THEN 'bloqueada' ELSE status END
     WHERE id = r.id;
    IF r.attempts + 1 >= 5 THEN RETURN QUERY SELECT 'locked'::text, 0, NULL::uuid; RETURN; END IF;
    RETURN QUERY SELECT 'wrong_code'::text, 5 - (r.attempts + 1), NULL::uuid; RETURN;
  END IF;
  RETURN QUERY SELECT 'ok'::text, 5 - r.attempts, r.id;
END;
$$;

CREATE FUNCTION epi_sig_peek(p_token_hash TEXT)
RETURNS TABLE(usable BOOLEAN, company_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r epi_signature_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM epi_signature_requests WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, NULL::text; RETURN; END IF;
  IF r.status = 'ativa' AND r.expires_at <= now() THEN
    UPDATE epi_signature_requests SET status = 'expirada' WHERE id = r.id;
    RETURN QUERY SELECT false, NULL::text; RETURN;
  END IF;
  IF r.status <> 'ativa' THEN RETURN QUERY SELECT false, NULL::text; RETURN; END IF;
  RETURN QUERY SELECT true, (SELECT t.name FROM tenants t WHERE t.id = r.tenant_id);
END;
$$;

-- Itens (entregas) de uma requisição, no formato exibido e gravado na evidência. Interna.
CREATE FUNCTION epi_sig_items(p_request_id UUID) RETURNS JSONB
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'delivery_id', d.id, 'date', to_char(d.delivered_at, 'YYYY-MM-DD'),
           'epi_description', eci.description, 'manufacturer', te.manufacturer, 'model', te.model,
           'ca_number', te.ca_number, 'quantity', d.quantity) ORDER BY d.delivered_at, d.id), '[]'::jsonb)
    FROM epi_signature_requests q
    JOIN epi_signature_request_items i ON i.request_id = q.id
    JOIN employee_epi_deliveries d ON d.id = i.delivery_id AND d.tenant_id = q.tenant_id AND d.employee_id = q.employee_id
    JOIN tenant_epis te ON te.id = d.tenant_epi_id
    JOIN epi_catalog_items eci ON eci.id = te.epi_catalog_item_id
   WHERE q.id = p_request_id;
$$;

CREATE FUNCTION epi_sig_open(p_token_hash TEXT, p_pin_hash TEXT)
RETURNS TABLE(result TEXT, attempts_left INT, request_id UUID, tenant_id UUID, employee_name TEXT,
              expires_at TIMESTAMPTZ, term_version TEXT, term_text_sha256 TEXT, items JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c RECORD; r epi_signature_requests%ROWTYPE;
BEGIN
  SELECT * INTO c FROM epi_sig_check(p_token_hash, p_pin_hash);
  IF c.result <> 'ok' THEN
    RETURN QUERY SELECT c.result, c.attempts_left, NULL::uuid, NULL::uuid, NULL::text, NULL::timestamptz, NULL::text, NULL::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO r FROM epi_signature_requests WHERE id = c.req_id;
  RETURN QUERY SELECT 'ok'::text, c.attempts_left, r.id, r.tenant_id,
    (SELECT e.full_name FROM employees e WHERE e.id = r.employee_id), r.expires_at, r.term_version, r.term_text_sha256, epi_sig_items(r.id);
END;
$$;

CREATE FUNCTION epi_sig_sign(p_token_hash TEXT, p_pin_hash TEXT, p_accepted BOOLEAN, p_signature_key TEXT,
                             p_signature_sha256 TEXT, p_ip TEXT, p_user_agent TEXT)
RETURNS TABLE(result TEXT, signature_id UUID, receipt_code TEXT, signed_at TIMESTAMPTZ, evidence_sha256 TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c RECORD; r epi_signature_requests%ROWTYPE; v_items JSONB; v_now TIMESTAMPTZ := now();
        v_code TEXT; v_payload JSONB; v_hash TEXT; v_id UUID; v_name TEXT; v_pending INT; v_total INT;
BEGIN
  SELECT * INTO c FROM epi_sig_check(p_token_hash, p_pin_hash);
  IF c.result <> 'ok' THEN RETURN QUERY SELECT c.result, NULL::uuid, NULL::text, NULL::timestamptz, NULL::text; RETURN; END IF;
  IF NOT COALESCE(p_accepted, false) THEN RETURN QUERY SELECT 'not_accepted'::text, NULL::uuid, NULL::text, NULL::timestamptz, NULL::text; RETURN; END IF;
  SELECT * INTO r FROM epi_signature_requests WHERE id = c.req_id;
  -- trava as entregas da requisição (FOR UPDATE não é permitido junto de agregação) e só então conta
  -- (ordem de travas: requisição, depois entregas)
  PERFORM 1 FROM employee_epi_deliveries d
    WHERE d.tenant_id = r.tenant_id AND d.employee_id = r.employee_id
      AND d.id IN (SELECT delivery_id FROM epi_signature_request_items WHERE request_id = r.id) FOR UPDATE;
  SELECT count(*), count(*) FILTER (WHERE d.signature_status = 'pendente') INTO v_total, v_pending
    FROM epi_signature_request_items i JOIN employee_epi_deliveries d ON d.id = i.delivery_id AND d.tenant_id = r.tenant_id AND d.employee_id = r.employee_id
   WHERE i.request_id = r.id;
  IF v_total = 0 OR v_pending <> v_total THEN RETURN QUERY SELECT 'conflict'::text, NULL::uuid, NULL::text, NULL::timestamptz, NULL::text; RETURN; END IF;
  v_items := epi_sig_items(r.id);
  v_code := 'ASEPI-' || to_char(v_now AT TIME ZONE 'America/Sao_Paulo', 'YYYYMMDD') || '-' || upper(encode(gen_random_bytes(4), 'hex'));
  v_payload := jsonb_build_object(
    'request_id', r.id, 'tenant_id', r.tenant_id, 'employee_id', r.employee_id, 'receipt_code', v_code,
    'signed_at', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'accepted', true,
    'term_version', r.term_version, 'term_text_sha256', r.term_text_sha256, 'items', v_items,
    'signature_sha256', p_signature_sha256, 'ip', left(p_ip, 64), 'user_agent', left(p_user_agent, 300), 'code_verified', true);
  v_hash := encode(digest(v_payload::text, 'sha256'), 'hex');
  INSERT INTO epi_signatures (tenant_id, request_id, employee_id, signed_at, accepted, term_version, term_text_sha256, items_snapshot,
                              signature_file_key, signature_sha256, ip, user_agent, code_verified, evidence_payload, evidence_sha256, receipt_code)
  VALUES (r.tenant_id, r.id, r.employee_id, v_now, true, r.term_version, r.term_text_sha256, v_items,
          p_signature_key, p_signature_sha256, left(p_ip, 64), left(p_user_agent, 300), true, v_payload, v_hash, v_code)
  RETURNING id INTO v_id;
  SELECT full_name INTO v_name FROM employees WHERE id = r.employee_id;
  UPDATE employee_epi_deliveries d SET signature_status = 'assinada', signed_at = v_now, signed_by_name = left(v_name, 200)
   WHERE d.tenant_id = r.tenant_id AND d.employee_id = r.employee_id
     AND d.id IN (SELECT delivery_id FROM epi_signature_request_items WHERE request_id = r.id);
  UPDATE epi_signature_requests SET status = 'assinada', used_at = v_now WHERE id = r.id;
  RETURN QUERY SELECT 'ok'::text, v_id, v_code, v_now, v_hash;
END;
$$;

CREATE FUNCTION epi_sig_refuse(p_token_hash TEXT, p_pin_hash TEXT, p_reason TEXT)
RETURNS TABLE(result TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c RECORD;
BEGIN
  SELECT * INTO c FROM epi_sig_check(p_token_hash, p_pin_hash);
  IF c.result <> 'ok' THEN RETURN QUERY SELECT c.result; RETURN; END IF;
  UPDATE employee_epi_deliveries d SET signature_status = 'recusada'
   WHERE d.signature_status = 'pendente'
     AND d.id IN (SELECT i.delivery_id FROM epi_signature_request_items i JOIN epi_signature_requests q ON q.id = i.request_id
                   WHERE i.request_id = c.req_id AND d.tenant_id = q.tenant_id AND d.employee_id = q.employee_id);
  UPDATE epi_signature_requests SET status = 'recusada', used_at = now(), refusal_reason = left(p_reason, 300) WHERE id = c.req_id;
  RETURN QUERY SELECT 'ok'::text;
END;
$$;

DO $$ DECLARE f TEXT; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'epi_sig_check(text,text)','epi_sig_peek(text)','epi_sig_items(uuid)','epi_sig_open(text,text)',
    'epi_sig_sign(text,text,boolean,text,text,text,text)','epi_sig_refuse(text,text,text)','epi_sig_items_guard()'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO montese_auth_bypass', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
  END LOOP;
END $$;
-- Os privilégios padrão do schema concedem EXECUTE a montese_app em toda função nova: revoga explicitamente nas internas
-- (sem filtro de empresa; só as funções SECURITY DEFINER públicas as chamam, como dono).
REVOKE ALL ON FUNCTION epi_sig_check(text,text), epi_sig_items(uuid), epi_sig_items_guard() FROM montese_app;
GRANT EXECUTE ON FUNCTION epi_sig_peek(text), epi_sig_open(text,text),
  epi_sig_sign(text,text,boolean,text,text,text,text), epi_sig_refuse(text,text,text) TO montese_app;
