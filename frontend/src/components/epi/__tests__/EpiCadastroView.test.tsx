import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

const auth = vi.hoisted(() => ({ role: 'empresa' as string }));
vi.mock('@/lib/auth', () => ({ getToken: () => 'tok', getUser: () => ({ id: 'u1', role: auth.role, tenantId: 't1' }) }));

import { EpiCadastroView } from '../EpiCadastroView';
import type { EpiRow } from '@/lib/epi/types';

const fetchMock = vi.fn();
const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

const row = (over: Partial<EpiRow> = {}): EpiRow => ({
  id: 'e1', tenant_id: 't1', epi_catalog_item_id: 'c1', ca_number: '12345', ca_valid_until: '2026-12-31',
  created_by_user_id: 'u1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  category: 'B', code: 'B1', equipment_group: 'Mãos', description: 'Luva nitrílica', manufacturer: 'Volk', model: 'N200', unit: 'par',
  min_stock: 10, max_stock: 100, unit_cost: '12.50', controls_lot: false, replacement_days: null, status: 'ativo', stock_balance: 4,
  stock_band: 'abaixo', ca_alert: 'a_vencer', lots_expired: 0, lots_expiring: 0, stock_value: '50.00', ...over,
});
const catalog = [
  { id: 'c1', category: 'B', code: 'B1', equipment_group: 'Mãos', description: 'Luva de proteção', risk_protected: 'Riscos químicos', related_nr: 'NR-06', legal_basis: 'x' },
  { id: 'c2', category: 'A', code: 'A1', equipment_group: 'Cabeça', description: 'Capacete', risk_protected: 'Impacto', related_nr: 'NR-06', legal_basis: 'x' },
];

type Handler = (url: string, init: RequestInit) => unknown;
let search: Handler;
let other: Handler;
function setup(items: EpiRow[] = [row()], opts: { search?: Handler; other?: Handler } = {}) {
  search = opts.search ?? (() => res({ items, total: items.length, page: 1, page_size: 25 }));
  other = opts.other ?? (() => res({}, 404));
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    if (url.startsWith('/api/epis/search')) return search(url, init);
    if (url === '/api/epi-catalog-items') return res(catalog);
    return other(url, init);
  });
}
const searchCalls = () => fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/api/epis/search'));
const params = (u: string) => new URL(u, 'http://x').searchParams;
const callsWith = (method: string) => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === method);

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); auth.role = 'empresa'; });
afterEach(() => vi.unstubAllGlobals());

