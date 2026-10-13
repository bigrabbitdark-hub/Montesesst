import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('ASO module (e2e)', () => {
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

  it('cria e lista um registro de ASO', async () => {
    const tenant = await db.createTenantWithUser('aso-basic');

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;

    const createRes = await request(app.getHttpServer())
      .post('/aso/records')
      .set('Authorization', `Bearer ${token}`)
      .send({
        employeeId: tenant.employeeId,
        examType: 'periodico',
        examDate: '2026-09-01',
        result: 'apto',
        resultDisclosureAuthorized: true,
        doctorName: 'Dra. Fulana',
        doctorCrm: '54321',
        doctorCrmUf: 'SP',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.result).toBe('apto');

    const listRes = await request(app.getHttpServer())
      .get(`/aso/records?employeeId=${tenant.employeeId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });
});
