import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoleGuard } from '../RoleGuard';
import { startActing } from '@/lib/acting';

const replace = vi.fn();
// Router estável (como o do Next): o efeito do guard depende de [router].
const router = { replace };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (exp: number) => `${b64({ alg: 'HS256' })}.${b64({ exp })}.sig`;
const SOCIA = `${b64({ alg: 'HS256' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const now = () => Math.floor(Date.now() / 1000);

describe('RoleGuard', () => {
  beforeEach(() => { localStorage.clear(); replace.mockClear(); });

  it('token de atuação vencido restaura a sócia e vai à lista com aviso', () => {
    localStorage.setItem('montese_token', SOCIA);
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'socio', tenantId: null }));
    startActing(jwt(now() - 60), 1800, { id: 't1', name: 'E' });
    render(<RoleGuard allow={['empresa']}><p>conteudo</p></RoleGuard>);
    expect(replace).toHaveBeenCalledWith('/atuacao/clientes?atuacao=expirada');
    expect(localStorage.getItem('montese_token')).toBe(SOCIA);
    expect(localStorage.getItem('montese_acting')).toBeNull();
    expect(localStorage.getItem('montese_socio_session')).toBeNull();
    expect(screen.queryByText('conteudo')).toBeNull();
  });
  it('token de atuação vencido e sessão guardada da sócia TAMBÉM vencida: login e tudo limpo (Ruling 22)', () => {
    localStorage.setItem('montese_token', jwt(now() - 60));
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'socio', tenantId: null }));
    startActing(jwt(now() - 30), 1800, { id: 't1', name: 'E' });
    render(<RoleGuard allow={['empresa']}><p>conteudo</p></RoleGuard>);
    expect(replace).toHaveBeenCalledWith('/login');
    expect(replace).not.toHaveBeenCalledWith('/atuacao/clientes?atuacao=expirada');
    for (const k of ['montese_token', 'montese_user', 'montese_socio_session', 'montese_acting']) expect(localStorage.getItem(k)).toBeNull();
    expect(screen.queryByText('conteudo')).toBeNull();
  });
  it('sem atuação e token vencido: login e sessão removida', () => {
    localStorage.setItem('montese_token', jwt(now() - 60));
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'empresa', tenantId: 't' }));
    render(<RoleGuard allow={['empresa']}><p>conteudo</p></RoleGuard>);
    expect(replace).toHaveBeenCalledWith('/login');
    expect(localStorage.getItem('montese_token')).toBeNull();
    expect(localStorage.getItem('montese_user')).toBeNull();
  });
  it('token de atuação válido (role empresa) renderiza os filhos', () => {
    localStorage.setItem('montese_token', SOCIA);
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'socio', tenantId: null }));
    startActing(jwt(now() + 1800), 1800, { id: 't1', name: 'E' });
    render(<RoleGuard allow={['empresa']}><p>conteudo</p></RoleGuard>);
    expect(screen.getByText('conteudo')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
  it('senha temporária (mustChangePassword) redireciona para /trocar-senha sem renderizar filhos', () => {
    localStorage.setItem('montese_token', SOCIA);
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'empresa', tenantId: 't', mustChangePassword: true }));
    render(<RoleGuard allow={['empresa']}><p>conteudo</p></RoleGuard>);
    expect(replace).toHaveBeenCalledWith('/trocar-senha');
    expect(screen.queryByText('conteudo')).toBeNull();
  });
  it('mustChangePassword também redireciona quando o papel não é permitido', () => {
    localStorage.setItem('montese_token', SOCIA);
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'tecnico', tenantId: null, mustChangePassword: true }));
    render(<RoleGuard allow={['empresa']}><p>conteudo</p></RoleGuard>);
    expect(replace).toHaveBeenCalledWith('/trocar-senha');
  });
  it('sem a flag o comportamento é o mesmo (papel errado vai à home do papel)', () => {
    localStorage.setItem('montese_token', SOCIA);
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'tecnico', tenantId: null, mustChangePassword: false }));
    render(<RoleGuard allow={['empresa']}><p>conteudo</p></RoleGuard>);
    expect(replace).toHaveBeenCalledWith('/tecnico/empresas');
  });
});
