import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ tenantId: 't-1' }),
  useSearchParams: () => new URLSearchParams(''),
}));

import FinanceiroPage from '../financeiro/page';
import PainelPage from '../page';
import FichaPage from '../clientes/[tenantId]/page';
import { ATUACAO_MENU_ITEMS } from '@/lib/dashboard/menu-atuacao';

const resumo = {
  periodo_dias: 30,
  clientes: { total: 10, ativos: 7, trial: 1, pendentes: 1, inativos: 1, com_pendencia: 2 },
  mrr_cents: 29900,
  hoje: { cobrado_cents: 0, aprovado_cents: 0, pendente_cents: 0 },
  mes: { cobrado_cents: 59800, aprovado_cents: 49900, pendente_cents: 9900, recusado_cents: 0 },
  serie: [],
};
const cli = {
  id: 't-1', name: 'Alfa Ltda', trade_name: 'Alfa', situacao: 'ativa', plano: 'Profissional', valor_mensal_cents: 29900,
  ultimo_pagamento: { data: '2026-10-05', status: 'approved', valor_cents: 29900 }, pendencia: false, dias_em_atraso: null,
};
const cliAtraso = {
  ...cli, id: 't-2', name: 'Beta SA', trade_name: null, plano: 'Básico', valor_mensal_cents: 9900,
  ultimo_pagamento: { data: '2026-10-01', status: 'rejected', valor_cents: 9900 }, pendencia: true, dias_em_atraso: 19,
};
const ficha = {
  ...cliAtraso, id: 't-1',
  assinaturas: [{ plano: 'Básico', status: 'authorized', valor_mensal_cents: 9900, desde: '2026-01-15' }],
  pagamentos: [{ data: '2026-10-01', status: 'rejected', valor_cents: 9900 }, { data: '2026-09-01', status: 'approved', valor_cents: 9900 }],
};

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  localStorage.setItem('montese_token', 'tok');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u-me', role: 'socio', tenantId: null }));
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function rota(lista: unknown[] = [cli, cliAtraso], extra?: (u: string) => Response | undefined) {
  fetchMock.mockImplementation(async (url: string) => {
    const u = String(url);
    const e = extra?.(u);
    if (e) return e;
    if (u.includes('/atuacao/financeiro/resumo')) return resp(200, resumo);
    if (u.includes('/atuacao/financeiro/clientes/')) return resp(200, ficha);
    if (u.includes('/atuacao/financeiro/clientes')) return resp(200, lista);
    return resp(200, []);
  });
}

describe('menu', () => {
  it('tem "Financeiro" em /atuacao/financeiro', () => {
    expect(ATUACAO_MENU_ITEMS.map((i) => [i.label, i.href])).toContainEqual(['Financeiro', '/atuacao/financeiro']);
    expect(ATUACAO_MENU_ITEMS.every((i) => i.implemented)).toBe(true);
  });
});

