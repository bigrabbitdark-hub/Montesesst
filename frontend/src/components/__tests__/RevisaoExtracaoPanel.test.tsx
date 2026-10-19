import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RevisaoExtracaoPanel } from '../RevisaoExtracaoPanel';
import type { Extraction } from '@/lib/employees-ingestion';

const resp = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, headers: new Headers(), json: async () => body }) as Response;

const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  id: 'x1', tenant_id: 't1', document_id: 'd1', status: 'requer_revisao',
  summary: { applied: 1, unchanged: 0, novo: 2, conflito: 2, invalida: 1, ignored_rows: 0 },
  items: [
    { line: 10, kind: 'novo', full_name: 'Ana Ficticia', cpf_masked: '***.***.***-25' },
    { line: 11, kind: 'novo', full_name: 'Bruno Ficticio', cpf_masked: '***.***.***-35' },
    {
      line: 12, kind: 'conflito', full_name: 'Carla Ficticia', cpf_masked: '***.***.***-09',
      conflicts: [
        { field: 'position', current: 'Soldadora', proposed: 'Eletricista' },
        { field: 'admission_date', current: '2020-01-05', proposed: '2021-03-10' },
      ],
    },
    { line: 13, kind: 'conflito', full_name: 'Dani Ficticia', cpf_masked: '***.***.***-00', reason: 'outra_filial' },
    { line: 14, kind: 'invalida', reason: 'CPF inválido' },
  ],
  created_at: '2026-10-14T10:00:00Z', resolved_at: null, ...over,
});

const resolved = () =>
  extraction({ status: 'aplicado', items: [], summary: { applied: 1, unchanged: 0, novo: 0, conflito: 0, invalida: 0, ignored_rows: 0, resolved: { aplicados: 2, ignorados: 3 } } });
const lastBody = (f: ReturnType<typeof vi.fn>) => JSON.parse((f.mock.calls.at(-1)?.[1] as RequestInit).body as string);

