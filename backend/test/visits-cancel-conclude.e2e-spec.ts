import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('PATCH /visits/:id/cancelar, /concluir (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let technicianId: string;
  let technicianUserId: string;
  let technicianToken: string;
  let empresaToken: string;
  let otherTechToken: string;
  let visitToCancelId: string;
  let visitToConcludeId: string;
  let inspectionId: string;
  let foreignInspectionId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Visits CancelConclude Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Visits CancelConclude Teste');
    technicianUserId = tech.userId;
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    // "vinculado à mesma empresa": precisa de um vínculo tenant_technicians de
    // verdade, senão a RLS já esconde a visita antes de chegar na checagem de
    // 403 no service (viraria 404, não o 403 que este teste quer exercitar).
    const otherTech = await db.createUserWithRole('tecnico', 'Tecnico Visits Outro Teste');
    const otherTechResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [otherTech.userId],
    );
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, otherTechResult.rows[0].id],
    );

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;

    const loginOtherTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: otherTech.email, password: otherTech.password });
    otherTechToken = loginOtherTech.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;

    const visit1 = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: technicianUserId });
    visitToCancelId = visit1.body.id;

    const visit2 = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: technicianUserId });
    visitToConcludeId = visit2.body.id;
    await request(app.getHttpServer())
      .patch(`/visits/${visitToConcludeId}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-09-15' });

    const inspectionResult = await (db as any).client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at) VALUES ($1, $2, '2026-09-15') RETURNING id`,
      [tenantId, technicianUserId],
    );
    inspectionId = inspectionResult.rows[0].id;

    const foreignTenant = await db.createTenantWithUser('Empresa Visits Foreign Inspection Teste');
    const foreignInspectionResult = await (db as any).client.query(
      `INSERT INTO inspections (tenant_id, technician_user_id, visited_at) VALUES ($1, $2, '2026-09-15') RETURNING id`,
      [foreignTenant.tenantId, technicianUserId],
    );
    foreignInspectionId = foreignInspectionResult.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM inspections WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa cancela visita solicitada → 200, status cancelado', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${visitToCancelId}/cancelar`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelado');
  });

  it('cancelar de novo (já cancelada) → 409', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${visitToCancelId}/cancelar`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(409);
  });

  it('técnico designado conclui visita confirmada com inspection_id válida → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${visitToConcludeId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ inspection_id: inspectionId });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('concluido');
    expect(res.body.inspection_id).toBe(inspectionId);
  });

  it('técnico B (vinculado à mesma empresa) não conclui visita atribuída ao técnico A → 403', async () => {
    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: technicianUserId });
    await request(app.getHttpServer())
      .patch(`/visits/${visit.body.id}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-09-16' });

    const res = await request(app.getHttpServer())
      .patch(`/visits/${visit.body.id}/concluir`)
      .set('Authorization', `Bearer ${otherTechToken}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('concluir com inspection_id de outro tenant → 403 (nunca aceita id sem validar contexto)', async () => {
    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: technicianUserId });
    await request(app.getHttpServer())
      .patch(`/visits/${visit.body.id}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-09-17' });

    const res = await request(app.getHttpServer())
      .patch(`/visits/${visit.body.id}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ inspection_id: foreignInspectionId });

    expect(res.status).toBe(403);
  });
});
