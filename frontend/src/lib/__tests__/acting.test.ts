import { describe, it, expect, beforeEach } from 'vitest';
import { getActing, restoreSocioSessionIfActing, startActing, stopActing } from '../acting';

// Token da sócia no formato JWT (a sessão guardada é decodificada para saber se ainda vale).
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtExp = (deltaSeg: number) => `${b64({ alg: 'HS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + deltaSeg })}.sig`;
const TOKEN_SOCIA = jwtExp(3600);
const loginSocio = (token: string = TOKEN_SOCIA) => {
  localStorage.setItem('montese_token', token);
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u1', role: 'socio', tenantId: null }));
};

describe('acting', () => {
  beforeEach(() => localStorage.clear());

  it('startActing troca o slot do token por um usuário "empresa" e guarda a sessão da sócia', () => {
    loginSocio();
    expect(startActing('TOKEN-ACT', 1800, { id: 't1', name: 'Empresa X' })).toBe(true);
    expect(localStorage.getItem('montese_token')).toBe('TOKEN-ACT');
    expect(JSON.parse(localStorage.getItem('montese_user')!)).toEqual({ id: 'u1', role: 'empresa', tenantId: 't1' });
    expect(getActing()).toMatchObject({ tenantId: 't1', tenantName: 'Empresa X' });
    expect(getActing()!.expiresAt).toBeGreaterThan(Date.now());
  });
  it('stopActing restaura a sessão original e devolve o tenant', () => {
    loginSocio();
    startActing('TOKEN-ACT', 1800, { id: 't1', name: 'Empresa X' });
    expect(stopActing()).toBe('t1');
    expect(localStorage.getItem('montese_token')).toBe(TOKEN_SOCIA);
    expect(JSON.parse(localStorage.getItem('montese_user')!).role).toBe('socio');
    expect(getActing()).toBeNull();
    expect(localStorage.getItem('montese_socio_session')).toBeNull();
  });
  it('sem sessão não inicia', () => expect(startActing('T', 1800, { id: 't', name: 'x' })).toBe(false));
  it('stopActing fora do modo é no-op', () => {
    loginSocio();
    expect(stopActing()).toBeNull();
    expect(localStorage.getItem('montese_token')).toBe(TOKEN_SOCIA);
  });
  it('restoreSocioSessionIfActing só age se estiver atuando', () => {
    loginSocio();
    expect(restoreSocioSessionIfActing()).toBe(false);
    startActing('TOKEN-ACT', 1800, { id: 't1', name: 'E' });
    expect(restoreSocioSessionIfActing()).toBe(true);
    expect(localStorage.getItem('montese_token')).toBe(TOKEN_SOCIA);
  });
  it('segunda startActing não sobrescreve o backup da sócia', () => {
    loginSocio();
    startActing('ACT-1', 1800, { id: 't1', name: 'A' });
    startActing('ACT-2', 1800, { id: 't2', name: 'B' });
    expect(stopActing()).toBe('t2');
    expect(localStorage.getItem('montese_token')).toBe(TOKEN_SOCIA);
  });
  it('montese_user com JSON inválido => startActing devolve false sem lançar', () => {
    localStorage.setItem('montese_token', 'T');
    localStorage.setItem('montese_user', '{nao-json');
    expect(startActing('A', 1800, { id: 't', name: 'x' })).toBe(false);
  });
  it('stopActing com backup corrompido remove as chaves de atuação e devolve null', () => {
    loginSocio();
    startActing('ACT', 1800, { id: 't1', name: 'E' });
    localStorage.setItem('montese_socio_session', '{quebrado');
    expect(stopActing()).toBeNull();
    expect(localStorage.getItem('montese_socio_session')).toBeNull();
    expect(localStorage.getItem('montese_acting')).toBeNull();
    // M4: o token de atuação não pode ficar em montese_token (a sócia seguiria atuando sem faixa): limpa TUDO => login.
    expect(localStorage.getItem('montese_token')).toBeNull();
    expect(localStorage.getItem('montese_user')).toBeNull();
  });
  it('restoreSocioSessionIfActing com backup corrompido devolve false e limpa a sessão inteira (leva ao login)', () => {
    loginSocio();
    startActing('ACT', 1800, { id: 't1', name: 'E' });
    localStorage.setItem('montese_socio_session', '{quebrado');
    expect(restoreSocioSessionIfActing()).toBe(false);
    expect(['montese_token', 'montese_user', 'montese_socio_session', 'montese_acting'].map((k) => localStorage.getItem(k))).toEqual([null, null, null, null]);
  });

  // Ruling 22: sessão guardada da sócia já vencida não é restaurada (ia direto ao 401): limpa tudo => login.
  const quatro = () => ['montese_token', 'montese_user', 'montese_socio_session', 'montese_acting'].map((k) => localStorage.getItem(k));
  it('stopActing com a sessão guardada da sócia VENCIDA não restaura: limpa tudo e devolve null', () => {
    loginSocio(jwtExp(-60));
    startActing('ACT', 1800, { id: 't1', name: 'E' });
    expect(stopActing()).toBeNull();
    expect(quatro()).toEqual([null, null, null, null]);
  });
  it('restoreSocioSessionIfActing com a sessão guardada VENCIDA devolve false e limpa tudo', () => {
    loginSocio(jwtExp(-60));
    startActing('ACT', 1800, { id: 't1', name: 'E' });
    expect(restoreSocioSessionIfActing()).toBe(false);
    expect(quatro()).toEqual([null, null, null, null]);
  });
  it('sessão guardada que não é JWT legível conta como vencida (falha fechada)', () => {
    loginSocio('nao-e-jwt');
    startActing('ACT', 1800, { id: 't1', name: 'E' });
    expect(stopActing()).toBeNull();
    expect(quatro()).toEqual([null, null, null, null]);
  });
});
