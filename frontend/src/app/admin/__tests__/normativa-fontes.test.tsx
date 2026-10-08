import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// Router estável (como o real do Next): a página tem `[router]` nas deps do efeito de carga.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminNormativaPage from '../normativa/page';

const ok = (corpo: unknown) => ({ ok: true, json: async () => corpo });
const FALHA = (extra: object = {}) => ({ ok: false, json: async () => ({ message: ['URL inválida'], ...extra }) });
const agora = new Date().toISOString();

const FONTES = [
  { id: 's1', entity: 'MTE', code: 'NR-06', title: 'EPI', official_url: 'https://www.gov.br/nr06.pdf', active: true, last_checked_at: agora, last_check_status: 'ok', last_error: null, consecutive_failures: 0 },
  { id: 's2', entity: 'INSS', code: null, title: 'Portal quebrado', official_url: 'https://portal.exemplo.gov.br/', active: true, last_checked_at: agora, last_check_status: 'erro', last_error: 'timeout', consecutive_failures: 3 },
  { id: 's3', entity: 'CJF', code: 'TNU', title: 'Fonte desativada', official_url: 'https://www.cjf.jus.br/x', active: false, last_checked_at: null, last_check_status: null, last_error: null, consecutive_failures: 0 },
  { id: 's4', entity: 'MTE', code: 'NR-99', title: 'Nunca vista', official_url: 'https://www.gov.br/nr99', active: true, last_checked_at: null, last_check_status: null, last_error: null, consecutive_failures: 0 },
];

