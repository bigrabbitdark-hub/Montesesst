import { OpenRouterNormativeAnswerService } from '../src/normative/openrouter-normative-answer.service';

// Achado da auditoria do Assistente (2026-09-28, item 015): o MiniMax
// (provedor ativo) repete a chamada uma vez quando o tool call vem
// ausente/inválido (ver minimax-normative-answer.service.ts); o fallback
// OpenRouter não tinha nenhum retry — se reativado, regrediria em
// silêncio. Este teste prova a paridade antes de qualquer reativação.
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const VALID_TOOL_CALL_BODY = {
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify({
                items: [
                  {
                    claim: 'Afirmação válida.',
                    chunk_ids: ['c1'],
                    operational_ref_ids: [],
                    company_chunk_ids: [],
                    checklist_ref_ids: [],
                    uses_attachment: false,
                  },
                ],
              }),
            },
          },
        ],
      },
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    },
  ],
};

// Sem tool_calls — o mesmo formato que um modelo devolve quando o tool
// call vem ausente/truncado (parseRagToolCall retorna null pra isto).
const INVALID_TOOL_CALL_BODY = {
  choices: [{ finish_reason: 'stop', message: {}, usage: { completion_tokens: 900 } }],
};

describe('OpenRouterNormativeAnswerService — retry em tool call inválido (unit)', () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'sk-or-fake-key-for-unit-test';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENROUTER_API_KEY = originalApiKey;
    jest.restoreAllMocks();
  });

  it('repete a chamada uma vez quando a 1ª resposta vem sem tool call parseável, e devolve os itens da 2ª tentativa', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(INVALID_TOOL_CALL_BODY))
      .mockResolvedValueOnce(jsonResponse(VALID_TOOL_CALL_BODY));
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new OpenRouterNormativeAnswerService();
    const claims = await service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], []);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(claims).toHaveLength(1);
    expect(claims[0].claim).toBe('Afirmação válida.');
  });

  it('sem retry disponível, 2 tentativas inválidas em seguida devolvem lista vazia (nunca lança, nunca inventa)', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(INVALID_TOOL_CALL_BODY))
      .mockResolvedValueOnce(jsonResponse(INVALID_TOOL_CALL_BODY));
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new OpenRouterNormativeAnswerService();
    const claims = await service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], []);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(claims).toEqual([]);
  });

  it('tool call válido de primeira NÃO gera uma 2ª chamada (não gasta o dobro à toa)', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(jsonResponse(VALID_TOOL_CALL_BODY));
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new OpenRouterNormativeAnswerService();
    const claims = await service.answer('pergunta', [{ id: 'c1', content: 'trecho' }], [], [], []);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(claims).toHaveLength(1);
  });
});
