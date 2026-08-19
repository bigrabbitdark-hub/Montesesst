import { createHmac, timingSafeEqual } from 'crypto';

export interface VerifySignatureInput {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
  secret: string;
}

// Formato verificado contra documentação/exemplos oficiais do Mercado
// Pago (2026-08-19): x-signature vem como "ts=<ts>,v1=<hash>"; o manifest
// assinado é "id:<data.id minúsculo>;request-id:<x-request-id>;ts:<ts>;".
// Nunca pular a validação — sem isso, qualquer um poderia bater no
// webhook fingindo que uma assinatura foi aprovada.
export function verifyMercadoPagoSignature(input: VerifySignatureInput): boolean {
  if (!input.xSignature || !input.xRequestId || !input.dataId || !input.secret) return false;

  const parts: Record<string, string> = {};
  for (const part of input.xSignature.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    parts[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1) return false;

  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.xRequestId};ts:${ts};`;
  const expected = createHmac('sha256', input.secret).update(manifest).digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(v1, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
