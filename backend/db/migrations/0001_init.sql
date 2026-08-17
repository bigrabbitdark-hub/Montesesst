CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('empresa', 'tecnico', 'parceiro', 'admin');
CREATE TYPE record_status AS ENUM ('ativo', 'inativo', 'pendente');

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============ TENANTS (raiz do isolamento, sem RLS própria) ============
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cnpj VARCHAR(14) NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'trial',
  status record_status NOT NULL DEFAULT 'pendente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============ USERS (login de todos os papéis) ============
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL p/ tecnico/parceiro/admin
  role user_role NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  status record_status NOT NULL DEFAULT 'pendente',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_tenant_role CHECK (
    (role = 'empresa' AND tenant_id IS NOT NULL) OR (role IN ('tecnico','parceiro','admin'))
  )
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_tenant_id_idx ON users (tenant_id);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_isolation ON users USING (
  current_setting('app.role', true) = 'admin'
  OR id = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);

-- ============ TECHNICIANS (perfil profissional, entidade global) ============
CREATE TABLE technicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  registration_number TEXT,
  specialization TEXT,
  status record_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_technicians_updated_at BEFORE UPDATE ON technicians
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============ PARTNERS (perfil profissional, entidade global) ============
CREATE TABLE partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  service_region TEXT NOT NULL,
  status record_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_partners_updated_at BEFORE UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============ TENANT_TECHNICIANS (vínculo empresa <-> técnico) ============
CREATE TABLE tenant_technicians (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status record_status NOT NULL DEFAULT 'ativo',
  PRIMARY KEY (tenant_id, technician_id)
);
CREATE INDEX tenant_technicians_technician_idx ON tenant_technicians (technician_id);

-- ============ TENANT_PARTNERS (vínculo empresa <-> parceiro) ============
CREATE TABLE tenant_partners (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status record_status NOT NULL DEFAULT 'ativo',
  PRIMARY KEY (tenant_id, partner_id)
);
CREATE INDEX tenant_partners_partner_idx ON tenant_partners (partner_id);

-- BYPASSRLS só ignora as policies — a role ainda precisa do GRANT normal de
-- SELECT nas tabelas, senão as funções SECURITY DEFINER abaixo (e a de login,
-- auth_find_user_by_email, que também roda como esta role) batem em
-- "permission denied" antes mesmo de a RLS entrar em jogo.
GRANT SELECT ON users, technicians, partners, tenant_technicians, tenant_partners TO montese_auth_bypass;

-- ============ FUNÇÕES DE APOIO PARA AS POLICIES (quebram recursão) ============
-- technicians_isolation precisa consultar tenant_technicians, e
-- tenant_technicians_isolation precisa consultar technicians de volta — se
-- as duas policies se consultarem diretamente (com RLS avaliado em cada
-- consulta), o Postgres detecta recursão infinita entre as policies.
-- A saída padrão é isolar essas leituras em funções SECURITY DEFINER, de
-- propriedade da role montese_auth_bypass (BYPASSRLS), que leem as tabelas
-- SEM reavaliar nenhuma policy — quebrando o ciclo.
CREATE FUNCTION technician_ids_for_tenant(p_tenant_id UUID) RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT technician_id FROM tenant_technicians WHERE tenant_id = p_tenant_id;
$$;

CREATE FUNCTION partner_ids_for_tenant(p_tenant_id UUID) RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT partner_id FROM tenant_partners WHERE tenant_id = p_tenant_id;
$$;

CREATE FUNCTION current_technician_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM technicians WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE FUNCTION current_partner_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM partners WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE FUNCTION assigned_tenant_ids_for_current_user() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tt.tenant_id FROM tenant_technicians tt
  JOIN technicians t ON t.id = tt.technician_id
  WHERE t.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  UNION
  SELECT tp.tenant_id FROM tenant_partners tp
  JOIN partners p ON p.id = tp.partner_id
  WHERE p.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

DO $outer$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'technician_ids_for_tenant(uuid)',
    'partner_ids_for_tenant(uuid)',
    'current_technician_id()',
    'current_partner_id()',
    'assigned_tenant_ids_for_current_user()'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO montese_auth_bypass', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO montese_app', fn);
  END LOOP;
END
$outer$;

-- RLS de technicians/partners depende das tabelas de vínculo acima existirem primeiro
ALTER TABLE technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE technicians FORCE ROW LEVEL SECURITY;
CREATE POLICY technicians_isolation ON technicians USING (
  current_setting('app.role', true) = 'admin'
  OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR id IN (SELECT technician_ids_for_tenant(NULLIF(current_setting('app.tenant_id', true), '')::uuid))
);

ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners FORCE ROW LEVEL SECURITY;
CREATE POLICY partners_isolation ON partners USING (
  current_setting('app.role', true) = 'admin'
  OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR id IN (SELECT partner_ids_for_tenant(NULLIF(current_setting('app.tenant_id', true), '')::uuid))
);

ALTER TABLE tenant_technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_technicians FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_technicians_isolation ON tenant_technicians USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR technician_id = current_technician_id()
);

ALTER TABLE tenant_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_partners FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_partners_isolation ON tenant_partners USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR partner_id = current_partner_id()
);

-- ============ EMPLOYEES (funcionários da empresa cliente) ============
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  cpf VARCHAR(11) NOT NULL,
  birth_date DATE,
  position TEXT,
  admission_date DATE,
  status record_status NOT NULL DEFAULT 'ativo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cpf)
);
CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
CREATE POLICY employees_isolation ON employees USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

-- ============ BOOTSTRAP DE LOGIN ============
-- Problema: no momento do login ainda não sabemos user_id/tenant_id (é o que
-- estamos descobrindo), então a policy de "users" bloquearia a própria busca
-- por e-mail. Solução: uma função SECURITY DEFINER, de propriedade da role
-- montese_auth_bypass (NOLOGIN, BYPASSRLS, não superuser — criada no init do
-- Postgres em postgres/init/01-app-role.sh), só pra esta consulta pontual.
CREATE FUNCTION auth_find_user_by_email(p_email TEXT)
RETURNS TABLE (id UUID, tenant_id UUID, role user_role, password_hash TEXT, status record_status)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, tenant_id, role, password_hash, status FROM users
  WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

ALTER FUNCTION auth_find_user_by_email(TEXT) OWNER TO montese_auth_bypass;
REVOKE ALL ON FUNCTION auth_find_user_by_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_user_by_email(TEXT) TO montese_app;
