import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /visits/me/day (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantAId: string;
  let tenantBId: string;
  let technicianId: string;
  let technicianUserId: string;
  let technicianToken: string;
  let empresaAToken: string;
  let confirmedVisitId: string;
  let pendingVisitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenantA = await db.createTenantWithUser('Empresa MeuDia A Teste');
    tenantAId = tenantA.tenantId;
    const tenantB = await db.createTenantWithUser('Empresa MeuDia B Teste');
    tenantBId = tenantB.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico MeuDia Teste');
    technicianUserId = tech.userId;
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2), ($3, $2)',
      [tenantAId, technicianId, tenantBId],
    );

    // Pendência real na empresa A (documento vencido) — DashboardService já
    // sabe transformar isso em item de `atencao`, reaproveitado sem mudança.
    await (db as any).client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, 'pgr', 'PGR vencido teste Meu Dia', 'fixture/meudia.pdf', 'meudia.pdf', 'application/pdf', 100, CURRENT_DATE - INTERVAL '5 days', $2, 'empresa')`,
      [tenantAId, tenantA.userId],
    );

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;

    const loginEmpresaA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    empresaAToken = loginEmpresaA.body.access_token;

    const visit1 = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaAToken}`)
      .send({ technician_user_id: technicianUserId, type: 'reuniao', preferred_date: '2026-09-05' });
    confirmedVisitId = visit1.body.id;
    await request(app.getHttpServer())
      .patch(`/visits/${confirmedVisitId}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) });

    const visit2 = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaAToken}`)
      .send({ technician_user_id: technicianUserId, type: 'reuniao' });
    pendingVisitId = visit2.body.id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM documents WHERE tenant_id = $1', [tenantAId]);
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id IN ($1, $2)', [tenantAId, tenantBId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE technician_id = $1', [technicianId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('agrega visitas confirmadas/pendentes e pendências das duas empresas vinculadas, isoladas por empresa', async () => {
    const res = await request(app.getHttpServer())
      .get('/visits/me/day')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    expect(res.body.visitas.proximas.map((v: { id: string }) => v.id)).toContain(confirmedVisitId);
    expect(res.body.visitas.pendentes_de_confirmar.map((v: { id: string }) => v.id)).toContain(pendingVisitId);

    expect(res.body.empresas).toHaveLength(2);
    const empresaA = res.body.empresas.find((e: { tenant_id: string }) => e.tenant_id === tenantAId);
    const empresaB = res.body.empresas.find((e: { tenant_id: string }) => e.tenant_id === tenantBId);
    expect(empresaA.resumo.resumo.pendencias).toBe(1);
    expect(empresaB.resumo.resumo.pendencias).toBe(0);
  });

  it('empresa não acessa /visits/me/day (403 — rota é só de técnico/parceiro)', async () => {
    const res = await request(app.getHttpServer())
      .get('/visits/me/day')
      .set('Authorization', `Bearer ${empresaAToken}`);

    expect(res.status).toBe(403);
  });
});
