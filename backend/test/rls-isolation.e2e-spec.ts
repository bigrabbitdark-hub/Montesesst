import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb, TestTenantFixture } from './db-test-helper';

describe('Isolamento multi-tenant via RLS (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantA: TestTenantFixture;
  let tenantB: TestTenantFixture;
  let tokenA: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    tenantA = await db.createTenantWithUser('Empresa A');
    tenantB = await db.createTenantWithUser('Empresa B');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    tokenA = loginRes.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('lista apenas os employees do próprio tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/employees')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((e) => e.id);
    expect(ids).toContain(tenantA.employeeId);
    expect(ids).not.toContain(tenantB.employeeId);
  });

  it('retorna 404 (não 403) ao buscar por id um employee de outro tenant', async () => {
    const res = await request(app.getHttpServer())
      .get(`/employees/${tenantB.employeeId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(404);
  });

  it('ignora tenant_id do body e cria sempre sob o tenant do próprio usuário', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        full_name: 'Funcionário Novo',
        cpf: String(Math.floor(10000000000 + Math.random() * 89999999999)),
        tenant_id: tenantB.tenantId,
      });

    expect(res.status).toBe(201);
    expect(res.body.tenant_id).toBe(tenantA.tenantId);
  });

  it('bloqueia role sem permissão (tecnico) de criar employee com 403', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Teste');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });

    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${loginRes.body.access_token}`)
      .send({ full_name: 'X', cpf: '99988877766' });

    expect(res.status).toBe(403);
  });
});