describe('página Financeiro', () => {
  it('mostra o gráfico de faturamento e troca o período consultando a API com dias', async () => {
    const comSerie = { ...resumo, serie: [{ data: '2026-10-01', cobrado_cents: 9900, aprovado_cents: 9900 }, { data: '2026-10-02', cobrado_cents: 0, aprovado_cents: 0 }] };
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/atuacao/financeiro/resumo')) return resp(200, comSerie);
      return resp(200, []);
    });
    render(<FinanceiroPage />);
    expect(await screen.findByRole('heading', { name: 'Faturamento e recebimentos' })).toBeTruthy();
    expect(screen.getByRole('group', { name: /Cobrado e aprovado por dia/ })).toBeTruthy();
    expect(screen.getByText('Hoje (aprovado)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '90 dias' }));
    await waitFor(() => expect(urls().some((x) => x.includes('/financeiro/resumo?dias=90'))).toBe(true));
  });

  it('sem cobranças no período mostra o estado vazio', async () => {
    rota();
    render(<FinanceiroPage />);
    expect(await screen.findByText('Sem cobranças no período.')).toBeTruthy();
  });

  it('mostra o aviso fixo e os KPIs em R$ pt-BR a partir de centavos', async () => {
    rota();
    render(<FinanceiroPage />);
    expect(screen.getByText(/Somente consulta/)).toBeTruthy();
    const mrr = (await screen.findByText('MRR')).closest('div')!;
    expect(within(mrr).getByText('R$ 299,00')).toBeTruthy();
    expect(screen.getAllByText('R$ 499,00').length).toBeGreaterThan(0); // aprovado no mês (KPI e tile do gráfico)
    expect(screen.getByText('Clientes ativos')).toBeTruthy();
    expect(screen.getByText('MRR')).toBeTruthy();
    expect(screen.getByText('Clientes com pendência')).toBeTruthy();
    expect(screen.getByText('Aprovado no mês')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('lista clientes com plano, valor, situação, último pagamento e atraso em texto', async () => {
    rota();
    render(<FinanceiroPage />);
    expect((await screen.findAllByText('Alfa Ltda')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Profissional').length).toBeGreaterThan(0);
    expect(screen.getAllByText('R$ 99,00').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/05\/10\/2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Em atraso há 19 dias').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Com pendência').length).toBeGreaterThan(0);
  });

  it('usa singular para 1 dia', async () => {
    rota([{ ...cliAtraso, dias_em_atraso: 1 }]);
    render(<FinanceiroPage />);
    expect((await screen.findAllByText('Em atraso há 1 dia')).length).toBeGreaterThan(0);
  });

  it('filtros enviam q, situacao e pendencia=true', async () => {
    rota();
    render(<FinanceiroPage />);
    await screen.findAllByText('Alfa Ltda');
    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'ativa' } });
    fireEvent.click(screen.getByLabelText('Só com pendência'));
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'alfa' } });
    await waitFor(() => {
      const u = urls().filter((x) => x.includes('/financeiro/clientes')).pop()!;
      expect(u).toContain('situacao=ativa');
      expect(u).toContain('pendencia=true');
      expect(u).toContain('q=alfa');
    });
  });

  it('descarta resposta antiga (sem corrida)', async () => {
    let liberar!: (r: Response) => void;
    let n = 0;
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/financeiro/resumo')) return resp(200, resumo);
      n += 1;
      if (n === 1) return new Promise<Response>((r) => { liberar = r; });
      return resp(200, [cliAtraso]);
    });
    render(<FinanceiroPage />);
    fireEvent.change(screen.getByLabelText('Situação'), { target: { value: 'ativa' } });
    expect((await screen.findAllByText('Beta SA')).length).toBeGreaterThan(0);
    liberar(resp(200, [cli]));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Alfa Ltda')).toBeNull();
  });

  it('estado vazio', async () => {
    rota([]);
    render(<FinanceiroPage />);
    expect(await screen.findByText('Nenhum cliente encontrado.')).toBeTruthy();
  });

  it('403 mostra mensagem de permissão', async () => {
    fetchMock.mockImplementation(async () => resp(403, {}));
    render(<FinanceiroPage />);
    expect((await screen.findAllByText('Você não tem permissão para esta ação.')).length).toBeGreaterThan(0);
  });

  it('401 limpa a sessão', async () => {
    fetchMock.mockImplementation(async () => resp(401, {}));
    render(<FinanceiroPage />);
    await waitFor(() => expect(localStorage.getItem('montese_token')).toBeNull());
    expect(localStorage.getItem('montese_user')).toBeNull();
  });

  it('erro do resumo não derruba a lista (e vice-versa)', async () => {
    rota([cli], (u) => (u.includes('/financeiro/resumo') ? resp(500, {}) : undefined));
    render(<FinanceiroPage />);
    expect((await screen.findAllByText('Alfa Ltda')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.queryByText('MRR')).toBeNull();
  });

  it('NÃO tem ação financeira: só botões de navegação/filtro, nenhum campo de valor', async () => {
    rota();
    const { container } = render(<FinanceiroPage />);
    await screen.findAllByText('Alfa Ltda');
    const permitidos = /^(limpar filtros|tentar novamente|\d+ dias)$/i; // "7/30/90 dias" = período do gráfico (só consulta)
    for (const b of screen.queryAllByRole('button')) expect(b.textContent ?? '').toMatch(permitidos);
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(container.querySelector('[type="submit"]')).toBeNull();
    const txt = container.textContent ?? '';
    for (const p of [/cobrar/i, /estornar/i, /baixar/i, /cancelar assinatura/i, /alterar plano/i]) expect(txt).not.toMatch(p);
    for (const l of screen.queryAllByRole('link')) expect(l.getAttribute('href') ?? '').toMatch(/^\/atuacao\/clientes\//);
  });
});

