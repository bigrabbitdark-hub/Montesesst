// Medidor circular. O número (ou "—") está sempre escrito no centro: a cor do
// arco (verde < 80%, âmbar 80–89%, vermelho ≥ 90%) é só reforço.
export function Gauge({
  percent,
  label,
  caption,
}: {
  percent: number | null;
  label: string;
  caption?: string;
}) {
  const R = 34;
  const C = 2 * Math.PI * R;
  const p = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const color = p >= 90 ? '#f87171' : p >= 80 ? '#fbbf24' : '#34d399';
  const text = percent === null ? 'sem dado' : `${Math.round(p)}%`;
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 text-center">
      <div className="relative h-[84px] w-[84px]" role="img" aria-label={`${label}: ${text}`}>
        <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="42" cy="42" r={R} fill="none" stroke="var(--admin-border)" strokeWidth="7" />
          {percent !== null && (
            <circle
              cx="42"
              cy="42"
              r={R}
              fill="none"
              stroke={color}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={`${(p / 100) * C} ${C}`}
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-brand-900">
          {percent === null ? '—' : `${Math.round(p)}%`}
        </span>
      </div>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">{label}</span>
      {caption && <span className="adm-text-faint text-[11px] leading-tight">{caption}</span>}
    </div>
  );
}
