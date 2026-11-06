// bcrypt usa só os primeiros 72 BYTES da senha (UTF-8): 'ç' e acentos ocupam 2 bytes, emojis 4.
// Mesma regra do backend (@MaxBytes(72), Ruling 26); aqui é só UX — o servidor recusa de qualquer forma.
export const SENHA_MAX_BYTES = 72;
export const MSG_SENHA_72_BYTES = 'A senha não pode passar de 72 bytes (acentos e símbolos contam mais de 1)';

export function senhaPassaDe72Bytes(senha: string): boolean {
  return new TextEncoder().encode(senha).length > SENHA_MAX_BYTES;
}
