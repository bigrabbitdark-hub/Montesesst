import type { Tone } from '../Card';

// Estados em português. Chave desconhecida cai no valor bruto (statusOf) —
// nunca escondemos um status novo do Mercado Pago.
export const TENANT_STATUS: Record<string, { label: string; tone: Tone }> = {
  ativo: { label: 'Ativo', tone: 'ok' },
  pendente: { label: 'Pendente', tone: 'warn' },
  inativo: { label: 'Inativo', tone: 'neutral' },
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  approved: { label: 'Aprovado', tone: 'ok' },
  authorized: { label: 'Autorizado', tone: 'info' },
  pending: { label: 'Pendente', tone: 'warn' },
  in_process: { label: 'Em análise', tone: 'warn' },
  in_mediation: { label: 'Em mediação', tone: 'warn' },
  rejected: { label: 'Recusado', tone: 'bad' },
  cancelled: { label: 'Cancelado', tone: 'bad' },
  refunded: { label: 'Estornado', tone: 'neutral' },
  charged_back: { label: 'Contestado', tone: 'bad' },
};

export function statusOf(
  map: Record<string, { label: string; tone: Tone }>,
  key: string,
): { label: string; tone: Tone } {
  return map[key] ?? { label: key, tone: 'neutral' };
}

export type LogLevel = 'ERRO' | 'AVISO' | 'INFO';

// Nível derivado do status HTTP registrado na auditoria (não é um log de aplicação).
export function logLevel(statusCode: number): LogLevel {
  if (statusCode >= 500) return 'ERRO';
  if (statusCode >= 400) return 'AVISO';
  return 'INFO';
}

export const LOG_TONE: Record<LogLevel, Tone> = { ERRO: 'bad', AVISO: 'warn', INFO: 'info' };

export function planLabel(plano: string): string {
  return plano === 'trial' ? 'Trial' : plano;
}
