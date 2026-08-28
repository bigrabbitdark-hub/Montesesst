import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /system-status (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin System Status Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const tenant = await db.createTenantWithUser('Empresa System Status Teste');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/system-status')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(res.status).toBe(403);
  });

  it('admin recebe números reais de memória, CPU, disco e status dos serviços', async () => {
    const res = await request(app.getHttpServer())
      .get('/system-status')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);

    expect(res.body.memory.total_gb).toBeGreaterThan(0);
    expect(res.body.memory.free_gb).toBeGreaterThanOrEqual(0);
    expect(res.body.memory.used_percent).toBeGreaterThanOrEqual(0);
    expect(res.body.memory.used_percent).toBeLessThanOrEqual(100);

    expect(res.body.cpu.cores).toBeGreaterThan(0);
    expect(typeof res.body.cpu.load_avg_1m).toBe('number');

    expect(res.body.disk.total_gb).toBeGreaterThan(0);
    expect(res.body.disk.used_percent).toBeGreaterThanOrEqual(0);
    expect(res.body.disk.used_percent).toBeLessThanOrEqual(100);

    // Postgres e Redis precisam estar alcançáveis, senão a suíte inteira já
    // teria falhado antes de chegar aqui — asserção forte é segura.
    expect(res.body.services.postgres.reachable).toBe(true);
    expect(res.body.services.postgres.active_connections).toBeGreaterThan(0);
    expect(res.body.services.redis.reachable).toBe(true);

    // Frontend depende do container real estar de pé nesta rede — não é
    // garantido em todo ambiente de teste, só confere o formato.
    expect(typeof res.body.services.frontend.reachable).toBe('boolean');
  });
});
