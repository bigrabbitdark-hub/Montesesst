import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: 'd-1' }),
  useSearchParams: () => new URLSearchParams(''),
}));

import DocumentoDetalhePage from '../documentos/[id]/page';

const AVISO = 'Registro de assinatura interna do sistema. Não é certificado digital ICP-Brasil e não garante, por si só, validade jurídica em todos os casos.';
const HASH1 = 'a1b2c3d4' + 'e'.repeat(48) + '0f9e8d7c';
const HASH2 = '11223344' + 'f'.repeat(48) + '99887766';

const detalhe = {
  id: 'd-1', tenant_id: 't-1', tenant_name: 'Alfa Ltda', category: 'pgr', title: 'PGR 2026', status: 'em_revisao',
  current_version_id: 'v-2', versao_atual: 2, versao_atual_sha256: HASH2, published_document_id: null,
  created_by: 'u-2', created_by_name: 'Ana Sócia', created_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-12T15:30:00Z',
  versoes: [
    { id: 'v-1', version_number: 1, file_name: 'pgr-v1.pdf', mime_type: 'application/pdf', size_bytes: 2048, sha256: HASH1, note: 'Primeira', created_by: 'u-2', created_by_name: 'Ana Sócia', created_at: '2026-10-10T10:00:00Z' },
    { id: 'v-2', version_number: 2, file_name: 'pgr-v2.pdf', mime_type: 'application/pdf', size_bytes: 3 * 1024 * 1024, sha256: HASH2, note: null, created_by: 'u-2', created_by_name: 'Ana Sócia', created_at: '2026-10-11T10:00:00Z' },
  ],
  eventos: [
    { id: 'e1', type: 'created', version_id: null, actor_user_id: 'u-2', actor_name: 'Ana Sócia', note: null, created_at: '2026-10-10T10:00:00Z' },
    { id: 'e2', type: 'version_added', version_id: 'v-1', actor_user_id: 'u-2', actor_name: 'Ana Sócia', note: 'Primeira', created_at: '2026-10-10T10:05:00Z' },
    { id: 'e3', type: 'submitted', version_id: 'v-2', actor_user_id: 'u-2', actor_name: 'Ana Sócia', note: null, created_at: '2026-10-11T10:00:00Z' },
    { id: 'e4', type: 'returned', version_id: 'v-1', actor_user_id: 'u-3', actor_name: 'Beto Sócio', note: 'Falta anexo', created_at: '2026-10-11T12:00:00Z' },
  ],
  assinaturas: [
    { id: 's1', version_id: 'v-1', version_number: 1, signer_user_id: 'u-3', signer_name: 'Beto Sócio', version_sha256: HASH1, signed_at: '2026-10-11T13:00:00Z', registro_confirmado: true, vigente: false },
    { id: 's2', version_id: 'v-2', version_number: 2, signer_user_id: 'u-4', signer_name: 'Carla Sócia', version_sha256: HASH2, signed_at: '2026-10-12T13:00:00Z', registro_confirmado: true, vigente: true },
  ],
  aviso_assinatura: AVISO,
  acoes_permitidas: ['nova_versao', 'enviar_revisao', 'devolver', 'aprovar', 'assinar', 'publicar', 'cancelar'],
};

