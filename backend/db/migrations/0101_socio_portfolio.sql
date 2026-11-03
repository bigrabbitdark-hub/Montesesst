-- Painel dos sócios, D0 Task 1: carteira EXPLÍCITA de empresas atendidas pelos sócios.
-- Cria socio_portfolio (uma linha = empresa marcada pelo admin) e redefine is_montese_tenant(uuid) como:
--   (regra da 0091, inalterada: empresa SEM nenhuma linha, de qualquer status, em tenant_technicians/tenant_partners)
--   OR (empresa marcada em socio_portfolio).
-- Estritamente aditiva: a tabela nasce VAZIA, então nenhuma empresa ganha nem perde o status "cliente Montese"
-- até o admin marcar. Todas as policies/consultas que chamam is_montese_tenant() (0092-0099 e backend/src/atuacao)
-- passam a respeitar a marcação sem alteração; CREATE OR REPLACE mantém o OID (dependências das policies), o dono
-- (montese_auth_bypass), SECURITY DEFINER, STABLE, search_path e a ACL de EXECUTE (sem PUBLIC; só montese_app).
-- Marcar uma empresa CONCEDE aos sócios a leitura/escrita já definidas para a carteira Montese (Z, PGR, tarefas...).
-- Acesso a socio_portfolio: só admin (FOR ALL). Sem policy para socio/empresa/tecnico/parceiro = sem acesso; a função
-- (SECURITY DEFINER, dono montese_auth_bypass com BYPASSRLS) lê a tabela por cima da RLS e recebe SELECT explícito.
-- Depende da 0091 (função) e da 0098 (pgr_guard_immutable_tenant, reutilizada no trigger de tenant_id).
--
-- ROLLBACK (manual; descarta as marcações, que são só metadado de carteira — nenhum dado de empresa é apagado;
-- destrutivo para socio_portfolio, só com autorização).
-- ORDEM OBRIGATÓRIA: restaurar a função ANTES de DROP TABLE socio_portfolio. O corpo SQL não cria dependência
-- da tabela; se a tabela cair primeiro, toda chamada a is_montese_tenant() (41 policies do sócio + backend/src/atuacao)
-- falha com 'relation "socio_portfolio" does not exist' (fail-closed: o painel dos sócios para de funcionar).
-- Tudo na MESMA transação:
--   BEGIN;
--   CREATE OR REPLACE FUNCTION is_montese_tenant(p_tenant_id UUID) RETURNS boolean
--   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
--     SELECT NOT EXISTS (SELECT 1 FROM tenant_technicians WHERE tenant_id = p_tenant_id)
--        AND NOT EXISTS (SELECT 1 FROM tenant_partners WHERE tenant_id = p_tenant_id);
--   $$;
--   DROP TABLE socio_portfolio;   (trigger, policy e grants caem junto; pgr_guard_immutable_tenant é da 0098 e fica)
--   DELETE FROM _migrations WHERE name = '0101_socio_portfolio.sql';
--   COMMIT;
--   (CREATE OR REPLACE preserva dono, ACL e OID; conferir depois: pg_proc.proowner = montese_auth_bypass,
--    prosecdef, provolatile = 's', proconfig = {search_path=public, pg_temp}, proacl sem PUBLIC.)
--   Efeito: empresas com técnico/parceiro que estavam marcadas deixam de ser visíveis aos sócios.
SET LOCAL lock_timeout = '5s';

CREATE TABLE socio_portfolio (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT CHECK (note IS NULL OR length(note) <= 500)
);

-- tenant_id é imutável: trocar a empresa de uma marcação equivaleria a marcar outra sem passar pela auditoria.
CREATE TRIGGER trg_a_socio_portfolio_immutable_tenant BEFORE UPDATE ON socio_portfolio
  FOR EACH ROW EXECUTE FUNCTION pgr_guard_immutable_tenant();

ALTER TABLE socio_portfolio ENABLE ROW LEVEL SECURITY;
ALTER TABLE socio_portfolio FORCE ROW LEVEL SECURITY;

-- WITH CHECK: o admin não pode registrar OUTRO usuário como autor da marcação (added_by = o próprio, ou NULL).
CREATE POLICY socio_portfolio_admin ON socio_portfolio USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin'
    AND (added_by IS NULL OR added_by::text = current_setting('app.user_id', true)));

-- Dono da função (BYPASSRLS) precisa de SELECT para o novo corpo; sem ele, toda chamada falharia (fail-closed),
-- não vazaria. Mesmo padrão da 0001 (GRANT SELECT ... tenant_technicians, tenant_partners TO montese_auth_bypass).
GRANT SELECT ON socio_portfolio TO montese_auth_bypass;

-- Privilégios da role da aplicação (UPDATE só para a nota no upsert idempotente do admin). Guardado: a role pode não existir.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'montese_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON socio_portfolio TO montese_app;
  END IF;
END $$;

-- Mesma assinatura, linguagem, volatilidade, SECURITY DEFINER e search_path da 0091; a primeira parte é a regra
-- anterior copiada literalmente. CREATE OR REPLACE não altera dono nem ACL (REVOKE PUBLIC / GRANT montese_app da 0091).
CREATE OR REPLACE FUNCTION is_montese_tenant(p_tenant_id UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT (NOT EXISTS (SELECT 1 FROM tenant_technicians WHERE tenant_id = p_tenant_id)
     AND NOT EXISTS (SELECT 1 FROM tenant_partners WHERE tenant_id = p_tenant_id))
      OR EXISTS (SELECT 1 FROM socio_portfolio WHERE tenant_id = p_tenant_id);
$$;
