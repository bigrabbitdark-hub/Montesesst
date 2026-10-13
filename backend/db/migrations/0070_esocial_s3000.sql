-- backend/db/migrations/0070_esocial_s3000.sql
-- S-3000 (Exclusão de Eventos): um evento que aponta para OUTRO evento já processado (com recibo).
-- Só altera restrições e acrescenta uma coluna; não mexe em dados existentes.

ALTER TABLE esocial_events DROP CONSTRAINT esocial_events_event_type_check;
ALTER TABLE esocial_events ADD CONSTRAINT esocial_events_event_type_check
  CHECK (event_type IN ('S-2220', 'S-3000'));

-- 'excluido' = o evento original perdeu efeito porque um S-3000 foi processado com recibo.
ALTER TABLE esocial_events DROP CONSTRAINT esocial_events_status_check;
ALTER TABLE esocial_events ADD CONSTRAINT esocial_events_status_check CHECK (status IN (
  'rascunho', 'validando', 'assinado', 'aguardando_transmissao',
  'transmitindo', 'transmitido', 'processando', 'processado', 'rejeitado', 'erro_tecnico', 'excluido'
));

-- Evento excluído pelo S-3000. RESTRICT: a evidência legal não some em cascata (E-07).
ALTER TABLE esocial_events ADD COLUMN target_event_id UUID REFERENCES esocial_events(id) ON DELETE RESTRICT;
ALTER TABLE esocial_events ADD CONSTRAINT esocial_events_s3000_target_chk
  CHECK ((event_type = 'S-3000') = (target_event_id IS NOT NULL));

-- "Um ASO, um S-2220 ativo" passa a valer só para S-2220 (o S-3000 repete o aso_record_id do alvo),
-- e um S-2220 excluído libera o ASO para um novo envio.
DROP INDEX esocial_events_aso_active_uniq;
CREATE UNIQUE INDEX esocial_events_aso_active_uniq ON esocial_events(tenant_id, aso_record_id)
  WHERE event_type = 'S-2220' AND status NOT IN ('rejeitado', 'erro_tecnico', 'excluido');

-- Um evento só pode ter uma exclusão ativa.
CREATE UNIQUE INDEX esocial_events_s3000_active_uniq ON esocial_events(tenant_id, target_event_id)
  WHERE event_type = 'S-3000' AND status NOT IN ('rejeitado', 'erro_tecnico');
