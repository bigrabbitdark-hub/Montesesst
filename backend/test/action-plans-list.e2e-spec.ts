import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /action-plans (e2e)', () => {
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
    const tenant = await db.createTenantWithUser('Empresa Action Plans Teste');
    tenantId = tenant.tenantId;

    // Fallout da Task 1 do plano "Relatório de Visita Técnica"
    // (company_unit_id passou a ser obrigatório em POST /inspections) que
    // não tinha sido corrigido neste arquivo pré-existente — achado real
    // rodando a regressão completa da Task 3 (Step 8 do brief), mesmo
    // padrão exato usado nos outros 5 arquivos corrigidos na Task 1.
    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Teste', 'Rua Teste', 'Cidade Teste', 'SP', '01000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;

    const tech = await db.createUserWithRole('tecnico', 'Tecnico Action Plans Teste');
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

    const createRes = await request(app.getHttpServer())
      .post('/inspections')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ tenant_id: tenantId, visited_at: '2026-08-25', company_unit_id: companyUnitId });
    const inspectionId = createRes.body.id;
    const itemId = createRes.body.items[0].id;

    await request(app.getHttpServer())
      .patch(`/inspections/${inspectionId}/items/${itemId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ status: 'NC' });

    await request(app.getHttpServer())
      .post(`/inspections/${inspectionId}/concluir`)
      .set('Authorization', `Bearer ${technicianToken}`);
  });

  afterAll(async () => {
    await (db as any).client.query('DELETE FROM inspections WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantId]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa lista os planos de ação do próprio tenant, status pendente por padrão', async () => {
    const res = await request(app.getHttpServer())
      .get('/action-plans')
      .set('Authorization', `Bearer ${empresaToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('pendente');
  });

  it('técnico sem tenant_id recebe 400', async () => {
    const res = await request(app.getHttpServer())
      .get('/action-plans')
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(400);
  });

  it('técnico com tenant_id vê os planos de ação da empresa vinculada', async () => {
    const res = await request(app.getHttpServer())
      .get(`/action-plans?tenant_id=${tenantId}`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});
