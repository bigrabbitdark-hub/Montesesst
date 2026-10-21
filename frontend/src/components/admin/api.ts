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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

// Escrita autenticada (POST/PUT) com corpo JSON opcional. Mesmo padrão do adminFetch: sem sessão ou 401
// volta ao login. Em erro, lança Error com a mensagem do servidor SEM reescrevê-la (string ou lista do
// class-validator); só usa texto próprio quando o servidor não manda mensagem. Nunca registra nada no console.
export async function adminSend<T>(method: 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
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
    try {
      const corpo = await res.json();
      const m = corpo?.message;
      msg = Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : '';
    } catch {
      /* corpo ilegível: usa a mensagem padrão */
    }
    throw new Error(msg.trim() || (res.status === 403 ? 'Você não tem permissão para esta ação.' : res.status === 404 ? 'Não encontrado.' : 'Não foi possível concluir a ação. Tente novamente.'));
  }
  return (await res.json()) as T;
}