describe('RevisaoExtracaoPanel', () => {
  beforeEach(() => localStorage.setItem('montese_token', 'tok'));
  afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

  it('é uma região rotulada, foca o título e agrupa por seção', () => {
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('region', { name: 'Revisão da planilha enviada' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 }));
    expect(screen.getByRole('heading', { name: 'Novos funcionários' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Diferenças com o cadastro' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Linhas com problema' })).toBeTruthy();
    expect(screen.getByText(/CPF inválido/)).toBeTruthy();
    expect(screen.getByText('Linha 14')).toBeTruthy();
    expect(screen.getByText('Linha 10 da planilha')).toBeTruthy();
    // CPF só mascarado
    expect(screen.getAllByText('***.***.***-25').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11}/);
  });

  it('resumo em região viva montada desde o início', () => {
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={() => {}} onCancel={() => {}} />);
    const st = screen.getByRole('status');
    expect(st.getAttribute('aria-live')).toBe('polite');
    expect(st.textContent).toMatch(/0 marcados/);
    fireEvent.click(screen.getByLabelText(/^Cadastrar Ana Ficticia/));
    expect(st.textContent).toMatch(/1 marcado/);
  });

  it('tudo começa desmarcado; conflito mostra atual e planilha em elementos separados e datas em DD/MM/AAAA', () => {
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={() => {}} onCancel={() => {}} />);
    for (const cb of screen.getAllByRole('checkbox')) expect((cb as HTMLInputElement).checked).toBe(false);
    expect(screen.getAllByLabelText('Usar o valor da planilha')).toHaveLength(2);
    expect(screen.getByText('Soldadora').tagName).toBe('SPAN');
    expect(screen.getByText('Eletricista').tagName).toBe('SPAN');
    expect(screen.getByText('05/01/2020')).toBeTruthy();
    expect(screen.getByText('10/03/2021')).toBeTruthy();
  });

  it('outra_filial mostra aviso e nenhuma opção', () => {
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={() => {}} onCancel={() => {}} />);
    const li = screen.getByText('Dani Ficticia').closest('li') as HTMLElement;
    expect(within(li).getByText(/Já cadastrado em outra filial/)).toBeTruthy();
    expect(within(li).queryByRole('checkbox')).toBeNull();
  });

  it('confirmar envia uma decisão por item pendente (sem inválidas)', async () => {
    const f = vi.fn(async () => resp(resolved()));
    vi.stubGlobal('fetch', f);
    const onResolved = vi.fn();
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={onResolved} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText(/^Cadastrar Ana Ficticia/));
    fireEvent.click(within(screen.getByText('Carla Ficticia').closest('li') as HTMLElement).getAllByLabelText('Usar o valor da planilha')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
    await screen.findByText('2 aplicados, 3 ignorados.');
    const call = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe('/api/employees/extractions/x1/resolve');
    expect(call[1].method).toBe('POST');
    expect((call[1].headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(lastBody(f)).toEqual({
      decisions: [
        { line: 10, action: 'aplicar' },
        { line: 11, action: 'ignorar' },
        { line: 12, action: 'aplicar', fields: ['admission_date'] },
        { line: 13, action: 'ignorar' },
      ],
    });
    expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ status: 'aplicado' }));
  });

  it('conflito sem campo marcado vira ignorar', async () => {
    const f = vi.fn(async () => resp(resolved()));
    vi.stubGlobal('fetch', f);
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
    await screen.findByText('2 aplicados, 3 ignorados.');
    expect(lastBody(f).decisions.every((d: { action: string }) => d.action === 'ignorar')).toBe(true);
  });

  it('desabilita enquanto envia e não duplica o envio', async () => {
    let release: (r: Response) => void = () => {};
    const f = vi.fn(() => new Promise<Response>((r) => { release = r; }));
    vi.stubGlobal('fetch', f);
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={() => {}} onCancel={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Confirmar decisões' }) as HTMLButtonElement;
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Descartar tudo' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('Enviando');
    expect(f).toHaveBeenCalledTimes(1);
    release(resp(resolved()));
    await screen.findByText('2 aplicados, 3 ignorados.');
  });

  it.each([
    [403, { message: 'Sem permissão' }, /permissão/],
    [409, { message: 'Os dados do funcionário mudaram desde a análise. Reenvie a planilha.' }, /Reenvie a planilha/],
    [400, { message: 'Informe quais campos aplicar' }, /Informe quais campos aplicar/],
  ])('erro %s aparece em alert, sem fechar o painel e sem perder as marcações', async (status, body, re) => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(body, status)));
    const onResolved = vi.fn();
    const onCancel = vi.fn();
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={onResolved} onCancel={onCancel} />);
    fireEvent.click(screen.getByLabelText(/^Cadastrar Ana Ficticia/));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(re));
    expect(screen.getByRole('region', { name: 'Revisão da planilha enviada' })).toBeTruthy();
    expect((screen.getByLabelText(/^Cadastrar Ana Ficticia/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'Confirmar decisões' }) as HTMLButtonElement).disabled).toBe(false);
    expect(onResolved).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('409 sem a frase de reenvio ainda sugere reenviar a planilha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ message: 'Esta revisão já foi resolvida ou não está pendente' }, 409)));
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Reenvie a planilha/));
  });

  it('falha de rede mostra alert e mantém o painel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('x'); }));
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/conexão/));
  });

  it('Descartar tudo pede confirmação; cancelada não envia; confirmada envia tudo como ignorar', async () => {
    const f = vi.fn(async () => resp(resolved()));
    vi.stubGlobal('fetch', f);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText(/^Cadastrar Ana Ficticia/));
    fireEvent.click(screen.getByRole('button', { name: 'Descartar tudo' }));
    expect(confirm.mock.calls[0][0]).toContain('Nada será alterado no cadastro.');
    expect(f).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar tudo' }));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    expect(lastBody(f).decisions).toHaveLength(4);
    expect(lastBody(f).decisions.every((d: { action: string; fields?: unknown }) => d.action === 'ignorar' && d.fields === undefined)).toBe(true);
    confirm.mockRestore();
  });

  it('Decidir depois chama onCancel sem rede', () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const onCancel = vi.fn();
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Decidir depois' }));
    expect(onCancel).toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });

  it('200 sem corpo utilizável: avisa que pode ter salvo, não chama onResolved, mantém o painel e reabilita o botão', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new Error('vazio'); } }) as unknown as Response));
    const onResolved = vi.fn();
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={onResolved} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('As decisões podem ter sido salvas. Atualize a página para conferir.'));
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Revisão da planilha enviada' })).toBeTruthy();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Confirmar decisões' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('as linhas com problema continuam visíveis depois de resolver', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(resolved())));
    render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
    await screen.findByText('2 aplicados, 3 ignorados.');
    expect(screen.queryByRole('button', { name: 'Confirmar decisões' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Linhas com problema' })).toBeTruthy();
    expect(screen.getByText('Linha 14')).toBeTruthy();
    expect(screen.getByText(/CPF inválido/)).toBeTruthy();
  });

  describe('PDF/DOCX (Fatia 4)', () => {
    const AI = 'Leitura feita com apoio de IA: confira cada valor antes de aplicar.';
    const doc = (over: Partial<Extraction> = {}): Extraction => ({
      ...extraction(),
      summary: { applied: 0, unchanged: 0, novo: 1, conflito: 1, invalida: 1, ignored_rows: 0, method: 'texto+ia', ai_used: true },
      items: [
        { line: 1, kind: 'novo', full_name: 'Ana Ficticia', cpf_masked: '***.***.***-25', evidence: 'Nome: Ana Ficticia CPF: [CPF removido] Função: Soldadora' },
        {
          line: 2, kind: 'conflito', full_name: 'Carla Ficticia', cpf_masked: '***.***.***-09',
          conflicts: [{ field: 'position', current: 'Soldadora', proposed: 'Eletricista' }],
          suggestions: [{ field: 'admission_date', proposed: '2021-03-10' }, { field: 'cbo_code', proposed: '715615' }],
          evidence: 'Carla Ficticia admitida em 10/03/2021',
        },
        {
          line: 3, kind: 'sugestao', full_name: 'Edu Ficticio', cpf_masked: '***.***.***-77',
          suggestions: [{ field: 'position', proposed: 'Pintor' }, { field: 'birth_date', proposed: '1990-02-03' }],
          evidence: 'Edu Ficticio, pintor, nascido em 03/02/1990',
        },
        { line: 4, kind: 'invalida', reason: 'CPF inválido' },
      ],
      ...over,
    });
    const li = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

    it('mostra Sugestões de preenchimento, tudo desmarcado, com "vazio → sugerido" e datas formatadas', () => {
      render(<RevisaoExtracaoPanel extraction={doc()} onResolved={() => {}} onCancel={() => {}} />);
      expect(screen.getByRole('region', { name: 'Revisão do documento enviado' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Sugestões de preenchimento' })).toBeTruthy();
      const edu = within(li('Edu Ficticio'));
      const boxes = edu.getAllByRole('checkbox') as HTMLInputElement[];
      expect(boxes).toHaveLength(2);
      expect(boxes.every((b) => !b.checked)).toBe(true);
      expect(edu.getAllByLabelText('Preencher campo vazio')).toHaveLength(2);
      expect(edu.getByText('Função/Cargo:').parentElement?.textContent).toMatch(/\(vazio\) →\s*sugerido Pintor/);
      expect(edu.getByText('Data de nascimento:').parentElement?.textContent).toMatch(/\(vazio\) →\s*sugerido 03\/02\/1990/);
      for (const cb of screen.getAllByRole('checkbox')) expect((cb as HTMLInputElement).checked).toBe(false);
    });

    it('conflito com suggestions mostra os dois blocos no mesmo cartão', () => {
      render(<RevisaoExtracaoPanel extraction={doc()} onResolved={() => {}} onCancel={() => {}} />);
      const carla = within(li('Carla Ficticia'));
      expect(carla.getAllByLabelText('Usar o valor do documento')).toHaveLength(1);
      expect(carla.getAllByLabelText('Preencher campo vazio')).toHaveLength(2);
      expect(carla.getByText('Soldadora')).toBeTruthy();
    });

    it('trecho do documento aparece em novo, conflito e sugestão, em elemento próprio e nomeado, sem CPF', () => {
      render(<RevisaoExtracaoPanel extraction={doc()} onResolved={() => {}} onCancel={() => {}} />);
      expect(screen.getAllByText('Trecho do documento')).toHaveLength(3);
      expect(document.querySelectorAll('blockquote[aria-labelledby]')).toHaveLength(3);
      expect(screen.getByText('Carla Ficticia admitida em 10/03/2021').tagName).toBe('BLOCKQUOTE');
      expect(screen.getByText(/CPF: \[CPF removido\]/)).toBeTruthy();
      expect(document.body.textContent).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11}/);
    });

    it('evidência de planilha (sem evidence) não cria bloco vazio', () => {
      render(<RevisaoExtracaoPanel extraction={extraction()} onResolved={() => {}} onCancel={() => {}} />);
      expect(screen.queryByText('Trecho do documento')).toBeNull();
      expect(screen.queryByText(AI)).toBeNull();
    });

    it('aviso de IA quando summary.ai_used, com aviso de cobertura parcial', () => {
      const { unmount } = render(<RevisaoExtracaoPanel extraction={doc()} onResolved={() => {}} onCancel={() => {}} />);
      expect(screen.getByText(AI)).toBeTruthy();
      expect(screen.queryByText(/cobriu só parte/)).toBeNull();
      unmount();
      render(
        <RevisaoExtracaoPanel
          extraction={doc({ summary: { ...doc().summary, ai_partial: true } })}
          onResolved={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(screen.getByText(/cobriu só parte do documento/)).toBeTruthy();
    });

    it('confirmar envia UMA decisão por novo/conflito/sugestão com a união dos campos marcados', async () => {
      const f = vi.fn(async () => resp(resolved()));
      vi.stubGlobal('fetch', f);
      render(<RevisaoExtracaoPanel extraction={doc()} onResolved={() => {}} onCancel={() => {}} />);
      const carla = within(li('Carla Ficticia'));
      fireEvent.click(carla.getAllByLabelText('Preencher campo vazio')[1]); // cbo_code
      fireEvent.click(carla.getByLabelText('Usar o valor do documento')); // position
      const edu = within(li('Edu Ficticio'));
      fireEvent.click(edu.getAllByLabelText('Preencher campo vazio')[1]); // birth_date
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
      await screen.findByText('2 aplicados, 3 ignorados.');
      expect(lastBody(f)).toEqual({
        decisions: [
          { line: 1, action: 'ignorar' },
          { line: 2, action: 'aplicar', fields: ['position', 'cbo_code'] },
          { line: 3, action: 'aplicar', fields: ['birth_date'] },
        ],
      });
    });

    it('sugestão sem campo marcado vira ignorar; desmarcar o último campo também', async () => {
      const f = vi.fn(async () => resp(resolved()));
      vi.stubGlobal('fetch', f);
      render(<RevisaoExtracaoPanel extraction={doc()} onResolved={() => {}} onCancel={() => {}} />);
      const cb = within(li('Edu Ficticio')).getAllByLabelText('Preencher campo vazio')[0];
      fireEvent.click(cb);
      fireEvent.click(cb);
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
      await screen.findByText('2 aplicados, 3 ignorados.');
      expect(lastBody(f).decisions.every((d: { action: string }) => d.action === 'ignorar')).toBe(true);
      expect(lastBody(f).decisions).toHaveLength(3);
    });

    it('conflito outra_filial com sugestões vai só como ignorar', async () => {
      const f = vi.fn(async () => resp(resolved()));
      vi.stubGlobal('fetch', f);
      const e = doc({ items: [{ line: 5, kind: 'conflito', full_name: 'Fer Ficticia', cpf_masked: '***.***.***-00', reason: 'outra_filial', evidence: 'Fer' }] });
      render(<RevisaoExtracaoPanel extraction={e} onResolved={() => {}} onCancel={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
      await screen.findByText('2 aplicados, 3 ignorados.');
      expect(lastBody(f)).toEqual({ decisions: [{ line: 5, action: 'ignorar' }] });
    });

    it('Descartar tudo ignora também as sugestões; erro 409 mantém marcações e sugere reenviar o documento', async () => {
      const f = vi.fn().mockResolvedValueOnce(resp({ message: 'Esta revisão já foi resolvida ou não está pendente' }, 409)).mockResolvedValueOnce(resp(resolved()));
      vi.stubGlobal('fetch', f);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      render(<RevisaoExtracaoPanel extraction={doc()} onResolved={() => {}} onCancel={() => {}} />);
      fireEvent.click(within(li('Edu Ficticio')).getAllByLabelText('Preencher campo vazio')[0]);
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Reenvie o documento/));
      expect((within(li('Edu Ficticio')).getAllByLabelText('Preencher campo vazio')[0] as HTMLInputElement).checked).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Descartar tudo' }));
      await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
      expect(lastBody(f).decisions).toEqual([
        { line: 1, action: 'ignorar' },
        { line: 2, action: 'ignorar' },
        { line: 3, action: 'ignorar' },
      ]);
      vi.restoreAllMocks();
    });

    it('a planilha continua com os textos da Fatia 3 (method planilha)', () => {
      const e = extraction({ summary: { ...extraction().summary, method: 'planilha', ai_used: false } });
      render(<RevisaoExtracaoPanel extraction={e} onResolved={() => {}} onCancel={() => {}} />);
      expect(screen.getByRole('region', { name: 'Revisão da planilha enviada' })).toBeTruthy();
      expect(screen.getAllByLabelText('Usar o valor da planilha')).toHaveLength(2);
    });
  });

  describe('robustez e acessibilidade (rodada 1)', () => {
    const base = (items: unknown): Extraction => ({ ...extraction(), summary: { applied: 0, unchanged: 0, novo: 1, conflito: 1, invalida: 0, ignored_rows: 0, method: 'texto' }, items: items as never });

    it('items não-array: não lança e mostra aviso em alert', () => {
      for (const items of [undefined, null, 'x', {}]) {
        const { unmount } = render(<RevisaoExtracaoPanel extraction={base(items)} onResolved={() => {}} onCancel={() => {}} />);
        expect(screen.getByRole('alert').textContent).toBe('Resposta inesperada do servidor. Atualize a página para conferir.');
        unmount();
      }
    });

    it('suggestions/conflicts null ou não-array contam como vazios', async () => {
      const f = vi.fn(async () => resp(resolved()));
      vi.stubGlobal('fetch', f);
      render(
        <RevisaoExtracaoPanel
          extraction={base([
            { line: 1, kind: 'conflito', full_name: 'A', cpf_masked: '*', conflicts: [{ field: 'position', current: 'a', proposed: 'b' }], suggestions: null },
            { line: 2, kind: 'sugestao', full_name: 'B', cpf_masked: '*', suggestions: 'x' },
            { line: 3, kind: 'conflito', full_name: 'C', cpf_masked: '*', conflicts: {} },
          ])}
          onResolved={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(screen.getAllByRole('checkbox')).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
      await screen.findByText('2 aplicados, 3 ignorados.');
      expect(lastBody(f).decisions).toEqual([
        { line: 1, action: 'ignorar' },
        { line: 3, action: 'ignorar' },
        { line: 2, action: 'ignorar' },
      ]);
    });

    it('<script>, HTML e RTL/ZWSP viram texto limpo (sem elementos injetados)', () => {
      const { container } = render(
        <RevisaoExtracaoPanel
          extraction={base([{ line: 1, kind: 'novo', full_name: '<script>alert(1)</script>\u202Ex', cpf_masked: '*', evidence: '<img src=x onerror=alert(1)>a\u200Bb\u202E' }])}
          onResolved={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(container.querySelector('script, img')).toBeNull();
      expect(container.textContent).toContain('<img src=x onerror=alert(1)>ab');
      expect(container.textContent).not.toMatch(/[\u202A-\u202E\u200B]/);
      expect(container.querySelector('blockquote')?.getAttribute('dir')).toBe('auto');
    });

    it('cada checkbox tem nome acessível específico (campo, pessoa, atual e proposto)', () => {
      render(
        <RevisaoExtracaoPanel
          extraction={base([
            { line: 1, kind: 'novo', full_name: 'Ana F', cpf_masked: '*' },
            { line: 2, kind: 'conflito', full_name: 'Bruno F', cpf_masked: '*', conflicts: [{ field: 'position', current: 'Soldador', proposed: 'Eletricista' }], suggestions: [{ field: 'admission_date', proposed: '2021-03-10' }] },
          ])}
          onResolved={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(screen.getByRole('checkbox', { name: 'Cadastrar Ana F, linha 1' })).toBeTruthy();
      expect(screen.getByRole('checkbox', { name: 'Usar o valor do documento: Função/Cargo de Bruno F, atual Soldador, documento Eletricista' })).toBeTruthy();
      expect(screen.getByRole('checkbox', { name: 'Preencher campo vazio: Data de admissão de Bruno F, atual vazio, sugerido 10/03/2021' })).toBeTruthy();
    });

    it('valor atual vazio aparece escrito como (vazio)', () => {
      render(
        <RevisaoExtracaoPanel
          extraction={base([{ line: 2, kind: 'conflito', full_name: 'B', cpf_masked: '*', conflicts: [{ field: 'position', current: '', proposed: 'Eletricista' }] }])}
          onResolved={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(screen.getByText('(vazio)')).toBeTruthy();
      expect(document.body.textContent).not.toContain('—');
    });
  });

  describe('privacidade C', () => {
    const novo = (over: object = {}, summary: object = {}): Extraction => ({
      ...extraction(),
      summary: { applied: 0, unchanged: 0, novo: 1, conflito: 0, invalida: 0, ignored_rows: 0, method: 'texto', ...summary },
      items: [{ line: 1, kind: 'novo', full_name: 'Ana Ficticia', cpf_masked: '***.***.***-25', ...over }],
    });

    it('novo com fields: lista acessível (dl/dt/dd), datas DD/MM/AAAA e aria-label com a contagem', () => {
      render(
        <RevisaoExtracaoPanel
          extraction={novo({ fields: [{ field: 'position', value: 'Soldadora' }, { field: 'admission_date', value: '2020-01-05' }, { field: 'cbo_code', value: '051210' }] })}
          onResolved={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(screen.getByText('Dados que serão cadastrados')).toBeTruthy();
      const dl = screen.getByText('Dados que serão cadastrados').parentElement?.querySelector('dl') as HTMLElement;
      expect(dl.getAttribute('aria-labelledby')).toBe('novo-fields-1');
      expect(within(dl).getByText('Função/Cargo').tagName).toBe('DT');
      expect(within(dl).getByText('Soldadora').tagName).toBe('DD');
      expect(within(dl).getByText('05/01/2020').tagName).toBe('DD');
      expect(screen.getByRole('checkbox', { name: 'Cadastrar Ana Ficticia com 3 campos, linha 1' })).toBeTruthy();
      expect(screen.queryByText('Somente nome e CPF serão cadastrados.')).toBeNull();
    });

    it('novo sem fields (ausente, vazio ou não-array) mostra "Somente nome e CPF"', () => {
      for (const fields of [undefined, [], null, 'x']) {
        const { unmount } = render(<RevisaoExtracaoPanel extraction={novo({ fields })} onResolved={() => {}} onCancel={() => {}} />);
        expect(screen.getByText('Somente nome e CPF serão cadastrados.')).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: 'Cadastrar Ana Ficticia, linha 1' })).toBeTruthy();
        unmount();
      }
    });

    it('valores hostis viram texto: script, RTL/ZWSP e 1 MB', () => {
      const huge = 'A'.repeat(1_000_000);
      const { container } = render(
        <RevisaoExtracaoPanel
          extraction={novo({ fields: [{ field: 'position', value: '<script>alert(1)</script>\u202E\u200Bx' }, { field: 'activity_description', value: huge }] })}
          onResolved={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(container.querySelector('script')).toBeNull();
      expect(screen.getByText('<script>alert(1)</script>x')).toBeTruthy();
      expect(container.querySelector('dd')?.getAttribute('dir')).toBe('auto');
      expect(container.textContent).not.toMatch(/[\u202A-\u202E\u200B]/);
      expect(container.querySelectorAll('dd')[1].textContent).toHaveLength(1_000_000);
    });

    it('expirado: só a mensagem e Fechar, sem decisões', () => {
      const onCancel = vi.fn();
      render(<RevisaoExtracaoPanel extraction={{ ...novo(), status: 'expirado' }} onResolved={() => {}} onCancel={onCancel} />);
      expect(screen.getByRole('alert').textContent).toBe('A revisão expirou. Reenvie o documento.');
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Confirmar decisões' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
      expect(onCancel).toHaveBeenCalled();
    });

    it('409 de expiração aparece em alert, mantém o painel e não sugere reenviar a planilha (PDF e planilha)', async () => {
      for (const method of ['texto', 'planilha']) {
        vi.stubGlobal('fetch', vi.fn(async () => resp({ message: 'Esta revisão expirou. Reenvie o documento.' }, 409)));
        const { unmount } = render(<RevisaoExtracaoPanel extraction={novo({}, { method })} onResolved={() => {}} onCancel={() => {}} />);
        fireEvent.click(screen.getByLabelText(/^Cadastrar Ana Ficticia/));
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisões' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Esta revisão expirou. Reenvie o documento.'));
        expect((screen.getByLabelText(/^Cadastrar Ana Ficticia/) as HTMLInputElement).checked).toBe(true);
        expect(screen.getByRole('button', { name: 'Confirmar decisões' })).toBeTruthy();
        unmount();
      }
    });

    it('aviso de IA não aparece com ai_used=false e ai_attempted=true', () => {
      render(<RevisaoExtracaoPanel extraction={novo({}, { method: 'texto', ai_used: false, ai_attempted: true })} onResolved={() => {}} onCancel={() => {}} />);
      expect(screen.queryByText(/apoio de IA/)).toBeNull();
    });
  });
});
