import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';
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

  it('tecnico recebe 403 ao tentar criar ASO (tenant_id sempre NULL para tecnico/admin)', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'aso-role-tecnico');

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });
    const token = login.body.access_token;

    const res = await request(app.getHttpServer())
      .post('/aso/records')
      .set('Authorization', `Bearer ${token}`)
      .send({
        employeeId: randomUUID(),
        examType: 'periodico',
        examDate: '2026-09-01',
        result: 'apto',
        resultDisclosureAuthorized: true,
        doctorName: 'Dra. Fulana',
        doctorCrm: '54321',
        doctorCrmUf: 'SP',
      });

    expect(res.status).toBe(403);
  });
});
