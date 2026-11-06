import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { homeFor, sessionExpired, logout, clearSession } from '../auth';
import { startActing } from '../acting';

describe('homeFor', () => {
  it('empresa cai no dashboard novo', () => expect(homeFor('empresa')).toBe('/dashboard-v2'));
  it('técnico/parceiro e admin mantêm a própria página inicial', () => {
    expect(homeFor('tecnico')).toBe('/tecnico/empresas');
    expect(homeFor('parceiro')).toBe('/tecnico/empresas');
    expect(homeFor('admin')).toBe('/admin/overview');
  });
});

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtExp = (deltaSeg: number) => `${b64({ alg: 'HS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + deltaSeg })}.sig`;
const TOKEN_SOCIA = jwtExp(3600);

describe('sessão e atuação', () => {
  const original = window.location;
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, 'location', { configurable: true, value: { href: '' } });
    localStorage.setItem('montese_token', TOKEN_SOCIA);
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u1', role: 'socio', tenantId: null }));
  });
  afterEach(() => Object.defineProperty(window, 'location', { configurable: true, value: original }));
  const quatro = () => ['montese_token', 'montese_user', 'montese_socio_session', 'montese_acting'].map((k) => localStorage.getItem(k));

  it('sessionExpired com atuação restaura a sócia e vai para a lista com aviso', () => {
    startActing('ACT', 1800, { id: 't1', name: 'E' });
    sessionExpired();
    expect(window.location.href).toBe('/atuacao/clientes?atuacao=expirada');
    expect(localStorage.getItem('montese_token')).toBe(TOKEN_SOCIA);
    expect(localStorage.getItem('montese_acting')).toBeNull();
  });
  it('sessionExpired atuando com a sessão guardada da sócia VENCIDA vai ao login e limpa tudo (Ruling 22)', () => {
    localStorage.setItem('montese_token', jwtExp(-60));
    startActing('ACT', 1800, { id: 't1', name: 'E' });
    sessionExpired();
    expect(window.location.href).toBe('/login');
    expect(quatro()).toEqual([null, null, null, null]);
  });
  it('sessionExpired sem atuação vai ao login e remove a sessão', () => {
    sessionExpired();
    expect(window.location.href).toBe('/login');
    expect(quatro()).toEqual([null, null, null, null]);
  });
  it('logout com atuação ativa não deixa rastro da sócia nem da atuação', () => {
    startActing('ACT', 1800, { id: 't1', name: 'E' });
    logout();
    expect(quatro()).toEqual([null, null, null, null]);
  });
  it('clearSession limpa as quatro chaves', () => {
    startActing('ACT', 1800, { id: 't1', name: 'E' });
    clearSession();
    expect(quatro()).toEqual([null, null, null, null]);
  });
});
