import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import DocumentosFluxoPage from '../documentos-fluxo/page';
import { ADMIN_NAV } from '@/components/admin/nav';

const BASE = '/api/atuacao/admin/documentos';
const NUMERO = '0000';

const SOCIOS = [
  { id: 'u1', nome: 'Ana Souza' },
  { id: 'u2', nome: 'Bruno Lima' },
];

const VIABILIDADE = [
  {
    category: 'pgr', status: 'viavel', faltas: [], avisos: ['Sem revisor diferente do elaborador: devolver à elaboração ficará indisponível.'],
    habilitados: [
      { acao: 'elaborar', pessoas: [{ id: 'u1', nome: 'Ana Souza' }] },
      { acao: 'revisar', pessoas: [] },
      { acao: 'aprovar', pessoas: [{ id: 'u2', nome: 'Bruno Lima' }] },
      { acao: 'assinar', pessoas: [{ id: 'u2', nome: 'Bruno Lima', registro_confirmado: true }] },
      { acao: 'publicar', pessoas: [{ id: 'u2', nome: 'Bruno Lima' }] },
    ],
  },
  {
    category: 'pcmso', status: 'inviavel', faltas: ['Ninguém habilitado a assinar com registro profissional confirmado.'], avisos: [],
    habilitados: [
      { acao: 'elaborar', pessoas: [{ id: 'u1', nome: 'Ana Souza' }] },
      { acao: 'revisar', pessoas: [] },
      { acao: 'aprovar', pessoas: [{ id: 'u2', nome: 'Bruno Lima' }] },
      { acao: 'assinar', pessoas: [{ id: 'u2', nome: 'Bruno Lima', registro_confirmado: false }] },
      { acao: 'publicar', pessoas: [{ id: 'u2', nome: 'Bruno Lima' }] },
    ],
  },
  {
    category: 'laudo', status: 'nao_configurada', faltas: [], avisos: [],
    habilitados: ['elaborar', 'revisar', 'aprovar', 'assinar', 'publicar'].map((acao) => ({ acao, pessoas: [] })),
  },
];

const MATRIZ_PGR = [{ category: 'pgr', user_id: 'u1', nome: 'Ana Souza', acoes: ['elaborar', 'revisar'] }];

const REGISTROS = [
  { id: 'r1', user_id: 'u1', nome: 'Ana Souza', council: 'TESTE', registration_number: NUMERO, uf: 'SP', status: 'pendente', confirmed_at: null, revoked_at: null },
  { id: 'r2', user_id: 'u2', nome: 'Bruno Lima', council: 'TESTE', registration_number: '1111', uf: 'RJ', status: 'confirmado', confirmed_at: '2026-10-01T00:00:00Z', revoked_at: null },
  { id: 'r3', user_id: 'u2', nome: 'Bruno Lima', council: 'TESTE', registration_number: '2222', uf: 'MG', status: 'revogado', confirmed_at: null, revoked_at: '2026-10-02T00:00:00Z' },
];

type Resp = { status: number; body: unknown };
const resp = (status: number, body: unknown): Resp => ({ status, body });
const toResponse = (r: Resp) => ({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body });

let fetchMock: ReturnType<typeof vi.fn>;
// Respostas por "METODO caminho" (caminho sem o prefixo BASE); função permite sequências/atrasos.
let rotas: Record<string, (init?: RequestInit) => Resp | Promise<Resp>>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];

const chamadas = (metodo: string, caminho: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === `${BASE}${caminho}` && (init?.method ?? 'GET') === metodo);

