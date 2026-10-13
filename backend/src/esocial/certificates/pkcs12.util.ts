import * as forge from 'node-forge';

export class InvalidCertificateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCertificateError';
  }
}

export interface ParsedCertificate {
  certificatePem: string;
  privateKeyPem: string;
  subjectCn: string;
  subjectDocument: string | null;
  notBefore: Date;
  notAfter: Date;
  thumbprintSha256: string;
}

// Extrai a "razão social:CNPJ" (ou CPF) do padrão de CN usado em certificados
// ICP-Brasil de pessoa jurídica — formato "<nome>:<CNPJ 14 dígitos>". Se não bater
// o padrão, retorna null em vez de adivinhar (nunca inventar dado do titular).
function extractDocumentFromCn(cn: string): string | null {
  // CPF (11 dígitos) ou CNPJ de 14 posições. A partir de julho/2026 o CNPJ pode ser alfanumérico (12 caracteres
  // A-Z/0-9 + 2 dígitos verificadores), e o eSocial só aceita letras maiúsculas (Manual do Desenvolvedor v1.16, 6.9).
  const match = cn.toUpperCase().match(/:(\d{11}|[A-Z0-9]{12}\d{2})$/);
  return match ? match[1] : null;
}

export function parsePkcs12(pfxBuffer: Buffer, password: string): ParsedCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
  } catch (err) {
    throw new InvalidCertificateError(
      'Não foi possível abrir o certificado — verifique se o arquivo é um .pfx/.p12 válido e a senha está correta',
    );
  }

  // E-04: arquivos A1 ICP-Brasil costumam trazer a cadeia (folha + intermediárias) em ordem
  // qualquer. Escolhe o certificado cujo módulo RSA casa com o da chave privada, nunca o primeiro.
  const keyBags = {
    ...p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag],
  };
  const privateKey = (Object.values(keyBags)[0] as any)?.key as forge.pki.rsa.PrivateKey | undefined;
  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);

  if (!privateKey || !('n' in privateKey) || certs.length === 0) {
    throw new InvalidCertificateError(
      'O arquivo não contém um certificado e uma chave privada válidos',
    );
  }
  const cert = certs.find((c) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    return pub?.n && pub.n.compareTo(privateKey.n) === 0;
  });
  if (!cert) {
    throw new InvalidCertificateError(
      'Nenhum certificado do arquivo corresponde à chave privada (verifique a cadeia do .pfx)',
    );
  }

  const cn = cert.subject.getField('CN')?.value ?? '';
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const thumbprint = forge.md.sha256.create().update(certDer).digest().toHex();

  return {
    certificatePem: forge.pki.certificateToPem(cert),
    privateKeyPem: forge.pki.privateKeyToPem(privateKey as forge.pki.rsa.PrivateKey),
    subjectCn: cn,
    subjectDocument: extractDocumentFromCn(cn),
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    thumbprintSha256: thumbprint,
  };
}
