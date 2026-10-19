'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

// Tamanho INTERNO fixo (o servidor rejeita PNG acima de 1200x600). A escala para a tela é só por CSS
// (width: 100%) e as coordenadas do ponteiro são convertidas para este espaço. Fundo sempre transparente.
const WIDTH = 600;
const HEIGHT = 200;
const STROKE = 3;

export type SignaturePadHandle = { clear: () => void };

type Props = { onChange: (png: string | null) => void; disabled?: boolean };

type Point = { x: number; y: number };

// Decisão sobre pointercancel: o traço em andamento é DESCARTADO (a tela é redesenhada só com os traços já
// concluídos). Se não havia nenhum traço concluído, o pad continua vazio e nenhum PNG é emitido; se havia, eles
// ficam e o PNG anterior continua valendo. Só o ponteiro ativo (o que iniciou o traço) é considerado: os demais
// dedos (multitoque) são ignorados.
export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad({ onChange, disabled }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeId = useRef<number | null>(null);
  const done = useRef<Point[][]>([]);
  const current = useRef<Point[]>([]);

  function context() {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return null;
    ctx.lineWidth = STROKE;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000000';
    return ctx;
  }

  function point(e: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = rect.width > 0 ? WIDTH / rect.width : 1;
    const sy = rect.height > 0 ? HEIGHT / rect.height : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function paint(ctx: CanvasRenderingContext2D, pts: Point[]) {
    if (pts.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) ctx.lineTo(pts[0].x, pts[0].y); // um toque sem arrastar vira um ponto
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function clear() {
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, WIDTH, HEIGHT);
    activeId.current = null;
    done.current = [];
    current.current = [];
    onChange(null);
  }
  useImperativeHandle(ref, () => ({ clear }));

  function down(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || e.button !== 0 || activeId.current !== null) return;
    const ctx = context();
    if (!ctx) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    activeId.current = e.pointerId;
    current.current = [point(e)];
    paint(ctx, current.current);
  }

  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || activeId.current === null || e.pointerId !== activeId.current) return;
    const ctx = context();
    if (!ctx) return;
    const p = point(e);
    const last = current.current[current.current.length - 1];
    current.current.push(p);
    paint(ctx, [last, p]);
  }

  function up(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (activeId.current === null || e.pointerId !== activeId.current) return;
    activeId.current = null;
    done.current.push(current.current);
    current.current = [];
    if (canvasRef.current) onChange(canvasRef.current.toDataURL('image/png'));
  }

  function cancel(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (activeId.current === null || e.pointerId !== activeId.current) return;
    activeId.current = null;
    current.current = [];
    const canvas = canvasRef.current;
    const ctx = context();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    done.current.forEach((pts) => paint(ctx, pts));
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label="Área para assinar com o dedo"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        style={{ touchAction: 'none', width: '100%', aspectRatio: '3 / 1' }}
        className={`block rounded-[9px] border-[1.5px] border-dashed border-brand-700 bg-white ${disabled ? 'opacity-60' : ''}`}
      />
      <button
        type="button"
        onClick={clear}
        disabled={disabled}
        className="min-h-[44px] self-start rounded-[9px] border-[1.5px] border-brand-700 px-5 text-base font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
      >
        Limpar
      </button>
    </div>
  );
});
