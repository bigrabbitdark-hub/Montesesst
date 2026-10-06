import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Router estável (como o real do Next): a página tem `[router]` nas deps do efeito de carga,
// e um objeto novo a cada render causaria loop infinito de fetch + setState.
const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

import AdminAuditoriaPage from '../auditoria/page';

const LINHA = {
  id: '1',
  occurred_at: '2026-10-05T12:00:00Z',
  actor_full_name: 'Ana',
  actor_role: 'admin',
  actor_tenant_name: null,
  action: 'login',
  resource_type: 'users',
  resource_id: null,
  method: 'GET',
  path: '/x',
  status_code: 200,
};

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [LINHA] })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('/admin/auditoria (DS v2)', () => {
  it('mostra o título e a descrição, com o filtro usando os primitivos de campo e botão', async () => {
    render(<AdminAuditoriaPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Auditoria' })).toBeInTheDocument();
    expect(screen.getByText(/Registro de ações realizadas no sistema/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ex: technicians/)).toHaveClass('adm-input');
    const filtrar = screen.getByRole('button', { name: 'Filtrar' });
    expect(filtrar).toHaveClass('adm-btn');
    expect(filtrar).toHaveClass('adm-btn-primary');
  });

  it('a tabela usa .adm-table dentro de um .adm-card', async () => {
    render(<AdminAuditoriaPage />);
    const tabela = await screen.findByRole('table');
    expect(tabela).toHaveClass('adm-table');
    expect(tabela.closest('.adm-card')).not.toBeNull();
  });

  it('o status HTTP vira Badge verde (2xx) mantendo o texto "GET 200" e o title explicativo', async () => {
    render(<AdminAuditoriaPage />);
    const rotulo = await screen.findByTitle('Sucesso');
    expect(rotulo).toHaveTextContent('GET 200');
    const badge = rotulo.closest('span.rounded-full');
    expect(badge).not.toBeNull();
    expect(badge!.className).toContain('text-adm-status-ok-text');
  });

  it('a legenda dos códigos continua visível e usa os tokens de status', async () => {
    render(<AdminAuditoriaPage />);
    const legenda = await screen.findByText('200/201');
    expect(legenda.className).toContain('text-adm-status-ok-text');
    expect(screen.getByText('400/401/403/404').className).toContain('text-adm-status-warn-text');
    expect(screen.getByText('500/502/503').className).toContain('text-adm-status-crit-text');
  });
});
