import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/components/epi/EpiDashboardView', () => ({
  EpiDashboardView: ({ onGerarLink, onPresencial, refreshKey }: { onGerarLink?: (d: string, e: string) => void; onPresencial?: (d: string) => void; refreshKey?: number }) => (
    <div data-testid="view-painel" data-refresh={String(refreshKey ?? 0)}><button onClick={() => onGerarLink?.('d1', 'emp1')}>gerar</button><button onClick={() => onPresencial?.('dp1')}>presencial</button></div>
  ),
}));
vi.mock('@/components/epi/EpiMovimentacaoView', () => ({ EpiMovimentacaoView: () => <div data-testid="view-mov" /> }));
vi.mock('@/components/epi/SignatureLinkDialog', () => ({
  SignatureLinkDialog: ({ open, employeeId, deliveryIds, onClose }: { open: boolean; employeeId: string; deliveryIds?: string[]; onClose: (c?: boolean) => void }) =>
    open ? (
      <div data-testid="dlg-link">
        {employeeId}|{(deliveryIds ?? []).join(',')}
        <button onClick={() => onClose(false)}>cancelar</button>
        <button onClick={() => onClose(true)}>gerado</button>
      </div>
    ) : null,
}));
vi.mock('@/components/epi/InPersonDialog', () => ({
  InPersonDialog: ({ open, deliveryIds, onClose, onDone }: { open: boolean; deliveryIds: string[]; onClose: () => void; onDone: (r: unknown) => void }) =>
    open ? <div data-testid="dlg-person">{deliveryIds.join(',')}<button onClick={() => { onDone({}); onClose(); }}>concluir</button><button onClick={onClose}>cancelar-p</button></div> : null,
}));
vi.mock('@/components/epi/EpiFichasView', () => ({ EpiFichasView: () => <div data-testid="view-fichas" /> }));
vi.mock('@/components/epi/EpiCadastroView', () => ({ EpiCadastroView: () => <div data-testid="view-cadastro" /> }));

import Painel from '../page';
import Cadastro from '../cadastro/page';
import Movimentacao from '../movimentacao/page';
import Fichas from '../fichas/page';

beforeEach(() => { localStorage.clear(); push.mockReset(); });

describe.each([
  ['Painel', Painel, 'Painel de EPI', 'view-painel'],
  ['Cadastro', Cadastro, 'Cadastro de EPI', 'view-cadastro'],
  ['Movimentação', Movimentacao, 'Movimentação de EPI', 'view-mov'],
  ['Fichas', Fichas, 'Fichas de EPI', 'view-fichas'],
])('página %s', (_n, Pagina, titulo, testId) => {
  it('mostra o título e coloca o miolo dentro do escopo .skin-dash', async () => {
    localStorage.setItem('montese_token', 'x');
    const { container } = render(<Pagina />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: titulo })).toBeInTheDocument());
    expect(screen.getByTestId(testId).closest('.skin-dash')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).closest('.skin-dash')).toBeNull();
    expect(container.querySelectorAll('.skin-dash')).toHaveLength(1);
  });

  it('sem token manda para o login e não monta o miolo', async () => {
    render(<Pagina />);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
    expect(screen.queryByTestId(testId)).toBeNull();
  });
});

describe('Painel: recarga após gerar link', () => {
  it('fechar o diálogo após gerar link recarrega o painel (refreshKey muda); fechar sem gerar não', async () => {
    localStorage.setItem('montese_token', 'x');
    render(<Painel />);
    const view = await screen.findByTestId('view-painel');
    expect(view.dataset.refresh).toBe('0');
    fireEvent.click(screen.getByText('gerar'));
    fireEvent.click(screen.getByText('cancelar'));
    expect(screen.getByTestId('view-painel').dataset.refresh).toBe('0');
    fireEvent.click(screen.getByText('gerar'));
    fireEvent.click(screen.getByText('gerado'));
    expect(screen.queryByTestId('dlg-link')).toBeNull();
    expect(screen.getByTestId('view-painel').dataset.refresh).toBe('1');
  });
});

describe('Painel: ponte "Gerar link"', () => {
  it('onGerarLink abre o diálogo de assinatura com o funcionário e a entrega; fechado, não há diálogo', async () => {
    localStorage.setItem('montese_token', 'x');
    render(<Painel />);
    await screen.findByTestId('view-painel');
    expect(screen.queryByTestId('dlg-link')).toBeNull();
    fireEvent.click(screen.getByText('gerar'));
    expect(screen.getByTestId('dlg-link')).toHaveTextContent('emp1|d1');
  });
});

describe('Painel: assinatura presencial', () => {
  it('abre o diálogo com a entrega; concluir recarrega o painel; cancelar não', async () => {
    localStorage.setItem('montese_token', 'x');
    render(<Painel />);
    await screen.findByTestId('view-painel');
    fireEvent.click(screen.getByText('presencial'));
    expect(screen.getByTestId('dlg-person')).toHaveTextContent('dp1');
    fireEvent.click(screen.getByText('cancelar-p'));
    expect(screen.getByTestId('view-painel').dataset.refresh).toBe('0');
    fireEvent.click(screen.getByText('presencial'));
    fireEvent.click(screen.getByText('concluir'));
    expect(screen.queryByTestId('dlg-person')).toBeNull();
    expect(screen.getByTestId('view-painel').dataset.refresh).toBe('1');
  });
  it('enquanto não há sessão o "Carregando..." usa 16px (text-base), nunca text-sm', () => {
    const { container } = render(<Painel />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Carregando...');
    expect(el.className).toContain('text-base');
    expect(container.innerHTML).not.toContain('text-sm');
  });
});
