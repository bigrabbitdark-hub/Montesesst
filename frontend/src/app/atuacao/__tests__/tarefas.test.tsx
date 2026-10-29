import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: 'k-1', tenantId: 't-1' }),
  useSearchParams: () => new URLSearchParams(search),
}));

import TarefasPage from '../tarefas/page';
import TarefaDetalhePage from '../tarefas/[id]/page';
import FichaPage from '../clientes/[tenantId]/page';
import { ATUACAO_MENU_ITEMS } from '@/lib/dashboard/menu-atuacao';

const minha = {
  id: 'k-1', tenant_id: 't-1', tenant_name: 'Alfa Ltda', title: 'Revisar PGR', priority: 'alta', status: 'pending',
  due_date: '2026-10-25', assignee_user_id: 'u-me', assignee_name: 'Eu Sócio', created_by_name: 'Eu Sócio', vencida: false,
};
const dOutro = {
  ...minha, id: 'k-2', title: 'Visitar obra', assignee_user_id: 'u-2', assignee_name: 'Ana Sócia', vencida: true, due_date: '2026-10-01',
};
const detalhe = {
  ...minha, description: 'Conferir riscos', category: 'PGR', completed_at: null, created_at: '2026-10-10T10:00:00Z',
  eventos: [
    { id: 'e1', type: 'created', actor_name: 'Eu Sócio', from_value: null, to_value: 'pending', note: null, created_at: '2026-10-10T10:00:00Z' },
    { id: 'e2', type: 'status_changed', actor_name: 'Ana Sócia', from_value: 'pending', to_value: 'in_progress', note: 'Começando', created_at: '2026-10-11T10:00:00Z' },
  ],
};

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  search = '';
  localStorage.setItem('montese_token', 'tok');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u-me', role: 'socio', tenantId: null }));
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('menu', () => {
  it('tem "Minhas tarefas" em /atuacao/tarefas', () => {
    expect(ATUACAO_MENU_ITEMS.map((i) => [i.label, i.href])).toContainEqual(['Minhas tarefas', '/atuacao/tarefas']);
    expect(ATUACAO_MENU_ITEMS.every((i) => i.implemented)).toBe(true);
  });
});

describe('lista de tarefas', () => {
  it('carrega assignee=me por padrão e mostra a tarefa', async () => {
    fetchMock.mockResolvedValue(resp(200, [minha]));
    render(<TarefasPage />);
    expect(await screen.findAllByText('Revisar PGR')).not.toHaveLength(0);
    expect(urls()[0]).toContain('/atuacao/tarefas?');
    expect(urls()[0]).toContain('assignee=me');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('"Todas" chama sem assignee; filtros enviam status e vencidas', async () => {
    fetchMock.mockResolvedValue(resp(200, [minha]));
    render(<TarefasPage />);
    await screen.findAllByText('Revisar PGR');
    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'todas' } });
    await waitFor(() => expect(urls().at(-1)).not.toContain('assignee'));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'blocked' } });
    await waitFor(() => expect(urls().at(-1)).toContain('status=blocked'));
    fireEvent.click(screen.getByLabelText('Somente vencidas'));
    await waitFor(() => expect(urls().at(-1)).toContain('vencidas=true'));
  });

  it('repassa tenantId da URL', async () => {
    search = 'tenantId=t-9';
    fetchMock.mockResolvedValue(resp(200, []));
    render(<TarefasPage />);
    await screen.findByText('Nenhuma tarefa encontrada.');
    expect(urls()[0]).toContain('tenantId=t-9');
  });

  it('?vencidas=true na URL já filtra a primeira busca e marca "Somente vencidas"', async () => {
    search = 'vencidas=true';
    fetchMock.mockResolvedValue(resp(200, [dOutro]));
    render(<TarefasPage />);
    await screen.findAllByText('Visitar obra');
    expect(urls()[0]).toContain('vencidas=true');
    expect(urls()).toHaveLength(1);
    expect(screen.getByLabelText('Somente vencidas')).toBeChecked();
  });

  it('?status=blocked na URL filtra a primeira busca e seleciona o status', async () => {
    search = 'status=blocked';
    fetchMock.mockResolvedValue(resp(200, [minha]));
    render(<TarefasPage />);
    await screen.findAllByText('Revisar PGR');
    expect(urls()[0]).toContain('status=blocked');
    expect(urls()).toHaveLength(1);
    expect(screen.getByLabelText('Status')).toHaveValue('blocked');
  });

  it('?status inválido é ignorado', async () => {
    search = 'status=hack';
    fetchMock.mockResolvedValue(resp(200, [minha]));
    render(<TarefasPage />);
    await screen.findAllByText('Revisar PGR');
    expect(urls()[0]).not.toContain('status');
  });

  it('sem ?vencidas na URL o filtro começa desmarcado; outro valor é ignorado', async () => {
    search = 'vencidas=1';
    fetchMock.mockResolvedValue(resp(200, [minha]));
    render(<TarefasPage />);
    await screen.findAllByText('Revisar PGR');
    expect(urls()[0]).not.toContain('vencidas');
    expect(screen.getByLabelText('Somente vencidas')).not.toBeChecked();
  });

  it('marca em texto a tarefa de outro sócio e o selo Vencida', async () => {
    fetchMock.mockResolvedValue(resp(200, [minha, dOutro]));
    render(<TarefasPage />);
    await screen.findAllByText('Visitar obra');
    expect(screen.getAllByText('de Ana Sócia').length).toBeGreaterThan(0);
    expect(screen.queryByText('de Eu Sócio')).toBeNull();
    expect(screen.getAllByText('Vencida').length).toBeGreaterThan(0);
  });

  it('mostra datas dd/mm/aaaa sem deslocar o dia', async () => {
    fetchMock.mockResolvedValue(resp(200, [minha]));
    render(<TarefasPage />);
    expect((await screen.findAllByText('25/10/2026')).length).toBeGreaterThan(0);
  });

  it('erro com Tentar novamente', async () => {
    fetchMock.mockResolvedValueOnce(resp(500, {})).mockResolvedValue(resp(200, [minha]));
    render(<TarefasPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect((await screen.findAllByText('Revisar PGR')).length).toBeGreaterThan(0);
  });

  it('403 mostra mensagem de permissão', async () => {
    fetchMock.mockResolvedValue(resp(403, {}));
    render(<TarefasPage />);
    expect(await screen.findByText('Você não tem permissão para esta ação.')).toBeInTheDocument();
  });

  it('resposta antiga não sobrescreve a nova', async () => {
    let resolveLenta!: (r: Response) => void;
    const lenta = new Promise<Response>((r) => { resolveLenta = r; });
    fetchMock
      .mockResolvedValueOnce(resp(200, [minha]))
      .mockReturnValueOnce(lenta)
      .mockResolvedValueOnce(resp(200, [dOutro]));
    render(<TarefasPage />);
    await screen.findAllByText('Revisar PGR');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'blocked' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'completed' } });
    expect((await screen.findAllByText('Visitar obra')).length).toBeGreaterThan(0);
    resolveLenta(resp(200, [minha]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Revisar PGR')).toBeNull();
  });
});

