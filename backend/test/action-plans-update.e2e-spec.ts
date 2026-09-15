import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('PATCH /action-plans/:id (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tenantId: string;
  let technicianId: string;
  let token: string;
  let actionPlanId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Action Plans Update Teste');
    tenantId = tenant.tenantId;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Action Plans Update Teste');
    const techResult = await (db as any).client.query(
      'INSERT INTO technicians (user_id) VALUES ($1) RETURNING id',
      [tech.userId],
    );
    technicianId = techResult.rows[0].id;
    await (db as any).client.query(
      'INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)',
      [tenantId, technicianId],
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tech.email, password: tech.password });
    token = loginRes.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    const companyUnitId = unitResult.rows[0].id;

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenant_id: tenantId, visited_at: '2026-09-15', company_unit_id: companyUnitId });
    const inspectionId = createRes.body.id;

    const items = createRes.body.items as { id: string; block: string }[];
    const firstItem = items[0];
    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${firstItem.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'NC' });

    const concludeRes = await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${token}`);
    actionPlanId = concludeRes.body.action_plans[0].id;
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM inspections WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('atualiza deadline e responsible de uma ação corretiva', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/action-plans/${actionPlanId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deadline: '2026-10-01', responsible: 'João Silva' });

    expect(res.status).toBe(200);
    expect(res.body.deadline.slice(0, 10)).toBe('2026-10-01');
    expect(res.body.responsible).toBe('João Silva');
  });

  it('esvaziar deadline (string vazia) retorna 200 e limpa pra null, não 400', async () => {
    // Mesmo cenário do achado 3 em inspections-update.e2e-spec.ts: campo
    // "Prazo" já preenchido, usuário apaga e tira o foco (onBlur) — o
    // frontend manda "". @IsISO8601() sozinho rejeitaria com 400.
    const res = await request(app.getHttpServer())
      .patch(`/action-plans/${actionPlanId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ deadline: '' });

    expect(res.status).toBe(200);
    expect(res.body.deadline).toBeNull();
  });

  it('atualiza status pra resolvido', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/action-plans/${actionPlanId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'resolvido' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolvido');
  });

  it('rejeita status inválido (fora de pendente/resolvido)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/action-plans/${actionPlanId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'em_andamento' });

    expect(res.status).toBe(400);
  });

  it('funciona mesmo com a inspeção já concluída (deadline/responsible não travam com assertDraft)', async () => {
    // A inspeção de origem já foi concluída no beforeAll — este PATCH
    // confirma que updateActionPlan não chama assertDraft (decisão da
    // spec §2: prazo/responsável continuam editáveis pós-conclusão).
    const res = await request(app.getHttpServer())
      .patch(`/action-plans/${actionPlanId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ responsible: 'Maria Souza' });

    expect(res.status).toBe(200);
    expect(res.body.responsible).toBe('Maria Souza');
  });
});
