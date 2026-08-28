import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FieldReportExtractor } from '../src/ai-copilot/field-report-extractor.interface';
import { OpenRouterExtractorService } from '../src/ai-copilot/openrouter-extractor.service';
import { TestDb } from './db-test-helper';

// OpenRouterExtractorService é o provedor ATIVO hoje (ver AiCopilotModule)
// — além dos testes isolados via DI (mock de fetch, sem chamada real),
// este arquivo também prova via HTTP real que o endpoint devolve 503
// quando OPENROUTER_API_KEY não está configurada, já que esse é
// literalmente o comportamento que roda em produção sempre que a chave
// não existir.
describe('OpenRouterExtractorService (e2e via DI)', () => {
  let app: INestApplication;
  let extractor: FieldReportExtractor;
  let fetchSpy: jest.SpyInstance | undefined;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  let db: TestDb;
  let tenantId: string;
  let technicianId: string;
  let technicianToken: string;
  let inspectionId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    extractor = moduleRef.get(OpenRouterExtractorService);

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa OpenRouter Extractor Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico OpenRouter Extractor Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-28' });
    inspectionId = createRes.body.id;
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
    await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [inspectionId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('sem OPENROUTER_API_KEY configurada, rejeita antes de qualquer chamada de rede', async () => {
    delete process.env.OPENROUTER_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');

    await expect(extractor.extract('relato qualquer')).rejects.toThrow(
      'Copiloto de IA ainda não está disponível',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('extrai itens válidos e descarta item_key alucinado pela IA', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    const openRouterBody = {
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
      .mockResolvedValue(new Response(JSON.stringify(openRouterBody), { status: 200 }));

    const result = await extractor.extract('Extintor com lacre rompido e vencido.');

    expect(result).toEqual([
      { item_key: 'extintores', status: 'NC', notes: 'Lacre rompido, validade vencida' },
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );

    const [, requestInit] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse((requestInit as RequestInit).body as string);
    expect(sentBody.model).toBe('anthropic/claude-sonnet-5');
    expect(sentBody.max_tokens).toBe(1024);
    expect(sentBody.tools[0].function.name).toBe('structure_checklist_items');
    expect(sentBody.tool_choice).toEqual({ type: 'function', function: { name: 'structure_checklist_items' } });
    expect((requestInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer chave-de-teste-fake',
      'HTTP-Referer': 'https://montesesst.com.br',
      'X-Title': 'Montese SST - Copiloto de IA',
    });
  });

  it('propaga erro HTTP do OpenRouter como 502', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('erro interno', { status: 500 }));

    await expect(extractor.extract('relato qualquer')).rejects.toThrow(
      'Não foi possível gerar o rascunho agora',
    );
  });

  it('propaga falha de rede como 502', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(extractor.extract('relato qualquer')).rejects.toThrow(
      'Não foi possível gerar o rascunho agora',
    );
  });

  it('endpoint HTTP real devolve 503 sem OPENROUTER_API_KEY configurada (comportamento em producao sem chave)', async () => {
    delete process.env.OPENROUTER_API_KEY;

    const res = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/ai-draft`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ report_text: 'relato qualquer' });

    expect(res.status).toBe(503);
  });
});
