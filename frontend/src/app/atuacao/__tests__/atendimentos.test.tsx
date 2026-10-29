import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(''),
}));

import AtendimentosPage from '../atendimentos/page';
import { ATUACAO_MENU_ITEMS } from '@/lib/dashboard/menu-atuacao';

const item = (n: number, extra: object = {}) => ({
  id: `i-${n}`, tenant_id: `t-${n}`, empresa: `Empresa ${n}`, type: 'reuniao', occurred_on: '2026-10-25',
  summary: `Resumo ${n}`, summary_truncado: false, created_by_name: 'Ana Sócia', href: `/atuacao/empresas/t-${n}`, ...extra,
});
const clientes = [{ id: 't-1', name: 'Empresa 1' }, { id: 't-2', name: 'Empresa 2' }];

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
let lista: (url: string) => Promise<Response>;
const listaUrls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/atuacao/interacoes'));

beforeEach(() => {
  localStorage.setItem('montese_token', 'tok');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u-me', role: 'socio', tenantId: null }));
  lista = async () => resp(200, { itens: [item(1)], total: 1, page: 1, page_size: 100 });
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/atuacao/interacoes')) return lista(u);
    if (u.endsWith('/atuacao/clientes')) return resp(200, clientes);
    return resp(200, []);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('menu', () => {
  it('tem "Histórico de atendimento" em /atuacao/atendimentos', () => {
    expect(ATUACAO_MENU_ITEMS.map((i) => [i.label, i.href])).toContainEqual(['Histórico de atendimento', '/atuacao/atendimentos']);
  });
});

describe('histórico de atendimento', () => {
  it('chama GET /api/atuacao/interacoes?page=1 com o token e mostra a linha', async () => {
    render(<AtendimentosPage />);
    expect(await screen.findByRole('heading', { name: 'Histórico de atendimento' })).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: 'Empresa 1' });
    expect(link).toHaveAttribute('href', '/atuacao/empresas/t-1');
    const linha = link.closest('tr')!;
    expect(linha).toHaveTextContent('25/10/2026');
    expect(linha).toHaveTextContent('Reunião');
    expect(linha).toHaveTextContent('Resumo 1');
    expect(linha).toHaveTextContent('Ana Sócia');
    expect(listaUrls()[0]).toBe('/api/atuacao/interacoes?page=1');
    const c = fetchMock.mock.calls.find((x) => String(x[0]).includes('/atuacao/interacoes'))!;
    expect(c[1].headers.Authorization).toBe('Bearer tok');
  });

  it('resumo truncado recebe reticências; completo não', async () => {
    lista = async () => resp(200, { itens: [item(1, { summary_truncado: true }), item(2)], total: 2, page: 1, page_size: 100 });
    render(<AtendimentosPage />);
    await screen.findByText('Resumo 1…');
    expect(screen.getByText('Resumo 2')).toBeInTheDocument();
  });

  it('href fora de /atuacao/ não vira link; responsável ausente vira traço', async () => {
    lista = async () => resp(200, { itens: [item(1, { href: 'https://evil.example', created_by_name: null })], total: 1, page: 1, page_size: 100 });
    render(<AtendimentosPage />);
    await screen.findByRole('cell', { name: 'Empresa 1' });
    expect(screen.queryByRole('link', { name: 'Empresa 1' })).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('filtros enviam tenantId, tipo, from e to e voltam à página 1', async () => {
    render(<AtendimentosPage />);
    await screen.findByRole('link', { name: 'Empresa 1' });
    await screen.findByRole('option', { name: 'Empresa 2' });
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 't-2' } });
    await waitFor(() => expect(listaUrls().at(-1)).toContain('tenantId=t-2'));
    fireEvent.change(screen.getByLabelText('Tipo de contato'), { target: { value: 'visita' } });
    await waitFor(() => expect(listaUrls().at(-1)).toContain('tipo=visita'));
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-10-31' } });
    await waitFor(() => {
      const u = listaUrls().at(-1)!;
      expect(u).toContain('from=2026-10-01');
      expect(u).toContain('to=2026-10-31');
      expect(u).toContain('page=1');
    });
  });

  it('período invertido (De > Até) mostra alerta e não consulta o servidor', async () => {
    render(<AtendimentosPage />);
    await screen.findByRole('link', { name: 'Empresa 1' });
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-20' } });
    const antes = listaUrls().length;
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-10-10' } });
    expect(await screen.findByText('A data inicial deve ser anterior ou igual à data final.')).toBeInTheDocument();
    expect(listaUrls().length).toBe(antes);
    expect(screen.queryByRole('link', { name: 'Empresa 1' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-10-20' } });
    await screen.findByRole('link', { name: 'Empresa 1' });
    expect(screen.queryByText('A data inicial deve ser anterior ou igual à data final.')).toBeNull();
  });

  it('paginação de 100 em 100: Próxima/Anterior e resumo "Página X de Y"', async () => {
    lista = async (u) => resp(200, {
      itens: [item(u.includes('page=2') ? 2 : 1)], total: 250, page: u.includes('page=2') ? 2 : 1, page_size: 100,
    });
    render(<AtendimentosPage />);
    await screen.findByText('Página 1 de 3 (250 atendimentos)');
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByText('Página 2 de 3 (250 atendimentos)');
    expect(listaUrls().at(-1)).toContain('page=2');
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await screen.findByText('Página 1 de 3 (250 atendimentos)');
  });

  it('sem paginação quando cabe em uma página', async () => {
    render(<AtendimentosPage />);
    await screen.findByText('Empresa 1');
    expect(screen.queryByRole('navigation', { name: 'Paginação' })).toBeNull();
  });

  it('vazio explícito', async () => {
    lista = async () => resp(200, { itens: [], total: 0, page: 1, page_size: 100 });
    render(<AtendimentosPage />);
    expect(await screen.findByText('Nenhum atendimento encontrado.')).toBeInTheDocument();
  });

  it.each([
    [403, {}, 'Você não tem permissão para esta ação.'],
    [404, {}, 'Empresa não encontrada.'],
    [400, { message: ['tipo must be one of the following values'] }, 'tipo must be one of the following values'],
    [500, {}, 'Algo deu errado. Tente novamente.'],
  ])('erro %i mostra a mensagem do servidor/padrão e Tentar novamente', async (status, body, texto) => {
    lista = async () => resp(status, body);
    render(<AtendimentosPage />);
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent(texto);
    expect(within(a).getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('401 limpa a sessão e vai para /login', async () => {
    const loc = { href: '' };
    vi.stubGlobal('location', loc);
    lista = async () => resp(401, {});
    render(<AtendimentosPage />);
    await waitFor(() => expect(loc.href).toBe('/login'));
    expect(localStorage.getItem('montese_token')).toBeNull();
  });

  it('falha ao carregar empresas avisa, mas a lista continua', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/atuacao/interacoes')) return lista(u);
      return resp(500, {});
    });
    render(<AtendimentosPage />);
    await screen.findByText('Empresa 1');
    expect(screen.getByText('Não foi possível carregar o filtro de empresas. A lista continua disponível.')).toBeInTheDocument();
  });

  it('resposta antiga não sobrescreve a nova (troca rápida de filtro)', async () => {
    let soltarLenta!: (r: Response) => void;
    const lenta = new Promise<Response>((r) => { soltarLenta = r; });
    lista = (u) => (u.includes('tipo=email') ? lenta : u.includes('tipo=visita')
      ? Promise.resolve(resp(200, { itens: [item(7, { empresa: 'Doc novo' })], total: 1, page: 1, page_size: 100 }))
      : Promise.resolve(resp(200, { itens: [item(1)], total: 1, page: 1, page_size: 100 })));
    render(<AtendimentosPage />);
    await screen.findByText('Empresa 1');
    fireEvent.change(screen.getByLabelText('Tipo de contato'), { target: { value: 'email' } });
    fireEvent.change(screen.getByLabelText('Tipo de contato'), { target: { value: 'visita' } });
    await screen.findByText('Doc novo');
    soltarLenta(resp(200, { itens: [item(8, { empresa: 'Doc antigo' })], total: 1, page: 1, page_size: 100 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('Doc novo')).toBeInTheDocument();
    expect(screen.queryByText('Doc antigo')).toBeNull();
  });

  it('resposta com formato inesperado vira erro, não tela vazia', async () => {
    lista = async () => resp(200, { foo: 1 });
    render(<AtendimentosPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Histórico de atendimento indisponível. Tente novamente.');
  });
});
