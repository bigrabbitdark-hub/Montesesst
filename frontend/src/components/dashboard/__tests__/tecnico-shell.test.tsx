import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const logout = vi.fn();
let pathname = '/tecnico/empresas/abc/inspecoes/1';
let user: { id: string; role: string; tenantId: string | null } | null = null;

vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));
vi.mock('@/lib/auth', () => ({ logout: () => logout(), getToken: () => null, getUser: () => user }));
vi.mock('@/components/SubscriptionNotice', () => ({ SubscriptionNotice: () => <div data-testid="aviso-assinatura" /> }));

import { DashboardSidebar } from '../DashboardSidebar';
import { DashboardHeader } from '../DashboardHeader';
import { TECNICO_MENU_ITEMS } from '@/lib/dashboard/menu-tecnico';
import { TecnicoShell } from '../TecnicoShell';

beforeEach(() => {
  pathname = '/tecnico/empresas/abc/inspecoes/1';
  logout.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('DashboardSidebar parametrizada', () => {
  it('com o menu do técnico, lista só rotas /tecnico e marca "Suas empresas" em subrota', () => {
    render(<DashboardSidebar items={TECNICO_MENU_ITEMS} extraItems={[]} />);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(TECNICO_MENU_ITEMS.map((i) => i.href));
    const atual = links.filter((a) => a.getAttribute('aria-current') === 'page');
    expect(atual).toHaveLength(1);
    expect(atual[0]).toHaveTextContent('Suas empresas');
  });
  it('sem itens extras, não mostra o rótulo "Mais ferramentas"', () => {
    render(<DashboardSidebar items={TECNICO_MENU_ITEMS} extraItems={[]} />);
    expect(screen.queryByText('Mais ferramentas')).toBeNull();
  });
  it('sem props continua sendo o menu da empresa (default)', () => {
    pathname = '/empresa/documentos';
    render(<DashboardSidebar />);
    expect(screen.getByText('Mais ferramentas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Documentos/ })).toHaveAttribute('href', '/empresa/documentos');
  });
});

describe('DashboardHeader iaHref', () => {
  it('por padrão aponta o botão IA SST para o assistente da empresa', () => {
    render(<DashboardHeader nomeUsuario="Ana" papel="Empresa" />);
    expect(screen.getByRole('link', { name: /IA SST/ })).toHaveAttribute('href', '/empresa/assistente');
  });
  it('com iaHref=null não mostra o botão IA SST', () => {
    render(<DashboardHeader nomeUsuario="Técnico" papel="Montese SST" iaHref={null} />);
    expect(screen.queryByRole('link', { name: /IA SST/ })).toBeNull();
  });
});

describe('DashboardHeader busca e notificações', () => {
  it('por padrão mostra a busca e o botão Notificações', () => {
    render(<DashboardHeader nomeUsuario="Ana" papel="Empresa" />);
    expect(screen.getByRole('searchbox', { name: /Pesquisar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument();
  });
  it('com comBuscaENotificacoes=false não mostra nenhum dos dois', () => {
    render(<DashboardHeader nomeUsuario="Ana" papel="Empresa" comBuscaENotificacoes={false} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Notificações' })).toBeNull();
  });
});

describe('TecnicoShell', () => {
  beforeEach(() => {
    user = { id: 'u1', role: 'tecnico', tenantId: null };
  });

  it('mostra o miolo, o aviso de assinatura e a sidebar do técnico', () => {
    render(<TecnicoShell><p>conteúdo</p></TecnicoShell>);
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
    expect(screen.getByTestId('aviso-assinatura')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Suas empresas/ })).toHaveAttribute('href', '/tecnico/empresas');
  });

  it('identifica o papel Técnico e Parceiro no header', () => {
    const { unmount } = render(<TecnicoShell>x</TecnicoShell>);
    expect(within(screen.getByRole('banner')).getAllByText('Técnico').length).toBeGreaterThan(0);
    unmount();
    user = { id: 'u2', role: 'parceiro', tenantId: null };
    render(<TecnicoShell>x</TecnicoShell>);
    expect(within(screen.getByRole('banner')).getAllByText('Parceiro').length).toBeGreaterThan(0);
  });

  it('não tem botão IA SST nem nenhum link para /empresa/*', () => {
    render(<TecnicoShell>x</TecnicoShell>);
    expect(screen.queryByRole('link', { name: /IA SST/ })).toBeNull();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.startsWith('/empresa/'))).toBe(false);
  });

  it('não tem busca nem botão Notificações', () => {
    render(<TecnicoShell>x</TecnicoShell>);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Notificações' })).toBeNull();
  });

  it('o botão Sair chama logout', () => {
    render(<TecnicoShell>x</TecnicoShell>);
    fireEvent.click(screen.getByRole('button', { name: /Sair/ }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('o botão de menu abre a gaveta (aria-expanded)', () => {
    render(<TecnicoShell>x</TecnicoShell>);
    const botao = screen.getByRole('button', { name: 'Abrir menu' });
    expect(botao).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(botao);
    expect(botao).toHaveAttribute('aria-expanded', 'true');
  });
});
