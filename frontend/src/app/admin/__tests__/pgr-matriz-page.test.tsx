import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';

import PgrMatrizPage from '../pgr-matriz/page';
import { ADMIN_NAV } from '@/components/admin/nav';

const BASE = '/api/atuacao/pgr/matriz';
const ID3 = '33333333-3333-4333-8333-333333333333';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID1 = '11111111-1111-4111-8111-111111111111';
const SHA = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

const base = (id: string, n: number, status: string, extra: object = {}) => ({
  id, version_number: n, status, config_sha256: null, notes: null, created_by: 'aaaaaaaa-0000-4000-8000-000000000000',
  published_by: null, published_at: null, created_at: '2026-10-28T10:00:00Z', updated_at: '2026-10-28T10:00:00Z', ...extra,
});
const V3 = base(ID3, 3, 'rascunho');
const V2 = base(ID2, 2, 'publicada', { config_sha256: SHA, published_by: 'bbbbbbbb-0000-4000-8000-000000000000', published_at: '2026-10-27T12:00:00Z' });
const V1 = base(ID1, 1, 'arquivada', { config_sha256: 'fedcba9876543210ffff', published_at: '2026-10-20T12:00:00Z' });

const CONFIG_TESTE = {
  severidade: [{ valor: 1, rotulo: 'TESTE S1', descricao: 'd' }, { valor: 2, rotulo: 'TESTE S2', descricao: '' }],
  probabilidade: [{ valor: 1, rotulo: 'TESTE P1', descricao: '' }],
  niveis: [{ id: 'n1', rotulo: 'TESTE N1', aceitabilidade: 'ac', decisao: 'dec', bloqueia_emissao: false }],
  faixas: [{ min: 1, max: 2, nivel_id: 'n1' }],
  metodologia: { formula: 'severidade*probabilidade', validada_por: 'TESTE Fulano', data: '2026-10-01' },
};

type Resp = { status: number; body: unknown };
const resp = (status: number, body: unknown): Resp => ({ status, body });
const toResponse = (r: Resp) => ({ ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body });

let fetchMock: ReturnType<typeof vi.fn>;
let rotas: Record<string, (init?: RequestInit) => Resp | Promise<Resp>>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];

const chamadas = (metodo: string, caminho: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === `${BASE}${caminho}` && (init?.method ?? 'GET') === metodo);
const corpo = (metodo: string, caminho: string) => JSON.parse(String(chamadas(metodo, caminho).at(-1)![1].body));

beforeEach(() => {
  localStorage.setItem('montese_token', 'tok');
  rotas = {
    'GET ': () => resp(200, [V3, V2, V1]),
    [`GET /${ID3}`]: () => resp(200, { ...V3, config: {} }),
    [`GET /${ID2}`]: () => resp(200, { ...V2, config: CONFIG_TESTE }),
    [`GET /${ID1}`]: () => resp(200, { ...V1, config: CONFIG_TESTE }),
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

async function abrirPagina() {
  render(<PgrMatrizPage />);
  await screen.findByRole('heading', { level: 2, name: 'PGR — Matriz de risco' });
}
async function abrirVersao(n: number) {
  await abrirPagina();
  fireEvent.click(await screen.findByRole('button', { name: `Abrir versão ${n}` }));
}
const digitar = (rotulo: string | RegExp, valor: string) => fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });

describe('/admin/pgr-matriz — lista', () => {
  it('estado vazio exato e nenhum valor de exemplo', async () => {
    rotas['GET '] = () => resp(200, []);
    await abrirPagina();
    expect(await screen.findByText('Nenhuma matriz configurada. A configuração é feita pela equipe técnica.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Criar rascunho' })).toBeTruthy();
  });

  it('lista número, status, hash abreviado e publicada por/em', async () => {
    await abrirPagina();
    const linha2 = (await screen.findByRole('button', { name: 'Abrir versão 2' })).closest('tr') as HTMLElement;
    expect(within(linha2).getByText('Publicada')).toBeTruthy();
    expect(within(linha2).getByText(SHA.slice(0, 12))).toBeTruthy();
    expect(within(linha2).getByText(/usuário bbbbbbbb/)).toBeTruthy();
    const linha3 = screen.getByRole('button', { name: 'Abrir versão 3' }).closest('tr') as HTMLElement;
    expect(within(linha3).getByText('Rascunho')).toBeTruthy();
    expect(within(linha3).getAllByText('não informado').length).toBeGreaterThan(0);
  });

  it('erro de carregamento mostra alerta com nova tentativa', async () => {
    rotas['GET '] = () => resp(500, {});
    await abrirPagina();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });

  it('o menu do admin tem o item no grupo Sistema', () => {
    const sistema = ADMIN_NAV.find((g) => g.label === 'Sistema')!;
    const item = sistema.items.filter((i) => i.href === '/admin/pgr-matriz');
    expect(item).toHaveLength(1);
    expect(item[0].label).toBe('PGR — Matriz de risco');
  });
});

