import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/atuacao',
}));
vi.mock('@/components/dashboard/AtuacaoShell', () => ({
  AtuacaoShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock('@/components/WhatsAppButton', () => ({ WhatsAppButton: () => <div data-testid="whatsapp" /> }));

import AtuacaoLayout from '../layout';
import { homeFor } from '@/lib/auth';

function token(): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `x.${payload}.y`;
}
function sessao(role: string) {
  localStorage.setItem('montese_token', token());
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u1', role, tenantId: null }));
}

describe('homeFor', () => {
  it('sócio vai para /atuacao e os outros papéis seguem iguais', () => {
    expect(homeFor('socio')).toBe('/atuacao');
    expect(homeFor('empresa')).toBe('/dashboard-v2');
    expect(homeFor('tecnico')).toBe('/tecnico/empresas');
    expect(homeFor('parceiro')).toBe('/tecnico/empresas');
    expect(homeFor('admin')).toBe('/admin/overview');
  });
});

describe('layout de /atuacao', () => {
  beforeEach(() => {
    localStorage.clear();
    replace.mockReset();
  });

  it('renderiza o conteúdo para o sócio', async () => {
    sessao('socio');
    render(<AtuacaoLayout><p>página</p></AtuacaoLayout>);
    const pagina = await screen.findByText('página');
    expect(pagina.closest('[data-testid="shell"]')).not.toBeNull();
    expect(pagina.closest('.skin-dash')).not.toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    ['empresa', '/dashboard-v2'],
    ['tecnico', '/tecnico/empresas'],
    ['admin', '/admin/overview'],
  ])('redireciona %s para a própria home', async (role, destino) => {
    sessao(role);
    render(<AtuacaoLayout><p>página</p></AtuacaoLayout>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(destino));
    expect(screen.queryByText('página')).toBeNull();
  });
});
