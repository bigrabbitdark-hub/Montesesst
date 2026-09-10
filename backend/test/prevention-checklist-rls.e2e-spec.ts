import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Isolamento multi-tenant via RLS em prevention-checklist (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenB: string;
  let tenantAId: string;
  let companyUnitAId: string;
  let checklistAId: string;
  let itemAId: string;

  let technicianAToken: string;
  let technicianBToken: string;
  let unlinkedTechnicianToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenantA = await db.createTenantWithUser('Empresa Checklist RLS A');
    const tenantB = await db.createTenantWithUser('Empresa Checklist RLS B');
    tenantAId = tenantA.tenantId;

    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantB.email, password: tenantB.password });
    tokenB = loginB.body.access_token;

    // Técnico vinculado a tenant A — só usado pra criar o checklist de
    // fixture (POST exige @Roles('tecnico', 'parceiro'); 'empresa' nunca
    // chega nessa rota).
    const technicianA = await db.createUserWithRole('tecnico', 'Tecnico Checklist RLS A');
    await (db as any).client.query(`INSERT INTO technicians (user_id) VALUES ($1)`, [technicianA.userId]);
    const technicianARow = await (db as any).client.query('SELECT id FROM technicians WHERE user_id = $1', [
      technicianA.userId,
    ]);
    await (db as any).client.query(`INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)`, [
      tenantAId,
      technicianARow.rows[0].id,
    ]);
    const loginTechnicianA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: technicianA.email, password: technicianA.password });
    technicianAToken = loginTechnicianA.body.access_token;

    // Técnico vinculado a tenant B — usado pro caso de PATCH cross-tenant,
    // pra provar que o 404 vem da RLS/assertDraft (não do @Roles, que
    // 'empresa' já não passaria de qualquer forma).
    const technicianB = await db.createUserWithRole('tecnico', 'Tecnico Checklist RLS B');
    await (db as any).client.query(`INSERT INTO technicians (user_id) VALUES ($1)`, [technicianB.userId]);
    const technicianBRow = await (db as any).client.query('SELECT id FROM technicians WHERE user_id = $1', [
      technicianB.userId,
    ]);
    await (db as any).client.query(`INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)`, [
      tenantB.tenantId,
      technicianBRow.rows[0].id,
    ]);
    const loginTechnicianB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: technicianB.email, password: technicianB.password });
    technicianBToken = loginTechnicianB.body.access_token;

    // Técnico sem nenhum vínculo (sem linha em technicians/tenant_technicians
    // pra tenant A) — mesmo padrão de fire-brigade-rls.e2e-spec.ts pra provar
    // que assertCompanyUnitBelongsToTenant não enxerga a filial de tenant A.
    const unlinkedTech = await db.createUserWithRole('tecnico', 'Tecnico Checklist RLS Nao Vinculado');
    const loginUnlinkedTech = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: unlinkedTech.email, password: unlinkedTech.password });
    unlinkedTechnicianToken = loginUnlinkedTech.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial RLS A', 'Rua A', 'Cidade A', 'RS', '90000000') RETURNING id`,
      [tenantAId],
    );
    companyUnitAId = unitResult.rows[0].id;

    const created = await request(app.getHttpServer())
      .post('/prevention-checklists')
      .set('Authorization', `Bearer ${technicianAToken}`)
      .send({ company_unit_id: companyUnitAId, data_realizacao: '2026-02-01', tenant_id: tenantAId });
    checklistAId = created.body.id;
    itemAId = created.body.items[0].id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /prevention-checklists de tenant B (query do próprio tenant, sem tenant_id) não inclui checklist de tenant A', async () => {
    const res = await request(app.getHttpServer())
      .get('/prevention-checklists')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    expect(res.body.some((c: any) => c.id === checklistAId)).toBe(false);
  });

  it('GET /prevention-checklists/:id de tenant B no id de tenant A devolve 404 (linha invisível pra RLS)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/prevention-checklists/${checklistAId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(404);
  });

  // updateItem() chama assertDraft(client, checklistId) ANTES de tocar em
  // prevention_checklist_items — assertDraft faz
  // `SELECT status, tenant_id FROM prevention_checklists WHERE id = $1 FOR UPDATE`,
  // e prevention_checklists tem RLS por tenant_id/assigned_tenant_ids. Pro
  // técnico de tenant B, o checklist de tenant A é invisível nessa query, o
  // SELECT vem vazio, e assertDraft lança NotFoundException antes mesmo de
  // chegar ao UPDATE em prevention_checklist_items (cuja própria RLS também
  // bloquearia, via EXISTS em prevention_checklists — ver migration 0039).
  it('PATCH /prevention-checklists/:id/items/:itemId de tenant B no id de tenant A devolve 404', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/prevention-checklists/${checklistAId}/items/${itemAId}`)
      .set('Authorization', `Bearer ${technicianBToken}`)
      .send({ status: 'NC', observacoes: 'Tentativa de tenant B' });

    expect(res.status).toBe(404);

    // Confirma que o item de tenant A não foi alterado, relendo com o
    // técnico de A (que enxerga o checklist normalmente).
    const stillA = await request(app.getHttpServer())
      .get(`/prevention-checklists/${checklistAId}`)
      .set('Authorization', `Bearer ${technicianAToken}`);
    expect(stillA.status).toBe(200);
    const itemStillA = stillA.body.items.find((i: any) => i.id === itemAId);
    expect(itemStillA.status).not.toBe('NC');
    expect(itemStillA.observacoes).not.toBe('Tentativa de tenant B');
  });

  // create() chama assertCompanyUnitBelongsToTenant ANTES de qualquer INSERT
  // — diferente de fire-brigade (que lança BadRequestException nesse mesmo
  // caso), PreventionChecklistService.assertCompanyUnitBelongsToTenant lança
  // NotFoundException ('Filial não encontrada'), então aqui o resultado é
  // 404, não 400. A garantia de segurança é a mesma (o vínculo nunca chega a
  // ser criado pra um tenant ao qual o técnico não tem acesso): um técnico
  // sem vínculo com tenant A não enxerga a company_unit de A nem por esse
  // SELECT explícito (RLS de company_units, migration 0038), então o código
  // nunca chega a tentar o INSERT em prevention_checklists.
  it('técnico SEM vínculo com tenant A é rejeitado (404, "Filial não encontrada") ao tentar POST com tenant_id de tenant A no corpo', async () => {
    const res = await request(app.getHttpServer())
      .post('/prevention-checklists')
      .set('Authorization', `Bearer ${unlinkedTechnicianToken}`)
      .send({
        company_unit_id: companyUnitAId,
        data_realizacao: '2026-02-05',
        tenant_id: tenantAId,
      });

    expect(res.status).toBe(404);
  });
});
