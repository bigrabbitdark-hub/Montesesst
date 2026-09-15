import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /visits, GET /visits, PATCH /visits/:id/confirmar (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let technicianId: string;
  let technicianUserId: string;
  let technicianToken: string;
  let empresaToken: string;
  let createdVisitId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Visits Create Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Visits Create Teste');
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

    const loginTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = loginTech.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    if (createdVisitId) {
      await (db as any).client.query('DELETE FROM visit_requests WHERE id = $1', [createdVisitId]);
    }
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa solicita visita pra técnico vinculado → 201, status solicitado', async () => {
    const res = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'reuniao',
        preferred_date: '2026-09-10',
        motivo: 'Revisão de PGR',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('solicitado');
    expect(res.body.tenant_id).toBe(tenantId);
    expect(res.body.technician_user_id).toBe(technicianUserId);
    createdVisitId = res.body.id;
  });

  it('empresa solicita visita pra técnico NÃO vinculado ao seu tenant → 403', async () => {
    const otherTech = await db.createUserWithRole('tecnico', 'Tecnico Visits Nao Vinculado Teste');
    const res = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ technician_user_id: otherTech.userId, type: 'reuniao', preferred_date: '2026-09-10' });

    expect(res.status).toBe(403);
  });

  it('técnico confirma a visita solicitada → 200, status confirmado, confirmed_date setada', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${createdVisitId}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-09-12' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmado');
    expect(res.body.confirmed_date).toBe('2026-09-12');
  });

  it('confirmar de novo (já confirmada) → 409', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/visits/${createdVisitId}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-09-13' });

    expect(res.status).toBe(409);
  });

  it('empresa vê a visita na listagem', async () => {
    const res = await request(app.getHttpServer())
      .get('/visits')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body.find((v: { id: string }) => v.id === createdVisitId)).toBeDefined();
  });
});
