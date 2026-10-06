import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../onboarding/MatrizForm', () => ({ MatrizForm: () => <div data-testid="painel" /> }));
vi.mock('../onboarding/FiliaisForm', () => ({ FiliaisForm: () => <div /> }));
vi.mock('../onboarding/FuncionariosForm', () => ({ FuncionariosForm: () => <div /> }));
vi.mock('@/components/DocumentsPanel', () => ({ DocumentsPanel: () => <div /> }));

import Onboarding from '../onboarding/page';

beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});

afterEach(() => vi.unstubAllGlobals());

describe('onboarding (skin)', () => {
  it('mostra o título e o formulário dentro de um único escopo .skin-dash', async () => {
    const { container } = render(<Onboarding />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Complete o cadastro da sua empresa' })).toBeInTheDocument(),
    );
    expect(screen.getByTestId('painel').closest('.skin-dash')).not.toBeNull();
    expect(container.querySelectorAll('.skin-dash')).toHaveLength(1);
  });
});