describe('criar tarefa', () => {
  const clientes = [{ id: 't-1', name: 'Alfa Ltda' }];
  const equipe = [{ id: 'u-me', full_name: 'Eu Sócio' }, { id: 'u-2', full_name: 'Ana Sócia' }];

  function rota(extra?: (url: string, init: RequestInit) => Response | undefined) {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const u = String(url);
      const e = extra?.(u, init);
      if (e) return e;
      if (u.includes('/atuacao/clientes')) return resp(200, clientes);
      if (u.includes('/atuacao/equipe')) return resp(200, equipe);
      return resp(200, []);
    });
  }

  async function abrirForm() {
    render(<TarefasPage />);
    await screen.findByText('Nenhuma tarefa encontrada.');
    fireEvent.click(screen.getByRole('button', { name: 'Nova tarefa' }));
    await screen.findByRole('option', { name: 'Alfa Ltda' });
    await screen.findByRole('option', { name: 'Ana Sócia' });
  }

  it('envia exatamente os campos preenchidos', async () => {
    rota((u, init) => (init?.method === 'POST' ? resp(201, detalhe) : undefined));
    await abrirForm();
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 't-1' } });
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Nova coisa' } });
    fireEvent.change(screen.getByLabelText('Responsável da tarefa'), { target: { value: 'u-2' } });
    fireEvent.change(screen.getByLabelText('Prazo'), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByLabelText('Prioridade'), { target: { value: 'urgente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
    await screen.findByText('Tarefa criada.');
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(String(post[0])).toContain('/atuacao/tarefas');
    expect(JSON.parse(post[1].body)).toEqual({
      tenant_id: 't-1', title: 'Nova coisa', assignee_user_id: 'u-2', due_date: '2026-11-05', priority: 'urgente',
    });
  });

  it('sem prazo não envia due_date', async () => {
    rota((u, init) => (init?.method === 'POST' ? resp(201, detalhe) : undefined));
    await abrirForm();
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 't-1' } });
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
    await screen.findByText('Tarefa criada.');
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).not.toHaveProperty('due_date');
  });

  it.each([
    [400, { message: ['Responsável inválido'] }, 'Responsável inválido'],
    [403, {}, 'Você não tem permissão para esta ação.'],
  ])('em %i mostra a mensagem e mantém o formulário', async (status, body, texto) => {
    rota((u, init) => (init?.method === 'POST' ? resp(status, body) : undefined));
    await abrirForm();
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 't-1' } });
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Mantida' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
    const alerta = await screen.findByText(texto);
    expect(alerta.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByLabelText('Título')).toHaveValue('Mantida');
  });
});

