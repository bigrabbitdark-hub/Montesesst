// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CatPanel } from './CatPanel';

const calls: Array<{ url: string; method: string; body?: any }> = [];
beforeEach(() => {
  calls.length = 0; localStorage.setItem('montese_token', 't');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const body = url.includes('/esocial/accidents') && !init?.method ? [{ id: 'a1', employee_name: 'João', acid_date: '2026-09-10', acid_type: 1, cat_type: 1, death: false }]
      : url.includes('/employees') ? [{ id: 'e1', full_name: 'João' }]
      : url.includes('/esocial/certificates') ? [{ id: 'c1', label: 'A1', status: 'ativo' }]
      : url.includes('/diagnostics') ? { ok: false, issues: [{ code: 'VINCULO_NAO_CONFIRMADO', message: 'Confirme o vínculo', blocking: true }] }
      : {};
    return { ok: true, json: async () => body } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('CatPanel', () => {
  it('avisa que é dado sensível e lista a CAT com o tipo em português', async () => {
    render(<CatPanel />);
    expect(screen.getByRole('note').textContent).toMatch(/Dado de saúde sensível/);
    expect(await screen.findByText('João', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText('Típico')).toBeTruthy();
  });

  it('mostra as pendências bloqueantes e gera o rascunho só com certificado', async () => {
    const onCreated = vi.fn();
    render(<CatPanel onEventCreated={onCreated} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verificar pendências' }));
    expect(await screen.findByText('Confirme o vínculo')).toBeTruthy();
    expect(screen.getByText('Bloqueia')).toBeTruthy();
    const gerar = screen.getByRole('button', { name: /Gerar evento S-2210/ });
    await waitFor(() => expect((gerar as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(gerar);
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/esocial/events'))?.body).toEqual({ accidentId: 'a1', certificateId: 'c1' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });
});
