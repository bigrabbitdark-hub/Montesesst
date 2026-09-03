import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CIPA SIPAT (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let empresaToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA SIPAT Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('cria edição, rejeita duplicata do mesmo ano/estabelecimento com 409', async () => {
    const create = await request(app.getHttpServer())
      .post('/cipa/sipat/editions')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ company_unit_id: companyUnitId, ano: 2026, periodo_inicio: '2026-10-19', periodo_fim: '2026-10-23', tema: 'Segurança é prioridade' });
    expect(create.status).toBe(201);

    const duplicada = await request(app.getHttpServer())
      .post('/cipa/sipat/editions')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ company_unit_id: companyUnitId, ano: 2026, periodo_inicio: '2026-11-01', periodo_fim: '2026-11-05' });
    expect(duplicada.status).toBe(409);
  });

  it('adiciona atividade, atualiza status/participantes, lista, e apagar edição cascateia', async () => {
    const edition = await request(app.getHttpServer())
      .post('/cipa/sipat/editions')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ company_unit_id: companyUnitId, ano: 2027, periodo_inicio: '2027-10-18', periodo_fim: '2027-10-22' });
    expect(edition.status).toBe(201);
    const editionId = edition.body.id;

    const activity = await request(app.getHttpServer())
      .post(`/cipa/sipat/editions/${editionId}/activities`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ data: '2027-10-19', titulo: 'Palestra de prevenção de acidentes', responsavel: 'Dr. Fulano' });
    expect(activity.status).toBe(201);
    expect(activity.body.status).toBe('planejada');

    const updated = await request(app.getHttpServer())
      .patch(`/cipa/sipat/editions/${editionId}/activities/${activity.body.id}`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ status: 'realizada', numero_participantes: 40 });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe('realizada');
    expect(updated.body.numero_participantes).toBe(40);

    const list = await request(app.getHttpServer())
      .get(`/cipa/sipat/editions/${editionId}/activities`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].numero_participantes).toBe(40);

    const del = await request(app.getHttpServer())
      .delete(`/cipa/sipat/editions/${editionId}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(del.status).toBe(200);

    const listDepois = await request(app.getHttpServer())
      .get(`/cipa/sipat/editions/${editionId}/activities`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(listDepois.body).toHaveLength(0);
  });
});
