import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { FieldReportExtractor } from '../src/ai-copilot/field-report-extractor.interface';
import { MiniMaxExtractorService } from '../src/ai-copilot/minimax-extractor.service';

// Resolve a classe concreta, não o token FIELD_REPORT_EXTRACTOR — o
// provedor ativo (useClass) pode mudar (hoje é OpenRouter), mas
// MiniMaxExtractorService continua existindo e testável isoladamente,
// pronto pra reativar trocando só o `useClass` de AiCopilotModule.
describe('MiniMaxExtractorService (e2e via DI)', () => {
  let app: INestApplication;
  let extractor: FieldReportExtractor;
  let fetchSpy: jest.SpyInstance | undefined;
  const originalApiKey = process.env.MINIMAX_API_KEY;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    extractor = moduleRef.get(MiniMaxExtractorService);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    if (originalApiKey === undefined) {
      delete process.env.MINIMAX_API_KEY;
    } else {
      process.env.MINIMAX_API_KEY = originalApiKey;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('sem MINIMAX_API_KEY configurada, rejeita antes de qualquer chamada de rede', async () => {
    delete process.env.MINIMAX_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');

    await expect(extractor.extract('relato qualquer')).rejects.toThrow(
      'Copiloto de IA ainda não está disponível',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('extrai itens válidos e descarta item_key alucinado pela IA', async () => {
    process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
    const minimaxBody = {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: 'structure_checklist_items',
                  arguments: JSON.stringify({
                    items: [
                      { item_key: 'extintores', status: 'NC', notes: 'Lacre rompido, validade vencida' },
                      { item_key: 'item_inventado_pela_ia', status: 'NC', notes: 'não deve aparecer' },
                    ],
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
      .mockResolvedValue(new Response(JSON.stringify(minimaxBody), { status: 200 }));

    const result = await extractor.extract('Extintor com lacre rompido e vencido.');

    expect(result).toEqual([
      { item_key: 'extintores', status: 'NC', notes: 'Lacre rompido, validade vencida' },
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.minimax.io/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );

    const [, requestInit] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse((requestInit as RequestInit).body as string);
    expect(sentBody.model).toBe('MiniMax-M3');
    expect(sentBody.max_tokens).toBe(1024);
    expect(sentBody.tools[0].function.name).toBe('structure_checklist_items');
    expect(sentBody.tool_choice).toEqual({ type: 'function', function: { name: 'structure_checklist_items' } });
    expect((requestInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer chave-de-teste-fake' });
  });

  it('propaga erro HTTP do MiniMax como 502', async () => {
    process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('erro interno', { status: 500 }));

    await expect(extractor.extract('relato qualquer')).rejects.toThrow(
      'Não foi possível gerar o rascunho agora',
    );
  });

  it('propaga falha de rede como 502', async () => {
    process.env.MINIMAX_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(extractor.extract('relato qualquer')).rejects.toThrow(
      'Não foi possível gerar o rascunho agora',
    );
  });
});
