-- Módulo EPI, subsistema 1: livro de movimentações e estoque.
-- Aditiva: nenhuma coluna ou linha existente é removida. Ver
-- docs/superpowers/specs/2026-10-14-epi-cadastro-movimentacoes-design.md.
--
-- ATENÇÃO (antes de aplicar em produção): o índice único uq_tenant_epis_identity
-- falha se já houver EPIs duplicados (mesma empresa, catálogo, CA, fabricante, modelo).
-- Consulta de conferência (somente leitura), a rodar pelo proprietário:
--   SELECT tenant_id, epi_catalog_item_id, ca_number, count(*) FROM tenant_epis
--   GROUP BY 1,2,3 HAVING count(*) > 1;
-- A migration é transacional: se falhar, nada é aplicado.

ALTER TABLE tenants
  ADD COLUMN epi_alert_days INT NOT NULL DEFAULT 30 CHECK (epi_alert_days BETWEEN 1 AND 365);

ALTER TABLE tenant_epis
  ADD COLUMN manufacturer TEXT,
  ADD COLUMN model TEXT,
  ADD COLUMN unit TEXT NOT NULL DEFAULT 'un',
  ADD COLUMN min_stock INT CHECK (min_stock >= 0),
  ADD COLUMN max_stock INT CHECK (max_stock >= 0),
  ADD COLUMN unit_cost NUMERIC(12, 2) CHECK (unit_cost >= 0),
  ADD COLUMN controls_lot BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN replacement_days INT CHECK (replacement_days > 0),
  ADD COLUMN status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo')),
  ADD COLUMN stock_balance INT NOT NULL DEFAULT 0 CHECK (stock_balance >= 0),
  ADD COLUMN updated_by_user_id UUID REFERENCES users(id),
  ADD CONSTRAINT chk_tenant_epis_stock_range CHECK (max_stock IS NULL OR min_stock IS NULL OR max_stock >= min_stock);

CREATE UNIQUE INDEX uq_tenant_epis_identity
  ON tenant_epis (tenant_id, epi_catalog_item_id, ca_number, COALESCE(manufacturer, ''), COALESCE(model, ''));

CREATE TABLE epi_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_epi_id UUID NOT NULL REFERENCES tenant_epis(id) ON DELETE RESTRICT,
  lot_code TEXT NOT NULL,
  valid_until DATE,
  balance INT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_epi_id, lot_code)
);
CREATE INDEX idx_epi_lots_tenant ON epi_lots (tenant_id);

CREATE TABLE epi_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_epi_id UUID NOT NULL REFERENCES tenant_epis(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('abertura', 'entrada', 'entrega', 'devolucao', 'troca', 'baixa', 'ajuste', 'estorno')),
  direction SMALLINT NOT NULL CHECK (direction IN (-1, 1)),
  quantity INT NOT NULL CHECK (quantity > 0),
  balance_after INT NOT NULL CHECK (balance_after >= 0),
  employee_id UUID REFERENCES employees(id) ON DELETE RESTRICT,
  supplier TEXT,
  lot_id UUID REFERENCES epi_lots(id) ON DELETE RESTRICT,
  reason TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivery_id UUID REFERENCES employee_epi_deliveries(id) ON DELETE RESTRICT,
  reverses_movement_id UUID REFERENCES epi_movements(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_epi_mov_employee CHECK (type NOT IN ('entrega', 'troca', 'devolucao') OR employee_id IS NOT NULL),
  CONSTRAINT chk_epi_mov_reason CHECK (type NOT IN ('baixa', 'ajuste', 'estorno') OR length(btrim(coalesce(reason, ''))) > 0),
  CONSTRAINT chk_epi_mov_supplier CHECK (type <> 'entrada' OR length(btrim(coalesce(supplier, ''))) > 0),
  CONSTRAINT chk_epi_mov_reverses CHECK ((type = 'estorno') = (reverses_movement_id IS NOT NULL)),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE UNIQUE INDEX uq_epi_movements_reverses ON epi_movements (reverses_movement_id) WHERE reverses_movement_id IS NOT NULL;
CREATE INDEX idx_epi_movements_epi ON epi_movements (tenant_epi_id, occurred_at DESC);
CREATE INDEX idx_epi_movements_tenant ON epi_movements (tenant_id, occurred_at DESC);
CREATE INDEX idx_epi_movements_employee ON epi_movements (employee_id) WHERE employee_id IS NOT NULL;

-- Imutabilidade: UPDATE nunca; DELETE direto nunca. Única exceção: a ação
-- referencial ON DELETE CASCADE de um tenant removido (pg_trigger_depth() > 1 E
-- o tenant dono da linha já não existe). A checagem de existência roda numa
-- função SECURITY DEFINER de propriedade de montese_auth_bypass (BYPASSRLS),
-- para que um tenant existente mas invisível ao papel atual (RLS) NÃO pareça
-- inexistente. VOLATILE de propósito: precisa enxergar o DELETE em andamento.
CREATE FUNCTION epi_tenant_row_exists(p_tenant_id UUID) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id);
$$;
GRANT SELECT ON tenants TO montese_auth_bypass;
ALTER FUNCTION epi_tenant_row_exists(UUID) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION epi_tenant_row_exists(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION epi_tenant_row_exists(UUID) TO montese_app;
DO $g$
BEGIN
  -- a ação referencial do cascade executa como dono da tabela (quem migra)
  EXECUTE format('GRANT EXECUTE ON FUNCTION epi_tenant_row_exists(UUID) TO %I', current_user);
END
$g$;

CREATE FUNCTION epi_movements_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 AND NOT epi_tenant_row_exists(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'epi_movements é imutável (use estorno)' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_epi_movements_immutable
  BEFORE UPDATE OR DELETE ON epi_movements
  FOR EACH ROW EXECUTE FUNCTION epi_movements_immutable();

ALTER TABLE employee_epi_deliveries
  ALTER COLUMN signed_by_name DROP NOT NULL,
  ALTER COLUMN signed_at DROP NOT NULL,
  ADD COLUMN quantity INT CHECK (quantity > 0),
  ADD COLUMN signature_status TEXT NOT NULL DEFAULT 'legado'
    CHECK (signature_status IN ('legado', 'pendente', 'assinada', 'recusada', 'expirada', 'presencial', 'estornada'));

ALTER TABLE epi_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE epi_lots FORCE ROW LEVEL SECURITY;
CREATE POLICY epi_lots_isolation ON epi_lots USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

ALTER TABLE epi_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE epi_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY epi_movements_isolation ON epi_movements USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::UUID
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

-- O livro e os lotes não podem ser esvaziados pela role da aplicação: TRUNCATE é um
-- privilégio próprio (ignora RLS e o trigger de imutabilidade) e montese_app o recebe por
-- padrão (mesmo padrão de 0002_audit_log.sql e 0068_esocial_events.sql).
REVOKE TRUNCATE ON epi_movements, epi_lots FROM montese_app;
