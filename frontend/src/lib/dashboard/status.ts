export type ScoreTone = 'ok' | 'warn' | 'high' | 'crit';

// Faixas do Design System (docs/specs/montese-design-system.md, seção 9):
// 0-59 vermelho, 60-79 laranja, 80-89 amarelo, 90-100 verde.
export function scoreTone(score: number): ScoreTone {
  const s = Math.min(100, Math.max(0, score));
  if (s >= 90) return 'ok';
  if (s >= 80) return 'warn';
  if (s >= 60) return 'high';
  return 'crit';
}

export type Selo = { tone: 'ok' | 'warn' | 'crit'; texto: string };

// yyyy-mm-dd → dd/mm/aaaa (sem passar por Date: evita deslocamento de fuso).
export function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

// Dias entre duas datas ISO (yyyy-mm-dd), em UTC. `ate` menos `de`.
export function diasEntre(de: string, ate: string): number {
  const ms = Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
