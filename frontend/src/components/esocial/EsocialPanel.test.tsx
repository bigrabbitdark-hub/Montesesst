// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EsocialPanel } from './EsocialPanel';

const evento = (status: string, tipo = 'S-2220') => ({ id: 'e1', event_type: tipo, target_event_id: null, status, employee_name: 'Maria', protocolo_lote: null, nr_recibo: null, erro_codigo: null, erro_mensagem: null, created_at: '2026-10-05T12:00:00Z' });

function mockApi(status: string, calls: Array<{ url: string; method: string }>, tipo = 'S-2220') {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    const body = url.includes('/esocial/events') && !url.includes('/e1/') ? [evento(status, tipo)] : url.includes('/esocial/certificates') ? [] : url.includes('/employees') ? [] : url.includes('/pcmso') ? [] : {};
    return { ok: true, json: async () => body } as Response;
  }));
}

describe('EsocialPanel', () => {
  beforeEach(() => { localStorage.setItem('montese_token', 't'); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('avisa que é Produção Restrita e mostra o evento com o estado em português', async () => {
    mockApi('rascunho', []);
    render(<EsocialPanel />);
    expect(screen.getByRole('note').textContent).toMatch(/Produção Restrita/);
    expect(await screen.findByText(/Rascunho \(aguarda sua autorização\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Autorizar' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /transmitir/i })).toBeNull(); // só aparece depois de autorizar
  });

  it('cancelar a confirmação NÃO transmite; confirmar transmite uma vez', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    mockApi('aguardando_transmissao', calls);
    render(<EsocialPanel />);
    const botao = await screen.findByRole('button', { name: /Assinar e transmitir/ });

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(botao);
    expect(calls.some((c) => c.url.endsWith('/transmit'))).toBe(false);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(botao);
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/transmit') && c.method === 'POST')).toHaveLength(1));
  });

  it('S-3000: oferece "Excluir" só em S-2220 processado, e cancelar a confirmação não cria nada', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    mockApi('processado', calls);
    render(<EsocialPanel />);
    const botao = await screen.findByRole('button', { name: 'Excluir (S-3000)' });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(botao);
    expect(calls.some((c) => c.url.endsWith('/exclusion'))).toBe(false);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(botao);
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/exclusion') && c.method === 'POST')).toHaveLength(1));
  });

  it('não oferece "Excluir" em evento S-3000 nem em S-2220 ainda não processado', async () => {
    mockApi('processado', [], 'S-3000');
    const { unmount } = render(<EsocialPanel />);
    await screen.findByText('S-3000');
    expect(screen.queryByRole('button', { name: 'Excluir (S-3000)' })).toBeNull();
    unmount();
    mockApi('transmitido', []);
    render(<EsocialPanel />);
    await screen.findByText(/Transmitido, consulte/);
    expect(screen.queryByRole('button', { name: 'Excluir (S-3000)' })).toBeNull();
  });
});
