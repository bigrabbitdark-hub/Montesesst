import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import NovaGestaoPage from '../nova-gestao/page';
import CipaDashboardPage from '../page';
import ReunioesPage from '../reunioes/page';

// Ruling 25: criar a gestão da CIPA exige um usuário da empresa como responsável (responsavel_user_id
// precisa ser do tenant); no modo atuação o id é o da sócia => o backend recusaria. A tela fica indisponível.
const AVISO = /Criar uma nova gestão da CIPA exige um usuário da empresa como responsável/;

function atuar() {
  localStorage.setItem('montese_acting', JSON.stringify({ tenantId: 't1', tenantName: 'X', expiresAt: Date.now() + 60000 }));
}
afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); });

describe('CIPA "Nova gestão" no modo atuação', () => {
  it('fora da atuação mostra o formulário', () => {
    localStorage.setItem('montese_token', 'x');
    render(<NovaGestaoPage />);
    expect(screen.queryByText(AVISO)).toBeNull();
    expect(screen.getByLabelText(/Ano/i)).toBeInTheDocument();
  });
  it('atuando mostra o aviso e NÃO mostra o formulário', () => {
    localStorage.setItem('montese_token', 'x');
    atuar();
    render(<NovaGestaoPage />);
    expect(screen.getByRole('status')).toHaveTextContent(AVISO);
    expect(screen.getByRole('status')).toHaveTextContent(/Saia do modo empresa e peça ao RH da empresa, ou crie a gestão pelo painel do RH\./);
    expect(screen.queryByLabelText(/Ano/i)).toBeNull();
    expect(document.querySelector('form')).toBeNull();
  });
  it('Central da CIPA sem gestão: link "Criar calendário da CIPA" só fora da atuação', async () => {
    localStorage.setItem('montese_token', 'x');
    const normal = render(<CipaDashboardPage />);
    expect(await screen.findByRole('link', { name: /Criar calendário da CIPA/ })).toHaveAttribute('href', '/empresa/cipa/nova-gestao');
    normal.unmount();
    atuar();
    render(<CipaDashboardPage />);
    await screen.findByText(/Nenhuma gestão da CIPA cadastrada/);
    expect(screen.queryByRole('link', { name: /Criar calendário/ })).toBeNull();
    expect(screen.getByText(AVISO)).toBeInTheDocument();
    expect(document.querySelector('a[href="/empresa/cipa/nova-gestao"]')).toBeNull();
  });
  it('Reuniões sem gestão: link "Criar calendário" só fora da atuação', async () => {
    localStorage.setItem('montese_token', 'x');
    const normal = render(<ReunioesPage />);
    expect(await screen.findByRole('link', { name: /Criar calendário/ })).toHaveAttribute('href', '/empresa/cipa/nova-gestao');
    normal.unmount();
    atuar();
    render(<ReunioesPage />);
    await screen.findByText(/Nenhuma gestão da CIPA ainda/);
    await waitFor(() => expect(document.querySelector('a[href="/empresa/cipa/nova-gestao"]')).toBeNull());
    expect(screen.getByText(AVISO)).toBeInTheDocument();
  });
});
