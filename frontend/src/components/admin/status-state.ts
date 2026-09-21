import type { AlertasResponse, SystemStatus } from './types';

export interface Slice<T> {
  data: T | null;
  error: boolean; // a última tentativa falhou (data pode ser a leitura anterior)
}

export type SystemState = 'carregando' | 'online' | 'degradado' | 'sem-resposta';

export const SYSTEM_STATE_LABEL: Record<SystemState, string> = {
  carregando: 'Verificando…',
  online: 'Sistema online',
  degradado: 'Sistema degradado',
  'sem-resposta': 'Sem resposta',
};

// online = Postgres, Redis e Site acessíveis; degradado = algum não está;
// sem-resposta = a própria chamada falhou (nunca afirmamos "online" sem leitura).
export function deriveSystemState(slice: Slice<SystemStatus>): SystemState {
  if (slice.error) return 'sem-resposta';
  if (!slice.data) return 'carregando';
  const s = slice.data.services;
  return s.postgres.reachable && s.redis.reachable && s.frontend.reachable ? 'online' : 'degradado';
}

// O sino conta só crítico + atenção; severidade "info" não conta.
export function alertBadgeCount(slice: Slice<AlertasResponse>): number {
  return slice.data ? slice.data.contagem.critico + slice.data.contagem.atencao : 0;
}
