import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/lib/auth', () => ({ getToken: () => 'tok', getUser: () => ({ id: 'u1', role: 'tecnico', tenantId: 'x' }) }));

import { EpiResumoCard } from '../EpiResumoCard';

const fetchMock = vi.fn();
const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const dash = (k: Partial<Record<string, number>> = {}) => ({
  alert_days: 30, period: { from: '2026-09-18', to: '2026-10-18' },
  kpis: { epis_total: 12, stock_total: 100, stock_value: '1.00', low_stock: 2, zero_stock: 1, ca_expired: 0, ca_expiring: 0, lots_expired: 0, lots_expiring: 0, pending_signatures: 4, ...k },
  alerts: [], recent_movements: [], pending: [],
});

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('EpiResumoCard', () => {
  it('mostra os 3 números do painel da empresa pedida (tenant_id na consulta) e o link para o módulo', async () => {
    fetchMock.mockResolvedValue(res(dash()));
    render(<EpiResumoCard tenantId="ten-1" />);
    expect(screen.getByRole('status', { name: 'Carregando resumo de EPI' })).toBeInTheDocument();
    expect(await screen.findByText('EPIs ativos')).toBeInTheDocument();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(new URL(url, 'http://x').searchParams.get('tenant_id')).toBe('ten-1');
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Estoque baixo ou zerado').nextElementSibling).toHaveTextContent('3');
    expect(screen.getByText('Aguardando assinatura').nextElementSibling).toHaveTextContent('4');
    expect(screen.getByRole('link', { name: 'Abrir módulo de EPI' })).toHaveAttribute('href', '/tecnico/empresas/ten-1/epi');
  });

  it('empresa não visível (404) mostra aviso próprio, sem números nem link, e permite tentar de novo', async () => {
    fetchMock.mockResolvedValueOnce(res({ message: 'x' }, 404)).mockResolvedValue(res(dash()));
    render(<EpiResumoCard tenantId="ten-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Empresa não encontrada ou sem acesso para você.');
    expect(screen.queryByRole('link', { name: 'Abrir módulo de EPI' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('EPIs ativos')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('erro de rede/servidor usa mensagem fechada (nunca o texto do servidor)', async () => {
    fetchMock.mockResolvedValue(res({ message: 'stack interna zzz' }, 500));
    render(<EpiResumoCard tenantId="ten-1" />);
    const a = await screen.findByRole('alert');
    expect(a).toHaveTextContent('Não foi possível concluir a operação.');
    expect(a.textContent).not.toMatch(/zzz/);
  });

  it('resposta atrasada de outra empresa é descartada ao trocar de empresa', async () => {
    let r1!: (v: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => { r1 = r; })).mockResolvedValue(res(dash({ epis_total: 7 })));
    const { rerender } = render(<EpiResumoCard tenantId="ten-1" />);
    rerender(<EpiResumoCard tenantId="ten-2" />);
    expect(await screen.findByText('7')).toBeInTheDocument();
    r1(res(dash({ epis_total: 99 })));
    await waitFor(() => expect(screen.queryByText('99')).toBeNull());
    expect(screen.getByRole('link', { name: 'Abrir módulo de EPI' })).toHaveAttribute('href', '/tecnico/empresas/ten-2/epi');
  });
});
