import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NewsCover } from '../NewsCover';

describe('NewsCover', () => {
  it('é decorativa para leitores de tela', () => {
    const { container } = render(<NewsCover category="eSocial SST" />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renderiza ícone para categoria conhecida e para desconhecida', () => {
    expect(render(<NewsCover category="Gestão para RH" />).container.querySelector('svg.lucide')).not.toBeNull();
    expect(render(<NewsCover category="Categoria nova" />).container.querySelector('svg.lucide')).not.toBeNull();
  });
});
