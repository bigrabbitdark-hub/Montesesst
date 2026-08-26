import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /employees com tenant_id (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let technicianId: string;
  let technicianToken: string;
  let empresaToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Employees TenantId Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Employees TenantId Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('técnico com tenant_id vê os funcionários da empresa vinculada', async () => {
    const res = await request(app.getHttpServer())
      .get(`/employees?tenant_id=${tenantId}`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((e: { tenant_id: string }) => e.tenant_id === tenantId)).toBe(true);
  });

  it('técnico sem tenant_id recebe 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(400);
  });

  it('empresa continua funcionando sem tenant_id (RLS decide)', async () => {
    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
