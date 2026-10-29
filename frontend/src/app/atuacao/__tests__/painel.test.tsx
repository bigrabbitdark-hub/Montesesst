import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(''),
}));

import PainelPage from '../page';
import { ATUACAO_MENU_ITEMS } from '@/lib/dashboard/menu-atuacao';

const evento = (n: number, extra: object = {}) => ({
  id: `e-${n}`, titulo: `Reunião ${n}`, tipo: 'reuniao', data: '2026-10-29', hora: '09:30', tenant_id: 't-1',
  empresa: 'Alfa Ltda', status: 'agendado', ...extra,
});
const pend = (extra: object = {}) => ({
  tipo: 'tarefa_atrasada', tenant_id: 't-1', empresa: 'Alfa Ltda', descricao: 'Revisar PGR', prazo: '2026-10-25',
  prioridade: 'alta', href: '/atuacao/tarefas?vencidas=true', ...extra,
});
const completo = () => ({
  gerado_em: '2026-10-29T12:00:00Z',
  empresas: { acessiveis: 12 },
  tarefas: { abertas: 7, vencidas: 2, hoje: 3, bloqueadas: 1 },
  agenda: { hoje: [evento(1)], hoje_total: 1, proximos_7_dias: 4 },
  documentos: { vencidos: 5, vence_7: 6, vence_15: 8, vence_30: 11, aguardando_acao: 9 },
  pendencias: [pend()],
  indisponiveis: [] as string[],
});

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
let painelBody: () => Promise<Response>;
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  localStorage.setItem('montese_token', 'tok');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u-me', role: 'socio', tenantId: null }));
  painelBody = async () => resp(200, completo());
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith('/atuacao/painel')) return painelBody();
    if (u.includes('/financeiro/resumo')) return resp(200, { clientes: { com_pendencia: 2 } });
    return resp(200, []);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const kpi = async (nome: RegExp | string) => screen.findByRole('link', { name: nome });

describe('painel: KPIs reais', () => {
  it('chama GET /api/atuacao/painel com o token e mostra os números do servidor', async () => {
    render(<PainelPage />);
    const l = await kpi(/Empresas acessíveis/);
    expect(urls()).toContain('/api/atuacao/painel');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    expect(l).toHaveTextContent('12');
    expect(await kpi(/Tarefas abertas/)).toHaveTextContent('7');
    expect(await kpi(/Tarefas vencidas/)).toHaveTextContent('2');
    expect(await kpi(/Tarefas para hoje/)).toHaveTextContent('3');
    expect(await kpi(/Tarefas bloqueadas/)).toHaveTextContent('1');
    expect(await kpi(/Documentos vencidos/)).toHaveTextContent('5');
    expect(await kpi(/Compromissos hoje/)).toHaveTextContent('1');
    expect(await kpi(/Documentos aguardando ação/)).toHaveTextContent('9');
  });

  it('cada KPI é link para a lista filtrada (hrefs exatos)', async () => {
    render(<PainelPage />);
    const href = async (n: RegExp) => (await kpi(n)).getAttribute('href');
    expect(await href(/Empresas acessíveis/)).toBe('/atuacao/empresas');
    expect(await href(/Tarefas abertas/)).toBe('/atuacao/tarefas');
    expect(await href(/Tarefas vencidas/)).toBe('/atuacao/tarefas?vencidas=true');
    expect(await href(/Tarefas para hoje/)).toBe('/atuacao/tarefas');
    expect(await href(/Tarefas bloqueadas/)).toBe('/atuacao/tarefas?status=blocked');
    expect(await href(/Documentos vencidos/)).toBe('/atuacao/vencimentos?faixa=vencidos');
    expect(await href(/Vencem em até 7 dias/)).toBe('/atuacao/vencimentos?faixa=7');
    expect(await href(/Vencem em até 15 dias/)).toBe('/atuacao/vencimentos?faixa=15');
    expect(await href(/Vencem em até 30 dias/)).toBe('/atuacao/vencimentos?faixa=30');
    expect(await href(/Documentos aguardando ação/)).toBe('/atuacao/documentos');
    expect(await href(/Compromissos hoje/)).toBe('/atuacao/agenda');
  });

  it('faixas de vencimento são cumulativas: rótulos "até N dias" e nunca somadas', async () => {
    render(<PainelPage />);
    expect(await kpi(/Vencem em até 7 dias/)).toHaveTextContent('6');
    expect(await kpi(/Vencem em até 15 dias/)).toHaveTextContent('8');
    expect(await kpi(/Vencem em até 30 dias/)).toHaveTextContent('11');
    expect(screen.queryByText('25')).toBeNull(); // 6+8+11
    expect(screen.queryByText('30')).toBeNull(); // 5+6+8+11
    expect(screen.queryByText(/^(7|15|30) dias$/)).toBeNull();
  });

  it('zero é mostrado como 0 (não some nem vira "sem dados")', async () => {
    painelBody = async () => resp(200, { ...completo(), tarefas: { abertas: 0, vencidas: 0, hoje: 0, bloqueadas: 0 } });
    render(<PainelPage />);
    expect(await kpi(/Tarefas vencidas/)).toHaveTextContent('0');
  });
});