let fetchMock: ReturnType<typeof vi.fn>;
let respostas: Record<string, unknown>;
const chamadas = (url: string, metodo: string) => fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? 'GET') === metodo);
const linha = (texto: string) => screen.getByText(texto).closest('tr') as HTMLElement;

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  respostas = {};
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${url}`;
    if (respostas[chave]) return respostas[chave];
    if (chave === 'GET /api/normative-sources') return ok(FONTES);
    if (chave.startsWith('GET /api/normative-documents')) return ok([]);
    return ok({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/normativa — Fontes monitoradas', () => {
  it('mostra uma tabela com o estado de cada fonte', async () => {
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    expect(screen.getByRole('table')).toHaveClass('adm-table');
    expect(within(linha('Portal quebrado')).getByText('Falhando (3)').closest('span.rounded-full')).not.toBeNull();
    expect(within(linha('Portal quebrado')).getByText('timeout')).toHaveAttribute('title', 'timeout');
    expect(within(linha('Fonte desativada')).getByText('Inativa')).toBeInTheDocument();
    expect(within(linha('Nunca vista')).getByText('Nunca verificada')).toBeInTheDocument();
    expect(within(linha('EPI')).getByText('ok')).toBeInTheDocument();
  });

  it('o filtro "só fontes com problema" esconde as saudáveis (falhando ou inativa continuam)', async () => {
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.click(screen.getByLabelText(/Mostrar só fontes com problema/));
    expect(screen.queryByText('EPI')).toBeNull();
    expect(screen.queryByText('Nunca vista')).toBeNull();
    expect(screen.getByText('Portal quebrado')).toBeInTheDocument();
    expect(screen.getByText('Fonte desativada')).toBeInTheDocument();
  });

  it('Verificar agora: POST check-now, mostra o resultado na linha e recarrega a lista', async () => {
    respostas['POST /api/normative-sources/s2/check-now'] = ok({ outcome: 'nova_versao', message: 'Nova versão detectada: veja em "Aguardando validação".' });
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    const antes = chamadas('/api/normative-sources', 'GET').length;
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Verificar agora/ }));
    expect(await screen.findByText(/Nova versão detectada/)).toBeInTheDocument();
    expect(chamadas('/api/normative-sources/s2/check-now', 'POST')).toHaveLength(1);
    await waitFor(() => expect(chamadas('/api/normative-sources', 'GET').length).toBeGreaterThan(antes));
  });

  it('Verificar agora com erro da fonte mostra a mensagem', async () => {
    respostas['POST /api/normative-sources/s2/check-now'] = ok({ outcome: 'erro', message: 'Fonte respondeu status 403' });
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Verificar agora/ }));
    expect(await screen.findByText(/Falhou: Fonte respondeu status 403/)).toBeInTheDocument();
  });

  it('Desativar envia PATCH {active:false}; Reativar envia {active:true}', async () => {
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Desativar/ }));
    await waitFor(() => expect(chamadas('/api/normative-sources/s2', 'PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-sources/s2', 'PATCH')[0][1].body)).toEqual({ active: false });
    fireEvent.click(within(linha('Fonte desativada')).getByRole('button', { name: /Reativar/ }));
    await waitFor(() => expect(chamadas('/api/normative-sources/s3', 'PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-sources/s3', 'PATCH')[0][1].body)).toEqual({ active: true });
  });

  it('Editar: abre o formulário preenchido e salva só com PATCH dos 4 campos', async () => {
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Editar/ }));
    const url = await screen.findByLabelText('URL oficial (edição)');
    expect(url).toHaveValue('https://portal.exemplo.gov.br/');
    fireEvent.change(url, { target: { value: 'https://www.gov.br/nova-norma.pdf' } });
    fireEvent.change(screen.getByLabelText('Título (edição)'), { target: { value: 'Norma certa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));
    await waitFor(() => expect(chamadas('/api/normative-sources/s2', 'PATCH')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-sources/s2', 'PATCH')[0][1].body)).toEqual({
      entity: 'INSS',
      code: '',
      title: 'Norma certa',
      official_url: 'https://www.gov.br/nova-norma.pdf',
    });
  });

  it('erro da API na edição aparece e o formulário continua aberto', async () => {
    respostas['PATCH /api/normative-sources/s2'] = FALHA({ message: ['A URL aponta para um endereço não público'] });
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Editar/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar edição' }));
    expect(await screen.findByText(/endereço não público/)).toBeInTheDocument();
    expect(screen.getByLabelText('URL oficial (edição)')).toBeInTheDocument();
  });

  it('Testar URL no cadastro: mostra a leitura, o aviso de extração suspeita e a fonte duplicada', async () => {
    respostas['POST /api/normative-sources/preview'] = ok({
      ok: true, status_code: 200, mime_type: 'text/html', chars: 120, meaningful_chars: 80, sample: 'Texto de exemplo da página',
      suspicious: 'Conteúdo suspeito: o texto extraído tem 80 caracteres', duplicate_of: { id: 's1', title: 'EPI', code: 'NR-06' },
    });
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.change(screen.getByPlaceholderText('URL oficial'), { target: { value: 'https://www.gov.br/nr06.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Testar URL' }));
    expect(await screen.findByText(/Leitura OK · HTTP 200 · text\/html · 120 caracteres \(80 de texto\)/)).toBeInTheDocument();
    expect(screen.getByText(/Conteúdo suspeito/)).toBeInTheDocument();
    expect(screen.getByText(/já existe a fonte “NR-06 — EPI” com esta URL/)).toBeInTheDocument();
    expect(JSON.parse(chamadas('/api/normative-sources/preview', 'POST')[0][1].body)).toEqual({ official_url: 'https://www.gov.br/nr06.pdf' });
  });

  it('edição: o aviso de URL duplicada não aparece quando a duplicada é a própria fonte', async () => {
    respostas['POST /api/normative-sources/preview'] = ok({
      ok: true, status_code: 200, mime_type: 'text/html', chars: 120, meaningful_chars: 120, sample: 'Texto', suspicious: null,
      duplicate_of: { id: 's2', title: 'Portal quebrado', code: null },
    });
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Editar/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Testar URL (edição)' }));
    expect(await screen.findByText(/Leitura OK/)).toBeInTheDocument();
    expect(screen.queryByText(/já existe a fonte/)).toBeNull();
  });

  it('cadastro gravado mas recarregamento da lista rejeitando: sem mensagem de falha e formulário limpo', async () => {
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/normative-sources' && (init?.method ?? 'GET') === 'GET') throw new Error('rede');
      return base(url, init);
    });
    fireEvent.change(screen.getByPlaceholderText('Entidade (ex: MTE)'), { target: { value: 'MTE' } });
    fireEvent.change(screen.getByPlaceholderText('Título'), { target: { value: 'NR nova' } });
    fireEvent.change(screen.getByPlaceholderText('URL oficial'), { target: { value: 'https://www.gov.br/nr-nova.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar fonte' }));
    await waitFor(() => expect(chamadas('/api/normative-sources', 'POST')).toHaveLength(1));
    await waitFor(() => expect(screen.getByPlaceholderText('Título')).toHaveValue(''));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u, i]) => u === '/api/normative-sources' && (i?.method ?? 'GET') === 'GET').length).toBeGreaterThan(1));
    expect(screen.queryByText(/Não foi possível cadastrar/)).toBeNull();
    expect(screen.queryByText('Não foi possível conectar ao servidor.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cadastrar fonte' })).not.toBeDisabled();
  });

  it('desativar gravado mas recarregamento rejeitando: sem mensagem de erro na linha', async () => {
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/normative-sources' && (init?.method ?? 'GET') === 'GET') throw new Error('rede');
      return base(url, init);
    });
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Desativar/ }));
    await waitFor(() => expect(chamadas('/api/normative-sources/s2', 'PATCH')).toHaveLength(1));
    await waitFor(() => expect(within(linha('Portal quebrado')).getByRole('button', { name: /Desativar/ })).not.toBeDisabled());
    expect(screen.queryByText('Não foi possível conectar ao servidor.')).toBeNull();
    expect(screen.queryByText(/Não foi possível alterar/)).toBeNull();
  });

  it('reenviar a edição limpa o erro anterior', async () => {
    respostas['PATCH /api/normative-sources/s2'] = FALHA({ message: ['A URL aponta para um endereço não público'] });
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Editar/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar edição' }));
    expect(await screen.findByText(/endereço não público/)).toBeInTheDocument();
    delete respostas['PATCH /api/normative-sources/s2'];
    fireEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));
    await waitFor(() => expect(screen.queryByText(/endereço não público/)).toBeNull());
  });

  it('Testar URL com falha de leitura mostra o motivo', async () => {
    respostas['POST /api/normative-sources/preview'] = ok({ ok: false, message: 'Fonte respondeu status 403', duplicate_of: null });
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.change(screen.getByPlaceholderText('URL oficial'), { target: { value: 'https://www.stf.jus.br/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Testar URL' }));
    expect(await screen.findByText(/Não foi possível ler a URL: Fonte respondeu status 403/)).toBeInTheDocument();
  });

  it('o cadastro continua enviando o mesmo POST', async () => {
    render(<AdminNormativaPage />);
    fireEvent.change(await screen.findByPlaceholderText('Entidade (ex: MTE)'), { target: { value: 'MTE' } });
    fireEvent.change(screen.getByPlaceholderText('Título'), { target: { value: 'NR nova' } });
    fireEvent.change(screen.getByPlaceholderText('URL oficial'), { target: { value: 'https://www.gov.br/nr-nova.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar fonte' }));
    await waitFor(() => expect(chamadas('/api/normative-sources', 'POST')).toHaveLength(1));
    expect(JSON.parse(chamadas('/api/normative-sources', 'POST')[0][1].body)).toEqual({
      entity: 'MTE',
      title: 'NR nova',
      official_url: 'https://www.gov.br/nr-nova.pdf',
    });
  });

  it('fetch que rejeita não trava cadastro, edição nem desativar', async () => {
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') return base(url, init);
      throw new Error('rede');
    });
    fireEvent.change(screen.getByPlaceholderText('Entidade (ex: MTE)'), { target: { value: 'MTE' } });
    fireEvent.change(screen.getByPlaceholderText('Título'), { target: { value: 'X' } });
    fireEvent.change(screen.getByPlaceholderText('URL oficial'), { target: { value: 'https://www.gov.br/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar fonte' }));
    expect(await screen.findByText(/Não foi possível cadastrar. Não foi possível conectar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadastrar fonte' })).not.toBeDisabled();

    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Desativar/ }));
    expect(await within(linha('Portal quebrado')).findByText('Não foi possível conectar ao servidor.')).toBeInTheDocument();
    expect(within(linha('Portal quebrado')).getByRole('button', { name: /Desativar/ })).not.toBeDisabled();

    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Editar/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar edição' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conectar ao servidor.');
    expect(screen.getByRole('button', { name: 'Salvar edição' })).not.toBeDisabled();
  });

  it('resposta atrasada do preview da linha anterior não aparece após abrir outra edição', async () => {
    let liberar: (v: unknown) => void = () => {};
    respostas['POST /api/normative-sources/preview'] = new Promise((r) => { liberar = r; });
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/api/normative-sources/preview' ? respostas['POST /api/normative-sources/preview'] : base(url, init));
    render(<AdminNormativaPage />);
    await screen.findByText('Portal quebrado');
    fireEvent.click(within(linha('Portal quebrado')).getByRole('button', { name: /Editar/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Testar URL (edição)' }));
    fireEvent.click(within(linha('Nunca vista')).getByRole('button', { name: /Editar/ }));
    liberar(ok({ ok: true, status_code: 200, mime_type: 'text/html', chars: 9, meaningful_chars: 9, sample: 'antigo', duplicate_of: null }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/Leitura OK/)).toBeNull();
  });
});
