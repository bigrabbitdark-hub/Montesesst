import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

let tenantId = 't-1';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ tenantId }),
  useSearchParams: () => new URLSearchParams(),
}));

import EmpresasPage from '../empresas/page';
import EmpresaPage from '../empresas/[tenantId]/page';
import { ATUACAO_MENU_ITEMS } from '@/lib/dashboard/menu-atuacao';

const cliente = {
  id: 't-1', name: 'Alfa Ltda', trade_name: 'Alfa', cnpj: '11222333000181', sector: 'Metalurgia',
  contact_name: 'Maria', contact_phone: '11999990000', status: 'active', situacao: 'ativa',
};
const cliente2 = { ...cliente, id: 't-2', name: 'Beta SA', trade_name: null, cnpj: '99888777000166', situacao: 'trial' };
const visao = {
  empresa: { id: 't-1', name: 'Alfa Ltda', trade_name: 'Alfa', cnpj: '11222333000181', situacao: 'ativa' },
  funcionarios_ativos: 12, documentos: { total: 7, vencidos: 2, a_vencer_30d: 1 }, epis_cadastrados: 5,
};
const docs = [
  { id: 'd-1', category: 'pgr', title: 'PGR 2026', file_name: 'pgr.pdf', valid_from: '2026-01-01', expires_at: '2026-12-31', situacao: 'valido' },
  { id: 'd-2', category: 'laudo', title: 'Laudo velho', file_name: 'laudo.pdf', valid_from: null, expires_at: '2025-01-01', situacao: 'vencido' },
];
const venc = [
  { id: 'd-2', category: 'laudo', title: 'Laudo velho', expires_at: '2025-01-01', dias_para_vencer: -20 },
  { id: 'd-1', category: 'pgr', title: 'PGR 2026', expires_at: '2026-12-31', dias_para_vencer: 15 },
];
const funcs = [{ id: 'f-1', full_name: 'João Souza', cargo: 'Soldador', department: 'Produção', admission_date: '2024-03-01', status: 'ativo' }];
const epis = [{ id: 'e-1', code: 'CA-123', equipment_group: 'Luvas', description: 'Luva nitrílica' }];

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

function rota(over: Record<string, () => Response | Promise<Response>> = {}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const metodo = init?.method ?? 'GET';
    const chave = `${metodo} ${u.replace('/api/atuacao', '')}`;
    for (const [k, f] of Object.entries(over)) if (chave.startsWith(k)) return f();
    if (u.includes('/visao-geral')) return resp(200, visao);
    if (u.includes('/vencimentos')) return resp(200, venc);
    if (u.includes('/funcionarios')) return resp(200, funcs);
    if (u.includes('/epi')) return resp(200, epis);
    if (u.includes('/documentos')) return resp(200, docs);
    if (u.includes('/clientes')) return resp(200, [cliente, cliente2]);
    return resp(404, {});
  });
}

beforeEach(() => {
  tenantId = 't-1';
  localStorage.clear();
  localStorage.setItem('montese_token', 'tok');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('menu', () => {
  it('tem "Empresas" em /atuacao/empresas', () => {
    expect(ATUACAO_MENU_ITEMS.map((i) => [i.label, i.href])).toContainEqual(['Empresas', '/atuacao/empresas']);
  });
});

describe('seletor de empresa', () => {
  it('lista os clientes com CNPJ formatado, situação em texto e link para a empresa', async () => {
    rota();
    render(<EmpresasPage />);
    expect(await screen.findByText('Alfa Ltda')).toBeInTheDocument();
    expect(screen.getByText('11.222.333/0001-81')).toBeInTheDocument();
    expect(screen.getByText('Em teste')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alfa Ltda/ })).toHaveAttribute('href', '/atuacao/empresas/t-1');
    expect(urls()[0]).toBe('/api/atuacao/clientes');
  });

  it('a busca refaz a chamada com q', async () => {
    rota();
    render(<EmpresasPage />);
    await screen.findByText('Alfa Ltda');
    fireEvent.change(screen.getByLabelText('Buscar empresa'), { target: { value: 'beta' } });
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('q=beta'));
  });

  it('lembra a última empresa e funciona sem localStorage', async () => {
    rota();
    localStorage.setItem('montese_atuacao_ultima_empresa', JSON.stringify({ id: 't-2', name: 'Beta SA' }));
    const { unmount } = render(<EmpresasPage />);
    expect(await screen.findByRole('link', { name: /Continuar com Beta SA/ })).toHaveAttribute('href', '/atuacao/empresas/t-2');
    unmount();
    const original = Storage.prototype.getItem;
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k: string) {
      if (k === 'montese_atuacao_ultima_empresa') throw new Error('bloqueado');
      return original.call(this, k);
    });
    try {
      render(<EmpresasPage />);
      expect(await screen.findByText('Alfa Ltda')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Continuar com/ })).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it('mostra erro isolado com role=alert', async () => {
    rota({ 'GET /clientes': () => resp(500, {}) });
    render(<EmpresasPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Algo deu errado');
  });

  it('403 no seletor explica que falta a permissão "Ver clientes"', async () => {
    rota({ 'GET /clientes': () => resp(403, {}) });
    render(<EmpresasPage />);
    const al = await screen.findByRole('alert');
    expect(al).toHaveTextContent("Para escolher uma empresa você também precisa da permissão 'Ver clientes'. Peça ao administrador.");
  });
});

