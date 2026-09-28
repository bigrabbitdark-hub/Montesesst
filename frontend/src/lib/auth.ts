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

// Página inicial de cada papel (mesmo mapeamento do login). Usado para mandar
// quem está logado com o papel errado de volta ao lugar dele.
export function homeFor(role: SessionUser['role']): string {
  if (role === 'empresa') return '/empresa/dashboard';
  if (role === 'tecnico' || role === 'parceiro') return '/tecnico/empresas';
  if (role === 'admin') return '/admin/overview';
  return '/';
}

// Só UX: evita renderizar telas com um token que o backend vai recusar. A
// autorização de verdade continua 100% no backend.
export function isTokenExpired(token: string): boolean {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const { exp } = JSON.parse(json);
    return typeof exp === 'number' && exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}
