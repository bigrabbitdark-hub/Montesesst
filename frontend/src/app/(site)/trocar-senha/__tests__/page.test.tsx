import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TrocarSenhaPage from '../page';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: push }) }));

function preencher(atual: string, nova: string, conf: string) {
  fireEvent.change(screen.getByLabelText('Senha temporária'), { target: { value: atual } });
  fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: nova } });
  fireEvent.change(screen.getByLabelText('Confirmar nova senha'), { target: { value: conf } });
  fireEvent.click(screen.getByRole('button', { name: /trocar senha/i }));
}

describe('/trocar-senha', () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
    localStorage.setItem('montese_token', 'T-ANTIGO');
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'empresa', tenantId: 't', mustChangePassword: true }));
    global.fetch = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ access_token: 'T-NOVO' }) })) as unknown as typeof fetch;
  });

  it('valida confirmação e tamanho antes de enviar', () => {
    render(<TrocarSenhaPage />);
    preencher('Temporaria1', 'curta', 'outra');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('recusa nova senha igual à temporária e acima de 72 caracteres', () => {
    render(<TrocarSenhaPage />);
    preencher('Temporaria1', 'Temporaria1', 'Temporaria1');
    expect(screen.getByRole('alert')).toHaveTextContent(/diferente/i);
    const longa = 'a'.repeat(73);
    preencher('Temporaria1', longa, longa);
    expect(screen.getByRole('alert')).toHaveTextContent(/72/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("recusa nova senha com 'ç' x 72 (144 bytes) com mensagem em bytes; aceita 36 'ç'", async () => {
    render(<TrocarSenhaPage />);
    const pesada = 'ç'.repeat(72);
    preencher('Temporaria1', pesada, pesada);
    expect(screen.getByRole('alert')).toHaveTextContent('A senha não pode passar de 72 bytes (acentos e símbolos contam mais de 1)');
    expect(global.fetch).not.toHaveBeenCalled();
    const ok = 'ç'.repeat(36);
    preencher('Temporaria1', ok, ok);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });
  it('troca, guarda o token novo, limpa a flag e vai para a home do papel', async () => {
    render(<TrocarSenhaPage />);
    preencher('Temporaria1', 'SenhaDefinitiva9', 'SenhaDefinitiva9');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard-v2'));
    expect(localStorage.getItem('montese_token')).toBe('T-NOVO');
    expect(JSON.parse(localStorage.getItem('montese_user')!).mustChangePassword).toBe(false);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('/api/auth/change-password');
    expect(init.headers.Authorization).toBe('Bearer T-ANTIGO');
    expect(JSON.parse(init.body)).toEqual({ current_password: 'Temporaria1', new_password: 'SenhaDefinitiva9' });
  });
  it('mostra a mensagem do servidor em caso de erro e não troca o token', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ message: 'Senha atual incorreta.' }) })) as unknown as typeof fetch;
    render(<TrocarSenhaPage />);
    preencher('Errada123', 'SenhaDefinitiva9', 'SenhaDefinitiva9');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Senha atual incorreta.'));
    expect(localStorage.getItem('montese_token')).toBe('T-ANTIGO');
    expect(push).not.toHaveBeenCalled();
  });
  it('sem sessão vai para /login', async () => {
    localStorage.clear();
    render(<TrocarSenhaPage />);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
  });
  it('sessão sem a flag vai para a home do papel', async () => {
    localStorage.setItem('montese_user', JSON.stringify({ id: 'u', role: 'tecnico', tenantId: null }));
    render(<TrocarSenhaPage />);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/tecnico/empresas'));
  });
});