describe('detalhe da tarefa', () => {
  it('mostra campos, histórico em ordem e link para a ficha do cliente', async () => {
    fetchMock.mockResolvedValue(resp(200, detalhe));
    render(<TarefaDetalhePage />);
    expect(await screen.findByRole('heading', { name: 'Revisar PGR' })).toBeInTheDocument();
    expect(screen.getByText('Conferir riscos')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alfa Ltda/ })).toHaveAttribute('href', '/atuacao/clientes/t-1');
    const itens = within(screen.getByRole('list', { name: 'Histórico' })).getAllByRole('listitem');
    expect(itens).toHaveLength(2);
    expect(itens[0]).toHaveTextContent('Tarefa criada');
    expect(itens[1]).toHaveTextContent('Começando');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/atuacao/tarefas/k-1');
  });

  it('oferece só as transições permitidas (pending)', async () => {
    fetchMock.mockResolvedValue(resp(200, detalhe));
    render(<TarefaDetalhePage />);
    await screen.findByRole('heading', { name: 'Revisar PGR' });
    const acoes = screen.getByRole('group', { name: 'Alterar status' });
    expect(within(acoes).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Iniciar', 'Bloquear', 'Cancelar tarefa',
    ]);
  });

  it('em andamento oferece concluir e não menciona aprovar/assinar documento', async () => {
    fetchMock.mockResolvedValue(resp(200, { ...detalhe, status: 'in_progress' }));
    render(<TarefaDetalhePage />);
    await screen.findByRole('heading', { name: 'Revisar PGR' });
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Iniciar' })).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/aprov|assin/i);
  });

  it('bloquear exige motivo e envia status + note', async () => {
    fetchMock
      .mockResolvedValueOnce(resp(200, detalhe))
      .mockResolvedValueOnce(resp(200, { ...detalhe, status: 'blocked' }));
    render(<TarefaDetalhePage />);
    await screen.findByRole('heading', { name: 'Revisar PGR' });
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByText('Informe o motivo.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Aguardando cliente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain('/atuacao/tarefas/k-1/status');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ status: 'blocked', note: 'Aguardando cliente' });
    expect(await screen.findByText('Bloqueada', { selector: 'span' })).toBeInTheDocument();
  });

  it('transição direta envia só o status; erro do servidor aparece', async () => {
    fetchMock
      .mockResolvedValueOnce(resp(200, detalhe))
      .mockResolvedValueOnce(resp(400, { message: 'Transição de status não permitida' }));
    render(<TarefaDetalhePage />);
    await screen.findByRole('heading', { name: 'Revisar PGR' });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar' }));
    expect(await screen.findByText('Transição de status não permitida')).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ status: 'in_progress' });
  });

  it('404 mostra tarefa não encontrada', async () => {
    fetchMock.mockResolvedValue(resp(404, {}));
    render(<TarefaDetalhePage />);
    expect(await screen.findByText('Tarefa não encontrada.')).toBeInTheDocument();
  });
});

describe('ficha: responsáveis', () => {
  const ficha = {
    id: 't-1', name: 'Alfa Ltda', trade_name: 'Alfa', cnpj: '11222333000181', sector: 'M', contact_name: 'Maria',
    contact_phone: '1', status: 'active', situacao: 'ativa', contact_role: null, notes: null, plan: 'pro',
    created_at: '2026-01-01T00:00:00Z', units: [],
    responsaveis: [{ id: 'u-me', full_name: 'Eu Sócio' }, { id: 'u-2', full_name: 'Ana Sócia' }],
  };

  it('lista responsáveis em texto, com link para as tarefas do cliente e sem edição', async () => {
    fetchMock.mockImplementation(async (url: string) => resp(200, String(url).includes('/interacoes') ? [] : ficha));
    render(<FichaPage />);
    expect(await screen.findByText('Eu Sócio')).toBeInTheDocument();
    expect(screen.getByText('Ana Sócia')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver tarefas deste cliente' })).toHaveAttribute('href', '/atuacao/tarefas?tenantId=t-1');
    expect(screen.getAllByRole('textbox').map((el) => el.id).sort()).toEqual(
      ['contact_name', 'contact_phone', 'contact_role', 'notes', 'sector', 'trade_name'],
    );
  });

  it('sem responsáveis mostra aviso', async () => {
    fetchMock.mockImplementation(async (url: string) => resp(200, String(url).includes('/interacoes') ? [] : { ...ficha, responsaveis: [] }));
    render(<FichaPage />);
    expect(await screen.findByText('Nenhum responsável atribuído.')).toBeInTheDocument();
  });
});
