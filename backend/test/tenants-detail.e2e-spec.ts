import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /tenants/:id/detail (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;

  let tenantId: string;
  let empresaUserId: string;
  let technicianId: string;
  let partnerId: string;
  let inspectionId: string;
  let documentId: string;
  let tenantEpiId: string;
  let subscriptionId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Detail Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;
  });

  afterAll(async () => {
    if (inspectionId) await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [inspectionId]);
    if (documentId) await (db as any).client.query('DELETE FROM documents WHERE id = $1', [documentId]);
    if (tenantEpiId) await (db as any).client.query('DELETE FROM tenant_epis WHERE id = $1', [tenantEpiId]);
    if (subscriptionId) await (db as any).client.query('DELETE FROM subscriptions WHERE id = $1', [subscriptionId]);
    if (tenantId) {
      await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
      await (db as any).client.query('DELETE FROM tenant_partners WHERE tenant_id = $1', [tenantId]);
    }
    if (technicianId) await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    if (partnerId) await (db as any).client.query('DELETE FROM partners WHERE id = $1', [partnerId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('retorna 404 pra tenant inexistente', async () => {
    const res = await request(app.getHttpServer())
      .get('/tenants/00000000-0000-0000-0000-000000000000/detail')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });

  it('bloqueia empresa com 403', async () => {
    const tenant = await db.createTenantWithUser('Empresa Detail 403');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });

    const res = await request(app.getHttpServer())
      .get(`/tenants/${tenant.tenantId}/detail`)
      .set('Authorization', `Bearer ${login.body.access_token}`);
    expect(res.status).toBe(403);

    await (db as any).client.query('DELETE FROM tenants WHERE id = $1', [tenant.tenantId]);
    await (db as any).client.query('DELETE FROM users WHERE id = $1', [tenant.userId]);
  });

  it('reúne cadastro, vínculos, documentos, EPIs, inspeções e assinaturas de um tenant', async () => {
    const tenant = await db.createTenantWithUser('Empresa Detail Completa');
    tenantId = tenant.tenantId;
    empresaUserId = tenant.userId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Detail Completa');
    const partner = await db.createUserWithRole('parceiro', 'Parceiro Detail Completa');

    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const partnerResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul') RETURNING id`,
      [partner.userId],
    );
    partnerId = partnerResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantId, partnerId],
    );

    const inspectionResult = await (db as any).client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, status, visited_at)
       VALUES ($1, $2, 'concluida', CURRENT_DATE) RETURNING id`,
      [tenantId, empresaUserId],
    );
    inspectionId = inspectionResult.rows[0].id;

    const documentResult = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR Teste Detail', 'key-detail-teste', 'pgr.pdf', 'application/pdf', 1024, CURRENT_DATE + 15, $2, 'empresa')
       RETURNING id`,
      [tenantId, empresaUserId],
    );
    documentId = documentResult.rows[0].id;

    const catalogItem = await (db as any).client.query('SELECT id FROM epi_catalog_items LIMIT 1');
    const epiResult = await (db as any).client.query(
      `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, ca_valid_until, created_by_user_id)
       VALUES ($1, $2, 'CA-DETAIL-TESTE', CURRENT_DATE + 15, $3) RETURNING id`,
      [tenantId, catalogItem.rows[0].id, empresaUserId],
    );
    tenantEpiId = epiResult.rows[0].id;

    const planResult = await (db as any).client.query(
      `SELECT id, name, price_cents FROM plans WHERE audience = 'empresa' LIMIT 1`,
    );
    const subResult = await (db as any).client.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [planResult.rows[0].id, tenantId, `preapproval-detail-teste-${Date.now()}`],
    );
    subscriptionId = subResult.rows[0].id;

    const res = await request(app.getHttpServer())
      .get(`/tenants/${tenantId}/detail`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);

    expect(res.body.tenant.id).toBe(tenantId);
    expect(res.body.tenant.name).toEqual(expect.stringContaining('Empresa Detail Completa'));
    expect(res.body.tenant.technicians).toHaveLength(1);
    expect(res.body.tenant.technicians[0].id).toBe(technicianId);
    expect(res.body.tenant.partners).toHaveLength(1);
    expect(res.body.tenant.partners[0].id).toBe(partnerId);

    expect(res.body.documents.map((d: any) => d.id)).toContain(documentId);
    expect(res.body.epis.map((e: any) => e.id)).toContain(tenantEpiId);
    expect(res.body.epis.find((e: any) => e.id === tenantEpiId).description).toBeDefined();
    expect(res.body.inspections.map((i: any) => i.id)).toContain(inspectionId);

    const subscription = res.body.subscriptions.find((s: any) => s.id === subscriptionId);
    expect(subscription).toBeDefined();
    expect(subscription.status).toBe('authorized');
    expect(subscription.plan_name).toBe(planResult.rows[0].name);
    expect(subscription.price_cents).toBe(planResult.rows[0].price_cents);
  });
});
