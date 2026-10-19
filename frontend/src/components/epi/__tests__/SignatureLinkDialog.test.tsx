import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@/lib/auth', () => ({ getToken: () => 'tok' }));
const qr = vi.hoisted(() => ({ toDataURL: vi.fn() }));
vi.mock('qrcode', () => ({ default: qr }));

import { SignatureLinkDialog } from '../SignatureLinkDialog';

const URL_OK = 'https://app.montese.test/assinar#token=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';
const created = {
  id: 'r1', url: URL_OK, qr_payload: URL_OK, code: '123456', expires_at: '2026-10-19T15:30:00.000Z', delivery_ids: ['d1'],
};
const fetchMock = vi.fn();
const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const posts = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
const bodyOf = (c: unknown[]) => JSON.parse((c[1] as RequestInit).body as string);

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <SignatureLinkDialog open={open} employeeId="emp1" deliveryIds={['d1']} onClose={() => { onClose(); setOpen(false); }} />
    </>
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  qr.toDataURL.mockReset();
  qr.toDataURL.mockResolvedValue('data:image/png;base64,QRDATA');
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function generate() {
  fireEvent.click(screen.getByRole('button', { name: 'Gerar link de assinatura' }));
  await screen.findByTestId('signature-code');
}

describe('SignatureLinkDialog', () => {
  it('cria o link (POST com idempotency_key nova), mostra QR, link e o código de 6 dígitos UMA vez com aviso explícito', async () => {
    fetchMock.mockResolvedValue(res(created, 201));
    render(<SignatureLinkDialog open employeeId="emp1" deliveryIds={['d1']} onClose={() => {}} />);
    expect(posts()).toHaveLength(0); // abrir não cria nada
    await generate();
    expect(posts()).toHaveLength(1);
    const [url, init] = posts()[0] as [string, RequestInit];
    expect(url).toBe('/api/epi-signatures/requests');
    const body = bodyOf(posts()[0]);
    expect(body.employee_id).toBe('emp1');
    expect(body.delivery_ids).toEqual(['d1']);
    expect(String(body.idempotency_key).length).toBeGreaterThanOrEqual(8);
    expect(init.method).toBe('POST');
    expect(screen.getByTestId('signature-code')).toHaveTextContent('123 456');
    expect(screen.getByTestId('signature-link')).toHaveTextContent(URL_OK);
    expect(screen.getByText(/este código não poderá ser exibido de novo/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Se perder, gere outro link: o anterior é invalidado.');
    expect(screen.getByRole('alert').textContent).not.toMatch(/revogue/i);
    await waitFor(() => expect(screen.getByAltText('QR code do link de assinatura')).toHaveAttribute('src', 'data:image/png;base64,QRDATA'));
  });

  it('cada abertura do diálogo usa uma idempotency_key nova', async () => {
    fetchMock.mockResolvedValue(res(created, 201));
    const { rerender } = render(<SignatureLinkDialog open employeeId="emp1" deliveryIds={['d1']} onClose={() => {}} />);
    await generate();
    rerender(<SignatureLinkDialog open={false} employeeId="emp1" deliveryIds={['d1']} onClose={() => {}} />);
    rerender(<SignatureLinkDialog open employeeId="emp1" deliveryIds={['d1']} onClose={() => {}} />);
    await generate();
    expect(bodyOf(posts()[0]).idempotency_key).not.toBe(bodyOf(posts()[1]).idempotency_key);
  });

  it('o QR codifica exatamente o link devolvido e é gerado no navegador (nenhuma requisição a terceiros)', async () => {
    fetchMock.mockResolvedValue(res(created, 201));
    render(<SignatureLinkDialog open employeeId="emp1" onClose={() => {}} />);
    await generate();
    await waitFor(() => expect(qr.toDataURL).toHaveBeenCalledTimes(1));
    expect(qr.toDataURL).toHaveBeenCalledWith(URL_OK, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
    // sem delivery_ids no corpo quando não informado
    expect(bodyOf(posts()[0])).not.toHaveProperty('delivery_ids');
    // a única requisição de rede é ao próprio backend
    expect(fetchMock.mock.calls.every((c) => String(c[0]).startsWith('/api/'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('se o QR falhar, o link continua disponível e o erro é explicado', async () => {
    qr.toDataURL.mockRejectedValue(new Error('x'));
    fetchMock.mockResolvedValue(res(created, 201));
    render(<SignatureLinkDialog open employeeId="emp1" onClose={() => {}} />);
    await generate();
    expect(await screen.findByText(/Não foi possível desenhar o QR code/)).toBeInTheDocument();
    expect(screen.getByTestId('signature-link')).toHaveTextContent(URL_OK);
  });

  it('copiar link e copiar código usam navigator.clipboard', async () => {
    fetchMock.mockResolvedValue(res(created, 201));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<SignatureLinkDialog open employeeId="emp1" onClose={() => {}} />);
    await generate();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_OK));
    expect(await screen.findByText('Link copiado.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar código' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('123456'));
    expect(await screen.findByText('Código copiado.')).toBeInTheDocument();
  });

  it('sem clipboard (ou se ele recusar), seleciona o texto para cópia manual', async () => {
    fetchMock.mockResolvedValue(res(created, 201));
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    render(<SignatureLinkDialog open employeeId="emp1" onClose={() => {}} />);
    await generate();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar código' }));
    expect(await screen.findByText(/copie manualmente/i)).toBeInTheDocument();
    expect(window.getSelection()?.toString()).toBe('123 456');
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link' }));
    await waitFor(() => expect(window.getSelection()?.toString()).toBe(URL_OK));
  });

  it('ao fechar ou ao desmontar, link e código somem do DOM; reabrir NÃO mostra o código antigo', async () => {
    fetchMock.mockResolvedValue(res(created, 201));
    render(<Harness />);
    fireEvent.click(screen.getByText('Abrir'));
    await generate();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByTestId('signature-code')).toBeNull();
    expect(document.body.textContent).not.toContain('123 456');
    expect(document.body.textContent).not.toContain('ABCDEFGHIJKLMNOP');
    fireEvent.click(screen.getByText('Abrir'));
    expect(screen.queryByTestId('signature-code')).toBeNull();
    expect(screen.queryByTestId('signature-link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Gerar link de assinatura' })).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('desmontar com o diálogo aberto remove tudo e uma resposta em voo não faz nada', async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { unmount } = render(<SignatureLinkDialog open employeeId="emp1" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de assinatura' }));
    unmount();
    await act(async () => { resolve(res(created, 201)); });
    expect(document.body.textContent).not.toContain('123 456');
    expect(qr.toDataURL).not.toHaveBeenCalled();
  });

  it('nunca grava link/código em storage, cookie, histórico, título ou console, nem em campos de formulário', async () => {
    fetchMock.mockResolvedValue(res(created, 201));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const title = document.title;
    const cookie = document.cookie;
    render(<SignatureLinkDialog open employeeId="emp1" deliveryIds={['d1']} onClose={() => {}} />);
    await generate();
    await waitFor(() => expect(screen.getByAltText('QR code do link de assinatura')).toBeInTheDocument());
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe(cookie);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(document.title).toBe(title);
    for (const l of logs) expect(l).not.toHaveBeenCalled();
    expect(document.querySelectorAll('input, textarea')).toHaveLength(0);
    expect(window.location.href).not.toContain('token');
  });

  it('409 por termo não aprovado mostra a mensagem explicativa e nenhum link', async () => {
    fetchMock.mockResolvedValue(res({ message: 'O termo de recebimento ainda não foi aprovado para uso' }, 409));
    render(<SignatureLinkDialog open employeeId="emp1" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de assinatura' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('A assinatura eletrônica fica indisponível até a aprovação.');
    expect(alert).not.toHaveTextContent('para uso');
    expect(screen.queryByTestId('signature-link')).toBeNull();
    expect(screen.queryByTestId('signature-code')).toBeNull();
    expect(qr.toDataURL).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'Link já emitido com esta chave; revogue e gere outro', /Gerar outro invalida o anterior/],
    [409, 'Não há entregas aguardando assinatura', /Não há entregas aguardando assinatura para este funcionário\./],
    [409, 'Há entregas que não aguardam assinatura', /já foram tratadas/],
    [409, 'As entregas mudaram de situação; tente novamente', /A situação das entregas mudou/],
    [404, 'Entrega não encontrada', /Entrega não encontrada\. Atualize/],
    [503, 'Há outra operação de assinatura em andamento para este funcionário; tente novamente', /emissão de assinatura em andamento.*tente de novo/],
  ])('erro %i "%s" vira mensagem de lista fechada (nunca o texto do servidor)', async (status, serverMessage, expected) => {
    fetchMock.mockResolvedValue(res({ message: serverMessage }, status));
    render(<SignatureLinkDialog open employeeId="emp1" onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de assinatura' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(expected);
    expect(alert.textContent).not.toBe(serverMessage);
  });

  it('falha de rede: a nova tentativa reaproveita a MESMA idempotency_key', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(res(created, 201));
    render(<SignatureLinkDialog open employeeId="emp1" deliveryIds={['d1']} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de assinatura' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conectar ao servidor');
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de assinatura' }));
    await screen.findByTestId('signature-code');
    const calls = fetchMock.mock.calls;
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[0]).idempotency_key).toBe(bodyOf(calls[1]).idempotency_key);
  });

  it('409 "Link já emitido" (resposta perdida): a próxima tentativa usa chave NOVA e nada é retido', async () => {
    fetchMock
      .mockResolvedValueOnce(res({ message: 'Link já emitido com esta chave; revogue e gere outro' }, 409))
      .mockResolvedValueOnce(res(created, 201));
    render(<SignatureLinkDialog open employeeId="emp1" deliveryIds={['d1']} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de assinatura' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Gerar outro invalida o anterior.');
    expect(screen.queryByTestId('signature-code')).toBeNull();
    expect(screen.queryByTestId('signature-link')).toBeNull();
    expect(document.body.textContent).not.toContain('123 456');
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de assinatura' }));
    await screen.findByTestId('signature-code');
    expect(bodyOf(fetchMock.mock.calls[1]).idempotency_key).not.toBe(bodyOf(fetchMock.mock.calls[0]).idempotency_key);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('avisa antes de gerar que um novo link invalida o link ativo', () => {
    render(<SignatureLinkDialog open employeeId="emp1" onClose={() => {}} />);
    expect(screen.getByText(/gerar um novo link invalida o link ativo/i)).toBeInTheDocument();
  });

  it('se o formulário mudar (outro funcionário), a chave muda', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    const { rerender } = render(<SignatureLinkDialog open employeeId="emp1" deliveryIds={['d1']} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de assinatura' }));
    await screen.findByRole('alert');
    rerender(<SignatureLinkDialog open employeeId="emp2" deliveryIds={['d1']} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de assinatura' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(fetchMock.mock.calls[0]).idempotency_key).not.toBe(bodyOf(fetchMock.mock.calls[1]).idempotency_key);
  });

  it('duplo clique envia uma vez só', async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<SignatureLinkDialog open employeeId="emp1" onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Gerar link de assinatura' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Gerando...' })).toHaveAttribute('aria-disabled', 'true');
    await act(async () => { resolve(res(created, 201)); });
  });

  it('mostra a validade (24 h, horário de Brasília) e como o funcionário usa', async () => {
    fetchMock.mockResolvedValue(res(created, 201));
    render(<SignatureLinkDialog open employeeId="emp1" onClose={() => {}} />);
    expect(screen.getByText(/O link vale por 24 horas\./)).toBeInTheDocument();
    await generate();
    expect(screen.getByText(/expira em 19\/10\/2026 12:30 \(horário de Brasília\)/)).toBeInTheDocument();
    expect(screen.getByText(/lê o QR code com a câmera do celular/)).toBeInTheDocument();
    expect(screen.getByText(/informe o código a ele/)).toBeInTheDocument();
  });

  it('acessibilidade: role=dialog, foco inicial, Esc fecha, foco volta ao acionador, aria-live para o resultado', async () => {
    fetchMock.mockResolvedValue(res(created, 201));
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByText('Abrir');
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Link de assinatura do funcionário' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    await generate();
    // o foco vai para o resultado, e o resultado é anunciado em região aria-live sem o código
    const live = document.querySelector('[aria-live="polite"].sr-only')!;
    expect(live).toHaveTextContent('Link de assinatura gerado.');
    expect(live.textContent).not.toContain('123');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(dialog);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('não fecha com Esc enquanto a criação está em andamento', async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const onClose = vi.fn();
    render(<SignatureLinkDialog open employeeId="emp1" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar link de assinatura' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { resolve(res(created, 201)); });
  });
});
