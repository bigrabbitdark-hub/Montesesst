CREATE TABLE esocial_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  subject_cn TEXT NOT NULL,
  subject_document TEXT,
  thumbprint_sha256 TEXT NOT NULL,
  not_before TIMESTAMPTZ NOT NULL,
  not_after TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'expirado', 'invalido', 'removido')),
  -- Blob do .pfx cifrado (envelope encryption) vive no R2, nunca em coluna de banco
  -- nem em disco — ver certificate-crypto.service.ts e certificates.service.ts.
  pfx_r2_key TEXT NOT NULL,
  -- "<iv-hex>:<authTag-hex>:<ciphertext-hex>" (ver backend/src/common/crypto/envelope-crypto.util.ts).
  -- encrypted_password é cifrada pela data key; encrypted_data_key é a data key cifrada
  -- pela chave mestra ESOCIAL_CERT_ENCRYPTION_KEY. Nunca a senha em texto puro.
  encrypted_password TEXT NOT NULL,
  encrypted_data_key TEXT NOT NULL,
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE esocial_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE esocial_certificates FORCE ROW LEVEL SECURITY;
CREATE POLICY esocial_certificates_isolation ON esocial_certificates USING (
  current_setting('app.role', true) = 'admin'
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  OR tenant_id IN (SELECT assigned_tenant_ids_for_current_user())
);

CREATE INDEX esocial_certificates_tenant_id_idx ON esocial_certificates(tenant_id);
