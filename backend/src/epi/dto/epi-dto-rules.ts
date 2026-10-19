// Regras compartilhadas entre CreateEpiDto e UpdateEpiDto: entrada inválida deve virar 400, nunca 500.

// Só 'AAAA-MM-DD' (formas ISO parciais como ano ou semana viram 500 no cast para date); sem ano 0000.
// Usar junto com @IsISO8601({ strict: true }) para barrar datas inexistentes (2026-02-30).
export const DATE_ONLY = /^(?!0000)\d{4}-\d{2}-\d{2}$/;

// Limite de INT do Postgres (estouro viraria 500).
export const INT_MAX = 2147483647;

// Limite de NUMERIC(12,2).
export const MONEY_MAX = 9999999999.99;

// Texto sem NUL (o Postgres rejeita \u0000 em text e viraria 500).
export const NO_NUL = /^[^\u0000]*$/;

// 'AAAA-MM-DD' ou 'AAAA-MM-DDThh:mm[:ss[.fff]][Z|±hh:mm]': formas ISO que o timestamptz do Postgres
// aceita (semana ISO, ordinal, ano ou ano-mês seriam 500). Offset limitado a ±15:59 (limite do
// Postgres) e sem ano 0000. Usar junto com @IsISO8601({ strict: true }).
export const DATE_OR_DATETIME =
  /^(?!0000)\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-](0\d|1[0-5]):[0-5]\d)?)?$/;
