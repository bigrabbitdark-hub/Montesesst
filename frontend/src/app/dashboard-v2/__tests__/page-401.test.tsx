import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import DashboardV2Page from '../page';
import { startActing } from '@/lib/acting';

const push = vi.fn();
const replace = vi.fn();
const router = { push, replace };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtExp = (deltaSeg: number) => `${b64({ alg: 'HS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + deltaSeg })}.sig`;
const SOCIA = jwtExp(3600);
const quatro = () => ['montese_token', 'montese_user', 'montese_socio_session', 'montese_acting'].map((k) => localStorage.getItem(k));

// O 401 do painel passa por sessionExpired(): atuando, volta à sessão da sócia (não apaga o login dela);
// fora da atuação, limpa tudo e vai ao login.
describe('dashboard-v2: resposta 401', () => {
  const original = window.location;
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
    replace.mockClear();
    // href base válido: o next/image da casca resolve URLs relativas contra location.href.
    Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/dashboard-v2', origin: 'http://localhost' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
  });
  afterEach(() => { vi.unstubAllGlobals(); Object.defineProperty(window, 'location', { configurable: true, value: original }); });

  it('atuando: restaura a sessão da sócia e volta à lista com aviso', async () => {
    localStorage.setItem('montese_token', SOCIA);
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u1', role: 'socio', tenantId: null }));
    startActing(jwtExp(1800), 1800, { id: 't1', name: 'E' });
    render(<DashboardV2Page />);
    await waitFor(() => expect(window.location.href).toBe('/atuacao/clientes?atuacao=expirada'));
    expect(localStorage.getItem('montese_token')).toBe(SOCIA);
    expect(JSON.parse(localStorage.getItem('montese_user')!).role).toBe('socio');
    expect(localStorage.getItem('montese_acting')).toBeNull();
    expect(localStorage.getItem('montese_socio_session')).toBeNull();
  });
  it('sem atuação: limpa a sessão e vai ao login', async () => {
    localStorage.setItem('montese_token', jwtExp(1800));
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u2', role: 'empresa', tenantId: 't2' }));
    render(<DashboardV2Page />);
    await waitFor(() => expect(window.location.href).toBe('/login'));
    expect(quatro()).toEqual([null, null, null, null]);
  });
});
