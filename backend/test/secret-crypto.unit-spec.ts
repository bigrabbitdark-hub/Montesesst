import { encryptSecret, decryptSecret } from '../src/common/crypto/secret-crypto.util';

describe('secret-crypto.util', () => {
  const originalKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes em hex
  });

  afterAll(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalKey;
  });

  it('criptografa e decriptografa de volta pro valor original', () => {
    const original = 'refresh-token-super-secreto-1234';
    const encrypted = encryptSecret(original);
    expect(encrypted).not.toBe(original);
    expect(decryptSecret(encrypted)).toBe(original);
  });

  it('duas criptografias do mesmo valor produzem saídas diferentes (IV aleatório)', () => {
    const original = 'mesmo-valor';
    const a = encryptSecret(original);
    const b = encryptSecret(original);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(original);
    expect(decryptSecret(b)).toBe(original);
  });

  it('lança erro claro se a chave não tiver 32 bytes', () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'chave-curta-demais';
    expect(() => encryptSecret('qualquer coisa')).toThrow();
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  });
});
