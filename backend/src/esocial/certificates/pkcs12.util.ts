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
  const match = cn.match(/:(\d{11}|\d{14})$/);
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

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const cert = certBags[forge.pki.oids.certBag]?.[0]?.cert;
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const privateKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;

  if (!cert || !privateKey) {
    throw new InvalidCertificateError(
      'O arquivo não contém um certificado e uma chave privada válidos',
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
