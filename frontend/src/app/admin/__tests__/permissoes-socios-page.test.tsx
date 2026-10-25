import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import PermissoesSociosPage from '../permissoes-socios/page';
import { ADMIN_NAV } from '@/components/admin/nav';

const URL_BASE = '/api/atuacao/admin/permissoes';
const TEXTO_OBRIGATORIO =
  'Estas permissões autorizam ações técnicas sobre documentos. Isto não comprova competência profissional; a matriz de responsabilidades por tipo de documento continua obrigatória e vale por si só.';

const CATALOGO = {
  grupos: [
    { id: 'clientes', titulo: 'Clientes', itens: [
      { permissao: 'clients.read', rotulo: 'Ver clientes', descricao: 'Consulta a carteira de clientes.', sensivel: false },
    ] },
    { id: 'financeiro', titulo: 'Financeiro', itens: [
      { permissao: 'finance.read', rotulo: 'Ver financeiro', descricao: 'Somente leitura.', sensivel: false },
    ] },
    { id: 'documentos', titulo: 'Documentos', itens: [
      { permissao: 'documents.read', rotulo: 'Ver documentos', descricao: 'Lê documentos.', sensivel: false },
      { permissao: 'documents.approve', rotulo: 'Aprovar documentos', descricao: 'Aprova documentos.', sensivel: true },
    ] },
  ],
};
const SOCIOS = [
  { id: 'u1', nome: 'Ana Souza', permissoes: ['clients.read', 'documents.approve'], ativo: true },
  { id: 'u2', nome: 'Bruno Lima', permissoes: [], ativo: true },
];

type Resp = { status: number; body: unknown };
const resp = (status: number, body: unknown): Resp => ({ status, body });
const toResponse = (r: Resp) => ({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body });

let fetchMock: ReturnType<typeof vi.fn>;
let rotas: Record<string, (init?: RequestInit) => Resp | Promise<Resp>>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];
let dados: { catalogo: typeof CATALOGO; socios: typeof SOCIOS };

const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');

