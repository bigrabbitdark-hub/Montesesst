import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { OpenRouterAtaExtractorService } from '../src/cipa/ata-ai/openrouter-ata-extractor.service';

describe('OpenRouterAtaExtractorService (e2e via DI)', () => {
  let app: INestApplication;
  let extractor: OpenRouterAtaExtractorService;
  let fetchSpy: jest.SpyInstance | undefined;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    extractor = moduleRef.get(OpenRouterAtaExtractorService);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('sem OPENROUTER_API_KEY configurada, rejeita antes de qualquer chamada de rede', async () => {
    delete process.env.OPENROUTER_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');

    await expect(extractor.extract('transcrição qualquer')).rejects.toThrow(
      'Geração de rascunho de ata ainda não está disponível',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('extrai os 3 campos e preenche string vazia pro que a IA omitir', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    const openrouterBody = {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: 'structure_ata_fields',
                  arguments: JSON.stringify({
                    pauta: 'Uso de EPI no setor de produção',
                    discussoes: 'Discutido reposição de luvas danificadas',
                    // deliberacoes omitida de propósito — deve virar ''
                  }),
                },
              },
            ],
          },
        },
      ],
    };
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(openrouterBody), { status: 200 }));

    const result = await extractor.extract('Reunião sobre uso de EPI...');

    expect(result).toEqual({
      pauta: 'Uso de EPI no setor de produção',
      discussoes: 'Discutido reposição de luvas danificadas',
      deliberacoes: '',
    });
    const [, requestInit] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse((requestInit as RequestInit).body as string);
    expect(sentBody.max_tokens).toBe(2048);
    expect(sentBody.tools[0].function.name).toBe('structure_ata_fields');
  });

  it('propaga erro HTTP do OpenRouter como 502', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('erro interno', { status: 500 }));

    await expect(extractor.extract('transcrição qualquer')).rejects.toThrow(
      'Não foi possível gerar o rascunho da ata agora',
    );
  });
});
