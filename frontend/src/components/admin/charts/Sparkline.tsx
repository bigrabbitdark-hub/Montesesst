'use client';

import { useId } from 'react';

export function Sparkline({
  values,
  color = 'var(--color-adm-brand-strong)',
  label,
  className = 'h-8 w-24',
}: {
  values: number[];
  color?: string;
  label: string;
  className?: string;
}) {
  const gid = useId().replace(/:/g, '');
  if (values.length === 0) return null;
  const vs = values.length === 1 ? [values[0], values[0]] : values;
  const W = 100;
  const H = 32;
  const PAD = 2;
  const max = Math.max(...vs);
  const min = Math.min(...vs);
  const span = max - min || 1;
  const step = W / (vs.length - 1);
  const pts = vs.map((v, i) => [i * step, H - PAD - ((v - min) / span) * (H - PAD * 2)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className={className}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
