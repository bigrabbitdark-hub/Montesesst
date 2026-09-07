import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('PUT /positions/:id/epi-requirements e /training-requirements (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let positionId: string;
  let epiCatalogItemId: string;
  let epiCatalogItemId2: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Requisitos Cargo');
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = loginRes.body.access_token;

    const positionRes = await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Soldador Requisitos' });
    positionId = positionRes.body.id;

    const catalogRows = await (db as any).client.query('SELECT id FROM epi_catalog_items ORDER BY code LIMIT 2');
    epiCatalogItemId = catalogRows.rows[0].id;
    epiCatalogItemId2 = catalogRows.rows[1].id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('define requisitos de EPI e reflete na listagem de cargos', async () => {
    const res = await request(app.getHttpServer())
      .put(`/positions/${positionId}/epi-requirements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ epi_catalog_item_ids: [epiCatalogItemId, epiCatalogItemId2] });

    expect(res.status).toBe(200);

    const listRes = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${token}`);
    const position = listRes.body.find((p: any) => p.id === positionId);
    expect(position.epi_requirement_count).toBe(2);
  });

  it('substitui a lista por inteiro (PUT idempotente, não incremental)', async () => {
    await request(app.getHttpServer())
      .put(`/positions/${positionId}/epi-requirements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ epi_catalog_item_ids: [epiCatalogItemId] });

    const listRes = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${token}`);
    const position = listRes.body.find((p: any) => p.id === positionId);
    expect(position.epi_requirement_count).toBe(1);
  });

  it('define requisitos de treinamento e reflete na listagem de cargos', async () => {
    const res = await request(app.getHttpServer())
      .put(`/positions/${positionId}/training-requirements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipos: ['nr-06', 'nr-35'] });

    expect(res.status).toBe(200);

    const listRes = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${token}`);
    const position = listRes.body.find((p: any) => p.id === positionId);
    expect(position.training_requirement_count).toBe(2);
  });

  it('rejeita tipo de treinamento inválido com 400', async () => {
    const res = await request(app.getHttpServer())
      .put(`/positions/${positionId}/training-requirements`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipos: ['nr-99-invalido'] });

    expect(res.status).toBe(400);
  });
});
