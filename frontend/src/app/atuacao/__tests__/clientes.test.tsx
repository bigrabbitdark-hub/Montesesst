import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ tenantId: 't-1' }),
}));

import ClientesPage from '../clientes/page';
import FichaPage from '../clientes/[tenantId]/page';

const cliente = {
  id: 't-1', name: 'Alfa Ltda', trade_name: 'Alfa', cnpj: '11222333000181', sector: 'Metalurgia',
  contact_name: 'Maria', contact_phone: '11999990000', status: 'active', situacao: 'ativa',
};
const ficha = {
  ...cliente, contact_role: 'Gerente', notes: 'Obs', plan: 'pro', created_at: '2026-01-01T00:00:00Z',
  units: [{ id: 'u-1', name: 'Matriz', address_city: 'Campinas', address_state: 'SP', status: 'active' }],
};

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}


// A ficha também carrega a linha do tempo (/interacoes): roteia por URL e deixa a ficha/PATCH nas respostas em ordem.
function rotaFicha(...respostas: Response[]) {
  const fila = [...respostas];
  fetchMock.mockImplementation(async (url: string) => (/\/(interacoes|financeiro)/.test(String(url)) ? resp(200, []) : fila.shift()));
}
const chamadasFicha = () => fetchMock.mock.calls.filter((c) => !/\/(interacoes|financeiro)/.test(String(c[0])));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.setItem('montese_token', 'tok');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('página de clientes', () => {
  it('mostra os clientes retornados', async () => {
    fetchMock.mockResolvedValue(resp(200, [cliente]));
    render(<ClientesPage />);
    expect((await screen.findAllByText('Alfa Ltda')).length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('mostra estado vazio', async () => {
    fetchMock.mockResolvedValue(resp(200, []));
    render(<ClientesPage />);
    expect(await screen.findByText('Nenhum cliente encontrado.')).toBeInTheDocument();
  });

  it('filtra por busca e situação chamando a API com q e situacao', async () => {
    fetchMock.mockResolvedValue(resp(200, [cliente]));
    render(<ClientesPage />);
    await screen.findAllByText('Alfa Ltda');
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'alfa' } });
    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'trial' } });
    await waitFor(() => {
      const url = String(fetchMock.mock.calls.at(-1)![0]);
      expect(url).toContain('q=alfa');
      expect(url).toContain('situacao=trial');
    });
  });

  it('mostra erro com Tentar novamente', async () => {
    fetchMock.mockResolvedValueOnce(resp(500, {})).mockResolvedValue(resp(200, [cliente]));
    render(<ClientesPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect((await screen.findAllByText('Alfa Ltda')).length).toBeGreaterThan(0);
  });

  it('em 403 mostra mensagem de permissão', async () => {
    fetchMock.mockResolvedValue(resp(403, {}));
    render(<ClientesPage />);
    expect(await screen.findByText('Você não tem permissão para esta ação.')).toBeInTheDocument();
  });
});

describe('página de clientes: corrida de requisições', () => {
  it('resposta antiga não sobrescreve a nova nem zera o loading', async () => {
    const outro = { ...cliente, id: 't-2', name: 'Beta SA', trade_name: null };
    let resolveLenta!: (r: Response) => void;
    const lenta = new Promise<Response>((r) => { resolveLenta = r; });
    fetchMock
      .mockResolvedValueOnce(resp(200, [cliente]))
      .mockReturnValueOnce(lenta)
      .mockResolvedValueOnce(resp(200, [outro]));
    render(<ClientesPage />);
    await screen.findAllByText('Alfa Ltda');
    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'trial' } });
    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'ativa' } });
    expect((await screen.findAllByText('Beta SA')).length).toBeGreaterThan(0);
    resolveLenta(resp(200, [cliente]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Alfa Ltda')).toBeNull();
    expect(screen.getAllByText('Beta SA').length).toBeGreaterThan(0);
  });
});

describe('sessão expirada (401)', () => {
  it('limpa a sessão e redireciona para /login', async () => {
    localStorage.setItem('montese_user', '{}');
    const loc = { href: '/atuacao/clientes' };
    vi.stubGlobal('location', loc);
    fetchMock.mockResolvedValue(resp(401, {}));
    render(<ClientesPage />);
    expect(await screen.findByText('Sua sessão expirou. Entre novamente.')).toBeInTheDocument();
    expect(localStorage.getItem('montese_token')).toBeNull();
    expect(localStorage.getItem('montese_user')).toBeNull();
    expect(loc.href).toBe('/login');
  });
});

describe('ficha do cliente', () => {
  it('campo originalmente null deixado vazio não é enviado', async () => {
    rotaFicha(resp(200, { ...ficha, notes: null, contact_role: null }), resp(200, ficha));
    render(<FichaPage />);
    await screen.findByText(/Matriz/);
    fireEvent.change(screen.getByLabelText('Setor'), { target: { value: 'Outro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Dados atualizados.');
    expect(JSON.parse(chamadasFicha()[1][1].body)).toEqual({ sector: 'Outro' });
  });

  it('sem alteração não chama a API e avisa', async () => {
    rotaFicha(resp(200, ficha));
    render(<FichaPage />);
    await screen.findByText(/Matriz/);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Nenhuma alteração para salvar.')).toBeInTheDocument();
    expect(chamadasFicha()).toHaveLength(1);
  });

  it('mostra dados fixos como texto e envia só os 6 campos editáveis', async () => {
    rotaFicha(resp(200, ficha), resp(200, { ...ficha, sector: 'Química' }));
    render(<FichaPage />);
    expect(await screen.findByText(/Matriz/)).toBeInTheDocument();
    const nomes = screen.getAllByRole('textbox').map((el) => el.getAttribute('id'));
    expect(nomes.sort()).toEqual(['contact_name', 'contact_phone', 'contact_role', 'notes', 'sector', 'trade_name']);
    for (const el of screen.getAllByRole('textbox')) {
      expect(el.getAttribute('aria-label') ?? '').not.toMatch(/cnpj|raz[aã]o|plano|situa/i);
      expect(document.querySelector(`label[for="${el.id}"]`)?.textContent ?? '').not.toMatch(/cnpj|raz[aã]o|plano|situa/i);
    }
    const setor = screen.getByLabelText('Setor');
    fireEvent.change(setor, { target: { value: 'Química' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Dados atualizados.')).toBeInTheDocument();
    const [url, init] = chamadasFicha()[1];
    expect(String(url)).toContain('/atuacao/clientes/t-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ sector: 'Química' });
  });

  it.each([
    [400, { message: ['sector must be shorter'] }, 'sector must be shorter'],
    [403, {}, 'Você não tem permissão para esta ação.'],
  ])('em %i mostra mensagem e mantém o formulário', async (status, body, texto) => {
    rotaFicha(resp(200, ficha), resp(status, body));
    render(<FichaPage />);
    await screen.findByText(/Matriz/);
    const setor = screen.getByLabelText('Setor');
    fireEvent.change(setor, { target: { value: 'MetalurgiaX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(texto)).toBeInTheDocument();
    expect(screen.getByLabelText('Setor')).toHaveValue('MetalurgiaX');
  });
});
