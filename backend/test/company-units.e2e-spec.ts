import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CRUD /company-units (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let unitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Filial CRUD');

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

  it('cria uma filial', async () => {
    const res = await request(app.getHttpServer())
      .post('/company-units')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Sede',
        address_street: 'Rua das Flores',
        address_number: '100',
        address_city: 'Criciúma',
        address_state: 'SC',
        address_zip: '88801000',
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Sede');
    unitId = res.body.id;
  });

  it('lista as filiais do próprio tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/company-units')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.map((u: { id: string }) => u.id)).toContain(unitId);
  });

  it('atualiza uma filial', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/company-units/${unitId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sede Renomeada' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Sede Renomeada');
  });

  it('remover uma filial não apaga o funcionário vinculado, só desvincula (ON DELETE SET NULL)', async () => {
    const unitRes = await request(app.getHttpServer())
      .post('/company-units')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Filial Com Funcionário',
        address_street: 'Rua Vínculo',
        address_city: 'Criciúma',
        address_state: 'SC',
        address_zip: '88803000',
      });
    expect(unitRes.status).toBe(201);
    const linkedUnitId = unitRes.body.id;

    const employeeRes = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Func Vinculado À Filial', cpf: '12312312399', company_unit_id: linkedUnitId });
    expect(employeeRes.status).toBe(201);
    const employeeId = employeeRes.body.id;

    const deleteRes = await request(app.getHttpServer())
      .delete(`/company-units/${linkedUnitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.status).toBe(200);

    const getEmployeeRes = await request(app.getHttpServer())
      .get(`/employees/${employeeId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getEmployeeRes.status).toBe(200);
    expect(getEmployeeRes.body.company_unit_id).toBeNull();
  });

  it('remove uma filial', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/company-units/${unitId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    const getRes = await request(app.getHttpServer())
      .get(`/company-units/${unitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(404);
  });
});