describe('painel: dicas e financeiro', () => {
  it('"Tarefas para hoje" avisa que abre todas as tarefas', async () => {
    render(<PainelPage />);
    expect(await kpi(/Tarefas para hoje/)).toHaveTextContent('Abre todas as tarefas');
  });

  it('KPI financeiro inteiro é link para /atuacao/financeiro', async () => {
    render(<PainelPage />);
    const l = await kpi(/Clientes com pendência financeira/);
    expect(l).toHaveAttribute('href', '/atuacao/financeiro');
    expect(l).toHaveTextContent('2');
  });
});

describe('painel: permissão e indisponibilidade por bloco', () => {
  it('bloco null fora de indisponiveis => sem permissão, sem derrubar os outros', async () => {
    painelBody = async () => resp(200, { ...completo(), tarefas: null, agenda: null });
    render(<PainelPage />);
    await kpi(/Empresas acessíveis/);
    expect(screen.getAllByText('Sem permissão para este bloco (peça ao administrador)')).toHaveLength(3); // tarefas, agenda e Pendências por categoria (D2)
    expect(screen.queryByRole('link', { name: /Tarefas abertas/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    expect(await kpi(/Documentos vencidos/)).toBeInTheDocument();
  });

  it('bloco null listado em indisponiveis => "indisponível" com nova tentativa que recarrega', async () => {
    painelBody = async () => resp(200, { ...completo(), tarefas: null, indisponiveis: ['tarefas'] });
    render(<PainelPage />);
    // Tarefas e "Pendências por categoria" (D2) usam a mesma fonte: a mensagem aparece nos dois; o botão só em Tarefas.
    expect(await screen.findAllByText('Bloco indisponível no momento. Tente novamente.')).toHaveLength(2);
    expect(screen.queryByText('Sem permissão para este bloco (peça ao administrador)')).toBeNull();
    painelBody = async () => resp(200, completo());
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await kpi(/Tarefas abertas/)).toHaveTextContent('7');
    expect(urls().filter((u) => u === '/api/atuacao/painel')).toHaveLength(2);
  });

  it('documentos parcial: só empresas.read mostra vencimentos e avisa que falta aguardando ação', async () => {
    painelBody = async () => resp(200, { ...completo(), documentos: { vencidos: 5, vence_7: 6, vence_15: 8, vence_30: 11, aguardando_acao: null } });
    render(<PainelPage />);
    expect(await kpi(/Documentos vencidos/)).toHaveTextContent('5');
    expect(screen.queryByRole('link', { name: /aguardando ação/ })).toBeNull();
    expect(screen.getByText('Parte deste bloco não está disponível (sem permissão ou falha momentânea)')).toBeInTheDocument();
    expect(screen.queryByText('Sem permissão para este bloco (peça ao administrador)')).toBeNull();
  });

  it('documentos parcial: só documents.read mostra aguardando ação e avisa que faltam os vencimentos', async () => {
    painelBody = async () => resp(200, { ...completo(), documentos: { vencidos: null, vence_7: null, vence_15: null, vence_30: null, aguardando_acao: 9 } });
    render(<PainelPage />);
    expect(await kpi(/Documentos aguardando ação/)).toHaveTextContent('9');
    expect(screen.queryByRole('link', { name: /Documentos vencidos/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Vencem em até/ })).toBeNull();
    expect(screen.getByText('Parte deste bloco não está disponível (sem permissão ou falha momentânea)')).toBeInTheDocument();
    expect(screen.queryByText('Sem permissão para este bloco (peça ao administrador)')).toBeNull();
  });
});

describe('painel: Minha agenda', () => {
  it('lista hora, título, empresa, tipo e status; link para a agenda', async () => {
    render(<PainelPage />);
    const sec = (await screen.findByRole('heading', { name: 'Minha agenda' })).closest('section')!;
    const item = within(sec).getByText('Reunião 1').closest('li')!;
    expect(item).toHaveTextContent('09:30');
    expect(item).toHaveTextContent('Alfa Ltda');
    expect(item).toHaveTextContent('Reunião');
    expect(item).toHaveTextContent('Agendado');
    expect(within(sec).getByRole('link', { name: 'Ver agenda' })).toHaveAttribute('href', '/atuacao/agenda');
    expect(sec).toHaveTextContent('4 nos próximos 7 dias');
  });

  it('evento sem hora = dia inteiro', async () => {
    painelBody = async () => resp(200, { ...completo(), agenda: { hoje: [evento(2, { hora: null })], hoje_total: 1, proximos_7_dias: 0 } });
    render(<PainelPage />);
    expect(await screen.findByText('Dia inteiro')).toBeInTheDocument();
  });

  it('truncado: mostra "10 de 14 hoje"', async () => {
    const hoje = Array.from({ length: 10 }, (_, i) => evento(i + 1));
    painelBody = async () => resp(200, { ...completo(), agenda: { hoje, hoje_total: 14, proximos_7_dias: 0 } });
    render(<PainelPage />);
    expect(await screen.findByText('Mostrando 10 de 14 de hoje.')).toBeInTheDocument();
    expect(await kpi(/Compromissos hoje/)).toHaveTextContent('14');
  });

  it('vazio explícito', async () => {
    painelBody = async () => resp(200, { ...completo(), agenda: { hoje: [], hoje_total: 0, proximos_7_dias: 0 } });
    render(<PainelPage />);
    expect(await screen.findByText('Nenhum compromisso para hoje.')).toBeInTheDocument();
  });
});

describe('painel: Pendências prioritárias', () => {
  it('mostra empresa, descrição, prioridade, prazo e link direto', async () => {
    render(<PainelPage />);
    const sec = (await screen.findByRole('heading', { name: 'Pendências prioritárias' })).closest('section')!;
    const item = within(sec).getByText('Alfa Ltda').closest('li')!;
    expect(item).toHaveTextContent('Revisar PGR');
    expect(item).toHaveTextContent('Alta');
    expect(item).toHaveTextContent('25/10/2026');
    expect(within(item).getByRole('link', { name: /Revisar PGR/ })).toHaveAttribute('href', '/atuacao/tarefas?vencidas=true');
  });

  it('documento sem prazo/prioridade não inventa valores', async () => {
    painelBody = async () => resp(200, { ...completo(), pendencias: [pend({ tipo: 'documento_aguardando', descricao: 'PGR rascunho', prazo: null, prioridade: null, href: '/atuacao/documentos/d-1' })] });
    render(<PainelPage />);
    const item = (await screen.findByText('PGR rascunho')).closest('li')!;
    expect(item).toHaveTextContent('Aguardando ação');
    expect(item).not.toHaveTextContent('Alta');
    expect(item).not.toHaveTextContent('Sem prazo');
  });

  it.each(['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)', '/admin/usuarios', '/atuacao'])(
    'href fora de /atuacao/ (%s) não vira link', async (href) => {
      painelBody = async () => resp(200, { ...completo(), pendencias: [pend({ href })] });
      render(<PainelPage />);
      const sec = (await screen.findByRole('heading', { name: 'Pendências prioritárias' })).closest('section')!;
      expect(within(sec).getByText('Revisar PGR')).toBeInTheDocument();
      expect(within(sec).queryByRole('link')).toBeNull();
    });

  it('vazio explícito', async () => {
    painelBody = async () => resp(200, { ...completo(), pendencias: [] });
    render(<PainelPage />);
    expect(await screen.findByText('Nenhuma pendência no momento.')).toBeInTheDocument();
  });

  it('vazio com bloco indisponível avisa que a lista pode estar incompleta', async () => {
    painelBody = async () => resp(200, { ...completo(), pendencias: [], documentos: null, indisponiveis: ['documentos'] });
    render(<PainelPage />);
    expect(await screen.findByText(/lista pode estar incompleta/)).toBeInTheDocument();
  });
});

describe('painel: erros e carregamento', () => {
  it('erro 500 mostra mensagem e Tentar novamente; financeiro continua', async () => {
    painelBody = async () => resp(500, {});
    render(<PainelPage />);
    expect(await screen.findByText('Algo deu errado. Tente novamente.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(await screen.findByText('Clientes com pendência financeira')).toBeInTheDocument();
  });

  it('403 mostra mensagem de permissão', async () => {
    painelBody = async () => resp(403, {});
    render(<PainelPage />);
    expect(await screen.findByText('Você não tem permissão para esta ação.')).toBeInTheDocument();
  });

  it('resposta com formato inesperado vira erro, não tela vazia', async () => {
    painelBody = async () => resp(200, []);
    render(<PainelPage />);
    expect(await screen.findByText('Painel indisponível. Tente novamente.')).toBeInTheDocument();
  });

  it('401 limpa a sessão e vai para /login', async () => {
    const loc = { href: '' };
    vi.stubGlobal('location', loc);
    painelBody = async () => resp(401, {});
    render(<PainelPage />);
    await waitFor(() => expect(loc.href).toBe('/login'));
    expect(localStorage.getItem('montese_token')).toBeNull();
  });

  it('resposta antiga não sobrescreve a nova (duas tentativas em voo)', async () => {
    const indisp = () => ({ ...completo(), tarefas: null, indisponiveis: ['tarefas'], empresas: { acessiveis: 1 } });
    let soltarLenta!: (r: Response) => void;
    const lenta = new Promise<Response>((r) => { soltarLenta = r; });
    let n = 0;
    painelBody = () => {
      n += 1;
      if (n === 1) return Promise.resolve(resp(200, indisp()));
      if (n === 2) return lenta; // tentativa antiga, termina por último
      return Promise.resolve(resp(200, { ...indisp(), empresas: { acessiveis: 99 } }));
    };
    render(<PainelPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(n).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.getByRole('link', { name: /Empresas acessíveis/ })).toHaveTextContent('99'));
    soltarLenta(resp(200, { ...indisp(), empresas: { acessiveis: 2 } }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByRole('link', { name: /Empresas acessíveis/ })).toHaveTextContent('99');
  });

  it('resposta que chega depois de sair da página é ignorada (sem erro)', async () => {
    let soltar!: (r: Response) => void;
    painelBody = () => new Promise<Response>((r) => { soltar = r; });
    const { unmount } = render(<PainelPage />);
    await waitFor(() => expect(soltar).toBeDefined());
    unmount();
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    soltar(resp(200, completo()));
    await new Promise((r) => setTimeout(r, 10));
    expect(erro).not.toHaveBeenCalled();
    erro.mockRestore();
  });
});

describe('painel: o que foi mantido e removido', () => {
  it('mantém o bloco Financeiro (dado real, não duplicado) e não chama os endpoints antigos', async () => {
    render(<PainelPage />);
    expect(await screen.findByText('Clientes com pendência financeira')).toBeInTheDocument();
    await kpi(/Empresas acessíveis/);
    const u = urls();
    expect(u.some((x) => x.includes('/atuacao/resumo'))).toBe(false);
    expect(u.some((x) => x.includes('/tarefas/resumo'))).toBe(false);
    expect(u.some((x) => x.includes('/atuacao/agenda'))).toBe(false);
    expect(u.some((x) => x.endsWith('/atuacao/documentos'))).toBe(false);
  });

  it('menu tem Vencimentos em /atuacao/vencimentos', () => {
    expect(ATUACAO_MENU_ITEMS.find((i) => i.label === 'Vencimentos')?.href).toBe('/atuacao/vencimentos');
  });

  it('menu tem Histórico de atendimento em /atuacao/atendimentos (página existe)', () => {
    expect(ATUACAO_MENU_ITEMS.find((i) => i.label === 'Histórico de atendimento')?.href).toBe('/atuacao/atendimentos');
  });

  it('menu não tem links para telas inexistentes', () => {
    const rotulos = ATUACAO_MENU_ITEMS.map((i) => i.label);
    for (const r of ['Visitas técnicas', 'Funcionários', 'EPI', 'Treinamentos', 'Ordens de Serviço']) {
      expect(rotulos).not.toContain(r);
    }
  });
});

describe('painel D2: pendências por categoria e tarefa_aguardando', () => {
  const comEspera = () => ({
    ...completo(),
    tarefas: {
      abertas: 7, vencidas: 2, hoje: 3, bloqueadas: 1,
      aguardando_cliente: 4, aguardando_avaliacao: 3, aguardando_execucao: 0, aguardando_eficacia: 2,
    },
  });
  const secao = async () => within(await screen.findByRole('region', { name: 'Pendências por categoria' }));

  it('mostra as 4 categorias com contagem do servidor e link com o status técnico', async () => {
    painelBody = async () => resp(200, comEspera());
    render(<PainelPage />);
    const s = await secao();
    const casos: [RegExp, string, string][] = [
      [/Aguardando cliente/, '4', '/atuacao/tarefas?status=awaiting_client'],
      [/Aguardando avaliação técnica/, '3', '/atuacao/tarefas?status=awaiting_review'],
      [/Aguardando execução/, '0', '/atuacao/tarefas?status=awaiting_execution'],
      [/Aguardando comprovação de eficácia/, '2', '/atuacao/tarefas?status=awaiting_efficacy'],
    ];
    for (const [nome, n, href] of casos) {
      const l = s.getByRole('link', { name: nome });
      expect(l).toHaveTextContent(n);
      expect(l).toHaveAttribute('href', href);
    }
  });

  it('tarefas null => mesmo aviso de sem permissão; indisponível => nova tentativa', async () => {
    painelBody = async () => resp(200, { ...completo(), tarefas: null, indisponiveis: ['tarefas'] });
    render(<PainelPage />);
    const s = await secao();
    expect(s.getByText('Bloco indisponível no momento. Tente novamente.')).toBeInTheDocument();
    expect(s.queryByRole('link')).toBeNull();
    expect(s.queryByRole('button')).toBeNull();
  });

  it('resposta sem os campos novos (backend antigo) não inventa números', async () => {
    render(<PainelPage />);
    const s = await secao();
    expect(s.queryByRole('link')).toBeNull();
    expect(s.getByText('Contagens por categoria indisponíveis no momento.')).toBeInTheDocument();
  });

  it('renderiza pendência tarefa_aguardando com rótulo e link, e ignora href fora de /atuacao/', async () => {
    painelBody = async () => resp(200, {
      ...comEspera(),
      pendencias: [
        pend({ tipo: 'tarefa_aguardando', descricao: 'Esperando o cliente', href: '/atuacao/tarefas?status=awaiting_client' }),
        pend({ tipo: 'tarefa_aguardando', descricao: 'Link externo', href: 'https://evil.example/x' }),
      ],
    });
    render(<PainelPage />);
    const l = await screen.findByRole('link', { name: 'Esperando o cliente' });
    expect(l).toHaveAttribute('href', '/atuacao/tarefas?status=awaiting_client');
    expect(screen.getAllByText('Tarefa em espera').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Link externo' })).toBeNull();
    expect(screen.getByText('Link externo')).toBeInTheDocument();
  });
});
