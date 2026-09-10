import { Test } from '@nestjs/testing';
import { OpenRouterEmbeddingService } from '../src/common/embedding/openrouter-embedding.service';

describe('OpenRouterEmbeddingService', () => {
  let service: OpenRouterEmbeddingService;
  let fetchSpy: jest.SpyInstance | undefined;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_EMBEDDING_MODEL;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [OpenRouterEmbeddingService],
    }).compile();
    service = moduleRef.get(OpenRouterEmbeddingService);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.OPENROUTER_EMBEDDING_MODEL;
    else process.env.OPENROUTER_EMBEDDING_MODEL = originalModel;
  });

  it('sem OPENROUTER_API_KEY, rejeita antes de qualquer chamada de rede', async () => {
    delete process.env.OPENROUTER_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');

    await expect(service.embed('texto qualquer')).rejects.toThrow(
      'Assistente ainda não está disponível',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('chama o endpoint de embeddings com o modelo configurado e devolve o vetor', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    process.env.OPENROUTER_EMBEDDING_MODEL = 'openai/text-embedding-3-small';
    const fakeEmbedding = [0.1, 0.2, 0.3];
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: fakeEmbedding }] }), { status: 200 }),
    );

    const result = await service.embed('o que é NR-06?');

    expect(result).toEqual(fakeEmbedding);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/embeddings',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, requestInit] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse((requestInit as RequestInit).body as string);
    expect(sentBody.model).toBe('openai/text-embedding-3-small');
    expect(sentBody.input).toBe('o que é NR-06?');
    expect((requestInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer chave-de-teste-fake',
    });
  });

  it('usa o modelo default quando OPENROUTER_EMBEDDING_MODEL não está configurada', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    delete process.env.OPENROUTER_EMBEDDING_MODEL;
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 }),
    );

    await service.embed('texto');

    const [, requestInit] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse((requestInit as RequestInit).body as string);
    expect(sentBody.model).toBe('openai/text-embedding-3-small');
  });

  it('propaga erro HTTP do OpenRouter como 502', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('erro', { status: 500 }));

    await expect(service.embed('texto')).rejects.toThrow('Não foi possível gerar o embedding agora');
  });

  it('propaga falha de rede como 502', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.embed('texto')).rejects.toThrow('Não foi possível gerar o embedding agora');
  });
});
