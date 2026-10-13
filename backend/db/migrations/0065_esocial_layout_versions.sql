-- backend/db/migrations/0065_esocial_layout_versions.sql
-- Versão vigente do leiaute eSocial (S-1.3, VERIFICADO em docs/specs/esocial-arquitetura.md)
-- e os endpoints de transmissão por ambiente. Global (sem tenant_id): é dado de
-- referência compartilhado por toda a plataforma, não por empresa — mesma categoria
-- de caepi_records.
CREATE TABLE esocial_layout_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_code TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  -- URLs de Produção Restrita: VERIFICADO contra gov.br/esocial em 2026-09-29.
  producao_restrita_envio_url TEXT NOT NULL,
  producao_restrita_consulta_url TEXT NOT NULL,
  -- URLs de Produção real: NÃO VERIFICADAS contra fonte primária (ver spec) —
  -- ficam NULL até serem confirmadas contra o Pacote de Comunicação oficial.
  producao_envio_url TEXT,
  producao_consulta_url TEXT,
  effective_from DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO esocial_layout_versions (
  version_code, is_active,
  producao_restrita_envio_url, producao_restrita_consulta_url,
  effective_from, notes
) VALUES (
  'S-1.3', true,
  'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc',
  'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc',
  CURRENT_DATE,
  'Seed inicial — Sub-projeto 1. URLs de Produção Restrita verificadas em 2026-09-29 contra gov.br/esocial/pt-br/acesso-ao-sistema/ambiente-de-producao-restrita. URLs de Produção real pendentes de confirmação — ver docs/specs/esocial-arquitetura.md, seção Riscos.'
);

-- Achado E-08: as URLs de transmissão só mudam por migration. Sem isto, um bug ou injeção na
-- aplicação poderia redirecionar o envio (feito com o certificado do cliente) a outro endereço.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON esocial_layout_versions FROM montese_app;
