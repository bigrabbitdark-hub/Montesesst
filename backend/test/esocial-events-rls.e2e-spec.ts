import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

async function login(app: INestApplication, t: { email: string; password: string }): Promise<string> {
  const res = await request(app.getHttpServer()).post('/auth/login').send({ email: t.email, password: t.password });
  return res.body.access_token;
}

describe('esocial_events RLS', () => {
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

  it('tenant A não consegue ler evento eSocial do tenant B (404, não 403)', async () => {
    const tenantA = await db.createTenantWithUser('esocial-events-a');
    const tenantB = await db.createTenantWithUser('esocial-events-b');
    const tokenA = await login(app, tenantA);

    const eventId = await db.insertRawRow('esocial_events', {
      tenant_id: tenantB.tenantId,
      event_type: 'S-2220',
      aso_record_id: await db.insertMinimalAsoRecord(tenantB),
      employee_id: tenantB.employeeId,
      certificate_id: await db.insertMinimalCertificate(tenantB),
      layout_version_id: await db.getActiveLayoutVersionId(),
      ambiente: 'producao_restrita',
      idempotency_key: 'test-key-cross-tenant',
      payload_json: '{}',
      created_by_user_id: tenantB.userId,
    });

    const res = await request(app.getHttpServer())
      .get(`/esocial/events/${eventId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });
});
