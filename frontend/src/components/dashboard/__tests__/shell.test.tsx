import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let pathname = '/empresa/cipa/membros';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));
const logout = vi.fn();
vi.mock('@/lib/auth', () => ({ logout: () => logout(), getToken: () => null }));

import { DashboardSidebar } from '../DashboardSidebar';

beforeEach(() => {
  pathname = '/empresa/cipa/membros';
  logout.mockClear();
});

describe('DashboardSidebar', () => {
  it('em subrota, só a Central da CIPA fica com aria-current', () => {
    render(<DashboardSidebar />);
    const atual = screen.getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page');
    expect(atual).toHaveLength(1);
    expect(atual[0]).toHaveTextContent('CIPA');
  });
  it('lista Eleição e Capacitação da CIPA', () => {
    render(<DashboardSidebar />);
    expect(screen.getByRole('link', { name: /Eleição/ })).toHaveAttribute('href', '/empresa/cipa/eleicao');
    expect(screen.getByRole('link', { name: /Capacitação/ })).toHaveAttribute('href', '/empresa/cipa/capacitacao');
  });
  it('rola a lista até o item ativo (fica visível em telas baixas)', () => {
    const rolar = vi.fn();
    Element.prototype.scrollIntoView = rolar;
    render(<DashboardSidebar />);
    expect(rolar).toHaveBeenCalledTimes(1);
    expect(rolar.mock.instances[0]).toHaveTextContent('CIPA');
  });
  it('tem botão Sair que chama logout', () => {
    render(<DashboardSidebar />);
    fireEvent.click(screen.getByRole('button', { name: /Sair/ }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
