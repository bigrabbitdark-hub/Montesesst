import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('POST /inspections/:id/concluir (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let companyUnitId: string;
  let technicianId: string;
  let technicianToken: string;
  let empresaToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Inspection Concluir Teste');
    tenantId = tenant.tenantId;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Inspection Concluir Teste');
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
    await (db as any).client.query('DELETE FROM inspections WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('rejeita empresa tentando concluir (403) — só técnico conclui', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25', company_unit_id: companyUnitId });
    const inspectionId = createRes.body.id;

    const res = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(403);
  });

  it('gera exatamente um plano de ação por item NC, nenhum para C/N.A.', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25', company_unit_id: companyUnitId });
    const inspectionId = createRes.body.id;
    const items = createRes.body.items;

    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${items[0].id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'NC', notes: 'Não conforme 1' });
    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${items[1].id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'NC', notes: 'Não conforme 2' });
    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${items[2].id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'C' });

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.status).toBe('concluida');
    expect(concludeRes.body.concluded_at).not.toBeNull();
    expect(concludeRes.body.action_plans).toHaveLength(2);
    expect(concludeRes.body.action_plans.map((p: { description: string }) => p.description)).toEqual(
      expect.arrayContaining([items[0].item_label, items[1].item_label]),
    );
  });

  it('conclui sem nenhum item NC — action_plans fica vazio, sem erro', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25', company_unit_id: companyUnitId });
    const inspectionId = createRes.body.id;

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(concludeRes.status).toBe(201);
    expect(concludeRes.body.action_plans).toHaveLength(0);
  });

  it('rejeita concluir de novo uma inspeção já concluída (409)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25', company_unit_id: companyUnitId });
    const inspectionId = createRes.body.id;

    await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);

    const secondRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(secondRes.status).toBe(409);
  });

  it('duas conclusões simultâneas na mesma inspeção: exatamente uma 201, uma 409, e action_plans sem duplicação (regressão de race condition)', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25', company_unit_id: companyUnitId });
    const inspectionId = createRes.body.id;
    const items = createRes.body.items;

    // Marca dois itens como NC para que a conclusão gere action_plans —
    // se o lock de assertDraft não estiver funcionando, uma corrida entre
    // as duas conclusões simultâneas pode gerar dois conjuntos de planos.
    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${items[0].id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'NC', notes: 'Não conforme concorrência 1' });
    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${items[1].id}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'NC', notes: 'Não conforme concorrência 2' });

    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post(`/inspections/${inspectionId}/concluir`)
        .set('Authorization', `Bearer ${technicianToken}`),
      request(app.getHttpServer())
        .post(`/inspections/${inspectionId}/concluir`)
        .set('Authorization', `Bearer ${technicianToken}`),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const actionPlansResult = await (db as any).client.query(
      'SELECT count(*)::int AS count FROM action_plans WHERE inspection_id = $1',
      [inspectionId],
    );
    expect(actionPlansResult.rows[0].count).toBe(2);
  });
});
