'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

export interface ChartSeries {
  name: string;
  color: string;
  values: number[];
}

const W = 640;
const H = 240;
const PAD = { l: 64, r: 12, t: 12, b: 28 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

function niceMax(v: number): number {
  const pow = 10 ** Math.floor(Math.log10(v));
  const f = v / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

// Gráfico de área com N séries. Acessível: o grupo é focável (setas percorrem os
// dias e mostram o valor), e há uma tabela só para leitor de tela com todos os dados.
export function AreaChart({
  labels,
  series,
  format,
  formatAxis,
  ariaLabel,
}: {
  labels: string[];
  series: ChartSeries[];
  format: (n: number) => string;
  formatAxis?: (n: number) => string;
  ariaLabel: string;
}) {
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  // Posição da tooltip em px, medida a partir da largura REAL do container (ver
  // efeito abaixo). `null` = ainda não medida (usa o palpite em % como 1º pintura).
  const [tooltipLeftPx, setTooltipLeftPx] = useState<number | null>(null);
  const n = labels.length;
  const x = (i: number) => PAD.l + (n > 1 ? (i / (n - 1)) * IW : IW / 2);

  // Corrige a posição da tooltip ANTES da pintura do navegador (useLayoutEffect),
  // usando a largura real do container e da própria tooltip — evita que ela
  // estoure a borda direita em cards estreitos (mobile), onde 70% do container
  // + a largura mínima da tooltip não cabe (bug encontrado na verificação da
  // Tarefa 10 nesta tarefa).
  useLayoutEffect(() => {
    if (hover === null || !rootRef.current) {
      setTooltipLeftPx(null);
      return;
    }
    const containerWidth = rootRef.current.clientWidth || W;
    const pointXPx = (x(hover) / W) * containerWidth;
    const tooltipWidth = tooltipRef.current?.offsetWidth ?? 144;
    const margin = 8;
    const raw = pointXPx - tooltipWidth * 0.12;
    setTooltipLeftPx(Math.min(containerWidth - tooltipWidth - margin, Math.max(margin, raw)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, n]);

  if (n === 0) return null;

  const axis = formatAxis ?? format;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const y = (v: number) => PAD.t + IH - (v / max) * IH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(n / 6));

  const line = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = (values: number[]) =>
    `${line(values)} L${x(n - 1).toFixed(1)} ${(PAD.t + IH).toFixed(1)} L${x(0).toFixed(1)} ${(PAD.t + IH).toFixed(1)} Z`;

  const indexFromPointer = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    return Math.min(n - 1, Math.max(0, Math.round(((px - PAD.l) / IW) * (n - 1))));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setHover((h) => Math.max(0, (h ?? n) - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
    } else if (e.key === 'Escape') {
      setHover(null);
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      tabIndex={0}
      role="group"
      aria-label={`${ariaLabel}. Use as setas para percorrer os dias.`}
      onKeyDown={onKeyDown}
      onFocus={() => setHover((h) => h ?? n - 1)}
      onBlur={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden="true">
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.name} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--admin-border)" strokeWidth="1" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--admin-faint)">
              {axis(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 || i === n - 1 ? (
            <text key={`${l}-${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--admin-faint)">
              {l}
            </text>
          ) : null,
        )}
        {series.map((s, i) => (
          <g key={s.name}>
            <path d={area(s.values)} fill={`url(#${gid}-${i})`} />
            <path d={line(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + IH} stroke="var(--admin-faint)" strokeDasharray="3 3" />
            {series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r="4" fill={s.color} stroke="var(--admin-surface)" strokeWidth="2" />
            ))}
          </g>
        )}
        <rect
          x={PAD.l}
          y={PAD.t}
          width={IW}
          height={IH}
          fill="transparent"
          onPointerMove={(e) => setHover(indexFromPointer(e))}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hover !== null && (
        <div
          ref={tooltipRef}
          role="status"
          className="adm-card-2 pointer-events-none absolute top-2 min-w-36 px-3 py-2 text-xs shadow-lg"
          style={{
            left:
              tooltipLeftPx !== null
                ? `${tooltipLeftPx}px`
                : `${Math.min(70, Math.max(0, (x(hover) / W) * 100 - 8))}%`,
          }}
        >
          <p className="font-semibold text-brand-900">{labels[hover]}</p>
          {series.map((s) => (
            <p key={s.name} className="mt-0.5 flex items-center gap-1.5 text-brand-700">
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.name}: <span className="font-medium text-brand-900">{format(s.values[hover])}</span>
            </p>
          ))}
        </div>
      )}

      {/* .sr-only no <table> direto não funciona: com table-layout automático o
          navegador ignora o width:1px e expande a caixa da tabela para caber o
          conteúdo (CSS 2.1 §17.5.2 — a largura usada é o MAIOR entre o
          'width' declarado e a largura das colunas). Isso criava rolagem
          horizontal da PÁGINA inteira em telas estreitas (achado nesta mesma
          verificação, junto com o bug da tooltip acima). Um <div> não tem essa
          regra de tabela: aplicamos sr-only nele e deixamos a tabela livre —
          o overflow:hidden do div clipa a tabela sem afetar o layout da página. */}
      <div className="sr-only">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th>Dia</th>
              {series.map((s) => (
                <th key={s.name}>{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={`${l}-${i}`}>
                <td>{l}</td>
                {series.map((s) => (
                  <td key={s.name}>{format(s.values[i])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
