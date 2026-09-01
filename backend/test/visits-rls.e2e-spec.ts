import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('visit_requests — isolamento RLS entre tenants (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let technicianAId: string;
  let technicianUserAId: string;
  let technicianBId: string;
  let empresaAToken: string;
  let empresaBToken: string;
  let technicianAToken: string;
  let adminToken: string;
  let visitInTenantAId: string;
  let visitInTenantBId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenantA = await db.createTenantWithUser('Empresa Visits RLS A');
    tenantAId = tenantA.tenantId;
    const tenantB = await db.createTenantWithUser('Empresa Visits RLS B');
    tenantBId = tenantB.tenantId;

    const techA = await db.createUserWithRole('tecnico', 'Tecnico Visits RLS A');
    technicianUserAId = techA.userId;
    const techAResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [techA.userId],
    );
    technicianAId = techAResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantAId, technicianAId],
    );

    // Segundo técnico, vinculado ao tenant B — só pra existir uma visita em
    // cada tenant, e assim o teste de admin conseguir provar visibilidade
    // "entre tenants" de verdade (não só "não dá lista vazia").
    const techB = await db.createUserWithRole('tecnico', 'Tecnico Visits RLS B');
    const techBResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [techB.userId],
    );
    technicianBId = techBResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantBId, technicianBId],
    );

    const loginEmpresaA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    empresaAToken = loginEmpresaA.body.access_token;

    const loginEmpresaB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.email, password: tenantB.password });
    empresaBToken = loginEmpresaB.body.access_token;

    const loginTechA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: techA.email, password: techA.password });
    technicianAToken = loginTechA.body.access_token;

    const admin = await db.createUserWithRole('admin', 'Admin Visits RLS');
    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    adminToken = loginAdmin.body.access_token;

    const visit = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaAToken}`)
      .send({ technician_user_id: technicianUserAId });
    visitInTenantAId = visit.body.id;

    const visitB = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaBToken}`)
      .send({ technician_user_id: techB.userId });
    visitInTenantBId = visitB.body.id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id = $1', [tenantAId]);
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id = $1', [tenantBId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantAId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantBId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianAId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianBId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa B não vê visita do tenant A na listagem', async () => {
    const res = await request(app.getHttpServer())
      .get('/visits')
      .set('Authorization', `Bearer ${empresaBToken}`);

    expect(res.status).toBe(200);
    expect(res.body.find((v: { id: string }) => v.id === visitInTenantAId)).toBeUndefined();
  });

  it('empresa B tentando cancelar visita do tenant A → 404 (RLS torna invisível, não 403)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${visitInTenantAId}/cancelar`)
      .set('Authorization', `Bearer ${empresaBToken}`);

    expect(res.status).toBe(404);
  });

  it('técnico A (vinculado ao tenant A) confirma normalmente — RLS permite', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${visitInTenantAId}/confirmar`)
      .set('Authorization', `Bearer ${technicianAToken}`)
      .send({ confirmed_date: '2026-09-20' });

    expect(res.status).toBe(200);
  });

  it('admin vê visitas de ambos os tenants na listagem (não filtra pra lista vazia)', async () => {
    const res = await request(app.getHttpServer())
      .get('/visits')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.find((v: { id: string }) => v.id === visitInTenantAId)).toBeDefined();
    expect(res.body.find((v: { id: string }) => v.id === visitInTenantBId)).toBeDefined();
  });
});
