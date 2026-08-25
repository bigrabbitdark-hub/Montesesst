import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST/GET /inspections — criação, semeadura de itens, listagem (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let technicianId: string;
  let technicianToken: string;
  let empresaToken: string;
  let createdInspectionId: string | undefined;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection Create Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Inspection Create Teste');
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
    if (createdInspectionId) {
      await (db as any).client.query('DELETE FROM inspections WHERE id = $1', [createdInspectionId]);
    }
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('técnico cria uma inspeção e ela vem com os 16 itens de checklist semeados', async () => {
    const res = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('rascunho');
    expect(res.body.items).toHaveLength(16);
    expect(res.body.action_plans).toHaveLength(0);
    expect(res.body.items.filter((i: { block: string }) => i.block === 'documentacao')).toHaveLength(4);
    createdInspectionId = res.body.id;
  });

  it('empresa rejeitada tentando criar (403) — só técnico cria', async () => {
    const res = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${empresaToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25' });

    expect(res.status).toBe(403);
  });

  it('empresa vê a inspeção na listagem (sem precisar de tenant_id) e no detalhe', async () => {
    const listRes = await request(app.getHttpServer())
      .get('/inspections')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.find((i: { id: string }) => i.id === createdInspectionId)).toBeDefined();

    const detailRes = await request(app.getHttpServer())
      .get(`/inspections/${createdInspectionId}`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.items).toHaveLength(16);
  });

  it('técnico sem tenant_id na listagem recebe 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(400);
  });
});
