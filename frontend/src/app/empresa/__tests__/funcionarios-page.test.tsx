import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import Funcionarios from '../funcionarios/page';

function resp(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body } as Response;
}

const UNITS = [{ id: 'u1', name: 'Matriz SP' }, { id: 'u2', name: 'Filial RJ' }];

describe('página /empresa/funcionarios', () => {
  beforeEach(() => push.mockClear());
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('sem token redireciona para /login e não busca nada', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Funcionarios />);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mostra o cabeçalho, a tabela e recarrega a tabela após cadastrar', async () => {
    localStorage.setItem('montese_token', 'x');
    const tabela = vi.fn(() => resp({ items: [], total: 0 }));
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/company-units')) return resp(UNITS);
      if (url.startsWith('/api/employees/table')) return tabela();
      if (url === '/api/employees' && init?.method === 'POST') return resp({ id: 'n' }, 201);
      return resp({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Funcionarios />);
    expect(await screen.findByRole('heading', { name: 'Funcionários' })).toBeTruthy();
    await screen.findByText('Nenhum funcionário cadastrado ainda.');
    expect(tabela).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar funcionário' }));
    fireEvent.change(screen.getByLabelText(/^Funcionário/), { target: { value: 'Ana Teste' } });
    fireEvent.change(screen.getByLabelText(/^CPF/), { target: { value: '52998224725' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar funcionário' }));
    await screen.findByText('Funcionário cadastrado');
    await waitFor(() => expect(tabela).toHaveBeenCalledTimes(2));
  });

  it('o filtro de filial recarrega a tabela com company_unit_id', async () => {
    localStorage.setItem('montese_token', 'x');
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/company-units')) return resp(UNITS);
      return resp({ items: [], total: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Funcionarios />);
    await screen.findByRole('option', { name: 'Filial RJ' });
    fireEvent.change(screen.getByLabelText('Filtrar por filial'), { target: { value: 'u2' } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/employees/table') && String(u).includes('company_unit_id=u2'))).toBe(true),
    );
  });
});
