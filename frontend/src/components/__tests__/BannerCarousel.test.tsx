import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BannerCarousel } from '../BannerCarousel';

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never;
});

describe('BannerCarousel', () => {
  it('mostra 2 slides, controles e navega por próximo/anterior/indicador', () => {
    render(<BannerCarousel />);
    expect(screen.getAllByRole('img', { hidden: true })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Ir para o banner 1 de 2/ }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Próximo banner' }));
    expect(screen.getByRole('button', { name: /Ir para o banner 2 de 2/ }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Próximo banner' }));
    expect(screen.getByRole('button', { name: /Ir para o banner 1 de 2/ }).getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Banner anterior' }));
    expect(screen.getByRole('button', { name: /Ir para o banner 2 de 2/ }).getAttribute('aria-current')).toBe('true');
  });

  it('com redução de movimento começa pausado e permite reproduzir', () => {
    render(<BannerCarousel />);
    expect(screen.getByRole('button', { name: /Retomar a rotação/ })).toBeTruthy();
  });

  it('tem links reais de e-mail e WhatsApp sobre os botões, só focáveis no slide ativo', () => {
    render(<BannerCarousel />);
    const emails = screen.getAllByLabelText('Solicitar diagnóstico por e-mail', { selector: 'a' });
    const zaps = screen.getAllByLabelText(/Falar com a Montese pelo WhatsApp/, { selector: 'a' });
    expect(emails.length).toBeGreaterThanOrEqual(2);
    expect(emails[0].getAttribute('href')).toBe(
      'mailto:eng.evelynsouza@montesesst.com.br?subject=Solicita%C3%A7%C3%A3o%20de%20Diagn%C3%B3stico%20Gratuito%20SST',
    );
    expect(zaps[0].getAttribute('href')).toContain('https://wa.me/5548992050516?text=');
    expect(emails[0].getAttribute('tabindex')).toBe('0');
    expect(emails[1].getAttribute('tabindex')).toBe('-1');
  });
});
