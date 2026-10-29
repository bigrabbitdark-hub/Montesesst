-- PGR (sub-projeto B1) — Matriz de risco versionada e avaliações de risco. Aditiva; a matriz nasce
-- VAZIA (nenhuma versão, escala, faixa ou nível semeado). Acesso:
--   pgr_matrix_versions: global da Montese. admin FOR ALL; socio só SELECT de versões
--     'publicada'/'arquivada' (rascunho invisível); empresa/tecnico/parceiro sem policy = sem acesso.
--   pgr_risk_assessments: por empresa, APPEND-ONLY. admin SELECT/INSERT; socio SELECT/INSERT só em
--     cliente da carteira Montese (is_montese_tenant()); sem UPDATE/DELETE por ninguém.
-- A autorização fina (pgr.read / pgr.write) é do PermissionsGuard no backend; o banco isola por tenant.
-- Depende de 0098 (pgr_risks, pgr_check_parent_tenant(), pgr_guard_immutable_tenant()).
-- Rollback (descartável; destrutivo, só com autorização):
--   DROP TABLE pgr_risk_assessments, pgr_matrix_versions;
--   DROP FUNCTION pgr_matrix_versions_guard(); DROP FUNCTION pgr_matrix_versions_no_delete();
--   DROP FUNCTION pgr_matrix_versions_insert_draft(); DROP FUNCTION pgr_risk_assessments_no_update();
--   DROP FUNCTION pgr_risk_assessments_no_delete(); DROP FUNCTION pgr_risk_assessments_check_version();
--   DROP TRIGGER trg_a_pgr_risks_keep_assessments ON pgr_risks; DROP FUNCTION pgr_risks_keep_assessments();
--   DROP TRIGGER trg_a_pgr_ghes_keep_assessments ON pgr_ghes; DROP FUNCTION pgr_ghes_keep_assessments();
--   DROP FUNCTION pgr_matriz_no_truncate();   (os triggers BEFORE TRUNCATE caem junto com as tabelas)
--   (o índice pgr_risk_assessments_latest_idx cai junto com a tabela)
--   (os DROP TRIGGER em pgr_risks/pgr_ghes acima devem vir ANTES de DROP TABLE; as tabelas da 0098 permanecem)
--   (os triggers e as policies caem junto com as tabelas; pgr_check_parent_tenant e
--    pgr_guard_immutable_tenant pertencem à 0098 e permanecem)

-- ---------------------------------------------------------------------------
-- Versões da matriz (global). version_number é gerado pelo serviço (max+1 sob lock).
-- ---------------------------------------------------------------------------
CREATE TABLE pgr_matrix_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number INT NOT NULL UNIQUE CHECK (version_number >= 1),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','publicada','arquivada')),
  config JSONB NOT NULL CHECK (octet_length(config::text) <= 200000),
  config_sha256 TEXT CHECK (config_sha256 IS NULL OR config_sha256 ~ '^[0-9a-f]{64}$'),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 4000),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Rascunho: sem hash nem dados de publicação. Publicada/arquivada: hash e data obrigatórios.
  -- published_by é exigido na transição (trigger), não aqui: o FK ON DELETE SET NULL precisa poder zerá-lo.
  CONSTRAINT pgr_matrix_versions_publicacao_chk CHECK (
    (status = 'rascunho' AND config_sha256 IS NULL AND published_at IS NULL AND published_by IS NULL)
    OR (status <> 'rascunho' AND config_sha256 IS NOT NULL AND published_at IS NOT NULL)
  )
);
CREATE INDEX pgr_matrix_versions_created_by_idx ON pgr_matrix_versions (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX pgr_matrix_versions_published_by_idx ON pgr_matrix_versions (published_by) WHERE published_by IS NOT NULL;
CREATE TRIGGER trg_pgr_matrix_versions_updated_at BEFORE UPDATE ON pgr_matrix_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Avaliações de risco (append-only): inerente ou residual previsto, apontando para a versão exata.
-- ---------------------------------------------------------------------------
CREATE TABLE pgr_risk_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  risk_id UUID NOT NULL REFERENCES pgr_risks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('inerente','residual_previsto')),
  matrix_version_id UUID NOT NULL REFERENCES pgr_matrix_versions(id) ON DELETE RESTRICT,
  severity_value INT NOT NULL CHECK (severity_value >= 1),
  probability_value INT NOT NULL CHECK (probability_value >= 1),
  score INT NOT NULL CHECK (score >= 1),
  level_id TEXT NOT NULL CHECK (length(level_id) BETWEEN 1 AND 100),
  justification TEXT NOT NULL CHECK (length(btrim(justification)) >= 1 AND length(justification) <= 4000),
  assessed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pgr_risk_assessments_tenant_idx ON pgr_risk_assessments (tenant_id);