beforeEach(() => {
  localStorage.setItem('montese_token', 'tok');
  dados = { catalogo: CATALOGO, socios: SOCIOS };
  rotas = {
    'GET ': () => resp(200, dados),
    'PUT /u1': () => resp(200, { id: 'u1', nome: 'Ana Souza', permissoes: [], adicionadas: [], removidas: [] }),
    'PUT /u2': () => resp(200, { id: 'u2', nome: 'Bruno Lima', permissoes: [], adicionadas: [], removidas: [] }),
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${String(url).replace(URL_BASE, '')}`;
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

const cartao = (nome: string) => screen.getByRole('article', { name: nome });
const salvar = (nome: string) => screen.getByRole('button', { name: `Salvar permissões de ${nome}` });

async function abrir() {
  render(<PermissoesSociosPage />);
  await screen.findByRole('article', { name: 'Ana Souza' });
}

describe('estrutura', () => {
  it('título, um cartão por sócio, grupos em fieldset/legend e checkboxes com rótulo', async () => {
    await abrir();
    expect(screen.getByRole('heading', { level: 2, name: 'Permissões dos sócios' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    const ana = cartao('Ana Souza');
    expect(within(ana).getByRole('group', { name: 'Clientes' })).toBeInTheDocument();
    expect(within(ana).getByRole('group', { name: 'Documentos' })).toBeInTheDocument();
    expect(within(ana).getByRole('checkbox', { name: /Ver clientes/ })).toBeChecked();
    expect(within(ana).getByRole('checkbox', { name: /Ver documentos/ })).not.toBeChecked();
    expect(within(ana).getByText('Consulta a carteira de clientes.')).toBeInTheDocument();
  });

  it('sensíveis têm marcação em texto', async () => {
    await abrir();
    const ana = cartao('Ana Souza');
    expect(within(ana).getAllByText('Sensível — depende de competência profissional')).toHaveLength(1);
  });

  it('item novo único no grupo Sistema', () => {
    const sistema = ADMIN_NAV.find((g) => g.label === 'Sistema')!;
    const item = sistema.items.filter((i) => i.href === '/admin/permissoes-socios');
    expect(item).toHaveLength(1);
    expect(item[0].label).toBe('Permissões dos sócios');
  });

  it('não exibe e-mail nem termos proibidos; sem ação de documentos/financeiro', async () => {
    await abrir();
    expect(document.body.textContent).not.toMatch(/@|assinatura digital|icp-?brasil/i);
    for (const b of screen.getAllByRole('button')) {
      expect(b.textContent ?? '').toMatch(/^Salvar$/);
    }
  });

  it('código-fonte sem termos proibidos', () => {
    const dir = join(process.cwd(), 'src/app/admin/permissoes-socios');
    for (const f of readdirSync(dir)) {
      expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(/assinatura digital|icp-?brasil/i);
    }
  });
});

describe('estados', () => {
  it('vazio', async () => {
    dados = { catalogo: CATALOGO, socios: [] };
    render(<PermissoesSociosPage />);
    expect(await screen.findByText('Nenhum sócio ativo.')).toBeInTheDocument();
  });

  it('erro isolado com Tentar novamente', async () => {
    let n = 0;
    rotas['GET '] = () => (++n === 1 ? resp(500, {}) : resp(200, dados));
    render(<PermissoesSociosPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('article', { name: 'Ana Souza' })).toBeInTheDocument();
  });

  it('401 vai para /login', async () => {
    const original = window.location;
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true, configurable: true });
    rotas['GET '] = () => resp(401, {});
    render(<PermissoesSociosPage />);
    await waitFor(() => expect(window.location.href).toBe('/login'));
    Object.defineProperty(window, 'location', { value: original, writable: true, configurable: true });
  });
});

describe('salvar', () => {
  it('sem mudança, Salvar fica desabilitado', async () => {
    await abrir();
    expect(salvar('Ana Souza')).toBeDisabled();
    fireEvent.click(within(cartao('Ana Souza')).getByRole('checkbox', { name: /Ver documentos/ }));
    expect(salvar('Ana Souza')).toBeEnabled();
    fireEvent.click(within(cartao('Ana Souza')).getByRole('checkbox', { name: /Ver documentos/ }));
    expect(salvar('Ana Souza')).toBeDisabled();
  });

  it('diálogo lista adicionadas e removidas; sem sensível adicionada não mostra o texto obrigatório', async () => {
    await abrir();
    const ana = cartao('Ana Souza');
    fireEvent.click(within(ana).getByRole('checkbox', { name: /Ver documentos/ }));
    fireEvent.click(within(ana).getByRole('checkbox', { name: /Ver clientes/ }));
    fireEvent.click(salvar('Ana Souza'));
    const d = await screen.findByRole('dialog');
    expect(within(d).getByText(/Adicionadas/)).toBeInTheDocument();
    expect(within(d).getByText(/Ver documentos/)).toBeInTheDocument();
    expect(within(d).getByText(/Removidas/)).toBeInTheDocument();
    expect(within(d).getByText(/Ver clientes/)).toBeInTheDocument();
    expect(within(d).queryByText(TEXTO_OBRIGATORIO)).not.toBeInTheDocument();
    expect(within(d).queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(within(d).getByRole('button', { name: 'Confirmar e salvar' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    const [url, init] = puts()[0];
    expect(url).toBe(`${URL_BASE}/u1`);
    expect(JSON.parse(init.body as string)).toEqual({ permissoes: ['documents.read', 'documents.approve'] });
  });

  it('remover sensível não exige confirmação', async () => {
    await abrir();
    fireEvent.click(within(cartao('Ana Souza')).getByRole('checkbox', { name: /Aprovar documentos/ }));
    fireEvent.click(salvar('Ana Souza'));
    const d = await screen.findByRole('dialog');
    expect(within(d).queryByText(TEXTO_OBRIGATORIO)).not.toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Confirmar e salvar' })).toBeEnabled();
  });

  it('sensível adicionada: texto exato, caixa obrigatória e confirmar_sensiveis', async () => {
    await abrir();
    fireEvent.click(within(cartao('Bruno Lima')).getByRole('checkbox', { name: /Aprovar documentos/ }));
    fireEvent.click(salvar('Bruno Lima'));
    const d = await screen.findByRole('dialog');
    expect(within(d).getByText(TEXTO_OBRIGATORIO)).toBeInTheDocument();
    const confirmar = within(d).getByRole('button', { name: 'Confirmar e salvar' });
    expect(confirmar).toBeDisabled();
    fireEvent.click(within(d).getByRole('checkbox'));
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(JSON.parse(puts()[0][1].body as string)).toEqual({ permissoes: ['documents.approve'], confirmar_sensiveis: true });
  });

  it('sucesso: role=status, fecha o diálogo e recarrega', async () => {
    await abrir();
    fireEvent.click(within(cartao('Bruno Lima')).getByRole('checkbox', { name: /Ver clientes/ }));
    fireEvent.click(salvar('Bruno Lima'));
    const antes = fetchMock.mock.calls.filter(([, i]) => (i?.method ?? 'GET') === 'GET').length;
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar e salvar' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Bruno Lima');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, i]) => (i?.method ?? 'GET') === 'GET').length).toBe(antes + 1));
  });

  it.each([400, 403, 404])('erro %i do servidor aparece sem reescrever e mantém o diálogo', async (status) => {
    rotas['PUT /u2'] = () => resp(status, { message: 'Mensagem do servidor X' });
    await abrir();
    fireEvent.click(within(cartao('Bruno Lima')).getByRole('checkbox', { name: /Ver clientes/ }));
    fireEvent.click(salvar('Bruno Lima'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar e salvar' }));
    const d = screen.getByRole('dialog');
    expect(await within(d).findByRole('alert')).toHaveTextContent('Mensagem do servidor X');
    expect(within(d).getByRole('button', { name: 'Confirmar e salvar' })).toBeEnabled();
  });

  it('sem duplo envio e botões desabilitados durante a requisição', async () => {
    let liberar!: (r: Resp) => void;
    rotas['PUT /u2'] = () => new Promise<Resp>((res) => { liberar = res; });
    await abrir();
    fireEvent.click(within(cartao('Bruno Lima')).getByRole('checkbox', { name: /Ver clientes/ }));
    fireEvent.click(salvar('Bruno Lima'));
    const d = await screen.findByRole('dialog');
    const ok = within(d).getByRole('button', { name: 'Confirmar e salvar' });
    fireEvent.click(ok);
    fireEvent.click(ok);
    await waitFor(() => expect(within(d).getByRole('button', { name: 'Salvando...' })).toBeDisabled());
    expect(within(d).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(puts()).toHaveLength(1);
    await act(async () => { liberar(resp(200, { id: 'u2', nome: 'Bruno Lima', permissoes: ['clients.read'], adicionadas: ['clients.read'], removidas: [] })); });
  });

  it('Esc fecha o diálogo e devolve o foco ao botão Salvar', async () => {
    await abrir();
    fireEvent.click(within(cartao('Bruno Lima')).getByRole('checkbox', { name: /Ver clientes/ }));
    const botao = salvar('Bruno Lima');
    botao.focus();
    fireEvent.click(botao);
    const d = await screen.findByRole('dialog');
    fireEvent.keyDown(d, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(botao).toHaveFocus();
  });
});

describe('sócio inativo', () => {
  beforeEach(() => {
    dados = {
      catalogo: CATALOGO,
      socios: [
        { id: 'u1', nome: 'Ana Souza', permissoes: ['clients.read', 'documents.approve'], ativo: false } as never,
        { id: 'u2', nome: 'Bruno Lima', permissoes: [], ativo: true } as never,
      ],
    };
  });

  it('mostra "Inativo" em texto, só no cartão do inativo', async () => {
    await abrir();
    expect(within(cartao('Ana Souza')).getByText('Inativo')).toBeInTheDocument();
    expect(within(cartao('Bruno Lima')).queryByText('Inativo')).not.toBeInTheDocument();
  });

  it('não permite marcar o que não tem; permite desmarcar o que tem', async () => {
    await abrir();
    const ana = cartao('Ana Souza');
    expect(within(ana).getByRole('checkbox', { name: /Ver financeiro/ })).toBeDisabled();
    expect(within(ana).getByRole('checkbox', { name: /Ver documentos/ })).toBeDisabled();
    expect(within(ana).getByRole('checkbox', { name: /Ver clientes/ })).toBeEnabled();
    expect(within(cartao('Bruno Lima')).getByRole('checkbox', { name: /Ver financeiro/ })).toBeEnabled();
  });

  it('remover permissão de inativo grava sem confirmar_sensiveis', async () => {
    await abrir();
    fireEvent.click(within(cartao('Ana Souza')).getByRole('checkbox', { name: /Aprovar documentos/ }));
    fireEvent.click(salvar('Ana Souza'));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar e salvar' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(JSON.parse(String(puts()[0][1]?.body))).toEqual({ permissoes: ['clients.read'] });
  });
});
