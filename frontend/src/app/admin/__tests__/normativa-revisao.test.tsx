import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminNormativaPage from '../normativa/page';

const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
const FALHA = (status: number, corpo: object) => ({ ok: false, status, json: async () => corpo });
const doc = (id: string, status: string, file_name: string) => ({
  id, source_id: 's1', status, file_name, detected_at: '2026-10-01T00:00:00Z', indexed_at: status === 'vigente' ? '2026-10-02T00:00:00Z' : null,
  rejection_reason: null,
});
const P1 = doc('d1', 'aguardando_validacao', 'nr06-v2.pdf');
const P2 = doc('d2', 'aguardando_validacao', 'nr07-v2.pdf');
const V1 = doc('v1', 'vigente', 'nr06-v1.pdf');
const DETALHE = { document: { ...P1, raw_text: 'Texto novo completo' }, previous_text: 'Texto anterior completo' };
const DIFF = {
  has_previous: true,
  summary: { added: 1, removed: 1, unchanged: 1 },
  truncated: false,
  hunks: [
    { kind: 'context', text: 'Parágrafo igual' },
    { kind: 'removed', text: 'Prazo de 30 dias' },
    { kind: 'added', text: 'Prazo de 60 dias' },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;
let respostas: Record<string, unknown>;
const chamadas = (url: string, metodo: string) => fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === metodo);

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  respostas = {};
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${url}`;
    const r = respostas[chave];
    if (r instanceof Error) throw r;
    if (r) return r;
    if (chave === 'GET /api/normative-sources') return ok([]);
    if (chave === 'GET /api/normative-documents?status=aguardando_validacao') return ok([P1, P2]);
    if (chave === 'GET /api/normative-documents?status=vigente') return ok([V1]);
    if (chave === 'GET /api/normative-documents/d1') return ok(DETALHE);
    if (chave === 'GET /api/normative-documents/d1/diff') return ok(DIFF);
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

async function revisar() {
  render(<AdminNormativaPage />);
  const botoes = await screen.findAllByRole('button', { name: 'Revisar' });
  fireEvent.click(botoes[0]);
  await screen.findByRole('heading', { level: 3, name: 'Revisar versão' });
}

describe('/admin/normativa — revisão com diff', () => {
  it('busca detalhe e diff, mostra o resumo e os trechos, e revela o lado a lado sob demanda', async () => {
    await revisar();
    expect(chamadas('/api/normative-documents/d1', 'GET')).toHaveLength(1);
    expect(chamadas('/api/normative-documents/d1/diff', 'GET')).toHaveLength(1);
    expect(await screen.findByText(/\+1 \/ −1 parágrafos/)).toBeInTheDocument();
    expect(screen.getByLabelText('Removido: Prazo de 30 dias').textContent).toContain('−');
    expect(screen.getByLabelText('Adicionado: Prazo de 60 dias').textContent).toContain('+');
    expect(screen.getByLabelText('Sem mudança: Parágrafo igual')).toBeInTheDocument();
    expect(screen.queryByText('Texto anterior')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ver texto completo lado a lado' }));
    expect(screen.getByText('Texto anterior')).toBeInTheDocument();
    expect(screen.getByText('Texto novo')).toBeInTheDocument();
    expect(screen.getByText('Texto novo completo')).toBeInTheDocument();
  });

  it('truncated mostra o aviso', async () => {
    respostas['GET /api/normative-documents/d1/diff'] = ok({ ...DIFF, truncated: true });
    await revisar();
    expect(await screen.findByText(/Mostrando só parte das mudanças/)).toBeInTheDocument();
  });

  it('sem versão anterior: só o texto novo e a frase, sem lista de trechos', async () => {
    respostas['GET /api/normative-documents/d1'] = ok({ ...DETALHE, previous_text: null });
    respostas['GET /api/normative-documents/d1/diff'] = ok({ has_previous: false, summary: { added: 0, removed: 0, unchanged: 0 }, truncated: false, hunks: [] });
    await revisar();
    expect(await screen.findByText('(nenhuma versão vigente anterior)')).toBeInTheDocument();
    expect(screen.getByText('Texto novo completo')).toBeInTheDocument();
    expect(screen.queryByText(/parágrafos/)).toBeNull();
    expect(screen.queryByRole('button', { name: /lado a lado/ })).toBeNull();
  });

  it.each([
    ['resposta não-ok', FALHA(500, { message: 'x' })],
    ['rejeição', new Error('rede')],
  ])('falha do diff (%s) cai no lado a lado e Aprovar/Rejeitar continuam funcionando', async (_n, resp) => {
    respostas['GET /api/normative-documents/d1/diff'] = resp;
    await revisar();
    expect(await screen.findByText('Texto anterior completo')).toBeInTheDocument();
    expect(screen.getByText('Texto novo completo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(chamadas('/api/normative-documents/d1/approve', 'POST')).toHaveLength(1));
    await revisar();
    fireEvent.change(screen.getByLabelText('Motivo da rejeição'), { target: { value: 'duplicado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rejeitar' }));
    await waitFor(() => expect(chamadas('/api/normative-documents/d1/reject', 'POST')).toHaveLength(1));
  });
});

describe('/admin/normativa — rejeição em lote', () => {
  const botaoLote = () => screen.getByRole('button', { name: /Rejeitar selecionados/ });

  it('só habilita com seleção e motivo, confirma e envia ids e motivo; sucesso recarrega e limpa', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AdminNormativaPage />);
    await screen.findByLabelText('Selecionar nr06-v2.pdf');
    expect(botaoLote()).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Selecionar todos'));
    expect(botaoLote()).toHaveTextContent('Rejeitar selecionados (2)');
    expect(botaoLote()).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Motivo da rejeição em lote'), { target: { value: 'fora do escopo' } });
    expect(botaoLote()).toBeEnabled();
    const antes = chamadas('/api/normative-documents?status=aguardando_validacao', 'GET').length;
    fireEvent.click(botaoLote());
    await waitFor(() => expect(chamadas('/api/normative-documents/reject-batch', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-documents/reject-batch', 'POST')[0][1].body)).toEqual({ ids: ['d1', 'd2'], reason: 'fora do escopo' });
    await waitFor(() => expect(chamadas('/api/normative-documents?status=aguardando_validacao', 'GET').length).toBeGreaterThan(antes));
    await waitFor(() => expect(botaoLote()).toHaveTextContent('Rejeitar selecionados (0)'));
    expect(screen.getByLabelText('Motivo da rejeição em lote')).toHaveValue('');
  });

  it('sem confirmação nada é enviado', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<AdminNormativaPage />);
    fireEvent.click(await screen.findByLabelText('Selecionar nr06-v2.pdf'));
    fireEvent.change(screen.getByLabelText('Motivo da rejeição em lote'), { target: { value: 'x' } });
    fireEvent.click(botaoLote());
    expect(chamadas('/api/normative-documents/reject-batch', 'POST')).toHaveLength(0);
  });

  it('erro 400 mostra a mensagem da API e mantém a seleção', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    respostas['POST /api/normative-documents/reject-batch'] = FALHA(400, { message: ['reason must be longer'] });
    render(<AdminNormativaPage />);
    fireEvent.click(await screen.findByLabelText('Selecionar nr06-v2.pdf'));
    fireEvent.change(screen.getByLabelText('Motivo da rejeição em lote'), { target: { value: 'x' } });
    fireEvent.click(botaoLote());
    expect(await screen.findByRole('alert')).toHaveTextContent('reason must be longer');
    expect(screen.getByLabelText('Selecionar nr06-v2.pdf')).toBeChecked();
    expect(botaoLote()).toHaveTextContent('(1)');
  });
});

describe('/admin/normativa — retirar vigente', () => {
  async function abrir() {
    render(<AdminNormativaPage />);
    fireEvent.click(await screen.findByLabelText('Retirar nr06-v1.pdf'));
    return screen.findByLabelText('Motivo da retirada');
  }

  it('exige motivo, confirma, envia {reason} e recarrega', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const campo = await abrir();
    expect(screen.getByRole('button', { name: 'Confirmar retirada' })).toBeDisabled();
    fireEvent.change(campo, { target: { value: 'revogada' } });
    const antes = chamadas('/api/normative-documents?status=vigente', 'GET').length;
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar retirada' }));
    await waitFor(() => expect(chamadas('/api/normative-documents/v1/retire', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-documents/v1/retire', 'POST')[0][1].body)).toEqual({ reason: 'revogada' });
    await waitFor(() => expect(chamadas('/api/normative-documents?status=vigente', 'GET').length).toBeGreaterThan(antes));
    await waitFor(() => expect(screen.queryByLabelText('Motivo da retirada')).toBeNull());
  });

  it('sem confirmação nada é enviado', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: 'revogada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar retirada' }));
    expect(chamadas('/api/normative-documents/v1/retire', 'POST')).toHaveLength(0);
  });

  it('erro da API aparece e o campo continua aberto', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    respostas['POST /api/normative-documents/v1/retire'] = FALHA(400, { message: 'Documento não está vigente' });
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: 'revogada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar retirada' }));
    expect(await screen.findByText('Documento não está vigente')).toBeInTheDocument();
    expect(screen.getByLabelText('Motivo da retirada')).toBeInTheDocument();
  });

  it('não quebra com vigente que traz rejection_reason "Retirada: ..."', async () => {
    respostas['GET /api/normative-documents?status=vigente'] = ok([{ ...V1, rejection_reason: 'Retirada: antiga' }]);
    render(<AdminNormativaPage />);
    expect(await screen.findByLabelText('Retirar nr06-v1.pdf')).toBeInTheDocument();
  });
});

describe('/admin/normativa — fix round 1', () => {
  it('abrir A (diff lento) e depois B: fica B, sem sobrescrever', async () => {
    let liberaA: (v: unknown) => void = () => {};
    const B = { ...P2 };
    respostas['GET /api/normative-documents/d1/diff'] = new Promise((r) => { liberaA = r; });
    respostas['GET /api/normative-documents/d2'] = ok({ document: { ...B, raw_text: 'Texto do B' }, previous_text: null });
    respostas['GET /api/normative-documents/d2/diff'] = ok({ has_previous: false, summary: { added: 0, removed: 0, unchanged: 0 }, truncated: false, hunks: [] });
    render(<AdminNormativaPage />);
    const botoes = await screen.findAllByRole('button', { name: 'Revisar' });
    fireEvent.click(botoes[0]);
    expect(await screen.findByText('Texto novo completo')).toBeInTheDocument();
    expect(screen.getByText('Calculando diferenças…')).toHaveAttribute('role', 'status');
    fireEvent.click(botoes[1]);
    expect(await screen.findByText('Texto do B')).toBeInTheDocument();
    liberaA(ok(DIFF));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('Texto do B')).toBeInTheDocument();
    expect(screen.queryByText(/\+1 \/ −1/)).toBeNull();
  });

  it('diff que nunca resolve não impede ver o detalhe nem Aprovar', async () => {
    respostas['GET /api/normative-documents/d1/diff'] = new Promise(() => {});
    await revisar();
    expect(screen.getByText('Texto novo completo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(chamadas('/api/normative-documents/d1/approve', 'POST')).toHaveLength(1));
  });

  it('retirada: aviso e nome do arquivo no confirm', async () => {
    const conf = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<AdminNormativaPage />);
    fireEvent.click(await screen.findByLabelText('Retirar nr06-v1.pdf'));
    expect(screen.getByText(/A fonte fica sem versão vigente até uma nova versão ser detectada e aprovada/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Motivo da retirada'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar retirada' }));
    expect(conf.mock.calls[0][0]).toContain('nr06-v1.pdf');
    expect(conf.mock.calls[0][0]).toContain('sem versão vigente');
    expect(await screen.findByText('Documento retirado do Assistente.')).toBeInTheDocument();
  });

  it('seleção: item que sai de pending após recarga não conta nem vai no POST', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const P3 = doc('d3', 'aguardando_validacao', 'nr08.pdf');
    respostas['GET /api/normative-documents?status=aguardando_validacao'] = ok([P1, P2, P3]);
    render(<AdminNormativaPage />);
    fireEvent.click(await screen.findByLabelText('Selecionar todos'));
    const botao = () => screen.getByRole('button', { name: /Rejeitar selecionados/ });
    expect(botao()).toHaveTextContent('(3)');
    fireEvent.change(screen.getByLabelText('Motivo da rejeição em lote'), { target: { value: 'x' } });
    // uma retirada força recarga; nela d3 já saiu de pendentes
    respostas['GET /api/normative-documents?status=aguardando_validacao'] = ok([P1, P2]);
    fireEvent.click(screen.getByLabelText('Retirar nr06-v1.pdf'));
    fireEvent.change(screen.getByLabelText('Motivo da retirada'), { target: { value: 'y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar retirada' }));
    await waitFor(() => expect(botao()).toHaveTextContent('(2)'));
    fireEvent.click(botao());
    await waitFor(() => expect(chamadas('/api/normative-documents/reject-batch', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-documents/reject-batch', 'POST')[0][1].body).ids).toEqual(['d1', 'd2']);
  });
});

describe('/admin/normativa — fix wave final', () => {
  it('detalhe de B falha: "Calculando diferenças…" de A some', async () => {
    respostas['GET /api/normative-documents/d1/diff'] = new Promise(() => {});
    respostas['GET /api/normative-documents/d2'] = FALHA(404, { message: 'nf' });
    render(<AdminNormativaPage />);
    const botoes = await screen.findAllByRole('button', { name: 'Revisar' });
    fireEvent.click(botoes[0]);
    expect(await screen.findByText('Calculando diferenças…')).toBeInTheDocument();
    fireEvent.click(botoes[1]);
    await waitFor(() => expect(screen.queryByText('Calculando diferenças…')).toBeNull());
    expect(screen.getByText('Não foi possível abrir o documento.')).toBeInTheDocument();
  });

  it('dois cliques rápidos em Rejeitar selecionados geram um único POST', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    respostas['POST /api/normative-documents/reject-batch'] = new Promise(() => {});
    render(<AdminNormativaPage />);
    fireEvent.click(await screen.findByLabelText('Selecionar nr06-v2.pdf'));
    fireEvent.change(screen.getByLabelText('Motivo da rejeição em lote'), { target: { value: 'x' } });
    const b = screen.getByRole('button', { name: /Rejeitar selecionados/ });
    fireEvent.click(b);
    fireEvent.click(b);
    expect(chamadas('/api/normative-documents/reject-batch', 'POST')).toHaveLength(1);
    expect(await screen.findByRole('button', { name: 'Rejeitando…' })).toBeDisabled();
  });
});
