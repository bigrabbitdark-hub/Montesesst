export type Tone = 'ok' | 'warn' | 'high' | 'crit' | 'info' | 'epi';

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'bg-dash-status-ok-bg text-dash-status-ok-text',
  warn: 'bg-dash-status-warn-bg text-dash-status-warn-text',
  high: 'bg-orange-100 text-orange-800',
  crit: 'bg-dash-status-crit-bg text-dash-status-crit-text',
  info: 'bg-dash-status-info-bg text-dash-status-info-text',
  epi: 'bg-violet-100 text-dash-status-epi-text',
};

// `large`: texto de 16px (módulo de EPI, onde o selo é a informação principal da linha).
export function Badge({ tone, large = false, children }: { tone: Tone; large?: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-[5px] px-2 py-0.5 ${large ? 'text-base' : 'text-[11px]'} font-semibold ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}
