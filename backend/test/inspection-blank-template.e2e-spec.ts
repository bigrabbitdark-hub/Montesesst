import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /inspections/modelo-pdf — modelo em branco (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let empresaToken: string;
  let technicianToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Modelo Visita Teste');
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Modelo Visita Teste');
    const loginE = await request(app.getHttpServer()).post('/auth/login').send({ email: tenant.email, password: tenant.password });
    empresaToken = loginE.body.access_token;
    const loginT = await request(app.getHttpServer()).post('/auth/login').send({ email: tech.email, password: tech.password });
    technicianToken = loginT.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it.each([
    ['empresa', () => empresaToken],
    ['técnico', () => technicianToken],
  ])('%s baixa o modelo: 200, application/pdf, anexo', async (_nome, token) => {
    const res = await request(app.getHttpServer())
      .get('/inspections/modelo-pdf')
      .set('Authorization', `Bearer ${token()}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('sem token: 401', async () => {
    const res = await request(app.getHttpServer()).get('/inspections/modelo-pdf');
    expect(res.status).toBe(401);
  });
});
