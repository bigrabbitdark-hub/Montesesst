import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AnexarDocumentoPanel } from '../AnexarDocumentoPanel';

const resp = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, headers: new Headers(), json: async () => body }) as Response;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const extraction = (over = {}) => ({
  id: 'x1', tenant_id: 't1', document_id: 'd1', status: 'requer_revisao',
  summary: { applied: 0, unchanged: 0, novo: 1, conflito: 1, invalida: 0, ignored_rows: 0 },
  items: [], created_at: '2026-10-14T10:00:00Z', resolved_at: null, ...over,
});
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const units = [{ id: 'u1', name: 'Filial Norte' }];
const xlsx = () => new File(['x'], 'cadastro.xlsx', { type: XLSX });
const pick = (file: File) => fireEvent.change(screen.getByLabelText(/Planilha/), { target: { files: [file] } });

describe('AnexarDocumentoPanel', () => {
  beforeEach(() => localStorage.setItem('montese_token', 'tok'));
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('o botão abre o painel (região rotulada) e Fechar devolve o foco ao botão', () => {
    render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Anexar documento' })).toBeNull();
    const btn = screen.getByRole('button', { name: 'Anexar documento' });
    fireEvent.click(btn);
    expect(screen.getByRole('region', { name: 'Anexar documento' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Anexar documento' }));
    expect(screen.getByText(/Funcionários novos e diferenças vão para revisão/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('region', { name: 'Anexar documento' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Anexar documento' }));
  });

  it('aceita .xlsx, .pdf e .docx e recusa outros formatos sem chamar a rede', async () => {
    const f = vi.fn().mockResolvedValue(resp(extraction({ status: 'sem_dados' }), 201));
    vi.stubGlobal('fetch', f);
    render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    expect(screen.getByLabelText(/Planilha/).getAttribute('accept')).toBe('.xlsx,.pdf,.docx');
    for (const [name, type] of [['laudo.txt', 'text/plain'], ['ficha.doc', 'application/msword'], ['planilha.xlsx', 'application/pdf']]) {
      pick(new File(['x'], name, { type }));
      fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
      expect(screen.getByRole('alert').textContent).toContain('Anexe a planilha modelo (.xlsx), um PDF com texto ou um DOCX.');
    }
    expect(f).not.toHaveBeenCalled();
    pick(new File(['x'], 'ficha.pdf', { type: 'application/pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    pick(new File(['x'], 'ficha.DOCX', { type: DOCX }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
  });

  it('imagens têm mensagem própria e não vão à rede', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    for (const [name, type] of [['foto.jpg', 'image/jpeg'], ['foto.JPEG', 'image/jpeg'], ['foto.png', 'image/png']]) {
      pick(new File(['x'], name, { type }));
      fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
      expect(screen.getByRole('alert').textContent).toContain('Imagens ainda não são lidas para o cadastro. Envie a planilha modelo (.xlsx), um PDF com texto ou um DOCX.');
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('o texto de ajuda cita os três formatos e avisa que PDF/DOCX não aplicam nada sozinhos', () => {
    render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    const help = screen.getByText(/planilha modelo \(\.xlsx\), um PDF com texto ou um DOCX/).textContent ?? '';
    expect(help).toContain('não aplica nada sozinha');
    expect(help).toContain('10 MB');
  });

  it('mostra a frase de espera só depois de 10 s e sem timeout curto no fetch', async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn().mockReturnValue(new Promise<Response>(() => {}));
      vi.stubGlobal('fetch', f);
      render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
      pick(xlsx());
      fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
      const st = screen.getByRole('status');
      expect(st.textContent).toBe('Enviando e analisando...');
      await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
      expect(st.textContent).not.toContain('alguns minutos');
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(st.textContent).toContain('Isto pode levar alguns minutos para documentos grandes.');
      // 3 minutos depois (resposta lenta e legítima) o envio ainda não foi cancelado.
      await act(async () => { await vi.advanceTimersByTimeAsync(170_000); });
      expect((f.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);
      expect(st.textContent).toContain('Enviando e analisando...');
    } finally {
      vi.useRealTimers();
    }
  });

  it('PDF com apoio de IA: avisa que é preciso conferir e que nada foi alterado', async () => {
    const e = extraction({
      summary: { applied: 0, unchanged: 0, novo: 1, conflito: 0, invalida: 0, ignored_rows: 0, method: 'texto+ia', ai_used: true },
      items: [{ line: 1, kind: 'novo', full_name: 'X Ficticio', cpf_masked: '***.***.***-25' }, { line: 2, kind: 'sugestao', full_name: 'Y Ficticia', cpf_masked: '***.***.***-35', suggestions: [{ field: 'position', proposed: 'Soldador' }] }],
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(e, 201)));
    render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    pick(new File(['x'], 'ficha.pdf', { type: 'application/pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Há 2 itens para revisar. Nada foi alterado no cadastro ainda. Leitura feita com apoio de IA: confira cada valor antes de aplicar.'));
  });

  it('sem arquivo ou acima de 10 MB não chama a rede', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    expect(screen.getByRole('alert').textContent).toContain('Anexe a planilha modelo (.xlsx), um PDF com texto ou um DOCX.');
    const big = xlsx();
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    pick(big);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    expect(screen.getByRole('alert').textContent).toContain('10 MB');
    expect(f).not.toHaveBeenCalled();
  });

  it('envia FormData com file e company_unit_id, mostra status, chama onDone e exibe o resultado', async () => {
    let release: (r: Response) => void = () => {};
    const f = vi.fn().mockReturnValue(new Promise<Response>((r) => { release = r; }));
    vi.stubGlobal('fetch', f);
    const onDone = vi.fn();
    render(<AnexarDocumentoPanel units={units} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    pick(xlsx());
    fireEvent.change(screen.getByLabelText('Filial'), { target: { value: 'u1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));

    expect((await screen.findByRole('status')).textContent).toContain('Enviando e analisando...');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/employees/documents');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect((init.body as FormData).get('company_unit_id')).toBe('u1');

    const e = extraction();
    release(resp(e, 201));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(e));
    expect(screen.getByRole('status').textContent).toContain('Há 2 itens para revisar.');
  });

  it('sem filial escolhida não envia company_unit_id', async () => {
    const f = vi.fn().mockResolvedValue(resp(extraction({ status: 'sem_dados' }), 201));
    vi.stubGlobal('fetch', f);
    render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    pick(xlsx());
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    await screen.findByText('Nenhuma linha de funcionário encontrada na planilha.');
    expect((f.mock.calls[0][1].body as FormData).has('company_unit_id')).toBe(false);
  });

  it('200 com reused é sucesso', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(extraction({ reused: true }), 200)));
    const onDone = vi.fn();
    render(<AnexarDocumentoPanel units={units} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    pick(xlsx());
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    await screen.findByText('Esta planilha já foi enviada e está aguardando revisão.');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('erro do backend aparece em role=alert; mensagem não textual vira frase genérica', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(resp({ message: 'Nesta versão, anexe a planilha modelo (.xlsx).' }, 400))
      .mockResolvedValueOnce(resp({ message: { stack: 'x' } }, 500));
    vi.stubGlobal('fetch', f);
    const onDone = vi.fn();
    render(<AnexarDocumentoPanel units={units} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    pick(xlsx());
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Nesta versão, anexe a planilha modelo'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Não foi possível enviar a planilha'));
    expect(screen.getByRole('alert').textContent).not.toContain('stack');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('falha de rede mostra erro em português', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    pick(xlsx());
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Verifique a conexão'));
  });

  it('disabled desabilita o botão', () => {
    render(<AnexarDocumentoPanel units={units} disabled onDone={() => {}} />);
    expect((screen.getByRole('button', { name: 'Anexar documento' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('regiões vivas existem desde a abertura, vazias', () => {
    render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('dois cliques rápidos em Enviar fazem um único fetch', async () => {
    const f = vi.fn().mockReturnValue(new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', f);
    render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    pick(xlsx());
    const send = screen.getByRole('button', { name: 'Enviar e analisar' });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('fechar e reabrir limpa arquivo, erro e resultado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(extraction(), 201)));
    render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    pick(xlsx());
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Há 2 itens'));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
    expect((screen.getByLabelText(/Planilha/) as HTMLInputElement).files?.length ?? 0).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Anexe a planilha modelo (.xlsx), um PDF com texto ou um DOCX.');
  });

  it('disabled com o painel aberto esconde e preserva o estado; ao reativar o arquivo segue valendo', async () => {
    const f = vi.fn().mockResolvedValue(resp(extraction({ status: 'sem_dados' }), 201));
    vi.stubGlobal('fetch', f);
    const { rerender, container } = render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    pick(xlsx());
    rerender(<AnexarDocumentoPanel units={units} disabled onDone={() => {}} />);
    expect(screen.queryByRole('region', { name: 'Anexar documento' })).toBeNull();
    expect(container.querySelector('section[aria-label="Anexar documento"]')).toHaveAttribute('hidden');
    rerender(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
  });

  it('status erro mostra a frase do estado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(resp(extraction({ status: 'erro' }), 201)));
    render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    pick(xlsx());
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Falha ao processar a planilha. Tente novamente.'));
  });

  it('a filial acompanha defaultUnitId até a pessoa escolher manualmente', () => {
    const two = [...units, { id: 'u2', name: 'Filial Sul' }];
    const { rerender } = render(<AnexarDocumentoPanel units={two} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    const sel = () => screen.getByLabelText('Filial') as HTMLSelectElement;
    expect(sel().value).toBe('');
    rerender(<AnexarDocumentoPanel units={two} defaultUnitId="u1" onDone={() => {}} />);
    expect(sel().value).toBe('u1');
    fireEvent.change(sel(), { target: { value: 'u2' } });
    rerender(<AnexarDocumentoPanel units={two} defaultUnitId="u1" onDone={() => {}} />);
    rerender(<AnexarDocumentoPanel units={two} defaultUnitId="" onDone={() => {}} />);
    expect(sel().value).toBe('u2');
  });

  it('lista as linhas com problema do resultado e limpa ao fechar', async () => {
    const items = [
      { line: 14, kind: 'invalida', reason: 'CPF inválido' },
      { line: 15, kind: 'conflito', full_name: 'X Ficticio', cpf_masked: '***.***.***-25', reason: 'outra_filial' },
      { line: 16, kind: 'invalida', reason: 'outra_filial' },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => resp(extraction({ items }), 201)));
    render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    pick(xlsx());
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
    await screen.findByText('Linha 14: CPF inválido');
    expect(screen.getByText('Linha 16: Já cadastrado em outra filial')).toBeTruthy();
    expect(screen.queryByText(/Linha 15/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
    expect(screen.queryByText(/Linha 14/)).toBeNull();
  });

  describe('acompanhamento da leitura (polling)', () => {
    const pdf = () => new File(['x'], 'ficha.pdf', { type: 'application/pdf' });
    const NOTICE = 'Este documento ainda está sendo lido. Vamos avisar quando terminar.';
    const processing = (over = {}) => extraction({ status: 'processando', reused: true, ...over });
    const final = (over = {}) =>
      extraction({ status: 'requer_revisao', summary: { applied: 0, unchanged: 0, novo: 1, conflito: 0, invalida: 0, ignored_rows: 0, method: 'texto' }, items: [{ line: 1, kind: 'novo', full_name: 'A Ficticia', cpf_masked: '***' }], ...over });
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    const start = (file: File, onDone = vi.fn()) => {
      render(<AnexarDocumentoPanel units={units} onDone={onDone} />);
      fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
      pick(file);
      fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
      return onDone;
    };
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('processando/reused: consulta a cada 5 s, para ao mudar de status e chama onDone com o resultado final', async () => {
      const f = vi.fn(async (url: string) => (String(url).includes('/extractions/x1') ? (f.mock.calls.length >= 4 ? resp(final()) : resp(processing())) : resp(processing(), 200)));
      vi.stubGlobal('fetch', f);
      const onDone = start(pdf());
      await tick(0);
      expect(screen.getByRole('status').textContent).toContain(NOTICE);
      expect(screen.getByRole('status').textContent).toContain('Lendo o documento... 0 s');
      expect(f).toHaveBeenCalledTimes(1);
      await tick(5_000);
      expect(f).toHaveBeenCalledTimes(2);
      expect(f.mock.calls[1][0]).toBe('/api/employees/extractions/x1');
      expect(((f.mock.calls as unknown as [string, RequestInit][])[1][1]).headers).toEqual({ Authorization: 'Bearer tok' });
      expect(screen.getByRole('status').textContent).toContain('Lendo o documento... 5 s');
      expect(onDone).not.toHaveBeenCalled();
      await tick(10_000);
      expect(f).toHaveBeenCalledTimes(4);
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onDone.mock.calls[0][0].status).toBe('requer_revisao');
      expect(screen.getByRole('status').textContent).toContain('Há 1 item para revisar. Nada foi alterado no cadastro ainda.');
      await tick(30_000);
      expect(f).toHaveBeenCalledTimes(4);
    });

    it('não acumula timers: fechar/desmontar para o polling', async () => {
      const f = vi.fn(async () => resp(processing()));
      vi.stubGlobal('fetch', f);
      start(pdf());
      await tick(0);
      await tick(5_000);
      expect(f).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
      await tick(60_000);
      expect(f).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('desmontar limpa o timer', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => resp(processing())));
      render(<AnexarDocumentoPanel units={units} onDone={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Anexar documento' }));
      pick(pdf());
      fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
      await tick(0);
      cleanup();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('estoura em 3 min com mensagem e para', async () => {
      const f = vi.fn(async () => resp(processing()));
      vi.stubGlobal('fetch', f);
      const onDone = start(pdf());
      await tick(0);
      await tick(181_000);
      expect(screen.getByRole('status').textContent).toBe('A leitura está demorando. Atualize a página em instantes.');
      const n = f.mock.calls.length;
      await tick(30_000);
      expect(f.mock.calls.length).toBe(n);
      expect(onDone).not.toHaveBeenCalled();
    });

    it('abort/rede: avisa que o servidor pode ter continuado, sem polling', async () => {
      const f = vi.fn().mockRejectedValue(new Error('x'));
      vi.stubGlobal('fetch', f);
      start(pdf());
      await tick(0);
      expect(screen.getByRole('alert').textContent).toContain('Não foi possível enviar o documento');
      expect(screen.getByRole('status').textContent).toContain('A leitura pode ter continuado no servidor. Aguarde alguns instantes e atualize a página; se houver revisão pendente ela aparecerá no topo.');
      await tick(60_000);
      expect(f).toHaveBeenCalledTimes(1);
    });

    it('resposta 2xx sem items/status vira alerta sem exceção e sem onDone', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp({ id: 'x1' }, 201)));
      const onDone = start(xlsx());
      await tick(0);
      expect(screen.getByRole('alert').textContent).toBe('Resposta inesperada do servidor. Atualize a página para conferir.');
      expect(onDone).not.toHaveBeenCalled();
    });

    it('reused+requer_revisao: "planilha" para xlsx e "documento" para PDF', async () => {
      const f = vi
        .fn()
        .mockResolvedValueOnce(resp(extraction({ reused: true }), 200))
        .mockResolvedValueOnce(resp(extraction({ reused: true, summary: { applied: 0, unchanged: 0, novo: 1, conflito: 0, invalida: 0, ignored_rows: 0, method: 'texto' } }), 200));
      vi.stubGlobal('fetch', f);
      start(xlsx());
      await tick(0);
      expect(screen.getByRole('status').textContent).toBe('Esta planilha já foi enviada e está aguardando revisão.');
      pick(pdf());
      fireEvent.click(screen.getByRole('button', { name: 'Enviar e analisar' }));
      await tick(0);
      expect(screen.getByRole('status').textContent).toBe('Este documento já foi enviado e está aguardando revisão.');
    });

    it('expirado no upload ou no polling mostra a mensagem e chama onDone sem revisão', async () => {
      const exp = (over = {}) => extraction({ status: 'expirado', summary: { applied: 0, unchanged: 0, novo: 0, conflito: 0, invalida: 0, ignored_rows: 0, method: 'texto', detail: 'A revisão expirou. Reenvie o documento.' }, ...over });
      const f = vi.fn().mockResolvedValueOnce(resp(processing(), 200)).mockResolvedValue(resp(exp()));
      vi.stubGlobal('fetch', f);
      const onDone = start(pdf());
      await tick(0);
      await tick(5_000);
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onDone.mock.calls[0][0].status).toBe('expirado');
      expect(screen.getByRole('status').textContent).toBe('A revisão expirou. Reenvie o documento.');
      await tick(30_000);
      expect(f).toHaveBeenCalledTimes(2);
    });

    it('conteúdo com RTL/ZWSP nas linhas com problema é limpo', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp(extraction({ items: [{ line: 3, kind: 'invalida', reason: 'a\u202Eb\u200Bc' }] }), 201)));
      start(xlsx());
      await tick(0);
      expect(screen.getByText('Linha 3: abc')).toBeTruthy();
    });
  });
});
