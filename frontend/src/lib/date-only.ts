// Utilitários para manipular e format datas no formato "AAAA-MM-DD"
// como texto puro — sem passar por `new Date(string)`, que interpreta
// a string como UTC e, dependendo do fuso do navegador, pode renderizar
// o dia anterior. Tudo aqui é determinístico e sem fuso.

/**
 * Adiciona N meses a uma data no formato "AAAA-MM-DD".
 *
 * Regras:
 *  - Mantém o dia quando ele existe no mês de destino.
 *  - Quando o dia não existe (ex.: 31 em fevereiro), usa o último
 *    dia do mês de destino.
 *  - Nunca cria "saltos" de um dia por causa de fuso horário.
 *
 * Exemplos:
 *   addMonths('2024-02-29', 12) === '2025-02-28'
 *   addMonths('2024-02-29', 48) === '2028-02-29'
 *   addMonths('2026-01-31',  1) === '2026-02-28'
 *   addMonths('2026-08-31',  6) === '2027-02-28'
 *   addMonths('2026-03-15', 24) === '2028-03-15'
 */
export function addMonths(dateOnly: string, months: number): string {
  const [yStr, mStr, dStr] = dateOnly.slice(0, 10).split('-');
  const year = Number(yStr);
  const month = Number(mStr); // 1..12
  const day = Number(dStr);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`addMonths: data inválida "${dateOnly}"`);
  }

  // total de meses desde 0000-01, some months, e desmembre de volta
  const total = (year * 12 + (month - 1)) + months;
  const newYear = Math.floor(total / 12);
  const newMonthIndex = total - newYear * 12; // 0..11
  const newMonth = newMonthIndex + 1; // 1..12

  const lastDay = lastDayOfMonth(newYear, newMonth);
  const newDay = day > lastDay ? lastDay : day;

  return `${pad4(newYear)}-${pad2(newMonth)}-${pad2(newDay)}`;
}

/**
 * Formata "AAAA-MM-DD" em "dd/mm/aaaa" sem tocar em fuso horário.
 */
export function formatDateBR(dateOnly: string | null | undefined): string {
  if (!dateOnly) return '';
  const sliced = String(dateOnly).slice(0, 10);
  const [year, month, day] = sliced.split('-');
  if (!year || !month || !day) return '';
  return `${day}/${month}/${year}`;
}

/** Alias semântico: o que o projeto já chama de "format" para datas. */
export const format = formatDateBR;

function lastDayOfMonth(year: number, month: number): number {
  // truque clássico: dia 0 do mês seguinte = último dia do mês pedido
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad4(n: number): string {
  return n < 10 ? `000${n}` : n < 100 ? `00${n}` : n < 1000 ? `0${n}` : String(n);
}
