import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiagnosticoHero } from '../DiagnosticoHero';

describe('DiagnosticoHero', () => {
  it('tem o título da oferta como H2 (o H1 é do hero principal)', () => {
    render(<DiagnosticoHero />);
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toContain('Sua empresa está em dia com a Segurança do Trabalho?');
  });

  it('WhatsApp aponta para o número oficial com a mensagem pré-preenchida', () => {
    render(<DiagnosticoHero />);
    const link = screen.getByRole('link', { name: /Falar com a Montese pelo WhatsApp/ });
    expect(link.getAttribute('href')).toBe(
      'https://wa.me/5548992050516?text=Ol%C3%A1%21%20Quero%20solicitar%20o%20diagn%C3%B3stico%20gratuito%20de%20SST%20da%20minha%20empresa.',
    );
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('e-mail abre o aplicativo com destinatário e assunto', () => {
    render(<DiagnosticoHero />);
    const link = screen.getByRole('link', { name: /Solicitar diagnóstico por e-mail/ });
    expect(link.getAttribute('href')).toBe(
      'mailto:eng.evelynsouza@montesesst.com.br?subject=Solicita%C3%A7%C3%A3o%20de%20Diagn%C3%B3stico%20Gratuito%20SST',
    );
  });
});
