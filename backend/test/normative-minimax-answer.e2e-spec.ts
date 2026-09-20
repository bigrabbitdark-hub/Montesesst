import { Test } from '@nestjs/testing';
import { MiniMaxNormativeAnswerService } from '../src/normative/minimax-normative-answer.service';
import { AiUsageLogService } from '../src/common/ai-usage/ai-usage-log.service';

describe('MiniMaxNormativeAnswerService', () => {
  let service: MiniMaxNormativeAnswerService;
  let fetchSpy: jest.SpyInstance | undefined;
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
