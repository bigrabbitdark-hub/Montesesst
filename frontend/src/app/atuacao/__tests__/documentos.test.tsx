import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

let search = '';
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
  useParams: () => ({ tenantId: 't-1' }),
  useSearchParams: () => new URLSearchParams(search),
}));

import DocumentosPage from '../documentos/page';
import FichaPage from '../clientes/[tenantId]/page';
import { ATUACAO_MENU_ITEMS } from '@/lib/dashboard/menu-atuacao';

const doc = {
  id: 'd-1', tenant_id: 't-1', tenant_name: 'Alfa Ltda', category: 'pgr', title: 'PGR 2026', status: 'em_revisao',
  current_version_id: 'v-1', versao_atual: 3, published_document_id: null, created_by: 'u-me', created_by_name: 'Eu Sócio',
  created_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-12T15:30:00Z',
};
const doc2 = { ...doc, id: 'd-2', title: 'Laudo galpão', category: 'laudo', status: 'assinado', versao_atual: 1, tenant_name: 'Beta SA', tenant_id: 't-2' };
const doc3 = { ...doc, id: 'd-3', title: 'Ata CIPA', category: 'cipa_ata', status: 'em_elaboracao', versao_atual: null, current_version_id: null };
const doc4 = { ...doc, id: 'd-4', title: 'PCMSO velho', category: 'pcmso', status: 'publicado' };
const clientes = [
  { id: 't-1', name: 'Alfa Ltda' }, { id: 't-2', name: 'Beta SA' },
];
const fichaCli = { ...clientes[0], cnpj: '12345678000190', plan: 'basic', situacao: 'ativa', status: 'active', trade_name: null, sector: null, contact_name: null, contact_phone: null, contact_role: null, notes: null, created_at: '2026-01-01T00:00:00Z', units: [{ id: 'un-1', name: 'Matriz SP', address_city: 'SP', address_state: 'SP', status: 'active' }], responsaveis: [] };

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  search = '';
  push.mockReset();
  localStorage.setItem('montese_token', 'tok');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u-me', role: 'socio', tenantId: null }));
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function rota(lista: unknown[] = [doc, doc2, doc3, doc4], extra?: (u: string, init?: RequestInit) => Response | undefined) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const e = extra?.(u, init);
    if (e) return e;
    if (u.includes('/atuacao/documentos')) return resp(200, lista);
    if (u.includes('/atuacao/clientes/')) return resp(200, fichaCli);
    if (u.includes('/atuacao/clientes')) return resp(200, clientes);
    return resp(200, []);
  });
}

describe('menu', () => {
  it('tem "Documentos" em /atuacao/documentos e só rotas implementadas', () => {
    expect(ATUACAO_MENU_ITEMS.map((i) => [i.label, i.href])).toContainEqual(['Documentos', '/atuacao/documentos']);
    expect(ATUACAO_MENU_ITEMS.every((i) => i.implemented)).toBe(true);
  });
});

describe('lista de documentos', () => {
  it('mostra título, cliente, categoria, estado em português, versão e atualização', async () => {
    rota();
    render(<DocumentosPage />);
    expect((await screen.findAllByText('PGR 2026')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Alfa Ltda').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Em revisão').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Assinado (registro interno)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Em elaboração').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Publicado').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Laudo').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Versão 3/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/12\/10\/2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sem versão').length).toBeGreaterThan(0);
  });

  it('não usa termos proibidos na interface', async () => {
    rota();
    const { container } = render(<DocumentosPage />);
    await screen.findAllByText('PGR 2026');
    const txt = (container.textContent ?? '').toLowerCase();
    expect(txt).not.toContain('assinatura digital');
    expect(txt).not.toContain('icp-brasil');
  });

  it('título leva ao detalhe', async () => {
    rota();
    render(<DocumentosPage />);
    const links = await screen.findAllByRole('link', { name: 'PGR 2026' });
    expect(links[0].getAttribute('href')).toBe('/atuacao/documentos/d-1');
  });

  it('filtros enviam status, category e tenantId', async () => {
    rota();
    render(<DocumentosPage />);
    await screen.findAllByText('PGR 2026');
    await screen.findByRole('option', { name: 'Beta SA' });
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'em_revisao' } });
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'pgr' } });
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 't-1' } });
    await waitFor(() => {
      const u = urls().filter((x) => x.includes('/atuacao/documentos')).pop()!;
      expect(u).toContain('status=em_revisao');
      expect(u).toContain('category=pgr');
      expect(u).toContain('tenantId=t-1');
    });
  });

  it('lê tenantId da URL', async () => {
    search = 'tenantId=t-2';
    rota();
    render(<DocumentosPage />);
    await waitFor(() => expect(urls().some((x) => x.includes('/atuacao/documentos?') && x.includes('tenantId=t-2'))).toBe(true));
  });

  it('descarta resposta antiga (sem corrida)', async () => {
    let liberar!: (r: Response) => void;
    let n = 0;
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/atuacao/clientes')) return resp(200, clientes);
      n += 1;
      if (n === 1) return new Promise<Response>((r) => { liberar = r; });
      return resp(200, [doc2]);
    });
    render(<DocumentosPage />);
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'assinado' } });
    expect((await screen.findAllByText('Laudo galpão')).length).toBeGreaterThan(0);
    liberar(resp(200, [doc]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('PGR 2026')).toBeNull();
  });

  it('estado vazio', async () => {
    rota([]);
    render(<DocumentosPage />);
    expect(await screen.findByText('Nenhum documento em elaboração.')).toBeInTheDocument();
  });

  it('erro com Tentar novamente', async () => {
    let primeira = true;
    rota([doc], (u) => {
      if (u.includes('/atuacao/documentos') && primeira) { primeira = false; return resp(500, {}); }
      return undefined;
    });
    render(<DocumentosPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect((await screen.findAllByText('PGR 2026')).length).toBeGreaterThan(0);
  });

  it('403 mostra mensagem de permissão', async () => {
    rota([], (u) => (u.includes('/atuacao/documentos') ? resp(403, {}) : undefined));
    render(<DocumentosPage />);
    expect(await screen.findByText('Você não tem permissão para esta ação.')).toBeInTheDocument();
  });

  it('401 limpa a sessão e vai ao /login', async () => {
    const loc = { href: '' } as Location;
    vi.stubGlobal('location', loc);
    rota([], (u) => (u.includes('/atuacao/documentos') ? resp(401, {}) : undefined));
    render(<DocumentosPage />);
    await waitFor(() => expect(loc.href).toBe('/login'));
    expect(localStorage.getItem('montese_token')).toBeNull();
  });
});

