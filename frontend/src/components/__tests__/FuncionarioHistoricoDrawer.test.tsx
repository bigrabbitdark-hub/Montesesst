import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FuncionarioHistoricoDrawer } from '../FuncionarioHistoricoDrawer';

const resp = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, headers: new Headers(), json: async () => body }) as Response;
const item = (over = {}) => ({
  id: 'h1', field: 'position', old_value: 'Soldador', new_value: 'Eletricista', actor_role: 'empresa',
  source: 'tabela', changed_at: '2026-10-13T15:30:00Z', ...over,
});

describe('FuncionarioHistoricoDrawer', () => {
  beforeEach(() => localStorage.setItem('montese_token', 't'));
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('é um diálogo rotulado, busca o histórico e mostra campo, de→para, quem, origem e quando', async () => {
    const f = vi.fn().mockResolvedValue(resp({ items: [item()], total: 1 }));
    vi.stubGlobal('fetch', f);
    render(<FuncionarioHistoricoDrawer employeeId="e1" employeeName="Ana Teste" onClose={() => {}} />);
    const dlg = await screen.findByRole('dialog', { name: 'Histórico de Ana Teste' });
    expect(dlg).toBeTruthy();
    expect(f.mock.calls[0][0]).toBe('/api/employees/e1/history?limit=50&offset=0');
    expect(await screen.findByText('Função/Cargo')).toBeTruthy();
    expect(screen.getByText('Soldador')).toBeTruthy();
    expect(screen.getByText('Eletricista')).toBeTruthy();
    expect(screen.getByText(/Empresa/)).toBeTruthy();
    expect(screen.getByText(/Edição da tabela/)).toBeTruthy();
    expect(screen.getByText(/13\/10\/2026 12:30/)).toBeTruthy();
  });

  it('estado vazio, erro em português e fechar por botão e por Esc', async () => {
    const onClose = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ items: [], total: 0 })));
    const { unmount } = render(<FuncionarioHistoricoDrawer employeeId="e1" employeeName="Ana" onClose={onClose} />);
    expect(await screen.findByText('Nenhuma alteração registrada para este funcionário.')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ message: 'x' }, 500)));
    render(<FuncionarioHistoricoDrawer employeeId="e1" employeeName="Ana" onClose={() => {}} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Não foi possível carregar o histórico');
  });

  it('"Carregar mais" busca a próxima página e acrescenta', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(resp({ items: [item({ id: 'h1', new_value: 'A' })], total: 2 }))
      .mockResolvedValueOnce(resp({ items: [item({ id: 'h2', new_value: 'B' })], total: 2 }));
    vi.stubGlobal('fetch', f);
    render(<FuncionarioHistoricoDrawer employeeId="e1" employeeName="Ana" onClose={() => {}} />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await screen.findByText('B');
    expect(f.mock.calls[1][0]).toBe('/api/employees/e1/history?limit=50&offset=1');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('Tab e Shift+Tab ciclam dentro do diálogo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ items: [item()], total: 2 })));
    render(<FuncionarioHistoricoDrawer employeeId="e1" employeeName="Ana" onClose={() => {}} />);
    const dlg = await screen.findByRole('dialog');
    const fechar = screen.getByRole('button', { name: 'Fechar' });
    const mais = await screen.findByRole('button', { name: 'Carregar mais' });
    mais.focus();
    fireEvent.keyDown(dlg, { key: 'Tab' });
    expect(document.activeElement).toBe(fechar);
    fireEvent.keyDown(dlg, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(mais);
  });

  it('devolve o foco a quem abriu ao fechar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ items: [], total: 0 })));
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<FuncionarioHistoricoDrawer employeeId="e1" employeeName="Ana" onClose={() => {}} />);
    await screen.findByRole('dialog');
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('erro na 2ª página mantém a lista e "Tentar novamente" refaz a mesma página', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(resp({ items: [item({ id: 'h1', new_value: 'A' })], total: 2 }))
      .mockResolvedValueOnce(resp({ message: 'x' }, 500))
      .mockResolvedValueOnce(resp({ items: [item({ id: 'h2', new_value: 'B' })], total: 2 }));
    vi.stubGlobal('fetch', f);
    render(<FuncionarioHistoricoDrawer employeeId="e1" employeeName="Ana" onClose={() => {}} />);
    await screen.findByText('A');
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('B');
    expect(f.mock.calls[2][0]).toBe('/api/employees/e1/history?limit=50&offset=1');
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
