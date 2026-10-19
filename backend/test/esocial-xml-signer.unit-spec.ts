import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePkcs12 } from '../src/esocial/certificates/pkcs12.util';
import { XmlSignerService } from '../src/esocial/signing/xml-signer.service';
import { XsdValidatorService } from '../src/esocial/xml/xsd-validator.service';
import { buildEventId, buildS2220Xml } from '../src/esocial/xml/s2220-xml.builder';
import { S2220Payload } from '../src/esocial/xml/s2220.types';

const payload: S2220Payload = {
  ambiente: 'producao_restrita',
  empregador: { tpInsc: 1, nrInsc: '12345678000195' },
  trabalhador: { cpf: '12345678909', matricula: 'M-001', codCateg: '101' },
  tpExameOcup: 0,
  aso: {
    dtAso: '2026-09-15',
    resAso: 1,
    exames: [{ dtExm: '2026-09-15', procRealizado: '0281', ordExame: 1 }],
    medico: { nmMed: 'Dra. Ana', nrCRM: '12345', ufCRM: 'SP' },
  },
  indRetif: 1,
};

describe('assinatura XMLDSig do evento (padrão do Manual do Desenvolvedor v1.16, 6.7)', () => {
  const cert = parsePkcs12(readFileSync(join(__dirname, 'fixtures/esocial/test-certificate.pfx')), 'teste1234');
  const signer = new XmlSignerService();
  const xml = buildS2220Xml(payload, buildEventId('12345678', new Date('2026-10-05T12:00:00Z'), 7));
  const signed = signer.sign(xml, cert.privateKeyPem, cert.certificatePem);

  it('usa RSA-SHA256, digest SHA-256, enveloped + C14N, URI vazia e só X509Certificate', () => {
    expect(signed).toContain('Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"');
    expect(signed).toContain('Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"');
    expect(signed).toContain('Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"');
    expect(signed).toContain('Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"');
    expect(signed).toMatch(/<Reference[^>]*URI=""/);
    expect(signed).not.toMatch(/<ds:/);
    expect((signed.match(/<X509Certificate>/g) || []).length).toBe(1);
    expect(signed).not.toMatch(/<X509(IssuerSerial|SubjectName|SKI)/);
  });

  it('o evento assinado passa no XSD oficial inteiro (Signature incluída) e a assinatura confere', async () => {
    const r = await new XsdValidatorService().validate('evtMonit', signed);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(signer.verify(signed, cert.certificatePem)).toBe(true);
  });

  it('adulterar qualquer campo depois de assinar invalida a assinatura', () => {
    const tampered = signed.replace('<tpExameOcup>0</tpExameOcup>', '<tpExameOcup>1</tpExameOcup>');
    expect(tampered).not.toBe(signed);
    expect(signer.verify(tampered, cert.certificatePem)).toBe(false);
  });
});
