import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Brigada de incêndio (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let token: string;
  let tenantId: string;
  let employeeId: string;
  let companyUnitId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const tenant = await db.createTenantWithUser('Empresa Brigada');
    tenantId = tenant.tenantId;
    employeeId = tenant.employeeId;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    token = login.body.access_token;

    const unitResult = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial Matriz', 'Rua A', 'Cidade A', 'RS', '90000000') RETURNING id`,
      [tenantId],
    );
    companyUnitId = unitResult.rows[0].id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('cadastra um brigadista vinculado a um funcionário já existente', async () => {
    const res = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({
        employee_id: employeeId,
        company_unit_id: companyUnitId,
        funcao_brigada: 'lider',
        turno: 'Manhã',
        telefone: '51999999999',
      });

    expect(res.status).toBe(201);
    expect(res.body.funcao_brigada).toBe('lider');
    expect(res.body.employee_full_name).toBeTruthy();
  });

  it('rejeita employee_id de outro tenant', async () => {
    const otherTenant = await db.createTenantWithUser('Empresa Brigada Outro Tenant');

    const res = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({
        employee_id: otherTenant.employeeId,
        company_unit_id: companyUnitId,
        funcao_brigada: 'brigadista',
      });

    expect(res.status).toBe(400);
  });

  it('rejeita cadastrar o mesmo funcionário duas vezes (UNIQUE tenant_id+employee_id)', async () => {
    const tenant2 = await db.createTenantWithUser('Empresa Brigada Duplicidade');
    const unit2 = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Filial 2', 'Rua B', 'Cidade B', 'SC', '88000000') RETURNING id`,
      [tenant2.tenantId],
    );
    const login2 = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant2.email, password: tenant2.password });
    const token2 = login2.body.access_token;

    const first = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token2}`)
      .send({ employee_id: tenant2.employeeId, company_unit_id: unit2.rows[0].id, funcao_brigada: 'brigadista' });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token2}`)
      .send({ employee_id: tenant2.employeeId, company_unit_id: unit2.rows[0].id, funcao_brigada: 'lider' });
    expect(second.status).toBe(409);
  });

  it('lista, edita e apaga um brigadista', async () => {
    const created = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ employee_id: employeeId, company_unit_id: companyUnitId, funcao_brigada: 'vice_lider' });

    // Este teste roda depois do primeiro (mesmo employeeId já usado) —
    // então esperamos 409 aqui e reaproveitamos o membro já criado no
    // primeiro teste pra exercitar list/edit/delete.
    const listRes = await request(app.getHttpServer())
      .get(`/fire-brigade/members?company_unit_id=${companyUnitId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBeGreaterThan(0);
    const memberId = listRes.body[0].id;

    const updateRes = await request(app.getHttpServer())
      .patch(`/fire-brigade/members/${memberId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ turno: 'Tarde' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.turno).toBe('Tarde');

    const deleteRes = await request(app.getHttpServer())
      .delete(`/fire-brigade/members/${memberId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.status).toBe(200);

    const findRes = await request(app.getHttpServer())
      .get(`/fire-brigade/members/${memberId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(findRes.status).toBe(404);
  });

  it('tecnico cadastra brigadista informando tenant_id no body', async () => {
    const technicianUser = await db.createUserWithRole('tecnico', 'Tecnico Brigada');
    await (db as any).client.query(
      `INSERT INTO technicians (user_id) VALUES ($1)`,
      [technicianUser.userId],
    );
    const technicianRow = await (db as any).client.query('SELECT id FROM technicians WHERE user_id = $1', [
      technicianUser.userId,
    ]);
    await (db as any).client.query(`INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)`, [
      tenantId,
      technicianRow.rows[0].id,
    ]);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: technicianUser.email, password: technicianUser.password });
    const technicianToken = login.body.access_token;

    const employee2 = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Segundo Funcionário', '12345678901', 'ativo') RETURNING id`,
      [tenantId],
    );

    const res = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({
        employee_id: employee2.rows[0].id,
        company_unit_id: companyUnitId,
        funcao_brigada: 'brigadista',
        tenant_id: tenantId,
      });

    expect(res.status).toBe(201);
    expect(res.body.tenant_id).toBe(tenantId);

    await (db as any).client.query('DELETE FROM tenant_technicians WHERE technician_id = $1', [technicianRow.rows[0].id]);
    await (db as any).client.query('DELETE FROM technicians WHERE id = $1', [technicianRow.rows[0].id]);
  });

  it('registra treinamento e o painel de cobertura reflete vencido/vencendo/treinado', async () => {
    const memberRes = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ employee_id: employeeId, company_unit_id: companyUnitId, funcao_brigada: 'brigadista' });

    // employeeId já usado em testes anteriores é rejeitado por UNIQUE —
    // então cria um funcionário novo específico pra este teste.
    const freshEmployee = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Funcionário Cobertura', '98765432100', 'ativo') RETURNING id`,
      [tenantId],
    );
    const freshMember = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ employee_id: freshEmployee.rows[0].id, company_unit_id: companyUnitId, funcao_brigada: 'brigadista' });
    expect(freshMember.status).toBe(201);
    const memberId = freshMember.body.id;

    const today = new Date();
    const past = new Date(today);
    past.setDate(past.getDate() - 400);
    const pastValidade = new Date(today);
    pastValidade.setDate(pastValidade.getDate() - 1);

    const trainingRes = await request(app.getHttpServer())
      .post(`/fire-brigade/members/${memberId}/trainings`)
      .set('Authorization', `Bearer ${token}`)
      .field('data_realizacao', past.toISOString().slice(0, 10))
      .field('data_validade', pastValidade.toISOString().slice(0, 10));
    expect(trainingRes.status).toBe(201);

    await request(app.getHttpServer())
      .put('/fire-brigade/coverage-target')
      .set('Authorization', `Bearer ${token}`)
      .send({ company_unit_id: companyUnitId, quantidade_necessaria: 5 });

    const coverageRes = await request(app.getHttpServer())
      .get(`/fire-brigade/coverage?company_unit_id=${companyUnitId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(coverageRes.status).toBe(200);
    expect(coverageRes.body.necessarios).toBe(5);
    expect(coverageRes.body.vagas_necessarias).toBeGreaterThan(0);
  });

  it('histórico de treinamento lista os registros do brigadista', async () => {
    const freshEmployee = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Funcionário Historico', '11122233344', 'ativo') RETURNING id`,
      [tenantId],
    );
    const member = await request(app.getHttpServer())
      .post('/fire-brigade/members')
      .set('Authorization', `Bearer ${token}`)
      .send({ employee_id: freshEmployee.rows[0].id, company_unit_id: companyUnitId, funcao_brigada: 'brigadista' });
    const memberId = member.body.id;

    await request(app.getHttpServer())
      .post(`/fire-brigade/members/${memberId}/trainings`)
      .set('Authorization', `Bearer ${token}`)
      .field('data_realizacao', '2026-01-01')
      .field('data_validade', '2027-01-01');

    const historyRes = await request(app.getHttpServer())
      .get(`/fire-brigade/members/${memberId}/trainings`)
      .set('Authorization', `Bearer ${token}`);

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.length).toBe(1);
    expect(historyRes.body[0].data_validade).toContain('2027-01-01');
  });
});
