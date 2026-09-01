export interface SessionUser {
  id: string;
  role: 'empresa' | 'tecnico' | 'parceiro' | 'admin';
  tenantId: string | null;
}

// Único ponto de leitura/escrita de sessão pra código NOVO (sidebars,
// páginas da Fase 12b) — as páginas já existentes continuam lendo
// localStorage diretamente (ver Global Constraints do plano, não
// refatorado nesta fase, fora de escopo).
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('montese_token');
}

export function getUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('montese_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function logout(): void {
  localStorage.removeItem('montese_token');
  localStorage.removeItem('montese_user');
  window.location.href = '/';
}
