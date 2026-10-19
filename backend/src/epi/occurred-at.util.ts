// Normaliza o occurred_at informado na API para um instante inequívoco. O Brasil não tem horário de
// verão desde 2019, então São Paulo é -03:00 fixo.
//  - ausente: undefined (o banco usa now());
//  - só data (AAAA-MM-DD): meio-dia de São Paulo (evita virar o dia anterior ao converter fuso);
//  - datetime com Z ou offset: inalterado;
//  - datetime sem offset: interpretado como horário de São Paulo.
export function normalizeOccurredAt(value?: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00-03:00`;
  if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) return value;
  return `${value}-03:00`;
}