-- Avaliação vigente = a mais recente por (risco, tipo).
CREATE INDEX pgr_risk_assessments_risk_idx ON pgr_risk_assessments (risk_id, kind, assessed_at DESC);
-- Mapa de calor: última avaliação por risco de um tipo, dentro de um tenant (DISTINCT ON risk_id).
CREATE INDEX pgr_risk_assessments_latest_idx ON pgr_risk_assessments (tenant_id, kind, risk_id, assessed_at DESC, id DESC);
CREATE INDEX pgr_risk_assessments_version_idx ON pgr_risk_assessments (matrix_version_id);
CREATE INDEX pgr_risk_assessments_assessed_by_idx ON pgr_risk_assessments (assessed_by) WHERE assessed_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Triggers das versões: nascem rascunho; status só avança; publicada/arquivada congeladas.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pgr_matrix_versions_insert_draft() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status <> 'rascunho' THEN
    RAISE EXCEPTION 'transição de status inválida: a versão da matriz nasce como rascunho' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION pgr_matrix_versions_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.version_number IS DISTINCT FROM OLD.version_number THEN
    RAISE EXCEPTION 'version_number é imutável em pgr_matrix_versions' USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'rascunho' THEN
    IF NEW.status NOT IN ('rascunho','publicada') THEN
      RAISE EXCEPTION 'transição de status inválida: rascunho só avança para publicada' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'publicada' AND NEW.published_by IS NULL THEN
      RAISE EXCEPTION 'publicar a matriz exige published_by' USING ERRCODE = '23514';
    END IF;
    -- A transição para publicada não pode alterar o conteúdo: o hash é calculado sobre o config lido, e config/notes
    -- só mudam em UPDATEs de rascunho (separados). config_sha256 é o SHA-256 do JSON canônico gerado pela aplicação
    -- (chaves ordenadas, serialização JS), NÃO do texto de jsonb::text; não é recalculável em SQL.
    IF NEW.status = 'publicada' AND (NEW.config IS DISTINCT FROM OLD.config OR NEW.notes IS DISTINCT FROM OLD.notes) THEN
      RAISE EXCEPTION 'publicar a matriz não pode alterar config nem notes' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- publicada / arquivada
  IF NOT (NEW.status = OLD.status OR (OLD.status = 'publicada' AND NEW.status = 'arquivada')) THEN
    RAISE EXCEPTION 'transição de status inválida: % não volta nem salta para %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  IF NEW.config IS DISTINCT FROM OLD.config
     OR NEW.config_sha256 IS DISTINCT FROM OLD.config_sha256
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
    RAISE EXCEPTION 'versão % da matriz é imutável (config, config_sha256, notes e published_at congelados)', OLD.status
      USING ERRCODE = '23514';
  END IF;
  -- created_by/published_by só podem virar NULL pelo FK ON DELETE SET NULL (apagar o usuário),
  -- que roda dentro do trigger de integridade referencial (pg_trigger_depth() > 1); UPDATE direto não.
  IF (NEW.created_by IS DISTINCT FROM OLD.created_by AND (NEW.created_by IS NOT NULL OR pg_trigger_depth() <= 1))
     OR (NEW.published_by IS DISTINCT FROM OLD.published_by AND (NEW.published_by IS NOT NULL OR pg_trigger_depth() <= 1)) THEN
    RAISE EXCEPTION 'versão % da matriz é imutável (autoria congelada)', OLD.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION pgr_matrix_versions_no_delete() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status <> 'rascunho' THEN
    RAISE EXCEPTION 'versão % da matriz é imutável e não pode ser apagada', OLD.status USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER trg_a_pgr_matrix_versions_insert_draft BEFORE INSERT ON pgr_matrix_versions
  FOR EACH ROW EXECUTE FUNCTION pgr_matrix_versions_insert_draft();
