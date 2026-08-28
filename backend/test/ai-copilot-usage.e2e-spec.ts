import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /ai-copilot/usage (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let fetchSpy: jest.SpyInstance | undefined;
  const originalApiKey = process.env.OPENROUTER_API_KEY;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin AI Usage Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const tenant = await db.createTenantWithUser('Empresa AI Usage Teste');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;
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
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/ai-copilot/usage')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(res.status).toBe(403);
  });

  it('sem OPENROUTER_API_KEY, devolve configured: false sem chamar rede', async () => {
    delete process.env.OPENROUTER_API_KEY;
    fetchSpy = jest.spyOn(global, 'fetch');

    const res = await request(app.getHttpServer())
      .get('/ai-copilot/usage')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      configured: false,
      provider: 'openrouter',
      dashboard_url: 'https://openrouter.ai/settings/credits',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('com chave configurada, devolve saldo/uso reais da resposta do OpenRouter', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/credits')) {
        return new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 0.5 } }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          data: { is_free_tier: false, usage_daily: 0.1, usage_weekly: 0.3, usage_monthly: 0.5 },
        }),
        { status: 200 },
      );
    });

    const res = await request(app.getHttpServer())
      .get('/ai-copilot/usage')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      configured: true,
      provider: 'openrouter',
      is_free_tier: false,
      total_credits: 10,
      total_usage: 0.5,
      usage_daily: 0.1,
      usage_weekly: 0.3,
      usage_monthly: 0.5,
      low_balance_warning: false,
      dashboard_url: 'https://openrouter.ai/settings/credits',
    });
  });

  it('conta free tier com 0 créditos comprados dispara low_balance_warning', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/credits')) {
        return new Response(JSON.stringify({ data: { total_credits: 0, total_usage: 0.01 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { is_free_tier: true } }), { status: 200 });
    });

    const res = await request(app.getHttpServer())
      .get('/ai-copilot/usage')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body.low_balance_warning).toBe(true);
  });

  it('erro HTTP do OpenRouter devolve configured: true com mensagem de erro, sem quebrar', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-de-teste-fake';
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('erro', { status: 500 }));

    const res = await request(app.getHttpServer())
      .get('/ai-copilot/usage')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.error).toBeDefined();
  });
});
