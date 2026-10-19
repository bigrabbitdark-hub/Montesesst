import { Injectable } from '@nestjs/common';
import { SignedXml } from 'xml-crypto';

const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';

function certBase64(certificatePem: string): string {
  return certificatePem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
}

// Assinatura do evento conforme Manual de Orientação do Desenvolvedor v1.16, seção 6.7:
// XMLDSig enveloped, Reference URI="" (documento inteiro), transformações enveloped-signature +
// C14N 1.0, RSA-SHA256, digest SHA-256, KeyInfo só com X509Certificate (EndCertOnly), sem prefixo.
@Injectable()
export class XmlSignerService {
  sign(xml: string, privateKeyPem: string, certificatePem: string): string {
    const sig = new SignedXml({
      privateKey: privateKeyPem,
      publicCert: certificatePem,
      signatureAlgorithm: RSA_SHA256,
      canonicalizationAlgorithm: C14N,
      getKeyInfoContent: () => `<X509Data><X509Certificate>${certBase64(certificatePem)}</X509Certificate></X509Data>`,
    });
    sig.addReference({
      xpath: '/*',
      uri: '',
      isEmptyUri: true,
      transforms: [ENVELOPED, C14N],
      digestAlgorithm: SHA256,
    });
    sig.computeSignature(xml, { location: { reference: '/*', action: 'append' } });
    return sig.getSignedXml();
  }

  // Usado nos testes e como conferência antes de transmitir: confere a assinatura com o
  // certificado que a produziu. Não substitui a validação do servidor (cadeia ICP-Brasil, LCR).
  verify(signedXml: string, certificatePem: string): boolean {
    const v = new SignedXml({ publicCert: certificatePem });
    // xml-crypto precisa localizar o nó Signature no documento.
    const { DOMParser } = require('@xmldom/xmldom');
    const doc = new DOMParser().parseFromString(signedXml, 'text/xml');
    const sigNode = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
    if (!sigNode) return false;
    v.loadSignature(sigNode);
    return v.checkSignature(signedXml);
  }
}
