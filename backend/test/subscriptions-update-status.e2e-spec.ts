import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { TestDb } from './db-test-helper';

describe('PATCH /subscriptions/:id/status (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let tenantId: string;
  let planId: string;
  let subscriptionId: string;
  let preapprovalId: string;
  const fakeMercadoPago = { updatePreapprovalStatus: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue(fakeMercadoPago)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Subscription Status Teste');
    tenantId = tenant.tenantId;
    const admin = await db.createUserWithRole('admin', 'Admin Subscription Status Teste');

    const planResult = await (db as any).client.query(
      `SELECT id FROM plans WHERE audience = 'empresa' LIMIT 1`,
    );
    planId = planResult.rows[0].id;

    preapprovalId = `preapproval-status-teste-${Date.now()}`;
    const subResult = await (db as any).client.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [planId, tenantId, preapprovalId],
    );
    subscriptionId = subResult.rows[0].id;

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
    await (db as any).client.query('DELETE FROM subscriptions WHERE id = $1', [subscriptionId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('admin pausa a assinatura — status confirmado pelo Mercado Pago é o que é persistido', async () => {
    fakeMercadoPago.updatePreapprovalStatus.mockResolvedValueOnce({
      id: preapprovalId,
      status: 'paused',
    });

    const res = await request(app.getHttpServer())
      .patch(`/subscriptions/${subscriptionId}/status`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ status: 'paused' });

    expect(res.status).toBe(200);
    expect(fakeMercadoPago.updatePreapprovalStatus).toHaveBeenCalledWith(preapprovalId, 'paused');
    expect(res.body.status).toBe('paused');

    const row = await (db as any).client.query('SELECT status FROM subscriptions WHERE id = $1', [
      subscriptionId,
    ]);
    expect(row.rows[0].status).toBe('paused');
  });

  it('admin reativa a assinatura pausada', async () => {
    fakeMercadoPago.updatePreapprovalStatus.mockResolvedValueOnce({
      id: preapprovalId,
      status: 'authorized',
    });

    const res = await request(app.getHttpServer())
      .patch(`/subscriptions/${subscriptionId}/status`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ status: 'authorized' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('authorized');
  });

  it('admin cancela a assinatura', async () => {
    fakeMercadoPago.updatePreapprovalStatus.mockResolvedValueOnce({
      id: preapprovalId,
      status: 'cancelled',
    });

    const res = await request(app.getHttpServer())
      .patch(`/subscriptions/${subscriptionId}/status`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ status: 'cancelled' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');

    const row = await (db as any).client.query('SELECT status FROM subscriptions WHERE id = $1', [
      subscriptionId,
    ]);
    expect(row.rows[0].status).toBe('cancelled');
  });

  it('rejeita status fora da allowlist', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/subscriptions/${subscriptionId}/status`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ status: 'inventado' });

    expect(res.status).toBe(400);
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/subscriptions/${subscriptionId}/status`)
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ status: 'cancelled' });

    expect(res.status).toBe(403);
  });
});
