import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActingBanner } from '../ActingBanner';
import { startActing } from '@/lib/acting';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

// Sessão da sócia em formato JWT (a sessão guardada é decodificada para saber se ainda vale — Ruling 22).
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtExp = (deltaSeg: number) => `${b64({ alg: 'HS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + deltaSeg })}.sig`;
const T = jwtExp(3 * 3600);

describe('ActingBanner', () => {
  beforeEach(() => { localStorage.clear(); replace.mockClear(); });
  afterEach(() => vi.useRealTimers());
  const prepara = () => {
    localStorage.setItem('montese_token', T);
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'socio', tenantId: null }));
    startActing('ACT', 1800, { id: 'tenant-1', name: 'Empresa X' });
  };

  it('não renderiza fora do modo atuação', () => {
    const { container } = render(<ActingBanner />);
    expect(container).toBeEmptyDOMElement();
  });
  it('mostra a empresa e o botão sair; sair volta à ficha da empresa', () => {
    localStorage.setItem('montese_token', T);
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'socio', tenantId: null }));
    startActing('ACT', 1800, { id: 'tenant-1', name: 'Empresa X' });
    render(<ActingBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('Você está atuando em Empresa X');
    fireEvent.click(screen.getByRole('button', { name: /sair do modo empresa/i }));
    expect(replace).toHaveBeenCalledWith('/atuacao/clientes/tenant-1');
    expect(localStorage.getItem('montese_token')).toBe(T);
  });
  it('ao vencer, volta sozinha à ficha com aviso e restaura o token', () => {
    vi.useFakeTimers();
    prepara();
    render(<ActingBanner />);
    vi.advanceTimersByTime(1800 * 1000);
    expect(replace).toHaveBeenCalledWith('/atuacao/clientes/tenant-1?atuacao=expirada');
    expect(localStorage.getItem('montese_token')).toBe(T);
  });
  it('desmontar cancela o temporizador', () => {
    vi.useFakeTimers();
    prepara();
    const { unmount } = render(<ActingBanner />);
    unmount();
    vi.advanceTimersByTime(1800 * 1000 + 1000);
    expect(replace).not.toHaveBeenCalled();
    expect(localStorage.getItem('montese_token')).toBe('ACT');
  });
  it('sair com a sessão guardada da sócia VENCIDA vai ao login e limpa tudo', () => {
    localStorage.setItem('montese_token', jwtExp(-60));
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'socio', tenantId: null }));
    startActing('ACT', 1800, { id: 'tenant-1', name: 'Empresa X' });
    render(<ActingBanner />);
    fireEvent.click(screen.getByRole('button', { name: /sair do modo empresa/i }));
    expect(replace).toHaveBeenCalledWith('/login');
    for (const k of ['montese_token', 'montese_user', 'montese_socio_session', 'montese_acting']) expect(localStorage.getItem(k)).toBeNull();
  });
  it('ao vencer com a sessão guardada da sócia também vencida, vai ao login', () => {
    vi.useFakeTimers();
    localStorage.setItem('montese_token', jwtExp(60));
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'socio', tenantId: null }));
    startActing('ACT', 1800, { id: 'tenant-1', name: 'Empresa X' });
    render(<ActingBanner />);
    vi.advanceTimersByTime(1800 * 1000);
    expect(replace).toHaveBeenCalledWith('/login');
    expect(localStorage.getItem('montese_token')).toBeNull();
  });
});
