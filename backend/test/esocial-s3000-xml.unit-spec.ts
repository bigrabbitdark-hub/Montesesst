import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePkcs12 } from '../src/esocial/certificates/pkcs12.util';
import { XmlSignerService } from '../src/esocial/signing/xml-signer.service';
import { buildEventId } from '../src/esocial/xml/s2220-xml.builder';
import { buildS3000Xml, S3000Payload } from '../src/esocial/xml/s3000-xml.builder';
import { XsdValidatorService } from '../src/esocial/xml/xsd-validator.service';

const payload: S3000Payload = {
  ambiente: 'producao_restrita',
  empregador: { tpInsc: 1, nrInsc: '12345678000195' },
  tpEvento: 'S-2220',
  nrRecEvt: '1.2.0000000000000000077',
  cpfTrab: '52998224725',
};

describe('S-3000: XML contra o XSD oficial evtExclusao', () => {
  const xsd = new XsdValidatorService();
  const id = buildEventId('12345678', new Date('2026-10-05T12:30:45Z'), 3);
  const xml = buildS3000Xml(payload, id);

  it('o evento assinado passa no XSD oficial inteiro e a assinatura confere', async () => {
    const cert = parsePkcs12(readFileSync(join(__dirname, 'fixtures/esocial/test-certificate.pfx')), 'teste1234');
    const signer = new XmlSignerService();
    const signed = signer.sign(xml, cert.privateKeyPem, cert.certificatePem);
    const r = await xsd.validate('evtExclusao', signed);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(signer.verify(signed, cert.certificatePem)).toBe(true);
  });

  it('sem assinatura o único erro é a Signature ausente', async () => {
    const r = await xsd.validate('evtExclusao', xml);
    expect(r.errors.filter((e) => !/Signature/.test(e))).toEqual([]);
  });

  it('recibo fora do padrão é reprovado', async () => {
    const r = await xsd.validate('evtExclusao', buildS3000Xml({ ...payload, nrRecEvt: '123' }, id));
    expect(r.valid).toBe(false);
    expect(r.errors.join('\n')).toMatch(/nrRecEvt|pattern|length/i);
  });
});