function resp(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
let atual: Record<string, unknown>;
beforeEach(() => {
  atual = detalhe;
  localStorage.setItem('montese_token', 'tok');
  localStorage.setItem('montese_user', JSON.stringify({ id: 'u-me', role: 'socio', tenantId: null }));
  fetchMock = vi.fn(async (_u: string, init?: RequestInit) => {
    if (init?.method === 'POST') return resp(201, atual);
    return resp(200, atual);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const posts = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'POST');
const comAcoes = (acoes: string[], extra: Record<string, unknown> = {}) => { atual = { ...detalhe, acoes_permitidas: acoes, ...extra }; };

describe('cabeçalho, linha do tempo e versões', () => {
  it('mostra título, cliente, categoria e estado', async () => {
    render(<DocumentoDetalhePage />);
    expect(await screen.findByRole('heading', { name: 'PGR 2026' })).toBeTruthy();
    expect(screen.getAllByText(/Alfa Ltda/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('PGR').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Em revisão').length).toBeGreaterThan(0);
  });

  it('linha do tempo cronológica com ator em texto, tipo traduzido, nota e data em São Paulo', async () => {
    render(<DocumentoDetalhePage />);
    const lista = await screen.findByRole('list', { name: 'Linha do tempo' });
    const itens = within(lista).getAllByRole('listitem');
    expect(itens).toHaveLength(4);
    expect(itens[0].textContent).toContain('Rascunho criado');
    expect(itens[0].textContent).toContain('de Ana Sócia');
    expect(itens[0].textContent).toMatch(/10\/10\/2026.*07:00/);
    expect(itens[1].textContent).toContain('Nova versão enviada');
    expect(itens[2].textContent).toContain('Enviado para revisão');
    expect(itens[3].textContent).toContain('Devolvido para elaboração');
    expect(itens[3].textContent).toContain('de Beto Sócio');
    expect(itens[3].textContent).toContain('Falta anexo');
  });

  it('versões: número, arquivo, tamanho, hash abreviado com valor completo acessível, autor, nota', async () => {
    render(<DocumentoDetalhePage />);
    const lista = await screen.findByRole('list', { name: 'Versões' });
    const v1 = within(lista).getAllByRole('listitem')[0];
    expect(v1.textContent).toContain('Versão 1');
    expect(v1.textContent).toContain('pgr-v1.pdf');
    expect(v1.textContent).toContain('2,0 KB');
    expect(v1.textContent).toContain('a1b2c3d4…0f9e8d7c');
    expect(v1.textContent).toContain(HASH1); // completo para leitor de tela
    expect(v1.textContent).toContain('Ana Sócia');
    expect(v1.textContent).toContain('Primeira');
    expect(within(lista).getAllByRole('listitem')[1].textContent).toContain('3,0 MB');
  });

  it('copia o hash completo', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<DocumentoDetalhePage />);
    const lista = await screen.findByRole('list', { name: 'Versões' });
    fireEvent.click(within(lista).getAllByRole('button', { name: /Copiar hash/ })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HASH1));
  });

  it('Baixar chama a rota de download e abre a URL temporária', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    fetchMock.mockImplementation(async (u: string) =>
      String(u).includes('/download') ? resp(200, { url: 'https://r2.test/tmp?sig=1', file_name: 'pgr-v1.pdf' }) : resp(200, atual));
    render(<DocumentoDetalhePage />);
    const lista = await screen.findByRole('list', { name: 'Versões' });
    fireEvent.click(within(lista).getAllByRole('button', { name: /Baixar/ })[0]);
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(String(open.mock.calls[0][0])).toBe('https://r2.test/tmp?sig=1');
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/atuacao/documentos/d-1/versoes/v-1/download'))).toBe(true);
    expect(screen.queryByRole('link', { name: /Baixar/ })).toBeNull();
  });
});

describe('ações', () => {
  it('com acoes_permitidas vazio NENHUM botão de transição aparece', async () => {
    comAcoes([]);
    render(<DocumentoDetalhePage />);
    await screen.findByRole('heading', { name: 'PGR 2026' });
    for (const nome of [/Nova versão/, /Enviar para revisão/, /Devolver/, /Aprovar/, /Registrar assinatura interna/, /Publicar/, /Cancelar documento/]) {
      expect(screen.queryByRole('button', { name: nome })).toBeNull();
    }
  });

  it('mostra só os botões das ações permitidas', async () => {
    comAcoes(['enviar_revisao', 'cancelar']);
    render(<DocumentoDetalhePage />);
    await screen.findByRole('button', { name: 'Enviar para revisão' });
    expect(screen.getByRole('button', { name: 'Cancelar documento' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Aprovar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Publicar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Registrar assinatura interna/ })).toBeNull();
  });

  it('enviar para revisão faz POST sem corpo, recarrega e anuncia em status', async () => {
    comAcoes(['enviar_revisao']);
    render(<DocumentoDetalhePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar para revisão' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(String(posts()[0][0])).toBe('/api/atuacao/documentos/d-1/enviar-revisao');
    expect((posts()[0][1] as RequestInit).body).toBeUndefined();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Documento enviado para revisão.'));
    const gets = fetchMock.mock.calls.filter((c) => !(c[1] as RequestInit | undefined)?.method);
    expect(gets.length).toBeGreaterThanOrEqual(2);
  });

  it('evita duplo envio durante a requisição', async () => {
    comAcoes(['aprovar']);
    let liberar!: (r: Response) => void;
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === 'POST' ? new Promise<Response>((r) => { liberar = r; }) : resp(200, atual));
    render(<DocumentoDetalhePage />);
    const b = await screen.findByRole('button', { name: 'Aprovar' });
    fireEvent.click(b);
    await waitFor(() => expect((b as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(b);
    expect(posts()).toHaveLength(1);
    await act(async () => { liberar(resp(201, atual)); });
  });

  it('devolver exige nota, mostra aviso LGPD e envia a nota', async () => {
    comAcoes(['devolver']);
    render(<DocumentoDetalhePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Devolver para elaboração' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText('Não inclua dados pessoais sensíveis ou de saúde.')).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar' }));
    expect(within(dlg).getByRole('alert').textContent).toContain('Informe a nota');
    expect(posts()).toHaveLength(0);
    fireEvent.change(within(dlg).getByLabelText(/Nota/), { target: { value: 'Ajustar anexo' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(String(posts()[0][0])).toBe('/api/atuacao/documentos/d-1/devolver');
    expect(JSON.parse((posts()[0][1] as RequestInit).body as string)).toEqual({ note: 'Ajustar anexo' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancelar exige nota', async () => {
    comAcoes(['cancelar']);
    render(<DocumentoDetalhePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar documento' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar' }));
    expect(posts()).toHaveLength(0);
    fireEvent.change(within(dlg).getByLabelText(/Nota/), { target: { value: 'Duplicado' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(String(posts()[0][0])).toBe('/api/atuacao/documentos/d-1/cancelar'));
  });

  it('publicar: vencimento opcional (sem data, sem corpo; com data, expires_at)', async () => {
    comAcoes(['publicar']);
    render(<DocumentoDetalhePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar' }));
    let dlg = await screen.findByRole('dialog');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect((posts()[0][1] as RequestInit).body).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText(/Vencimento/), { target: { value: '2027-03-31' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(JSON.parse((posts()[1][1] as RequestInit).body as string)).toEqual({ expires_at: '2027-03-31' });
  });

  it('registrar assinatura interna: diálogo com o aviso da API, POST sem corpo', async () => {
    comAcoes(['assinar']);
    render(<DocumentoDetalhePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar assinatura interna' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(AVISO)).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(String(posts()[0][0])).toBe('/api/atuacao/documentos/d-1/assinar');
    expect((posts()[0][1] as RequestInit).body).toBeUndefined();
  });
});

describe('assinaturas internas registradas', () => {
  it('vigente / não vigente em texto, versão, hash, signatário e data; aviso em destaque', async () => {
    render(<DocumentoDetalhePage />);
    const sec = await screen.findByRole('region', { name: 'Assinaturas internas registradas' });
    const itens = within(sec).getAllByRole('listitem');
    expect(itens[0].textContent).toContain('Beto Sócio');
    expect(itens[0].textContent).toContain('não vigente (versão substituída)');
    expect(itens[0].textContent).toContain('Versão 1');
    expect(itens[0].textContent).toContain(HASH1);
    expect(itens[0].textContent).toMatch(/11\/10\/2026.*10:00/);
    expect(itens[1].textContent).toContain('Carla Sócia');
    expect(itens[1].textContent).toMatch(/(^|[^ã] )vigente|vigente/);
    expect(itens[1].textContent).not.toContain('não vigente');
    expect(within(sec).getByText(AVISO)).toBeTruthy();
  });

  it('sem conselho/número/UF na API: mostra "Registro profissional confirmado: sim" e nada inferido', async () => {
    render(<DocumentoDetalhePage />);
    const sec = await screen.findByRole('region', { name: 'Assinaturas internas registradas' });
    expect(within(sec).getAllByText(/Registro profissional confirmado: sim/).length).toBe(2);
    expect(sec.textContent).not.toMatch(/CREA|CRM|CRP|CREFITO|MTE/);
  });

  it('com conselho/número/UF na API: exibe-os', async () => {
    atual = { ...detalhe, assinaturas: [{ ...detalhe.assinaturas[1], council: 'CREA', registration_number: '123456', uf: 'SP' }] };
    render(<DocumentoDetalhePage />);
    const sec = await screen.findByRole('region', { name: 'Assinaturas internas registradas' });
    expect(sec.textContent).toContain('CREA');
    expect(sec.textContent).toContain('123456');
    expect(sec.textContent).toContain('SP');
  });

  it('sem assinaturas: mensagem vazia', async () => {
    atual = { ...detalhe, assinaturas: [] };
    render(<DocumentoDetalhePage />);
    const sec = await screen.findByRole('region', { name: 'Assinaturas internas registradas' });
    expect(sec.textContent).toContain('Nenhuma assinatura interna registrada.');
  });

  it('varredura do DOM: sem "assinatura digital" nem "ICP-Brasil" fora do aviso da API', async () => {
    const { container } = render(<DocumentoDetalhePage />);
    await screen.findByRole('region', { name: 'Assinaturas internas registradas' });
    const txt = (container.textContent ?? '').split(AVISO).join('');
    expect(txt.toLowerCase()).not.toContain('assinatura digital');
    expect(txt.toLowerCase()).not.toContain('icp-brasil');
    expect(txt.toLowerCase()).not.toContain('validade jurídica');
    expect(container.textContent).toContain(AVISO);
    expect(screen.getByRole('button', { name: 'Registrar assinatura interna' })).toBeTruthy();
  });
});

describe('erros do servidor', () => {
  it.each([
    [403, 'Ação não habilitada para este tipo de documento. Peça ao administrador para configurar as responsabilidades.'],
    [403, 'Registro profissional não confirmado.'],
    [409, 'Ação não permitida no estado atual do documento.'],
    [409, 'Quem elaborou o documento não pode revisá-lo nem aprová-lo.'],
  ])('%s: mostra a mensagem do servidor sem reescrever', async (status, message) => {
    comAcoes(['aprovar']);
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === 'POST' ? resp(status, { message }) : resp(200, atual));
    render(<DocumentoDetalhePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe(message);
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeTruthy();
  });

  it('erro no diálogo mantém o diálogo aberto', async () => {
    comAcoes(['devolver']);
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === 'POST' ? resp(400, { message: ['note should not be empty', 'outra'] }) : resp(200, atual));
    render(<DocumentoDetalhePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Devolver para elaboração' }));
    const dlg = await screen.findByRole('dialog');
    fireEvent.change(within(dlg).getByLabelText(/Nota/), { target: { value: 'x' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(within(dlg).getByRole('alert').textContent).toContain('note should not be empty'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((within(dlg).getByLabelText(/Nota/) as HTMLTextAreaElement).value).toBe('x');
  });

  it('404 ⇒ "Documento não encontrado."', async () => {
    fetchMock.mockImplementation(async () => resp(404, { message: 'Not Found' }));
    render(<DocumentoDetalhePage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Documento não encontrado.');
  });

  it('401 limpa a sessão', async () => {
    fetchMock.mockImplementation(async () => resp(401, {}));
    const loc = { href: '' };
    vi.stubGlobal('location', loc);
    render(<DocumentoDetalhePage />);
    await waitFor(() => expect(localStorage.getItem('montese_token')).toBeNull());
  });
});

describe('diálogo', () => {
  it('foco entra no diálogo, Tab fica preso, Esc fecha e devolve o foco ao botão', async () => {
    comAcoes(['devolver']);
    render(<DocumentoDetalhePage />);
    const abrir = await screen.findByRole('button', { name: 'Devolver para elaboração' });
    abrir.focus();
    fireEvent.click(abrir);
    const dlg = await screen.findByRole('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect(dlg.contains(document.activeElement)).toBe(true));
    const confirmar = within(dlg).getByRole('button', { name: 'Confirmar' });
    confirmar.focus();
    const ultimo = within(dlg).getAllByRole('button').slice(-1)[0];
    ultimo.focus();
    fireEvent.keyDown(ultimo, { key: 'Tab' });
    expect(dlg.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(dlg, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(abrir);
  });
});

describe('nova versão (upload)', () => {
  function arquivo(nome: string, tipo: string, bytes = 10) {
    return new File([new Uint8Array(bytes)], nome, { type: tipo });
  }
  async function abrir() {
    comAcoes(['nova_versao']);
    render(<DocumentoDetalhePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nova versão' }));
    return screen.findByRole('dialog');
  }

  it('rejeita tipo inválido antes de enviar', async () => {
    const dlg = await abrir();
    fireEvent.change(within(dlg).getByLabelText(/Arquivo/), { target: { files: [arquivo('a.exe', 'application/x-msdownload')] } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Enviar' }));
    expect(within(dlg).getByRole('alert').textContent).toContain('Tipo de arquivo não aceito');
    expect(posts()).toHaveLength(0);
  });

  it('rejeita arquivo acima de 10 MB antes de enviar', async () => {
    const dlg = await abrir();
    fireEvent.change(within(dlg).getByLabelText(/Arquivo/), { target: { files: [arquivo('a.pdf', 'application/pdf', 10 * 1024 * 1024 + 1)] } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Enviar' }));
    expect(within(dlg).getByRole('alert').textContent).toContain('10 MB');
    expect(posts()).toHaveLength(0);
  });

  it('sem arquivo: pede o arquivo', async () => {
    const dlg = await abrir();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Enviar' }));
    expect(within(dlg).getByRole('alert').textContent).toContain('Selecione um arquivo');
  });

  it('envia multipart com file e note, sem Content-Type manual, e aviso LGPD', async () => {
    const dlg = await abrir();
    expect(within(dlg).getByText('Não inclua dados pessoais sensíveis ou de saúde.')).toBeTruthy();
    const f = arquivo('pgr.pdf', 'application/pdf');
    fireEvent.change(within(dlg).getByLabelText(/Arquivo/), { target: { files: [f] } });
    fireEvent.change(within(dlg).getByLabelText(/Nota/), { target: { value: 'Revisão 2' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const init = posts()[0][1] as RequestInit;
    expect(String(posts()[0][0])).toBe('/api/atuacao/documentos/d-1/versoes');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect((init.body as FormData).get('note')).toBe('Revisão 2');
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Nova versão enviada.'));
  });

  it('413 mostra mensagem clara e mantém o diálogo', async () => {
    const dlg = await abrir();
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) => (init?.method === 'POST' ? resp(413, {}) : resp(200, atual)));
    fireEvent.change(within(dlg).getByLabelText(/Arquivo/), { target: { files: [arquivo('a.pdf', 'application/pdf')] } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(within(dlg).getByRole('alert').textContent).toContain('10 MB'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('estados terminais', () => {
  it.each(['publicado', 'cancelado'])('%s: sem ações de edição ou exclusão', async (status) => {
    comAcoes([], { status, published_document_id: status === 'publicado' ? 'doc-9' : null });
    render(<DocumentoDetalhePage />);
    await screen.findByRole('heading', { name: 'PGR 2026' });
    expect(screen.queryByRole('button', { name: /Nova versão|Editar|Excluir|Apagar|Remover/ })).toBeNull();
    if (status === 'publicado') {
      expect(screen.getByText('Publicado em documentos do cliente')).toBeTruthy();
      expect(screen.queryByRole('link', { name: /Publicado em documentos do cliente/ })).toBeNull();
    } else {
      expect(screen.queryByText('Publicado em documentos do cliente')).toBeNull();
    }
  });
});
