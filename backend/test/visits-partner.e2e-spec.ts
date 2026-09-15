import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

// Cobertura do papel parceiro na Fase 11 — até este arquivo, a fase inteira
// não tinha NENHUM teste e2e exercitando parceiro: nem o branch
// tenant_partners de VisitsService.isTechnicianLinked, nem o branch parceiro
// da policy de RLS de visit_requests, nem confirmar/cancelar/concluir feitos
// por um parceiro, nem findMyTenants(role='parceiro') dentro de
// GET /visits/me/day. A spec (docs/specs/fase-11-agenda-visitas.md §1) exige
// paridade parceiro/técnico explicitamente — este arquivo segue o mesmo
// padrão de documents-partner.e2e-spec.ts / inspections-partner.e2e-spec.ts.
describe('VisitsModule — papel parceiro (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let partnerId: string;
  let partnerUserId: string;
  let partnerToken: string;
  let empresaToken: string;
  let requestedVisitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Visits Partner Teste');
    tenantId = tenant.tenantId;

    const partner = await db.createUserWithRole('parceiro', 'Parceiro Visits Teste');
    partnerUserId = partner.userId;
    const partnerResult = await (db as any).client.query(
      `INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`,
      [partner.userId],
    );
    partnerId = partnerResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)',
      [tenantId, partnerId],
    );

    const loginPartner = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: partner.email, password: partner.password });
    partnerToken = loginPartner.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_partners WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM partners WHERE id = $1', [partnerId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa solicita visita pra parceiro NÃO vinculado ao seu tenant → 403 (branch tenant_partners de isTechnicianLinked, caso negativo)', async () => {
    const unlinkedPartner = await db.createUserWithRole('parceiro', 'Parceiro Visits Nao Vinculado Teste');
    const res = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: unlinkedPartner.userId, type: 'reuniao', preferred_date: '2026-09-10' });

    expect(res.status).toBe(403);
  });

  it('empresa solicita visita pra parceiro vinculado → 201, status solicitado', async () => {
    const res = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: partnerUserId,
        type: 'reuniao',
        preferred_date: '2026-09-10',
        motivo: 'Revisão de PGR',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('solicitado');
    expect(res.body.tenant_id).toBe(tenantId);
    expect(res.body.technician_user_id).toBe(partnerUserId);
    requestedVisitId = res.body.id;
  });

  it('parceiro confirma a visita solicitada → 200, status confirmado, confirmed_date setada', async () => {
    const confirmedDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const res = await request(app.getHttpServer())
      .patch(`/visits/${requestedVisitId}/confirmar`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ confirmed_date: confirmedDate });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmado');
    expect(res.body.confirmed_date).toBe(confirmedDate);
  });

  it('GET /visits/me/day como parceiro mostra a visita confirmada e a empresa vinculada (findMyTenants role=parceiro)', async () => {
    const res = await request(app.getHttpServer())
      .get('/visits/me/day')
      .set('Authorization', `Bearer ${partnerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.visitas.proximas.map((v: { id: string }) => v.id)).toContain(requestedVisitId);
    expect(res.body.empresas.map((e: { tenant_id: string }) => e.tenant_id)).toContain(tenantId);
  });

  it('parceiro cancela uma visita CONFIRMADA própria → 200, status cancelado', async () => {
    const created = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: partnerUserId, type: 'reuniao' });
    await request(app.getHttpServer())
      .patch(`/visits/${created.body.id}/confirmar`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ confirmed_date: '2026-09-21' });

    const res = await request(app.getHttpServer())
      .patch(`/visits/${created.body.id}/cancelar`)
      .set('Authorization', `Bearer ${partnerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelado');
  });

  it('parceiro conclui uma visita CONFIRMADA própria → 200, status concluido', async () => {
    const created = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: partnerUserId, type: 'reuniao' });
    await request(app.getHttpServer())
      .patch(`/visits/${created.body.id}/confirmar`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ confirmed_date: '2026-09-22' });

    const res = await request(app.getHttpServer())
      .patch(`/visits/${created.body.id}/concluir`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('concluido');
  });
});
