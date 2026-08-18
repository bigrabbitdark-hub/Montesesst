-- Trilha de auditoria: registra mudanças de dado (create/update/delete) e
-- tentativas de login. Não registra leitura (GET) nem valor antes/depois de
-- campo — escopo confirmado com o fundador em 2026-08-18 (ver
-- docs/vision.md seção 9).
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role user_role,
  actor_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  ip_address TEXT,
  detail TEXT
);

CREATE INDEX audit_log_tenant_idx ON audit_log (actor_tenant_id);
CREATE INDEX audit_log_occurred_at_idx ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- Leitura: admin vê tudo; empresa vê só a trilha do próprio tenant (útil
-- pra atender pedido de titular da LGPD). Técnico/parceiro não têm leitura
-- própria nesta primeira versão — sem caso de uso identificado ainda.
CREATE POLICY audit_log_select ON audit_log FOR SELECT USING (
  current_setting('app.role', true) = 'admin'
  OR actor_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
);

-- Escrita: qualquer contexto pode inserir (a aplicação grava log de si
-- mesma, inclusive antes de saber o tenant — ex: tentativa de login
-- falhada). Não é um risco de RLS "vazar" porque isso é só INSERT, nunca
-- SELECT liberado.
CREATE POLICY audit_log_insert ON audit_log FOR INSERT WITH CHECK (true);

-- A trilha de auditoria só serve se resistir a alteração/apagamento —
-- mesmo por bug da aplicação, a role usada pelo backend nunca deve
-- conseguir UPDATE/DELETE/TRUNCATE nesta tabela. TRUNCATE precisa ser
-- revogado à parte: é um privilégio próprio (não coberto por RLS nem por
-- REVOKE DELETE) e montese_app o recebe por padrão via ALTER DEFAULT
-- PRIVILEGES ... GRANT ALL ON TABLES (postgres/init/01-app-role.sh).
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM montese_app;
