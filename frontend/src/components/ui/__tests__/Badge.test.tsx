import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../Badge';

describe('Badge', () => {
  it('renderiza o texto e aplica a cor do tone "crit"', () => {
    render(<Badge tone="crit">Vencido</Badge>);
    const el = screen.getByText('Vencido');
    expect(el.className).toContain('bg-dash-status-crit-bg');
    expect(el.className).toContain('text-dash-status-crit-text');
  });

  it('nunca depende só da cor — o texto do selo é sempre visível', () => {
    render(<Badge tone="ok">Válido</Badge>);
    expect(screen.getByText('Válido')).toBeInTheDocument();
  });
});
