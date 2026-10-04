import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// O skin remapeia tokens brand-* dentro de .skin-dash para o visual do dashboard. Lê o CSS real
// (não uma cópia) e confere os contrastes dos pares que importam.
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

function bloco(seletor: string): string {
  const i = css.indexOf(`${seletor} {`);
  if (i < 0) return '';
  return css.slice(i, css.indexOf('}', i));
}
function token(nome: string): string {
  const m = css.match(new RegExp(`--${nome}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token ${nome} ausente`);
  return m[1];
}
// Valor no escopo: aceita "#hex" ou var(--outro), resolvendo um nível.
function noSkin(nome: string): string {
  const m = bloco('.skin-dash').match(new RegExp(`--${nome}:\\s*([^;]+);`));
  if (!m) throw new Error(`.skin-dash não define --${nome}`);
  const v = m[1].trim();
  const ref = v.match(/^var\(--([a-z0-9-]+)\)$/);
  return ref ? token(ref[1]) : v;
}
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contraste(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const BRANCO = '#ffffff';

describe('.skin-dash', () => {
  it('existe e remapeia os tokens usados pelos painéis', () => {
    const b = bloco('.skin-dash');
    expect(b).not.toBe('');
    for (const t of ['color-brand-900', 'color-brand-700', 'color-brand-100', 'color-brand-50', 'radius-md', 'radius-lg']) {
      expect(b).toContain(`--${t}:`);
    }
  });
  it('título e texto principal: contraste ≥ 7:1 sobre branco', () => {
    expect(contraste(noSkin('color-brand-900'), BRANCO)).toBeGreaterThanOrEqual(7);
  });
  it('texto secundário (.text-brand-700) ≥ 4,5:1 sobre o card e sobre o fundo da página', () => {
    const m = bloco('.skin-dash .text-brand-700').match(/color:\s*var\(--([a-z0-9-]+)\)/);
    expect(m).not.toBeNull();
    const cor = token(m![1]);
    expect(contraste(cor, BRANCO)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(cor, token('color-dash-page'))).toBeGreaterThanOrEqual(4.5);
  });
  it('hover dos botões (brand-700) mantém texto branco ≥ 4,5:1', () => {
    expect(contraste(noSkin('color-brand-700'), BRANCO)).toBeGreaterThanOrEqual(4.5);
  });
  it('botão e link verdes (brand-500, não remapeado) ≥ 4,5:1 sobre branco', () => {
    expect(contraste(token('color-brand-500'), BRANCO)).toBeGreaterThanOrEqual(4.5);
  });
  it('borda de campo de formulário ≥ 3:1 sobre branco (WCAG 1.4.11)', () => {
    const m = bloco('.skin-dash :where(input, select, textarea)').match(/border-color:\s*(#[0-9a-fA-F]{6})/);
    expect(m).not.toBeNull();
    expect(contraste(m![1], BRANCO)).toBeGreaterThanOrEqual(3);
  });
});
