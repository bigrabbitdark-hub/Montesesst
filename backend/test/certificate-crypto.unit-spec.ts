import { randomBytes } from 'crypto';
import { CertificateCryptoService } from '../src/esocial/certificates/certificate-crypto.service';

describe('CertificateCryptoService', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ESOCIAL_CERT_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('sela e dessela um certificado ida e volta preservando pfx e senha', () => {
    const service = new CertificateCryptoService();
    const pfxBuffer = randomBytes(2048);
    const password = 'senha-super-secreta';

    const sealed = service.seal(pfxBuffer, password);
    expect(sealed.encryptedPfx.equals(pfxBuffer)).toBe(false);
    expect(sealed.encryptedPassword).not.toContain(password);

    const unsealed = service.unseal(sealed);
    expect(unsealed.pfxBuffer.equals(pfxBuffer)).toBe(true);
    expect(unsealed.password).toBe(password);
  });

  it('duas chamadas de seal para o mesmo pfx usam data keys diferentes (saídas diferentes)', () => {
    const service = new CertificateCryptoService();
    const pfxBuffer = randomBytes(512);
    const sealedA = service.seal(pfxBuffer, 'senha');
    const sealedB = service.seal(pfxBuffer, 'senha');
    expect(sealedA.encryptedDataKey).not.toBe(sealedB.encryptedDataKey);
    expect(sealedA.encryptedPfx.equals(sealedB.encryptedPfx)).toBe(false);
  });

  it('lança erro claro se ESOCIAL_CERT_ENCRYPTION_KEY não estiver definida', () => {
    delete process.env.ESOCIAL_CERT_ENCRYPTION_KEY;
    const service = new CertificateCryptoService();
    expect(() => service.seal(Buffer.from('x'), 'y')).toThrow(/ESOCIAL_CERT_ENCRYPTION_KEY/);
  });
});
