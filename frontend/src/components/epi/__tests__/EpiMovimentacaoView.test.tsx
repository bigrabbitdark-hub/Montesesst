import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const auth = vi.hoisted(() => ({ role: 'empresa' as string }));
vi.mock('@/lib/auth', () => ({ getToken: () => 'tok', getUser: () => ({ id: 'u1', role: auth.role, tenantId: 't1' }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') } }));

import { EpiMovimentacaoView } from '../EpiMovimentacaoView';
import type { EmployeeLite, EpiLot, EpiRow, Movement } from '@/lib/epi/types';

const fetchMock = vi.fn();
const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

const epi = (over: Partial<EpiRow> = {}): EpiRow => ({
  id: 'e1', tenant_id: 't1', epi_catalog_item_id: 'c1', ca_number: '12345', ca_valid_until: '2027-12-31',
  created_by_user_id: 'u1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  category: 'B', code: 'B1', equipment_group: 'Mãos', description: 'Luva nitrílica', manufacturer: null, model: null, unit: 'par',
  min_stock: 10, max_stock: 100, unit_cost: '12.50', controls_lot: false, replacement_days: null, status: 'ativo', stock_balance: 40,
  stock_band: 'otimo', ca_alert: 'ok', lots_expired: 0, lots_expiring: 0, stock_value: '500.00', ...over,
});
const emp: EmployeeLite[] = [
  { id: 'emp1', full_name: 'João Lima', registration_number: '001', department: null, position: null, status: 'ativo' },
  { id: 'emp2', full_name: 'Maria Souza', registration_number: null, department: null, position: null, status: 'ativo' },
];
const mov = (over: Partial<Movement> = {}): Movement => ({
  id: 'm1', tenant_id: 't1', tenant_epi_id: 'e1', type: 'entrega', direction: -1, quantity: 2, balance_after: 38, employee_id: 'emp1',
  supplier: null, lot_id: null, reason: null, occurred_at: '2026-10-17T15:00:00Z', delivery_id: 'd1', reverses_movement_id: null,
  idempotency_key: 'k-aaaaaaaa', created_by_user_id: 'u1', created_at: '2026-10-17T15:00:00Z', ...over,
});
const lot: EpiLot = { id: 'l1', tenant_id: 't1', tenant_epi_id: 'e1', lot_code: 'L-77', valid_until: '2027-01-10', balance: 12, created_at: '2026-01-01T00:00:00Z' };

type H = (url: string, init: RequestInit) => unknown;
let epis: EpiRow[];
let history: H;
let post: H;
let extra: H;
function setup(opts: { epis?: EpiRow[]; history?: H; post?: H; extra?: H; lots?: EpiLot[] } = {}) {
  epis = opts.epis ?? [epi()];
  history = opts.history ?? (() => res({ items: [mov()], total: 1, page: 1, page_size: 20 }));
  post = opts.post ?? (() => res(mov({ id: 'new1', delivery_id: 'dnew' }), 201));
  extra = opts.extra ?? (() => res({}, 404));
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (method === 'GET' && url.startsWith('/api/epis/search')) return res({ items: epis, total: epis.length, page: 1, page_size: 100 });
    if (method === 'GET' && url.startsWith('/api/employees')) return res(emp);
    if (method === 'GET' && url.startsWith('/api/epis/movements')) return history(url, init);
    if (method === 'GET' && /^\/api\/epis\/[^/]+\/lots/.test(url)) return res(opts.lots ?? [lot]);
    if (method === 'POST' && /\/movements$|\/adjustments$|\/reversal$/.test(url)) return post(url, init);
    return extra(url, init);
  });
}
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const change = (id: string, value: string) => fireEvent.change($(id), { target: { value } });
const writes = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
const bodyOf = (c: unknown[]) => JSON.parse((c[1] as RequestInit).body as string);
const params = (u: string) => new URL(u, 'http://x').searchParams;
const historyCalls = () => fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.startsWith('/api/epis/movements'));

async function ready() {
  await waitFor(() => expect($('mov-epi').querySelectorAll('option').length).toBeGreaterThan(1));
  await waitFor(() => expect($('h-emp').querySelectorAll('option').length).toBeGreaterThan(1));
}
const submit = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); auth.role = 'empresa'; });
afterEach(() => vi.unstubAllGlobals());