CREATE TRIGGER trg_a_pgr_matrix_versions_guard BEFORE UPDATE ON pgr_matrix_versions
  FOR EACH ROW EXECUTE FUNCTION pgr_matrix_versions_guard();
CREATE TRIGGER trg_a_pgr_matrix_versions_no_delete BEFORE DELETE ON pgr_matrix_versions
  FOR EACH ROW EXECUTE FUNCTION pgr_matrix_versions_no_delete();

-- ---------------------------------------------------------------------------
-- Triggers das avaliações: coerência de tenant com o risco, versão publicada, append-only.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_a_pgr_risk_assessments_risk BEFORE INSERT OR UPDATE ON pgr_risk_assessments
  FOR EACH ROW EXECUTE FUNCTION pgr_check_parent_tenant('pgr_risks', 'risk_id');
CREATE TRIGGER trg_a_pgr_risk_assessments_immutable_tenant BEFORE UPDATE ON pgr_risk_assessments
  FOR EACH ROW EXECUTE FUNCTION pgr_guard_immutable_tenant();

-- A versão precisa estar publicada no INSERT (rascunho e arquivada são recusadas). SECURITY INVOKER:
-- versão invisível pela RLS ao papel é tratada como inexistente.
CREATE FUNCTION pgr_risk_assessments_check_version() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM pgr_matrix_versions WHERE id = NEW.matrix_version_id;
  IF v_status IS DISTINCT FROM 'publicada' THEN
    RAISE EXCEPTION 'a avaliação exige uma versão da matriz com status publicada' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_a_pgr_risk_assessments_version BEFORE INSERT ON pgr_risk_assessments
  FOR EACH ROW EXECUTE FUNCTION pgr_risk_assessments_check_version();

