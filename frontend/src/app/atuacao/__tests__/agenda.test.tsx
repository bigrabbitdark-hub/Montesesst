import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ tenantId: 't-1' }),
  useSearchParams: () => new URLSearchParams(''),
}));

import AgendaPage from '../agenda/page';
import FichaPage from '../clientes/[tenantId]/page';
import { ATUACAO_MENU_ITEMS } from '@/lib/dashboard/menu-atuacao';

const ev = {
  id: 'e-1', tenant_id: 't-1', tenant_name: 'Alfa Ltda', owner_user_id: 'u-me', owner_name: 'Eu Sócio',
  type: 'reuniao', title: 'Kickoff PGR', event_date: '2026-10-21', start_time: '09:00', end_time: '10:00', status: 'agendado',
};
const evOutro = {
  ...ev, id: 'e-2', title: 'Visita à obra', type: 'visita', owner_user_id: 'u-2', owner_name: 'Ana Sócia',
  event_date: '2026-10-22', start_time: null, end_time: null,
};
const evConcluido = { ...ev, id: 'e-3', title: 'Já feito', status: 'concluido', event_date: '2026-10-21' };
const clientes = [{ id: 't-1', name: 'Alfa Ltda' }];
const equipe = [{ id: 'u-me', full_name: 'Eu Sócio' }, { id: 'u-2', full_name: 'Ana Sócia' }];

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T15:00:00Z') });
  localStorage.setItem('montese_token', 'tok');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u-me', role: 'socio', tenantId: null }));
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function rota(lista: unknown[], extra?: (u: string, init: RequestInit) => Response | undefined) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const u = String(url);
    const e = extra?.(u, init);
    if (e) return e;
    if (u.includes('/atuacao/clientes')) return resp(200, clientes);
    if (u.includes('/atuacao/equipe')) return resp(200, equipe);
    if (u.includes('/atuacao/agenda')) return resp(200, lista);
    return resp(200, []);
  });
}

describe('menu', () => {
  it('tem "Agenda" em /atuacao/agenda e só rotas existentes', () => {
    expect(ATUACAO_MENU_ITEMS.map((i) => [i.label, i.href])).toContainEqual(['Agenda', '/atuacao/agenda']);
    expect(ATUACAO_MENU_ITEMS.every((i) => i.implemented)).toBe(true);
  });
});

