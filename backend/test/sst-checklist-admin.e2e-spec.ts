import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EMBEDDING_PROVIDER } from '../src/common/embedding/embedding-provider.interface';
import { TestDb } from './db-test-helper';

describe('CRUD /sst-checklist (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let createdId: string | undefined;
  const fakeEmbed = jest.fn().mockResolvedValue(new Array(1536).fill(0.01));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue({ embed: fakeEmbed })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Checklist SST Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const tenant = await db.createTenantWithUser('Empresa Checklist SST Teste');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;
  });

  afterEach(() => {
    fakeEmbed.mockClear();
  });

  afterAll(async () => {
    if (createdId) {
      await (db as any).client.query('DELETE FROM sst_checklist_items WHERE id = $1', [createdId]);
    }
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('bloqueia empresa com 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/sst-checklist')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(res.status).toBe(403);
  });

  it('admin cria um item, embedding é calculado, item aparece na listagem e no filtro por nr_code', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/sst-checklist')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nr_code: 'NR-99',
        nr_title: 'Norma de teste e2e',
        nr_category: 'geral',
        document_name: 'Documento de teste e2e',
        description: 'Descrição de teste e2e',
        legal_requirement: 'Item 9.9.9 de teste',
        infraction_index: 2,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.nr_code).toBe('NR-99');
    expect(createRes.body.embedding).toBeUndefined();
    expect(fakeEmbed).toHaveBeenCalledTimes(1);
    expect(fakeEmbed).toHaveBeenCalledWith(
      'NR-99 — Documento de teste e2e: Descrição de teste e2e — Item 9.9.9 de teste',
    );
    createdId = createRes.body.id;

    const listRes = await request(app.getHttpServer())
      .get('/sst-checklist?nr_code=NR-99')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((i: any) => i.id === createdId)).toBe(true);
  });

  it('editar description recalcula o embedding', async () => {
    fakeEmbed.mockClear();
    const res = await request(app.getHttpServer())
      .patch(`/sst-checklist/${createdId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ description: 'Descrição atualizada' });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Descrição atualizada');
    expect(fakeEmbed).toHaveBeenCalledTimes(1);
  });

  it('editar só infraction_index NÃO recalcula o embedding', async () => {
    fakeEmbed.mockClear();
    const res = await request(app.getHttpServer())
      .patch(`/sst-checklist/${createdId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ infraction_index: 3 });

    expect(res.status).toBe(200);
    expect(res.body.infraction_index).toBe(3);
    expect(fakeEmbed).not.toHaveBeenCalled();
  });

  it('remove o item', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/sst-checklist/${createdId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);

    const getRes = await request(app.getHttpServer())
      .get(`/sst-checklist/${createdId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(getRes.status).toBe(404);
    createdId = undefined;
  });

  it('rejeita nr_category inválida', async () => {
    const res = await request(app.getHttpServer())
      .post('/sst-checklist')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nr_code: 'NR-99',
        nr_title: 'x',
        nr_category: 'inventada',
        document_name: 'x',
        description: 'x',
        legal_requirement: 'x',
      });
    expect(res.status).toBe(400);
  });
});
