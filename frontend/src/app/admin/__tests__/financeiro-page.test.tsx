import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Router estável (como o real do Next): a página tem `[router]` nas deps do efeito de carga,
// e um objeto novo a cada render causaria loop infinito de fetch + setState.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminFinanceiroPage from '../financeiro/page';

const PLANO = { id: 'p1', audience: 'empresa', slug: 'pro', name: 'Plano Pro', price_cents: 9900, employee_limit: 50 };
const ASSINATURA = {
  id: 's1',
  status: 'authorized',
  created_at: '2026-10-01T00:00:00Z',
  plan_name: 'Plano Pro',
  price_cents: 9900,
  tenant_name: 'Acme Ltda',
  technician_name: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (url === '/api/plans' ? [PLANO] : url === '/api/subscriptions' ? [ASSINATURA] : {}),
  }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/financeiro (DS v2)', () => {
  it('mostra título, recebedor e as duas seções dentro de cartões .adm-card', async () => {
    render(<AdminFinanceiroPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Financeiro' })).toBeInTheDocument();
    expect(screen.getByText(/Recebedor:/)).toBeInTheDocument();
    for (const nome of ['Planos', 'Assinaturas']) {
      const titulo = screen.getByRole('heading', { level: 3, name: nome });
      expect(titulo.closest('section')).toHaveClass('adm-card');
    }
  });

  it('a tabela de planos usa .adm-table e as ações em texto usam .adm-link', async () => {
    render(<AdminFinanceiroPage />);
    const tabela = await screen.findByRole('table');
    expect(tabela).toHaveClass('adm-table');
    expect(screen.getByRole('button', { name: 'Editar preço' })).toHaveClass('adm-link');
    expect(await screen.findByRole('button', { name: 'Pausar' })).toHaveClass('adm-link');
    expect(screen.getByRole('button', { name: 'Ver histórico' })).toHaveClass('adm-link');
  });

  it('o status da assinatura vira Badge verde com o texto original "authorized"', async () => {
    render(<AdminFinanceiroPage />);
    const badge = await screen.findByText('authorized');
    expect(badge).toHaveClass('rounded-full');
    expect(badge.className).toContain('text-adm-status-ok-text');
  });

  it('editar o preço usa .adm-input e continua enviando o mesmo PATCH (price_cents em centavos)', async () => {
    render(<AdminFinanceiroPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Editar preço' }));
    const campo = screen.getByPlaceholderText('0,00');
    expect(campo).toHaveClass('adm-input');
    fireEvent.change(campo, { target: { value: '10,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => {
      const chamada = fetchMock.mock.calls.find(([url, init]) => url === '/api/plans/p1' && init?.method === 'PATCH');
      expect(chamada).toBeDefined();
      expect(JSON.parse(chamada![1].body)).toEqual({ price_cents: 1050 });
    });
  });
});

describe('/admin/financeiro — ações de status da assinatura', () => {
  const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
  const patchs = () => fetchMock.mock.calls.filter(([u, init]) => u === '/api/subscriptions/s1/status' && init?.method === 'PATCH');

  // O PATCH devolve a assinatura inteira atualizada; a página substitui a linha por ela.
  function simular(statusInicial: string, falhar = false) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/plans') return ok([PLANO]);
      if (url === '/api/subscriptions' && !init?.method) return ok([{ ...ASSINATURA, status: statusInicial }]);
      if (url === '/api/subscriptions/s1/status' && init?.method === 'PATCH') {
        if (falhar) return { ok: false, json: async () => ({}) };
        return ok({ ...ASSINATURA, status: JSON.parse(init.body as string).status });
      }
      return ok({});
    });
  }

  it('Pausar envia PATCH {status:"paused"} e a linha passa a oferecer Reativar', async () => {
    simular('authorized');
    render(<AdminFinanceiroPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pausar' }));
    await waitFor(() => expect(patchs()).toHaveLength(1));
    expect(JSON.parse(patchs()[0][1].body)).toEqual({ status: 'paused' });
    expect(await screen.findByRole('button', { name: 'Reativar' })).toBeInTheDocument();
    expect(screen.getByText('paused').className).toContain('text-adm-status-warn-text');
  });

  it('Reativar envia PATCH {status:"authorized"}', async () => {
    simular('paused');
    render(<AdminFinanceiroPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reativar' }));
    await waitFor(() => expect(patchs()).toHaveLength(1));
    expect(JSON.parse(patchs()[0][1].body)).toEqual({ status: 'authorized' });
    expect(await screen.findByRole('button', { name: 'Pausar' })).toBeInTheDocument();
  });

  it('Cancelar pede confirmação: "Não" desiste sem requisição; "Sim, cancelar" envia {status:"cancelled"}', async () => {
    simular('authorized');
    render(<AdminFinanceiroPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('Cancelar de vez?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Não' }));
    expect(patchs()).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }));
    await waitFor(() => expect(patchs()).toHaveLength(1));
    expect(JSON.parse(patchs()[0][1].body)).toEqual({ status: 'cancelled' });
    expect(await screen.findByText('cancelled')).toHaveClass('rounded-full');
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
  });

  it('falha no PATCH mostra a mensagem de erro e mantém o status anterior', async () => {
    simular('authorized', true);
    render(<AdminFinanceiroPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pausar' }));
    expect(await screen.findByText('Não foi possível atualizar o status da assinatura.')).toBeInTheDocument();
    expect(screen.getByText('authorized')).toBeInTheDocument();
  });
});

describe('/admin/financeiro — ações destrutivas no primitivo', () => {
  it('"Cancelar" e "Sim, cancelar" usam .adm-link-danger', async () => {
    render(<AdminFinanceiroPage />);
    const cancelar = await screen.findByRole('button', { name: 'Cancelar' });
    expect(cancelar).toHaveClass('adm-link-danger');
    fireEvent.click(cancelar);
    expect(screen.getByRole('button', { name: 'Sim, cancelar' })).toHaveClass('adm-link-danger');
  });
});
