import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Router estável (como o real do Next): a página tem `[router]` nas deps do efeito de carga,
// e um objeto novo a cada render causaria loop infinito de fetch + setState.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminTecnicosPage from '../tecnicos/page';

const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
const TECNICO = { id: 't1', full_name: 'Ana Souza', email: 'ana@exemplo.com', registration_number: null, specialization: 'Higiene', status: 'active' };
const EMPRESAS = [{ id: 'e1', name: 'Acme' }, { id: 'e2', name: 'Beta' }];

let fetchMock: ReturnType<typeof vi.fn>;
const chamadas = (url: string, metodo: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === metodo);

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/technicians' && !init?.method) return ok([TECNICO]);
    if (url === '/api/tenants') return ok(EMPRESAS);
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/tecnicos (DS v2)', () => {
  it('mostra o título e as duas seções em cartões .adm-card', async () => {
    render(<AdminTecnicosPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Técnicos' })).toBeInTheDocument();
    for (const nome of ['Criar técnico', 'Técnicos cadastrados']) {
      expect(screen.getByRole('heading', { level: 3, name: nome }).closest('section')).toHaveClass('adm-card');
    }
  });

  it('campos e botões usam os primitivos; o status vira Badge com o texto original', async () => {
    render(<AdminTecnicosPage />);
    expect(await screen.findByLabelText('E-mail')).toHaveClass('adm-input');
    expect(screen.getByRole('button', { name: 'Criar técnico' })).toHaveClass('adm-btn', 'adm-btn-primary');
    expect(screen.getByRole('button', { name: 'Vincular a empresa' })).toHaveClass('adm-link');
    expect(await screen.findByText('active')).toHaveClass('rounded-full');
    expect(screen.getByText('Ana Souza')).toBeInTheDocument();
  });

  it('criar técnico continua enviando o mesmo POST (campos opcionais vazios ficam de fora)', async () => {
    render(<AdminTecnicosPage />);
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'novo@exemplo.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'senha-de-teste' } });
    fireEvent.change(screen.getByLabelText('Nome completo'), { target: { value: 'Nova Pessoa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar técnico' }));
    await waitFor(() => expect(chamadas('/api/technicians', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/technicians', 'POST')[0][1].body)).toEqual({
      email: 'novo@exemplo.com',
      password: 'senha-de-teste',
      full_name: 'Nova Pessoa',
    });
  });

  it('vincular a empresas: lista de checkboxes com .adm-input e um POST por empresa marcada, em ordem', async () => {
    render(<AdminTecnicosPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular a empresa' }));
    const acme = screen.getByLabelText('Acme');
    expect(acme.closest('div')).toHaveClass('adm-input');
    fireEvent.click(acme);
    fireEvent.click(screen.getByLabelText('Beta'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar vínculo' }));
    await waitFor(() => expect(chamadas('/api/technicians/t1/assign', 'POST')).toHaveLength(2));
    const corpos = chamadas('/api/technicians/t1/assign', 'POST').map(([, init]) => JSON.parse(init.body));
    expect(corpos).toEqual([{ tenant_id: 'e1' }, { tenant_id: 'e2' }]);
    expect(await screen.findByText('Vinculado com sucesso.')).toBeInTheDocument();
  });
});
