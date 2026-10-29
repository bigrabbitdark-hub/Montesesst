import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(search),
}));

import VencimentosPage from '../vencimentos/page';

const item = (n: number, extra: object = {}) => ({
  documento_id: `d-${n}`, tenant_id: 't-1', empresa: 'Alfa Ltda', titulo: `Laudo ${n}`, categoria: 'laudo',
  expires_at: '2026-11-05', dias: 7, href: '/atuacao/empresas/t-1', ...extra,
});
const clientes = [{ id: 't-1', name: 'Alfa Ltda' }, { id: 't-2', name: 'Beta SA' }];

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
let venc: (u: string) => Promise<Response>;
let cli: () => Promise<Response>;
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));
const vencUrls = () => urls().filter((u) => u.includes('/atuacao/vencimentos'));

beforeEach(() => {
  search = '';
  localStorage.setItem('montese_token', 'tok');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u-me', role: 'socio', tenantId: null }));
  venc = async () => resp(200, { itens: [item(1)], total: 1 });
  cli = async () => resp(200, clientes);
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/atuacao/vencimentos')) return venc(u);
    if (u.endsWith('/atuacao/clientes')) return cli();
    return resp(200, []);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('vencimentos', () => {
  it('padrão: faixa vencidos, página 1, com token', async () => {
    render(<VencimentosPage />);
    await screen.findByText('Laudo 1');
    expect(vencUrls()[0]).toBe('/api/atuacao/vencimentos?faixa=vencidos&page=1');
    expect(fetchMock.mock.calls.find((c) => String(c[0]).includes('vencimentos'))![1].headers.Authorization).toBe('Bearer tok');
  });

  it('faixa vem da URL e valor inválido cai em vencidos', async () => {
    search = 'faixa=15';
    const { unmount } = render(<VencimentosPage />);
    await screen.findByText('Laudo 1');
    expect(vencUrls()[0]).toContain('faixa=15');
    unmount();
    fetchMock.mockClear();
    search = 'faixa=99';
    render(<VencimentosPage />);
    await screen.findByText('Laudo 1');
    expect(vencUrls()[0]).toContain('faixa=vencidos');
  });

  it('tenantId da URL é repassado', async () => {
    search = 'tenantId=t-2';
    render(<VencimentosPage />);
    await screen.findByText('Laudo 1');
    expect(vencUrls()[0]).toContain('tenantId=t-2');
  });

  it('faixas com rótulos cumulativos; trocar de faixa refaz a busca na página 1', async () => {
    render(<VencimentosPage />);
    await screen.findByText('Laudo 1');
    for (const r of ['Vencidos', 'Vencem em até 7 dias', 'Vencem em até 15 dias', 'Vencem em até 30 dias']) {
      expect(screen.getByRole('button', { name: r })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Vencidos' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Vencem em até 30 dias' }));
    await waitFor(() => expect(vencUrls().at(-1)).toBe('/api/atuacao/vencimentos?faixa=30&page=1'));
    expect(screen.getByRole('button', { name: 'Vencem em até 30 dias' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('filtro de empresa usa GET /clientes e envia tenantId', async () => {
    render(<VencimentosPage />);
    await screen.findByText('Laudo 1');
    const sel = await screen.findByLabelText('Empresa');
    await waitFor(() => expect(within(sel).getByRole('option', { name: 'Beta SA' })).toBeInTheDocument());
    fireEvent.change(sel, { target: { value: 't-2' } });
    await waitFor(() => expect(vencUrls().at(-1)).toContain('tenantId=t-2'));
    fireEvent.change(sel, { target: { value: '' } });
    await waitFor(() => expect(vencUrls().at(-1)).not.toContain('tenantId'));
  });

  it('falha ao carregar empresas avisa mas não impede a lista', async () => {
    cli = async () => resp(500, {});
    render(<VencimentosPage />);
    expect(await screen.findByText('Laudo 1')).toBeInTheDocument();
    expect(await screen.findByText(/filtro de empresas/i)).toBeInTheDocument();
  });

  it('linha: empresa, documento, categoria, vencimento dd/mm/aaaa, dias e link da empresa', async () => {
    venc = async () => resp(200, { itens: [
      item(1, { dias: 7 }), item(2, { dias: 0, titulo: 'Hoje doc' }), item(3, { dias: -1, titulo: 'Ontem doc', expires_at: '2026-10-28' }),
      item(4, { dias: -12, titulo: 'Velho doc' }), item(5, { dias: 1, titulo: 'Amanhã doc' }),
    ], total: 5 });
    render(<VencimentosPage />);
    const linha = (await screen.findByText('Laudo 1')).closest('tr')!;
    expect(linha).toHaveTextContent('Alfa Ltda');
    expect(linha).toHaveTextContent('Laudo');
    expect(linha).toHaveTextContent('05/11/2026');
    expect(linha).toHaveTextContent('Vence em 7 dias');
    expect(within(linha).getByRole('link', { name: /Alfa Ltda/ })).toHaveAttribute('href', '/atuacao/empresas/t-1');
    expect(screen.getByText('Hoje doc').closest('tr')).toHaveTextContent('Vence hoje');
    expect(screen.getByText('Ontem doc').closest('tr')).toHaveTextContent('Vencido há 1 dia');
    expect(screen.getByText('Velho doc').closest('tr')).toHaveTextContent('Vencido há 12 dias');
    expect(screen.getByText('Amanhã doc').closest('tr')).toHaveTextContent('Vence em 1 dia');
  });

  it('href fora de /atuacao/ não vira link', async () => {
    venc = async () => resp(200, { itens: [item(1, { href: 'https://evil.example' })], total: 1 });
    render(<VencimentosPage />);
    const linha = (await screen.findByText('Laudo 1')).closest('tr')!;
    expect(within(linha).queryByRole('link')).toBeNull();
  });

  it('vazio explícito por faixa', async () => {
    venc = async () => resp(200, { itens: [], total: 0 });
    render(<VencimentosPage />);
    expect(await screen.findByText('Nenhum documento nesta faixa.')).toBeInTheDocument();
  });

  it('paginação: 100 por página, próxima/anterior, total real', async () => {
    venc = async (u) => resp(200, { itens: [item(u.includes('page=2') ? 2 : 1)], total: 250 });
    render(<VencimentosPage />);
    await screen.findByText('Laudo 1');
    expect(screen.getByText('Página 1 de 3 (250 documentos)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByText('Laudo 2');
    expect(vencUrls().at(-1)).toBe('/api/atuacao/vencimentos?faixa=vencidos&page=2');
    expect(screen.getByText('Página 2 de 3 (250 documentos)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await screen.findByText('Laudo 1');
  });

  it('ao trocar de página mostra "Atualizando…" e não a tabela antiga', async () => {
    let soltar!: (r: Response) => void;
    let n = 0;
    venc = () => (++n === 1 ? Promise.resolve(resp(200, { itens: [item(1)], total: 250 })) : new Promise<Response>((r) => { soltar = r; }));
    render(<VencimentosPage />);
    await screen.findByText('Laudo 1');
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByText('Atualizando…')).toBeInTheDocument();
    expect(screen.queryByText('Laudo 1')).toBeNull();
    soltar(resp(200, { itens: [item(2)], total: 250 }));
    expect(await screen.findByText('Laudo 2')).toBeInTheDocument();
    expect(screen.queryByText('Atualizando…')).toBeNull();
  });

  it('se o total encolher e a página não existir mais, volta para a última existente', async () => {
    let p2 = 0;
    venc = async (u) => {
      if (u.includes('page=3')) return resp(200, { itens: [], total: 150 });
      if (u.includes('page=2')) { p2 += 1; return resp(200, { itens: [item(2)], total: p2 === 1 ? 250 : 150 }); }
      return resp(200, { itens: [item(1)], total: 250 });
    };
    render(<VencimentosPage />);
    await screen.findByText('Laudo 1');
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await screen.findByText('Laudo 2');
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByText('Página 2 de 2 (150 documentos)')).toBeInTheDocument();
    expect(vencUrls().at(-1)).toContain('page=2');
    expect(screen.getByText('Página 2 de 2 (150 documentos)')).toBeInTheDocument();
  });

  it('href com ".." não vira link', async () => {
    venc = async () => resp(200, { itens: [item(1, { href: '/atuacao/../admin' })], total: 1 });
    render(<VencimentosPage />);
    const linha = (await screen.findByText('Laudo 1')).closest('tr')!;
    expect(within(linha).queryByRole('link')).toBeNull();
  });

  it('sem paginação quando cabe em uma página', async () => {
    render(<VencimentosPage />);
    await screen.findByText('Laudo 1');
    expect(screen.queryByRole('button', { name: 'Próxima' })).toBeNull();
  });

  it('trocar de faixa volta para a página 1', async () => {
    venc = async () => resp(200, { itens: [item(1)], total: 250 });
    render(<VencimentosPage />);
    await screen.findByText('Laudo 1');
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    await waitFor(() => expect(vencUrls().at(-1)).toContain('page=2'));
    fireEvent.click(screen.getByRole('button', { name: 'Vencem em até 7 dias' }));
    await waitFor(() => expect(vencUrls().at(-1)).toBe('/api/atuacao/vencimentos?faixa=7&page=1'));
  });

  it.each([
    [500, 'Algo deu errado. Tente novamente.'],
    [403, 'Você não tem permissão para esta ação.'],
    [404, 'Empresa não encontrada.'],
  ])('erro %i mostra mensagem e Tentar novamente', async (status, msg) => {
    venc = async () => resp(status, {});
    render(<VencimentosPage />);
    expect(await screen.findByText(msg)).toBeInTheDocument();
    venc = async () => resp(200, { itens: [item(1)], total: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Laudo 1')).toBeInTheDocument();
  });

  it('400 mostra a mensagem do servidor', async () => {
    venc = async () => resp(400, { message: ['faixa inválida'] });
    render(<VencimentosPage />);
    expect(await screen.findByText('faixa inválida')).toBeInTheDocument();
  });

  it('401 limpa a sessão e vai para /login', async () => {
    const loc = { href: '' };
    vi.stubGlobal('location', loc);
    venc = async () => resp(401, {});
    render(<VencimentosPage />);
    await waitFor(() => expect(loc.href).toBe('/login'));
  });

  it('resposta antiga não sobrescreve a nova (troca rápida de faixa)', async () => {
    let soltarLenta!: (r: Response) => void;
    const lenta = new Promise<Response>((r) => { soltarLenta = r; });
    venc = (u) => (u.includes('faixa=vencidos') ? lenta : Promise.resolve(resp(200, { itens: [item(7, { titulo: 'Doc novo' })], total: 1 })));
    render(<VencimentosPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Vencem em até 7 dias' }));
    await screen.findByText('Doc novo');
    soltarLenta(resp(200, { itens: [item(8, { titulo: 'Doc antigo' })], total: 1 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('Doc novo')).toBeInTheDocument();
    expect(screen.queryByText('Doc antigo')).toBeNull();
  });
});
