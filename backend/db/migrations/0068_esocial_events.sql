-- backend/db/migrations/0068_esocial_events.sql
CREATE TABLE esocial_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('S-2220')),
  aso_record_id UUID NOT NULL REFERENCES aso_records(id) ON DELETE RESTRICT, -- E-07: evidência legal não some em cascata
  employee_id UUID NOT NULL REFERENCES employees(id),
  certificate_id UUID NOT NULL REFERENCES esocial_certificates(id),
  layout_version_id UUID NOT NULL REFERENCES esocial_layout_versions(id),
  ambiente TEXT NOT NULL CHECK (ambiente IN ('producao_restrita', 'producao')),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN (
    'rascunho', 'validando', 'assinado', 'aguardando_transmissao',
    'transmitindo', 'transmitido', 'processando', 'processado', 'rejeitado', 'erro_tecnico'
  )),
  retificacao_de_evento_id UUID REFERENCES esocial_events(id),
  ind_retif SMALLINT NOT NULL DEFAULT 1,
  payload_json JSONB NOT NULL,
  xml_generated TEXT,
  xml_signed TEXT,
  nr_recibo TEXT,
  protocolo_lote TEXT,
  erro_codigo TEXT,
  erro_mensagem TEXT,
  idempotency_key TEXT NOT NULL,
  -- Id do evento no XML (36 posições, TS_Id) e identificação do lote enviado.
  event_xml_id TEXT,
  -- G-03: autorização humana explícita antes de assinar/transmitir. O autor fica aqui e no histórico.
  authorized_by_user_id UUID REFERENCES users(id),
  authorized_at TIMESTAMPTZ,
  transmitted_by_user_id UUID REFERENCES users(id),
  transmitted_at TIMESTAMPTZ,
  -- Resposta do eSocial na consulta do lote (código 201/202/4xx e ocorrências), para evidência.
  cd_resposta TEXT,
  retorno_json JSONB,
  last_consulted_at TIMESTAMPTZ,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

ALTER TABLE esocial_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE esocial_events FORCE ROW LEVEL SECURITY;
CREATE POLICY esocial_events_isolation ON esocial_events USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE INDEX esocial_events_tenant_id_idx ON esocial_events(tenant_id);
CREATE INDEX esocial_events_status_idx ON esocial_events(status);
-- Um ASO não pode ter dois eventos S-2220 "vivos" ao mesmo tempo (duplicidade de transmissão).
CREATE UNIQUE INDEX esocial_events_aso_active_uniq ON esocial_events(tenant_id, aso_record_id)
  WHERE status NOT IN ('rejeitado', 'erro_tecnico');

CREATE TABLE esocial_event_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  esocial_event_id UUID NOT NULL REFERENCES esocial_events(id) ON DELETE RESTRICT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  detail TEXT,
  actor_user_id UUID REFERENCES users(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE esocial_event_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE esocial_event_history FORCE ROW LEVEL SECURITY;
CREATE POLICY esocial_event_history_isolation ON esocial_event_history USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

-- Append-only, mesmo mecanismo que já protege audit_log (0002_audit_log.sql):
-- mesmo um bug de aplicação não consegue alterar/apagar uma linha de histórico.
REVOKE UPDATE, DELETE, TRUNCATE ON esocial_event_history FROM montese_app;

CREATE INDEX esocial_event_history_event_id_idx ON esocial_event_history(esocial_event_id);
