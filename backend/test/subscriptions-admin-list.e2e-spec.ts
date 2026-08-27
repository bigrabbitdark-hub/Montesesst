import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /subscriptions e GET /subscriptions/:id/payment-events (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let planId: string;
  let subscriptionId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Subscriptions List');
    const admin = await db.createUserWithRole('admin', 'Admin Subscriptions List');

    const planResult = await (db as any).client.query(
      `SELECT id FROM plans WHERE audience = 'empresa' LIMIT 1`,
    );
    planId = planResult.rows[0].id;

    const subResult = await (db as any).client.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [planId, tenant.tenantId, `preapproval-list-test-${Date.now()}`],
    );
    subscriptionId = subResult.rows[0].id;

    await (db as any).client.query(
      `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
       VALUES ($1, $2, 39700, 'approved', now())`,
      [subscriptionId, `payment-list-test-${Date.now()}`],
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
    await (db as any).client.query('DELETE FROM payment_events WHERE subscription_id = $1', [
      subscriptionId,
    ]);
    await (db as any).client.query('DELETE FROM subscriptions WHERE id = $1', [subscriptionId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('admin lista assinaturas com plano e empresa/tecnico agregados', async () => {
    const res = await request(app.getHttpServer())
      .get('/subscriptions')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const found = res.body.find((s: any) => s.id === subscriptionId);
    expect(found).toBeDefined();
    expect(found.tenant_name).toBeDefined();
    expect(found.plan_name).toBeDefined();
    expect(found.status).toBe('authorized');
  });

  it('bloqueia empresa com 403 em GET /subscriptions', async () => {
    const res = await request(app.getHttpServer())
      .get('/subscriptions')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(res.status).toBe(403);
  });

  it('admin ve o historico de pagamento da assinatura', async () => {
    const res = await request(app.getHttpServer())
      .get(`/subscriptions/${subscriptionId}/payment-events`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].amount_cents).toBe(39700);
    expect(res.body[0].status).toBe('approved');
  });

  it('bloqueia empresa com 403 em GET /subscriptions/:id/payment-events', async () => {
    const res = await request(app.getHttpServer())
      .get(`/subscriptions/${subscriptionId}/payment-events`)
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(res.status).toBe(403);
  });
});
