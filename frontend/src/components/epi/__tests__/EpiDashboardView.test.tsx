import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const auth = vi.hoisted(() => ({ role: 'empresa' as string }));
vi.mock('@/lib/auth', () => ({ getToken: () => 'tok', getUser: () => ({ id: 'u1', role: auth.role, tenantId: 't1' }) }));

import { EpiDashboardView } from '../EpiDashboardView';
import { addDays, todayDateOnly } from '@/lib/epi/format';
import type { EpiDashboard } from '@/lib/epi/types';

const fetchMock = vi.fn();
const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

const dash = (over: Partial<EpiDashboard> = {}): EpiDashboard => ({
  alert_days: 30,
  period: { from: '2026-09-18', to: '2026-10-18' },
  kpis: {
    epis_total: 12, stock_total: 340, stock_value: '1234.50', low_stock: 3, zero_stock: 2,
    ca_expired: 1, ca_expiring: 4, lots_expired: 5, lots_expiring: 6, pending_signatures: 7,
  },
  alerts: [{
    epi_id: 'e1', description: 'Luva nitrílica', ca_number: '12345', stock_balance: 0, min_stock: 10,
    stock_band: 'sem_estoque', ca_alert: 'a_vencer', ca_valid_until: '2026-11-01', lots_expired: 1, lots_expiring: 0,
  }],
  recent_movements: [
    { id: 'm1', type: 'entrega', quantity: 2, occurred_at: '2026-10-17T15:30:00.000Z', epi_id: 'e1', epi_description: 'Luva nitrílica', employee_name: 'Maria Souza', reason: null, reversed: true },
    { id: 'm2', type: 'devolucao', quantity: 1, occurred_at: '2026-10-16T12:00:00.000Z', epi_id: 'e1', epi_description: 'Luva nitrílica', employee_name: null, reason: null, reversed: false },
  ],
  pending: [{
    delivery_id: 'd1', delivered_at: '2026-10-10', employee_id: 'emp1', employee_name: 'João Lima', epi_id: 'e1',
    epi_description: 'Protetor auricular', quantity: 2, signature_status: 'pendente', active_request_expires_at: null,
  }],
  ...over,
});

interface Handlers { search?: (url: string) => unknown; dashboard?: (url: string) => unknown; settings?: (init: RequestInit) => unknown }
function setup(h: Handlers = {}) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    if (url.startsWith('/api/epis/dashboard')) return h.dashboard ? h.dashboard(url) : res(dash());
    if (url.startsWith('/api/epis/settings')) return h.settings ? h.settings(init) : res({ epi_alert_days: 45 });
    if (url.startsWith('/api/epis/search') && h.search) return h.search(url);
    if (url.startsWith('/api/epis/search')) return res({ items: [{ id: 'e1', description: 'Luva nitrílica', ca_number: '12345' }], total: 1, page: 1, page_size: 100 });
    if (url.startsWith('/api/employees')) return res([{ id: 'emp1', full_name: 'João Lima', cpf: '12345678901' }]);
    return res({}, 404);
  });
}
const dashCalls = () => fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/api/epis/dashboard'));

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); auth.role = 'empresa'; });
afterEach(() => vi.unstubAllGlobals());

