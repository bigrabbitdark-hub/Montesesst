import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('CIPA DDS records (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let empresaToken: string;
  let outroTenantCompanyUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa CIPA DDS Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const outroTenant = await db.createTenantWithUser('Empresa CIPA DDS Outro Tenant');
    const outroUnitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Outro Tenant', 'Rua Outro', 'Cidade Outro', 'SP', '02000000') RETURNING id`,
      [outroTenant.tenantId],
    );
    outroTenantCompanyUnitId = outroUnitResult.rows[0].id;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await app.close();
  });

  it('cria, lista, filtra por estabelecimento, rejeita estabelecimento de outro tenant, e apaga', async () => {
    const create = await request(app.getHttpServer())
      .post('/cipa/dds')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        company_unit_id: companyUnitId,
        data: '2026-06-01',
        tema: 'Uso correto de EPI',
        numero_participantes: 12,
        responsavel: 'João Técnico',
      });
    expect(create.status).toBe(201);
    expect(create.body.tema).toBe('Uso correto de EPI');

    const cruzado = await request(app.getHttpServer())
      .post('/cipa/dds')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ company_unit_id: outroTenantCompanyUnitId, data: '2026-06-01', tema: 'Não deveria criar' });
    expect(cruzado.status).toBe(400);

    const list = await request(app.getHttpServer())
      .get(`/cipa/dds?company_unit_id=${companyUnitId}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(list.body.some((r: any) => r.id === create.body.id)).toBe(true);

    const del = await request(app.getHttpServer())
      .delete(`/cipa/dds/${create.body.id}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(del.status).toBe(200);

    const listDepois = await request(app.getHttpServer())
      .get(`/cipa/dds?company_unit_id=${companyUnitId}`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(listDepois.body.some((r: any) => r.id === create.body.id)).toBe(false);
  });
});
