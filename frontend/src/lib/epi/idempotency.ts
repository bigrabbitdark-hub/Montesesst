// Chave de idempotência (backend exige 8 a 100 caracteres, sem NUL). Gere UMA por tentativa de formulário
// e reutilize no reenvio da mesma operação; gere outra quando o usuário começar uma nova operação.
function fallbackUuid(): string {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const newIdempotencyKey = (): string => globalThis.crypto?.randomUUID?.() ?? fallbackUuid();
