import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /admin/ai-usage (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let adminToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin AiUsage Teste');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    adminToken = loginRes.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  async function insertUsageRow(capability: string, promptTokens: number, completionTokens: number): Promise<void> {
    await (db as any).client.query(
      `INSERT INTO minimax_usage_log (capability, prompt_tokens, completion_tokens, total_tokens)
       VALUES ($1, $2, $3, $4)`,
      [capability, promptTokens, completionTokens, promptTokens + completionTokens],
    );
  }

  async function cleanupUsageRows(): Promise<void> {
    await (db as any).client.query(`DELETE FROM minimax_usage_log WHERE capability LIKE 'teste_%'`);
  }

  afterEach(async () => {
    await cleanupUsageRows();
  });

  it('bloqueia role sem permissão (tecnico) com 403', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico AiUsage Teste');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });

    const res = await request(app.getHttpServer())
      .get('/admin/ai-usage')
      .set('Authorization', `Bearer ${loginRes.body.access_token}`);

    expect(res.status).toBe(403);
  });

  it('agrega chamadas reais por capability e soma tokens corretamente', async () => {
    await insertUsageRow('teste_assistant_normative_query', 100, 50);
    await insertUsageRow('teste_assistant_normative_query', 200, 80);
    await insertUsageRow('teste_document_classify', 30, 10);

    const res = await request(app.getHttpServer())
      .get('/admin/ai-usage')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const assistantRow = res.body.by_capability.find(
      (row: any) => row.capability === 'teste_assistant_normative_query',
    );
    expect(assistantRow).toEqual({
      capability: 'teste_assistant_normative_query',
      calls: 2,
      prompt_tokens: 300,
      completion_tokens: 130,
      total_tokens: 430,
    });
    const classifyRow = res.body.by_capability.find((row: any) => row.capability === 'teste_document_classify');
    expect(classifyRow).toEqual({
      capability: 'teste_document_classify',
      calls: 1,
      prompt_tokens: 30,
      completion_tokens: 10,
      total_tokens: 40,
    });
    expect(res.body.total_calls).toBeGreaterThanOrEqual(3);
    expect(res.body.total_tokens).toBeGreaterThanOrEqual(470);
    expect(Array.isArray(res.body.last_7_days)).toBe(true);
  });

  it('sem nenhum registro, devolve zeros e listas vazias (não quebra)', async () => {
    await cleanupUsageRows();
    const res = await request(app.getHttpServer())
      .get('/admin/ai-usage')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.total_calls).toBe('number');
    expect(typeof res.body.total_tokens).toBe('number');
    expect(Array.isArray(res.body.by_capability)).toBe(true);
    expect(Array.isArray(res.body.last_7_days)).toBe(true);
  });
});
