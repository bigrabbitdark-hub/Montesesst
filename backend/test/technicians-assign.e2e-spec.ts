import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/DELETE /technicians/:id/assign (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenEmpresa: string;
  let tokenAdmin: string;
  let tenantId: string;
  let technicianId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Assign Teste');
    tenantId = tenant.tenantId;
    const admin = await db.createUserWithRole('admin', 'Admin Assign Teste');
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Assign Teste');

    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('rejeita empresa tentando se auto-vincular a um técnico (403)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/technicians/${technicianId}/assign`)
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('admin consegue vincular técnico a uma empresa', async () => {
    const res = await request(app.getHttpServer())
      .post(`/technicians/${technicianId}/assign`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ tenant_id: tenantId });

    expect(res.status).toBe(201);

    const linkResult = await (db as any).client.query(
      'SELECT * FROM tenant_technicians WHERE tenant_id = $1 AND technician_id = $2',
      [tenantId, technicianId],
    );
    expect(linkResult.rowCount).toBe(1);
  });
});
