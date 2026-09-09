import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Ações corretivas de prevenção (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let checklistItemId: string;
  let drillId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Acoes Corretivas');
    tenantId = tenant.tenantId;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = login.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial Matriz', 'Rua A', 'Cidade A', 'RS', '90000000') RETURNING id`,
      [tenantId],
    );
    const companyUnitId = unitResult.rows[0].id;

    const checklistResult = await (db as any).client.query(
      `INSERT INTO prevention_checklists (tenant_id, company_unit_id, technician_user_id, data_realizacao)
       VALUES ($1, $2, $3, '2026-01-01') RETURNING id`,
      [tenantId, companyUnitId, tenant.userId],
    );
    const itemResult = await (db as any).client.query(
      `INSERT INTO prevention_checklist_items (checklist_id, item_key, item_label, status)
       VALUES ($1, 'extintores_acessiveis', 'Extintores acessíveis', 'NC') RETURNING id`,
      [checklistResult.rows[0].id],
    );
    checklistItemId = itemResult.rows[0].id;

    const drillResult = await (db as any).client.query(
      `INSERT INTO emergency_drills (tenant_id, company_unit_id, data_realizacao, created_by_user_id)
       VALUES ($1, $2, '2026-01-01', $3) RETURNING id`,
      [tenantId, companyUnitId, tenant.userId],
    );
    drillId = drillResult.rows[0].id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('lista ações corretivas pendentes de um tenant', async () => {
    await (db as any).client.query(
      `INSERT INTO prevention_corrective_actions (tenant_id, checklist_item_id, description)
       VALUES ($1, $2, 'Extintores acessíveis')`,
      [tenantId, checklistItemId],
    );

    const res = await request(app.getHttpServer())
      .get('/prevention-corrective-actions?status=pendente')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.some((a: any) => a.description === 'Extintores acessíveis')).toBe(true);
  });

  it('marca uma ação corretiva como resolvida', async () => {
    const created = await (db as any).client.query(
      `INSERT INTO prevention_corrective_actions (tenant_id, drill_id, description)
       VALUES ($1, $2, 'Falha de sinalização identificada no simulado') RETURNING id`,
      [tenantId, drillId],
    );

    const res = await request(app.getHttpServer())
      .patch(`/prevention-corrective-actions/${created.rows[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'resolvido' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolvido');
  });

  it('rejeita status inválido', async () => {
    const created = await (db as any).client.query(
      `INSERT INTO prevention_corrective_actions (tenant_id, checklist_item_id, description)
       VALUES ($1, $2, 'Teste') RETURNING id`,
      [tenantId, checklistItemId],
    );

    const res = await request(app.getHttpServer())
      .patch(`/prevention-corrective-actions/${created.rows[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'invalido' });

    expect(res.status).toBe(400);
  });

  it('constraint impede ter checklist_item_id e drill_id ao mesmo tempo', async () => {
    await expect(
      (db as any).client.query(
        `INSERT INTO prevention_corrective_actions (tenant_id, checklist_item_id, drill_id, description)
         VALUES ($1, $2, $3, 'Inválido')`,
        [tenantId, checklistItemId, drillId],
      ),
    ).rejects.toThrow();
  });

});
