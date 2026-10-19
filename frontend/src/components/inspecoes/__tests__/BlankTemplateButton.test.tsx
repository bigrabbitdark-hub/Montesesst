import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BlankTemplateButton } from '../BlankTemplateButton';
import { InspectionUploadModal } from '../InspectionUploadModal';

describe('BlankTemplateButton', () => {
  beforeEach(() => {
    localStorage.setItem('montese_token', 'test-token');
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('baixa o modelo com o token na rota /api/inspections/modelo-pdf', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF-']) });
    vi.stubGlobal('fetch', fetchMock);
    render(<BlankTemplateButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar modelo (PDF)' }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/inspections/modelo-pdf', {
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  it('mostra erro quando o download falha', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    render(<BlankTemplateButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar modelo (PDF)' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('InspectionUploadModal sem visitas', () => {
  it('explica que a visita é registrada pelo técnico e desabilita o seletor', () => {
    render(<InspectionUploadModal open onClose={() => {}} onUploaded={() => {}} inspections={[]} />);
    expect(screen.getByText(/Nenhuma visita registrada ainda/)).toBeTruthy();
    expect((screen.getByLabelText('Visita técnica') as HTMLSelectElement).disabled).toBe(true);
  });
});
