import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/RoleGuard', () => ({ RoleGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/dashboard/TecnicoShell', () => ({
  TecnicoShell: ({ children }: { children: React.ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock('@/components/WhatsAppButton', () => ({ WhatsAppButton: () => <div data-testid="whatsapp" /> }));

import TecnicoLayout from '../layout';

describe('layout do técnico', () => {
  it('põe o conteúdo dentro do shell novo e do escopo .skin-dash, com o botão do WhatsApp', () => {
    render(<TecnicoLayout><p>página</p></TecnicoLayout>);
    const pagina = screen.getByText('página');
    expect(pagina.closest('[data-testid="shell"]')).not.toBeNull();
    expect(pagina.closest('.skin-dash')).not.toBeNull();
    expect(screen.getByTestId('whatsapp')).toBeInTheDocument();
  });
});