describe('EpiMovimentacaoView: histórico', () => {
  it('lista com tipos em português, nomes, sinal e saldo; estornadas marcadas; filtros e paginação refazem a consulta', async () => {
    setup({
      history: () => res({
        items: [
          mov({ id: 'm2', type: 'estorno', direction: 1, quantity: 2, balance_after: 40, reverses_movement_id: 'm1', reason: 'Lançamento errado' }),
          mov({ id: 'm1', reversed: true }),
          mov({ id: 'm3', type: 'entrada', direction: 1, quantity: 50, balance_after: 90, employee_id: null, supplier: 'Fornecedor X', delivery_id: null }),
        ],
        total: 45, page: 1, page_size: 20,
      }),
    });
    render(<EpiMovimentacaoView tenantId="11111111-1111-4111-8111-111111111111" />);
    await screen.findAllByText('Luva nitrílica', { selector: 'h3' });
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Estorno')).toBeInTheDocument();
    expect(within(items[0]).getByText(/Desfaz uma movimentação anterior/)).toBeInTheDocument();
    expect(within(items[0]).getByText(/Motivo: Lançamento errado/)).toBeInTheDocument();
    expect(within(items[1]).getByText('Entrega')).toBeInTheDocument();
    expect(within(items[1]).getByText('Estornada')).toBeInTheDocument(); // flag do servidor
    expect(within(items[1]).getByText(/João Lima/)).toBeInTheDocument();
    expect(within(items[1]).getByText('−2')).toBeInTheDocument();
    expect(within(items[2]).getByText('Entrada')).toBeInTheDocument();
    expect(within(items[2]).queryByText('Estornada')).toBeNull();
    expect(within(items[2]).getByText('+50')).toBeInTheDocument();
    expect(within(items[2]).getByText(/origem: Fornecedor X/)).toBeInTheDocument();
    expect(historyCalls().every((u) => params(u).get('tenant_id') === '11111111-1111-4111-8111-111111111111')).toBe(true);

    await ready();
    change('h-epi', 'e1');
    await waitFor(() => expect(params(historyCalls().at(-1)!).get('tenant_epi_id')).toBe('e1'));
    change('h-emp', 'emp2');
    await waitFor(() => expect(params(historyCalls().at(-1)!).get('employee_id')).toBe('emp2'));
    change('h-type', 'devolucao');
    await waitFor(() => expect(params(historyCalls().at(-1)!).get('type')).toBe('devolucao'));
    change('h-from', '2026-10-01');
    change('h-to', '2026-10-15');
    await waitFor(() => {
      const p = params(historyCalls().at(-1)!);
      expect(p.get('from')).toBe('2026-10-01T00:00:00-03:00');
      expect(p.get('to')).toBe('2026-10-15T23:59:59-03:00'); // o dia final inteiro
    });
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    await waitFor(() => expect(params(historyCalls().at(-1)!).get('page')).toBe('2'));
    expect(params(historyCalls().at(-1)!).get('page_size')).toBe('20');
  });

  it('initialFilters pré-seleciona os filtros e a primeira consulta já os usa', async () => {
    setup();
    render(<EpiMovimentacaoView initialFilters={{ epiId: 'e1', type: 'baixa' }} />);
    await screen.findAllByText('Luva nitrílica', { selector: 'h3' });
    const p = params(historyCalls()[0]);
    expect(p.get('tenant_epi_id')).toBe('e1');
    expect(p.get('type')).toBe('baixa');
  });

  it('período invertido avisa e não consulta; erro do histórico mostra mensagem fechada com nova tentativa', async () => {
    let fail = true;
    setup({ history: () => (fail ? res({ message: 'segredo interno pg_x' }, 500) : res({ items: [], total: 0, page: 1, page_size: 20 })) });
    render(<EpiMovimentacaoView />);
    const alert = await screen.findByText('Não foi possível concluir a operação. Tente novamente.');
    expect(alert.textContent).not.toContain('pg_x');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('Nenhuma movimentação registrada ainda.');
    change('h-from', '2026-10-20');
    await waitFor(() => expect(params(historyCalls().at(-1)!).get('from')).toBe('2026-10-20T00:00:00-03:00'));
    const before = historyCalls().length;
    change('h-to', '2026-10-10');
    expect(screen.getByText('A data inicial não pode ser depois da data final.')).toBeInTheDocument();
    expect(historyCalls().length).toBe(before);
  });

  it('trocar de empresa remonta a view (listas e filtros recomeçam)', async () => {
    setup();
    const { rerender } = render(<EpiMovimentacaoView tenantId="11111111-1111-4111-8111-111111111111" />);
    await ready();
    change('h-type', 'baixa');
    await waitFor(() => expect(params(historyCalls().at(-1)!).get('type')).toBe('baixa'));
    rerender(<EpiMovimentacaoView tenantId="22222222-2222-4222-8222-222222222222" />);
    await waitFor(() => expect(params(historyCalls().at(-1)!).get('tenant_id')).toBe('22222222-2222-4222-8222-222222222222'));
    expect(params(historyCalls().at(-1)!).get('type')).toBeNull();
  });
});

