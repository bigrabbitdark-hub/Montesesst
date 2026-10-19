import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import Assinar from '../page';

class FakePointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

const TOKEN = 'A'.repeat(43);
const CODE = '123456';
const PNG_B64 = 'AAAA';

const OPEN = {
  employee_name: 'Maria Souza',
  expires_at: '2026-10-20T12:00:00.000Z',
  attempts_left: 5,
  items: [
    { delivery_id: 'd1', date: '2026-10-10', epi_description: 'Capacete de segurança', manufacturer: 'Acme', model: 'C-1', ca_number: '12345', quantity: 1 },
    { delivery_id: 'd2', date: '2026-10-11', epi_description: 'Luva nitrílica', manufacturer: null, model: null, ca_number: '999', quantity: null },
  ],
  term: { version: 'v1', draft: false, title: 'Termo de recebimento de EPI', paragraphs: ['Declaro que recebi os itens acima.', 'Fui orientado sobre o uso.'] },
};

type Reply = { status: number; body: unknown } | 'network';
type Handler = Reply | Promise<Reply> | ((body: { token: string }) => Reply | Promise<Reply>);
let handlers: Record<string, Handler>;
const fetchMock = vi.fn();

function setupFetch() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const route = String(url).split('/').pop() as string;
    const h = handlers[route];
    const r = await (typeof h === 'function' ? h(JSON.parse((init?.body as string) ?? '{}')) : h);
    if (!r || r === 'network') throw new TypeError('network');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response;
  });
}
function calls(route: string) {
  return fetchMock.mock.calls.filter(([u]) => String(u).endsWith(`/public/${route}`));
}
function bodyOf(route: string, n = 0) {
  return JSON.parse((calls(route)[n][1] as RequestInit).body as string);
}

const ctx = { beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), lineWidth: 0, lineCap: '', lineJoin: '', strokeStyle: '' };