describe('página da empresa', () => {
  it('mostra o nome sempre visível e as 5 abas em tablist', async () => {
    rota();
    render(<EmpresaPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Alfa Ltda' })).toBeInTheDocument();
    const lista = screen.getByRole('tablist');
    expect(within(lista).getAllByRole('tab').map((t) => t.textContent)).toEqual(
      ['Visão geral', 'Documentos', 'Vencimentos', 'Funcionários', 'EPI']);
    expect(screen.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Documentos' }));
    await screen.findByText('PGR 2026');
    expect(screen.getByRole('heading', { level: 1, name: 'Alfa Ltda' })).toBeInTheDocument();
  });

  it('visão geral mostra os totais', async () => {
    rota();
    render(<EmpresaPage />);
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText(/Funcionários ativos/)).toBeInTheDocument();
  });

  it('cada aba busca só a sua rota (lazy)', async () => {
    rota();
    render(<EmpresaPage />);
    await screen.findByRole('heading', { level: 1, name: 'Alfa Ltda' });
    expect(urls()).toEqual(['/api/atuacao/empresas/t-1/visao-geral']);
    fireEvent.click(screen.getByRole('tab', { name: 'Vencimentos' }));
    await screen.findByText('Laudo velho');
    expect(urls().filter((u) => !u.endsWith('/visao-geral'))).toEqual(['/api/atuacao/empresas/t-1/vencimentos']);
    fireEvent.click(screen.getByRole('tab', { name: 'EPI' }));
    await screen.findByText('Luva nitrílica');
    expect(urls().at(-1)).toBe('/api/atuacao/empresas/t-1/epi');
    expect(urls().some((u) => u.endsWith('/funcionarios'))).toBe(false);
  });

  it('teclas de seta movem entre as abas', async () => {
    rota();
    render(<EmpresaPage />);
    await screen.findByRole('heading', { level: 1, name: 'Alfa Ltda' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Visão geral' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Documentos' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Documentos' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'EPI' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'EPI' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute('aria-selected', 'true');
  });

  it('erro de uma aba fica isolado nela', async () => {
    rota({ 'GET /empresas/t-1/vencimentos': () => resp(500, {}) });
    render(<EmpresaPage />);
    await screen.findByRole('heading', { level: 1, name: 'Alfa Ltda' });
    fireEvent.click(screen.getByRole('tab', { name: 'Vencimentos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Algo deu errado');
    expect(screen.getByRole('heading', { level: 1, name: 'Alfa Ltda' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(5);
  });

  it('estado vazio por aba', async () => {
    rota({ 'GET /empresas/t-1/epi': () => resp(200, []) });
    render(<EmpresaPage />);
    await screen.findByRole('heading', { level: 1, name: 'Alfa Ltda' });
    fireEvent.click(screen.getByRole('tab', { name: 'EPI' }));
    expect(await screen.findByText('Nenhum EPI cadastrado.')).toBeInTheDocument();
  });

  it('funcionários não mostra CPF nem nascimento', async () => {
    rota();
    const { container } = render(<EmpresaPage />);
    await screen.findByRole('heading', { level: 1, name: 'Alfa Ltda' });
    fireEvent.click(screen.getByRole('tab', { name: 'Funcionários' }));
    await screen.findByText('João Souza');
    expect(container.textContent).not.toMatch(/CPF|nascimento/i);
  });

  it('vencimentos destaca vencido e a vencer em texto', async () => {
    rota();
    render(<EmpresaPage />);
    await screen.findByRole('heading', { level: 1, name: 'Alfa Ltda' });
    fireEvent.click(screen.getByRole('tab', { name: 'Vencimentos' }));
    await screen.findByText('Laudo velho');
    expect(screen.getByText(/Vencido há 20 dias/)).toBeInTheDocument();
    expect(screen.getByText(/Vence em 15 dias/)).toBeInTheDocument();
  });

  it('404 da empresa mostra "Empresa não encontrada"', async () => {
    rota({ 'GET /empresas/t-1/visao-geral': () => resp(404, {}) });
    render(<EmpresaPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Empresa não encontrada');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('403 mostra a mensagem de permissão', async () => {
    rota({ 'GET /empresas/t-1/visao-geral': () => resp(403, {}) });
    render(<EmpresaPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem permissão para esta ação.');
  });

  it('guarda a última empresa no localStorage', async () => {
    rota();
    render(<EmpresaPage />);
    await screen.findByRole('heading', { level: 1, name: 'Alfa Ltda' });
    expect(JSON.parse(localStorage.getItem('montese_atuacao_ultima_empresa')!)).toEqual({ id: 't-1', name: 'Alfa Ltda' });
  });

  it('não exibe e-mail nem "assinatura digital"/"ICP-Brasil"', async () => {
    rota();
    const { container } = render(<EmpresaPage />);
    await screen.findByRole('heading', { level: 1, name: 'Alfa Ltda' });
    const marcadores: [string, string][] = [
      ['Documentos', 'PGR 2026'], ['Vencimentos', 'Laudo velho'], ['Funcionários', 'João Souza'], ['EPI', 'Luva nitrílica'],
    ];
    for (const [aba, marcador] of marcadores) {
      fireEvent.click(screen.getByRole('tab', { name: aba }));
      await screen.findByText(marcador);
      expect(container.textContent).not.toMatch(/assinatura digital|ICP-Brasil|@/i);
    }
  });
});

describe('ajuste de vigência', () => {
  async function abrir() {
    rota();
    render(<EmpresaPage />);
    await screen.findByRole('heading', { level: 1, name: 'Alfa Ltda' });
    fireEvent.click(screen.getByRole('tab', { name: 'Documentos' }));
    await screen.findByText('PGR 2026');
    fireEvent.click(screen.getAllByRole('button', { name: /Ajustar vigência/ })[0]);
    return screen.findByRole('dialog');
  }

  it('valida AAAA-MM-DD e não envia', async () => {
    const dlg = await abrir();
    fireEvent.change(within(dlg).getByLabelText('Vence em'), { target: { value: '31/12/2027' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('AAAA-MM-DD');
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(false);
  });

  it('envia PATCH só com o campo alterado, mostra status e recarrega', async () => {
    const dlg = await abrir();
    const antes = urls().filter((u) => u.endsWith('/documentos')).length;
    fireEvent.change(within(dlg).getByLabelText('Vence em'), { target: { value: '2027-06-30' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Vigência atualizada'));
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
    expect(String(patch[0])).toBe('/api/atuacao/empresas/t-1/documentos/d-1/vigencia');
    expect(JSON.parse(patch[1].body)).toEqual({ expires_at: '2027-06-30' });
    await waitFor(() => expect(urls().filter((u) => u.endsWith('/documentos')).length).toBe(antes + 1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('o diálogo avisa que alterar só "Válido desde" pode recalcular o vencimento', async () => {
    const dlg = await abrir();
    expect(within(dlg).getByText("Alterar apenas 'Válido desde' pode recalcular o vencimento pela regra do tipo de documento.")).toBeInTheDocument();
  });

  it('após salvar a vigência a "Visão geral" é recarregada (contadores não ficam velhos)', async () => {
    const dlg = await abrir();
    const antes = urls().filter((u) => u.endsWith('/visao-geral')).length;
    rota({ 'GET /empresas/t-1/visao-geral': () => resp(200, { ...visao, documentos: { total: 7, vencidos: 1, a_vencer_30d: 1 } }) });
    fireEvent.change(within(dlg).getByLabelText('Vence em'), { target: { value: '2027-06-30' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(urls().filter((u) => u.endsWith('/visao-geral')).length).toBe(antes + 1));
    fireEvent.click(screen.getByRole('tab', { name: 'Visão geral' }));
    const item = (await screen.findByText('Documentos vencidos')).parentElement!;
    expect(item).toHaveTextContent('1');
  });

  it('403 mostra a mensagem no diálogo e botões ficam desabilitados durante o envio', async () => {
    const dlg = await abrir();
    let liberar!: (r: Response) => void;
    rota({ 'PATCH ': () => new Promise<Response>((r) => { liberar = r; }) });
    fireEvent.change(within(dlg).getByLabelText('Vence em'), { target: { value: '2027-06-30' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(within(dlg).getByRole('button', { name: /Salvando/ })).toBeDisabled());
    expect(within(dlg).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    liberar(resp(403, {}));
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Você não tem permissão para esta ação.');
    expect(within(dlg).getByRole('button', { name: 'Salvar' })).not.toBeDisabled();
  });
});

describe('download e corrida', () => {
  async function abrirDocs() {
    render(<EmpresaPage />);
    await screen.findByRole('heading', { level: 1, name: 'Alfa Ltda' });
    fireEvent.click(screen.getByRole('tab', { name: 'Documentos' }));
    await screen.findByText('PGR 2026');
  }

  it('download: botão desabilitado em voo e âncora temporária com _blank e noopener', async () => {
    let liberar!: (r: Response) => void;
    rota({ 'GET /empresas/t-1/documentos/d-1/download': () => new Promise<Response>((r) => { liberar = r; }) });
    const cliques: HTMLAnchorElement[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { cliques.push(this); });
    try {
      await abrirDocs();
      fireEvent.click(screen.getByRole('button', { name: 'Baixar PGR 2026' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /Baixando/ })).toBeDisabled());
      expect(screen.getByRole('button', { name: 'Baixar Laudo velho' })).toBeDisabled();
      liberar(resp(200, { url: 'https://r2.exemplo/pgr.pdf', file_name: 'pgr.pdf' }));
      await waitFor(() => expect(cliques).toHaveLength(1));
      expect(cliques[0].href).toBe('https://r2.exemplo/pgr.pdf');
      expect(cliques[0].target).toBe('_blank');
      expect(cliques[0].rel).toContain('noopener');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Baixar PGR 2026' })).not.toBeDisabled());
    } finally {
      spy.mockRestore();
    }
  });

  it('download: erro do servidor em role=alert e nenhuma âncora clicada', async () => {
    rota({ 'GET /empresas/t-1/documentos/d-1/download': () => resp(403, {}) });
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    try {
      await abrirDocs();
      fireEvent.click(screen.getByRole('button', { name: 'Baixar PGR 2026' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Você não tem permissão para esta ação.');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('resposta antiga e lenta de visao-geral não sobrescreve a mais nova', async () => {
    let liberarVelha!: (r: Response) => void;
    rota({
      'GET /empresas/t-1/visao-geral': () => new Promise<Response>((r) => { liberarVelha = r; }),
      'GET /empresas/t-2/visao-geral': () => resp(200, { ...visao, empresa: { ...visao.empresa, id: 't-2', name: 'Beta SA' } }),
    });
    const { rerender } = render(<EmpresaPage />);
    await waitFor(() => expect(urls()).toContain('/api/atuacao/empresas/t-1/visao-geral'));
    tenantId = 't-2';
    rerender(<EmpresaPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Beta SA' })).toBeInTheDocument();
    liberarVelha(resp(200, visao));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('heading', { level: 1, name: 'Beta SA' })).toBeInTheDocument();
    expect(screen.queryByText('Alfa Ltda')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('montese_atuacao_ultima_empresa')!)).toEqual({ id: 't-2', name: 'Beta SA' });
  });
});
