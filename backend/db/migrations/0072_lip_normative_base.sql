-- Base normativa do LIP (docs/superpowers/specs/2026-10-09-base-normativa-lip-design.md).
-- Camada 2 do conhecimento normativo: dispositivos LITERAIS (gerados por parser determinístico
-- sobre normative_documents) separados das regras INTERPRETATIVAS (lip_rules, sempre revisadas
-- por humano). Conhecimento compartilhado entre tenants — SEM tenant_id, SEM RLS (mesma
-- categoria de official_sources/normative_documents). Só aditiva.

CREATE TABLE normative_provisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES normative_documents(id) ON DELETE CASCADE,
  norma text NOT NULL,
  -- '' = corpo da norma (fora de anexo); evita NULL na UNIQUE.
  anexo text NOT NULL DEFAULT '',
  item_path text NOT NULL,
  literal_text text NOT NULL,
  -- char_start/char_end: offsets 0-based em PONTOS DE CÓDIGO Unicode (não unidades UTF-16 do JS);
  -- literal_text = substring(raw_text from char_start + 1 for char_end - char_start).
  char_start integer NOT NULL,
  char_end integer NOT NULL,
  -- Cópia de normative_documents.content_hash no momento da geração: prova de qual versão.
  document_hash text NOT NULL,
  parser_version text NOT NULL,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'obsoleto')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT normative_provisions_span CHECK (char_start >= 0 AND char_end > char_start),
  CONSTRAINT normative_provisions_unique UNIQUE (document_id, anexo, item_path, parser_version)
);

CREATE INDEX normative_provisions_lookup_idx ON normative_provisions (norma, anexo) WHERE status = 'ativo';

CREATE TABLE lip_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  categoria text NOT NULL CHECK (categoria IN ('insalubridade', 'periculosidade', 'prevencao', 'previdenciario')),
  agente_ou_atividade text NOT NULL,
  metodo_avaliacao text NOT NULL CHECK (metodo_avaliacao IN ('quantitativo', 'qualitativo', 'misto', 'nao_aplicavel')),
  unidade text,
  -- Aponta ao dispositivo literal; números só entram se vierem do dispositivo vinculado.
  criterio text NOT NULL,
  excecoes text,
  dependencias jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Interpretação técnica da Montese: SEMPRE separada do trecho literal.
  interpretacao text NOT NULL,
  exige_revisao_profissional boolean NOT NULL DEFAULT true,
  vigencia_inicio date,
  vigencia_fim date,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'revisada', 'revisar', 'retirada')),
  reviewed_by_user_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  reviewer_registro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lip_rules_vigencia CHECK (vigencia_fim IS NULL OR vigencia_inicio IS NULL OR vigencia_fim >= vigencia_inicio),
  CONSTRAINT lip_rules_revisada_exige_revisor CHECK (
    status <> 'revisada'
    OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND length(trim(coalesce(reviewer_registro, ''))) > 0)
  )
);

CREATE INDEX lip_rules_categoria_status_idx ON lip_rules (categoria, status);

CREATE TABLE lip_rule_provisions (
  rule_id uuid NOT NULL REFERENCES lip_rules(id) ON DELETE CASCADE,
  -- RESTRICT: apagar um dispositivo ligado a uma regra não pode deixar a regra 'revisada' sem fundamento;
  -- o fluxo normal é marcar o dispositivo 'obsoleto' (o gancho rebaixa a regra para 'revisar').
  provision_id uuid NOT NULL REFERENCES normative_provisions(id) ON DELETE RESTRICT,
  papel text NOT NULL CHECK (papel IN ('fundamento', 'criterio', 'excecao', 'metodo')),
  PRIMARY KEY (rule_id, provision_id, papel)
);

CREATE INDEX lip_rule_provisions_provision_idx ON lip_rule_provisions (provision_id);

-- Uma regra só pode estar 'revisada' se tiver ao menos um dispositivo literal ATIVO vinculado.
CREATE FUNCTION lip_rules_require_active_provision() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'revisada' AND NOT EXISTS (
    SELECT 1
    FROM lip_rule_provisions rp
    JOIN normative_provisions p ON p.id = rp.provision_id
    WHERE rp.rule_id = NEW.id AND p.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'lip_rules: regra revisada exige ao menos um dispositivo literal ativo vinculado'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lip_rules_require_active_provision
  BEFORE INSERT OR UPDATE ON lip_rules
  FOR EACH ROW EXECUTE FUNCTION lip_rules_require_active_provision();
