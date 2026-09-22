-- Etapas 2 e 3 da Confiabilidade do Assistente
-- (docs/specs/assistente-confiabilidade-etapa-2-3.md §4.3): log de uso real do
-- Assistente, SÓ metadados e ids — NUNCA o texto da pergunta, das claims nem
-- da resposta. Serve para medir recuperação, falsos positivos do verificador
-- (números com unidade sinalizados) e custo sem tocar em dado de empresa.
--
-- Privacidade dos tokens: `blocking_tokens` e `flagged_numbers` só são
-- gravados quando a claim citava EXCLUSIVAMENTE trechos normativos oficiais
-- (regra aplicada em query-trace.ts, antes de chegar aqui). `retrieved` guarda
-- ids só de fontes de referência (normas e checklist); fontes da empresa entram
-- como similaridade, sem ids. `question_hash` (SHA-256) serve para contar
-- perguntas repetidas — NÃO é anonimização forte.
--
-- Somente aditiva. Retenção de 90 dias (job diário em
-- AssistantQueryLogService). RLS no mesmo padrão de audit_log (0002): qualquer
-- contexto grava (o query() roda com qualquer papel), só admin lê e apaga.
CREATE TABLE assistant_query_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  role text NOT NULL CHECK (role IN ('empresa', 'tecnico', 'parceiro', 'admin')),
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  question_hash text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('respondeu', 'fallback_sem_evidencia', 'fallback_claims_descartadas')),
  notices text[] NOT NULL DEFAULT '{}',
  retrieved jsonb NOT NULL,
  claims_total int NOT NULL,
  claims_dropped_ids int NOT NULL,
  claims_dropped_support int NOT NULL,
  blocking_tokens text[] NOT NULL DEFAULT '{}',
  flagged_numbers text[] NOT NULL DEFAULT '{}',
  used_attachment boolean NOT NULL DEFAULT false,
  model text,
  latency_ms int NOT NULL,
  retrieval_ms int NOT NULL
);

CREATE INDEX assistant_query_log_created_at_idx ON assistant_query_log (created_at);

ALTER TABLE assistant_query_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_query_log FORCE ROW LEVEL SECURITY;

CREATE POLICY assistant_query_log_select ON assistant_query_log FOR SELECT USING (
  current_setting('app.role', true) = 'admin'
);

-- Escrita: qualquer contexto pode inserir (mesmo raciocínio de audit_log_insert).
-- É só INSERT: nunca libera SELECT. O INSERT não pode usar RETURNING, porque
-- o RETURNING exige passar pela policy de SELECT (só admin).
CREATE POLICY assistant_query_log_insert ON assistant_query_log FOR INSERT WITH CHECK (true);

-- Apagar (retenção): só admin. Não há policy de UPDATE: o log não é editável.
CREATE POLICY assistant_query_log_delete ON assistant_query_log FOR DELETE USING (
  current_setting('app.role', true) = 'admin'
);
