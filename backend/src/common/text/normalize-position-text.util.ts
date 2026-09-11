// Extraído de PositionsService (Fase 23) — reaproveitado pela Fase 25
// pra casar o nome de função extraído de PGR/PCMSO com o cargo
// canônico já cadastrado (positions.name).
export function normalizePositionText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
