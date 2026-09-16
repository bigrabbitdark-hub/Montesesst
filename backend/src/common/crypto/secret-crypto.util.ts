import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// AES-256-GCM: primeira credencial de terceiro armazenada neste banco
// (refresh token do Google — ver GoogleCalendarService). A chave vem de
// GOOGLE_TOKEN_ENCRYPTION_KEY, 32 bytes em hex (gerar com
// `openssl rand -hex 32`, documentado no plano de implementação). Cada
// chamada de encryptSecret usa um IV novo (obrigatório em GCM — reusar
// IV com a mesma chave quebra a garantia de confidencialidade), por
// isso duas criptografias do mesmo valor produzem saídas diferentes.
const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const hex = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'GOOGLE_TOKEN_ENCRYPTION_KEY ausente ou com tamanho errado (esperado 64 caracteres hex = 32 bytes)',
    );
  }
  return Buffer.from(hex, 'hex');
}

// Formato de saída: "<iv-hex>:<authTag-hex>:<ciphertext-hex>" — os 3
// componentes são necessários pra decriptar (GCM produz um auth tag
// separado do ciphertext).
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(encoded: string): string {
  const key = getKey();
  const [ivHex, authTagHex, ciphertextHex] = encoded.split(':');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}