describe('painel', () => {
  it('KPI "Clientes com pendência financeira" com valor', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/financeiro/resumo')) return resp(200, resumo);
      return resp(200, []);
    });
    render(<PainelPage />);
    expect(await screen.findByText('Clientes com pendência financeira')).toBeTruthy();
    const kpi = screen.getByText('Clientes com pendência financeira').closest('div')!;
    expect(within(kpi).getByText('2')).toBeTruthy();
  });

  it('erro do financeiro fica isolado', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/financeiro/resumo')) return resp(403, {});
      if (u.endsWith('/atuacao/painel')) {
        return resp(200, { gerado_em: '2026-10-29T12:00:00Z', empresas: null, tarefas: null, agenda: null, documentos: null, pendencias: [], indisponiveis: [] });
      }
      return resp(200, []);
    });
    render(<PainelPage />);
    expect(await screen.findByText('Você não tem permissão para esta ação.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Minha agenda' })).toBeTruthy();
  });
});

describe('ficha do cliente', () => {
  it('cartão Financeiro somente leitura', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/financeiro/clientes/t-1')) return resp(200, ficha);
      if (u.includes('/interacoes')) return resp(200, []);
      if (u.includes('/atuacao/clientes/t-1')) {
        return resp(200, { id: 't-1', name: 'Alfa Ltda', trade_name: null, cnpj: '12345678000190', sector: null, contact_name: null,
          contact_phone: null, status: 'active', situacao: 'ativa', contact_role: null, notes: null, plan: 'x', created_at: '2026-01-01', units: [], responsaveis: [] });
      }
      return resp(200, []);
    });
    render(<FichaPage />);
    const titulo = await screen.findByRole('heading', { name: 'Financeiro' });
    const card = titulo.closest('div')!;
    expect(await within(card).findByText('Em atraso há 19 dias')).toBeTruthy();
    expect(within(card).getAllByText('R$ 99,00').length).toBeGreaterThan(0);
    expect(within(card).getAllByText(/01\/10\/2026/).length).toBeGreaterThan(0);
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
    expect(within(card).queryAllByRole('textbox')).toHaveLength(0);
  });

  it('erro do financeiro não derruba a ficha', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/financeiro/')) return resp(403, {});
      if (u.includes('/interacoes')) return resp(200, []);
      if (u.includes('/atuacao/clientes/t-1')) {
        return resp(200, { id: 't-1', name: 'Alfa Ltda', trade_name: null, cnpj: '12345678000190', sector: null, contact_name: null,
          contact_phone: null, status: 'active', situacao: 'ativa', contact_role: null, notes: null, plan: 'x', created_at: '2026-01-01', units: [], responsaveis: [] });
      }
      return resp(200, []);
    });
    render(<FichaPage />);
    expect(await screen.findByText('Dados cadastrais (somente leitura)')).toBeTruthy();
    expect(await screen.findByText('Você não tem permissão para esta ação.')).toBeTruthy();
  });
});
