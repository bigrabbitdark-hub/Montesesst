import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/GET /epis/:id/deliveries (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let employeeId: string;
  let empresaToken: string;
  let tenantEpiId: string;
  let otherTenantEmployeeId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Epi Delivery Teste');
    tenantId = tenant.tenantId;
    employeeId = tenant.employeeId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginRes.body.access_token;

    const catalogRes = await request(app.getHttpServer())
      .get('/epi-catalog-items')
      .set('Authorization', `Bearer ${empresaToken}`);
    const catalogItemId = catalogRes.body[0].id;

    const epiRes = await request(app.getHttpServer())
      .post('/epis')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ epi_catalog_item_id: catalogItemId, ca_number: 'CA-DELIVERY-001' });
    tenantEpiId = epiRes.body.id;

    const otherTenant = await db.createTenantWithUser('Empresa Epi Delivery Outro Tenant');
    otherTenantEmployeeId = otherTenant.employeeId;
  });

  afterAll(async () => {
    // employee_epi_deliveries.tenant_epi_id agora é ON DELETE RESTRICT (ver
    // migração 0014) — precisa apagar as entregas antes do próprio EPI.
    await (db as any).client.query('DELETE FROM employee_epi_deliveries WHERE tenant_epi_id = $1', [tenantEpiId]);
    await (db as any).client.query('DELETE FROM tenant_epis WHERE id = $1', [tenantEpiId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('registra uma entrega com assinatura e ela aparece na listagem', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/epis/${tenantEpiId}/deliveries`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ employee_id: employeeId, delivered_at: '2026-08-25', signed_by_name: 'Maria Responsável' });

    expect(createRes.status).toBe(201);
    expect(createRes.body.signed_by_name).toBe('Maria Responsável');
    expect(createRes.body.signed_at).not.toBeNull();
    expect(createRes.body.tenant_id).toBe(tenantId);

    const listRes = await request(app.getHttpServer())
      .get(`/epis/${tenantEpiId}/deliveries`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].employee_id).toBe(employeeId);
  });

  it('rejeita entrega para employee_id de outro tenant', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/epis/${tenantEpiId}/deliveries`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ employee_id: otherTenantEmployeeId, delivered_at: '2026-08-25', signed_by_name: 'Maria Responsável' });

    expect(createRes.status).toBe(404);
  });
});
