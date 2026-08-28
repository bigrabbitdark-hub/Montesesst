import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/GET /normative-sources (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let createdSourceId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Normativo Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const tenant = await db.createTenantWithUser('Empresa Normativo Teste');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    if (createdSourceId) {
      await (db as any).client.query('DELETE FROM official_sources WHERE id = $1', [createdSourceId]);
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/normative-sources')
      .set('Authorization', `Bearer ${tokenEmpresa}`)
      .send({ entity: 'MTE', code: 'NR-06', title: 'NR-06 - EPI', official_url: 'https://exemplo.gov.br/nr-06.pdf' });
    expect(res.status).toBe(403);
  });

  it('admin cadastra uma fonte e ela aparece na listagem', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/normative-sources')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ entity: 'MTE', code: 'NR-06', title: 'NR-06 - EPI', official_url: 'https://exemplo.gov.br/nr-06.pdf' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.entity).toBe('MTE');
    expect(createRes.body.active).toBe(true);
    createdSourceId = createRes.body.id;

    const listRes = await request(app.getHttpServer())
      .get('/normative-sources')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.some((s: any) => s.id === createdSourceId)).toBe(true);
  });

  it('rejeita URL inválida', async () => {
    const res = await request(app.getHttpServer())
      .post('/normative-sources')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ entity: 'MTE', title: 'Fonte inválida', official_url: 'não é uma url' });
    expect(res.status).toBe(400);
  });
});
