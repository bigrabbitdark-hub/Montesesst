import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

vi.mock('@/lib/auth', () => ({ getToken: () => 'tok', getUser: () => ({ id: 'u1', role: 'empresa', tenantId: 't1' }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') } }));

import { EpiFichasView } from '../EpiFichasView';
import type { EmployeeLite, Ficha, FichaDocument, FichaLine } from '@/lib/epi/types';

const fetchMock = vi.fn();
const res = (body: unknown, status = 200) => ({ ok: status < 400, status, headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/pdf' : null) }, json: async () => body, text: async () => JSON.stringify(body), blob: async () => new Blob(['%PDF']) });

const emps: EmployeeLite[] = [
  { id: 'emp1', full_name: 'João Lima', registration_number: '001', department: 'Obras', position: 'Pedreiro', status: 'ativo' },
  { id: 'emp2', full_name: 'Maria Souza', registration_number: null, department: null, position: null, status: 'ativo' },
];
const line = (over: Partial<FichaLine> = {}): FichaLine => ({
  source: 'livro', movement_id: 'm1', delivery_id: 'd1', date: '2026-10-10', type: 'entrega', epi_description: 'Luva nitrílica',
  manufacturer: 'Acme', model: 'X1', ca_number: '12345', quantity: 2, reason: null, signature_status: 'pendente', reversed: false,
  receipt_code: null, signed_at: null, ...over,
});
const ficha = (over: Partial<Ficha> = {}, id = 'emp1'): Ficha => ({
  company: { name: 'Construtora Alfa Ltda', trade_name: null, cnpj: '12.345.678/0001-95', address: 'Rua A, 1' },
  employee: { id, full_name: id === 'emp1' ? 'João Lima' : 'Maria Souza', cpf_masked: '***.456.789-**', registration_number: id === 'emp1' ? '001' : null,
    department: id === 'emp1' ? 'Obras' : null, position: id === 'emp1' ? 'Pedreiro' : null, admission_date: null, company_unit_name: null, status: 'ativo' },
  filters: {}, lines: [line()], signatures: [], term: { version: 'v1', draft: false, title: 'Termo', paragraphs: [] }, ...over,
});
const doc = (over: Partial<FichaDocument> = {}): FichaDocument => ({
  id: 'doc1', employee_id: 'emp1', version: 2, document_code: 'FEPI-20261018-AAAA', file_sha256: 'a'.repeat(64), snapshot_sha256: 'b'.repeat(64),
  term_version: 'v1', issued_by_user_id: 'u1', issued_at: '2026-10-18T15:30:00Z', ...over,
});

type H = (url: string, init: RequestInit) => unknown;
let reqsH: () => unknown[] = () => [];
let fichaH: H; let docsH: H; let issueH: H; let verifyH: H; let blobH: H;
function setup(o: { ficha?: H; docs?: H; issue?: H; verify?: H; blob?: H } = {}) {
  fichaH = o.ficha ?? (() => res(ficha()));
  docsH = o.docs ?? (() => res([doc()]));
  issueH = o.issue ?? (() => res(doc({ id: 'doc3', version: 3, document_code: 'FEPI-20261018-BBBB' }), 201));
  verifyH = o.verify ?? (() => res({ status: 'integro', document_code: 'x', version: 2, expected_sha256: 'a', actual_sha256: 'a' }));
  blobH = o.blob ?? (() => res(null));
  fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (url.startsWith('/api/employees')) return res(emps);
    if (method === 'POST' && url.endsWith('/epi-signatures/in-person')) return res({ in_person_id: 'p1', registered_at: 'x', deliveries: [] }, 201);
    if (method === 'GET' && url.startsWith('/api/epi-signatures/requests?')) return res(reqsH());
    if (method === 'POST' && url.endsWith('/revoke')) return res({ id: 'r1', status: 'revogada' }, 201);
    if (method === 'POST' && url.endsWith('/issue')) return issueH(url, init);
    if (method === 'POST' && url.endsWith('/epi-signatures/requests')) return res({ id: 'r1', url: 'https://x/y', qr_payload: 'q', code: '123456', expires_at: '2026-10-19T12:00:00Z', delivery_ids: ['d1'] }, 201);
    if (url.includes('/preview.pdf') || url.endsWith('/download') || url.endsWith('/receipt.pdf')) return blobH(url, init);
    if (url.endsWith('/verify')) return verifyH(url, init);
    if (url.includes('/documents')) return docsH(url, init);
    if (url.startsWith('/api/epi-fichas/employees/')) return fichaH(url, init);
    return res({}, 404);
  });
}
const calls = (re: RegExp) => fetchMock.mock.calls.filter((c) => re.test(c[0] as string));
const issues = () => calls(/\/issue$/);
const bodyOf = (c: unknown[]) => JSON.parse((c[1] as RequestInit).body as string);

async function pick(id = 'emp1') {
  await waitFor(() => expect(document.querySelectorAll('#ficha-emp option').length).toBeGreaterThan(1));
  fireEvent.change(document.getElementById('ficha-emp')!, { target: { value: id } });
}
const win = () => ({ closed: false, close: vi.fn(), opener: 'x', location: { href: '' } }) as unknown as Window;
let openSpy: { mockReturnValue: (w: Window | null) => unknown; mockRestore: () => void };
const origCreate = URL.createObjectURL;
const origRevoke = URL.revokeObjectURL;

beforeEach(() => {
  reqsH = () => [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  URL.createObjectURL = vi.fn(() => 'blob:ficha');
  URL.revokeObjectURL = vi.fn();
  const spy = vi.spyOn(window, 'open').mockImplementation(() => win());
  openSpy = spy;
});
afterEach(() => { vi.unstubAllGlobals(); openSpy.mockRestore(); URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke; vi.useRealTimers(); });

describe('EpiFichasView: ficha', () => {
  it('busca por nome, carrega a ficha com período e situação; mostra empresa, funcionário, CPF mascarado do servidor e "não informada"', async () => {
    setup({ ficha: (u) => res(u.includes('emp2') ? ficha({}, 'emp2') : ficha()) });
    render(<EpiFichasView />);
    await waitFor(() => expect(document.querySelectorAll('#ficha-emp option').length).toBe(3));
    fireEvent.change(document.getElementById('ficha-busca')!, { target: { value: 'maria' } });
    const opts = Array.from(document.querySelectorAll('#ficha-emp option')).map((o) => o.textContent);
    expect(opts).toEqual(['Selecione o funcionário', 'Maria Souza']);
    fireEvent.change(document.getElementById('ficha-emp')!, { target: { value: 'emp2' } });
    await screen.findByText('Construtora Alfa Ltda');
    expect(screen.getByText('***.456.789-**')).toBeInTheDocument();
    expect(screen.getAllByText('não informada')).toHaveLength(3);
    fireEvent.change(document.getElementById('ficha-de')!, { target: { value: '2026-10-01' } });
    fireEvent.change(document.getElementById('ficha-ate')!, { target: { value: '2026-10-31' } });
    fireEvent.change(document.getElementById('ficha-status')!, { target: { value: 'assinada' } });
    await waitFor(() => {
      const u = calls(/\/api\/epi-fichas\/employees\/emp2\?/).pop()![0] as string;
      const p = new URL(u, 'http://x').searchParams;
      expect([p.get('from'), p.get('to'), p.get('signature_status')]).toEqual(['2026-10-01', '2026-10-31', 'assinada']);
    });
  });

  it('histórico com status por linha, estornada marcada e dados da empresa; nenhum CPF cru na tela', async () => {
    setup({ ficha: () => res(ficha({ lines: [
      line(), line({ movement_id: 'm2', delivery_id: 'd2', signature_status: 'assinada', receipt_code: 'ASEPI-1', signed_at: '2026-10-11T12:00:00Z' }),
      line({ movement_id: 'm3', delivery_id: null, type: 'estorno', signature_status: null, reversed: true }),
    ] })) });
    const { container } = render(<EpiFichasView />);
    await pick();
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[1]).getByText('Pendente')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Assinada')).toBeInTheDocument();
    expect(within(rows[2]).getByText(/Comprovante ASEPI-1 · 11\/10\/2026 09:00/)).toBeInTheDocument();
    expect(within(rows[3]).getByText('Estornada')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(container.textContent).not.toMatch(/file_key|storage/i);
  });
});

describe('EpiFichasView: pré-visualização', () => {
  it('abre o PDF em nova aba (aberta no clique, noopener) por Blob autenticado e revoga a URL depois', async () => {
    setup();
    const w = win();
    openSpy.mockReturnValue(w);
    render(<EpiFichasView />);
    await pick();
    await screen.findByRole('table');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fireEvent.click(screen.getByRole('button', { name: 'Pré-visualizar PDF' }));
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(w.opener).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect((w as unknown as { location: { href: string } }).location.href).toBe('blob:ficha');
    const c = calls(/preview\.pdf/)[0];
    expect((c[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ficha');
  });

  it.each([[400, /Verifique o período/], [404, /Funcionário não encontrado/], [502, /gerar a prévia/]])('erro %i vira mensagem de lista fechada (sem texto do servidor)', async (status, re) => {
    setup({ blob: () => res({ message: 'detalhe interno do servidor xyz' }, status) });
    const w = win();
    openSpy.mockReturnValue(w);
    render(<EpiFichasView />);
    await pick();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Pré-visualizar PDF' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(re);
    expect(alert.textContent).not.toMatch(/xyz/);
    expect(w.close).toHaveBeenCalled();
  });
});

describe('EpiFichasView: emitir', () => {
  async function openConfirm() {
    render(<EpiFichasView />);
    await pick();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Emitir ficha' }));
    return screen.getByRole('dialog');
  }
  const confirm = (d: HTMLElement) => fireEvent.click(within(d).getByRole('button', { name: 'Emitir ficha' }));

  it('pede confirmação (nada é enviado antes), mostra código/versão e atualiza a lista de versões', async () => {
    setup();
    const d = await openConfirm();
    expect(issues()).toHaveLength(0);
    docsH = () => res([doc({ id: 'doc3', version: 3, document_code: 'FEPI-20261018-BBBB' }), doc()]);
    confirm(d);
    await screen.findByText('Ficha emitida: documento FEPI-20261018-BBBB, versão 3.');
    expect(issues()).toHaveLength(1);
    expect(bodyOf(issues()[0]).idempotency_key).toHaveLength(36);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText(/FEPI-20261018-BBBB · versão 3/)).toBeInTheDocument();
  });

  it('retentativa após falha de rede com o mesmo formulário reaproveita a chave; outro filtro gera chave nova; após sucesso, nova', async () => {
    let n = 0;
    setup({ issue: () => { n += 1; if (n === 1) throw new TypeError('network'); return res(doc({ id: 'doc3', version: 3 }), 201); } });
    let d = await openConfirm();
    confirm(d);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conectar ao servidor');
    fireEvent.click(screen.getByRole('button', { name: 'Emitir ficha' }));
    confirm(screen.getByRole('dialog'));
    await waitFor(() => expect(issues()).toHaveLength(2));
    const [k1, k2] = issues().map((c) => bodyOf(c).idempotency_key);
    expect(k1).toBe(k2);
    await screen.findByText(/Ficha emitida/);
    // novo formulário: filtro mudou -> chave nova
    fireEvent.change(document.getElementById('ficha-status')!, { target: { value: 'assinada' } });
    await waitFor(() => expect(calls(/signature_status=assinada/).length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: 'Emitir ficha' }));
    d = screen.getByRole('dialog');
    confirm(d);
    await waitFor(() => expect(issues()).toHaveLength(3));
    const b3 = bodyOf(issues()[2]);
    expect(b3.idempotency_key).not.toBe(k1);
    expect(b3.signature_status).toBe('assinada');
  });

  it.each([
    [503, 'Já existe uma emissão em andamento para este funcionário; tente novamente', /emissão em andamento/],
    [502, 'Não foi possível guardar o documento', /Nenhuma versão foi criada/],
    [409, 'Chave de idempotência já usada em outra operação', /já foi registrada com outros dados/],
    [400, 'Ficha muito grande: restrinja o período', /Restrinja o período/],
  ])('erro %i mostra mensagem clara', async (status, message, re) => {
    setup({ issue: () => res({ message }, status) });
    const d = await openConfirm();
    confirm(d);
    expect(await screen.findByRole('alert')).toHaveTextContent(re);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('duplo clique em confirmar envia uma só emissão (guarda por ref)', async () => {
    let release!: () => void;
    setup({ issue: () => new Promise((r) => { release = () => r(res(doc({ id: 'doc3', version: 3 }), 201)); }) });
    const d = await openConfirm();
    const btn = within(d).getByRole('button', { name: 'Emitir ficha' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(issues()).toHaveLength(1));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aguarde...' })).toHaveAttribute('aria-disabled', 'true');
    await act(async () => { release(); });
    await screen.findByText(/Ficha emitida/);
    expect(issues()).toHaveLength(1);
  });
});

describe('EpiFichasView: versões, termo e assinaturas', () => {
  it('lista versões (código, versão, data/hora de Brasília), baixa por Blob e verifica integridade com textos e cores distintos', async () => {
    const outcomes: Record<string, string> = { doc1: 'integro', doc2: 'divergente', doc3: 'arquivo_ausente' };
    setup({
      docs: () => res([doc(), doc({ id: 'doc2', version: 1, document_code: 'FEPI-OLD' }), doc({ id: 'doc3', version: 0, document_code: 'FEPI-X' })]),
      verify: (u) => res({ status: outcomes[u.split('/documents/')[1].split('/')[0]], document_code: 'c', version: 1, expected_sha256: 'a', actual_sha256: null }),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<EpiFichasView />);
    await pick();
    expect(await screen.findByText('FEPI-20261018-AAAA · versão 2')).toBeInTheDocument();
    expect(screen.getAllByText(/Emitida em 18\/10\/2026 12:30/)).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar versão 2' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(calls(/documents\/doc1\/download/)).toHaveLength(1);
    const texts: string[] = [];
    for (const [name, label, tone] of [
      ['Verificar integridade da versão 2', 'Íntegro', 'ok'],
      ['Verificar integridade da versão 1', 'Divergente', 'crit'],
      ['Verificar integridade da versão 0', 'Arquivo ausente', 'warn'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name }));
      const badge = await screen.findByText(label);
      expect(badge.className).toContain(`status-${tone}`);
      texts.push(badge.parentElement!.textContent!);
    }
    expect(new Set(texts).size).toBe(3);
    expect(screen.getByText(/NÃO confere/)).toBeInTheDocument();
    click.mockRestore();
  });

  it('linha assinada com signature_id oferece o comprovante PDF; entrega pendente tem "Gerar link" que abre o diálogo da entrega', async () => {
    setup({ ficha: () => res(ficha({ lines: [
      line({ movement_id: 'm2', delivery_id: 'd2', signature_status: 'assinada', receipt_code: 'ASEPI-1', signed_at: '2026-10-11T12:00:00Z', signature_id: 'sig1' }),
      line(),
    ] })) });
    const w = win();
    openSpy.mockReturnValue(w);
    render(<EpiFichasView />);
    await pick();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Baixar comprovante ASEPI-1' }));
    await waitFor(() => expect(calls(/epi-signatures\/sig1\/receipt\.pdf/)).toHaveLength(1));
    await waitFor(() => expect((w as unknown as { location: { href: string } }).location.href).toBe('blob:ficha'));
    expect(screen.getAllByRole('button', { name: 'Gerar link' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Gerar link de assinatura' }));
    await waitFor(() => expect(calls(/epi-signatures\/requests$/)).toHaveLength(1));
    const c = calls(/epi-signatures\/requests$/)[0];
    expect(bodyOf(c)).toMatchObject({ employee_id: 'emp1', delivery_ids: ['d1'] });
  });

  it('sem signature_id do servidor não oferece botão de comprovante (só o código)', async () => {
    setup({ ficha: () => res(ficha({ lines: [line({ signature_status: 'assinada', receipt_code: 'ASEPI-9', signed_at: '2026-10-11T12:00:00Z' })] })) });
    render(<EpiFichasView />);
    await pick();
    await screen.findByText(/Comprovante ASEPI-9/);
    expect(screen.queryByRole('button', { name: /Baixar comprovante/ })).toBeNull();
  });

  it('termo em rascunho: avisa na tela e na confirmação que o documento carrega o termo em rascunho; termo aprovado não avisa', async () => {
    setup({ ficha: () => res(ficha({ term: { version: 'v0-rascunho', draft: true, title: 'T', paragraphs: [] } })) });
    const { unmount } = render(<EpiFichasView />);
    await pick();
    expect(await screen.findByRole('note')).toHaveTextContent(/carrega o termo em rascunho/);
    fireEvent.click(screen.getByRole('button', { name: 'Emitir ficha' }));
    expect(within(screen.getByRole('dialog')).getByText(/termo de recebimento ainda está em rascunho/)).toBeInTheDocument();
    unmount();
    setup();
    render(<EpiFichasView />);
    await pick();
    await screen.findByRole('table');
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('EpiFichasView: segurança e concorrência', () => {
  it('resposta atrasada do funcionário anterior é descartada (ficha e versões)', async () => {
    const pending: Record<string, () => void> = {};
    setup({
      ficha: (u) => new Promise((r) => {
        const id = u.includes('emp1') ? 'emp1' : 'emp2';
        pending[id] = () => r(res(ficha({}, id)));
      }),
      docs: (u) => new Promise((r) => {
        const id = u.includes('emp1') ? 'emp1' : 'emp2';
        pending[`d${id}`] = () => r(res([doc({ id: `doc-${id}`, employee_id: id, document_code: `COD-${id}` })]));
      }),
    });
    render(<EpiFichasView />);
    await pick('emp1');
    await waitFor(() => expect(pending.emp1).toBeDefined());
    fireEvent.change(document.getElementById('ficha-emp')!, { target: { value: 'emp2' } });
    await waitFor(() => expect(pending.emp2).toBeDefined());
    await act(async () => { pending.emp2(); pending.demp2(); });
    await screen.findByText('Maria Souza', { selector: 'dd' });
    await act(async () => { pending.emp1(); pending.demp1(); });
    expect(screen.queryByText('João Lima', { selector: 'dd' })).toBeNull();
    expect(screen.getByText('Maria Souza', { selector: 'dd' })).toBeInTheDocument();
    expect(screen.queryByText(/COD-emp1/)).toBeNull();
    expect(screen.getByText(/COD-emp2/)).toBeInTheDocument();
  });

  it('passa tenant só pelo funcionário/RLS na ficha, lista funcionários da empresa pedida e não grava nada em storage', async () => {
    setup();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<EpiFichasView tenantId="tenant-9" />);
    await pick();
    await screen.findByRole('table');
    expect(calls(/\/api\/employees/)[0][0]).toBe('/api/employees?tenant_id=tenant-9');
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('período invertido bloqueia a consulta e as ações', async () => {
    setup();
    render(<EpiFichasView />);
    await pick();
    await screen.findByRole('table');
    fireEvent.change(document.getElementById('ficha-de')!, { target: { value: '2026-10-20' } });
    fireEvent.change(document.getElementById('ficha-ate')!, { target: { value: '2026-10-01' } });
    expect(await screen.findByText('A data inicial não pode ser depois da data final.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Emitir ficha' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('EpiFichasView: ajustes de revisão', () => {
  async function emitir() {
    fireEvent.click(await screen.findByRole('button', { name: 'Emitir ficha' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Emitir ficha' }));
  }

  it('409 zera a chave: repetir a emissão usa chave nova', async () => {
    let n = 0;
    setup({ issue: () => { n += 1; return n === 1 ? res({ message: 'Chave de idempotência já usada em outra operação' }, 409) : res(doc({ id: 'doc3', version: 3 }), 201); } });
    render(<EpiFichasView />);
    await pick();
    await screen.findByRole('table');
    await emitir();
    expect(await screen.findByRole('alert')).toHaveTextContent(/já foi registrada com outros dados/);
    await emitir();
    await screen.findByText(/Ficha emitida/);
    const [k1, k2] = issues().map((c) => bodyOf(c).idempotency_key);
    expect(k1).toBeTruthy();
    expect(k2).not.toBe(k1);
  });

  it('o diálogo de link não reabre sozinho ao voltar ao funcionário anterior', async () => {
    setup({ ficha: (u) => res(u.includes('emp2') ? ficha({ lines: [] }, 'emp2') : ficha()) });
    render(<EpiFichasView />);
    await pick('emp1');
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar link' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.change(document.getElementById('ficha-emp')!, { target: { value: 'emp2' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.change(document.getElementById('ficha-emp')!, { target: { value: 'emp1' } });
    await screen.findByRole('table');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Emitir fica aria-disabled enquanto a ficha recarrega e não abre a confirmação', async () => {
    let release!: () => void;
    let n = 0;
    setup({ ficha: () => { n += 1; return n === 1 ? res(ficha()) : new Promise((r) => { release = () => r(res(ficha())); }); } });
    render(<EpiFichasView />);
    await pick();
    await screen.findByRole('table');
    const btn = screen.getByRole('button', { name: 'Emitir ficha' });
    expect(btn).toHaveAttribute('aria-disabled', 'false');
    fireEvent.change(document.getElementById('ficha-status')!, { target: { value: 'assinada' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Emitir ficha' })).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Emitir ficha' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Emitir ficha' })).toHaveAttribute('aria-disabled', 'false'));
  });

  it('404 ao listar funcionários mostra mensagem da lista, não "Funcionário não encontrado"', async () => {
    setup();
    fetchMock.mockImplementation(async (url: string) => (url.startsWith('/api/employees') ? res({ message: 'x' }, 404) : res({}, 404)));
    render(<EpiFichasView tenantId="t-x" />);
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('Não foi possível carregar os funcionários desta empresa.');
    expect(a.textContent).not.toMatch(/Funcionário não encontrado/);
  });

  it('ficha com mais de 1000 linhas (400 na carga) orienta restringir o período', async () => {
    setup({ ficha: () => res({ message: 'Ficha muito grande: restrinja o período' }, 400) });
    render(<EpiFichasView />);
    await pick();
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent(/Restrinja o período/);
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('EpiFichasView: pendência antiga sem caminho (I1) e CNPJ', () => {
  it('entrega pendente tem "Registrar assinatura presencial": envia a entrega, recarrega a ficha e avisa', async () => {
    let n = 0;
    setup({ ficha: () => { n += 1; return res(ficha(n === 1 ? {} : { lines: [line({ signature_status: 'presencial' })] })); } });
    render(<EpiFichasView />);
    await pick();
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar assinatura presencial' }));
    const dlg = screen.getByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('Nome da testemunha'), { target: { value: 'Maria Souza' } });
    fireEvent.change(within(dlg).getByLabelText('Motivo'), { target: { value: 'Funcionário sem celular' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Registrar assinatura presencial' }));
    await screen.findByText('Assinatura presencial registrada.');
    const call = calls(/epi-signatures\/in-person$/)[0];
    expect(bodyOf(call).delivery_ids).toEqual(['d1']);
    await waitFor(() => expect(within(screen.getByRole('table')).getByText('Presencial')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Registrar assinatura presencial' })).toBeNull();
    expect(n).toBe(2);
  });

  it('lista e revoga links ativos sem mostrar token, hash nem código mesmo que a API os devolva', async () => {
    reqsH = () => [{ id: 'r1', employee_id: 'emp1', status: 'ativa', attempts: 0, expires_at: '2026-10-19T15:00:00Z', created_at: 'x', used_at: null, refusal_reason: null, delivery_ids: ['d1'],
      token: 'TOKEN-SECRETO-ABC', token_hash: 'HASH-SECRETO-DEF', pin_hash: 'PIN-SECRETO-GHI', code: '654321', url: 'https://app/assinar#token=TOKEN-SECRETO-ABC' }];
    setup();
    render(<EpiFichasView />);
    await pick();
    fireEvent.click(await screen.findByRole('button', { name: 'Ver links ativos do funcionário' }));
    await screen.findByText(/Link ativo, expira em 19\/10\/2026 12:00/);
    for (const segredo of ['TOKEN-SECRETO-ABC', 'HASH-SECRETO-DEF', 'PIN-SECRETO-GHI', '654321', '654 321']) expect(document.body.textContent).not.toContain(segredo);
    fireEvent.click(screen.getByRole('button', { name: 'Revogar link' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revogar link' }));
    await screen.findByText('Link revogado.');
    expect(calls(/requests\/r1\/revoke$/)).toHaveLength(1);
  });

  it('o card de links ativos continua disponível com filtro que esconde as pendências e recarrega após registro presencial', async () => {
    let listed = 0;
    reqsH = () => { listed += 1; return []; };
    setup({ ficha: (u) => res(u.includes('signature_status=assinada') ? ficha({ lines: [line({ signature_status: 'assinada' })] }) : ficha()) });
    render(<EpiFichasView />);
    await pick();
    fireEvent.click(await screen.findByRole('button', { name: 'Ver links ativos do funcionário' }));
    await waitFor(() => expect(listed).toBe(1));
    fireEvent.change(document.getElementById('ficha-status')!, { target: { value: 'assinada' } });
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Pendente')).toBeNull());
    expect(screen.getByRole('button', { name: 'Ver links ativos do funcionário' })).toBeInTheDocument();
    fireEvent.change(document.getElementById('ficha-status')!, { target: { value: '' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar assinatura presencial' }));
    const dlg = screen.getByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText('Nome da testemunha'), { target: { value: 'Maria Souza' } });
    fireEvent.change(within(dlg).getByLabelText('Motivo'), { target: { value: 'Funcionário sem celular' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Registrar assinatura presencial' }));
    await waitFor(() => expect(listed).toBe(2));
  });

  it('CNPJ aparece formatado mesmo vindo só com dígitos', async () => {
    setup({ ficha: () => res(ficha({ company: { name: 'Alfa', trade_name: null, cnpj: '12345678000195', address: 'x' } })) });
    render(<EpiFichasView />);
    await pick();
    expect(await screen.findByText('12.345.678/0001-95')).toBeInTheDocument();
  });
});
