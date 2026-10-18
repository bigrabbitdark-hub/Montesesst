-- 0079 — Montese IA: configuração de provedores de IA (chave de API + modelo)
-- editável pelo admin via /admin/ia, sem editar .env no servidor.
--
-- Escopo (Opção A, ver docs/assistente-montese-principios.md):
--   • Apenas chave de API e modelo de cada provedor são editáveis no painel.
--   • O binding provider↔capacidade continua decidido via `useClass` em cada
--     .module.ts (troca exige deploy, alinhado com AGENTS.md "Não alterar
--     provider/modelo sem autorização").
--   • Sem toggle on/off em runtime nesta versão (cosmético não cria ilusão de
--     desligar um provedor que continua selecionado no .module.ts).
--   • Sem multi-tenant: config é global (mesma categoria de minimax_usage_log
--     e openrouter_credit_status — dado operacional da CONTA, não de tenant).
--
-- Segurança (LGPD / "nunca expor secrets"):
--   • api_key gravada cifrada com pgcrypto (pgp_sym_encrypt), chave mestra
--     SOMENTE em env var (AI_CONFIG_ENCRYPTION_KEY), NUNCA no banco.
--   • RLS estrita: policy libera só role='admin'. Empresa/técnico/parceiro
--     não têm leitura NEM escrita. Se a env var da chave mestra sumir, a
--     leitura cai com erro (pior cenário: o painel mostra "config indisponível"
--     — não vaza nada).
--   • AuditInterceptor (global) já loga toda mudança com actor_user_id, path,
--     status_code, ip_address. A coluna detail registra o provider e o que
--     mudou (NÃO o valor da chave — ver comentário no service).
--
-- Compatibilidade:
--   • Tabela começa vazia. AiConfigService cai pra process.env.* quando não
--     há config no banco, então deploys atuais (que ainda dependem de env
--     vars) continuam funcionando sem migração de dados.

CREATE TABLE ai_provider_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'minimax' | 'openrouter' | 'groq' (únicos atualmente integrados).
  provider TEXT NOT NULL UNIQUE CHECK (provider IN ('minimax', 'openrouter', 'groq')),
  -- BYTEA (não TEXT): saída de pgp_sym_encrypt. SELECT sempre passa por
  -- pgp_sym_decrypt com a chave mestra vinda do env, então o app nunca
  -- lê o bytea direto.
  api_key_encrypted BYTEA NOT NULL,
  -- Modelo default quando vazio é resolvido pelo AiConfigService a partir
  -- do provider (mesmo default hoje embutido em cada consumer).
  model TEXT NOT NULL,
  -- Quem atualizou por último (denormalizado pra evitar JOIN com users em
  -- toda listagem do painel). Nullable em inserções programáticas futuras.
  updated_by_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_ai_provider_configs_updated_at
  BEFORE UPDATE ON ai_provider_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE ai_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_provider_configs FORCE ROW LEVEL SECURITY;

-- Leitura/escrita só pra role='admin'. Sem WITH CHECK separado na policy de
-- INSERT: USING já cobre SELECT e o `FOR ALL` cobre INSERT/UPDATE/DELETE.
-- Empresa/técnico/parceiro não chegam aqui em nenhum caso de uso conhecido.
CREATE POLICY ai_provider_configs_admin_only ON ai_provider_configs
  FOR ALL
  USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');

-- Mesmo tratamento da trilha de auditoria: app role não pode UPDATE/DELETE
-- via bug da aplicação (FORCE RLS + REVOKE abaixo). INSERT via policy admin
-- continua válido pra permitir gravação pela própria tela /admin/ia.
REVOKE UPDATE, DELETE, TRUNCATE ON ai_provider_configs FROM montese_app;