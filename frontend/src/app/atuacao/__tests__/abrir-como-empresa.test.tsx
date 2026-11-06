import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, search } = vi.hoisted(() => ({ push: vi.fn(), search: { value: '' } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
  useParams: () => ({ tenantId: 't-1' }),
  useSearchParams: () => new URLSearchParams(search.value),
}));

import FichaPage from '../clientes/[tenantId]/page';

const ficha = {
  id: 't-1', name: 'Alfa Ltda', trade_name: 'Alfa', cnpj: '11222333000181', sector: 'Metalurgia',
  contact_name: 'Maria', contact_phone: '11999990000', status: 'active', situacao: 'ativa',
  contact_role: 'Gerente', notes: 'Obs', plan: 'pro', created_at: '2026-01-01T00:00:00Z', units: [],
};
function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
let atuarRes: () => Response | Promise<Response>;
beforeEach(() => {
  push.mockReset();
  search.value = '';
  localStorage.setItem('montese_token', 'SOCIO');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u-1', role: 'socio' }));
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/atuar')) return atuarRes();
    if (/\/(interacoes|financeiro)/.test(String(url))) return resp(200, []);
    return resp(200, ficha);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

const atuarCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/atuar'));

describe('Abrir como empresa', () => {
  it('chama atuar, grava o token de atuação e vai para /dashboard-v2', async () => {
    atuarRes = () => resp(201, { access_token: 'ACT', expires_in: 1800, tenant: { id: 't-1', name: 'Alfa Ltda' } });
    render(<FichaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir como empresa' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard-v2'));
    const [url, init] = atuarCalls()[0];
    expect(String(url)).toBe('/api/atuacao/clientes/t-1/atuar');
    expect(init.method).toBe('POST');
    expect(localStorage.getItem('montese_token')).toBe('ACT');
  });

  it('em 403 mostra a mensagem e não altera o token', async () => {
    atuarRes = () => resp(403, { code: 'ACTING_NOT_ALLOWED' });
    render(<FichaPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir como empresa' }));
    expect(await screen.findByText('Você não pode atuar nesta empresa.')).toBeInTheDocument();
    expect(localStorage.getItem('montese_token')).toBe('SOCIO');
    expect(push).not.toHaveBeenCalled();
  });

  it('não permite duplo clique', async () => {
    let fim!: (r: Response) => void;
    atuarRes = () => new Promise<Response>((r) => { fim = r; });
    render(<FichaPage />);
    const botao = await screen.findByRole('button', { name: 'Abrir como empresa' });
    fireEvent.click(botao);
    fireEvent.click(botao);
    expect(atuarCalls()).toHaveLength(1);
    expect(await screen.findByRole('button', { name: /abrindo/i })).toBeDisabled();
    fim(resp(403, {}));
    await screen.findByText('Você não pode atuar nesta empresa.');
  });

  it('mostra aviso quando ?atuacao=expirada', async () => {
    search.value = 'atuacao=expirada';
    render(<FichaPage />);
    expect(await screen.findByText('O modo empresa expirou. Abra novamente para continuar.')).toBeInTheDocument();
  });
});
