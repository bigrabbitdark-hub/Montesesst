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