beforeEach(() => {
  localStorage.setItem('montese_token', 'tok');
  rotas = {
    'GET /socios': () => resp(200, SOCIOS),
    'GET /viabilidade': () => resp(200, VIABILIDADE),
    'GET /matriz?category=pgr': () => resp(200, MATRIZ_PGR),
    'GET /matriz?category=pcmso': () => resp(200, []),
    'GET /registros': () => resp(200, REGISTROS),
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${String(url).replace(BASE, '')}`;
    const h = rotas[chave];
    if (!h) throw new Error(`rota não simulada: ${chave}`);
    return toResponse(await h(init));
  });
  vi.stubGlobal('fetch', fetchMock);
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  vi.unstubAllGlobals();
  consoleSpies.forEach((s) => s.mockRestore());
  localStorage.clear();
});

const secao = (nome: string) => screen.getByRole('heading', { level: 3, name: nome }).closest('section') as HTMLElement;

async function abrirPagina() {
  render(<DocumentosFluxoPage />);
  await screen.findByRole('article', { name: 'PGR' });
  await screen.findByRole('checkbox', { name: 'Elaborar: Ana Souza' });
  await screen.findByRole('button', { name: /^Confirmar registro de Ana Souza/ });
}

describe('estrutura e avisos', () => {
  it('título, aviso permanente e três seções em cartões .adm-card', async () => {
    await abrirPagina();
    expect(screen.getByRole('heading', { level: 2, name: 'Documentos — responsabilidades' })).toBeInTheDocument();
    expect(screen.getAllByText('A habilitação não comprova competência profissional.').length).toBeGreaterThan(0);
    for (const nome of ['Viabilidade por tipo de documento', 'Responsabilidades por tipo de documento', 'Registros profissionais']) {
      expect(secao(nome)).toHaveClass('adm-card');
    }
  });

  it('o menu do admin tem UM item novo no grupo Sistema', () => {
    const sistema = ADMIN_NAV.find((g) => g.label === 'Sistema')!;
    const item = sistema.items.filter((i) => i.href === '/admin/documentos-fluxo');
    expect(item).toHaveLength(1);
    expect(item[0].label).toBe('Documentos — responsabilidades');
  });

  it('nenhuma ação do fluxo (elaborar/revisar/aprovar/assinar/publicar) como botão ou link', async () => {
    await abrirPagina();
    const acao = /^(elaborar|revisar|aprovar|assinar|publicar)\b/i;
    for (const el of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]) {
      expect(el.textContent?.trim() ?? '').not.toMatch(acao);
      expect(el.getAttribute('aria-label') ?? '').not.toMatch(acao);
    }
  });

  it('o DOM não contém os termos proibidos', async () => {
    await abrirPagina();
    expect(document.body.textContent).not.toMatch(/assinatura digital|icp-?brasil/i);
  });

  it('o código-fonte da página e dos componentes não contém os termos proibidos', () => {
    const dir = join(process.cwd(), 'src/app/admin/documentos-fluxo');
    for (const f of readdirSync(dir)) {
      expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(/assinatura digital|icp-?brasil/i);
    }
  });
});

describe('viabilidade', () => {
  it('um cartão por categoria com o estado em texto, faltas, avisos e habilitados por ação', async () => {
    await abrirPagina();
    const pgr = screen.getByRole('article', { name: 'PGR' });
    expect(within(pgr).getByText('Viável')).toBeInTheDocument();
    expect(within(pgr).getByText(/devolver à elaboração ficará indisponível/)).toBeInTheDocument();
    expect(within(pgr).getByText('Ana Souza')).toBeInTheDocument();
    expect(within(pgr).getByText(/Bruno Lima.*registro confirmado/)).toBeInTheDocument();

    const pcmso = screen.getByRole('article', { name: 'PCMSO' });
    expect(within(pcmso).getByText('Inviável')).toBeInTheDocument();
    expect(within(pcmso).getByText('Ninguém habilitado a assinar com registro profissional confirmado.')).toBeInTheDocument();
    expect(within(pcmso).getByText(/Bruno Lima.*sem registro confirmado/)).toBeInTheDocument();

    const laudo = screen.getByRole('article', { name: 'Laudo' });
    expect(within(laudo).getByText('Não configurada')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('falha da viabilidade fica isolada: matriz e registros continuam utilizáveis', async () => {
    rotas['GET /viabilidade'] = () => resp(500, { message: 'x' });
    render(<DocumentosFluxoPage />);
    const alerta = await within(secao('Viabilidade por tipo de documento')).findByRole('alert');
    expect(alerta).toHaveTextContent('Não foi possível carregar');
    expect(await screen.findByRole('checkbox', { name: 'Elaborar: Ana Souza' })).toBeInTheDocument();
    expect(within(secao('Registros profissionais')).getByRole('button', { name: /Confirmar registro de Ana Souza/ })).toBeInTheDocument();
  });

  it('lista vazia mostra estado vazio', async () => {
    rotas['GET /viabilidade'] = () => resp(200, []);
    render(<DocumentosFluxoPage />);
    expect(await screen.findByText('Nenhum tipo de documento retornado.')).toBeInTheDocument();
  });
});

describe('matriz', () => {
  it('seletor de categoria e tabela sócios × 5 ações com checkboxes rotulados e cabeçalhos', async () => {
    await abrirPagina();
    const s = secao('Responsabilidades por tipo de documento');
    expect(within(s).getByLabelText('Tipo de documento')).toHaveValue('pgr');
    const tabela = within(s).getByRole('table');
    for (const col of ['Sócio', 'Elaborar', 'Revisar', 'Aprovar', 'Assinar', 'Publicar']) {
      expect(within(tabela).getByRole('columnheader', { name: col })).toBeInTheDocument();
    }
    expect(within(tabela).getByRole('rowheader', { name: 'Ana Souza' })).toBeInTheDocument();
    expect(within(tabela).getAllByRole('checkbox')).toHaveLength(10);
    expect(screen.getByRole('checkbox', { name: 'Elaborar: Ana Souza' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Revisar: Ana Souza' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Aprovar: Ana Souza' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Elaborar: Bruno Lima' })).not.toBeChecked();
  });

  it('trocar a categoria busca a matriz da nova categoria; resposta atrasada da anterior não sobrescreve', async () => {
    let liberar!: (r: Resp) => void;
    rotas['GET /matriz?category=pgr'] = () => resp(200, MATRIZ_PGR);
    await abrirPagina();
    rotas['GET /matriz?category=pcmso'] = () => new Promise<Resp>((res) => { liberar = res; });
    rotas['GET /matriz?category=laudo'] = () => resp(200, []);
    fireEvent.change(screen.getByLabelText('Tipo de documento'), { target: { value: 'pcmso' } });
    fireEvent.change(screen.getByLabelText('Tipo de documento'), { target: { value: 'laudo' } });
    await waitFor(() => expect(chamadas('GET', '/matriz?category=laudo')).toHaveLength(1));
    await act(async () => { liberar(resp(200, [{ category: 'pcmso', user_id: 'u2', nome: 'Bruno Lima', acoes: ['publicar'] }])); });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Publicar: Bruno Lima' })).not.toBeChecked());
    expect(screen.getByRole('checkbox', { name: 'Elaborar: Ana Souza' })).not.toBeChecked();
  });

  it('Salvar abre o diálogo com o texto obrigatório; PUT só com as ações marcadas; sucesso em status e recarrega a viabilidade', async () => {
    rotas['PUT /matriz/pgr/usuarios/u2'] = () => resp(200, { category: 'pgr', user_id: 'u2', acoes: ['aprovar', 'publicar'] });
    await abrirPagina();
    expect(chamadas('GET', '/viabilidade')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Aprovar: Bruno Lima' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Publicar: Bruno Lima' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar responsabilidades de Bruno Lima' }));

    const dlg = await screen.findByRole('dialog');
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    expect(within(dlg).getByText('Habilitar uma ação autoriza esta pessoa a executá-la neste tipo de documento. Isto não comprova competência profissional; confirme com o responsável técnico.')).toBeInTheDocument();
    expect(chamadas('PUT', '/matriz/pgr/usuarios/u2')).toHaveLength(0);

    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar e salvar' }));
    await waitFor(() => expect(chamadas('PUT', '/matriz/pgr/usuarios/u2')).toHaveLength(1));
    const [, init] = chamadas('PUT', '/matriz/pgr/usuarios/u2')[0];
    expect(JSON.parse(init!.body as string)).toEqual({ acoes: ['aprovar', 'publicar'] });
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect((init!.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Responsabilidades de Bruno Lima salvas para PGR.');
    await waitFor(() => expect(chamadas('GET', '/viabilidade')).toHaveLength(2));
  });

  it('desmarcar tudo envia acoes vazio', async () => {
    rotas['PUT /matriz/pgr/usuarios/u1'] = () => resp(200, { category: 'pgr', user_id: 'u1', acoes: [] });
    await abrirPagina();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Elaborar: Ana Souza' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Revisar: Ana Souza' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar responsabilidades de Ana Souza' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar e salvar' }));
    await waitFor(() => expect(chamadas('PUT', '/matriz/pgr/usuarios/u1')).toHaveLength(1));
    expect(JSON.parse(chamadas('PUT', '/matriz/pgr/usuarios/u1')[0][1]!.body as string)).toEqual({ acoes: [] });
  });

  it.each([
    [400, { message: ['acoes inválidas'] }, 'acoes inválidas'],
    [403, { message: 'Operação não permitida para este recurso' }, 'Operação não permitida para este recurso'],
    [404, { message: 'Categoria não encontrada' }, 'Categoria não encontrada'],
  ])('erro %i aparece em role=alert mantendo o diálogo aberto', async (status, body, texto) => {
    rotas['PUT /matriz/pgr/usuarios/u1'] = () => resp(status, body);
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar responsabilidades de Ana Souza' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar e salvar' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent(texto);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Confirmar e salvar' })).not.toBeDisabled();
    expect(chamadas('GET', '/viabilidade')).toHaveLength(1);
  });

  it('durante a requisição os botões ficam desabilitados e o clique duplo gera um único PUT; Esc não fecha', async () => {
    let liberar!: (r: Resp) => void;
    rotas['PUT /matriz/pgr/usuarios/u1'] = () => new Promise<Resp>((res) => { liberar = res; });
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar responsabilidades de Ana Souza' }));
    const dlg = await screen.findByRole('dialog');
    const confirmar = within(dlg).getByRole('button', { name: 'Confirmar e salvar' });
    fireEvent.click(confirmar);
    fireEvent.click(confirmar);
    await waitFor(() => expect(within(dlg).getByRole('button', { name: /Salvando/ })).toBeDisabled());
    expect(within(dlg).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(chamadas('PUT', '/matriz/pgr/usuarios/u1')).toHaveLength(1);
    await act(async () => { liberar(resp(200, { category: 'pgr', user_id: 'u1', acoes: ['elaborar', 'revisar'] })); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('diálogo: foco entra, fica preso, Esc fecha e o foco volta ao botão de origem', async () => {
    await abrirPagina();
    const abrir = screen.getByRole('button', { name: 'Salvar responsabilidades de Ana Souza' });
    abrir.focus();
    fireEvent.click(abrir);
    const dlg = await screen.findByRole('dialog');
    const confirmar = within(dlg).getByRole('button', { name: 'Confirmar e salvar' });
    const cancelar = within(dlg).getByRole('button', { name: 'Cancelar' });
    await waitFor(() => expect(dlg.contains(document.activeElement)).toBe(true));
    confirmar.focus();
    fireEvent.keyDown(dlg, { key: 'Tab' });
    expect(document.activeElement).toBe(cancelar);
    fireEvent.keyDown(dlg, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirmar);
    fireEvent.keyDown(dlg, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(abrir);
  });

  it('sócios vazios: estado vazio na matriz', async () => {
    rotas['GET /socios'] = () => resp(200, []);
    render(<DocumentosFluxoPage />);
    expect(await screen.findByText('Nenhum sócio cadastrado.')).toBeInTheDocument();
  });

  it('falha ao carregar a matriz fica isolada na seção', async () => {
    rotas['GET /matriz?category=pgr'] = () => resp(500, {});
    render(<DocumentosFluxoPage />);
    expect(await within(secao('Responsabilidades por tipo de documento')).findByRole('alert')).toHaveTextContent('Não foi possível carregar');
    expect(await screen.findByRole('article', { name: 'PGR' })).toBeInTheDocument();
  });
});

describe('registros', () => {
  it('lista sócio, conselho, número, UF e situação em texto; botões só nos estados aplicáveis', async () => {
    await abrirPagina();
    const s = secao('Registros profissionais');
    const tabela = within(s).getByRole('table');
    for (const col of ['Sócio', 'Conselho', 'Número', 'UF', 'Situação']) {
      expect(within(tabela).getByRole('columnheader', { name: col })).toBeInTheDocument();
    }
    const linhas = within(tabela).getAllByRole('row').slice(1);
    expect(linhas).toHaveLength(3);
    expect(within(linhas[0]).getByText(NUMERO)).toBeInTheDocument();
    expect(within(linhas[0]).getByText('Pendente')).toBeInTheDocument();
    expect(within(linhas[1]).getByText('Confirmado')).toBeInTheDocument();
    expect(within(linhas[2]).getByText('Revogado')).toBeInTheDocument();
    expect(within(linhas[0]).getByRole('button', { name: /^Confirmar registro de Ana Souza/ })).toBeInTheDocument();
    expect(within(linhas[0]).queryByRole('button', { name: /Revogar/ })).toBeNull();
    expect(within(linhas[1]).getByRole('button', { name: /^Revogar registro de Bruno Lima/ })).toBeInTheDocument();
    expect(within(linhas[1]).queryByRole('button', { name: /Confirmar/ })).toBeNull();
    expect(within(linhas[2]).queryAllByRole('button')).toHaveLength(0);
  });

  it('estado vazio', async () => {
    rotas['GET /registros'] = () => resp(200, []);
    render(<DocumentosFluxoPage />);
    expect(await screen.findByText('Nenhum registro profissional cadastrado.')).toBeInTheDocument();
  });

  it('falha ao carregar a lista fica isolada na seção', async () => {
    rotas['GET /registros'] = () => resp(500, {});
    render(<DocumentosFluxoPage />);
    expect(await within(secao('Registros profissionais')).findByRole('alert')).toHaveTextContent('Não foi possível carregar');
    expect(await screen.findByRole('article', { name: 'PGR' })).toBeInTheDocument();
  });

  const preencher = (campos: { socio?: string; conselho?: string; numero?: string; uf?: string }) => {
    if (campos.socio !== undefined) fireEvent.change(screen.getByLabelText('Sócio'), { target: { value: campos.socio } });
    if (campos.conselho !== undefined) fireEvent.change(screen.getByLabelText('Conselho'), { target: { value: campos.conselho } });
    if (campos.numero !== undefined) fireEvent.change(screen.getByLabelText('Número do registro'), { target: { value: campos.numero } });
    if (campos.uf !== undefined) fireEvent.change(screen.getByLabelText('UF'), { target: { value: campos.uf } });
  };

  it('valida antes de enviar (nada é enviado e o erro não contém o número)', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar registro' }));
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Selecione o sócio.');
    expect(alerta).toHaveTextContent('Informe o conselho (2 a 20 caracteres).');
    expect(alerta).toHaveTextContent('Informe o número do registro (1 a 30 caracteres).');
    expect(alerta).toHaveTextContent('Informe a UF com 2 letras maiúsculas.');

    preencher({ socio: 'u1', conselho: 'T', numero: NUMERO, uf: 'S' });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar registro' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o conselho (2 a 20 caracteres).');
    expect(screen.getByRole('alert')).not.toHaveTextContent(NUMERO);
    preencher({ conselho: 'T'.repeat(21), uf: 'SP', numero: 'N'.repeat(31) });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar registro' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o conselho');
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o número do registro');
    expect(chamadas('POST', '/registros')).toHaveLength(0);
  });

  it('UF é convertida para maiúsculas e limitada a 2 letras', async () => {
    await abrirPagina();
    preencher({ uf: 'sp1' });
    expect(screen.getByLabelText('UF')).toHaveValue('SP');
  });

  it('cadastra com POST (valores aparados), mostra sucesso em status e recarrega a lista', async () => {
    rotas['POST /registros'] = () => resp(201, { ...REGISTROS[0], id: 'r9' });
    await abrirPagina();
    preencher({ socio: 'u1', conselho: ' TESTE ', numero: ` ${NUMERO} `, uf: 'SP' });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar registro' }));
    await waitFor(() => expect(chamadas('POST', '/registros')).toHaveLength(1));
    expect(JSON.parse(chamadas('POST', '/registros')[0][1]!.body as string)).toEqual({
      user_id: 'u1', council: 'TESTE', registration_number: NUMERO, uf: 'SP',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Registro cadastrado');
    await waitFor(() => expect(chamadas('GET', '/registros')).toHaveLength(2));
    expect(screen.getByLabelText('Número do registro')).toHaveValue('');
  });

  it('duplicata (409): mostra a mensagem do servidor em role=alert, sem o número, mantendo os campos', async () => {
    rotas['POST /registros'] = () => resp(409, { message: 'Registro duplicado' });
    await abrirPagina();
    preencher({ socio: 'u1', conselho: 'TESTE', numero: NUMERO, uf: 'SP' });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar registro' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Registro duplicado');
    expect(alerta).not.toHaveTextContent(NUMERO);
    expect(screen.getByLabelText('Número do registro')).toHaveValue(NUMERO);
  });

  it('o número do registro nunca vai à URL nem ao console, nem em erros', async () => {
    rotas['POST /registros'] = () => resp(400, { message: ['council must be longer'] });
    await abrirPagina();
    preencher({ socio: 'u1', conselho: 'TESTE', numero: NUMERO, uf: 'SP' });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar registro' }));
    await screen.findByRole('alert');
    for (const [u] of fetchMock.mock.calls) expect(String(u)).not.toContain(NUMERO);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    for (const a of screen.queryAllByRole('alert')) expect(a).not.toHaveTextContent(NUMERO);
  });

  it('Confirmar: diálogo com o texto obrigatório, POST sem número na URL, sucesso e recarrega lista e viabilidade', async () => {
    rotas['POST /registros/r1/confirmar'] = () => resp(201, { id: 'r1', user_id: 'u1', status: 'confirmado' });
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /^Confirmar registro de Ana Souza/ }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('Confirme que o conselho, o número e a UF foram conferidos em fonte oficial do conselho profissional.')).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar registro' }));
    await waitFor(() => expect(chamadas('POST', '/registros/r1/confirmar')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Registro confirmado');
    await waitFor(() => expect(chamadas('GET', '/registros')).toHaveLength(2));
    expect(chamadas('GET', '/viabilidade')).toHaveLength(2);
  });

  it('Revogar: diálogo com o texto obrigatório e POST de revogação', async () => {
    rotas['POST /registros/r2/revogar'] = () => resp(201, { id: 'r2', user_id: 'u2', status: 'revogado' });
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /^Revogar registro de Bruno Lima/ }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('A revogação impede novas assinaturas com este registro. Assinaturas já registradas permanecem no histórico.')).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Revogar registro' }));
    await waitFor(() => expect(chamadas('POST', '/registros/r2/revogar')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Registro revogado');
    expect(chamadas('GET', '/viabilidade')).toHaveLength(2);
  });

  it('409 ao confirmar/revogar: mensagem do servidor no diálogo, que permanece aberto', async () => {
    rotas['POST /registros/r1/confirmar'] = () => resp(409, { message: 'Registro já confirmado' });
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /^Confirmar registro de Ana Souza/ }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar registro' }));
    const alerta = await within(dlg).findByRole('alert');
    expect(alerta).toHaveTextContent('Registro já confirmado');
    expect(alerta).not.toHaveTextContent(NUMERO);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Cancelar fecha sem enviar', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /^Revogar registro de Bruno Lima/ }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(chamadas('POST', '/registros/r2/revogar')).toHaveLength(0);
  });
});

describe('sessão', () => {
  it('401 em qualquer leitura envia ao /login', async () => {
    const loc = { href: '/admin/documentos-fluxo' };
    vi.stubGlobal('location', loc);
    rotas['GET /viabilidade'] = () => resp(401, {});
    render(<DocumentosFluxoPage />);
    await waitFor(() => expect(loc.href).toBe('/login'));
  });

  it('401 em escrita envia ao /login', async () => {
    rotas['PUT /matriz/pgr/usuarios/u1'] = () => resp(401, {});
    await abrirPagina();
    const loc = { href: '/admin/documentos-fluxo' };
    vi.stubGlobal('location', loc);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar responsabilidades de Ana Souza' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar e salvar' }));
    await waitFor(() => expect(loc.href).toBe('/login'));
  });
});
