import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePkcs12, InvalidCertificateError } from '../src/esocial/certificates/pkcs12.util';

const FIXTURE_PATH = join(__dirname, 'fixtures/esocial/test-certificate.pfx');

describe('parsePkcs12', () => {
  it('extrai certificado, chave privada e metadados de um .pfx válido', () => {
    const pfxBuffer = readFileSync(FIXTURE_PATH);
    const parsed = parsePkcs12(pfxBuffer, 'teste1234');

    expect(parsed.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(parsed.privateKeyPem).toContain('BEGIN');
    expect(parsed.subjectCn).toContain('EMPRESA TESTE LTDA');
    expect(parsed.subjectDocument).toBe('00000000000191');
    expect(parsed.notBefore.getTime()).toBeLessThan(Date.now());
    expect(parsed.notAfter.getTime()).toBeGreaterThan(Date.now());
    expect(parsed.thumbprintSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lança InvalidCertificateError com senha errada', () => {
    const pfxBuffer = readFileSync(FIXTURE_PATH);
    expect(() => parsePkcs12(pfxBuffer, 'senha-errada')).toThrow(InvalidCertificateError);
  });

  it('lança InvalidCertificateError com arquivo que não é PKCS#12', () => {
    const notAPfx = Buffer.from('isto não é um certificado', 'utf8');
    expect(() => parsePkcs12(notAPfx, 'qualquer')).toThrow(InvalidCertificateError);
  });
});

describe('parsePkcs12 com CNPJ alfanumérico no CN', () => {
  it('extrai o documento do titular quando o CNPJ é alfanumérico (e padroniza em maiúsculas)', () => {
    const forge = require('node-forge');
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey; cert.serialNumber = '01';
    cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + 86400000 * 30);
    const attrs = [{ name: 'commonName', value: 'EMPRESA ALFA LTDA:12abc34501de35' }];
    cert.setSubject(attrs); cert.setIssuer(attrs); cert.sign(keys.privateKey, forge.md.sha256.create());
    const p12 = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'senha-x', { algorithm: '3des' })).getBytes();
    const parsed = parsePkcs12(Buffer.from(p12, 'binary'), 'senha-x');
    expect(parsed.subjectDocument).toBe('12ABC34501DE35');
  });
});
