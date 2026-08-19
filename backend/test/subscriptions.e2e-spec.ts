import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { TestDb, TestTenantFixture, TestUserFixture } from './db-test-helper';

const SUPERUSER_URL = process.env.TEST_SUPERUSER_DATABASE_URL as string;

describe('POST /subscriptions (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let rawDb: Client;
  let tenant: TestTenantFixture;
  let technician: TestUserFixture;
  let empresaToken: string;
  let tecnicoToken: string;
  let empresaPlanId: string;
  let tecnicoPlanId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    tenant = await db.createTenantWithUser('Empresa Assinatura');
    technician = await db.createUserWithRole('tecnico', 'Técnico Assinatura');

    rawDb = new Client({ connectionString: SUPERUSER_URL });
    await rawDb.connect();
    const plansResult = await rawDb.query(
      `SELECT id, audience FROM plans WHERE slug IN ('empresa-start', 'tecnico-start')`,
    );
    empresaPlanId = plansResult.rows.find((r) => r.audience === 'empresa').id;
    tecnicoPlanId = plansResult.rows.find((r) => r.audience === 'tecnico').id;

    const empresaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = empresaLogin.body.access_token;

    const tecnicoLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: technician.email, password: technician.password });
    tecnicoToken = tecnicoLogin.body.access_token;
  });

  afterAll(async () => {
    await rawDb.query('DELETE FROM subscriptions WHERE tenant_id = $1 OR technician_user_id = $2', [
      tenant.tenantId,
      technician.userId,
    ]);
    await rawDb.end();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa assina um plano de empresa e recebe a URL de checkout real do Mercado Pago', async () => {
    const res = await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ plan_id: empresaPlanId });

    expect(res.status).toBe(201);
    expect(res.body.initPoint).toContain('mercadopago.com');

    const row = await rawDb.query('SELECT status, tenant_id FROM subscriptions WHERE plan_id = $1 AND tenant_id = $2', [
      empresaPlanId,
      tenant.tenantId,
    ]);
    expect(row.rows[0]).toMatchObject({ status: 'pending', tenant_id: tenant.tenantId });
  });

  it('técnico assina um plano de técnico e recebe a URL de checkout real do Mercado Pago', async () => {
    const res = await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${tecnicoToken}`)
      .send({ plan_id: tecnicoPlanId });

    expect(res.status).toBe(201);
    expect(res.body.initPoint).toContain('mercadopago.com');
  });

  it('rejeita empresa tentando assinar plano de técnico com 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/subscriptions')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ plan_id: tecnicoPlanId });

    expect(res.status).toBe(400);
  });

  it('rejeita sem autenticação com 401', async () => {
    const res = await request(app.getHttpServer()).post('/subscriptions').send({ plan_id: empresaPlanId });
    expect(res.status).toBe(401);
  });
});
