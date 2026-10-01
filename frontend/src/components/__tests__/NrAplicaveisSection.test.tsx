import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NrAplicaveisSection } from '../NrAplicaveisSection';

const catalogo = [
  { code: 'NR-1', nome: 'PGR' },
  { code: 'NR-5', nome: 'CIPA' },
];

describe('NrAplicaveisSection', () => {
  it('mostra uma caixa por NR do catálogo, marcando as selecionadas', () => {
    render(<NrAplicaveisSection catalogo={catalogo} selecionadas={['NR-5']} disabled={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /NR-1/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /NR-5/ })).toBeChecked();
  });
  it('marcar e desmarcar chama onChange com a lista nova, na ordem do catálogo', () => {
    const onChange = vi.fn();
    render(<NrAplicaveisSection catalogo={catalogo} selecionadas={['NR-5']} disabled={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /NR-1/ }));
    expect(onChange).toHaveBeenLastCalledWith(['NR-1', 'NR-5']);
    fireEvent.click(screen.getByRole('checkbox', { name: /NR-5/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
  it('desabilitado (visita concluída): caixas travadas', () => {
    render(<NrAplicaveisSection catalogo={catalogo} selecionadas={[]} disabled onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /NR-1/ })).toBeDisabled();
  });
  it('salvando: expõe "Salvando…" com role status; sem salvando não aparece', () => {
    const { rerender } = render(
      <NrAplicaveisSection catalogo={catalogo} selecionadas={[]} disabled={false} salvando onChange={() => {}} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Salvando…');
    rerender(<NrAplicaveisSection catalogo={catalogo} selecionadas={[]} disabled={false} onChange={() => {}} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Salvando…')).not.toBeInTheDocument();
  });
  it('desabilitado: clicar na caixa não chama onChange', () => {
    const onChange = vi.fn();
    render(<NrAplicaveisSection catalogo={catalogo} selecionadas={[]} disabled onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /NR-1/ }));
    expect(onChange).not.toHaveBeenCalled();
  });
  it('explica que a decisão é do técnico e que só vale ao concluir', () => {
    render(<NrAplicaveisSection catalogo={catalogo} selecionadas={[]} disabled={false} onChange={() => {}} />);
    expect(screen.getByText(/aplicabilidade é decisão do técnico/i)).toBeInTheDocument();
    expect(screen.getByText(/ao concluir a visita/i)).toBeInTheDocument();
  });
});
