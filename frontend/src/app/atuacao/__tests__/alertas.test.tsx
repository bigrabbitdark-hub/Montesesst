import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/atuacao',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(''),
}));

import NotificacoesPage from '../notificacoes/page';
import AlertasPage from '../alertas/page';
import { parseAntecedencias } from '../api';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
let rotas: Record<string, (init?: RequestInit) => Response>;
beforeEach(() => {
  localStorage.setItem('montese_token', 'tok');
  rotas = {};
  fetchMock = vi.fn(async (u: string, init?: RequestInit) => {
    const chave = `${init?.method ?? 'GET'} ${String(u).replace('/api/atuacao', '')}`;
    const r = rotas[chave];
    return r ? r(init) : resp(404, { message: 'x' });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const chamadas = (m: string) => fetchMock.mock.calls.filter((c) => ((c[1] as RequestInit | undefined)?.method ?? 'GET') === m);

const notif = (over: Record<string, unknown> = {}) => ({
  id: 'n-1', type: 'documento_vencendo', priority: 'alta', title: 'PGR vence em 7 dias — Alfa Ltda', tenant_id: 't-1',
  href: '/atuacao/empresas/t-1', created_at: '2026-11-02T09:30:00Z', read_at: null, ...over,
});

describe('parseAntecedencias', () => {
  it('aceita lista válida e ordena do maior para o menor', () => {
    expect(parseAntecedencias('7, 60 ,30;15 0')).toEqual([60, 30, 15, 7, 0]);
    expect(parseAntecedencias('10')).toEqual([10]);
  });
  it('rejeita vazio, repetido, fora de 0..365, não numérico e mais de 8', () => {
    for (const ruim of ['', '  ', '10, 10', '-1', '366', 'abc', '1.5', '1,2,3,4,5,6,7,8,9']) expect([ruim, parseAntecedencias(ruim)]).toEqual([ruim, null]);
  });
});

describe('sino do header', () => {
  it('mostra o contador de não lidas no rótulo e leva à lista; sem não lidas não há selo', () => {
    const { rerender } = render(<DashboardHeader nomeUsuario="Sócio" papel="Montese SST" notificacoesHref="/atuacao/notificacoes" notificacoesNaoLidas={3} />);
    const link = screen.getByRole('link', { name: 'Notificações (3 não lidas)' });
    expect(link).toHaveAttribute('href', '/atuacao/notificacoes');
    rerender(<DashboardHeader nomeUsuario="Sócio" papel="Montese SST" notificacoesHref="/atuacao/notificacoes" notificacoesNaoLidas={0} />);
    expect(screen.getByRole('link', { name: 'Notificações' })).toBeInTheDocument();
    rerender(<DashboardHeader nomeUsuario="Sócio" papel="Montese SST" notificacoesNaoLidas={5} />);
    expect(screen.queryByRole('link', { name: /Notificações/ })).toBeNull();
  });
});

describe('página de notificações', () => {
  it('lista com prioridade, título e link; vazio explica quando são geradas', async () => {
    rotas['GET /notificacoes'] = () => resp(200, { itens: [notif(), notif({ id: 'n-2', priority: 'baixa', title: 'LTCAT vence em 60 dias — Beta', read_at: '2026-11-02T10:00:00Z', href: null })], total: 2 });
    render(<NotificacoesPage />);
    const lista = await screen.findByRole('list', { name: 'Notificações' });
    expect(within(lista).getByText('PGR vence em 7 dias — Alfa Ltda')).toBeInTheDocument();
    expect(within(lista).getByText('Alta')).toBeInTheDocument();
    expect(within(lista).getByRole('link', { name: 'Abrir' })).toHaveAttribute('href', '/atuacao/empresas/t-1');
    expect(within(lista).getByText('Lida')).toBeInTheDocument();
  });

  it('vazio: mensagem de que são geradas pela manhã', async () => {
    rotas['GET /notificacoes'] = () => resp(200, { itens: [], total: 0 });
    render(<NotificacoesPage />);
    expect(await screen.findByText(/Elas são geradas todos os dias pela manhã/)).toBeInTheDocument();
  });

  it('marcar como lida chama POST e recarrega; filtro de não lidas usa a query', async () => {
    let lida = false;
    rotas['GET /notificacoes'] = () => resp(200, { itens: [notif({ read_at: lida ? '2026-11-02T11:00:00Z' : null })], total: 1 });
    rotas['POST /notificacoes/n-1/lida'] = () => { lida = true; return resp(201, { nao_lidas: 0, alta: 0 }); };
    rotas['GET /notificacoes?naoLidas=true'] = () => resp(200, { itens: [], total: 0 });
    render(<NotificacoesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Marcar como lida: PGR vence/ }));
    await waitFor(() => expect(chamadas('POST')).toHaveLength(1));
    expect(await screen.findByText('Lida')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Mostrar só não lidas'));
    expect(await screen.findByText('Nenhuma notificação não lida.')).toBeInTheDocument();
  });

  it('marcar todas chama o endpoint em lote; erro do servidor aparece como alerta', async () => {
    rotas['GET /notificacoes'] = () => resp(200, { itens: [notif()], total: 1 });
    rotas['POST /notificacoes/lidas'] = () => resp(500, {});
    render(<NotificacoesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar todas como lidas' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Algo deu errado');
  });

  it('403 mostra a mensagem de permissão', async () => {
    rotas['GET /notificacoes'] = () => resp(403, {});
    render(<NotificacoesPage />);
    expect(await screen.findByText(/permissão/i)).toBeInTheDocument();
  });
});

const regra = (over: Record<string, unknown> = {}) => ({
  category: 'pgr', validity_months: 24, alert_days: 30, notice_days: null, notice_days_efetivo: [60, 30, 15, 7, 0], usa_padrao: true, source: null,
  updated_at: '2026-10-13T10:00:00Z', ...over,
});

describe('página de alertas', () => {
  beforeEach(() => {
    rotas['GET /alertas/regras'] = () => resp(200, [regra(), regra({ category: 'laudo', validity_months: null, notice_days: [10, 0], notice_days_efetivo: [10, 0], usa_padrao: false, source: 'Fonte X' })]);
    rotas['GET /alertas/mudancas'] = () => resp(200, []);
    rotas['GET /clientes'] = () => resp(200, [{ id: 't-1', name: 'Alfa Ltda', trade_name: null }]);
  });

  it('mostra validade em meses, avisos efetivos, padrão e fonte', async () => {
    render(<AlertasPage />);
    const lista = await screen.findByRole('list', { name: 'Regras por tipo de documento' });
    expect(within(lista).getByText(/Validade: 24 meses · Avisos: 60 d, 30 d, 15 d, 7 d, no dia \(padrão\)/)).toBeInTheDocument();
    expect(within(lista).getByText(/Sem validade automática · Avisos: 10 d, no dia/)).toBeInTheDocument();
    expect(within(lista).getByText('Fonte: Fonte X')).toBeInTheDocument();
  });

  it('ajustar: valida a lista e envia PUT ordenado, sem mexer nos meses', async () => {
    rotas['PUT /alertas/regras/pgr'] = () => resp(200, regra({ notice_days: [90, 45], notice_days_efetivo: [90, 45], usa_padrao: false }));
    render(<AlertasPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Ajustar avisos de PGR/ }));
    const campo = screen.getByLabelText(/Antecedências em dias/);
    fireEvent.change(campo, { target: { value: '30, 30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/Informe de 1 a 8 antecedências/)).toBeInTheDocument();
    expect(chamadas('PUT')).toHaveLength(0);
    fireEvent.change(campo, { target: { value: '45, 90' } });
    fireEvent.change(screen.getByLabelText(/Fonte ou referência/), { target: { value: 'Ref. interna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(chamadas('PUT')).toHaveLength(1));
    expect(JSON.parse((chamadas('PUT')[0][1] as RequestInit).body as string)).toEqual({ notice_days: [90, 45], source: 'Ref. interna' });
    expect(await screen.findByText('Antecedências salvas.')).toBeInTheDocument();
  });

  it('403 ao salvar mostra a mensagem de permissão', async () => {
    rotas['PUT /alertas/regras/pgr'] = () => resp(403, {});
    render(<AlertasPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Ajustar avisos de PGR/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/permissão/i);
  });

  it('registrar mudança exige empresa e envia empresa, documento, motivo e nota', async () => {
    rotas['POST /alertas/mudancas'] = () => resp(201, {});
    render(<AlertasPage />);
    await screen.findByRole('list', { name: 'Regras por tipo de documento' });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar mudança' }));
    expect(await screen.findByText('Escolha a empresa.')).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Empresa'), { target: { value: 't-1' } });
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'equipamento' } });
    fireEvent.change(screen.getByLabelText(/Observação curta/), { target: { value: 'nova prensa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar mudança' }));
    await waitFor(() => expect(chamadas('POST')).toHaveLength(1));
    expect(JSON.parse((chamadas('POST')[0][1] as RequestInit).body as string)).toEqual({ tenant_id: 't-1', category: 'pgr', reason: 'equipamento', note: 'nova prensa' });
  });

  it('lista revisões em aberto e marca como revisado', async () => {
    rotas['GET /alertas/mudancas'] = () => resp(200, [{ id: 'm-1', tenant_id: 't-1', empresa: 'Alfa Ltda', document_id: null, category: 'pgr', reason: 'risco', note: 'novo agente', created_at: '2026-11-02T09:00:00Z', created_by_name: 'Evelyn', resolved_at: null, resolved_by_name: null, resolution_note: null }]);
    rotas['POST /alertas/mudancas/m-1/resolver'] = () => resp(201, {});
    render(<AlertasPage />);
    const lista = await screen.findByRole('list', { name: 'Revisões por mudança em aberto' });
    expect(within(lista).getByText(/Alfa Ltda — Mudança de risco \(PGR\)/)).toBeInTheDocument();
    fireEvent.click(within(lista).getByRole('button', { name: 'Marcar como revisado' }));
    await waitFor(() => expect(chamadas('POST')).toHaveLength(1));
  });
});
