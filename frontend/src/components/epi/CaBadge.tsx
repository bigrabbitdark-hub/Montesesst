import { Badge, type Tone } from '@/components/ui/Badge';
import type { CaAlert } from '@/lib/epi/types';

const MAP: Record<CaAlert, { tone: Tone; text: string }> = {
  vencido: { tone: 'crit', text: 'CA vencido' },
  a_vencer: { tone: 'warn', text: 'CA a vencer' },
  ok: { tone: 'ok', text: 'CA válido' },
  sem_validade: { tone: 'info', text: 'CA sem validade' },
};

export function CaBadge({ alert }: { alert: CaAlert }) {
  const m = MAP[alert];
  return <Badge tone={m.tone} large>{m.text}</Badge>;
}