describe('EpiMovimentacaoView: flag reversed do servidor', () => {
  it('com filtro de tipo, a original estornada vem marcada (reversed:true) e sem botão Estornar; sem a flag o botão existe', async () => {
    setup({
      history: () => res({
        items: [mov({ id: 'm1', reversed: true }), mov({ id: 'm9', reversed: false, quantity: 7 })],
        total: 2, page: 1, page_size: 20,
      }),
    });
    render(<EpiMovimentacaoView initialFilters={{ type: 'entrega' }} />);
    await screen.findAllByText('Luva nitrílica', { selector: 'h3' });
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('Estornada')).toBeInTheDocument();
    expect(within(items[0]).queryByRole('button', { name: /Estornar/ })).toBeNull();
    expect(within(items[1]).queryByText('Estornada')).toBeNull();
    expect(within(items[1]).getByRole('button', { name: /Estornar entrega/ })).toBeInTheDocument();
    expect(params(historyCalls()[0]).get('type')).toBe('entrega');
  });

  it('um estorno na mesma página NÃO marca a original sem a flag do servidor (sem inferência)', async () => {
    setup({ history: () => res({ items: [mov({ id: 'm2', type: 'estorno', direction: 1, reverses_movement_id: 'm1' }), mov({ id: 'm1' })], total: 2, page: 1, page_size: 20 }) });
    render(<EpiMovimentacaoView />);
    await screen.findAllByText('Luva nitrílica', { selector: 'h3' });
    expect(screen.queryByText('Estornada')).toBeNull();
  });
});

