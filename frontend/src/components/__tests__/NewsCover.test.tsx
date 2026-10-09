import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NewsCover } from '../NewsCover';

describe('NewsCover', () => {
  it('é decorativa para leitores de tela', () => {
    const { container } = render(<NewsCover category="eSocial SST" seed="a" />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('usa foto real quando a categoria tem foto', () => {
    const { container } = render(<NewsCover category="Medicina Ocupacional" seed="a" />);
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/medicina-\d\.jpg/);
  });

  it('cai na ilustração com ícone para categoria sem foto', () => {
    const { container } = render(<NewsCover category="Categoria nova" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg.lucide')).not.toBeNull();
  });
});
