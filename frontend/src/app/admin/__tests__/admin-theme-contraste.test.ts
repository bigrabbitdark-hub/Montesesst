import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Lê os tokens reais (não uma cópia): --admin-* em admin-theme.css e --color-adm-* no @theme de
// globals.css (único lugar em que o Tailwind v4 gera os utilitários text-adm-*, bg-adm-* etc.).
const SRC = join(process.cwd(), 'src/app');
const globals = readFileSync(join(SRC, 'globals.css'), 'utf8');
const admin = readFileSync(join(SRC, 'admin/admin-theme.css'), 'utf8');

function valor(css: string, nome: string): string {
  const m = css.match(new RegExp(`--${nome}:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${nome} ausente`);
  return m[1].trim();
}
function rgba(v: string): { c: [number, number, number]; a: number } {
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return { c: [1, 3, 5].map((i) => parseInt(hex[1].slice(i - 1, i + 1), 16)) as [number, number, number], a: 1 };
  const m = v.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (!m) throw new Error(`cor não suportada: ${v}`);
  return { c: [+m[1], +m[2], +m[3]], a: +m[4] };
}
function sobre(frente: string, fundo: string): [number, number, number] {
  const f = rgba(frente);
  const b = rgba(fundo).c;
  return f.c.map((x, i) => Math.round(x * f.a + b[i] * (1 - f.a))) as [number, number, number];
}
function lum(c: number[]): number {
  const l = c.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
function contraste(a: number[], b: number[]): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const adm = (n: string) => valor(admin, `admin-${n}`);
const tok = (n: string) => valor(globals, `color-adm-${n}`);
const rgb = (v: string) => rgba(v).c;
const SUPERFICIES = { surface: adm('surface'), bg: adm('bg') };
const STATUS = ['ok', 'warn', 'crit', 'info', 'epi'] as const;

describe('tokens do admin (DS v2, tema escuro)', () => {
  it.each(STATUS)('status %s: tokens base, bg e text definidos', (s) => {
    for (const sufixo of ['', '-bg', '-text']) expect(() => tok(`status-${s}${sufixo}`)).not.toThrow();
  });

  it.each(STATUS)('status %s: texto ≥ 4,5:1 sobre o fundo tingido (sobre superfície e sobre o fundo da página)', (s) => {
    const texto = rgb(tok(`status-${s}-text`));
    for (const base of Object.values(SUPERFICIES)) {
      const fundo = sobre(tok(`status-${s}-bg`), base);
      expect(contraste(texto, fundo)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('verde da marca ≥ 4,5:1 sobre o fundo da página; versão forte ≥ 4,5:1 sobre a superfície', () => {
    expect(contraste(rgb(tok('brand')), rgb(SUPERFICIES.bg))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(rgb(tok('brand-strong')), rgb(SUPERFICIES.surface))).toBeGreaterThanOrEqual(4.5);
  });

  it('badge numérico (texto branco) sobre vermelho sólido ≥ 4,5:1 (o vermelho de status #ef4444 não chega: 3,76:1)', () => {
    expect(contraste([255, 255, 255], rgb(tok('status-crit-solid')))).toBeGreaterThanOrEqual(4.5);
  });

  it('texto principal, secundário e discreto do tema mantêm os mínimos do plano sobre o fundo', () => {
    const bg = rgb(SUPERFICIES.bg);
    expect(contraste(rgb(adm('text')), bg)).toBeGreaterThanOrEqual(13);
    expect(contraste(rgb(adm('muted')), bg)).toBeGreaterThanOrEqual(7);
    expect(contraste(rgb(adm('faint')), bg)).toBeGreaterThanOrEqual(4.6);
  });

  it('os tokens --color-adm-* ficam só no @theme de globals.css (fonte única, gera os utilitários)', () => {
    expect(admin).not.toMatch(/--color-adm-[a-z-]+\s*:/);
  });
});
