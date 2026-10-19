import { Badge, type Tone } from '@/components/ui/Badge';
import type { SignatureStatus } from '@/lib/epi/types';

const MAP: Record<SignatureStatus, { tone: Tone; text: string }> = {
  pendente: { tone: 'warn', text: 'Pendente' },
  assinada: { tone: 'ok', text: 'Assinada' },
  recusada: { tone: 'crit', text: 'Recusada' },
  expirada: { tone: 'crit', text: 'Expirada' },
  presencial: { tone: 'info', text: 'Presencial' },
  legado: { tone: 'info', text: 'Anterior ao módulo' },
  estornada: { tone: 'crit', text: 'Estornada' },
};

export function SignatureStatusBadge({ status }: { status: SignatureStatus }) {
  const m = MAP[status];
  return <Badge tone={m.tone} large>{m.text}</Badge>;
}
