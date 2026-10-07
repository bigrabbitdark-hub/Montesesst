import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Router e params estáveis (como os reais do Next): a página tem `[router, tenantId]` nas deps do efeito
// de carga, e um objeto novo a cada render causaria loop infinito de fetch + setState.
const router = vi.hoisted(() => ({ push: vi.fn() }));
const params = vi.hoisted(() => ({ id: 't1' }));
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => params }));

import AdminEmpresaDetailPage from '../empresas/[id]/page';

const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
const DETALHE = {
  tenant: {
    id: 't1', name: 'Acme Ltda', cnpj: '00.000.000/0001-00', plan: 'Pro', status: 'ativo', sector: 'Indústria',
    contact_name: 'Carla', contact_phone: '48 99999-0000', technicians: [{ id: 'x', name: 'Ana' }], partners: [],
  },
  documents: [{ id: 'd1', category: 'PGR', title: 'PGR 2026', expires_at: '2026-12-31', created_at: '2026-01-01T00:00:00Z' }],
  epis: [{ id: 'p1', ca_number: '12345', ca_valid_until: '2027-01-31', category: 'cabeça', code: 'C1', description: 'Capacete' }],
  inspections: [{ id: 'i1', status: 'concluida', visited_at: '2026-09-01', concluded_at: '2026-09-02T10:00:00Z' }],
  subscriptions: [{ id: 's1', status: 'authorized', created_at: '2026-10-01T00:00:00Z', plan_name: 'Plano Pro', price_cents: 9900 }],
};
const AUDITORIA = [{ id: 'a1', occurred_at: '2026-10-05T12:00:00Z', actor_full_name: 'Ana', actor_role: 'admin', action: 'login', resource_type: 'users', status_code: 403 }];
const EVENTOS = [{ id: 'e1', amount_cents: 9900, status: 'approved', occurred_at: '2026-10-02T12:00:00Z' }];

let fetchMock: ReturnType<typeof vi.fn>;
const chamadas = (url: string, metodo: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && init?.method === metodo);

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/tenants/t1/detail') return ok(DETALHE);
    if (String(url).startsWith('/api/audit-log')) return ok(AUDITORIA);
    if (url === '/api/subscriptions/s1/payment-events') return ok(EVENTOS);
    if (url === '/api/subscriptions/s1/status' && init?.method === 'PATCH') {
      const { status } = JSON.parse(init.body as string);
      return ok({ id: 's1', status, plan_name: 'Plano Pro', price_cents: 9900, created_at: '2026-10-01T00:00:00Z' });
    }
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/empresas/[id] (DS v2)', () => {
  it('mostra o nome da empresa como título, o link de voltar e os dados cadastrais', async () => {
    render(<AdminEmpresaDetailPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Acme Ltda' })).toBeInTheDocument();
    const voltar = screen.getByRole('link', { name: /Voltar para empresas/ });
    expect(voltar).toHaveAttribute('href', '/admin/empresas');
    expect(voltar).toHaveClass('adm-link');
    expect(screen.getByText('00.000.000/0001-00')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('ativo')).toHaveClass('rounded-full');
  });

  it('as 5 seções são cartões .adm-card e as 4 tabelas usam .adm-table', async () => {
    render(<AdminEmpresaDetailPage />);
    for (const nome of ['Assinaturas', 'Documentos', 'EPIs', 'Inspeções', 'Auditoria (últimos 20 eventos)']) {
      const titulo = await screen.findByRole('heading', { level: 3, name: nome });
      expect(titulo.closest('section')).toHaveClass('adm-card');
    }
    const tabelas = screen.getAllByRole('table');
    expect(tabelas).toHaveLength(4);
    tabelas.forEach((t) => expect(t).toHaveClass('adm-table'));
  });

  it('status viram Badge com o texto original: assinatura (verde), inspeção (neutro) e HTTP da auditoria (amarelo)', async () => {
    render(<AdminEmpresaDetailPage />);
    const assinatura = await screen.findByText('authorized');
    expect(assinatura).toHaveClass('rounded-full');
    expect(assinatura.className).toContain('text-adm-status-ok-text');
    expect(screen.getByText('concluida')).toHaveClass('rounded-full');
    const http = screen.getByText('403');
    expect(http).toHaveClass('rounded-full');
    expect(http.className).toContain('text-adm-status-warn-text');
  });

  it('Pausar envia PATCH /status {status:"paused"} e a linha passa a oferecer Reativar', async () => {
    render(<AdminEmpresaDetailPage />);
    const pausar = await screen.findByRole('button', { name: 'Pausar' });
    expect(pausar).toHaveClass('adm-link');
    fireEvent.click(pausar);
    await waitFor(() => expect(chamadas('/api/subscriptions/s1/status', 'PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/subscriptions/s1/status', 'PATCH')[0][1].body)).toEqual({ status: 'paused' });
    expect(await screen.findByRole('button', { name: 'Reativar' })).toBeInTheDocument();
    expect(screen.getByText('paused').className).toContain('text-adm-status-warn-text');
  });

  it('Cancelar pede confirmação: "Não" desiste sem requisição; "Sim, cancelar" envia {status:"cancelled"}', async () => {
    render(<AdminEmpresaDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(screen.getByText('Cancelar de vez?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Não' }));
    expect(chamadas('/api/subscriptions/s1/status', 'PATCH')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sim, cancelar' }));
    await waitFor(() => expect(chamadas('/api/subscriptions/s1/status', 'PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/subscriptions/s1/status', 'PATCH')[0][1].body)).toEqual({ status: 'cancelled' });
    expect(await screen.findByText('cancelled')).toHaveClass('rounded-full');
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull();
  });

  it('Ver histórico busca as cobranças e alterna para "Ocultar histórico"', async () => {
    render(<AdminEmpresaDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ver histórico' }));
    expect(await screen.findByText(/approved/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/subscriptions/s1/payment-events')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar histórico' }));
    expect(screen.queryByText(/approved/)).toBeNull();
  });

  it('empresa inexistente (404) mostra a mensagem e nenhuma seção', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === '/api/tenants/t1/detail' ? { ok: false, status: 404, json: async () => ({}) } : ok([]),
    );
    render(<AdminEmpresaDetailPage />);
    expect(await screen.findByText('Empresa não encontrada.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: 'Assinaturas' })).toBeNull();
  });
});

describe('/admin/empresas/[id] — polimentos', () => {
  it('"Cancelar" e "Sim, cancelar" usam .adm-link-danger', async () => {
    render(<AdminEmpresaDetailPage />);
    const cancelar = await screen.findByRole('button', { name: 'Cancelar' });
    expect(cancelar).toHaveClass('adm-link-danger');
    fireEvent.click(cancelar);
    expect(screen.getByRole('button', { name: 'Sim, cancelar' })).toHaveClass('adm-link-danger');
  });

  it('os dados cadastrais ficam em 1 coluna no mobile (rótulo acima do valor) e em 2 a partir de sm', async () => {
    render(<AdminEmpresaDetailPage />);
    const dl = (await screen.findByText('CNPJ')).closest('dl');
    expect(dl).toHaveClass('grid-cols-1', 'sm:grid-cols-2');
  });
});
