import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('aso_records RLS (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa do tenant A não lista ASO de funcionário do tenant B', async () => {
    const tenantA = await db.createTenantWithUser('aso-rls-a');
    const tenantB = await db.createTenantWithUser('aso-rls-b');
    await db.insertMinimalAsoRecord(tenantB);

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    const tokenA = loginA.body.access_token;

    const res = await request(app.getHttpServer())
      .get(`/aso/records?employeeId=${tenantB.employeeId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});
