// Formatação de datas, dinheiro e quantidades do módulo de EPI (pt-BR, fuso America/Sao_Paulo).
const TZ = 'America/Sao_Paulo';
const EMPTY = '—';

// Data de calendário (sem fuso): usa só os 10 primeiros caracteres 'AAAA-MM-DD'. Colunas DATE podem chegar
// como '2026-10-18' ou '2026-10-18T00:00:00.000Z'; em ambos os casos o dia é o escrito, sem conversão.
// Depende do formato AAAA-MM-DD no início do texto; datas que não existem no calendário (ex.: 2026-02-31) viram "—".
export function formatDate(value: string | null | undefined): string {
  const m = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!m) return EMPTY;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return EMPTY;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

const dtf = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Instante (ISO com fuso) mostrado no horário de São Paulo: 'dd/mm/aaaa hh:mm'.
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(d)) p[part.type] = part.value;
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

const money = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? `R$ ${money.format(n)}` : EMPTY;
}

const qty = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
export function formatQty(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? qty.format(n) : EMPTY;
}

// Dia de hoje em São Paulo ('AAAA-MM-DD').
export function todayDateOnly(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(dateOnly: string, n: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  const t = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(to) - t(from)) / 86_400_000);
}
