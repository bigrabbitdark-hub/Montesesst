import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MiniMaxNormativeAnswerService } from '../src/normative/minimax-normative-answer.service';
import { AiUsageLogService } from '../src/common/ai-usage/ai-usage-log.service';

describe('MiniMaxNormativeAnswerService', () => {
  let service: MiniMaxNormativeAnswerService;
  let fetchSpy: jest.SpyInstance | undefined;
  let warnSpy: jest.SpyInstance | undefined;
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
    usageLogStub.log.mockClear();
    if (originalApiKey === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = originalApiKey;
  });

  function fakeToolCallResponse(items: unknown[]): Response {
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
      }),
      { status: 200 },
    );
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
    // em '{"items": ' e o JSON.parse falha.
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
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toContain('finish_reason=length');
    expect(message).toContain('completion_tokens=1024');
    // LGPD: só metadados — nunca a pergunta nem parte da resposta do modelo.
    expect(message).not.toContain('sigilosa');
    expect(message).not.toContain('Acme');
    expect(message).not.toContain('items');
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
});
