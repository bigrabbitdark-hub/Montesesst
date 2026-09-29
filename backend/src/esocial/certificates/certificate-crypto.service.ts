import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  encryptWithKey,
  decryptWithKey,
  encryptWithKeyToBuffer,
  decryptWithKeyFromBuffer,
  loadMasterKey,
} from '../../common/crypto/envelope-crypto.util';

export interface SealedCertificate {
  encryptedPfx: Buffer;
  encryptedPassword: string;
  encryptedDataKey: string;
}

const MASTER_KEY_ENV_VAR = 'ESOCIAL_CERT_ENCRYPTION_KEY';

// Envelope encryption: cada certificado ganha uma data key aleatória (nunca
// reaproveitada entre certificados), que cifra o .pfx e a senha. A data key em si
// é cifrada pela chave mestra (env var acima). Migração futura para KMS real troca
// só quem cifra a data key (esta classe) — o resto do dado não precisa ser recifrado.
// Ver docs/specs/esocial-seguranca.md, seção 1.
@Injectable()
export class CertificateCryptoService {
  seal(pfxBuffer: Buffer, password: string): SealedCertificate {
    const masterKey = loadMasterKey(MASTER_KEY_ENV_VAR);
    const dataKey = randomBytes(32);
    const encryptedPfx = encryptWithKeyToBuffer(dataKey, pfxBuffer);
    const encryptedPassword = encryptWithKey(dataKey, Buffer.from(password, 'utf8'));
    const encryptedDataKey = encryptWithKey(masterKey, dataKey);
    return { encryptedPfx, encryptedPassword, encryptedDataKey };
  }

  unseal(sealed: SealedCertificate): { pfxBuffer: Buffer; password: string } {
    const masterKey = loadMasterKey(MASTER_KEY_ENV_VAR);
    const dataKey = decryptWithKey(masterKey, sealed.encryptedDataKey);
    const pfxBuffer = decryptWithKeyFromBuffer(dataKey, sealed.encryptedPfx);
    const password = decryptWithKey(dataKey, sealed.encryptedPassword).toString('utf8');
    return { pfxBuffer, password };
  }
}
