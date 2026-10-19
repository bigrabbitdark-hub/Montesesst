// Utilitário puro de datas "só dia" (sem hora, sem fuso).
//
// Toda a aritmética aqui trata datas como strings 'AAAA-MM-DD' no calendário
// e nunca chama new Date() escondido: a função "hoje" sempre entra por
// parâmetro. Isso evita os deslocamentos que já apareceram no projeto
// quando alguém somava dias pegando a hora local e o fuso da máquina.
//
// Colunas no Postgres são DATE; o driver pg devolve Date à meia-noite UTC ou
// string ISO com hora conforme o caminho. O utilitário normaliza ambos para
// 'AAAA-MM-DD' sem deslocar o dia.

export type DateOnly = string; // 'AAAA-MM-DD'

export type DocumentSituation =
  | 'valido'
  | 'vencendo'
  | 'vencido'
  | 'sem_vencimento';

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})T/;

const pad2 = (n: number): string => String(n).padStart(2, '0');
const pad4 = (n: number): string => String(n).padStart(4, '0');

function daysInMonth(year: number, monthZero: number): number {
  // Truque do "dia 0 do mês seguinte" → último dia do mês pedido, em UTC.
  return new Date(Date.UTC(year, monthZero + 1, 0)).getUTCDate();
}

/**
 * Valida estritamente 'AAAA-MM-DD' e que a data existe no calendário.
 * Rejeita 2025-02-29, 2026-13-01, 2026-04-31 e qualquer string que carregue
 * hora, fuso ou lixo ao redor.
 */
export function isDateOnly(s: unknown): s is DateOnly {
  if (typeof s !== 'string') return false;
  if (!ISO_DATE_ONLY.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const utc = new Date(Date.UTC(y, m - 1, d));
  return (
    utc.getUTCFullYear() === y &&
    utc.getUTCMonth() === m - 1 &&
    utc.getUTCDate() === d
  );
}

/**
 * Normaliza o que pode vir do driver pg (Date à meia-noite UTC, string
 * 'AAAA-MM-DD', string ISO com hora) para 'AAAA-MM-DD' sem deslocar o dia.
 * Retorna null para entrada nula/indefinida. Lança erro para entradas
 * inválidas — quem chama decide se swallow ou propaga.
 */
export function toDateOnly(value: Date | string | null | undefined): DateOnly | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) {
      throw new Error('toDateOnly: Date inválida');
    }
    const y = value.getUTCFullYear();
    const m = pad2(value.getUTCMonth() + 1);
    const d = pad2(value.getUTCDate());
    return `${pad4(y)}-${m}-${d}`;
  }

  if (typeof value === 'string') {
    // Caminho feliz: já é 'AAAA-MM-DD'.
    if (isDateOnly(value)) return value;
    // String ISO com hora: 'AAAA-MM-DDTHH:MM:SS[.fff][±HH:MM]'.
    // Pegamos o prefixo da data, sem deixar o fuso deslocar o dia.
    const match = ISO_DATE_PREFIX.exec(value);
    if (match) {
      const candidate = match[1];
      if (isDateOnly(candidate)) return candidate;
    }
    throw new Error(`toDateOnly: string inválida "${value}"`);
  }

  throw new Error('toDateOnly: tipo não suportado');
}

/**
 * Soma meses de calendário mantendo o dia; quando o dia não existe no mês
 * de destino, usa o último dia desse mês. `months` deve ser inteiro em
 * [1, 600]; fora disso lança erro (o limite de 600 = 50 anos evita abusos
 * silenciosos tipo +999999 dias).
 *
 * Importante: a clampagem usa o último dia do mês de destino, não do mês
 * de origem. É isso que faz 2024-02-29 + 12 virar 2025-02-28 e não
 * 2025-03-01, e que faz 2024-02-29 + 48 (ano bissexto 2028) voltar a
 * aceitar dia 29.
 */
export function addMonths(dateOnly: DateOnly, months: number): DateOnly {
  if (!isDateOnly(dateOnly)) {
    throw new Error(`addMonths: data inválida "${dateOnly}"`);
  }
  if (!Number.isInteger(months) || months < 1 || months > 600) {
    throw new Error(`addMonths: months deve ser inteiro entre 1 e 600; recebido ${months}`);
  }
  const [y, m, d] = dateOnly.split('-').map(Number);
  const totalMonths = y * 12 + (m - 1) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonthZero = totalMonths % 12;
  const lastDay = daysInMonth(newYear, newMonthZero);
  const clampedDay = d > lastDay ? lastDay : d;
  return `${pad4(newYear)}-${pad2(newMonthZero + 1)}-${pad2(clampedDay)}`;
}

/**
 * Dias de calendário inteiros entre duas datas só-dia (to - from). Negativo
 * quando `to` é anterior a `from`. Como usamos UTC nas duas pontas, não há
 * interferência de fuso nem de horário de verão.
 */
export function diffDays(from: DateOnly, to: DateOnly): number {
  if (!isDateOnly(from)) throw new Error(`diffDays: from inválido "${from}"`);
  if (!isDateOnly(to)) throw new Error(`diffDays: to inválido "${to}"`);
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86_400_000);
}

/**
 * Mesma regra usada por DocumentsService.getCompliance / nr-status:
 * - sem data → 'sem_vencimento'
 * - diffDays(today, expiresAt) < 0 → 'vencido'
 * - 0 <= diff <= alertDays → 'vencendo' (vencer hoje ainda não é vencido)
 * - demais casos → 'valido'
 */
export function documentSituation(
  expiresAt: DateOnly | null,
  today: DateOnly,
  alertDays: number,
): DocumentSituation {
  if (expiresAt === null) return 'sem_vencimento';
  if (!Number.isInteger(alertDays) || alertDays < 0) {
    throw new Error(`documentSituation: alertDays deve ser inteiro >= 0; recebido ${alertDays}`);
  }
  const d = diffDays(today, expiresAt);
  if (d < 0) return 'vencido';
  if (d <= alertDays) return 'vencendo';
  return 'valido';
}

/**
 * 'AAAA-MM-DD' do dia corrente no fuso informado. Usa Intl.DateTimeFormat
 * para que a saída não dependa do fuso da máquina onde o código roda — o
 * servidor em UTC continua devolvendo o dia certo para o usuário de SP.
 */
export function todayDateOnly(now: Date, timeZone = 'America/Sao_Paulo'): DateOnly {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('todayDateOnly: now precisa ser uma Date válida');
  }
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: string): string => {
    const p = parts.find((part) => part.type === type);
    return p ? p.value : '';
  };
  const y = pick('year');
  const m = pick('month');
  const d = pick('day');
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) {
    throw new Error(`todayDateOnly: não consegui extrair ano/mês/dia (${y}-${m}-${d})`);
  }
  return `${y}-${m}-${d}`;
}
