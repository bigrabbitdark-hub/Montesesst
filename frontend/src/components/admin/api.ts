import { getToken } from '@/lib/auth';

// Chamada autenticada ao backend (via /api do nginx). Sessão ausente ou
// expirada (401) volta ao login. Só roda no navegador.
export async function adminFetch<T>(path: string): Promise<T> {
  const token = getToken();
  if (!token) {
    window.location.href = '/login';
    throw new Error('sem sessão');
  }
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('sessão expirada');
  }
  if (!res.ok) {
    // Leitura: propaga a mensagem do servidor (ex.: 403/404) para quem quiser exibi-la; sem mensagem, segue "HTTP n".
    let msg = '';
    try {
      const m = (await res.json())?.message;
      msg = Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : '';
    } catch {
      /* corpo ilegível */
    }
    throw new AdminApiError(msg.trim() || `HTTP ${res.status}`, res.status, [], [], msg.trim() !== '');
  }
  return (await res.json()) as T;
}

// Escrita autenticada (POST/PUT) com corpo JSON opcional. Mesmo padrão do adminFetch: sem sessão ou 401
// volta ao login. Em erro, lança Error com a mensagem do servidor SEM reescrevê-la (string ou lista do
// class-validator); só usa texto próprio quando o servidor não manda mensagem. Nunca registra nada no console.
// Erro de escrita com o que o servidor mandou além da mensagem: status HTTP e, quando houver, as listas
// `erros`/`pendencias` (ex.: 400 ao publicar a matriz de risco). A mensagem continua sendo a do servidor.
export class AdminApiError extends Error {
  constructor(message: string, readonly status: number, readonly erros: string[] = [], readonly pendencias: string[] = [], readonly doServidor = false) {
    super(message);
    this.name = 'AdminApiError';
  }
}

const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export async function adminSend<T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const token = getToken();
  if (!token) {
    window.location.href = '/login';
    throw new Error('sem sessão');
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error('Não foi possível conectar. Verifique sua conexão e tente novamente.');
  }
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Sessão expirada. Entre novamente.');
  }
  if (!res.ok) {
    let msg = '';
    let erros: string[] = [];
    let pendencias: string[] = [];
    try {
      const corpo = await res.json();
      const m = corpo?.message;
      msg = Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : '';
      erros = textos(corpo?.erros);
      pendencias = textos(corpo?.pendencias);
    } catch {
      /* corpo ilegível: usa a mensagem padrão */
    }
    const padrao =
      res.status === 403 ? 'Você não tem permissão para esta ação.'
      : res.status === 404 ? 'Não encontrado.'
      : res.status === 413 ? 'O conteúdo enviado é grande demais.'
      : 'Não foi possível concluir a ação. Tente novamente.';
    throw new AdminApiError(msg.trim() || padrao, res.status, erros, pendencias, msg.trim() !== '');
  }
  return (await res.json()) as T;
}
