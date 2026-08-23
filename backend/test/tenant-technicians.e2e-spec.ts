import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /tenant-technicians/me (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let technicianId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa TenantTech Teste');
    tenantId = tenant.tenantId;
    const tech = await db.createUserWithRole('tecnico', 'Tecnico TenantTech Teste');

    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('lista as empresas vinculadas ao técnico autenticado', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenant-technicians/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].tenant_id).toBe(tenantId);
  });
});