describe('/admin/pgr-matriz — criar e duplicar', () => {
  it('cria rascunho em branco (corpo vazio) e abre o editor sem nenhum valor preenchido', async () => {
    rotas['GET '] = () => resp(200, []);
    rotas['POST '] = () => resp(201, { ...V3, config: {}, validacao: { erros: [], pendencias: [], pode_publicar: false } });
    rotas[`GET /${ID3}`] = () => resp(200, { ...V3, config: {} });
    await abrirPagina();
    fireEvent.click(await screen.findByRole('button', { name: 'Criar rascunho' }));
    await screen.findByRole('heading', { name: /Versão 3/ });
    expect(screen.getByText('Rascunho criado.').getAttribute('role')).toBe('status');
    expect(corpo('POST', '')).toEqual({});
    const campos = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(campos.length).toBeGreaterThan(0);
    campos.forEach((c) => expect(c.value).toBe(''));
    screen.getAllByRole('combobox').forEach((s) => expect((s as HTMLSelectElement).value).toBe(''));
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('cria copiando de outra versão', async () => {
    rotas['POST '] = () => resp(201, { ...V3, config: CONFIG_TESTE, validacao: { erros: [], pendencias: [] } });
    await abrirPagina();
    fireEvent.change(await screen.findByLabelText('Copiar de'), { target: { value: ID2 } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar rascunho' }));
    await screen.findByRole('heading', { name: /Versão 3/ });
    expect(corpo('POST', '')).toEqual({ copiar_de: ID2 });
  });

  it('duplicar uma versão publicada cria rascunho com copiar_de', async () => {
    rotas['POST '] = () => resp(201, { ...V3, config: CONFIG_TESTE, validacao: { erros: [], pendencias: [] } });
    await abrirVersao(2);
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicar versão' }));
    await screen.findByRole('heading', { name: /Versão 3/ });
    expect(corpo('POST', '')).toEqual({ copiar_de: ID2 });
  });

  it('403 ao criar mostra a mensagem do servidor', async () => {
    rotas['POST '] = () => resp(403, { message: 'Operação não permitida para este perfil' });
    await abrirPagina();
    fireEvent.click(await screen.findByRole('button', { name: 'Criar rascunho' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Operação não permitida para este perfil');
  });

  it('404 na origem da cópia mostra a mensagem do servidor', async () => {
    rotas['POST '] = () => resp(404, { message: 'Versão de origem não encontrada' });
    await abrirPagina();
    fireEvent.click(await screen.findByRole('button', { name: 'Criar rascunho' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Versão de origem não encontrada');
  });
});

describe('/admin/pgr-matriz — editor do rascunho', () => {
  async function abrirRascunho(config: unknown = {}) {
    rotas[`GET /${ID3}`] = () => resp(200, { ...V3, config });
    await abrirVersao(3);
    await screen.findByRole('button', { name: 'Salvar rascunho' });
  }

  it('adiciona e remove linhas das escalas, níveis e faixas', async () => {
    await abrirRascunho();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item de severidade' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item de severidade' }));
    expect(screen.getByLabelText('Severidade, item 2: valor')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remover item 2 de severidade' }));
    expect(screen.queryByLabelText('Severidade, item 2: valor')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item de probabilidade' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar nível' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar faixa' }));
    expect(screen.getByLabelText('Probabilidade, item 1: valor')).toBeTruthy();
    expect(screen.getByLabelText('Nível 1: id')).toBeTruthy();
    expect(screen.getByLabelText('Faixa 1: mínimo')).toBeTruthy();
    expect((screen.getByLabelText('Nível 1: bloqueia emissão') as HTMLSelectElement).value).toBe('');
  });

  it('salva o rascunho (PATCH) com o config digitado e mostra os avisos do servidor', async () => {
    rotas[`PATCH /${ID3}`] = () => resp(200, {
      ...V3, config: CONFIG_TESTE,
      validacao: { erros: ['Escala 1: "rotulo" é obrigatório e não pode ser vazio.'], pendencias: ['Metodologia não informada (fórmula, validada_por e data).'], pode_publicar: false },
    });
    await abrirRascunho();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item de severidade' }));
    digitar('Severidade, item 1: valor', '1');
    digitar('Severidade, item 1: rótulo', 'TESTE S1');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar faixa' }));
    digitar('Faixa 1: mínimo', '1');
    digitar('Faixa 1: máximo', '4');
    digitar('Faixa 1: nível', 'n1');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(chamadas('PATCH', `/${ID3}`)).toHaveLength(1));
    const enviado = corpo('PATCH', `/${ID3}`);
    expect(enviado.config.severidade).toEqual([{ valor: 1, rotulo: 'TESTE S1', descricao: '' }]);
    expect(enviado.config.faixas).toEqual([{ min: 1, max: 4, nivel_id: 'n1' }]);
    expect(enviado.config.metodologia).toBeUndefined();
    const aviso = await screen.findByRole('alert');
    expect(aviso.textContent).toContain('Escala 1: "rotulo" é obrigatório e não pode ser vazio.');
    expect(aviso.textContent).toContain('Metodologia não informada');
  });

  it('campo numérico vazio vai como null (nada é presumido)', async () => {
    rotas[`PATCH /${ID3}`] = () => resp(200, { ...V3, config: {}, validacao: { erros: [], pendencias: [] } });
    await abrirRascunho();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item de severidade' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(chamadas('PATCH', `/${ID3}`)).toHaveLength(1));
    expect(corpo('PATCH', `/${ID3}`).config.severidade).toEqual([{ valor: null, rotulo: '', descricao: '' }]);
  });

  it('Validar chama POST /validar e lista erros e pendências em região acessível', async () => {
    rotas['POST /validar'] = () => resp(200, {
      ok: false, erros: ['Lacuna nas faixas: escores 1 a 2 não estão cobertos.'], pendencias: ['Metodologia: "validada_por" não informado.'], pode_publicar: false, celulas: null,
    });
    await abrirRascunho(CONFIG_TESTE);
    fireEvent.click(screen.getByRole('button', { name: 'Validar' }));
    const regiao = await screen.findByRole('alert');
    const itens = within(regiao).getAllByRole('listitem').map((i) => i.textContent);
    expect(itens).toContain('Lacuna nas faixas: escores 1 a 2 não estão cobertos.');
    expect(itens).toContain('Metodologia: "validada_por" não informado.');
    expect(corpo('POST', '/validar')).toMatchObject({ publicar: true });
    expect(corpo('POST', '/validar').config.severidade).toHaveLength(2);
  });

  it('Validar sem problemas informa em status', async () => {
    rotas['POST /validar'] = () => resp(200, { ok: true, erros: [], pendencias: [], pode_publicar: true, celulas: [] });
    await abrirRascunho(CONFIG_TESTE);
    fireEvent.click(screen.getByRole('button', { name: 'Validar' }));
    expect((await screen.findByRole('status')).textContent).toContain('Nenhum erro ou pendência');
  });

  it('prévia do mapa de calor: rotulada como prévia e calculada das escalas e faixas', async () => {
    await abrirRascunho(CONFIG_TESTE);
    const previa = screen.getByRole('region', { name: /Prévia do mapa de calor/ });
    expect(previa.textContent).toMatch(/prévia/i);
    const tabela = within(previa).getByRole('table');
    expect(within(tabela).getAllByText('TESTE N1').length).toBe(2);
    digitar('Faixa 1: máximo', '1');
    expect(within(tabela).getAllByText('TESTE N1').length).toBe(1);
    expect(within(tabela).getAllByText('sem faixa').length).toBe(1);
  });

  it('prévia: faixas sobrepostas ⇒ conflito; nível inexistente ⇒ sem faixa (sem id cru)', async () => {
    await abrirRascunho({
      ...CONFIG_TESTE,
      probabilidade: [{ valor: 1, rotulo: 'TESTE P1', descricao: '' }],
      faixas: [{ min: 1, max: 1, nivel_id: 'n1' }, { min: 1, max: 1, nivel_id: 'n1' }, { min: 2, max: 2, nivel_id: 'fantasma' }],
    });
    const tabela = within(screen.getByRole('region', { name: /Prévia do mapa de calor/ })).getByRole('table');
    expect(within(tabela).getByText('conflito de faixas')).toBeTruthy();
    expect(within(tabela).getByText('sem faixa')).toBeTruthy();
    expect(within(tabela).queryByText('fantasma')).toBeNull();
  });

  it('decimal no campo numérico vai como null (o servidor reporta) e a prévia não é montada', async () => {
    rotas[`PATCH /${ID3}`] = () => resp(200, { ...V3, config: {}, validacao: { erros: [], pendencias: [] } });
    await abrirRascunho({});
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar item de severidade' }));
    digitar('Severidade, item 1: valor', '1.5');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(chamadas('PATCH', `/${ID3}`)).toHaveLength(1));
    expect(corpo('PATCH', `/${ID3}`).config.severidade[0].valor).toBeNull();
  });

  it('prévia sem escalas explica o que falta, sem grade', async () => {
    await abrirRascunho({});
    const previa = screen.getByRole('region', { name: /Prévia do mapa de calor/ });
    expect(within(previa).queryByRole('table')).toBeNull();
    expect(previa.textContent).toContain('Preencha');
  });

  it('metodologia: fórmula vem sem seleção e só tem a fórmula conhecida', async () => {
    await abrirRascunho();
    const sel = screen.getByLabelText('Fórmula') as HTMLSelectElement;
    expect(sel.value).toBe('');
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['', 'severidade*probabilidade']);
  });

  it('não usa os termos proibidos', async () => {
    await abrirRascunho(CONFIG_TESTE);
    expect(document.body.textContent).not.toMatch(/assinatura digital|ICP-Brasil/i);
  });

  it('Publicar fica desabilitado com alterações não salvas', async () => {
    await abrirRascunho(CONFIG_TESTE);
    const publicar = screen.getByRole('button', { name: 'Publicar versão' }) as HTMLButtonElement;
    expect(publicar.disabled).toBe(false);
    digitar('Severidade, item 1: rótulo', 'TESTE X');
    expect(publicar.disabled).toBe(true);
    expect(screen.getByText(/Salve o rascunho antes de publicar/)).toBeTruthy();
  });

  it('durante o envio os botões ficam desabilitados e não há envio duplo', async () => {
    let liberar!: (r: Resp) => void;
    rotas[`PATCH /${ID3}`] = () => new Promise<Resp>((res) => { liberar = res; });
    await abrirRascunho(CONFIG_TESTE);
    digitar('Severidade, item 1: rótulo', 'TESTE X');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect((screen.getByRole('button', { name: /Salvando/ }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Validar' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Salvando/ }));
    await act(async () => { liberar(resp(200, { ...V3, config: CONFIG_TESTE, validacao: { erros: [], pendencias: [] } })); });
    expect(chamadas('PATCH', `/${ID3}`)).toHaveLength(1);
  });

  it('409 ao salvar mostra a mensagem do servidor', async () => {
    rotas[`PATCH /${ID3}`] = () => resp(409, { message: 'Somente uma versão em rascunho pode ser alterada; crie uma nova versão a partir desta' });
    await abrirRascunho(CONFIG_TESTE);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Somente uma versão em rascunho pode ser alterada');
  });

  it('413 ao salvar mostra a mensagem do servidor', async () => {
    rotas[`PATCH /${ID3}`] = () => resp(413, { message: 'A configuração excede o limite de 200000 bytes' });
    await abrirRascunho(CONFIG_TESTE);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect((await screen.findByRole('alert')).textContent).toContain('excede o limite de 200000 bytes');
  });

  it('401 ao salvar envia ao /login', async () => {
    const loc = { href: '' };
    vi.stubGlobal('location', loc);
    rotas[`PATCH /${ID3}`] = () => resp(401, {});
    await abrirRascunho(CONFIG_TESTE);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(loc.href).toBe('/login'));
  });

  it('401 ao listar envia ao /login', async () => {
    const loc = { href: '' };
    vi.stubGlobal('location', loc);
    rotas['GET '] = () => resp(401, {});
    render(<PgrMatrizPage />);
    await waitFor(() => expect(loc.href).toBe('/login'));
  });
});

describe('/admin/pgr-matriz — publicar', () => {
  async function abrirRascunho() {
    rotas[`GET /${ID3}`] = () => resp(200, { ...V3, config: CONFIG_TESTE });
    await abrirVersao(3);
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar versão' }));
    return screen.findByRole('dialog');
  }

  it('pede confirmação explícita e Cancelar não publica', async () => {
    const dlg = await abrirRascunho();
    expect(dlg.textContent).toContain('A versão publicada não poderá ser alterada. Para mudar, crie uma nova versão.');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chamadas('POST', `/${ID3}/publicar`)).toHaveLength(0);
  });

  it('erro 400 do servidor mostra mensagem, erros e pendências', async () => {
    rotas[`POST /${ID3}/publicar`] = () => resp(400, {
      statusCode: 400, message: 'A matriz não pode ser publicada: corrija os erros e preencha as pendências.',
      erros: ['Sobreposição entre as faixas 1–2 e 2–3.'], pendencias: ['O nível "n9" não é usado por nenhuma faixa.'],
    });
    const dlg = await abrirRascunho();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar publicação' }));
    const alerta = await within(await screen.findByRole('dialog')).findByRole('alert');
    expect(alerta.textContent).toContain('A matriz não pode ser publicada');
    expect(alerta.textContent).toContain('Sobreposição entre as faixas 1–2 e 2–3.');
    expect(alerta.textContent).toContain('O nível "n9" não é usado por nenhuma faixa.');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('409 ao publicar mostra a mensagem do servidor', async () => {
    rotas[`POST /${ID3}/publicar`] = () => resp(409, { message: 'Existe uma versão publicada mais nova; crie uma nova versão a partir desta (copiar_de).' });
    const dlg = await abrirRascunho();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar publicação' }));
    expect((await within(await screen.findByRole('dialog')).findByRole('alert')).textContent).toContain('Existe uma versão publicada mais nova');
  });

  it('envia o updated_at do rascunho lido no corpo da publicação', async () => {
    rotas[`POST /${ID3}/publicar`] = () => resp(201, { ...V3, status: 'publicada' });
    const dlg = await abrirRascunho();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar publicação' }));
    await waitFor(() => expect(chamadas('POST', `/${ID3}/publicar`)).toHaveLength(1));
    expect(corpo('POST', `/${ID3}/publicar`)).toEqual({ updated_at: V3.updated_at });
  });

  it('depois de salvar, publica com o updated_at devolvido pelo salvamento (não o antigo)', async () => {
    const NOVO = '2026-10-28T11:30:00Z';
    rotas[`PATCH /${ID3}`] = () => resp(200, { ...V3, updated_at: NOVO, config: CONFIG_TESTE, validacao: { erros: [], pendencias: [] } });
    rotas[`POST /${ID3}/publicar`] = () => resp(201, { ...V3, status: 'publicada' });
    rotas[`GET /${ID3}`] = () => resp(200, { ...V3, config: CONFIG_TESTE });
    await abrirVersao(3);
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar faixa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(chamadas('PATCH', `/${ID3}`)).toHaveLength(1));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Publicar versão' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Publicar versão' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar publicação' }));
    await waitFor(() => expect(chamadas('POST', `/${ID3}/publicar`)).toHaveLength(1));
    expect(corpo('POST', `/${ID3}/publicar`)).toEqual({ updated_at: NOVO });
  });

  it('409 de rascunho alterado aparece no diálogo e oferece recarregar', async () => {
    const MSG = 'O rascunho foi alterado desde que você o abriu; recarregue antes de publicar.';
    rotas[`POST /${ID3}/publicar`] = () => resp(409, { message: MSG });
    const dlg = await abrirRascunho();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar publicação' }));
    const d = within(await screen.findByRole('dialog'));
    expect((await d.findByRole('alert')).textContent).toContain(MSG);
    const antes = chamadas('GET', `/${ID3}`).length;
    fireEvent.click(d.getByRole('button', { name: 'Recarregar rascunho' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(chamadas('GET', `/${ID3}`).length).toBeGreaterThan(antes));
  });

  it('sucesso: vira somente leitura (sem campos nem Salvar) e mostra o hash', async () => {
    rotas[`POST /${ID3}/publicar`] = () => resp(201, { ...V3, status: 'publicada', config_sha256: SHA, published_at: '2026-10-28T12:00:00Z', published_by: 'cccccccc-0000-4000-8000-000000000000' });
    const antes = rotas[`GET /${ID3}`];
    const dlg = await abrirRascunho();
    rotas[`GET /${ID3}`] = () => resp(200, { ...V3, status: 'publicada', config: CONFIG_TESTE, config_sha256: SHA, published_at: '2026-10-28T12:00:00Z', published_by: 'cccccccc-0000-4000-8000-000000000000' });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar publicação' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.getAllByText(new RegExp(SHA.slice(0, 12))).length).toBeGreaterThan(0);
    expect(antes).toBeTruthy();
  });
});

describe('/admin/pgr-matriz — somente leitura e arquivar', () => {
  it('publicada: mostra os dados sem campos editáveis, com Duplicar e Arquivar', async () => {
    await abrirVersao(2);
    await screen.findByRole('heading', { name: /Versão 2/ });
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Salvar rascunho' })).toBeNull();
    expect(screen.getAllByText('TESTE S1').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Duplicar versão' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arquivar versão' })).toBeTruthy();
  });

  it('metodologia ausente aparece como "não informado"', async () => {
    rotas[`GET /${ID2}`] = () => resp(200, { ...V2, config: { ...CONFIG_TESTE, metodologia: { formula: 'severidade*probabilidade', validada_por: 'TESTE Fulano', data: '2026-10-01' } } });
    await abrirVersao(2);
    await screen.findByRole('heading', { name: /Versão 2/ });
    expect(screen.getAllByText('não informado').length).toBeGreaterThan(0);
  });

  it('arquivada: sem Arquivar nem edição', async () => {
    await abrirVersao(1);
    await screen.findByRole('heading', { name: /Versão 1/ });
    expect(screen.queryByRole('button', { name: 'Arquivar versão' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Duplicar versão' })).toBeTruthy();
  });

  it('arquivar pede confirmação e então envia POST', async () => {
    rotas[`POST /${ID2}/arquivar`] = () => resp(201, { ...V2, status: 'arquivada' });
    await abrirVersao(2);
    fireEvent.click(await screen.findByRole('button', { name: 'Arquivar versão' }));
    const dlg = await screen.findByRole('dialog');
    expect(chamadas('POST', `/${ID2}/arquivar`)).toHaveLength(0);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar arquivamento' }));
    await waitFor(() => expect(chamadas('POST', `/${ID2}/arquivar`)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('erro ao arquivar (409) mostra a mensagem do servidor no diálogo', async () => {
    rotas[`POST /${ID2}/arquivar`] = () => resp(409, { message: 'Somente uma versão publicada pode ser arquivada' });
    await abrirVersao(2);
    fireEvent.click(await screen.findByRole('button', { name: 'Arquivar versão' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar arquivamento' }));
    expect((await within(await screen.findByRole('dialog')).findByRole('alert')).textContent).toContain('Somente uma versão publicada pode ser arquivada');
  });

  it('404 ao abrir uma versão mostra erro com alerta', async () => {
    rotas[`GET /${ID2}`] = () => resp(404, { message: 'Versão da matriz não encontrada' });
    await abrirVersao(2);
    expect((await screen.findByRole('alert')).textContent).toContain('Versão da matriz não encontrada');
  });

  it('403 ao abrir uma versão mostra a mensagem do servidor', async () => {
    rotas[`GET /${ID2}`] = () => resp(403, { message: 'Operação não permitida para este perfil' });
    await abrirVersao(2);
    expect((await screen.findByRole('alert')).textContent).toContain('Operação não permitida para este perfil');
  });

  it('403 ao listar mostra a mensagem do servidor; 500 segue genérico', async () => {
    rotas['GET '] = () => resp(403, { message: 'Sem acesso à matriz' });
    const { unmount } = render(<PgrMatrizPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Sem acesso à matriz');
    unmount();
    rotas['GET '] = () => resp(500, { message: 'detalhe interno' });
    render(<PgrMatrizPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar as versões da matriz.');
  });

  it('falha na recarga após arquivar mostra erro com nova tentativa mesmo havendo dado antigo', async () => {
    rotas[`POST /${ID2}/arquivar`] = () => resp(201, { ...V2, status: 'arquivada' });
    await abrirVersao(2);
    fireEvent.click(await screen.findByRole('button', { name: 'Arquivar versão' }));
    const dlg = await screen.findByRole('dialog');
    rotas[`GET /${ID2}`] = () => resp(500, {});
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar arquivamento' }));
    expect(await screen.findByText('Não foi possível carregar a versão.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Tentar novamente' }).length).toBeGreaterThan(0);
  });

  it('resposta atrasada de uma versão anterior não sobrescreve a versão escolhida depois', async () => {
    let liberar!: (r: Resp) => void;
    rotas[`GET /${ID2}`] = () => new Promise<Resp>((res) => { liberar = res; });
    await abrirPagina();
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir versão 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir versão 1' }));
    await screen.findByRole('heading', { name: /Versão 1/ });
    await act(async () => { liberar(resp(200, { ...V2, config: CONFIG_TESTE })); });
    expect(screen.getByRole('heading', { name: /Versão 1/ })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Versão 2/ })).toBeNull();
  });
});
