import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const nav = vi.hoisted(() => ({ tenantId: 'ten-77' }));
vi.mock('next/navigation', () => ({ useParams: () => ({ tenantId: nav.tenantId }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ getToken: () => 'tok', getUser: () => ({ id: 'u1', role: 'tecnico', tenantId: 'outra' }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') } }));

import Page from '../[tenantId]/epi/page';

const fetchMock = vi.fn();
const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const dash = {
  alert_days: 30, period: { from: '2026-09-18', to: '2026-10-18' },
  kpis: { epis_total: 3, stock_total: 10, stock_value: '1.00', low_stock: 0, zero_stock: 0, ca_expired: 0, ca_expiring: 0, lots_expired: 0, lots_expiring: 0, pending_signatures: 1 },
  alerts: [], recent_movements: [],
  pending: [{ delivery_id: 'd1', delivered_at: '2026-10-10', employee_id: 'emp1', employee_name: 'João Lima', epi_id: 'e1', epi_description: 'Luva', quantity: 1, signature_status: 'pendente', active_request_expires_at: null }],
};
const page = { items: [], total: 0, page: 1, page_size: 25 };
const urls = () => fetchMock.mock.calls.map((c) => c[0] as string);
const tenantOf = (u: string) => new URL(u, 'http://x').searchParams.get('tenant_id');

beforeEach(() => {
  nav.tenantId = 'ten-77';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/epis/dashboard')) return res(dash);
    if (url.startsWith('/api/epis/search') || url.startsWith('/api/epis/movements') || url.startsWith('/api/epi-signatures/pending')) return res(page);
    if (url.startsWith('/api/employees')) return res([]);
    if (url.startsWith('/api/epi-catalog-items')) return res([]);
    return res({}, 404);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('rota do técnico /tecnico/empresas/[tenantId]/epi', () => {
  it('mostra as quatro abas e passa o tenant_id da URL a todas as consultas de cada aba', async () => {
    render(<Page />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Painel', 'Cadastro', 'Movimentação', 'Fichas']);
    await screen.findByText('EPIs ativos');
    for (const nome of ['Cadastro', 'Movimentação', 'Fichas']) {
      fireEvent.click(screen.getByRole('tab', { name: nome }));
      await waitFor(() => expect(screen.getByRole('tab', { name: nome })).toHaveAttribute('aria-selected', 'true'));
    }
    await waitFor(() => expect(urls().some((u) => u.startsWith('/api/employees'))).toBe(true));
    const scoped = urls().filter((u) => /^\/api\/(epis\/(dashboard|search|movements|settings)|employees|epi-signatures\/pending)/.test(u));
    expect(scoped.some((u) => u.startsWith('/api/epis/dashboard'))).toBe(true);
    expect(scoped.some((u) => u.startsWith('/api/epis/search'))).toBe(true);
    expect(scoped.some((u) => u.startsWith('/api/epis/movements'))).toBe(true);
    expect(scoped.some((u) => u.startsWith('/api/employees'))).toBe(true);
    for (const u of scoped) expect(tenantOf(u), u).toBe('ten-77');
  });

  it('o técnico não vê o ajuste de dias de aviso, nem abertura/ajuste de estoque, e os atalhos do painel trocam de aba', async () => {
    render(<Page />);
    await screen.findByText('EPIs ativos');
    expect(screen.queryByText('Dias de aviso de vencimento')).toBeNull();
    expect(screen.queryByRole('link', { name: /Registrar entrega|Abrir ficha|Consultar estoque/ })).toBeNull();
    expect(document.querySelector('a[href^="/empresa"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect(screen.getByRole('tab', { name: 'Movimentação' })).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(document.getElementById('mov-type')).not.toBeNull());
    const labels = Array.from(document.querySelectorAll('#mov-type option')).map((o) => o.textContent);
    expect(labels).toContain('Entrega a funcionário');
    expect(labels.join('|')).not.toMatch(/Abertura|Ajuste/);
    fireEvent.click(screen.getByRole('tab', { name: 'Painel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir ficha' }));
    expect(screen.getByRole('tab', { name: 'Fichas' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tec-epi-tab-fichas');
  });

  it('"Gerar link" do painel abre o diálogo de assinatura da entrega e gera o pedido sem tenant_id no corpo', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url.startsWith('/api/epis/dashboard')) return res(dash);
      if (init.method === 'POST' && url === '/api/epi-signatures/requests') return res({ id: 'r1', url: 'https://x', qr_payload: 'q', code: '123456', expires_at: '2026-10-19T12:00:00Z', delivery_ids: ['d1'] }, 201);
      return res(page);
    });
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: /Gerar link/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(Array.from(dlg.querySelectorAll('button')).find((b) => /Gerar link de assinatura/.test(b.textContent ?? ''))!);
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body).toMatchObject({ employee_id: 'emp1', delivery_ids: ['d1'] });
    expect(body).not.toHaveProperty('tenant_id');
  });
});

describe('rota do técnico: troca de empresa e recarga', () => {
  it('trocar de empresa volta para a aba Painel e fecha o diálogo de link', async () => {
    const { rerender } = render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: /Gerar link/ }));
    await screen.findByRole('dialog');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Fichas' }));
    expect(screen.getByRole('tab', { name: 'Fichas' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Painel' }));
    fireEvent.click(await screen.findByRole('button', { name: /Gerar link/ }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('tab', { name: 'Fichas' }));
    nav.tenantId = 'ten-88';
    rerender(<Page />);
    expect(screen.getByRole('tab', { name: 'Painel' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('dialog')).toBeNull();
    await screen.findByText('EPIs ativos');
    const last = urls().filter((u) => u.startsWith('/api/epis/dashboard')).pop()!;
    expect(tenantOf(last)).toBe('ten-88');
  });

  it('gerar link com sucesso e fechar recarrega o painel (nova consulta do dashboard); cancelar não', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url.startsWith('/api/epis/dashboard')) return res(dash);
      if (init.method === 'POST' && url === '/api/epi-signatures/requests') return res({ id: 'r1', url: 'https://x', qr_payload: 'q', code: '123456', expires_at: '2026-10-19T12:00:00Z', delivery_ids: ['d1'] }, 201);
      return res(page);
    });
    const dashCalls = () => urls().filter((u) => u.startsWith('/api/epis/dashboard')).length;
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: /Gerar link/ }));
    let dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancelar' }));
    expect(dashCalls()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /Gerar link/ }));
    dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Gerar link de assinatura' }));
    await screen.findByTestId('signature-code');
    expect(dashCalls()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(dashCalls()).toBe(2));
  });
});

describe('rota do técnico: assinatura presencial pelo painel', () => {
  it('"Registrar assinatura presencial" da pendência registra com a entrega e recarrega o painel', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url.startsWith('/api/epis/dashboard')) return res(dash);
      if (init.method === 'POST' && url === '/api/epi-signatures/in-person') return res({ in_person_id: 'p', registered_at: 'x', deliveries: [] }, 201);
      return res(page);
    });
    const dashCalls = () => urls().filter((u) => u.startsWith('/api/epis/dashboard')).length;
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: /Registrar assinatura presencial de João Lima/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('Nome da testemunha'), { target: { value: 'Maria Souza' } });
    fireEvent.change(within(dlg).getByLabelText('Motivo'), { target: { value: 'Funcionário sem celular' } });
    expect(dashCalls()).toBe(1);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Registrar assinatura presencial' }));
    await waitFor(() => expect(dashCalls()).toBe(2));
    const post = fetchMock.mock.calls.find((c) => c[0] === '/api/epi-signatures/in-person')!;
    expect(JSON.parse((post[1] as RequestInit).body as string).delivery_ids).toEqual(['d1']);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
