import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('employees.company_unit_id (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let unitAId: string;
  let unitBId: string;
  let tenantAId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Vinculo A');
    const tenantB = await db.createTenantWithUser('Empresa Vinculo B');
    tenantAId = tenantA.tenantId;

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    tokenA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.email, password: tenantB.password });
    tokenB = loginB.body.access_token;

    const unitA = await request(app.getHttpServer())
      .post('/company-units')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Sede A',
        address_street: 'Rua A',
        address_city: 'Criciúma',
        address_state: 'SC',
        address_zip: '88801000',
      });
    unitAId = unitA.body.id;

    const unitB = await request(app.getHttpServer())
      .post('/company-units')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        name: 'Sede B',
        address_street: 'Rua B',
        address_city: 'Criciúma',
        address_state: 'SC',
        address_zip: '88802000',
      });
    unitBId = unitB.body.id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('vincula um funcionário à própria filial com sucesso', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ full_name: 'Func A', cpf: '11122233344', company_unit_id: unitAId });

    expect(res.status).toBe(201);
    expect(res.body.company_unit_id).toBe(unitAId);
  });

  it('rejeita vincular funcionário à filial de outro tenant', async () => {
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ full_name: 'Func Malicioso', cpf: '55566677788', company_unit_id: unitBId });

    expect(res.status).toBe(400);
  });

  it('rejeita admin vinculando funcionário de um tenant à filial de outro tenant', async () => {
    const adminUser = await db.createUserWithRole('admin', 'Admin Cross Tenant');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminUser.email, password: adminUser.password });
    const tokenAdmin = loginAdmin.body.access_token;

    // Admin tenta criar um funcionário para o tenant A, mas linkado à filial do tenant B.
    // RLS sozinha não bloqueia isso pro role admin (bypass explícito na policy de
    // company_units) — é exatamente o buraco que assertCompanyUnitBelongsToTenant
    // precisa fechar comparando tenant_id explicitamente.
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        full_name: 'Func Cross Tenant Via Admin',
        cpf: '99988877766',
        tenant_id: tenantAId,
        company_unit_id: unitBId,
      });

    expect(res.status).toBe(400);
  });
});