beforeEach(() => {
  vi.stubGlobal('PointerEvent', FakePointerEvent);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  handlers = { peek: { status: 200, body: { usable: true, company_name: 'Construtora Alfa' } }, open: { status: 200, body: OPEN } };
  setupFetch();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => `data:image/png;base64,${PNG_B64}`) as unknown as typeof HTMLCanvasElement.prototype.toDataURL;
  window.history.replaceState(null, '', `/assinar#token=${TOKEN}`);
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

async function enterCode(code = CODE) {
  fireEvent.change(await screen.findByLabelText(/código/i), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
}
async function reachReview() {
  render(<Assinar />);
  await enterCode();
  await screen.findByText('Maria Souza');
}
function draw() {
  const c = screen.getByRole('img', { name: 'Área para assinar com o dedo' });
  fireEvent.pointerDown(c, { clientX: 5, clientY: 5, button: 0 });
  fireEvent.pointerMove(c, { clientX: 50, clientY: 20, button: 0 });
  fireEvent.pointerUp(c, { clientX: 50, clientY: 20, button: 0 });
}
const accept = () => fireEvent.click(screen.getByRole('checkbox', { name: /li e aceito o termo/i }));

describe('página /assinar', () => {
  it('lê o token do fragmento, remove o fragmento da URL e nunca o envia na URL da API', async () => {
    render(<Assinar />);
    await screen.findByText(/Construtora Alfa/);
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    await enterCode();
    await screen.findByText('Maria Souza');
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).not.toContain(TOKEN);
      expect(String(url)).not.toContain(CODE);
      expect(String(url)).toMatch(/^\/api\/epi-signatures\/public\/(peek|open)$/);
      expect((init as RequestInit).method).toBe('POST');
      expect((init as RequestInit).cache).toBe('no-store');
      expect((init as RequestInit).referrerPolicy).toBe('no-referrer');
    }
    expect(bodyOf('peek')).toEqual({ token: TOKEN });
    expect(bodyOf('open')).toEqual({ token: TOKEN, code: CODE });
  });

  it('link sem token, inválido ou expirado mostra a mensagem única e não pede código', async () => {
    window.history.replaceState(null, '', '/assinar');
    const first = render(<Assinar />);
    expect(await screen.findByText(/Este link não é válido ou expirou/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/código/i)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    first.unmount();

    window.history.replaceState(null, '', `/assinar#token=${TOKEN}`);
    handlers.peek = { status: 404, body: { message: 'Link inválido ou expirado' } };
    const second = render(<Assinar />);
    expect(await screen.findByText('Este link não é válido ou expirou. Peça um novo link ao responsável.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/código/i)).toBeNull();
    second.unmount();

    handlers.peek = { status: 200, body: { usable: false } };
    render(<Assinar />);
    expect(await screen.findByText(/Este link não é válido ou expirou/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/código/i)).toBeNull();
  });

  it('código errado mostra tentativas restantes; bloqueado mostra orientação', async () => {
    handlers.open = { status: 401, body: { message: 'Código incorreto', attempts_left: 3 } };
    render(<Assinar />);
    await enterCode('000000');
    expect(await screen.findByText('Código incorreto. Restam 3 tentativas.')).toBeInTheDocument();
    expect(screen.queryByText('Maria Souza')).toBeNull();

    handlers.open = { status: 401, body: { message: 'Código incorreto', attempts_left: 1 } };
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText('Código incorreto. Restam 1 tentativa.')).toBeInTheDocument();

    handlers.open = { status: 403, body: { message: 'Link bloqueado por tentativas incorretas' } };
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText('Este link foi bloqueado por tentativas incorretas. Peça um novo link ao responsável.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/código/i)).toBeNull();
  });

  it('não mostra mensagem crua do servidor fora da lista conhecida', async () => {
    handlers.open = { status: 418, body: { message: 'segredo interno do servidor' } };
    render(<Assinar />);
    await enterCode();
    expect(await screen.findByText('Não foi possível concluir agora. Tente novamente.')).toBeInTheDocument();
    expect(screen.queryByText(/segredo interno/)).toBeNull();
  });

  it('só mostra o nome depois do código e a conferência traz itens, termo e aceite', async () => {
    render(<Assinar />);
    await screen.findByLabelText(/código/i);
    expect(screen.queryByText('Maria Souza')).toBeNull();
    await enterCode();
    await screen.findByText('Maria Souza');
    expect(screen.getByText('Capacete de segurança')).toBeInTheDocument();
    expect(screen.getByText(/CA 12345/)).toBeInTheDocument();
    expect(screen.getByText('Luva nitrílica')).toBeInTheDocument();
    expect(screen.getByText('Termo de recebimento de EPI')).toBeInTheDocument();
    expect(screen.getByText('Fui orientado sobre o uso.')).toBeInTheDocument();
    expect(screen.queryByText('RASCUNHO')).toBeNull();
  });

  it('termo em rascunho exibe o selo RASCUNHO e o aviso', async () => {
    handlers.open = { status: 200, body: { ...OPEN, term: { ...OPEN.term, draft: true } } };
    await reachReview();
    expect(screen.getByText('RASCUNHO')).toBeInTheDocument();
    expect(screen.getByText(/ainda não foi aprovado/i)).toBeInTheDocument();
  });

  it('só habilita Assinar com aceite e assinatura desenhada; envia PNG sem o prefixo data URL', async () => {
    handlers.sign = { status: 201, body: { receipt_code: 'ASEPI-ABCD-1234', signed_at: '2026-10-15T15:30:00.000Z', evidence_sha256: 'x' } };
    await reachReview();
    const assinar = screen.getByRole('button', { name: 'Assinar' });
    expect(assinar).toBeDisabled();
    accept();
    expect(assinar).toBeDisabled();
    draw();
    expect(assinar).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(assinar).toBeDisabled();
    draw();
    fireEvent.click(assinar);
    await screen.findByText('ASEPI-ABCD-1234');
    expect(bodyOf('sign')).toEqual({ token: TOKEN, code: CODE, accepted: true, term_version: 'v1', signature_png_base64: PNG_B64 });
  });

  it('mostra o comprovante com o código e hora de Brasília; sem promessa de validade jurídica', async () => {
    handlers.sign = { status: 201, body: { receipt_code: 'ASEPI-ABCD-1234', signed_at: '2026-10-15T15:30:00.000Z' } };
    await reachReview();
    accept();
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Assinar' }));
    expect(await screen.findByText('ASEPI-ABCD-1234')).toBeInTheDocument();
    expect(screen.getByText(/Guarde este código/)).toBeInTheDocument();
    expect(screen.getByText(/15\/10\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/12:30/)).toBeInTheDocument();
    expect(screen.queryByText(/validade jurídica/i)).toBeNull();
  });

  it('erro 502 preserva o desenho e permite tentar de novo', async () => {
    let n = 0;
    handlers.sign = () => (++n === 1 ? { status: 502, body: { message: 'Não foi possível guardar a assinatura; tente novamente' } } : { status: 201, body: { receipt_code: 'ASEPI-OK', signed_at: '2026-10-15T15:30:00.000Z' } });
    await reachReview();
    accept();
    draw();
    const clearRect = ctx.clearRect.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Assinar' }));
    expect(await screen.findByText('Não foi possível concluir agora. Tente novamente.')).toBeInTheDocument();
    expect(ctx.clearRect.mock.calls.length).toBe(clearRect);
    const again = screen.getByRole('button', { name: 'Assinar' });
    expect(again).toBeEnabled();
    fireEvent.click(again);
    await screen.findByText('ASEPI-OK');
    expect(calls('sign')).toHaveLength(2);
  });

  it('erro de rede também mantém o desenho', async () => {
    handlers.sign = 'network';
    await reachReview();
    accept();
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Assinar' }));
    expect(await screen.findByText('Não foi possível concluir agora. Tente novamente.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assinar' })).toBeEnabled();
  });

  it.each([
    [409, { message: 'Assinatura indisponível: o termo ainda não foi aprovado' }, 'A assinatura ainda não está disponível. Procure o responsável.'],
    [413, { message: 'Payload too large' }, 'Não foi possível enviar a assinatura. Limpe e assine de novo.'],
    [400, { message: 'Imagem da assinatura inválida' }, 'Não foi possível enviar a assinatura. Limpe e assine de novo.'],
    [429, { message: 'Too Many Requests' }, 'Muitas tentativas. Aguarde alguns minutos.'],
  ])('assinar com %i mostra a mensagem em português', async (status, body, texto) => {
    handlers.sign = { status, body };
    await reachReview();
    accept();
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Assinar' }));
    expect(await screen.findByText(texto)).toBeInTheDocument();
  });

  it('termo desatualizado oferece atualizar sem perder o link', async () => {
    handlers.sign = { status: 400, body: { message: 'Termo desatualizado: recarregue a página' } };
    await reachReview();
    accept();
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Assinar' }));
    expect(await screen.findByText(/O termo foi atualizado/)).toBeInTheDocument();
    handlers.open = { status: 200, body: { ...OPEN, term: { ...OPEN.term, version: 'v2' } } };
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar termo' }));
    await waitFor(() => expect(calls('open')).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText(/O termo foi atualizado/)).toBeNull());
    expect(screen.getByRole('checkbox', { name: /li e aceito o termo/i })).not.toBeChecked();
  });

  it('recusar pede confirmação e envia o motivo opcional', async () => {
    handlers.refuse = { status: 200, body: { status: 'recusada' } };
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    expect(calls('refuse')).toHaveLength(0);
    const motivo = screen.getByLabelText(/motivo/i);
    expect(motivo).toHaveAttribute('maxlength', '300');
    fireEvent.change(motivo, { target: { value: 'Não recebi o capacete' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recusa' }));
    expect(await screen.findByText(/recusa foi registrada/i)).toBeInTheDocument();
    expect(bodyOf('refuse')).toEqual({ token: TOKEN, code: CODE, reason: 'Não recebi o capacete' });
  });

  it('recusar sem motivo não envia o campo; Voltar cancela', async () => {
    handlers.refuse = { status: 200, body: { status: 'recusada' } };
    await reachReview();
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.queryByRole('button', { name: 'Confirmar recusa' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recusa' }));
    await screen.findByText(/recusa foi registrada/i);
    expect(bodyOf('refuse')).toEqual({ token: TOKEN, code: CODE });
  });

  it('nenhum CPF e nenhum storage são usados', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    handlers.sign = { status: 201, body: { receipt_code: 'ASEPI-X', signed_at: '2026-10-15T15:30:00.000Z' } };
    const { container } = render(<Assinar />);
    await enterCode();
    await screen.findByText('Maria Souza');
    accept();
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Assinar' }));
    await screen.findByText('ASEPI-X');
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    expect(container.textContent).not.toMatch(/cpf/i);
    expect(container.textContent).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    setItem.mockRestore();
  });

  it('um segundo link colado na mesma aba (hashchange) troca o token', async () => {
    render(<Assinar />);
    await screen.findByLabelText(/código/i);
    const outro = 'B'.repeat(43);
    act(() => {
      window.location.hash = `#token=${outro}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(calls('peek')).toHaveLength(2));
    expect(bodyOf('peek', 1)).toEqual({ token: outro });
    expect(window.location.hash).toBe('');
  });

  it('hashchange com o peek do link A pendente: a resposta de A é ignorada e a tela mostra a empresa de B', async () => {
    const tokenB = 'B'.repeat(43);
    let resolveA!: (r: Reply) => void;
    handlers.peek = (b) =>
      b.token === TOKEN ? new Promise<Reply>((r) => (resolveA = r)) : { status: 200, body: { usable: true, company_name: 'Empresa B' } };
    render(<Assinar />);
    await waitFor(() => expect(calls('peek')).toHaveLength(1));
    act(() => {
      window.location.hash = `#token=${tokenB}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await screen.findByText(/Empresa B/);
    await act(async () => resolveA({ status: 200, body: { usable: true, company_name: 'Empresa A' } }));
    expect(screen.getByText(/Empresa B/)).toBeInTheDocument();
    expect(screen.queryByText(/Empresa A/)).toBeNull();
  });

  it('sign em voo + hashchange: a conclusão do link antigo não aparece', async () => {
    let resolveSign!: (r: Reply) => void;
    handlers.sign = new Promise<Reply>((r) => (resolveSign = r));
    await reachReview();
    accept();
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Assinar' }));
    await waitFor(() => expect(calls('sign')).toHaveLength(1));
    handlers.peek = { status: 200, body: { usable: true, company_name: 'Empresa B' } };
    act(() => {
      window.location.hash = `#token=${'B'.repeat(43)}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await screen.findByText(/Empresa B/);
    await act(async () => resolveSign({ status: 201, body: { receipt_code: 'ASEPI-VELHO', signed_at: '2026-10-15T15:30:00.000Z' } }));
    expect(screen.queryByText('ASEPI-VELHO')).toBeNull();
    expect(screen.getByLabelText(/código/i)).toBeInTheDocument();
    expect(screen.queryByText('Maria Souza')).toBeNull();
  });

  it('após o sucesso o código e os dados pessoais saem da tela e não dá para assinar de novo', async () => {
    handlers.sign = { status: 201, body: { receipt_code: 'ASEPI-FIM', signed_at: '2026-10-15T15:30:00.000Z' } };
    const { container } = render(<Assinar />);
    await enterCode();
    await screen.findByText('Maria Souza');
    accept();
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Assinar' }));
    await screen.findByText('ASEPI-FIM');
    expect(container.innerHTML).not.toContain(CODE);
    expect(container.innerHTML).not.toContain(TOKEN);
    expect(screen.queryByText('Maria Souza')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assinar' })).toBeNull();
    expect(container.querySelectorAll('input, textarea, canvas')).toHaveLength(0);
  });

  it('estado terminal (bloqueado) apaga os dados e não oferece "Tentar de novo"', async () => {
    handlers.open = { status: 403, body: { message: 'Link bloqueado' } };
    const { container } = render(<Assinar />);
    await enterCode();
    await screen.findByText(/foi bloqueado/);
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    expect(container.innerHTML).not.toContain(CODE);
  });

  it('"Tentar de novo" só existe quando a falha é recuperável (peek 502) e refaz o peek', async () => {
    let n = 0;
    handlers.peek = () => (++n === 1 ? { status: 502, body: {} } : { status: 200, body: { usable: true, company_name: 'Construtora Alfa' } });
    render(<Assinar />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    await screen.findByLabelText(/código/i);
    expect(calls('peek')).toHaveLength(2);
    expect(bodyOf('peek', 1)).toEqual({ token: TOKEN });
  });

  it('em erro na conferência o foco vai para a mensagem e o desenho é mantido; há a alternativa presencial', async () => {
    handlers.sign = { status: 502, body: {} };
    await reachReview();
    expect(screen.getByText(/registrar o recebimento presencialmente/)).toBeInTheDocument();
    accept();
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Assinar' }));
    const alerta = await screen.findByText('Não foi possível concluir agora. Tente novamente.');
    await waitFor(() => expect(alerta).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Assinar' })).toBeEnabled();
  });
});
