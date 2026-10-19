import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useParams: () => ({ tenantId: 'ten-5' }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/DocumentsPanel', () => ({ DocumentsPanel: () => <div data-testid="docs" /> }));
vi.mock('@/components/epi/EpiResumoCard', () => ({ EpiResumoCard: ({ tenantId }: { tenantId: string }) => <div data-testid="resumo">{tenantId}</div> }));

import Page from '../[tenantId]/page';

const fetchMock = vi.fn();
beforeEach(() => {
  localStorage.setItem('montese_token', 'x');
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('página da empresa do técnico', () => {
  it('mostra o resumo de EPI da empresa da URL no lugar do painel antigo e não consulta mais /api/epis diretamente', async () => {
    render(<Page />);
    expect(await screen.findByTestId('resumo')).toHaveTextContent('ten-5');
    expect(screen.getByRole('heading', { name: 'EPI' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/epis'))).toBe(false);
  });
});
