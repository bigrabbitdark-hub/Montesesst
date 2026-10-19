import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Pagination } from '../Pagination';

describe('Pagination', () => {
  it('é uma navegação rotulada e mostra página atual, total de páginas e de registros', () => {
    render(<Pagination page={2} pageSize={25} total={60} onChange={() => {}} />);
    expect(screen.getByRole('navigation', { name: 'Paginação' })).toBeInTheDocument();
    expect(screen.getByText('Página 2 de 3 · 60 registros')).toBeInTheDocument();
  });
  it('singular e página única quando não há registros', () => {
    render(<Pagination page={1} pageSize={25} total={1} onChange={() => {}} />);
    expect(screen.getByText('Página 1 de 1 · 1 registro')).toBeInTheDocument();
  });
  it('anterior desabilitado na primeira página e próxima na última', () => {
    const { rerender } = render(<Pagination page={1} pageSize={10} total={30} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeEnabled();
    rerender(<Pagination page={3} pageSize={10} total={30} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeEnabled();
  });
  it('chama onChange com a página vizinha', () => {
    const onChange = vi.fn();
    render(<Pagination page={2} pageSize={10} total={30} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Página anterior' }));
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(onChange.mock.calls).toEqual([[1], [3]]);
  });
  it('alvos de toque de pelo menos 44px', () => {
    render(<Pagination page={1} pageSize={10} total={30} onChange={() => {}} />);
    screen.getAllByRole('button').forEach((b) => expect(b.className).toContain('min-h-[44px]'));
  });
});
