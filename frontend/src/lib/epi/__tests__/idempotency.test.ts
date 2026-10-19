import { describe, it, expect, vi, afterEach } from 'vitest';
import { newIdempotencyKey } from '../idempotency';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('newIdempotencyKey', () => {
  it('tem formato de UUID v4, entre 8 e 100 caracteres e sem NUL', () => {
    const k = newIdempotencyKey();
    expect(k).toMatch(UUID);
    expect(k.length).toBeGreaterThanOrEqual(8);
    expect(k.length).toBeLessThanOrEqual(100);
    expect(k.includes('\u0000')).toBe(false);
  });
  it('gera chaves únicas', () => {
    const set = new Set(Array.from({ length: 500 }, () => newIdempotencyKey()));
    expect(set.size).toBe(500);
  });
  it('sem crypto.randomUUID usa o plano B com getRandomValues, ainda válido e único', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; } });
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(UUID);
    expect(a).not.toBe(b);
  });
  it('sem nenhum crypto ainda gera chave válida', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newIdempotencyKey()).toMatch(UUID);
  });
});
