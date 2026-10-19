import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SignaturePad, type SignaturePadHandle } from '../SignaturePad';

// jsdom não tem PointerEvent: polyfill mínimo para os eventos carregarem clientX/clientY/button.
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

const ctx = {
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  fill: vi.fn(),
  lineWidth: 0,
  lineCap: '',
  lineJoin: '',
  strokeStyle: '',
  fillStyle: '',
};
const toDataURL = vi.fn(() => 'data:image/png;base64,AAAA');

beforeEach(() => {
  vi.stubGlobal('PointerEvent', FakePointerEvent);
  Object.values(ctx).forEach((v) => typeof v === 'function' && (v as ReturnType<typeof vi.fn>).mockClear());
  toDataURL.mockClear();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = toDataURL as unknown as typeof HTMLCanvasElement.prototype.toDataURL;
});
afterEach(() => vi.unstubAllGlobals());

function stroke(canvas: HTMLElement, button = 0) {
  fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, button, pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: 40, clientY: 30, button, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: 40, clientY: 30, button, pointerId: 1 });
}

describe('SignaturePad', () => {
  it('começa vazio e só emite PNG depois de um traço; Limpar volta a vazio', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const canvas = screen.getByRole('img', { name: 'Área para assinar com o dedo' }) as HTMLCanvasElement;
    expect(onChange).not.toHaveBeenCalled();
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(200);
    expect(canvas.style.touchAction).toBe('none');

    stroke(canvas);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('data:image/png;base64,AAAA');
    expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect(ctx.lineWidth).toBe(3);
    expect(ctx.strokeStyle).toBe('#000000');

    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 600, 200);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('o ref clear() também zera', () => {
    const onChange = vi.fn();
    const ref = createRef<SignaturePadHandle>();
    render(<SignaturePad ref={ref} onChange={onChange} />);
    stroke(screen.getByRole('img'));
    ref.current!.clear();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('converte as coordenadas do ponteiro para o espaço 600x200', () => {
    render(<SignaturePad onChange={vi.fn()} />);
    const canvas = screen.getByRole('img');
    canvas.getBoundingClientRect = () => ({ left: 100, top: 50, width: 300, height: 100, right: 400, bottom: 150, x: 100, y: 50, toJSON: () => ({}) });
    fireEvent.pointerDown(canvas, { clientX: 250, clientY: 100, button: 0 });
    expect(ctx.moveTo).toHaveBeenCalledWith(300, 100);
  });

  it('ignora ponteiro com botão não primário e não desenha com disabled', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SignaturePad onChange={onChange} />);
    stroke(screen.getByRole('img'), 2);
    expect(onChange).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();

    rerender(<SignaturePad onChange={onChange} disabled />);
    stroke(screen.getByRole('img'));
    expect(onChange).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Limpar' })).toBeDisabled();
  });

  it('usa fundo transparente (nunca preenche o canvas) — fillRect não é chamado com cor opaca', () => {
    render(<SignaturePad onChange={vi.fn()} />);
    stroke(screen.getByRole('img'));
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.fillStyle).toBe('');
  });

  it('pointermove sem pointerdown não desenha nem emite', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const c = screen.getByRole('img');
    fireEvent.pointerMove(c, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(c, { clientX: 5, clientY: 5, pointerId: 1 });
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('multitoque: ignora move/up/down de outro ponteiro enquanto há um traço ativo', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const c = screen.getByRole('img');
    fireEvent.pointerDown(c, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    const strokes = ctx.stroke.mock.calls.length;
    fireEvent.pointerDown(c, { clientX: 200, clientY: 100, button: 0, pointerId: 2 });
    fireEvent.pointerMove(c, { clientX: 220, clientY: 120, pointerId: 2 });
    fireEvent.pointerUp(c, { clientX: 220, clientY: 120, pointerId: 2 });
    expect(ctx.stroke.mock.calls.length).toBe(strokes);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(c, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('pointercancel sem traço anterior descarta o traço e não emite PNG', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const c = screen.getByRole('img');
    fireEvent.pointerDown(c, { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerMove(c, { clientX: 40, clientY: 30, pointerId: 1 });
    fireEvent.pointerCancel(c, { pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalledWith(0, 0, 600, 200);
    // depois do cancelamento um novo traço funciona
    fireEvent.pointerDown(c, { clientX: 10, clientY: 10, button: 0, pointerId: 3 });
    fireEvent.pointerUp(c, { clientX: 10, clientY: 10, pointerId: 3 });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('pointercancel com traço já concluído mantém o que existe e não limpa o estado', () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const c = screen.getByRole('img');
    stroke(c);
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(c, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    ctx.moveTo.mockClear();
    fireEvent.pointerCancel(c, { pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1); // nem emite parcial nem zera
    expect(onChange).not.toHaveBeenLastCalledWith(null);
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 10); // o traço concluído foi redesenhado
  });
});
