import { BadGatewayException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MiniMaxNormativeAnswerService } from '../src/normative/minimax-normative-answer.service';
import { AiUsageLogService } from '../src/common/ai-usage/ai-usage-log.service';

describe('MiniMaxNormativeAnswerService', () => {
  let service: MiniMaxNormativeAnswerService;
  let fetchSpy: jest.SpyInstance | undefined;
  let warnSpy: jest.SpyInstance | undefined;
  let errorSpy: jest.SpyInstance | undefined;
  let nowSpy: jest.SpyInstance | undefined;
  let timeoutSpy: jest.SpyInstance | undefined;
  const originalApiKey = process.env.MINIMAX_API_KEY;
  const usageLogStub = { log: jest.fn() } as any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [MiniMaxNormativeAnswerService, { provide: AiUsageLogService, useValue: usageLogStub }],
    }).compile();
    service = moduleRef.get(MiniMaxNormativeAnswerService);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    warnSpy?.mockRestore();
    warnSpy = undefined;
    errorSpy?.mockRestore();
    errorSpy = undefined;
    nowSpy?.mockRestore();
    nowSpy = undefined;
    timeoutSpy?.mockRestore();
    timeoutSpy = undefined;
    usageLogStub.log.mockClear();
    if (originalApiKey === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = originalApiKey;
  });

  function fakeToolCallResponse(items: unknown[], usage?: Record<string, number>): Response {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'answer_with_citations',
                    arguments: JSON.stringify({ items }),
                  },
                },
              ],
            },
          },
        ],
        usage,
      }),
      { status: 200 },
    );
  }

  // Tool call cortado em '{"items": ' (JSON.parse falha) — o caso "malformado" medido em produção.
  function fakeInvalidToolCallResponse(completionTokens = 4096): Response {
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'length',
            message: {
              tool_calls: [{ function: { name: 'answer_with_citations', arguments: '{"items": ' } }],
            },
          },
        ],
        usage: { prompt_tokens: 500, completion_tokens: completionTokens, total_tokens: 500 + completionTokens },
      }),
      { status: 200 },
    );
  }

  const validClaim = {
    claim: 'Afirmação da 2ª tentativa.',
    chunk_ids: ['c1'],
    operational_ref_ids: [],
    company_chunk_ids: [],
    checklist_ref_ids: [],
    uses_attachment: false,
  };

  // Uma Response NOVA por chamada de fetch (o corpo só pode ser lido uma vez). Se o
  // código chamar mais vezes do que as fábricas listadas, repete a última — assim uma
  // 3ª tentativa indevida aparece na contagem de fetch, nunca vaza para a rede real.
  function mockFetchSequence(...factories: Array<() => Response>): jest.SpyInstance {
    let call = 0;
    return jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => factories[Math.min(call++, factories.length - 1)]());
  }

  it('sem MINIMAX_API_KEY, rejeita antes de qualquer chamada de rede', async () => {
    delete process.env.MINIMAX_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');

    await expect(service.answer('pergunta', [], [], [], [])).rejects.toThrow(
      'Assistente ainda não está disponível',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('mantém a claim sem checklist_ref_ids, normalizando o campo ausente para []', async () => {
    process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
    // Uma Response nova por chamada — o corpo de uma Response só pode ser lido
    // uma vez (um bug de reuso do corpo já apareceu antes neste projeto).
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () =>
      fakeToolCallResponse([
        {
          claim: 'Sem checklist_ref_ids — deve sobreviver com [].',
          chunk_ids: ['c1'],
          operational_ref_ids: [],
          company_chunk_ids: [],
          uses_attachment: false,
        },
      ]),
    );

    const result = await service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], []);

    expect(result).toEqual([
      {
        claim: 'Sem checklist_ref_ids — deve sobreviver com [].',
        chunk_ids: ['c1'],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: [],
        uses_attachment: false,
      },
    ]);
  });

  it('tool call truncado (finish_reason=length): devolve [] e avisa no log só com metadados, sem o texto da pergunta', async () => {
    process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // Modelo de raciocínio que estourou o max_tokens: o tool call vem cortado
    // em '{"items": ' e o JSON.parse falha. Toda resposta é inválida, então o
    // provedor repete uma vez (aviso da repetição) e depois cai no aviso final.
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'length',
                message: {
                  tool_calls: [{ function: { name: 'answer_with_citations', arguments: '{"items": ' } }],
                },
              },
            ],
            usage: { prompt_tokens: 500, completion_tokens: 1024, total_tokens: 1524 },
          }),
          { status: 200 },
        ),
    );

    const result = await service.answer('pergunta sigilosa da empresa Acme', [{ id: 'c1', content: 'trecho' }], [], [], []);

    expect(result).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    const messages = warnSpy.mock.calls.map((call) => String(call[0]));
    // O aviso final (o mesmo de antes da repetição) é o último.
    const finalMessage = messages[1];
    expect(finalMessage).toContain('sem tool call parseável');
    expect(finalMessage).toContain('finish_reason=length');
    expect(finalMessage).toContain('completion_tokens=1024');
    // LGPD: só metadados — nunca a pergunta nem parte da resposta do modelo (vale para os dois avisos).
    for (const message of messages) {
      expect(message).not.toContain('sigilosa');
      expect(message).not.toContain('Acme');
      expect(message).not.toContain('items');
    }
  });

  it('tool call válido com items: [] (o modelo não achou o que citar) devolve [] SEM avisar — vazio legítimo não é falha', async () => {
    process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => fakeToolCallResponse([]));

    const result = await service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], []);

    expect(result).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('descarta claim sem uses_attachment e claim sem o texto claim (os demais campos seguem estritos)', async () => {
    process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () =>
      fakeToolCallResponse([
        {
          claim: 'Afirmação válida.',
          chunk_ids: ['c1'],
          operational_ref_ids: [],
          company_chunk_ids: [],
          checklist_ref_ids: [],
          uses_attachment: false,
        },
        {
          claim: 'Sem uses_attachment — deve ser descartada.',
          chunk_ids: ['c1'],
          operational_ref_ids: [],
          company_chunk_ids: [],
          checklist_ref_ids: [],
        },
        {
          chunk_ids: ['c1'],
          operational_ref_ids: [],
          company_chunk_ids: [],
          checklist_ref_ids: [],
          uses_attachment: false,
        },
      ]),
    );

    const result = await service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], []);

    expect(result).toEqual([
      {
        claim: 'Afirmação válida.',
        chunk_ids: ['c1'],
        operational_ref_ids: [],
        company_chunk_ids: [],
        checklist_ref_ids: [],
        uses_attachment: false,
      },
    ]);
  });

  describe('repetição única quando o tool call vem inválido', () => {
    it('(a) 1ª resposta com tool call inválido e 2ª válida: devolve a claim, fetch 2x, aviso da repetição 1x sem o texto da pergunta, usageLog 2x', async () => {
      process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      fetchSpy = mockFetchSequence(
        () => fakeInvalidToolCallResponse(4096),
        () => fakeToolCallResponse([validClaim], { prompt_tokens: 500, completion_tokens: 900, total_tokens: 1400 }),
      );

      const result = await service.answer('pergunta sigilosa da empresa Acme', [{ id: 'c1', content: 'trecho' }], [], [], []);

      expect(result).toEqual([validClaim]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = String(warnSpy.mock.calls[0][0]);
      expect(message).toContain('repetindo uma vez');
      expect(message).toContain('finish_reason=length');
      expect(message).toContain('completion_tokens=4096');
      // LGPD: só metadados — nunca a pergunta nem parte da resposta do modelo.
      expect(message).not.toContain('sigilosa');
      expect(message).not.toContain('Acme');
      expect(message).not.toContain('items');
      // As duas tentativas custam tokens — as duas entram no log de uso.
      expect(usageLogStub.log).toHaveBeenCalledTimes(2);
    });

    it('(b) as duas respostas inválidas: devolve [], fetch 2x (nunca 3) e emite o aviso existente de "sem tool call parseável"', async () => {
      process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      fetchSpy = mockFetchSequence(() => fakeInvalidToolCallResponse(4096), () => fakeInvalidToolCallResponse(4096));

      const result = await service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], []);

      expect(result).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const messages = warnSpy.mock.calls.map((call) => String(call[0]));
      expect(messages.filter((m) => m.includes('repetindo uma vez'))).toHaveLength(1);
      expect(messages.filter((m) => m.includes('resposta do provedor sem tool call parseável'))).toHaveLength(1);
      expect(usageLogStub.log).toHaveBeenCalledTimes(2);
    });

    it('(c) 1ª resposta válida: fetch 1x e nenhum aviso', async () => {
      process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      fetchSpy = mockFetchSequence(() => fakeToolCallResponse([validClaim]));

      const result = await service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], []);

      expect(result).toEqual([validClaim]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('(d) tool call válido com items: [] não repete: fetch 1x e devolve []', async () => {
      process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      fetchSpy = mockFetchSequence(() => fakeToolCallResponse([]));

      const result = await service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], []);

      expect(result).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    // Relógio simulado que o PRÓPRIO fetch mockado avança: a 1ª tentativa "demora" o
    // quanto a fábrica somar. Assim o teste só passa se `started` for lido ANTES da
    // 1ª requisição — se fosse lido depois, o tempo decorrido viraria 0, a guarda de
    // 45 s ficaria morta (sempre repetiria) e estes casos falhariam.
    function useSimulatedClock(): { advance: (ms: number) => void } {
      let clock = 0;
      nowSpy = jest.spyOn(service as any, 'now').mockImplementation(() => clock);
      return { advance: (ms: number) => (clock += ms) };
    }

    it.each([46_000, 45_000])(
      '(e) 1ª tentativa inválida que levou %i ms (>= 45 s) NÃO repete: fetch 1x, [] e só o aviso final',
      async (elapsedMs) => {
        process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
        warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        const relogio = useSimulatedClock();
        fetchSpy = mockFetchSequence(() => {
          relogio.advance(elapsedMs);
          return fakeInvalidToolCallResponse(4096);
        });

        const result = await service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], []);

        expect(result).toEqual([]);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const message = String(warnSpy.mock.calls[0][0]);
        expect(message).toContain('resposta do provedor sem tool call parseável');
        expect(message).not.toContain('repetindo uma vez');
      },
    );

    it('(e2) 1ª tentativa inválida que levou 44_999 ms (logo abaixo do limite) repete: fetch 2x e devolve a claim da 2ª', async () => {
      process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const relogio = useSimulatedClock();
      fetchSpy = mockFetchSequence(
        () => {
          relogio.advance(44_999);
          return fakeInvalidToolCallResponse(4096);
        },
        () => fakeToolCallResponse([validClaim]),
      );

      const result = await service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], []);

      expect(result).toEqual([validClaim]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0][0])).toContain('repetindo uma vez');
    });

    it('(g) o timeout é POR TENTATIVA: no cenário da repetição, AbortSignal.timeout é chamado 2x, ambas com 75_000 ms', async () => {
      process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      // Sinal que nunca aborta e não agenda timer real (o fetch está mockado).
      timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => new AbortController().signal);
      fetchSpy = mockFetchSequence(
        () => fakeInvalidToolCallResponse(4096),
        () => fakeToolCallResponse([validClaim]),
      );

      const result = await service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], []);

      expect(result).toEqual([validClaim]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(timeoutSpy.mock.calls).toEqual([[75_000], [75_000]]);
    });

    it('(f) falha de rede: lança BadGatewayException e fetch 1x (sem repetição)', async () => {
      process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
      errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => {
        throw new TypeError('fetch failed');
      });

      await expect(service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], [])).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('(f) resposta HTTP 500: lança BadGatewayException e fetch 1x (sem repetição)', async () => {
      process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
      errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      fetchSpy = mockFetchSequence(() => new Response('erro interno', { status: 500 }));

      await expect(service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], [])).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
