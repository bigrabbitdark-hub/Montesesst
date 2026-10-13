-- Controle de início e vencimento dos documentos.
--
-- 1) documents ganha 3 colunas OPCIONAIS e aditivas. expires_at continua
--    sendo a data de vencimento (lida por dashboard, conformidade e e-mail
--    semanal) e NÃO é alterada. Nenhum registro existente é tocado (sem
--    backfill, sem UPDATE): históricos ficam com valid_from NULL.
-- 2) document_validity_rules: tabela GLOBAL de parâmetros por categoria.
--    Mesmo padrão de epi_catalog_items (0013) / plans (0006): dado de
--    referência da plataforma, sem tenant_id e sem RLS; a escrita só pelo
--    admin é garantida na camada de aplicação (guard de role), como nas
--    demais tabelas globais. A policy documents_isolation NÃO é alterada.
--
-- Idempotente: pode rodar mais de uma vez sem erro nem efeito colateral.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS valid_from DATE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS expires_source TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS validity_months_applied INT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_expires_source_check') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_expires_source_check
      CHECK (expires_source IN ('manual', 'rule'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_validity_order_check') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_validity_order_check
      CHECK (valid_from IS NULL OR expires_at IS NULL OR expires_at >= valid_from);
  END IF;
END $$;

COMMENT ON COLUMN documents.valid_from IS 'Data de início da vigência informada pelo usuário. NULL em documentos históricos.';
COMMENT ON COLUMN documents.expires_source IS 'Como o vencimento (expires_at) foi definido: manual (usuário) ou rule (regra de document_validity_rules).';
COMMENT ON COLUMN documents.validity_months_applied IS 'Meses da regra usada ao calcular expires_at, para rastreabilidade. NULL quando manual.';

CREATE TABLE IF NOT EXISTS document_validity_rules (
  category TEXT PRIMARY KEY CHECK (category IN (
    'pgr', 'pcmso', 'laudo', 'ficha_epi', 'treinamento',
    'cipa_ata', 'cipa_comunicado', 'cipa_documento_eleitoral', 'cipa_anexo',
    'ltcat', 'lip', 'relatorio_visita'
  )),
  validity_months INT CHECK (validity_months IS NULL OR validity_months BETWEEN 1 AND 600),
  alert_days INT NOT NULL DEFAULT 30 CHECK (alert_days BETWEEN 0 AND 365),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_document_validity_rules_updated_at') THEN
    CREATE TRIGGER trg_document_validity_rules_updated_at BEFORE UPDATE ON document_validity_rules
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

COMMENT ON TABLE document_validity_rules IS 'Parâmetros operacionais configuráveis de vigência por categoria de documento. NÃO são prazos legais nem exigência normativa.';
COMMENT ON COLUMN document_validity_rules.validity_months IS 'Meses sugeridos para calcular o vencimento a partir do início. NULL = sem vencimento automático definido. Parâmetro operacional, não prazo legal.';
COMMENT ON COLUMN document_validity_rules.alert_days IS 'Antecedência (dias) do alerta de vencimento. Parâmetro operacional, não prazo legal.';

INSERT INTO document_validity_rules (category, validity_months, alert_days) VALUES
  ('pcmso', 12, 30),
  ('pgr', 24, 30),
  ('laudo', NULL, 30),
  ('ficha_epi', NULL, 30),
  ('treinamento', NULL, 30),
  ('cipa_ata', NULL, 30),
  ('cipa_comunicado', NULL, 30),
  ('cipa_documento_eleitoral', NULL, 30),
  ('cipa_anexo', NULL, 30),
  ('ltcat', NULL, 30),
  ('lip', NULL, 30),
  ('relatorio_visita', NULL, 30)
ON CONFLICT (category) DO NOTHING;

-- Rollback manual (NÃO executado automaticamente; só se autorizado):
--   DROP TABLE IF EXISTS document_validity_rules;
--   ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_validity_order_check,
--     DROP CONSTRAINT IF EXISTS documents_expires_source_check,
--     DROP COLUMN IF EXISTS valid_from, DROP COLUMN IF EXISTS expires_source,
--     DROP COLUMN IF EXISTS validity_months_applied;
