import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('inspections/action-plans reconhecem o papel parceiro (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let partnerId: string;
  let partnerToken: string;
  let inspectionId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection Partner Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const partner = await db.createUserWithRole('parceiro', 'Parceiro Inspection Teste');

    const partnerResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partner.userId],
    );
    partnerId = partnerResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantId, partnerId],
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: partner.email, password: partner.password });
    partnerToken = loginRes.body.access_token;
  });

  afterAll(async () => {
    if (inspectionId) {
      await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [inspectionId]);
    }
    await (db as any).client.query('DELETE FROM tenant_partners WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM partners WHERE id = $1', [partnerId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('parceiro cria, edita, marca item NC e conclui uma inspeção, gerando plano de ação', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25', company_unit_id: companyUnitId });
    expect(createRes.status).toBe(201);
    inspectionId = createRes.body.id;
    const itemId = createRes.body.items[0].id;

    const updateRes = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ company_contact: 'Contato via parceiro' });
    expect(updateRes.status).toBe(200);

    const itemRes = await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${itemId}`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ status: 'NC' });
    expect(itemRes.status).toBe(200);

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${partnerToken}`);
    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.action_plans).toHaveLength(1);
  });

  it('parceiro lista os planos de ação da empresa vinculada', async () => {
    const res = await request(app.getHttpServer())
      .get(`/action-plans?tenant_id=${tenantId}`)
      .set('Authorization', `Bearer ${partnerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('parceiro sem tenant_id em /inspections e /action-plans recebe 400', async () => {
    const inspectionsRes = await request(app.getHttpServer())
      .get('/inspections')
      .set('Authorization', `Bearer ${partnerToken}`);
    expect(inspectionsRes.status).toBe(400);

    const actionPlansRes = await request(app.getHttpServer())
      .get('/action-plans')
      .set('Authorization', `Bearer ${partnerToken}`);
    expect(actionPlansRes.status).toBe(400);
  });
});
