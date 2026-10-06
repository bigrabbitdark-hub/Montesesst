import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Router estável (como o real do Next): a página tem `[router]` nas deps do efeito de carga,
// e um objeto novo a cada render causaria loop infinito de fetch + setState.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminEmpresasPage from '../empresas/page';

const EMPRESA = {
  id: 't1',
  name: 'Acme Ltda',
  cnpj: '00.000.000/0001-00',
  plan: 'Pro',
  status: 'ativo',
  technicians: [{ id: 'x', name: 'Ana' }],
  partners: [],
};

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [EMPRESA] })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/empresas (DS v2)', () => {
  it('mostra o título, a tabela com o primitivo .adm-table dentro de um .adm-card e o link de detalhes', async () => {
    render(<AdminEmpresasPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Empresas' })).toBeInTheDocument();
    const tabela = screen.getByRole('table');
    expect(tabela).toHaveClass('adm-table');
    expect(tabela.closest('.adm-card')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Ver detalhes' })).toHaveAttribute('href', '/admin/empresas/t1');
    expect(screen.getByRole('link', { name: 'Ver detalhes' })).toHaveClass('adm-link');
  });

  it('o status aparece num Badge com o texto original, e os demais dados continuam na tabela', async () => {
    render(<AdminEmpresasPage />);
    const status = await screen.findByText('ativo');
    expect(status).toHaveClass('rounded-full');
    expect(screen.getByText('Acme Ltda')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('00.000.000/0001-00')).toBeInTheDocument();
  });
});
