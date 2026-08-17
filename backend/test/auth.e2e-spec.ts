import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb, TestTenantFixture } from './db-test-helper';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenant: TestTenantFixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    tenant = await db.createTenantWithUser('Auth Teste');
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('faz login com credenciais válidas e retorna access_token', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });

    expect(res.status).toBe(201);
    expect(typeof res.body.access_token).toBe('string');
    expect(res.body.user).toMatchObject({ role: 'empresa', tenantId: tenant.tenantId });
  });

  it('rejeita senha incorreta com 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: 'senha-errada' });

    expect(res.status).toBe(401);
  });

  it('rejeita e-mail inexistente com 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nao-existe@teste.montese.local', password: 'qualquer' });

    expect(res.status).toBe(401);
  });

  it('bloqueia rota protegida sem token com 401', async () => {
    const res = await request(app.getHttpServer()).get('/employees');
    expect(res.status).toBe(401);
  });
});