describe('EpiMovimentacaoView: formulário por tipo', () => {
  it('tipos disponíveis: empresa vê ajuste e abertura; técnico não', async () => {
    setup();
    const { unmount } = render(<EpiMovimentacaoView />);
    await ready();
    const labels = (id: string) => Array.from($(id).querySelectorAll('option')).map((o) => o.textContent);
    expect(labels('mov-type')).toEqual([
      'Entrega a funcionário', 'Devolução de funcionário', 'Troca de EPI', 'Entrada de estoque', 'Baixa (perda ou descarte)', 'Ajuste de estoque', 'Abertura de estoque',
    ]);
    unmount();
    auth.role = 'tecnico';
    render(<EpiMovimentacaoView tenantId="11111111-1111-4111-8111-111111111111" />);
    await ready();
    expect(labels('mov-type')).toEqual(['Entrega a funcionário', 'Devolução de funcionário', 'Troca de EPI', 'Entrada de estoque', 'Baixa (perda ou descarte)']);
    expect(screen.queryByRole('button', { name: /Estornar/ })).toBeNull(); // estorno só empresa/admin
  });

  it('campos aparecem conforme o tipo: entrega/troca/devolução pedem funcionário; entrada pede fornecedor; baixa/ajuste pedem motivo', async () => {
    setup();
    render(<EpiMovimentacaoView />);
    await ready();
    expect($('mov-employee')).not.toBeNull();
    expect($('mov-supplier')).toBeNull();
    expect($('mov-reason')).toBeNull();
    change('mov-type', 'devolucao');
    expect($('mov-employee')).not.toBeNull();
    expect($('mov-reason')).not.toBeNull();
    expect(screen.getByLabelText('Motivo (opcional)')).toBeInTheDocument();
    change('mov-type', 'troca');
    expect($('mov-employee')).not.toBeNull();
    change('mov-type', 'entrada');
    expect($('mov-employee')).toBeNull();
    expect($('mov-supplier')).not.toBeNull();
    change('mov-type', 'baixa');
    expect($('mov-supplier')).toBeNull();
    expect(screen.getByLabelText('Motivo')).toBeInTheDocument();
    change('mov-type', 'ajuste');
    expect(screen.getByRole('radio', { name: 'Retirar do estoque' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Acrescentar ao estoque' })).toBeInTheDocument();
    change('mov-type', 'abertura');
    expect($('mov-employee')).toBeNull();
    expect($('mov-reason')).toBeNull();
  });

  it('EPI com controle de lote: entrada/abertura aceitam novo lote (código e validade); entrega exige escolher lote existente', async () => {
    setup({ epis: [epi({ controls_lot: true })] });
    render(<EpiMovimentacaoView />);
    await ready();
    change('mov-epi', 'e1');
    await waitFor(() => expect(Array.from($('mov-lot').querySelectorAll('option')).some((o) => o.textContent?.includes('Lote L-77'))).toBe(true));
    // entrega: sem "Novo lote"
    expect(Array.from($('mov-lot').querySelectorAll('option')).map((o) => o.textContent)).not.toContain('Novo lote');
    change('mov-employee', 'emp1');
    change('mov-qty', '2');
    submit(/^Registrar entrega a funcionário$/i);
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha o lote.');
    expect(writes()).toHaveLength(0);
    change('mov-lot', 'l1');
    submit(/^Registrar entrega a funcionário$/i);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf(writes()[0])).toMatchObject({ type: 'entrega', employee_id: 'emp1', quantity: 2, lot_id: 'l1' });
    await screen.findByText('Entrega registrada.');

    change('mov-type', 'entrada');
    expect(Array.from($('mov-lot').querySelectorAll('option')).map((o) => o.textContent)).toContain('Novo lote');
    change('mov-lot', '__novo__');
    change('mov-supplier', 'Fornecedor X');
    change('mov-qty', '30');
    submit(/^Registrar entrada de estoque$/i);
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o código do lote.');
    change('mov-lot-code', ' L-99 ');
    change('mov-lot-valid', '2028-01-31');
    submit(/^Registrar entrada de estoque$/i);
    await waitFor(() => expect(writes()).toHaveLength(2));
    const b = bodyOf(writes()[1]);
    expect(b).toMatchObject({ type: 'entrada', supplier: 'Fornecedor X', quantity: 30, lot_code: 'L-99', lot_valid_until: '2028-01-31' });
    expect(b).not.toHaveProperty('lot_id');
    expect(b).not.toHaveProperty('employee_id');
  });

  it('devolução e troca enviam funcionário e motivo opcional; entrada exige fornecedor', async () => {
    setup();
    render(<EpiMovimentacaoView />);
    await ready();
    change('mov-type', 'devolucao');
    change('mov-epi', 'e1');
    change('mov-employee', 'emp2');
    change('mov-qty', '1');
    change('mov-reason', ' desgaste ');
    submit(/^Registrar devolução de funcionário$/i);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf(writes()[0])).toMatchObject({ type: 'devolucao', employee_id: 'emp2', quantity: 1, reason: 'desgaste' });
    await screen.findByText('Devolução registrada.');
    // devolução não oferece assinatura
    expect(screen.queryByRole('button', { name: 'Gerar link de assinatura' })).toBeNull();

    change('mov-type', 'entrada');
    change('mov-epi', 'e1');
    change('mov-qty', '5');
    submit(/^Registrar entrada de estoque$/i);
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o fornecedor ou a origem.');
    expect(writes()).toHaveLength(1);
  });
});

describe('EpiMovimentacaoView: idempotência, quantidade e duplo clique', () => {
  async function fillEntrega(qty = '2') {
    await ready();
    change('mov-epi', 'e1');
    change('mov-employee', 'emp1');
    change('mov-qty', qty);
  }

  it('cada envio usa uma idempotency_key nova; reenviar o MESMO formulário após falha de rede reaproveita a chave; editar gera outra', async () => {
    let n = 0;
    setup({ post: () => { n += 1; if (n === 1) throw new TypeError('network'); return res(mov({ id: 'n' + n, delivery_id: 'dn' + n }), 201); } });
    render(<EpiMovimentacaoView />);
    await fillEntrega();
    submit(/^Registrar entrega a funcionário$/i);
    expect(await screen.findByText('Não foi possível conectar ao servidor. Verifique a conexão e tente de novo.')).toBeInTheDocument();
    submit(/^Registrar entrega a funcionário$/i);
    await screen.findByText('Entrega registrada.');
    expect(writes()).toHaveLength(2);
    const k1 = bodyOf(writes()[0]).idempotency_key;
    expect(bodyOf(writes()[1]).idempotency_key).toBe(k1);
    expect(String(k1).length).toBeGreaterThanOrEqual(8);

    // novo envio, após sucesso: chave nova
    await ready();
    change('mov-employee', 'emp1');
    change('mov-qty', '2');
    submit(/^Registrar entrega a funcionário$/i);
    await waitFor(() => expect(writes()).toHaveLength(3));
    expect(bodyOf(writes()[2]).idempotency_key).not.toBe(k1);
  });

  it('alterar o formulário depois de uma falha troca a chave', async () => {
    let n = 0;
    setup({ post: () => { n += 1; if (n === 1) throw new TypeError('network'); return res(mov(), 201); } });
    render(<EpiMovimentacaoView />);
    await fillEntrega('2');
    submit(/^Registrar entrega a funcionário$/i);
    await screen.findByText(/Não foi possível conectar/);
    change('mov-qty', '3');
    submit(/^Registrar entrega a funcionário$/i);
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(bodyOf(writes()[1]).idempotency_key).not.toBe(bodyOf(writes()[0]).idempotency_key);
  });

  it.each(['0', '-1', '1,5', '1.5', 'abc', '100001', '', '  '])('quantidade "%s" é recusada no cliente', async (q) => {
    setup();
    render(<EpiMovimentacaoView />);
    await fillEntrega(q);
    submit(/^Registrar entrega a funcionário$/i);
    expect(screen.getByRole('alert')).toHaveTextContent('Informe a quantidade (número inteiro de 1 a 100.000).');
    expect(writes()).toHaveLength(0);
  });

  it.each(['1', '100000'])('quantidade limite "%s" é aceita', async (q) => {
    setup();
    render(<EpiMovimentacaoView />);
    await fillEntrega(q);
    submit(/^Registrar entrega a funcionário$/i);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(bodyOf(writes()[0]).quantity).toBe(Number(q));
  });

  it('o botão fica aria-disabled durante o envio e o duplo clique envia uma vez', async () => {
    let resolve!: (v: unknown) => void;
    setup({ post: () => new Promise((r) => { resolve = r; }) });
    render(<EpiMovimentacaoView />);
    await fillEntrega();
    const btn = screen.getByRole('button', { name: /^Registrar entrega a funcionário$/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.submit(btn.closest('form')!);
    expect(writes()).toHaveLength(1);
    const busy = screen.getByRole('button', { name: 'Registrando...' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(busy).not.toBeDisabled();
    resolve(res(mov(), 201));
    await screen.findByText('Entrega registrada.');
  });

  it('exige EPI e funcionário antes de enviar', async () => {
    setup();
    render(<EpiMovimentacaoView />);
    await ready();
    submit(/^Registrar entrega a funcionário$/i);
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha o EPI.');
    change('mov-epi', 'e1');
    submit(/^Registrar entrega a funcionário$/i);
    expect(screen.getByRole('alert')).toHaveTextContent('Escolha o funcionário.');
    expect(writes()).toHaveLength(0);
  });
});

describe('EpiMovimentacaoView: erros do backend', () => {
  it.each([
    ['Estoque insuficiente', 'Estoque insuficiente para esta operação.'],
    ['CA vencido: não é possível entregar este EPI', 'O CA deste EPI está vencido: não é possível entregá-lo.'],
    ['Lote vencido: não é possível entregar deste lote', 'O lote selecionado está vencido.'],
    ['Devolução maior que a quantidade entregue ao funcionário', 'A devolução é maior que a quantidade entregue a este funcionário.'],
    ['Saldo máximo excedido', 'O saldo máximo permitido seria excedido.'],
    ['EPI inativo', 'Este EPI está inativo.'],
    ['Chave de idempotência já usada em outra operação', 'Esta operação já foi registrada. Atualize a tela e confira o histórico.'],
  ])('"%s" vira mensagem fixa, nunca texto cru', async (server, shown) => {
    setup({ post: () => res({ message: server }, 409) });
    render(<EpiMovimentacaoView />);
    await ready();
    change('mov-epi', 'e1');
    change('mov-employee', 'emp1');
    change('mov-qty', '2');
    submit(/^Registrar entrega a funcionário$/i);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(shown);
    expect(alert.textContent).not.toBe(server);
  });

  it('mensagem desconhecida do servidor nunca aparece', async () => {
    setup({ post: () => res({ message: 'duplicate key value violates constraint epi_x' }, 500) });
    render(<EpiMovimentacaoView />);
    await ready();
    change('mov-epi', 'e1');
    change('mov-employee', 'emp1');
    change('mov-qty', '2');
    submit(/^Registrar entrega a funcionário$/i);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível concluir a operação. Tente novamente.');
    expect(alert.textContent).not.toContain('constraint');
  });
});

describe('EpiMovimentacaoView: confirmações', () => {
  it('baixa pede confirmação com o motivo; cancelar não envia; confirmar envia', async () => {
    setup();
    render(<EpiMovimentacaoView />);
    await ready();
    change('mov-type', 'baixa');
    change('mov-epi', 'e1');
    change('mov-qty', '3');
    change('mov-reason', 'Luvas rasgadas no turno');
    submit(/^Registrar baixa/i);
    const dlg = screen.getByRole('dialog', { name: 'Confirmar baixa de estoque?' });
    expect(dlg).toHaveTextContent('Luvas rasgadas no turno');
    expect(dlg).toHaveTextContent('3 un. de Luva nitrílica');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(writes()).toHaveLength(0);
    submit(/^Registrar baixa/i);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Registrar baixa' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/api/epis/e1/movements');
    expect(bodyOf(writes()[0])).toMatchObject({ type: 'baixa', quantity: 3, reason: 'Luvas rasgadas no turno' });
    await screen.findByText('Baixa registrada.');
  });

  it('baixa sem motivo suficiente é barrada antes da confirmação', async () => {
    setup();
    render(<EpiMovimentacaoView />);
    await ready();
    change('mov-type', 'baixa');
    change('mov-epi', 'e1');
    change('mov-qty', '3');
    change('mov-reason', 'abc');
    submit(/^Registrar baixa/i);
    expect(screen.getByRole('alert')).toHaveTextContent('Explique o motivo');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ajuste pede confirmação, usa /adjustments com direção e motivo, e cancelar não envia', async () => {
    setup();
    render(<EpiMovimentacaoView />);
    await ready();
    change('mov-type', 'ajuste');
    change('mov-epi', 'e1');
    fireEvent.click(screen.getByRole('radio', { name: 'Acrescentar ao estoque' }));
    change('mov-qty', '4');
    change('mov-reason', 'Contagem física de outubro');
    submit(/^Registrar ajuste de estoque$/i);
    const dlg = screen.getByRole('dialog', { name: 'Confirmar ajuste de estoque?' });
    expect(dlg).toHaveTextContent('Acrescenta ao estoque');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancelar' }));
    expect(writes()).toHaveLength(0);
    submit(/^Registrar ajuste de estoque$/i);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Registrar ajuste' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/api/epis/e1/adjustments');
    expect(bodyOf(writes()[0])).toMatchObject({ direction: 'mais', quantity: 4, reason: 'Contagem física de outubro' });
  });

  it('estorno pede o motivo (mín. 5), usa /reversal com chave própria e marca a movimentação como estornada; cancelar não envia', async () => {
    setup();
    render(<EpiMovimentacaoView />);
    await screen.findByRole('button', { name: /Estornar entrega de Luva nitrílica/ });
    fireEvent.click(screen.getByRole('button', { name: /Estornar entrega de Luva nitrílica/ }));
    let dlg = screen.getByRole('dialog', { name: 'Estornar movimentação?' });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancelar' }));
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Estornar entrega de Luva nitrílica/ }));
    dlg = screen.getByRole('dialog', { name: 'Estornar movimentação?' });
    fireEvent.change(within(dlg).getByLabelText('Motivo do estorno'), { target: { value: 'abc' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Estornar movimentação' }));
    expect(within(dlg).getByRole('alert')).toHaveTextContent('mínimo de 5 caracteres');
    expect(writes()).toHaveLength(0);
    fireEvent.change(within(dlg).getByLabelText('Motivo do estorno'), { target: { value: 'Entrega lançada por engano' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Estornar movimentação' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/api/epis/movements/m1/reversal');
    expect(bodyOf(writes()[0])).toMatchObject({ reason: 'Entrega lançada por engano' });
    expect(String(bodyOf(writes()[0]).idempotency_key).length).toBeGreaterThanOrEqual(8);
    await screen.findByText('Movimentação estornada.');
    await waitFor(() => expect(screen.getByText('Estornada')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Estornar entrega/ })).toBeNull();
  });

  it('estorno recusado pelo servidor mostra mensagem fixa e reenvio reaproveita a chave', async () => {
    let n = 0;
    setup({ post: () => { n += 1; return n === 1 ? res({ message: 'Estorne antes as devoluções deste funcionário neste EPI' }, 409) : res(mov({ id: 'x' }), 201); } });
    render(<EpiMovimentacaoView />);
    fireEvent.click(await screen.findByRole('button', { name: /Estornar entrega/ }));
    const dlg = screen.getByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('Motivo do estorno'), { target: { value: 'Entrega lançada por engano' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Estornar movimentação' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Estorne antes as devoluções deste funcionário neste EPI.');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Estornar movimentação' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(bodyOf(writes()[1]).idempotency_key).toBe(bodyOf(writes()[0]).idempotency_key);
  });
});

describe('EpiMovimentacaoView: assinatura após a entrega', () => {
  async function entregar() {
    await ready();
    change('mov-epi', 'e1');
    change('mov-employee', 'emp1');
    change('mov-qty', '2');
    submit(/^Registrar entrega a funcionário$/i);
    await screen.findByRole('button', { name: 'Gerar link de assinatura' });
  }

  it('após a entrega aparecem as duas ações; o link usa o funcionário e o delivery_id da entrega', async () => {
    const created = { id: 'r1', url: 'https://app.test/assinar#token=T', qr_payload: 'x', code: '654321', expires_at: '2026-10-19T15:00:00Z', delivery_ids: ['dnew'] };
    setup({ extra: (url, init) => (url === '/api/epi-signatures/requests' && init.method === 'POST' ? res(created, 201) : res({}, 404)) });
    render(<EpiMovimentacaoView />);
    await entregar();
    const region = screen.getByRole('region', { name: 'Assinatura da entrega registrada' });
    expect(region).toHaveTextContent('João Lima');
    expect(within(region).getByRole('button', { name: 'Registrar assinatura presencial' })).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Gerar link de assinatura' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Gerar link de assinatura' }));
    await screen.findByTestId('signature-code');
    const sig = writes().find((c) => c[0] === '/api/epi-signatures/requests')!;
    expect(bodyOf(sig)).toMatchObject({ employee_id: 'emp1', delivery_ids: ['dnew'] });
    expect(screen.getByTestId('signature-code')).toHaveTextContent('654 321');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByTestId('signature-code')).toBeNull();
    expect(document.body.textContent).not.toContain('654 321');
  });

  it('assinatura presencial usa o delivery_id da entrega e, ao concluir, avisa e some o painel', async () => {
    setup({ extra: (url, init) => (url === '/api/epi-signatures/in-person' && init.method === 'POST' ? res({ in_person_id: 'p', registered_at: 'x', deliveries: [] }, 201) : res({}, 404)) });
    render(<EpiMovimentacaoView />);
    await entregar();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar assinatura presencial' }));
    fireEvent.change(screen.getByLabelText('Nome da testemunha'), { target: { value: 'Maria Souza' } });
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Funcionário sem celular' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Registrar assinatura presencial' }));
    await screen.findByText('Assinatura presencial registrada.');
    const call = writes().find((c) => c[0] === '/api/epi-signatures/in-person')!;
    expect(bodyOf(call).delivery_ids).toEqual(['dnew']);
    expect(screen.queryByRole('region', { name: 'Assinatura da entrega registrada' })).toBeNull();
  });

  it('gerar link com sucesso recarrega os links ativos da entrega ao fechar; fechar sem gerar não recarrega', async () => {
    const created = { id: 'r9', url: 'https://app.test/assinar#token=T', qr_payload: 'x', code: '654321', expires_at: '2026-10-19T15:00:00Z', delivery_ids: ['dnew'] };
    let listed = 0;
    setup({
      extra: (url, init) => {
        if (url === '/api/epi-signatures/requests' && init.method === 'POST') return res(created, 201);
        if (url.startsWith('/api/epi-signatures/requests?employee_id=emp1')) {
          listed += 1;
          return res([{ id: 'r9', employee_id: 'emp1', status: 'ativa', attempts: 0, expires_at: '2026-10-19T15:00:00Z', created_at: 'x', used_at: null, refusal_reason: null, delivery_ids: ['dnew'] }]);
        }
        return res({}, 404);
      },
    });
    render(<EpiMovimentacaoView />);
    await entregar();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de assinatura' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(listed).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de assinatura' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Gerar link de assinatura' }));
    await screen.findByTestId('signature-code');
    expect(listed).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await screen.findByText(/Link ativo, expira em 19\/10\/2026 12:00/);
    expect(listed).toBe(1);
    expect(document.body.textContent).not.toContain('654 321');
  });

  it('lista os links ativos da entrega e revoga com confirmação', async () => {
    const reqs = [
      { id: 'r1', employee_id: 'emp1', status: 'ativa', attempts: 0, expires_at: '2026-10-19T15:00:00Z', created_at: 'x', used_at: null, refusal_reason: null, delivery_ids: ['dnew'] },
      { id: 'r2', employee_id: 'emp1', status: 'ativa', attempts: 0, expires_at: '2026-10-19T15:00:00Z', created_at: 'x', used_at: null, refusal_reason: null, delivery_ids: ['outra'] },
      { id: 'r3', employee_id: 'emp1', status: 'revogada', attempts: 0, expires_at: '2026-10-19T15:00:00Z', created_at: 'x', used_at: null, refusal_reason: null, delivery_ids: ['dnew'] },
    ];
    setup({
      extra: (url, init) => {
        if (url.startsWith('/api/epi-signatures/requests?employee_id=emp1')) return res(reqs);
        if (url === '/api/epi-signatures/requests/r1/revoke' && init.method === 'POST') return res({ id: 'r1', status: 'revogada' }, 201);
        return res({}, 404);
      },
    });
    render(<EpiMovimentacaoView />);
    await entregar();
    fireEvent.click(screen.getByRole('button', { name: 'Ver links ativos desta entrega' }));
    await screen.findByText(/Link ativo, expira em 19\/10\/2026 12:00/);
    expect(screen.getAllByRole('button', { name: 'Revogar link' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Revogar link' }));
    const dlg = screen.getByRole('dialog', { name: 'Revogar o link de assinatura?' });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancelar' }));
    expect(writes().some((c) => String(c[0]).includes('/revoke'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Revogar link' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revogar link' }));
    await screen.findByText('Link revogado.');
    expect(writes().some((c) => c[0] === '/api/epi-signatures/requests/r1/revoke')).toBe(true);
    expect(screen.queryByText(/Link ativo, expira em/)).toBeNull();
  });
});

describe('EpiMovimentacaoView: seletor de EPI completo (I2)', () => {
  const pageOf = (url: string, total: number) => {
    const p = Number(new URL(url, 'http://x').searchParams.get('page') ?? '1');
    const n = Math.max(0, Math.min(100, total - (p - 1) * 100));
    return { items: Array.from({ length: n }, (_, i) => epi({ id: `e${p}-${i}`, description: `EPI ${p}-${i}` })), total, page: p, page_size: 100 };
  };
  it('total 250 carrega 3 páginas e lista os 250 EPIs, sem aviso', async () => {
    setup();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/epis/search')) return res(pageOf(url, 250));
      if (url.startsWith('/api/employees')) return res(emp);
      if (url.startsWith('/api/epis/movements')) return res({ items: [], total: 0, page: 1, page_size: 20 });
      return res({}, 404);
    });
    render(<EpiMovimentacaoView />);
    await waitFor(() => expect($('mov-epi').querySelectorAll('option').length).toBe(251));
    expect(screen.queryByText(/Mostrando os primeiros 1000/)).toBeNull();
  });
  it('teto de 1000: avisa para refinar pela busca', async () => {
    setup();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/epis/search')) return res(pageOf(url, 1500));
      if (url.startsWith('/api/employees')) return res(emp);
      if (url.startsWith('/api/epis/movements')) return res({ items: [], total: 0, page: 1, page_size: 20 });
      return res({}, 404);
    });
    render(<EpiMovimentacaoView />);
    expect(await screen.findByText('Mostrando os primeiros 1000 EPIs; refine pela busca.')).toBeInTheDocument();
    expect($('mov-epi').querySelectorAll('option').length).toBe(1001);
  });
});