describe('EpiCadastroView: lista', () => {
  it('lista com busca, filtros (situação, categoria, faixa, alerta de CA) e paginação refazendo a consulta com os parâmetros certos', async () => {
    setup([row()], { search: () => res({ items: [row()], total: 60, page: 1, page_size: 25 }) });
    render(<EpiCadastroView tenantId="11111111-1111-4111-8111-111111111111" />);
    await screen.findByText('Luva nitrílica');
    let p = params(searchCalls()[0]);
    expect(p.get('tenant_id')).toBe('11111111-1111-4111-8111-111111111111');
    expect(p.get('page')).toBe('1');
    expect(p.get('page_size')).toBe('25');
    expect(p.get('q')).toBeNull();

    fireEvent.change(screen.getByLabelText(/Buscar por descrição/), { target: { value: ' luva ' } });
    expect(searchCalls().length).toBe(1); // só busca ao enviar
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(params(searchCalls().at(-1)!).get('q')).toBe('luva'));

    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    await waitFor(() => expect(params(searchCalls().at(-1)!).get('page')).toBe('2'));

    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'inativo' } });
    await waitFor(() => expect(params(searchCalls().at(-1)!).get('status')).toBe('inativo'));
    expect(params(searchCalls().at(-1)!).get('page')).toBe('1'); // filtro volta à página 1
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'C' } });
    fireEvent.change(screen.getByLabelText('Faixa de estoque'), { target: { value: 'abaixo' } });
    fireEvent.change(screen.getByLabelText('Situação do CA'), { target: { value: 'vencido' } });
    await waitFor(() => expect(params(searchCalls().at(-1)!).get('ca_alert')).toBe('vencido'));
    p = params(searchCalls().at(-1)!);
    expect([p.get('q'), p.get('status'), p.get('category'), p.get('stock_band'), p.get('ca_alert'), p.get('page')])
      .toEqual(['luva', 'inativo', 'C', 'abaixo', 'vencido', '1']);
  });

  it('cada linha mostra descrição, CA, fabricante/modelo, saldo, StockBadge e CaBadge; custo e valor em reais', async () => {
    setup();
    render(<EpiCadastroView />);
    const item = (await screen.findByText('Luva nitrílica')).closest('li') as HTMLElement;
    expect(within(item).getByText(/CA 12345 · validade 31\/12\/2026 · Volk \/ N200/)).toBeInTheDocument();
    expect(within(item).getByText('4 par')).toBeInTheDocument();
    expect(within(item).getByText('Abaixo do mínimo')).toBeInTheDocument();
    expect(within(item).getByText('CA a vencer')).toBeInTheDocument();
    expect(within(item).getByText('R$ 12,50')).toBeInTheDocument();
    expect(within(item).getByText('R$ 50,00')).toBeInTheDocument();
  });

  it('estados: carregando, erro com "Tentar novamente", vazio', async () => {
    let resolve: (v: unknown) => void = () => {};
    setup([], { search: () => new Promise((r) => { resolve = r; }) });
    const a = render(<EpiCadastroView />);
    expect(screen.getByRole('status', { name: 'Carregando EPIs' })).toBeInTheDocument();
    await act(async () => { resolve(res({ items: [], total: 0, page: 1, page_size: 25 })); });
    expect(await screen.findByText(/Nenhum EPI cadastrado ainda/)).toBeInTheDocument();
    a.unmount();

    let ok = false;
    setup([row()], { search: () => (ok ? res({ items: [row()], total: 1, page: 1, page_size: 25 }) : res({ message: 'x' }, 503)) });
    render(<EpiCadastroView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('O serviço está indisponível agora.');
    ok = true;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('Luva nitrílica');
  });

  it('descarta resposta atrasada de uma consulta antiga', async () => {
    const pending: Array<(v: unknown) => void> = [];
    setup([], { search: () => new Promise((r) => { pending.push(r); }) });
    render(<EpiCadastroView />);
    await waitFor(() => expect(pending.length).toBe(1));
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'C' } });
    await waitFor(() => expect(pending.length).toBe(2));
    await act(async () => { pending[1](res({ items: [row({ description: 'Nova' })], total: 1, page: 1, page_size: 25 })); });
    await screen.findByText('Nova');
    await act(async () => { pending[0](res({ items: [row({ id: 'z', description: 'Antiga' })], total: 1, page: 1, page_size: 25 })); });
    expect(screen.queryByText('Antiga')).toBeNull();
  });
});