describe('lista da agenda', () => {
  it('carrega por padrão meus compromissos de hoje a +14 dias', async () => {
    rota([ev]);
    render(<AgendaPage />);
    expect((await screen.findAllByText('Kickoff PGR')).length).toBeGreaterThan(0);
    const u = urls().find((x) => x.includes('/atuacao/agenda'))!;
    expect(u).toContain('owner=me');
    expect(u).toContain('from=2026-10-20');
    expect(u).toContain('to=2026-11-03');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    expect(screen.getByLabelText('De')).toHaveValue('2026-10-20');
    expect(screen.getByLabelText('Até')).toHaveValue('2026-11-03');
  });

  it('agrupa por dia com data dd/mm/aaaa e mostra horário', async () => {
    rota([ev, evOutro]);
    render(<AgendaPage />);
    await screen.findAllByText('Kickoff PGR');
    expect(screen.getByRole('heading', { name: '21/10/2026' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '22/10/2026' })).toBeInTheDocument();
    expect(screen.getAllByText('09:00 – 10:00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dia inteiro').length).toBeGreaterThan(0);
  });

  it('marca em texto o compromisso de outro sócio', async () => {
    rota([ev, evOutro]);
    render(<AgendaPage />);
    await screen.findAllByText('Visita à obra');
    expect(screen.getAllByText('de Ana Sócia').length).toBeGreaterThan(0);
    expect(screen.queryByText('de Eu Sócio')).toBeNull();
  });

  it('"Todos" chama sem owner; período muda from/to', async () => {
    rota([ev]);
    render(<AgendaPage />);
    await screen.findAllByText('Kickoff PGR');
    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'todos' } });
    await waitFor(() => expect(urls().at(-1)).not.toContain('owner'));
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-01' } });
    await waitFor(() => expect(urls().at(-1)).toContain('from=2026-10-01'));
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '2026-10-30' } });
    await waitFor(() => expect(urls().at(-1)).toContain('to=2026-10-30'));
  });

  it('vazio, erro com retry e 403', async () => {
    fetchMock.mockResolvedValueOnce(resp(200, []));
    render(<AgendaPage />);
    expect(await screen.findByText('Nenhum compromisso neste período.')).toBeInTheDocument();
  });

  it('erro com Tentar novamente', async () => {
    fetchMock.mockResolvedValueOnce(resp(500, {})).mockResolvedValue(resp(200, [ev]));
    render(<AgendaPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect((await screen.findAllByText('Kickoff PGR')).length).toBeGreaterThan(0);
  });

  it('403 mostra mensagem de permissão', async () => {
    fetchMock.mockResolvedValue(resp(403, {}));
    render(<AgendaPage />);
    expect(await screen.findByText('Você não tem permissão para esta ação.')).toBeInTheDocument();
  });

  it('resposta antiga não sobrescreve a nova', async () => {
    let resolveLenta!: (r: Response) => void;
    const lenta = new Promise<Response>((r) => { resolveLenta = r; });
    fetchMock
      .mockResolvedValueOnce(resp(200, [ev]))
      .mockReturnValueOnce(lenta)
      .mockResolvedValueOnce(resp(200, [evOutro]));
    render(<AgendaPage />);
    await screen.findAllByText('Kickoff PGR');
    fireEvent.change(screen.getByLabelText('Responsável'), { target: { value: 'todos' } });
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-10-10' } });
    expect((await screen.findAllByText('Visita à obra')).length).toBeGreaterThan(0);
    resolveLenta(resp(200, [ev]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Kickoff PGR')).toBeNull();
  });

  it('texto não menciona aviso ao cliente', async () => {
    rota([ev]);
    render(<AgendaPage />);
    await screen.findAllByText('Kickoff PGR');
    expect(document.body.textContent ?? '').not.toMatch(/avis|notific|convid/i);
  });
});

describe('ações de status', () => {
  it('só eventos agendados mostram Concluir e Cancelar', async () => {
    rota([ev, evConcluido]);
    render(<AgendaPage />);
    await screen.findAllByText('Já feito');
    const itens = screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('Já feito'));
    expect(itens.length).toBeGreaterThan(0);
    for (const li of itens) expect(within(li).queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Concluir/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Cancelar/ })).toHaveLength(1);
  });

  it('concluir envia só status e atualiza o selo', async () => {
    rota([ev], (u, init) => (init?.method === 'POST' ? resp(201, { ...ev, status: 'concluido' }) : undefined));
    render(<AgendaPage />);
    await screen.findAllByText('Kickoff PGR');
    fireEvent.click(screen.getByRole('button', { name: /^Concluir/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Concluir/ })).toBeNull());
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(String(post[0])).toContain('/atuacao/agenda/e-1/status');
    expect(JSON.parse(post[1].body)).toEqual({ status: 'concluido' });
  });

  it('cancelar exige motivo e envia status + note', async () => {
    rota([ev], (u, init) => (init?.method === 'POST' ? resp(201, { ...ev, status: 'cancelado' }) : undefined));
    render(<AgendaPage />);
    await screen.findAllByText('Kickoff PGR');
    fireEvent.click(screen.getByRole('button', { name: /^Cancelar/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));
    expect(await screen.findByText('Informe o motivo.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
    fireEvent.change(screen.getByLabelText('Motivo do cancelamento'), { target: { value: 'Cliente remarcou' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({ status: 'cancelado', note: 'Cliente remarcou' });
  });

  it('erro do servidor aparece com role alert', async () => {
    rota([ev], (u, init) => (init?.method === 'POST' ? resp(400, { message: 'Transição de status não permitida' }) : undefined));
    render(<AgendaPage />);
    await screen.findAllByText('Kickoff PGR');
    fireEvent.click(screen.getByRole('button', { name: /^Concluir/ }));
    const t = await screen.findByText('Transição de status não permitida');
    expect(t.closest('[role="alert"]')).not.toBeNull();
  });
});

describe('criar compromisso', () => {
  async function abrir() {
    render(<AgendaPage />);
    await screen.findAllByText('Kickoff PGR');
    fireEvent.click(screen.getByRole('button', { name: 'Novo compromisso' }));
    await screen.findByRole('option', { name: 'Alfa Ltda' });
    await screen.findByRole('option', { name: 'Ana Sócia' });
  }

  it('envia só os campos preenchidos', async () => {
    rota([ev], (u, init) => (init?.method === 'POST' ? resp(201, ev) : undefined));
    await abrir();
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 't-1' } });
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: '  Reunião nova ' } });
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-10-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar compromisso' }));
    await screen.findByText('Compromisso criado.');
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(String(post[0])).toContain('/atuacao/agenda');
    expect(JSON.parse(post[1].body)).toEqual({
      tenant_id: 't-1', type: 'reuniao', title: 'Reunião nova', event_date: '2026-10-25', owner_user_id: 'u-me',
    });
  });

  it('envia horários, local, link https e pauta quando preenchidos', async () => {
    rota([ev], (u, init) => (init?.method === 'POST' ? resp(201, ev) : undefined));
    await abrir();
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 't-1' } });
    fireEvent.change(screen.getByLabelText('Responsável do compromisso'), { target: { value: 'u-2' } });
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'visita' } });
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'V' } });
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-10-25' } });
    fireEvent.change(screen.getByLabelText('Início'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('Fim'), { target: { value: '10:30' } });
    fireEvent.change(screen.getByLabelText('Local'), { target: { value: 'Matriz' } });
    fireEvent.change(screen.getByLabelText('Link da reunião'), { target: { value: 'https://meet.example.com/x' } });
    fireEvent.change(screen.getByLabelText('Pauta'), { target: { value: 'Revisar PGR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar compromisso' }));
    await screen.findByText('Compromisso criado.');
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(post[1].body)).toEqual({
      tenant_id: 't-1', type: 'visita', title: 'V', event_date: '2026-10-25', owner_user_id: 'u-2',
      start_time: '09:00', end_time: '10:30', location: 'Matriz', meeting_link: 'https://meet.example.com/x', notes: 'Revisar PGR',
    });
  });

  it('link que não é https é barrado no formulário, sem chamar a API', async () => {
    rota([ev]);
    await abrir();
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 't-1' } });
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'V' } });
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-10-25' } });
    fireEvent.change(screen.getByLabelText('Link da reunião'), { target: { value: 'http://inseguro.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar compromisso' }));
    const a = await screen.findByText('O link da reunião deve começar com https://.');
    expect(a.closest('[role="alert"]')).not.toBeNull();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });

  it('faltando campo obrigatório avisa sem chamar a API', async () => {
    rota([ev]);
    await abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Criar compromisso' }));
    expect(await screen.findByText('Informe cliente, título e data.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });

  it.each([
    [400, { message: ['O horário final deve ser depois do inicial'] }, 'O horário final deve ser depois do inicial'],
    [403, {}, 'Você não tem permissão para esta ação.'],
  ])('em %i mostra a mensagem e mantém o formulário', async (status, body, texto) => {
    rota([ev], (u, init) => (init?.method === 'POST' ? resp(status, body) : undefined));
    await abrir();
    fireEvent.change(screen.getByLabelText('Cliente'), { target: { value: 't-1' } });
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Mantido' } });
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-10-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar compromisso' }));
    const a = await screen.findByText(texto);
    expect(a.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByLabelText('Título')).toHaveValue('Mantido');
  });
});

describe('ficha: Reuniões e contatos', () => {
  const ficha = {
    id: 't-1', name: 'Alfa Ltda', trade_name: 'Alfa', cnpj: '11222333000181', sector: 'M', contact_name: 'Maria',
    contact_phone: '1', status: 'active', situacao: 'ativa', contact_role: null, notes: null, plan: 'pro',
    created_at: '2026-01-01T00:00:00Z', units: [], responsaveis: [],
  };
  const i1 = {
    id: 'i-1', tenant_id: 't-1', type: 'reuniao', occurred_on: '2026-10-15', participants: 'Maria', summary: 'Alinhamento do PGR',
    decisions: 'Prazo em novembro', next_steps: 'Enviar proposta', agenda_event_id: null, created_by: 'u-me',
    created_by_name: 'Eu Sócio', created_at: '2026-10-15T12:00:00Z', updated_at: '2026-10-15T12:00:00Z', editavel: true,
  };
  const i2 = {
    ...i1, id: 'i-2', type: 'ligacao', occurred_on: '2026-10-10', summary: 'Cobrança de documentos', created_by: 'u-2',
    created_by_name: 'Ana Sócia', editavel: false, participants: null, decisions: null, next_steps: null,
  };

  function rotaFicha(interacoes: unknown[], extra?: (u: string, init: RequestInit) => Response | undefined) {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const u = String(url);
      const e = extra?.(u, init);
      if (e) return e;
      if (u.includes('/interacoes')) return resp(200, interacoes);
      return resp(200, ficha);
    });
  }

  it('lista na ordem recebida, com autor em texto e Editar só quando editavel', async () => {
    rotaFicha([i1, i2]);
    render(<FichaPage />);
    const lista = await screen.findByRole('list', { name: 'Reuniões e contatos' });
    const itens = within(lista).getAllByRole('listitem');
    expect(itens).toHaveLength(2);
    expect(itens[0]).toHaveTextContent('15/10/2026');
    expect(itens[0]).toHaveTextContent('Alinhamento do PGR');
    expect(itens[0]).toHaveTextContent('Prazo em novembro');
    expect(itens[0]).toHaveTextContent('Enviar proposta');
    expect(itens[1]).toHaveTextContent('10/10/2026');
    expect(itens[1]).toHaveTextContent('de Ana Sócia');
    expect(within(itens[0]).getByRole('button', { name: /Editar/ })).toBeInTheDocument();
    expect(within(itens[1]).queryByRole('button', { name: /Editar/ })).toBeNull();
    expect(urls().some((u) => u.includes('/atuacao/clientes/t-1/interacoes'))).toBe(true);
  });

  it('estado vazio', async () => {
    rotaFicha([]);
    render(<FichaPage />);
    expect(await screen.findByText('Nenhum registro de reunião ou contato ainda.')).toBeInTheDocument();
  });

  it('erro na linha do tempo não derruba a ficha', async () => {
    rotaFicha([], (u) => (u.includes('/interacoes') ? resp(500, {}) : undefined));
    render(<FichaPage />);
    expect(await screen.findByText('Algo deu errado. Tente novamente.')).toBeInTheDocument();
    expect(screen.getByLabelText('Setor')).toBeInTheDocument();
  });

  it('cria registro enviando só os campos preenchidos', async () => {
    rotaFicha([], (u, init) => (init?.method === 'POST' ? resp(201, i1) : undefined));
    render(<FichaPage />);
    await screen.findByText('Nenhum registro de reunião ou contato ainda.');
    fireEvent.click(screen.getByRole('button', { name: 'Novo registro' }));
    fireEvent.change(screen.getByLabelText('Tipo de contato'), { target: { value: 'visita' } });
    fireEvent.change(screen.getByLabelText('Data do contato'), { target: { value: '2026-10-18' } });
    fireEvent.change(screen.getByLabelText('Resumo'), { target: { value: ' Visita técnica ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar registro' }));
    await screen.findByText('Registro salvo.');
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(String(post[0])).toContain('/atuacao/clientes/t-1/interacoes');
    expect(JSON.parse(post[1].body)).toEqual({ type: 'visita', occurred_on: '2026-10-18', summary: 'Visita técnica' });
  });

  it('sem resumo ou data avisa sem chamar a API', async () => {
    rotaFicha([]);
    render(<FichaPage />);
    await screen.findByText('Nenhum registro de reunião ou contato ainda.');
    fireEvent.click(screen.getByRole('button', { name: 'Novo registro' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar registro' }));
    const a = await screen.findByText('Informe a data e o resumo.');
    expect(a.closest('[role="alert"]')).not.toBeNull();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });

  it.each([
    [400, { message: 'Dados inválidos' }, 'Dados inválidos'],
    [403, {}, 'Você não tem permissão para esta ação.'],
  ])('em %i mantém o formulário preenchido', async (status, body, texto) => {
    rotaFicha([], (u, init) => (init?.method === 'POST' ? resp(status, body) : undefined));
    render(<FichaPage />);
    await screen.findByText('Nenhum registro de reunião ou contato ainda.');
    fireEvent.click(screen.getByRole('button', { name: 'Novo registro' }));
    fireEvent.change(screen.getByLabelText('Data do contato'), { target: { value: '2026-10-18' } });
    fireEvent.change(screen.getByLabelText('Resumo'), { target: { value: 'Mantido' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar registro' }));
    const a = await screen.findByText(texto);
    expect(a.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByLabelText('Resumo')).toHaveValue('Mantido');
  });

  it('editar envia só os campos alterados', async () => {
    rotaFicha([i1, i2], (u, init) => (init?.method === 'PATCH' ? resp(200, { ...i1, summary: 'Novo resumo' }) : undefined));
    render(<FichaPage />);
    const lista = await screen.findByRole('list', { name: 'Reuniões e contatos' });
    fireEvent.click(within(within(lista).getAllByRole('listitem')[0]).getByRole('button', { name: /Editar/ }));
    expect(screen.getByLabelText('Resumo')).toHaveValue('Alinhamento do PGR');
    fireEvent.change(screen.getByLabelText('Resumo'), { target: { value: 'Novo resumo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar registro' }));
    await screen.findByText('Registro salvo.');
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
    expect(String(patch[0])).toContain('/atuacao/interacoes/i-1');
    expect(JSON.parse(patch[1].body)).toEqual({ summary: 'Novo resumo' });
  });

  it('editar sem alteração não chama a API', async () => {
    rotaFicha([i1]);
    render(<FichaPage />);
    const lista = await screen.findByRole('list', { name: 'Reuniões e contatos' });
    fireEvent.click(within(lista).getByRole('button', { name: /Editar/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar registro' }));
    expect(await screen.findByText('Nenhuma alteração para salvar.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(false);
  });
});
