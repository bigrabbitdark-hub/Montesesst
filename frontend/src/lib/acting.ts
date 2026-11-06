// Modo "atuar como empresa" (sócia). As páginas da empresa leem o token direto de localStorage['montese_token'];
// por isso o token de atuação ocupa esse slot e a sessão REAL da sócia fica guardada à parte. Quem autoriza é o
// backend (claim `act` + revalidação a cada requisição); aqui é só UX. Limitação conhecida: localStorage é
// compartilhado entre abas — abrir outra aba durante a atuação mostra a área da empresa.
import { isTokenExpired } from './jwt';

const SOCIO_KEY = 'montese_socio_session';
const ACTING_KEY = 'montese_acting';

// Avisa quem observa o modo atuação (useAtuando) na mesma aba; o evento 'storage' só chega às OUTRAS abas.
export const ACTING_EVENT = 'montese:acting-changed';
function emitirMudanca(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ACTING_EVENT));
}

export interface ActingInfo { tenantId: string; tenantName: string; expiresAt: number }

// Remove as duas chaves do modo atuação (sessão guardada da sócia e info da atuação).
export function clearActingKeys(): void {
  localStorage.removeItem(SOCIO_KEY);
  localStorage.removeItem(ACTING_KEY);
  emitirMudanca();
}

// Limpa TUDO (sessão ativa + sessão guardada + atuação). lib/auth.clearSession delega para cá; fica aqui
// para stopActing poder usá-la sem import circular.
export function clearAllSessionKeys(): void {
  localStorage.removeItem('montese_token');
  localStorage.removeItem('montese_user');
  clearActingKeys();
}

export function getActing(): ActingInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ACTING_KEY);
    return raw ? (JSON.parse(raw) as ActingInfo) : null;
  } catch {
    return null;
  }
}

export function startActing(token: string, expiresInSeconds: number, tenant: { id: string; name: string }): boolean {
  const sessao = localStorage.getItem('montese_token');
  const userRaw = localStorage.getItem('montese_user');
  if (!sessao || !userRaw) return false;
  let userId: string;
  try { userId = (JSON.parse(userRaw) as { id: string }).id; } catch { return false; }
  if (!localStorage.getItem(SOCIO_KEY)) localStorage.setItem(SOCIO_KEY, JSON.stringify({ token: sessao, user: userRaw }));
  const info: ActingInfo = { tenantId: tenant.id, tenantName: tenant.name, expiresAt: Date.now() + expiresInSeconds * 1000 };
  localStorage.setItem(ACTING_KEY, JSON.stringify(info));
  localStorage.setItem('montese_token', token);
  localStorage.setItem('montese_user', JSON.stringify({ id: userId, role: 'empresa', tenantId: tenant.id }));
  emitirMudanca();
  return true;
}

// Restaura a sessão da sócia (backup corrompido ou vencido: limpa tudo, devolve null => login). Devolve o tenant em que estava atuando (ou null se não estava atuando).
// Ruling 22: se a sessão guardada da sócia já venceu, NÃO restaura (seria um 401 logo em seguida e deixaria o
// JWT dela parado no localStorage): limpa tudo e devolve null — quem chama manda ao login.
export function stopActing(): string | null {
  const info = getActing();
  const backup = localStorage.getItem(SOCIO_KEY);
  if (!info || !backup) return null;
  try {
    const { token, user } = JSON.parse(backup) as { token: string; user: string };
    if (typeof token !== 'string' || isTokenExpired(token)) {
      clearAllSessionKeys();
      return null;
    }
    localStorage.setItem('montese_token', token);
    localStorage.setItem('montese_user', user);
  } catch {
    clearAllSessionKeys(); // backup corrompido: o token de atuação ocupa montese_token; limpa TUDO e o fluxo vai ao login
    return null;
  }
  clearActingKeys();
  return info.tenantId;
}

export function restoreSocioSessionIfActing(): boolean {
  return stopActing() !== null;
}
