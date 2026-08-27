import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('PATCH /plans/:id (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let planId: string;
  let originalPriceCents: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Plans Teste');
    const admin = await db.createUserWithRole('admin', 'Admin Plans Teste');

    const planResult = await (db as any).client.query(
      `SELECT id, price_cents FROM plans WHERE audience = 'empresa' LIMIT 1`,
    );
    planId = planResult.rows[0].id;
    originalPriceCents = planResult.rows[0].price_cents;

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
    // Restaura o preço original — este teste roda contra o banco real
    // compartilhado, não pode deixar um plano de produção com preço de teste.
    await (db as any).client.query('UPDATE plans SET price_cents = $1 WHERE id = $2', [
      originalPriceCents,
      planId,
    ]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('admin edita price_cents', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/plans/${planId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ price_cents: 55500 });

    expect(res.status).toBe(200);
    expect(res.body.price_cents).toBe(55500);

    const check = await (db as any).client.query('SELECT price_cents FROM plans WHERE id = $1', [
      planId,
    ]);
    expect(check.rows[0].price_cents).toBe(55500);
  });

  it('rejeita campo fora da allowlist (ex: slug)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/plans/${planId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ slug: 'novo-slug' });

    // forbidNonWhitelisted: true rejeita a requisição inteira (400).
    expect(res.status).toBe(400);
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/plans/${planId}`)
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ price_cents: 1000 });

    expect(res.status).toBe(403);
  });
});
