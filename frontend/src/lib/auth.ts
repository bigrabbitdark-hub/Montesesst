import { clearAllSessionKeys, restoreSocioSessionIfActing } from './acting';
import { isTokenExpired } from './jwt';

export interface SessionUser {
  id: string;
  role: 'empresa' | 'tecnico' | 'parceiro' | 'admin' | 'socio';
  tenantId: string | null;
  // Senha temporária: o backend bloqueia tudo até a troca em /trocar-senha.
  mustChangePassword?: boolean;
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

// Ponto único de limpeza da sessão: inclui a sessão guardada da sócia e o estado de atuação,
// para que o próximo login não herde o banner nem a sessão dela.
export function clearSession(): void {
  clearAllSessionKeys();
}

// Sessão ausente/expirada (401): limpa a sessão local e volta ao login (mesmo padrão das páginas da empresa).
export function sessionExpired(): void {
  // Token de atuação vencido/recusado: volta para a sessão da sócia em vez de derrubar o login dela.
  if (restoreSocioSessionIfActing()) { window.location.href = '/atuacao/clientes?atuacao=expirada'; return; }
  clearSession();
  window.location.href = '/login';
}

export function logout(): void {
  clearSession();
  window.location.href = '/';
}

// Página inicial de cada papel (mesmo mapeamento do login). Usado para mandar
// quem está logado com o papel errado de volta ao lugar dele.
export function homeFor(role: SessionUser['role']): string {
  if (role === 'empresa') return '/dashboard-v2';
  if (role === 'tecnico' || role === 'parceiro') return '/tecnico/empresas';
  if (role === 'admin') return '/admin/overview';
  if (role === 'socio') return '/atuacao';
  return '/';
}

// Só UX: evita renderizar telas com um token que o backend vai recusar. A
// autorização de verdade continua 100% no backend. (Implementação em lib/jwt.)
export { isTokenExpired };
