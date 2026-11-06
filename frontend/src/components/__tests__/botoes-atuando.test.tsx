import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/dashboard-v2' }));
vi.mock('next/image', () => ({ default: (p: { alt: string }) => <span role="img" aria-label={p.alt} /> }));

import { DocumentsPanel } from '../DocumentsPanel';
import { ApoioTecnicoCard } from '../dashboard/ApoioTecnicoCard';
import { AuditoriaCard } from '../dashboard/AuditoriaCard';
import { PendenciasCard } from '../dashboard/PendenciasCard';
import { VencimentosCard } from '../dashboard/VencimentosCard';
import { ProximosEventosCard } from '../dashboard/ProximosEventosCard';
import Funcionarios from '@/app/empresa/funcionarios/page';

function resp(body: unknown): Response {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body } as Response;
}
function atuar() {
  localStorage.setItem('montese_acting', JSON.stringify({ tenantId: 't1', tenantName: 'X', expiresAt: Date.now() + 60000 }));
}
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('botões que chamam rotas proibidas no modo atuação', () => {
  it('DocumentsPanel: "Upload em lote" (classify-batch) some só no modo atuação', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) =>
      resp(String(u).includes('/compliance') ? { score: null, pendencias: [], avisos: [] } : [])));
    localStorage.setItem('montese_token', 't');
    const normal = render(<DocumentsPanel />);
    expect(await screen.findByRole('heading', { name: 'Upload em lote' })).toBeInTheDocument();
    normal.unmount();
    atuar();
    render(<DocumentsPanel />);
    await screen.findByRole('heading', { name: 'Enviar documento' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Upload em lote' })).toBeNull());
  });

  it('ApoioTecnicoCard (link para agendamentos)', async () => {
    const normal = render(<ApoioTecnicoCard />);
    expect(screen.getByRole('link', { name: /Agendar reunião/ })).toHaveAttribute('href', '/empresa/agendamentos');
    normal.unmount();
    atuar();
    render(<ApoioTecnicoCard />);
    await waitFor(() => expect(screen.queryByRole('link', { name: /Agendar reunião/ })).toBeNull());
  });

  it('AuditoriaCard (link para pente-fino)', async () => {
    const dado = { risco_sem_exame: 0, exame_sem_risco: 0 };
    const normal = render(<AuditoriaCard pgrPcmso={dado} />);
    expect(screen.getByRole('link', { name: /Abrir Auditoria Montese/ })).toBeInTheDocument();
    normal.unmount();
    atuar();
    render(<AuditoriaCard pgrPcmso={dado} />);
    await waitFor(() => expect(screen.queryByRole('link', { name: /Abrir Auditoria Montese/ })).toBeNull());
  });

  it('Funcionários: "Anexar documento" (extração por IA) some só no modo atuação', async () => {
    localStorage.setItem('montese_token', 'x');
    vi.stubGlobal('fetch', vi.fn(async (u: string) => resp(String(u).includes('/table') ? { items: [], total: 0 } : String(u).includes('extractions') ? { items: [] } : [])));
    const normal = render(<Funcionarios />);
    expect(await screen.findByRole('button', { name: /Anexar documento/ })).toBeInTheDocument();
    normal.unmount();
    atuar();
    render(<Funcionarios />);
    await screen.findByRole('heading', { name: 'Funcionários' });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Anexar documento/ })).toBeNull());
  });

  const ITEM = { id: 'a', titulo: 'Revisar auditoria', detalhe: 'x', rotulo: 'Alta', tone: 'high' as const, href: '/empresa/pente-fino' };
  const OK = { ...ITEM, id: 'b', titulo: 'Ver funcionários', href: '/empresa/funcionarios' };

  it.each([
    ['Pendências', (i: typeof ITEM[]) => <PendenciasCard itens={i} resumo="r" />],
    ['Próximos eventos', (i: typeof ITEM[]) => <ProximosEventosCard itens={i} />],
  ])('%s: link para área bloqueada vira texto no modo atuação; os demais seguem links', async (_n, card) => {
    const normal = render(card([ITEM, OK]));
    expect(screen.getByRole('link', { name: /Revisar auditoria/ })).toBeInTheDocument();
    normal.unmount();
    atuar();
    render(card([ITEM, OK]));
    await waitFor(() => expect(screen.queryByRole('link', { name: /Revisar auditoria/ })).toBeNull());
    expect(screen.getByText('Revisar auditoria')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver funcionários/ })).toBeInTheDocument();
  });

  it('Vencimentos: idem', async () => {
    const itens = [{ id: 'v', nome: 'Doc X', validade: '2026-12-01', href: '/empresa/pente-fino' }];
    atuar();
    render(<VencimentosCard itens={itens} hoje="2026-11-01" />);
    expect(screen.getByText('Doc X')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Doc X/ })).toBeNull();
  });
});
