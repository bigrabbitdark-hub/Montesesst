import { createHash, createHmac, randomBytes, randomInt } from 'crypto';
import { EPI_TERM } from '../epi-ficha/epi-ficha-term';
import { canonicalJson, sha256Hex } from '../epi-ficha/canonical-json.util';

export const generateToken = (): string => randomBytes(32).toString('base64url');
export const generatePin = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
// Chave = o próprio token: o código só é conferível por quem tem o token (que só existe em hash no banco).
export const hashPin = (token: string, pin: string): string => createHmac('sha256', token).update(pin).digest('hex');
export const termTextSha256 = (): string => sha256Hex(canonicalJson(EPI_TERM));
// Termo em rascunho só pode ser assinado com a variável ligada (padrão: bloqueado em produção).
export const signatureTermAllowed = (): boolean => !EPI_TERM.draft || process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM === 'true';
