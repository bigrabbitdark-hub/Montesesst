import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

const RUN = `admin-dash-alertas-${Date.now()}`;

describe('GET /admin/dashboard/alertas (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let subscriptionId: string;
  const q = (text: string, params?: unknown[]) => (db as any).client.query(text, params);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Dash Alertas');
    const admin = await db.createUserWithRole('admin', 'Admin Dash Alertas');

    const plan = await q(`SELECT id FROM plans WHERE audience = 'empresa' LIMIT 1`);
    const sub = await q(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [plan.rows[0].id, tenant.tenantId, `${RUN}-preapproval`],
    );
    subscriptionId = sub.rows[0].id;

    // Cobrança pendente há 10 dias: dispara payments_pending_stale
    // independente do que já exista na base real.
    await q(
      `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
       VALUES ($1, $2, 39700, 'pending', now() - interval '10 days')`,
      [subscriptionId, `${RUN}-pendente`],
    );

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await q('DELETE FROM payment_events WHERE subscription_id = $1', [subscriptionId]);
    await q('DELETE FROM subscriptions WHERE id = $1', [subscriptionId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('exige autenticação (401 sem token)', async () => {
    const res = await request(app.getHttpServer()).get('/admin/dashboard/alertas');
    expect(res.status).toBe(401);
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/dashboard/alertas')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(res.status).toBe(403);
  });

  it('admin recebe contagem coerente com os itens', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/dashboard/alertas')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(new Date(res.body.gerado_em).toString()).not.toBe('Invalid Date');
    expect(Array.isArray(res.body.itens)).toBe(true);

    const contagem = { critico: 0, atencao: 0, info: 0 };
    for (const item of res.body.itens) {
      expect(['critico', 'atencao', 'info']).toContain(item.severidade);
      expect(typeof item.id).toBe('string');
      expect(item.titulo.length).toBeGreaterThan(0);
      expect(item.detalhe.length).toBeGreaterThan(0);
      expect(item.href.startsWith('/admin')).toBe(true);
      contagem[item.severidade as 'critico' | 'atencao' | 'info'] += 1;
    }
    expect(res.body.contagem).toEqual(contagem);
  });

  it('inclui payments_pending_stale quando há cobrança pendente com mais de 3 dias', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/dashboard/alertas')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const item = res.body.itens.find((i: any) => i.id === 'payments_pending_stale');
    expect(item).toBeDefined();
    expect(item.severidade).toBe('atencao');
    expect(item.titulo).toMatch(/cobrança(s)? pendente(s)? há mais de 3 dias/);
  });
});