describe('EpiDashboardView', () => {
  it('mostra os 6 indicadores com os números do servidor e os dias de aviso', async () => {
    setup();
    render(<EpiDashboardView />);
    await screen.findByText('EPIs ativos');
    const kpi = (label: string) => screen.getByText(label).closest('div') as HTMLElement;
    expect(within(kpi('EPIs ativos')).getByText('12')).toBeInTheDocument();
    expect(within(kpi('Estoque disponível')).getByText('340')).toBeInTheDocument();
    expect(within(kpi('Estoque baixo ou zerado')).getByText('5')).toBeInTheDocument();
    expect(within(kpi('Estoque baixo ou zerado')).getByText(/3 abaixo do mínimo · 2 sem estoque/)).toBeInTheDocument();
    expect(within(kpi('CA e lotes vencidos ou a vencer')).getByText('16')).toBeInTheDocument();
    expect(within(kpi('Aguardando assinatura')).getByText('7')).toBeInTheDocument();
    expect(within(kpi('Valor em estoque')).getByText('R$ 1.234,50')).toBeInTheDocument();
    expect(screen.getByText(/Avisos de vencimento: 30 dias/)).toBeInTheDocument();
  });

  it('todos os KPIs do painel usam rótulo e dica de 16px', async () => {
    setup();
    render(<EpiDashboardView />);
    await screen.findByText('EPIs ativos');
    const labels = ['EPIs ativos', 'Estoque disponível', 'Estoque baixo ou zerado', 'CA e lotes vencidos ou a vencer', 'Aguardando assinatura', 'Valor em estoque'];
    for (const l of labels) {
      const card = screen.getByText(l).closest('div') as HTMLElement;
      for (const p of Array.from(card.querySelectorAll('p'))) {
        if (p.className.includes('text-[40px]')) continue; // o número
        expect(p.className, `${l}: ${p.textContent}`).toContain('text-base');
        expect(p.className).not.toMatch(/text-sm|text-\[13px\]/);
      }
    }
  });

  it('estados: carregando (skeleton), erro com "Tentar novamente", vazio (nenhum EPI) com chamada para cadastrar', async () => {
    // carregando
    let resolve: (v: unknown) => void = () => {};
    setup({ dashboard: () => new Promise((r) => { resolve = r; }) });
    const first = render(<EpiDashboardView />);
    expect(screen.getByRole('status', { name: 'Carregando painel' })).toBeInTheDocument();
    await act(async () => { resolve(res(dash())); });
    await screen.findByText('EPIs ativos');
    first.unmount();

    // erro + tentar novamente
    let ok = false;
    setup({ dashboard: () => (ok ? res(dash()) : res({ message: 'boom' }, 500)) });
    render(<EpiDashboardView />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível concluir a operação. Tente novamente.');
    expect(alert).not.toHaveTextContent('boom');
    ok = true;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('EPIs ativos');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('vazio: nenhum EPI cadastrado mostra chamada para cadastrar', async () => {
    setup({ dashboard: () => res(dash({ kpis: { ...dash().kpis, epis_total: 0 }, alerts: [], pending: [], recent_movements: [] })) });
    render(<EpiDashboardView />);
    expect(await screen.findByText(/Nenhum EPI ativo\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cadastrar EPI' })).toHaveAttribute('href', '/empresa/epi/cadastro');
    expect(screen.queryByText('Estoque disponível')).toBeNull();
    // empresa sem EPI ativo ainda precisa ajustar os dias de aviso
    expect(screen.getByLabelText(/Avisar com quantos dias/)).toBeInTheDocument();
  });

  it('período padrão 30 dias; mudar o período e o equipamento/funcionário refaz a consulta com os parâmetros certos', async () => {
    setup();
    render(<EpiDashboardView tenantId="11111111-1111-4111-8111-111111111111" />);
    await screen.findByText('EPIs ativos');
    const today = todayDateOnly();
    const first = new URL(dashCalls()[0], 'http://x').searchParams;
    expect(first.get('from')).toBe(addDays(today, -29)); // hoje e os 29 dias anteriores = 30 dias
    expect(first.get('to')).toBe(today);
    expect(first.get('tenant_id')).toBe('11111111-1111-4111-8111-111111111111');
    expect(first.get('epi_id')).toBeNull();
    // os filtros também usam o tenant
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).startsWith('/api/employees?tenant_id=1111'))).toBe(true);
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).startsWith('/api/epis/search?tenant_id=1111'))).toBe(true);

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-08-01' } });
    await waitFor(() => expect(new URL(dashCalls().at(-1)!, 'http://x').searchParams.get('from')).toBe('2026-08-01'));
    await screen.findByRole('option', { name: /Luva nitrílica \(CA 12345\)/ });
    fireEvent.change(screen.getByLabelText('Equipamento'), { target: { value: 'e1' } });
    await waitFor(() => expect(new URL(dashCalls().at(-1)!, 'http://x').searchParams.get('epi_id')).toBe('e1'));
    fireEvent.change(screen.getByLabelText('Funcionário'), { target: { value: 'emp1' } });
    await waitFor(() => expect(new URL(dashCalls().at(-1)!, 'http://x').searchParams.get('employee_id')).toBe('emp1'));
    expect(new URL(dashCalls().at(-1)!, 'http://x').searchParams.get('from')).toBe('2026-08-01');
  });

  it('período maior que 366 dias é limitado antes de ir ao servidor; data inicial depois da final não consulta', async () => {
    setup();
    render(<EpiDashboardView />);
    await screen.findByText('EPIs ativos');
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2020-01-01' } });
    await waitFor(() => expect(dashCalls().length).toBe(2));
    const p = new URL(dashCalls().at(-1)!, 'http://x').searchParams;
    expect(p.get('from')).toBe(addDays(p.get('to') as string, -366));
    expect(screen.getByText(/O período máximo é de 366 dias/)).toBeInTheDocument();
    const before = dashCalls().length;
    fireEvent.change(screen.getByLabelText('De'), { target: { value: addDays(todayDateOnly(), 5) } });
    expect(await screen.findByText('A data inicial não pode ser depois da data final.')).toBeInTheDocument();
    expect(dashCalls().length).toBe(before);
  });

  it('descarta a resposta atrasada de uma consulta antiga', async () => {
    const pending: Array<(v: unknown) => void> = [];
    setup({ dashboard: () => new Promise((r) => { pending.push(r); }) });
    render(<EpiDashboardView />);
    await waitFor(() => expect(pending.length).toBe(1));
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-08-01' } });
    await waitFor(() => expect(pending.length).toBe(2));
    await act(async () => { pending[1](res(dash({ kpis: { ...dash().kpis, epis_total: 22 } }))); });
    await screen.findByText('22');
    await act(async () => { pending[0](res(dash({ kpis: { ...dash().kpis, epis_total: 99 } }))); });
    expect(screen.queryByText('99')).toBeNull();
    expect(screen.getByText('22')).toBeInTheDocument();
  });

  it('alertas e pendências listados; "Gerar link" chama onGerarLink(deliveryId)', async () => {
    setup();
    const onGerarLink = vi.fn();
    render(<EpiDashboardView onGerarLink={onGerarLink} />);
    await screen.findByText('Alertas');
    expect(screen.getByText('Sem estoque')).toBeInTheDocument();
    expect(screen.getByText('CA a vencer')).toBeInTheDocument();
    expect(screen.getByText('1 lote(s) vencido(s)')).toBeInTheDocument();
    expect(screen.getByText('João Lima', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
    // movimentações: tipo em português e estorno marcado
    expect(screen.getByText(/Entrega · 2 un\. · Luva nitrílica/)).toBeInTheDocument();
    expect(screen.getByText(/Devolução · 1 un\./)).toBeInTheDocument();
    expect(screen.getByText('Estornada')).toBeInTheDocument();
    expect(screen.getByText(/17\/10\/2026 12:30/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Gerar link de assinatura para João Lima/ }));
    expect(onGerarLink).toHaveBeenCalledWith('d1', 'emp1');
    expect(onGerarLink).toHaveBeenCalledTimes(1);
  });

  it('sem onGerarLink não mostra o botão "Gerar link"', async () => {
    setup();
    render(<EpiDashboardView />);
    await screen.findByText('João Lima', { selector: 'p' });
    expect(screen.queryByRole('button', { name: /Gerar link/ })).toBeNull();
  });

  it('ajuste dos dias de aviso: empresa vê o controle; valor 1..365; salvar chama PATCH e atualiza os alertas', async () => {
    let days = 30;
    setup({
      dashboard: () => res(dash({ alert_days: days })),
      settings: (init) => { days = JSON.parse(init.body as string).epi_alert_days; return res({ epi_alert_days: days }); },
    });
    render(<EpiDashboardView tenantId="22222222-2222-4222-8222-222222222222" />);
    const input = (await screen.findByLabelText(/Avisar com quantos dias/)) as HTMLInputElement;
    expect(input.value).toBe('30');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar dias de aviso' }));
    expect(await screen.findByText('Informe um número inteiro de 1 a 365 dias.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '366' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar dias de aviso' }));
    expect(screen.getByText('Informe um número inteiro de 1 a 365 dias.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')).toBe(false);

    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar dias de aviso' }));
    await screen.findByText('Dias de aviso salvos.');
    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')!;
    expect(patch[0]).toBe('/api/epis/settings?tenant_id=22222222-2222-4222-8222-222222222222');
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ epi_alert_days: 45 });
    await waitFor(() => expect(screen.getByText(/Avisos de vencimento: 45 dias/)).toBeInTheDocument());
  });

  it('ajuste dos dias de aviso: erro do servidor mostra mensagem de lista fechada; duplo clique envia uma vez', async () => {
    let calls = 0;
    setup({ settings: () => { calls += 1; return res({ message: 'detalhe interno do servidor' }, 403); } });
    render(<EpiDashboardView />);
    const input = await screen.findByLabelText(/Avisar com quantos dias/);
    fireEvent.change(input, { target: { value: '60' } });
    const btn = screen.getByRole('button', { name: 'Salvar dias de aviso' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(await screen.findByText('Você não tem permissão para esta ação.')).toBeInTheDocument();
    expect(screen.queryByText(/detalhe interno/)).toBeNull();
    expect(calls).toBe(1);
  });

  it('técnico NÃO vê o controle dos dias de aviso; prop explícita habilita', async () => {
    auth.role = 'tecnico';
    setup();
    const { unmount } = render(<EpiDashboardView tenantId="t1" />);
    await screen.findByText('EPIs ativos');
    expect(screen.queryByLabelText(/Avisar com quantos dias/)).toBeNull();
    unmount();
    render(<EpiDashboardView tenantId="t1" canEditSettings />);
    expect(await screen.findByLabelText(/Avisar com quantos dias/)).toBeInTheDocument();
  });

  it('trocar de empresa não mostra números antigos nem reaproveita filtros; salvar dias usa o valor da nova empresa', async () => {
    const A = '11111111-1111-4111-8111-111111111111';
    const B = '22222222-2222-4222-8222-222222222222';
    let saved: unknown = null;
    setup({
      dashboard: (url) => (url.includes(A)
        ? res(dash({ alert_days: 30, kpis: { ...dash().kpis, epis_total: 12 } }))
        : res(dash({ alert_days: 90, kpis: { ...dash().kpis, epis_total: 77 } }))),
      settings: (init) => { saved = JSON.parse(init.body as string); return res({ epi_alert_days: 91 }); },
    });
    const { rerender } = render(<EpiDashboardView tenantId={A} />);
    await screen.findByText('12');
    await screen.findByRole('option', { name: /Luva nitrílica/ });
    fireEvent.change(screen.getByLabelText('Equipamento'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByLabelText('Funcionário'), { target: { value: 'emp1' } });
    await waitFor(() => expect(new URL(dashCalls().at(-1)!, 'http://x').searchParams.get('epi_id')).toBe('e1'));

    rerender(<EpiDashboardView tenantId={B} />);
    expect(screen.queryByText('12')).toBeNull(); // sem números da empresa anterior enquanto carrega
    await screen.findByText('77');
    const last = new URL(dashCalls().at(-1)!, 'http://x').searchParams;
    expect(last.get('tenant_id')).toBe(B);
    expect(last.get('epi_id')).toBeNull();
    expect(last.get('employee_id')).toBeNull();
    const input = screen.getByLabelText(/Avisar com quantos dias/) as HTMLInputElement;
    expect(input.value).toBe('90'); // valor da nova empresa, não 30
    fireEvent.change(input, { target: { value: '91' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar dias de aviso' }));
    await screen.findByText('Dias de aviso salvos.');
    const patch = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')!;
    expect(patch[0]).toContain(B);
    expect(saved).toEqual({ epi_alert_days: 91 });
  });

  it('resposta em voo da empresa anterior é descartada ao trocar de empresa', async () => {
    const A = '11111111-1111-4111-8111-111111111111';
    const B = '22222222-2222-4222-8222-222222222222';
    const pendingA: Array<(v: unknown) => void> = [];
    setup({ dashboard: (url) => (url.includes(A) ? new Promise((r) => { pendingA.push(r); }) : res(dash({ kpis: { ...dash().kpis, epis_total: 77 } }))) });
    const { rerender } = render(<EpiDashboardView tenantId={A} />);
    await waitFor(() => expect(pendingA.length).toBe(1));
    rerender(<EpiDashboardView tenantId={B} />);
    await screen.findByText('77');
    await act(async () => { pendingA[0](res(dash({ kpis: { ...dash().kpis, epis_total: 12 } }))); });
    expect(screen.queryByText('12')).toBeNull();
    expect(screen.getByText('77')).toBeInTheDocument();
  });

  it('atalhos da empresa apontam para as rotas certas', async () => {
    setup();
    render(<EpiDashboardView />);
    await screen.findByText('EPIs ativos');
    expect(screen.getByRole('link', { name: 'Registrar entrega' })).toHaveAttribute('href', '/empresa/epi/movimentacao');
    expect(screen.getByRole('link', { name: 'Abrir ficha' })).toHaveAttribute('href', '/empresa/epi/fichas');
    expect(screen.getByRole('link', { name: 'Consultar estoque' })).toHaveAttribute('href', '/empresa/epi/cadastro');
  });

  it('atalhos do técnico chamam a navegação por abas, sem links', async () => {
    auth.role = 'tecnico';
    setup();
    const onNavigate = vi.fn();
    render(<EpiDashboardView tenantId="t1" onNavigate={onNavigate} />);
    await screen.findByText('EPIs ativos');
    expect(screen.queryByRole('link', { name: 'Registrar entrega' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir ficha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Consultar estoque' }));
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual(['movimentacao', 'fichas', 'cadastro']);
  });

  it('nenhum CPF na tela e nenhum storage escrito', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setup();
    const { container } = render(<EpiDashboardView />);
    await screen.findByText('EPIs ativos');
    await screen.findByRole('option', { name: 'João Lima' });
    expect(container.textContent).not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
    expect(container.textContent).not.toContain('12345678901');
    expect(container.innerHTML).not.toContain('12345678901');
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe('EpiDashboardView: ajustes finais', () => {
  it('404 do painel mostra "Empresa não encontrada ou sem acesso" e NÃO oferece tentar de novo', async () => {
    setup({ dashboard: () => res({ message: 'x' }, 404) });
    render(<EpiDashboardView tenantId="t-x" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Empresa não encontrada ou sem acesso para você.');
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('onPresencial: cada pendência tem "Registrar assinatura presencial" que chama o callback com a entrega; sem callback, sem botão', async () => {
    setup();
    const fn = vi.fn();
    const { unmount } = render(<EpiDashboardView onPresencial={fn} />);
    fireEvent.click(await screen.findByRole('button', { name: /Registrar assinatura presencial de João Lima/ }));
    expect(fn).toHaveBeenCalledWith('d1');
    unmount();
    render(<EpiDashboardView />);
    await screen.findByText('EPIs ativos');
    expect(screen.queryByRole('button', { name: /assinatura presencial/ })).toBeNull();
  });

  it('seletor de EPI carrega todas as páginas (total 250 = 3 páginas de 100) sem aviso', async () => {
    const mk = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => ({ id: `e${a + i}`, description: `EPI ${a + i}`, ca_number: '1' }));
    setup({ search: (u) => {
      const p = Number(new URL(u, 'http://x').searchParams.get('page'));
      return res({ items: mk((p - 1) * 100, Math.min(p * 100, 250)), total: 250, page: p, page_size: 100 });
    } });
    render(<EpiDashboardView />);
    await waitFor(() => expect(document.querySelectorAll('#epi-filter-epi option')).toHaveLength(251));
    const pages = fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/api/epis/search')).map((u) => new URL(u, 'http://x').searchParams.get('page'));
    expect(pages).toEqual(['1', '2', '3']);
    expect(screen.queryByText(/Mostrando os primeiros 1000/)).toBeNull();
  });

  it('teto de 1000 EPIs: carrega 10 páginas, corta em 1000 e avisa', async () => {
    setup({ search: (u) => {
      const p = Number(new URL(u, 'http://x').searchParams.get('page'));
      return res({ items: Array.from({ length: 100 }, (_, i) => ({ id: `e${p}-${i}`, description: `EPI ${p}-${i}`, ca_number: '1' })), total: 1500, page: p, page_size: 100 });
    } });
    render(<EpiDashboardView />);
    expect(await screen.findByText('Mostrando os primeiros 1000 EPIs; refine pela busca.')).toBeInTheDocument();
    expect(document.querySelectorAll('#epi-filter-epi option')).toHaveLength(1001);
    expect(fetchMock.mock.calls.filter((c) => (c[0] as string).startsWith('/api/epis/search'))).toHaveLength(10);
  });
});
