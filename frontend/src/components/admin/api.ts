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
