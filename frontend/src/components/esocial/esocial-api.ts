// Chamadas à API do eSocial (backend: módulo esocial). O tenant NUNCA é enviado: sai do JWT.
export class ApiError extends Error {
  constructor(message: string, public issues?: Array<{ code: string; message: string; blocking: boolean }>) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = typeof window === 'undefined' ? null : localStorage.getItem('montese_token');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, headers: { ...headers, ...(init.headers as any) }, body });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message?.message ?? data?.message ?? 'Não foi possível concluir a ação.';
    throw new ApiError(String(msg), data?.message?.issues ?? data?.issues);
  }
  return data as T;
}

export const STATUS_LABEL: Record<string, { label: string; tone: 'ok' | 'warn' | 'crit' | 'info' }> = {
  rascunho: { label: 'Rascunho (aguarda sua autorização)', tone: 'info' },
  aguardando_transmissao: { label: 'Autorizado, pronto para transmitir', tone: 'warn' },
  transmitindo: { label: 'Transmitindo…', tone: 'warn' },
  transmitido: { label: 'Transmitido, consulte o resultado', tone: 'info' },
  processando: { label: 'Processando no eSocial', tone: 'warn' },
  processado: { label: 'Processado com recibo', tone: 'ok' },
  rejeitado: { label: 'Rejeitado pelo eSocial', tone: 'crit' },
  erro_tecnico: { label: 'Erro técnico (não reenviado)', tone: 'crit' },
  excluido: { label: 'Excluído (S-3000 processado)', tone: 'warn' },
};
