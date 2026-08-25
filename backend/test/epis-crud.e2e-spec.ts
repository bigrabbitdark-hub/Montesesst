import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/GET/DELETE /epis + GET /epi-catalog-items (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let empresaToken: string;
  let catalogItemId: string;
  let createdEpiId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Epi Crud Teste');
    tenantId = tenant.tenantId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginRes.body.access_token;

    const catalogRes = await request(app.getHttpServer())
      .get('/epi-catalog-items')
      .set('Authorization', `Bearer ${empresaToken}`);
    catalogItemId = catalogRes.body[0].id;
  });

  afterAll(async () => {
    if (createdEpiId) {
      await (db as any).client.query('DELETE FROM tenant_epis WHERE id = $1', [createdEpiId]);
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /epi-catalog-items retorna os 93 itens fixos', async () => {
    const res = await request(app.getHttpServer())
      .get('/epi-catalog-items')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(93);
  });

  it('empresa cadastra um EPI, aparece em GET /epis com os dados do catálogo juntos', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/epis')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ epi_catalog_item_id: catalogItemId, ca_number: 'CA-12345', ca_valid_until: '2027-01-01' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.ca_number).toBe('CA-12345');
    expect(createRes.body.category).toBeDefined();
    expect(createRes.body.code).toBeDefined();
    createdEpiId = createRes.body.id;

    const listRes = await request(app.getHttpServer())
      .get('/epis')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.find((e: { id: string }) => e.id === createdEpiId)).toBeDefined();
  });

  it('empresa apaga o EPI cadastrado', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/epis/${createdEpiId}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    createdEpiId = undefined;
  });
});
