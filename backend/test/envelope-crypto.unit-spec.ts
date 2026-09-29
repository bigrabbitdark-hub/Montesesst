import { randomBytes } from 'crypto';
import {
  encryptWithKey,
  decryptWithKey,
  encryptWithKeyToBuffer,
  decryptWithKeyFromBuffer,
  loadMasterKey,
} from '../src/common/crypto/envelope-crypto.util';

describe('envelope-crypto.util', () => {
  it('cifra e decifra um texto ida e volta com a mesma chave', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('senha-do-certificado-123', 'utf8');
    const encoded = encryptWithKey(key, plaintext);
    expect(encoded.split(':')).toHaveLength(3);
    expect(decryptWithKey(key, encoded).toString('utf8')).toBe('senha-do-certificado-123');
  });

  it('duas cifragens do mesmo valor produzem saídas diferentes (IV novo)', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('mesmo valor', 'utf8');
    expect(encryptWithKey(key, plaintext)).not.toBe(encryptWithKey(key, plaintext));
  });

  it('falha ao decifrar com a chave errada', () => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const encoded = encryptWithKey(key, Buffer.from('dado', 'utf8'));
    expect(() => decryptWithKey(wrongKey, encoded)).toThrow();
  });

  it('cifra e decifra um Buffer binário grande ida e volta (formato de blob)', () => {
    const key = randomBytes(32);
    const pfxLike = randomBytes(4096);
    const sealed = encryptWithKeyToBuffer(key, pfxLike);
    expect(sealed.length).toBe(12 + 16 + pfxLike.length);
    expect(decryptWithKeyFromBuffer(key, sealed).equals(pfxLike)).toBe(true);
  });

  it('loadMasterKey rejeita chave ausente ou com tamanho errado', () => {
    delete process.env.TEST_MASTER_KEY_VAR;
    expect(() => loadMasterKey('TEST_MASTER_KEY_VAR')).toThrow(/TEST_MASTER_KEY_VAR/);
    process.env.TEST_MASTER_KEY_VAR = 'curta';
    expect(() => loadMasterKey('TEST_MASTER_KEY_VAR')).toThrow(/TEST_MASTER_KEY_VAR/);
    process.env.TEST_MASTER_KEY_VAR = randomBytes(32).toString('hex');
    expect(loadMasterKey('TEST_MASTER_KEY_VAR')).toBeInstanceOf(Buffer);
    delete process.env.TEST_MASTER_KEY_VAR;
  });
});
