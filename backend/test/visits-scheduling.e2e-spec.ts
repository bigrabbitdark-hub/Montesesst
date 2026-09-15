import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /visits — tipo/horário/filial (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let empresaToken: string;
  let technicianUserId: string;
  let technicianToken: string;
  let companyUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Agendamento Teste');
    tenantId = tenant.tenantId;
    const empresaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    empresaToken = empresaLogin.body.access_token;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Agendamento Teste');
    technicianUserId = tech.userId;
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, techResult.rows[0].id],
    );
    const techLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    technicianToken = techLogin.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM visit_requests WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE user_id = $1', [technicianUserId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cria pedido de visita com filial obrigatória', async () => {
    const res = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'visita',
        preferred_date: '2026-10-01',
        preferred_time: '14:00',
        company_unit_id: companyUnitId,
        motivo: 'Inspeção trimestral',
      });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('visita');
    expect(res.body.preferred_time).toBe('14:00');
    expect(res.body.company_unit_id).toBe(companyUnitId);
  });

  it('rejeita pedido de visita sem filial', async () => {
    const res = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'visita',
        preferred_date: '2026-10-01',
      });

    expect(res.status).toBe(400);
  });

  it('cria pedido de reunião sem exigir filial', async () => {
    const res = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'reuniao',
        preferred_date: '2026-10-02',
        preferred_time: '10:00',
        motivo: 'Dúvidas sobre PGR',
      });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('reuniao');
    expect(res.body.company_unit_id).toBeNull();
  });

  it('técnico confirma com horário diferente do sugerido', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/visits')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({
        technician_user_id: technicianUserId,
        type: 'reuniao',
        preferred_date: '2026-10-03',
        preferred_time: '09:00',
        motivo: 'Reunião de alinhamento',
      });
    const visitId = createRes.body.id;

    const confirmRes = await request(app.getHttpServer())
      .patch(`/visits/${visitId}/confirmar`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ confirmed_date: '2026-10-04', confirmed_time: '15:30' });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('confirmado');
    expect(confirmRes.body.confirmed_date.slice(0, 10)).toBe('2026-10-04');
    expect(confirmRes.body.confirmed_time).toBe('15:30');
  });
});
