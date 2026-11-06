import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useParams: () => ({ id: 'm1' }) }));

import ReuniaoPage from '../reunioes/[id]/page';

function resp(body: unknown, status = 200): Response {
  return { ok: status < 400, status, headers: new Headers(), json: async () => body } as Response;
}
const MEETING = {
  id: 'm1', tenant_id: 't', committee_id: 'c', company_unit_id: 'u', tipo: 'ordinaria', numero: 1, titulo: 'Reunião', data: '2026-11-01',
  hora: null, local: null, modalidade: null, motivo: null, responsavel_user_id: null, status: 'realizada', status_ata: 'rascunho',
  chk_pauta_definida: false, chk_participantes_convocados: false, chk_local_confirmado: false, chk_presenca_registrada: false,
  chk_assuntos_discutidos: false, chk_decisoes_registradas: false, chk_ata_criada: false, chk_acoes_distribuidas: false,
  pauta: null, discussoes: null, deliberacoes: null,
};
const DRAFT = { id: 'd', meeting_id: 'm1', status: 'concluido', transcript: 'Texto transcrito', draft_pauta: 'Pauta sugerida', draft_discussoes: null, draft_deliberacoes: null, error_message: null };

function mockFetch(draft: unknown) {
  vi.stubGlobal('fetch', vi.fn(async (u: string) => {
    if (u.endsWith('/ata-ai-draft')) return draft ? resp(draft) : resp({}, 404);
    if (u.endsWith('/m1')) return resp(MEETING);
    return resp([]);
  }));
}
function atuar() {
  localStorage.setItem('montese_acting', JSON.stringify({ tenantId: 't1', tenantName: 'X', expiresAt: Date.now() + 60000 }));
}
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe('ata por áudio no modo atuação', () => {
  it('sem rascunho: input de áudio existe no modo normal e some no modo atuação (seção continua)', async () => {
    localStorage.setItem('montese_token', 'x');
    mockFetch(null);
    const normal = render(<ReuniaoPage />);
    expect(await screen.findByLabelText(/Áudio da reunião/)).toBeInTheDocument();
    normal.unmount();
    atuar();
    mockFetch(null);
    render(<ReuniaoPage />);
    await screen.findByText(/Gerar ata por áudio/);
    await waitFor(() => expect(screen.queryByLabelText(/Áudio da reunião/)).toBeNull());
    expect(screen.getByText(/não está disponível no modo empresa/)).toBeInTheDocument();
  });

  it('com rascunho concluído: some "Enviar outro áudio", sugestões e transcrição continuam', async () => {
    localStorage.setItem('montese_token', 'x');
    mockFetch(DRAFT);
    const normal = render(<ReuniaoPage />);
    expect(await screen.findByRole('button', { name: /Enviar outro áudio/ })).toBeInTheDocument();
    normal.unmount();
    atuar();
    mockFetch(DRAFT);
    render(<ReuniaoPage />);
    await screen.findByText('Pauta sugerida');
    expect(screen.queryByRole('button', { name: /Enviar outro áudio/ })).toBeNull();
    expect(screen.getByRole('button', { name: /transcrição/i })).toBeInTheDocument();
  });
});
