import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EpiTabs } from '../EpiTabs';

const TABS = [{ id: 'a', label: 'Resumo' }, { id: 'b', label: 'Lotes' }, { id: 'c', label: 'Histórico' }];

function Harness({ onChange = () => {} }: { onChange?: (id: string) => void }) {
  const [v, setV] = useState('a');
  return <EpiTabs tabs={TABS} value={v} onChange={(id) => { setV(id); onChange(id); }} ariaLabel="Seções" idPrefix="x" />;
}

describe('EpiTabs', () => {
  it('é um tablist rotulado com abas, aria-selected e roving tabindex', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Seções' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    // sem painel no DOM, não há aria-controls apontando para o vazio
    expect(tabs[1]).not.toHaveAttribute('aria-controls');
    expect(tabs[1]).toHaveAttribute('id', 'x-tab-b');
  });
  it('seta direita avança, move o foco e ativa; ao final volta ao começo', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const [a, b, c] = screen.getAllByRole('tab');
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    expect(b).toHaveFocus();
    expect(b).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(b, { key: 'ArrowRight' });
    expect(c).toHaveFocus();
    fireEvent.keyDown(c, { key: 'ArrowRight' });
    expect(a).toHaveFocus();
    expect(onChange.mock.calls.map((x) => x[0])).toEqual(['b', 'c', 'a']);
  });
  it('seta esquerda recua com volta circular; Home e End vão às pontas', () => {
    render(<Harness />);
    const [a, b, c] = screen.getAllByRole('tab');
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowLeft' });
    expect(c).toHaveFocus();
    fireEvent.keyDown(c, { key: 'Home' });
    expect(a).toHaveFocus();
    fireEvent.keyDown(a, { key: 'End' });
    expect(c).toHaveFocus();
    expect(b).toHaveAttribute('tabindex', '-1');
  });
  it('clique ativa a aba; abas têm alvo de 44px', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const tab = screen.getByRole('tab', { name: 'Lotes' });
    fireEvent.click(tab);
    expect(onChange).toHaveBeenCalledWith('b');
    expect(tab.className).toContain('min-h-[44px]');
  });
});

describe('EpiTabs: aria-controls só com painel existente', () => {
  it('somente a aba cujo painel está montado recebe aria-controls, e muda junto com a aba ativa', () => {
    function WithPanel() {
      const [v, setV] = useState('a');
      return (
        <>
          <EpiTabs tabs={TABS} value={v} onChange={setV} ariaLabel="Seções" idPrefix="x" />
          <div role="tabpanel" id={`x-panel-${v}`} aria-labelledby={`x-tab-${v}`} />
        </>
      );
    }
    render(<WithPanel />);
    const ctl = () => screen.getAllByRole('tab').map((t) => t.getAttribute('aria-controls'));
    expect(ctl()).toEqual(['x-panel-a', null, null]);
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(ctl()).toEqual([null, 'x-panel-b', null]);
  });
});
