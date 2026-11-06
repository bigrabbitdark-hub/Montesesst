import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { atuacaoFetch } from '../api';
import { startActing } from '@/lib/acting';

describe('atuacaoFetch 401', () => {
  const original = window.location;
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'location', { configurable: true, value: { href: '' } });
    localStorage.setItem('montese_token', 'S');
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u1', role: 'socio', tenantId: null }));
    startActing('ACT', 1800, { id: 't1', name: 'E' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
  });
  afterEach(() => { vi.unstubAllGlobals(); Object.defineProperty(window, 'location', { configurable: true, value: original }); });

  it('limpa as 4 chaves e vai ao login', async () => {
    await expect(atuacaoFetch('/clientes')).rejects.toThrow(/sessão expirou/i);
    for (const k of ['montese_token', 'montese_user', 'montese_socio_session', 'montese_acting']) expect(localStorage.getItem(k)).toBeNull();
    expect(window.location.href).toBe('/login');
  });
});
