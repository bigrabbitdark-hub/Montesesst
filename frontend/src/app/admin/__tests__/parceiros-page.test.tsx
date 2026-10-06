import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Router estável (como o real do Next): a página tem `[router]` nas deps do efeito de carga,
// e um objeto novo a cada render causaria loop infinito de fetch + setState.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminParceirosPage from '../parceiros/page';

const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
const PARCEIRO = { id: 'p1', full_name: 'Bruno Lima', email: 'bruno@exemplo.com', service_region: 'Grande Florianópolis', status: 'active' };
const EMPRESAS = [{ id: 'e1', name: 'Acme' }];

let fetchMock: ReturnType<typeof vi.fn>;
const chamadas = (url: string, metodo: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === metodo);

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/partners' && !init?.method) return ok([PARCEIRO]);
    if (url === '/api/tenants') return ok(EMPRESAS);
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/parceiros (DS v2)', () => {
  it('mostra o título e as duas seções em cartões .adm-card', async () => {
    render(<AdminParceirosPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Parceiros' })).toBeInTheDocument();
    for (const nome of ['Criar parceiro', 'Parceiros cadastrados']) {
      expect(screen.getByRole('heading', { level: 3, name: nome }).closest('section')).toHaveClass('adm-card');
    }
  });

  it('campos e botões usam os primitivos; o status vira Badge com o texto original', async () => {
    render(<AdminParceirosPage />);
    expect(await screen.findByLabelText('Região de atendimento')).toHaveClass('adm-input');
    expect(screen.getByRole('button', { name: 'Criar parceiro' })).toHaveClass('adm-btn', 'adm-btn-primary');
    expect(screen.getByRole('button', { name: 'Vincular a empresa' })).toHaveClass('adm-link');
    expect(await screen.findByText('active')).toHaveClass('rounded-full');
    expect(screen.getByText('(Grande Florianópolis)')).toBeInTheDocument();
  });

  it('criar parceiro continua enviando o mesmo POST (telefone vazio fica de fora)', async () => {
    render(<AdminParceirosPage />);
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'novo@exemplo.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-de-teste' } });
    fireEvent.change(screen.getByLabelText('Nome completo'), { target: { value: 'Nova Pessoa' } });
    fireEvent.change(screen.getByLabelText('Região de atendimento'), { target: { value: 'Sul' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar parceiro' }));
    await waitFor(() => expect(chamadas('/api/partners', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/partners', 'POST')[0][1].body)).toEqual({
      email: 'novo@exemplo.com',
      password: 'senha-de-teste',
      full_name: 'Nova Pessoa',
      service_region: 'Sul',
    });
  });

  it('vincular a empresa: select com .adm-input e POST com o tenant escolhido', async () => {
    render(<AdminParceirosPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a empresa' }));
    const seletor = screen.getByRole('combobox');
    expect(seletor).toHaveClass('adm-input');
    fireEvent.change(seletor, { target: { value: 'e1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar vínculo' }));
    await waitFor(() => expect(chamadas('/api/partners/p1/assign', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/partners/p1/assign', 'POST')[0][1].body)).toEqual({ tenant_id: 'e1' });
    expect(await screen.findByText('Vinculado com sucesso.')).toBeInTheDocument();
  });
});