describe('criar rascunho', () => {
  async function abrir() {
    rota([doc], undefined);
    render(<DocumentosPage />);
    await screen.findAllByText('PGR 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Novo rascunho' }));
    const form = (await screen.findByRole('form', { name: 'Novo rascunho' })) as HTMLElement;
    await within(form).findByRole('option', { name: 'Alfa Ltda' });
    return form;
  }

  it('envia só os campos preenchidos e navega ao detalhe', async () => {
    const form = await abrir();
    let corpo: Record<string, string> | null = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST') { corpo = JSON.parse(String(init.body)); return resp(201, { id: 'd-9' }); }
      if (u.includes('/atuacao/clientes/')) return resp(200, fichaCli);
      if (u.includes('/atuacao/clientes')) return resp(200, clientes);
      return resp(200, [doc]);
    });
    fireEvent.change(within(form).getByLabelText('Cliente'), { target: { value: 't-1' } });
    fireEvent.change(within(form).getByLabelText('Categoria'), { target: { value: 'ltcat' } });
    fireEvent.change(within(form).getByLabelText('Título'), { target: { value: '  LTCAT novo  ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Criar rascunho' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/atuacao/documentos/d-9'));
    expect(corpo).toEqual({ tenant_id: 't-1', category: 'ltcat', title: 'LTCAT novo' });
  });

  it('inclui a unidade quando escolhida', async () => {
    const form = await abrir();
    let corpo: Record<string, string> | null = null;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST') { corpo = JSON.parse(String(init.body)); return resp(201, { id: 'd-9' }); }
      if (u.includes('/atuacao/clientes/')) return resp(200, fichaCli);
      return resp(200, clientes);
    });
    fireEvent.change(within(form).getByLabelText('Cliente'), { target: { value: 't-1' } });
    await within(form).findByRole('option', { name: 'Matriz SP' });
    fireEvent.change(within(form).getByLabelText('Unidade (opcional)'), { target: { value: 'un-1' } });
    fireEvent.change(within(form).getByLabelText('Categoria'), { target: { value: 'pgr' } });
    fireEvent.change(within(form).getByLabelText('Título'), { target: { value: 'X' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Criar rascunho' }));
    await waitFor(() => expect(corpo).toEqual({ tenant_id: 't-1', category: 'pgr', title: 'X', company_unit_id: 'un-1' }));
  });

  it('exige cliente, categoria e título antes de enviar', async () => {
    const form = await abrir();
    fireEvent.click(within(form).getByRole('button', { name: 'Criar rascunho' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Informe cliente, categoria e título.');
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('403 de matriz mostra a mensagem do servidor e mantém o formulário', async () => {
    const form = await abrir();
    const msg = 'Ação não habilitada para este tipo de documento. Peça ao administrador para configurar as responsabilidades.';
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return resp(403, { statusCode: 403, message: msg });
      if (String(url).includes('/atuacao/clientes/')) return resp(200, fichaCli);
      return resp(200, clientes);
    });
    fireEvent.change(within(form).getByLabelText('Cliente'), { target: { value: 't-1' } });
    fireEvent.change(within(form).getByLabelText('Categoria'), { target: { value: 'pgr' } });
    fireEvent.change(within(form).getByLabelText('Título'), { target: { value: 'Mantido' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Criar rascunho' }));
    const alerta = await within(form).findByText(msg);
    expect(alerta.closest('[role="alert"]')).not.toBeNull();
    expect(within(form).getByLabelText('Título')).toHaveValue('Mantido');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('ficha', () => {
  it('ficha do cliente tem o link "Documentos deste cliente"', async () => {
    rota([doc], (u) => (u.includes('/interacoes') || u.includes('/financeiro') ? resp(200, u.includes('/financeiro') ? {} : []) : undefined));
    render(<FichaPage />);
    const link = await screen.findByRole('link', { name: 'Documentos deste cliente' });
    expect(link.getAttribute('href')).toBe('/atuacao/documentos?tenantId=t-1');
  });
});
