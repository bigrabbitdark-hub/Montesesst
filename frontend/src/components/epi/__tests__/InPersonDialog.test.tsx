import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@/lib/auth', () => ({ getToken: () => 'tok' }));

import { InPersonDialog } from '../InPersonDialog';

const fetchMock = vi.fn();
const res = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const ok = { in_person_id: 'p1', registered_at: '2026-10-18T12:00:00Z', deliveries: [] };

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(<InPersonDialog open deliveryIds={['d1', 'd2']} onClose={onClose} onDone={onDone} />);
  return { onClose, onDone };
}
const fill = (w: string, r: string) => {
  fireEvent.change(screen.getByLabelText('Nome da testemunha'), { target: { value: w } });
  fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: r } });
};
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Registrar assinatura presencial' }));

describe('InPersonDialog', () => {
  it('fechado não renderiza', () => {
    render(<InPersonDialog open={false} deliveryIds={['d1']} onClose={() => {}} onDone={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('envia POST /epi-signatures/in-person com entregas, testemunha e motivo aparados; sucesso chama onDone e fecha', async () => {
    fetchMock.mockResolvedValue(res(ok, 201));
    const { onClose, onDone } = setup();
    fill('  Maria Souza  ', '  Funcionário sem celular  ');
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(ok));
    expect(onClose).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/epi-signatures/in-person');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ delivery_ids: ['d1', 'd2'], witness_name: 'Maria Souza', reason: 'Funcionário sem celular' });
  });

  it('rejeita valores só com espaços e abaixo/acima dos limites sem chamar o servidor', () => {
    setup();
    fill('     ', 'motivo válido');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome da testemunha');
    fill('Ana', '      ');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Explique o motivo');
    fill('An', 'motivo válido');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome da testemunha');
    fill('a'.repeat(121), 'motivo válido');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome da testemunha');
    fill('Ana', 'abcd');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Explique o motivo');
    fill('Ana', 'a'.repeat(301));
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Explique o motivo');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('conta por pontos de código Unicode: 3 emojis (6 unidades UTF-16) valem 3; 2 emojis não bastam', async () => {
    fetchMock.mockResolvedValue(res(ok, 201));
    const { onDone } = setup();
    fill('😀😀', 'motivo válido');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome da testemunha');
    expect(fetchMock).not.toHaveBeenCalled();
    fill('😀😀😀', '😀😀😀😀😀');
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('120 pontos de código (240 unidades) é aceito e 121 não', async () => {
    fetchMock.mockResolvedValue(res(ok, 201));
    const { onDone } = setup();
    fill('😀'.repeat(121), 'motivo válido');
    submit();
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome da testemunha');
    fill('😀'.repeat(120), 'motivo válido');
    submit();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it.each([
    [409, 'O termo de recebimento ainda não foi aprovado para uso', /fica indisponível até a aprovação/],
    [409, 'Há entregas que não aguardam assinatura', /já foram tratadas/],
    [400, 'Informe o nome da testemunha e o motivo', /Verifique os dados informados/],
    [404, 'Entrega não encontrada', /Entrega não encontrada/],
  ])('erro %i "%s" mostra mensagem fechada e mantém o diálogo aberto', async (status, serverMessage, expected) => {
    fetchMock.mockResolvedValue(res({ message: serverMessage }, status));
    const { onClose, onDone } = setup();
    fill('Maria Souza', 'Funcionário sem celular');
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(expected);
    expect(alert.textContent).not.toBe(serverMessage);
    expect(onClose).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('duplo envio chama o servidor uma vez', async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    setup();
    fill('Maria Souza', 'Funcionário sem celular');
    submit();
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Registrando...' })).toHaveAttribute('aria-disabled', 'true');
    await act(async () => { resolve(res(ok, 201)); });
  });

  it('acessibilidade: role=dialog, foco inicial na testemunha, Esc fecha e devolve o foco, campos rotulados', () => {
    function H() {
      const [open, setOpen] = useState(false);
      return (<><button onClick={() => setOpen(true)}>Abrir</button><InPersonDialog open={open} deliveryIds={['d1']} onClose={() => setOpen(false)} onDone={() => {}} /></>);
    }
    render(<H />);
    const opener = screen.getByText('Abrir');
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Registrar assinatura presencial' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Nome da testemunha')).toHaveFocus();
    expect(screen.getByLabelText('Motivo')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Nome da testemunha'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});
