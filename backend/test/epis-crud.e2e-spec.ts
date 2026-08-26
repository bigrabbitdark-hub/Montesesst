import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/GET/DELETE /epis + GET /epi-catalog-items (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let employeeId: string;
  let empresaToken: string;
  let catalogItemId: string;
  let createdEpiId: string | undefined;

  let technicianId: string;
  let technicianToken: string;
  let unlinkedTechnicianToken: string;

  let deliveryEpiId: string | undefined;
  let technicianCreatedEpiId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Epi Crud Teste');
    tenantId = tenant.tenantId;
    employeeId = tenant.employeeId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginRes.body.access_token;

    const catalogRes = await request(app.getHttpServer())
      .get('/epi-catalog-items')
      .set('Authorization', `Bearer ${empresaToken}`);
    catalogItemId = catalogRes.body[0].id;

    // Técnico vinculado ao tenant (via tenant_technicians) — usado para
    // provar que POST /epis com tenant_id no corpo funciona pro caminho
    // técnico/parceiro, e que DELETE /epis/:id funciona pra qualquer
    // usuário com acesso ao tenant, não só quem cadastrou.
    const tech = await db.createUserWithRole('tecnico', 'Tecnico Epi Crud Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );
    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;

    // Técnico sem nenhum vínculo — usado pra provar que a RLS rejeita o
    // INSERT (42501 -> 403 via mapPgError).
    const unlinkedTech = await db.createUserWithRole('tecnico', 'Tecnico Epi Crud Nao Vinculado Teste');
    const loginUnlinkedTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: unlinkedTech.email, password: unlinkedTech.password });
    unlinkedTechnicianToken = loginUnlinkedTech.body.access_token;
  });

  afterAll(async () => {
    if (deliveryEpiId) {
      await (db as any).client.query('DELETE FROM employee_epi_deliveries WHERE tenant_epi_id = $1', [
        deliveryEpiId,
      ]);
      await (db as any).client.query('DELETE FROM tenant_epis WHERE id = $1', [deliveryEpiId]);
    }
    if (createdEpiId) {
      await (db as any).client.query('DELETE FROM tenant_epis WHERE id = $1', [createdEpiId]);
    }
    if (technicianCreatedEpiId) {
      await (db as any).client.query('DELETE FROM tenant_epis WHERE id = $1', [technicianCreatedEpiId]);
    }
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
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

  it('empresa apaga o EPI cadastrado (sem entregas registradas)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/epis/${createdEpiId}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    createdEpiId = undefined;
  });

  it('não é possível apagar um EPI com entregas registradas (409) — protege o histórico legal', async () => {
    const epiRes = await request(app.getHttpServer())
      .post('/epis')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ epi_catalog_item_id: catalogItemId, ca_number: 'CA-COM-ENTREGA' });
    expect(epiRes.status).toBe(201);
    deliveryEpiId = epiRes.body.id;

    const deliveryRes = await request(app.getHttpServer())
      .post(`/epis/${deliveryEpiId}/deliveries`)
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ employee_id: employeeId, delivered_at: '2026-08-25', signed_by_name: 'Maria Responsável' });
    expect(deliveryRes.status).toBe(201);

    const deleteRes = await request(app.getHttpServer())
      .delete(`/epis/${deliveryEpiId}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(deleteRes.status).toBe(409);

    // Confirma que o EPI e a entrega continuam existindo.
    const listRes = await request(app.getHttpServer())
      .get(`/epis/${deliveryEpiId}/deliveries`)
      .set('Authorization', `Bearer ${empresaToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(1);
  });

  it('técnico vinculado ao tenant cadastra um EPI pra empresa vinculada (POST /epis com tenant_id)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/epis')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ epi_catalog_item_id: catalogItemId, ca_number: 'CA-TECNICO-001', tenant_id: tenantId });

    expect(createRes.status).toBe(201);
    expect(createRes.body.tenant_id).toBe(tenantId);
    technicianCreatedEpiId = createRes.body.id;
  });

  it('técnico não vinculado é rejeitado pela RLS ao tentar cadastrar EPI (403)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/epis')
      .set('Authorization', `Bearer ${unlinkedTechnicianToken}`)
      .send({ epi_catalog_item_id: catalogItemId, ca_number: 'CA-TECNICO-NAO-VINCULADO', tenant_id: tenantId });

    expect(createRes.status).toBe(403);
  });

  it('DELETE /epis/:id funciona pra qualquer usuário com acesso ao tenant, não só quem cadastrou', async () => {
    const epiRes = await request(app.getHttpServer())
      .post('/epis')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ epi_catalog_item_id: catalogItemId, ca_number: 'CA-APAGADO-POR-TECNICO' });
    expect(epiRes.status).toBe(201);
    const epiId = epiRes.body.id;

    const deleteRes = await request(app.getHttpServer())
      .delete(`/epis/${epiId}`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(deleteRes.status).toBe(200);
  });
});