-- Append-only. Única exceção ao UPDATE: o FK ON DELETE SET NULL de assessed_by (executado dentro do
-- trigger de integridade referencial, pg_trigger_depth() > 1), que zera só esse campo.
CREATE FUNCTION pgr_risk_assessments_no_update() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF pg_trigger_depth() > 1 AND NEW.assessed_by IS NULL
     AND (to_jsonb(NEW) - 'assessed_by') = (to_jsonb(OLD) - 'assessed_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'pgr_risk_assessments é append-only: UPDATE não permitido' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER trg_b_pgr_risk_assessments_no_update BEFORE UPDATE ON pgr_risk_assessments
  FOR EACH ROW EXECUTE FUNCTION pgr_risk_assessments_no_update();

-- DELETE só em cascata (risco ou tenant apagado): dentro do trigger de integridade referencial
-- pg_trigger_depth() > 1; DELETE direto roda no nível 1 e é recusado.
CREATE FUNCTION pgr_risk_assessments_no_delete() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'pgr_risk_assessments é append-only: DELETE só em cascata do risco ou do tenant' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_b_pgr_risk_assessments_no_delete BEFORE DELETE ON pgr_risk_assessments
  FOR EACH ROW EXECUTE FUNCTION pgr_risk_assessments_no_delete();

-- Histórico sobrevive: DELETE direto de um risco que tenha avaliações é recusado (a avaliação é
-- append-only). Cascatas de FK (tenant, GHE; pg_trigger_depth() > 1) continuam passando.
-- SECURITY INVOKER: o papel que apaga enxerga as avaliações do próprio escopo pela RLS.
CREATE FUNCTION pgr_risks_keep_assessments() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND EXISTS (SELECT 1 FROM pgr_risk_assessments WHERE risk_id = OLD.id) THEN
    RAISE EXCEPTION 'risco com avaliações registradas não pode ser apagado (histórico da matriz é append-only)'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_a_pgr_risks_keep_assessments BEFORE DELETE ON pgr_risks
  FOR EACH ROW EXECUTE FUNCTION pgr_risks_keep_assessments();

-- Idem para o GHE: DELETE direto de um GHE cujos riscos tenham avaliações é recusado (a cascata GHE → riscos →
-- avaliações apagaria o histórico). Cascata de tenant (pg_trigger_depth() > 1) continua passando.
CREATE FUNCTION pgr_ghes_keep_assessments() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND EXISTS (
    SELECT 1 FROM pgr_risk_assessments a JOIN pgr_risks r ON r.id = a.risk_id WHERE r.ghe_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'GHE com riscos avaliados não pode ser apagado (histórico da matriz é append-only)'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_a_pgr_ghes_keep_assessments BEFORE DELETE ON pgr_ghes
  FOR EACH ROW EXECUTE FUNCTION pgr_ghes_keep_assessments();

-- TRUNCATE não dispara triggers de linha: bloqueio explícito nas duas tabelas imutáveis/append-only.
CREATE FUNCTION pgr_matriz_no_truncate() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'TRUNCATE não é permitido em %: versões e avaliações da matriz são imutáveis', TG_TABLE_NAME USING ERRCODE = '23514';
END $$;
CREATE TRIGGER trg_pgr_matrix_versions_no_truncate BEFORE TRUNCATE ON pgr_matrix_versions
  FOR EACH STATEMENT EXECUTE FUNCTION pgr_matriz_no_truncate();
CREATE TRIGGER trg_pgr_risk_assessments_no_truncate BEFORE TRUNCATE ON pgr_risk_assessments
  FOR EACH STATEMENT EXECUTE FUNCTION pgr_matriz_no_truncate();

-- ---------------------------------------------------------------------------
-- RLS: ENABLE + FORCE e policies por papel.
-- ---------------------------------------------------------------------------
ALTER TABLE pgr_matrix_versions ENABLE ROW LEVEL SECURITY;  ALTER TABLE pgr_matrix_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE pgr_risk_assessments ENABLE ROW LEVEL SECURITY; ALTER TABLE pgr_risk_assessments FORCE ROW LEVEL SECURITY;

CREATE POLICY pgr_matrix_versions_admin ON pgr_matrix_versions USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY pgr_matrix_versions_socio_select ON pgr_matrix_versions FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND status IN ('publicada','arquivada'));

CREATE POLICY pgr_risk_assessments_admin_select ON pgr_risk_assessments FOR SELECT
  USING (current_setting('app.role', true) = 'admin');
CREATE POLICY pgr_risk_assessments_admin_insert ON pgr_risk_assessments FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'admin');
CREATE POLICY pgr_risk_assessments_socio_select ON pgr_risk_assessments FOR SELECT
  USING (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));
CREATE POLICY pgr_risk_assessments_socio_insert ON pgr_risk_assessments FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'socio' AND is_montese_tenant(tenant_id));

-- Privilégios da role da aplicação: pgr_matrix_versions recebe SELECT/INSERT/UPDATE/DELETE (rascunho é editável e apagável; as
-- policies limitam ao admin e os triggers congelam publicada/arquivada). pgr_risk_assessments recebe só SELECT/INSERT (sem
-- UPDATE/DELETE/TRUNCATE concedidos); os triggers continuam sendo a barreira em ambientes com privilégios padrão amplos.
-- Guardado: a role pode não existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'montese_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON pgr_matrix_versions TO montese_app;
    GRANT SELECT, INSERT ON pgr_risk_assessments TO montese_app;
  END IF;
END $$;