describe('EpiCadastroView: criar', () => {
  async function openCreate() {
    render(<EpiCadastroView tenantId="11111111-1111-4111-8111-111111111111" />);
    await screen.findByText('Luva nitrílica');
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar EPI' }));
    return screen.getByRole('dialog', { name: 'Cadastrar EPI' });
  }

  it('criar EPI: campos, consulta ao CAEPI opcional, envio e recarga da lista', async () => {
    let created: Record<string, unknown> | null = null;
    setup([row()], {
      other: (url, init) => {
        if (url.startsWith('/api/caepi/search')) return res([{ numero_ca: '999', data_validade: '2027-05-20', situacao: 'VÁLIDO', razao_social: 'Fabricante SA' }]);
        if (url === '/api/epis' && init.method === 'POST') { created = JSON.parse(init.body as string); return res(row(), 201); }
        return res({}, 404);
      },
    });
    const d = await openCreate();
    expect(within(d).getByLabelText(/Item do catálogo/)).toHaveFocus();
    fireEvent.change(within(d).getByLabelText(/Item do catálogo/), { target: { value: 'c1' } });
    expect(within(d).getByText('Protege contra: Riscos químicos')).toBeInTheDocument();
    fireEvent.change(within(d).getByLabelText(/Número do CA/), { target: { value: '999' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Consultar CAEPI' }));
    await within(d).findByText(/CAEPI: CA 999, situação VÁLIDO, validade 20\/05\/2027/);
    expect((within(d).getByLabelText('Validade do CA') as HTMLInputElement).value).toBe('2027-05-20');
    expect((within(d).getByLabelText('Fabricante') as HTMLInputElement).value).toBe('Fabricante SA');
    fireEvent.change(within(d).getByLabelText('Fabricante'), { target: { value: 'Volk' } });
    fireEvent.change(within(d).getByLabelText('Modelo'), { target: { value: 'N200' } });
    fireEvent.change(within(d).getByLabelText('Estoque mínimo'), { target: { value: '10' } });
    fireEvent.change(within(d).getByLabelText('Estoque máximo'), { target: { value: '100' } });
    fireEvent.change(within(d).getByLabelText('Custo unitário (R$)'), { target: { value: '12,5' } });
    fireEvent.click(within(d).getByLabelText(/Controla lote/));
    const before = searchCalls().length;
    fireEvent.submit(within(d).getByRole('button', { name: 'Cadastrar EPI' }).closest('form') as HTMLFormElement); // Enter envia o formulário
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(created).toEqual({
      epi_catalog_item_id: 'c1', ca_number: '999', ca_valid_until: '2027-05-20', manufacturer: 'Volk', model: 'N200', unit: 'un',
      min_stock: 10, max_stock: 100, unit_cost: 12.5, controls_lot: true, tenant_id: '11111111-1111-4111-8111-111111111111',
    });
    await waitFor(() => expect(searchCalls().length).toBe(before + 1));
    expect(screen.getByText('EPI cadastrado.')).toBeInTheDocument();
  });

  it('erros 409 (duplicidade) e 400 viram mensagem de lista fechada, com foco no erro', async () => {
    let status = 409;
    setup([row()], { other: (url, init) => (url === '/api/epis' && init.method === 'POST' ? res({ message: status === 409 ? 'Registro duplicado' : 'ca_number must be shorter (SQL x)' }, status) : res({}, 404)) });
    const d = await openCreate();
    fireEvent.change(within(d).getByLabelText(/Item do catálogo/), { target: { value: 'c2' } });
    fireEvent.change(within(d).getByLabelText(/Número do CA/), { target: { value: '55' } });
    const form = within(d).getByRole('button', { name: 'Cadastrar EPI' }).closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    const alert = await within(d).findByRole('alert');
    expect(alert).toHaveTextContent('Já existe um EPI cadastrado com estes dados.');
    expect(alert).not.toHaveTextContent('Registro duplicado');
    expect(alert).toHaveFocus();
    status = 400;
    fireEvent.submit(form);
    await waitFor(() => expect(within(d).getByRole('alert')).toHaveTextContent('Verifique os dados informados e tente de novo.'));
    expect(d).not.toHaveTextContent('SQL');
  });

  it('validação local: sem catálogo/CA ou com máximo menor que o mínimo não envia', async () => {
    setup();
    const d = await openCreate();
    const form = within(d).getByRole('button', { name: 'Cadastrar EPI' }).closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(within(d).getByRole('alert')).toHaveTextContent('Escolha o item do catálogo.');
    fireEvent.change(within(d).getByLabelText(/Item do catálogo/), { target: { value: 'c1' } });
    fireEvent.submit(form);
    expect(within(d).getByRole('alert')).toHaveTextContent('Informe o número do CA.');
    fireEvent.change(within(d).getByLabelText(/Número do CA/), { target: { value: '1' } });
    fireEvent.change(within(d).getByLabelText('Estoque mínimo'), { target: { value: '10' } });
    fireEvent.change(within(d).getByLabelText('Estoque máximo'), { target: { value: '5' } });
    fireEvent.submit(form);
    expect(within(d).getByRole('alert')).toHaveTextContent('O estoque máximo não pode ser menor que o mínimo.');
    expect(callsWith('POST')).toHaveLength(0);
  });

  it('botão desabilitado durante o envio: duplo clique envia uma vez', async () => {
    let resolve: (v: unknown) => void = () => {};
    setup([row()], { other: (url, init) => (url === '/api/epis' && init.method === 'POST' ? new Promise((r) => { resolve = r; }) : res({}, 404)) });
    const d = await openCreate();
    fireEvent.change(within(d).getByLabelText(/Item do catálogo/), { target: { value: 'c1' } });
    fireEvent.change(within(d).getByLabelText(/Número do CA/), { target: { value: '7' } });
    const btn = within(d).getByRole('button', { name: 'Cadastrar EPI' });
    const form = btn.closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(await within(d).findByRole('button', { name: 'Salvando...' })).toHaveAttribute('aria-disabled', 'true');
    expect(callsWith('POST')).toHaveLength(1);
    await act(async () => { resolve(res(row(), 201)); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('formulário acessível: todo campo tem rótulo; Esc fecha; foco volta ao botão de origem', async () => {
    setup();
    render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    const opener = screen.getByRole('button', { name: 'Cadastrar EPI' });
    opener.focus();
    fireEvent.click(opener);
    const d = screen.getByRole('dialog', { name: 'Cadastrar EPI' });
    expect(d).toHaveAttribute('aria-modal', 'true');
    for (const el of d.querySelectorAll('input, select, textarea')) expect(el).toHaveAccessibleName();
    fireEvent.keyDown(d, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe('EpiCadastroView: ajustes de revisão', () => {
  it('abertura e ajuste recusam quantidade acima de 100.000', async () => {
    setup();
    render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    fireEvent.click(screen.getByRole('button', { name: 'Abertura de estoque de Luva nitrílica' }));
    let d = screen.getByRole('dialog');
    fireEvent.change(within(d).getByLabelText('Quantidade inicial'), { target: { value: '100001' } });
    fireEvent.submit(within(d).getByRole('button', { name: 'Registrar abertura' }).closest('form') as HTMLFormElement);
    expect(within(d).getByRole('alert')).toHaveTextContent('de 1 a 100.000');
    fireEvent.click(within(d).getByRole('button', { name: 'Cancelar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ajustar estoque de Luva nitrílica' }));
    d = screen.getByRole('dialog');
    fireEvent.change(within(d).getByLabelText('Quantidade'), { target: { value: '100001' } });
    fireEvent.change(within(d).getByLabelText('Motivo'), { target: { value: 'Contagem física' } });
    fireEvent.submit(within(d).getByRole('button', { name: 'Registrar ajuste' }).closest('form') as HTMLFormElement);
    expect(within(d).getByRole('alert')).toHaveTextContent('de 1 a 100.000');
    expect(callsWith('POST')).toHaveLength(0);
  });

  it('falha ao carregar o catálogo mostra mensagem e permite tentar de novo', async () => {
    let ok = false;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/epis/search')) return res({ items: [row()], total: 1, page: 1, page_size: 25 });
      if (url === '/api/epi-catalog-items') return ok ? res(catalog) : res({ message: 'x' }, 503);
      return res({}, 404);
    });
    render(<EpiCadastroView />);
    expect(await screen.findByText(/O catálogo de equipamentos não foi carregado/)).toBeInTheDocument();
    ok = true;
    fireEvent.click(screen.getAllByRole('button', { name: 'Tentar novamente' })[0]);
    await waitFor(() => expect(screen.queryByText(/O catálogo de equipamentos não foi carregado/)).toBeNull());
  });

  it('ao inativar o último item da página 2, volta para a página 1', async () => {
    let inactivated = false;
    setup([], {
      search: (url) => {
        const page = Number(params(url).get('page'));
        if (page === 1) return res({ items: [row()], total: 26, page: 1, page_size: 25 });
        return inactivated ? res({ items: [], total: 25, page: 2, page_size: 25 }) : res({ items: [row({ id: 'e9', description: 'Capacete' })], total: 26, page: 2, page_size: 25 });
      },
      other: (url, init) => { if (init.method === 'PATCH') { inactivated = true; return res({}); } return res({}, 404); },
    });
    render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    await screen.findByText('Capacete');
    fireEvent.click(screen.getByRole('button', { name: 'Inativar Capacete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inativar EPI' }));
    await screen.findByText('Luva nitrílica');
    expect(params(searchCalls().at(-1)!).get('page')).toBe('1');
    expect(screen.queryByText(/Nenhum EPI/)).toBeNull();
  });

  it('volta de página com total inconsistente não fica carregando para sempre', async () => {
    // página 2 vazia mas total diz que existem 50 itens (2 páginas): deve cair para a página 1, não repetir a 2
    setup([], {
      search: (url) => (params(url).get('page') === '1'
        ? res({ items: [row()], total: 50, page: 1, page_size: 25 })
        : res({ items: [], total: 50, page: 2, page_size: 25 })),
    });
    render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    await waitFor(() => expect(searchCalls().length).toBeGreaterThanOrEqual(3));
    await screen.findByText('Luva nitrílica');
    expect(screen.queryByRole('status', { name: 'Carregando EPIs' })).toBeNull();
    expect(params(searchCalls().at(-1)!).get('page')).toBe('1');
  });

  it('trocar de empresa zera filtros, página e lista', async () => {
    const A = '11111111-1111-4111-8111-111111111111';
    const B = '22222222-2222-4222-8222-222222222222';
    setup([], { search: (url) => (url.includes(A) ? res({ items: [row({ description: 'Da empresa A' })], total: 60, page: 1, page_size: 25 }) : res({ items: [row({ description: 'Da empresa B' })], total: 1, page: 1, page_size: 25 })) });
    const { rerender } = render(<EpiCadastroView tenantId={A} />);
    await screen.findByText('Da empresa A');
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'C' } });
    await waitFor(() => expect(params(searchCalls().at(-1)!).get('category')).toBe('C'));
    rerender(<EpiCadastroView tenantId={B} />);
    expect(screen.queryByText('Da empresa A')).toBeNull();
    await screen.findByText('Da empresa B');
    const p = params(searchCalls().at(-1)!);
    expect([p.get('tenant_id'), p.get('category'), p.get('page')]).toEqual([B, null, '1']);
    expect((screen.getByLabelText('Categoria') as HTMLSelectElement).value).toBe('');
  });
});

describe('EpiCadastroView: editar, inativar, lotes', () => {
  it('editar envia PATCH só com o que mudou (campo limpo vira null)', async () => {
    let body: Record<string, unknown> | null = null;
    setup([row()], { other: (url, init) => { if (url === '/api/epis/e1' && init.method === 'PATCH') { body = JSON.parse(init.body as string); return res(row()); } return res({}, 404); } });
    render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    fireEvent.click(screen.getByRole('button', { name: 'Editar Luva nitrílica' }));
    const d = screen.getByRole('dialog', { name: 'Editar EPI: Luva nitrílica' });
    expect(within(d).queryByLabelText(/Item do catálogo/)).toBeNull();
    fireEvent.change(within(d).getByLabelText('Modelo'), { target: { value: '' } });
    fireEvent.change(within(d).getByLabelText('Estoque mínimo'), { target: { value: '20' } });
    fireEvent.submit(within(d).getByRole('button', { name: 'Salvar alterações' }).closest('form') as HTMLFormElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(body).toEqual({ model: null, min_stock: 20 });
    expect(screen.getByText('EPI atualizado.')).toBeInTheDocument();
  });

  it('controls_lot não editável com movimentação: mostra a mensagem do 409', async () => {
    setup([row()], { other: (url, init) => (url === '/api/epis/e1' && init.method === 'PATCH' ? res({ message: 'Não é possível alterar o controle de lote com movimentações registradas' }, 409) : res({}, 404)) });
    render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    fireEvent.click(screen.getByRole('button', { name: 'Editar Luva nitrílica' }));
    const d = screen.getByRole('dialog');
    fireEvent.click(within(d).getByLabelText(/Controla lote/));
    fireEvent.submit(within(d).getByRole('button', { name: 'Salvar alterações' }).closest('form') as HTMLFormElement);
    expect(await within(d).findByRole('alert')).toHaveTextContent('O controle de lote não pode ser alterado: este EPI já tem movimentação.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('inativar pede confirmação, envia PATCH status inativo (nunca DELETE) e recarrega', async () => {
    let patched: unknown = null;
    setup([row()], { other: (url, init) => { if (url === '/api/epis/e1' && init.method === 'PATCH') { patched = JSON.parse(init.body as string); return res(row({ status: 'inativo' })); } return res({}, 404); } });
    render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    const before = searchCalls().length;
    fireEvent.click(screen.getByRole('button', { name: 'Inativar Luva nitrílica' }));
    const d = screen.getByRole('dialog', { name: 'Inativar Luva nitrílica?' });
    expect(d).toHaveAccessibleDescription(/histórico e o saldo permanecem/);
    expect(callsWith('PATCH')).toHaveLength(0); // nada antes de confirmar
    fireEvent.click(within(d).getByRole('button', { name: 'Inativar EPI' }));
    await screen.findByText('EPI inativado.');
    expect(patched).toEqual({ status: 'inativo' });
    expect(callsWith('DELETE')).toHaveLength(0);
    await waitFor(() => expect(searchCalls().length).toBe(before + 1));
  });

  it('cancelar a confirmação não altera nada; erro na inativação mostra mensagem fechada', async () => {
    setup([row()], { other: (url, init) => (init.method === 'PATCH' ? res({ message: 'qualquer' }, 403) : res({}, 404)) });
    render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    fireEvent.click(screen.getByRole('button', { name: 'Inativar Luva nitrílica' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(callsWith('PATCH')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Inativar Luva nitrílica' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inativar EPI' }));
    expect(await screen.findByText('Você não tem permissão para esta ação.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('EPI inativo mostra "Reativar", que envia PATCH status ativo', async () => {
    let patched: unknown = null;
    setup([row({ status: 'inativo' })], { other: (url, init) => { if (init.method === 'PATCH') { patched = JSON.parse(init.body as string); return res(row()); } return res({}, 404); } });
    render(<EpiCadastroView />);
    await screen.findByText('Inativo');
    expect(screen.queryByRole('button', { name: /^Inativar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Abertura de estoque/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reativar Luva nitrílica' }));
    await screen.findByText('EPI reativado.');
    expect(patched).toEqual({ status: 'ativo' });
  });

  it('ver lotes de um EPI com validade e saldo (só para quem controla lote)', async () => {
    setup([row({ controls_lot: true }), row({ id: 'e2', description: 'Capacete', controls_lot: false })], {
      other: (url) => (url === '/api/epis/e1/lots' ? res([{ id: 'l1', tenant_id: 't1', tenant_epi_id: 'e1', lot_code: 'L-77', valid_until: '2026-11-30', balance: 8, created_at: '2026-01-01T00:00:00Z' }]) : res({}, 404)),
    });
    render(<EpiCadastroView />);
    await screen.findByText('Capacete');
    expect(screen.getAllByRole('button', { name: /^Ver lotes/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ver lotes de Luva nitrílica' }));
    const d = screen.getByRole('dialog', { name: 'Lotes de Luva nitrílica' });
    expect(await within(d).findByText('Lote L-77')).toBeInTheDocument();
    expect(within(d).getByText('Validade 30/11/2026 · saldo 8')).toBeInTheDocument();
  });
});

describe('EpiCadastroView: abertura de estoque e ajuste', () => {
  it('empresa vê abertura e ajuste; técnico não vê', async () => {
    setup();
    const a = render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    expect(screen.getByRole('button', { name: 'Abertura de estoque de Luva nitrílica' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajustar estoque de Luva nitrílica' })).toBeInTheDocument();
    a.unmount();

    auth.role = 'tecnico';
    setup();
    render(<EpiCadastroView tenantId="t1" />);
    await screen.findByText('Luva nitrílica');
    expect(screen.queryByRole('button', { name: /Abertura de estoque/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ajustar estoque/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Editar Luva nitrílica' })).toBeInTheDocument(); // cadastro continua disponível
  });

  it('abertura envia type abertura com chave de idempotência e lote quando controla lote', async () => {
    let body: Record<string, unknown> | null = null;
    setup([row({ controls_lot: true })], { other: (url, init) => { if (url === '/api/epis/e1/movements') { body = JSON.parse(init.body as string); return res({}, 201); } return res({}, 404); } });
    render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    fireEvent.click(screen.getByRole('button', { name: 'Abertura de estoque de Luva nitrílica' }));
    const d = screen.getByRole('dialog');
    const form = within(d).getByRole('button', { name: 'Registrar abertura' }).closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(within(d).getByRole('alert')).toHaveTextContent('Informe a quantidade inicial');
    fireEvent.change(within(d).getByLabelText('Quantidade inicial'), { target: { value: '30' } });
    fireEvent.submit(form);
    expect(within(d).getByRole('alert')).toHaveTextContent('Informe o código do lote.');
    fireEvent.change(within(d).getByLabelText('Código do lote'), { target: { value: 'L1' } });
    fireEvent.change(within(d).getByLabelText('Validade do lote'), { target: { value: '2027-01-31' } });
    fireEvent.submit(form);
    await screen.findByText('Abertura de estoque registrada.');
    expect(body).toMatchObject({ type: 'abertura', quantity: 30, lot_code: 'L1', lot_valid_until: '2027-01-31' });
    expect((body as unknown as { idempotency_key: string }).idempotency_key.length).toBeGreaterThanOrEqual(8);
  });

  it('abertura repetida (409) mostra a mensagem de lista fechada', async () => {
    setup([row()], { other: (url) => (url === '/api/epis/e1/movements' ? res({ message: 'Já existe movimentação para este EPI; use entrada ou ajuste' }, 409) : res({}, 404)) });
    render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    fireEvent.click(screen.getByRole('button', { name: 'Abertura de estoque de Luva nitrílica' }));
    const d = screen.getByRole('dialog');
    fireEvent.change(within(d).getByLabelText('Quantidade inicial'), { target: { value: '5' } });
    fireEvent.submit(within(d).getByRole('button', { name: 'Registrar abertura' }).closest('form') as HTMLFormElement);
    expect(await within(d).findByRole('alert')).toHaveTextContent('Este EPI já tem movimentação: use Entrada ou Ajuste.');
  });

  it('ajuste exige quantidade e motivo, envia a direção e reaproveita a chave só se nada mudou', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let fail = true;
    setup([row()], {
      other: (url, init) => {
        if (url === '/api/epis/e1/adjustments') { bodies.push(JSON.parse(init.body as string)); return fail ? res({ message: 'Estoque insuficiente (saldo 4)' }, 409) : res({}, 201); }
        return res({}, 404);
      },
    });
    render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    fireEvent.click(screen.getByRole('button', { name: 'Ajustar estoque de Luva nitrílica' }));
    const d = screen.getByRole('dialog');
    const form = within(d).getByRole('button', { name: 'Registrar ajuste' }).closest('form') as HTMLFormElement;
    fireEvent.change(within(d).getByLabelText('Quantidade'), { target: { value: '2' } });
    fireEvent.submit(form);
    expect(within(d).getByRole('alert')).toHaveTextContent('Explique o motivo do ajuste');
    fireEvent.change(within(d).getByLabelText('Motivo'), { target: { value: 'Contagem física' } });
    fireEvent.submit(form);
    expect(await within(d).findByRole('alert')).toHaveTextContent('Estoque insuficiente para esta operação.');
    fail = false;
    fireEvent.submit(form); // reenvio sem mudar nada: mesma chave
    await screen.findByText('Ajuste de estoque registrado.');
    expect(bodies).toHaveLength(2);
    expect(bodies[0].idempotency_key).toBe(bodies[1].idempotency_key);
    expect(bodies[1]).toMatchObject({ direction: 'menos', quantity: 2, reason: 'Contagem física' });
  });

  it('ajuste em EPI com lote exige escolher o lote e envia lot_id', async () => {
    let body: Record<string, unknown> | null = null;
    setup([row({ controls_lot: true })], {
      other: (url, init) => {
        if (url === '/api/epis/e1/lots') return res([{ id: 'l1', tenant_id: 't1', tenant_epi_id: 'e1', lot_code: 'L-1', valid_until: null, balance: 3, created_at: '2026-01-01T00:00:00Z' }]);
        if (url === '/api/epis/e1/adjustments') { body = JSON.parse(init.body as string); return res({}, 201); }
        return res({}, 404);
      },
    });
    render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    fireEvent.click(screen.getByRole('button', { name: 'Ajustar estoque de Luva nitrílica' }));
    const d = screen.getByRole('dialog');
    await within(d).findByRole('option', { name: 'Lote L-1 (saldo 3)' });
    fireEvent.click(within(d).getByLabelText('Acrescentar ao estoque'));
    fireEvent.change(within(d).getByLabelText('Quantidade'), { target: { value: '1' } });
    fireEvent.change(within(d).getByLabelText('Motivo'), { target: { value: 'Sobra na contagem' } });
    const form = within(d).getByRole('button', { name: 'Registrar ajuste' }).closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(within(d).getByRole('alert')).toHaveTextContent('Escolha o lote a ajustar.');
    fireEvent.change(within(d).getByLabelText('Lote'), { target: { value: 'l1' } });
    fireEvent.submit(form);
    await screen.findByText('Ajuste de estoque registrado.');
    expect(body).toMatchObject({ direction: 'mais', quantity: 1, lot_id: 'l1' });
  });
});

describe('EpiCadastroView: privacidade', () => {
  it('nenhum storage escrito e nenhum CPF', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setup();
    const { container } = render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    expect(container.textContent).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe('EpiCadastroView: busca no celular (M9)', () => {
  it('a busca tem rótulo acessível e placeholder curto', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [], total: 0, page: 1, page_size: 20 }), text: async () => '{"items":[],"total":0,"page":1,"page_size":20}' });
    render(<EpiCadastroView />);
    const input = await screen.findByLabelText(/Buscar por descrição/);
    expect((input as HTMLInputElement).placeholder.length).toBeLessThanOrEqual(30);
  });
});

describe('EpiCadastroView: ocupado e foco (minors)', () => {
  it('Reativar fica aria-disabled e mostra "Reativando..." durante a requisição; o segundo clique não envia outra', async () => {
    let release!: () => void;
    setup([row({ status: 'inativo' })], { other: (url, init) => (init.method === 'PATCH' ? new Promise((r) => { release = () => r(res(row())); }) : res({}, 404)) });
    render(<EpiCadastroView />);
    await screen.findByText('Inativo');
    const btn = screen.getByRole('button', { name: 'Reativar Luva nitrílica' });
    expect(btn).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-disabled', 'true'));
    expect(btn).toHaveTextContent('Reativando...');
    fireEvent.click(btn);
    expect(callsWith('PATCH')).toHaveLength(1);
    await act(async () => { release(); });
    await screen.findByText('EPI reativado.');
  });

  it('a mesma mensagem de erro repetida leva o foco ao aviso de novo', async () => {
    setup();
    render(<EpiCadastroView />);
    await screen.findByText('Luva nitrílica');
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar EPI' }));
    const d = screen.getByRole('dialog', { name: 'Cadastrar EPI' });
    const form = within(d).getByRole('button', { name: 'Cadastrar EPI' }).closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    const alert = within(d).getByRole('alert');
    expect(alert).toHaveTextContent('Escolha o item do catálogo.');
    expect(alert).toHaveFocus();
    within(d).getByLabelText(/Número do CA/).focus();
    expect(alert).not.toHaveFocus();
    fireEvent.submit(form);
    expect(within(d).getByRole('alert')).toHaveTextContent('Escolha o item do catálogo.');
    expect(within(d).getByRole('alert')).toHaveFocus();
  });
});
