import { Badge, type Tone } from '@/components/ui/Badge';
import type { StockBand } from '@/lib/epi/types';

const MAP: Record<StockBand, { tone: Tone; text: string }> = {
  sem_estoque: { tone: 'crit', text: 'Sem estoque' },
  abaixo: { tone: 'warn', text: 'Abaixo do mínimo' },
  otimo: { tone: 'ok', text: 'Estoque ok' },
  acima: { tone: 'info', text: 'Acima do máximo' },
};

export function StockBadge({ band }: { band: StockBand }) {
  const m = MAP[band];
  return <Badge tone={m.tone} large>{m.text}</Badge>;
}
