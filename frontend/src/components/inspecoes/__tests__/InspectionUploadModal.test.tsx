import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InspectionUploadModal } from '../InspectionUploadModal';

const inspections = [
  { id: 'insp-1', visited_at: '2026-09-15', status: 'concluida' as const },
  { id: 'insp-2', visited_at: '2026-09-22', status: 'rascunho' as const },
];

function response(body: unknown, status = 200, headers = new Headers()): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('InspectionUploadModal (Etapa 1 — Relatório de Visita Técnica)', () => {
  beforeEach(() => {
    localStorage.setItem('montese_token', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('exige escolher uma inspeção antes de habilitar o botão Enviar', () => {
    render(
      <InspectionUploadModal
        open
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        inspections={inspections}
      />,
    );

    const submit = screen.getByRole('button', { name: 'Enviar' });
    expect(submit).toBeDisabled();
  });

  it('envia POST /documents com category=relatorio_visita e inspection_id selecionados', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ id: 'doc-1', inspection_id: 'insp-1' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    const onUploaded = vi.fn();

    render(
      <InspectionUploadModal
        open
        onClose={onClose}
        onUploaded={onUploaded}
        inspections={inspections}
        defaultInspectionId="insp-1"
      />,
    );

    // Cria um arquivo PDF fake (o FileInput só chama o onChange com
    // o File; o conteúdo é irrelevante porque o backend é mockado).
    const file = new File(['%PDF-1.4 fake'], 'meu-relatorio.pdf', { type: 'application/pdf' });
    // O FileInput usa um <input type="file"> escondido; simula a
    // seleção via mudança de input.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput);

    // Envia o form.
    const submit = await screen.findByRole('button', { name: 'Enviar' });
    await waitFor(() => expect(submit).not.toBeDisabled());

    fireEvent.click(submit);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/documents',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // Confirma a forma do FormData enviado.
    const call = fetchMock.mock.calls[0];
    const formData = call[1].body as FormData;
    expect(formData.get('category')).toBe('relatorio_visita');
    expect(formData.get('inspection_id')).toBe('insp-1');
    expect(formData.get('title')).toBe('meu-relatorio');
    expect((formData.get('file') as File).name).toBe('meu-relatorio.pdf');

    // Após sucesso, o modal fecha e o callback é disparado.
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('doc-1'));
    expect(onClose).toHaveBeenCalled();
  });

  it('mostra mensagem de erro do backend quando o upload falha (400)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ message: 'Inspeção inválida para esta empresa' }, 400));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <InspectionUploadModal
        open
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        inspections={inspections}
        defaultInspectionId="insp-1"
      />,
    );

    const file = new File(['%PDF-1.4 fake'], 'x.pdf', { type: 'application/pdf' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fireEvent.change(fileInput);

    fireEvent.click(await screen.findByRole('button', { name: 'Enviar' }));

    expect(await screen.findByText('Inspeção inválida para esta empresa')).toBeTruthy();
  });

  it('não renderiza nada quando open=false', () => {
    const { container } = render(
      <InspectionUploadModal
        open={false}
        onClose={vi.fn()}
        onUploaded={vi.fn()}
        inspections={inspections}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
