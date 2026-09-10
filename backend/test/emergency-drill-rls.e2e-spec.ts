import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS em emergency-drill (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tenantAId: string;
  let drillAId: string;
  let correctiveActionAId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Simulado RLS A');
    const tenantB = await db.createTenantWithUser('Empresa Simulado RLS B');
    tenantAId = tenantA.tenantId;

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    tokenA = loginA.body.access_token;

    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.email, password: tenantB.password });
    tokenB = loginB.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial RLS A', 'Rua A', 'Cidade A', 'RS', '90000000') RETURNING id`,
      [tenantAId],
    );
    const companyUnitAId = unitResult.rows[0].id;

    // falhas_sinalizacao: true faz o create() gerar automaticamente uma
    // prevention_corrective_action com drill_id = este simulado (ver
    // EmergencyDrillService.create / PROBLEM_FLAG_DESCRIPTIONS) — usada
    // abaixo pro caso de PATCH cross-tenant numa ação corretiva de origem
    // simulado, não checklist.
    const created = await request(app.getHttpServer())
      .post('/emergency-drills')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        company_unit_id: companyUnitAId,
        data_realizacao: '2026-04-01',
        falhas_sinalizacao: true,
        participants: [],
      });
    drillAId = created.body.id;

    const actionsRes = await request(app.getHttpServer())
      .get(`/prevention-corrective-actions?tenant_id=${tenantAId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    correctiveActionAId = actionsRes.body.find((a: any) => a.drill_id === drillAId).id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /emergency-drills de tenant B (query do próprio tenant, sem tenant_id) não inclui simulado de tenant A', async () => {
    const res = await request(app.getHttpServer())
      .get('/emergency-drills')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.some((d: any) => d.id === drillAId)).toBe(false);
  });

  it('GET /emergency-drills/:id de tenant B no id de tenant A devolve 404 (linha invisível pra RLS)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/emergency-drills/${drillAId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });

  // PreventionCorrectiveActionsService.updateStatus() não faz nenhum filtro
  // explícito de tenant_id na query (`UPDATE prevention_corrective_actions
  // SET status = $2 WHERE id = $1 RETURNING *`) — quem garante o isolamento
  // é só a RLS da própria tabela (migration 0039: mesma cláusula
  // tenant_id = current tenant / assigned_tenant_ids). Pra tenant B, a linha
  // de tenant A é invisível, o UPDATE afeta 0 linhas, RETURNING vem vazio, e
  // o service lança NotFoundException -> 404. Mesmo comportamento pra ação
  // corretiva de origem checklist (Task 4/5) e de origem simulado (aqui) —
  // a RLS não distingue a origem.
  it('PATCH /prevention-corrective-actions/:id de tenant B numa ação corretiva de simulado de tenant A devolve 404', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/prevention-corrective-actions/${correctiveActionAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ status: 'resolvido' });

    expect(res.status).toBe(404);

    // Confirma que a ação corretiva de tenant A continua 'pendente'.
    const stillA = await request(app.getHttpServer())
      .get(`/prevention-corrective-actions?tenant_id=${tenantAId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    const action = stillA.body.find((a: any) => a.id === correctiveActionAId);
    expect(action.status).toBe('pendente');
  });
});
