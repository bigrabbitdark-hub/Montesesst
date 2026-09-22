const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const INT = new Intl.NumberFormat('pt-BR');
const COMPACT = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const TZ = 'America/Sao_Paulo';
const DAY_MS = 86_400_000;

export const formatCents = (cents: number): string => BRL.format(cents / 100);
export const formatCentsAxis = (cents: number): string =>
  cents === 0 ? 'R$ 0' : `R$ ${COMPACT.format(cents / 100)}`;
export const formatUsd = (value: number): string => USD.format(value);
export const formatInt = (n: number): string => INT.format(n);
export const formatCompact = (n: number): string => COMPACT.format(n);
export const plural = (n: number, one: string, many: string): string =>
  `${INT.format(n)} ${n === 1 ? one : many}`;

// 'YYYY-MM-DD' -> 'DD/MM'
export function formatDayMonth(ymd: string): string {
  const [, month, day] = ymd.split('-');
  return `${day}/${month}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function relativeTime(value: string | number | null, now: number = Date.now()): string {
  if (value === null) return '—';
  const t = typeof value === 'number' ? value : new Date(value).getTime();
  const min = Math.floor(Math.max(0, now - t) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}

// Últimos `n` dias em UTC (YYYY-MM-DD), do mais antigo ao mais novo (o último é hoje em UTC).
export function lastDaysUtc(n: number, now: number = Date.now()): string[] {
  return Array.from({ length: n }, (_, i) => new Date(now - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

// /api/admin/ai-usage devolve só os dias COM uso, agrupados por dia no fuso da
// sessão do Postgres (UTC). Preenche os dias ausentes com 0 — assim "hoje" é o
// último item e o sparkline tem sempre 7 pontos.
export function fillDailySeries(
  rows: { date: string; total_tokens: number }[],
  days = 7,
  now: number = Date.now(),
): { date: string; total_tokens: number }[] {
  const byDate = new Map(rows.map((r) => [r.date, Number(r.total_tokens)]));
  return lastDaysUtc(days, now).map((date) => ({ date, total_tokens: byDate.get(date) ?? 0 }));
}
