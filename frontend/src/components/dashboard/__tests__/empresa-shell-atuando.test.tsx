import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen } from '@testing-library/react';

let pathname = '/empresa/funcionarios';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));
vi.mock('@/lib/auth', () => ({ logout: vi.fn(), getToken: () => null, getUser: () => null }));
const avisoMontou = vi.fn();
vi.mock('@/components/SubscriptionNotice', () => ({
  SubscriptionNotice: () => { useEffect(() => { avisoMontou(); }, []); return <div data-testid="aviso-assinatura" />; },
}));
const filhoMontou = vi.fn();
function Filho() { useEffect(() => { filhoMontou(); }, []); return <div data-testid="filho">conteudo</div>; }

import { EmpresaShell } from '../EmpresaShell';

function atuar() {
  localStorage.setItem('montese_acting', JSON.stringify({ tenantId: 't1', tenantName: 'Empresa X', expiresAt: Date.now() + 60000 }));
}
const filho = <Filho />;

beforeEach(() => { filhoMontou.mockClear(); avisoMontou.mockClear(); localStorage.clear(); pathname = '/empresa/funcionarios'; });

describe('EmpresaShell fora do modo atuação (visual inalterado)', () => {
  it('mostra menu completo, IA, aviso de assinatura e as páginas bloqueadas', () => {
    pathname = '/empresa/assistente';
    render(<EmpresaShell>{filho}</EmpresaShell>);
    expect(screen.getAllByRole('link', { name: /Assistente Montese/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /IA SST/ })).toBeInTheDocument();
    expect(screen.getByTestId('aviso-assinatura')).toBeInTheDocument();
    expect(screen.getByTestId('filho')).toBeInTheDocument();
    expect(filhoMontou).toHaveBeenCalled();
    expect(avisoMontou).toHaveBeenCalled();
  });
});

describe('EmpresaShell no modo atuação', () => {
  it('esconde itens de menu, botão de IA e aviso de assinatura', () => {
    atuar();
    render(<EmpresaShell>{filho}</EmpresaShell>);
    for (const nome of [/Assistente Montese/, /Reuniões e Visitas/, /Auditoria Montese/, /Empresas/, /IA SST/]) {
      expect(screen.queryByRole('link', { name: nome })).toBeNull();
    }
    expect(screen.getByRole('link', { name: /Funcionários/ })).toBeInTheDocument();
    expect(screen.queryByTestId('aviso-assinatura')).toBeNull();
    expect(screen.getByTestId('filho')).toBeInTheDocument();
  });
  it('URL direta de área bloqueada mostra mensagem em vez de montar a página', () => {
    atuar();
    pathname = '/empresa/assistente';
    render(<EmpresaShell>{filho}</EmpresaShell>);
    expect(screen.getByText('Esta área não está disponível no modo empresa. Saia do modo empresa para acessá-la.')).toBeInTheDocument();
    expect(screen.queryByTestId('filho')).toBeNull();
    expect(filhoMontou).not.toHaveBeenCalled(); // a página bloqueada nunca monta, logo não busca nada
    expect(avisoMontou).not.toHaveBeenCalled(); // nem o /api/subscriptions/me
    expect(screen.getByRole('status')).toHaveTextContent(/Sair do modo empresa/);
    expect(screen.getByRole('link', { name: /Voltar ao painel/ })).toHaveAttribute('href', '/dashboard-v2');
  });
  it('bloqueia também /empresa/esocial', () => {
    atuar();
    pathname = '/empresa/esocial';
    render(<EmpresaShell>{filho}</EmpresaShell>);
    expect(screen.queryByTestId('filho')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
