export function authHeaders() {
  const token = localStorage.getItem('montese_token');
  return { Authorization: `Bearer ${token}` };
}

// Texto de erro da API (NestJS devolve `message` como string ou lista de strings).
export function mensagemDaApi(body: { message?: unknown } | null, padrao: string): string {
  const m = body?.message;
  if (Array.isArray(m)) return m.join('; ');
  return typeof m === 'string' && m ? m : padrao;
}
