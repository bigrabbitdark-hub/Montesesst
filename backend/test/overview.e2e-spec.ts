import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /overview (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;

  let tenantId: string;
  let empresaUserId: string;
  let technicianId: string;
  let partnerId: string;
  let inspectionId: string;
  let documentId: string;
  let tenantEpiId: string;
  let subscriptionId: string;
  let actionPlanId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Overview Teste');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;
  });

  afterAll(async () => {
    if (actionPlanId) await (db as any).client.query('DELETE FROM action_plans WHERE id = $1', [actionPlanId]);
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

  it('bloqueia empresa não-admin com 403', async () => {
    const tenant = await db.createTenantWithUser('Empresa Overview 403');
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;

    const res = await request(app.getHttpServer())
      .get('/overview')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(res.status).toBe(403);
  });

  it('cada métrica sobe exatamente 1 depois de criar um fixture de cada tipo', async () => {
    const before = await request(app.getHttpServer())
      .get('/overview')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(before.status).toBe(200);

    // Tudo criado DEPOIS da foto "before" de propósito — senão o delta
    // fica zerado (fixture já existiria nas duas fotos).
    const tenant = await db.createTenantWithUser('Empresa Overview Delta');
    tenantId = tenant.tenantId;
    empresaUserId = tenant.userId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Overview Delta');
    const partner = await db.createUserWithRole('parceiro', 'Parceiro Overview Delta');

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

    // Inspeção neste mês
    const inspectionResult = await (db as any).client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, status, visited_at)
       VALUES ($1, $2, 'concluida', CURRENT_DATE) RETURNING id`,
      [tenantId, empresaUserId],
    );
    inspectionId = inspectionResult.rows[0].id;

    // Plano de ação pendente (vinculado à inspeção acima)
    const actionPlanResult = await (db as any).client.query(
      `INSERT INTO action_plans (tenant_id, inspection_id, description, status)
       VALUES ($1, $2, 'Corrigir item não conforme', 'pendente') RETURNING id`,
      [tenantId, inspectionId],
    );
    actionPlanId = actionPlanResult.rows[0].id;

    // Documento vencendo em 15 dias
    const documentResult = await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR Teste Overview', 'key-overview-teste', 'pgr.pdf', 'application/pdf', 1024, CURRENT_DATE + 15, $2, 'empresa')
       RETURNING id`,
      [tenantId, empresaUserId],
    );
    documentId = documentResult.rows[0].id;

    // EPI com CA vencendo em 15 dias
    const catalogItem = await (db as any).client.query('SELECT id FROM epi_catalog_items LIMIT 1');
    const epiResult = await (db as any).client.query(
      `INSERT INTO tenant_epis (tenant_id, epi_catalog_item_id, ca_number, ca_valid_until, created_by_user_id)
       VALUES ($1, $2, 'CA-OVERVIEW-TESTE', CURRENT_DATE + 15, $3) RETURNING id`,
      [tenantId, catalogItem.rows[0].id, empresaUserId],
    );
    tenantEpiId = epiResult.rows[0].id;

    // Assinatura ativa
    const planResult = await (db as any).client.query(
      `SELECT id, price_cents FROM plans WHERE audience = 'empresa' LIMIT 1`,
    );
    const subResult = await (db as any).client.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [planResult.rows[0].id, tenantId, `preapproval-overview-teste-${Date.now()}`],
    );
    subscriptionId = subResult.rows[0].id;

    const after = await request(app.getHttpServer())
      .get('/overview')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(after.status).toBe(200);
    expect(after.body.empresas_ativas - before.body.empresas_ativas).toBe(1);
    expect(after.body.tecnicos_vinculados - before.body.tecnicos_vinculados).toBe(1);
    expect(after.body.parceiros_vinculados - before.body.parceiros_vinculados).toBe(1);
    expect(after.body.inspecoes_no_mes - before.body.inspecoes_no_mes).toBe(1);
    expect(after.body.documentos_vencendo - before.body.documentos_vencendo).toBe(1);
    expect(after.body.epis_vencendo - before.body.epis_vencendo).toBe(1);
    expect(after.body.assinaturas_ativas - before.body.assinaturas_ativas).toBe(1);
    expect(after.body.receita_mensal_cents - before.body.receita_mensal_cents).toBe(
      planResult.rows[0].price_cents,
    );
    expect(after.body.planos_acao_pendentes - before.body.planos_acao_pendentes).toBe(1);
  });
});
