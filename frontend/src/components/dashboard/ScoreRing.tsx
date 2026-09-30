import { Card } from '@/components/ui/Card';
import { scoreTone, type ScoreTone } from '@/lib/dashboard/status';

const STROKE: Record<ScoreTone, string> = {
  ok: 'var(--color-dash-status-ok)',
  warn: 'var(--color-dash-status-warn)',
  high: 'var(--color-dash-status-high)',
  crit: 'var(--color-dash-status-crit)',
};
const TEXT: Record<ScoreTone, string> = {
  ok: 'text-dash-status-ok-text',
  warn: 'text-dash-status-warn-text',
  high: 'text-orange-800',
  crit: 'text-dash-status-crit-text',
};

const R = 40;
const CIRC = 2 * Math.PI * R;

// O nível ("Excelente") vem do dado e fica sempre visível: a cor nunca é o único indicador.
export function ScoreRing({ score, nivel, nota }: { score: number | null; nivel: string; nota?: string }) {
  if (score === null) {
    return (
      <Card>
        <p className="text-sm font-medium text-dash-muted">Score SST</p>
        <p className="mt-1.5 text-xl font-bold text-dash-primary">{nivel}</p>
        {nota && <p className="mt-1 text-[13px] text-dash-muted">{nota}</p>}
      </Card>
    );
  }
  const s = Math.min(100, Math.max(0, score));
  const tone = scoreTone(s);
  return (
    <Card>
      <div className="flex items-center gap-[18px]">
        <svg width="96" height="96" viewBox="0 0 96 96" role="img" aria-label={`Score SST ${s}%, ${nivel}`}>
          <circle cx="48" cy="48" r={R} fill="none" stroke="#eef2f7" strokeWidth="11" />
          <circle
            cx="48"
            cy="48"
            r={R}
            fill="none"
            stroke={STROKE[tone]}
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={`${(CIRC * s) / 100} ${CIRC}`}
            transform="rotate(-90 48 48)"
          />
          <text x="48" y="55" textAnchor="middle" fontSize="24" fontWeight="700" fill="var(--color-dash-primary)">
            {s}%
          </text>
        </svg>
        <div>
          <p className="mb-1.5 text-sm font-medium text-dash-muted">Score SST</p>
          <p className={`text-xl font-bold ${TEXT[tone]}`}>{nivel}</p>
          {nota && <p className="mt-1 text-[12px] leading-snug text-dash-muted">{nota}</p>}
        </div>
      </div>
    </Card>
  );
}
