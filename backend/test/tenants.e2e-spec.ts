import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET/PATCH /tenants/me (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Onboarding');
    tenantId = tenant.tenantId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('retorna o próprio tenant com sector/contact ainda vazios', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenants/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(tenantId);
    expect(res.body.sector).toBeNull();
  });

  it('atualiza sector/contact_name/contact_phone', async () => {
    const res = await request(app.getHttpServer())
      .patch('/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ sector: 'Indústria', contact_name: 'Ana RH', contact_phone: '48999990000' });

    expect(res.status).toBe(200);
    expect(res.body.sector).toBe('Indústria');
    expect(res.body.contact_name).toBe('Ana RH');
    expect(res.body.contact_phone).toBe('48999990000');
  });

  it('rejeita campos fora da allowlist (ex: tentar mudar plan/cnpj)', async () => {
    const res = await request(app.getHttpServer())
      .patch('/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'enterprise', cnpj: '00000000000000' });

    // forbidNonWhitelisted: true rejeita a requisição inteira (400) —
    // não existe um "ignora silenciosamente e aplica o resto".
    expect(res.status).toBe(400);
  });

  it('bloqueia role sem permissão (tecnico) com 403', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Onboarding');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tecnico.email, password: tecnico.password });

    const res = await request(app.getHttpServer())
      .get('/tenants/me')
      .set('Authorization', `Bearer ${loginRes.body.access_token}`);

    expect(res.status).toBe(403);
  });
});
