-- Fase 17: Consulta de CA — espelho local da base pública do MTE
-- (sistema CAEPI). Diferente de toda tabela CIPA deste projeto: é
-- dado público global, igual pra qualquer tenant — sem tenant_id,
-- sem RLS. Ver docs/specs/fase-17-consulta-ca.md.

CREATE TABLE caepi_records (
  numero_ca TEXT PRIMARY KEY,
  data_validade DATE,
  situacao TEXT,
  numero_processo TEXT,
  cnpj TEXT,
  razao_social TEXT,
  natureza TEXT,
  equipamento TEXT,
  descricao_equipamento TEXT,
  marca_ca TEXT,
  referencia TEXT,
  cor TEXT,
  aprovado_laudo TEXT,
  restricao_laudo TEXT,
  observacao_laudo TEXT,
  cnpj_laboratorio TEXT,
  razao_social_laboratorio TEXT,
  numero_laudo TEXT,
  norma TEXT,
  -- Sem trigger set_updated_at() (padrão do resto do projeto) de
  -- propósito — a única gravação nesta tabela é o upsert em lote do
  -- script de sincronização (Task 2), que já sabe o timestamp exato
  -- e grava explicitamente no SET do próprio upsert. Um trigger
  -- disparando em cada uma de até centenas de milhares de linhas por
  -- sincronização seria overhead sem propósito real aqui.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uma linha só (id fixo em 1), sempre substituída por upsert — guarda
-- quando a última sincronização rodou, pra exibir na tela de busca.
CREATE TABLE caepi_sync_status (
  id INT PRIMARY KEY DEFAULT 1,
  last_synced_at TIMESTAMPTZ NOT NULL,
  rows_imported INT NOT NULL,
  rows_skipped INT NOT NULL,
  CONSTRAINT chk_single_row CHECK (id = 1)
);

-- Nenhuma das duas tabelas tem RLS — dado público, não pertence a
-- nenhum tenant. Qualquer usuário autenticado (empresa/tecnico/
-- parceiro) pode ler via a API (Task 3).
