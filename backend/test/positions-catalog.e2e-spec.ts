import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/GET/PATCH /positions (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Cargo Teste');
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

  it('cria um cargo e devolve na listagem com contadores zerados', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Eletricista' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe('Eletricista');

    const listRes = await request(app.getHttpServer())
      .get('/positions')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    const created = listRes.body.find((p: any) => p.id === createRes.body.id);
    expect(created).toMatchObject({
      name: 'Eletricista',
      employee_count: 0,
      epi_requirement_count: 0,
      training_requirement_count: 0,
    });
  });

  it('rejeita nome duplicado no mesmo tenant com 409', async () => {
    await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Soldador' });

    const dupRes = await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Soldador' });

    expect(dupRes.status).toBe(409);
  });

  it('renomeia um cargo existente', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/positions')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ajudante Geral' });

    const patchRes = await request(app.getHttpServer())
      .patch(`/positions/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Auxiliar Geral' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.name).toBe('Auxiliar Geral');
  });

  it('devolve 404 ao renomear cargo inexistente', async () => {
    const patchRes = await request(app.getHttpServer())
      .patch('/positions/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Não Existe' });

    expect(patchRes.status).toBe(404);
  });
});
