import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

async function insertActiveEmployees(db: any, tenantId: string, count: number, cpfStart: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await db.client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, $2, $3, 'ativo')`,
      [tenantId, `Func Extra ${cpfStart + i}`, String(cpfStart + i)],
    );
  }
}

async function countActiveEmployees(db: any, tenantId: string): Promise<number> {
  const res = await db.client.query(`SELECT COUNT(*) FROM employees WHERE tenant_id = $1 AND status = 'ativo'`, [
    tenantId,
  ]);
  return parseInt(res.rows[0].count, 10);
}

async function authorizeSubscription(db: any, tenantId: string, planSlug: string): Promise<void> {
  const planRes = await db.client.query('SELECT id FROM plans WHERE slug = $1', [planSlug]);
  await db.client.query(
    `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
     VALUES ($1, $2, 'authorized', $3)`,
    [planRes.rows[0].id, tenantId, `test-preapproval-${tenantId}-${planSlug}`],
  );
}

describe('Limite de funcionário por plano (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('rejeita criar funcionário quando o tenant já está no limite do plano Start (10)', async () => {
    const tenant = await db.createTenantWithUser('Empresa Limite Start');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');

    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 10 - existing, 40000000000);
    expect(await countActiveEmployees(db, tenant.tenantId)).toBe(10);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;

    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Funcionário 11', cpf: '40000000099' });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Limite de 10 funcionários do plano atingido. Faça upgrade para adicionar mais.');
  });

  it('rejeita reativar funcionário inativo quando o tenant está no limite, mas aceita editar outro campo de um já ativo', async () => {
    const tenant = await db.createTenantWithUser('Empresa Limite Reativacao');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');

    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 10 - existing, 40000001000);
    const inactiveRes = await (db as any).client.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, 'Inativo Teste', '40000001999', 'inativo') RETURNING id`,
      [tenant.tenantId],
    );
    const inactiveId = inactiveRes.rows[0].id;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;

    const reactivateRes = await request(app.getHttpServer())
      .patch(`/employees/${inactiveId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ativo' });
    expect(reactivateRes.status).toBe(403);

    const activeEmployeeId = tenant.employeeId;
    const editRes = await request(app.getHttpServer())
      .patch(`/employees/${activeEmployeeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ position: 'Cargo Editado' });
    expect(editRes.status).toBe(200);
  });

  it('admin bypassa o limite ao criar funcionário pra um tenant já no limite', async () => {
    const tenant = await db.createTenantWithUser('Empresa Limite Admin');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');
    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 10 - existing, 40000002000);

    const adminUser = await db.createUserWithRole('admin', 'Admin Limite Teste');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminUser.email, password: adminUser.password });
    const token = login.body.access_token;

    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Funcionário Via Admin', cpf: '40000002999', tenant_id: tenant.tenantId });

    expect(res.status).toBe(201);
  });

  it('tenant em trial (sem assinatura authorized) nunca é bloqueado', async () => {
    const tenant = await db.createTenantWithUser('Empresa Sem Assinatura');
    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 15 - existing, 40000003000);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;

    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Funcionário 16 Sem Plano', cpf: '40000003999' });

    expect(res.status).toBe(201);
  });

  it('duas assinaturas authorized simultâneas usam o maior limite (Premium 50, não Start 10)', async () => {
    const tenant = await db.createTenantWithUser('Empresa Duas Assinaturas');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-premium');

    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 10 - existing, 40000004000);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;

    // Já tem 10 funcionários (o limite do Start), mas a assinatura Premium
    // (limite 50) também está ativa — não deveria ser bloqueado ainda.
    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Funcionário 11 Com Premium Ativo', cpf: '40000004999' });

    expect(res.status).toBe(201);
  });

  it('importação em lote: parte aceita, parte rejeitada por limite, resto do lote continua', async () => {
    const tenant = await db.createTenantWithUser('Empresa Limite Import');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');
    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 8 - existing, 40000005000);
    // Tenant agora tem exatamente 8 funcionários ativos, limite Start = 10.

    const unitRes = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Limite Import', 'Rua Teste', 'Cidade Teste', 'SC', '88800000') RETURNING name`,
      [tenant.tenantId],
    );
    const unitName = unitRes.rows[0].name;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;

    // 4 linhas: só as 2 primeiras cabem no limite (8 + 2 = 10), as 2
    // últimas devem ser rejeitadas por limite, não por outro motivo.
    const csv =
      'nome,cpf,cargo,filial\n' +
      `Linha Um,40000005900,Cargo,${unitName}\n` +
      `Linha Dois,40000005901,Cargo,${unitName}\n` +
      `Linha Tres,40000005902,Cargo,${unitName}\n` +
      `Linha Quatro,40000005903,Cargo,${unitName}\n`;

    const res = await request(app.getHttpServer())
      .post('/employees/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf-8'), { filename: 'funcionarios.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(2);
    expect(res.body.erros).toHaveLength(2);
    expect(res.body.erros[0].motivo).toBe('Limite de funcionários do plano atingido');
    expect(res.body.erros[1].motivo).toBe('Limite de funcionários do plano atingido');
    expect(await countActiveEmployees(db, tenant.tenantId)).toBe(10);
  });

  it('admin bypassa o limite na importação em lote', async () => {
    const tenant = await db.createTenantWithUser('Empresa Limite Import Admin');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');
    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 10 - existing, 40000006000);

    const unitRes = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Limite Import Admin', 'Rua Teste', 'Cidade Teste', 'SC', '88800000') RETURNING name`,
      [tenant.tenantId],
    );
    const unitName = unitRes.rows[0].name;

    const adminUser = await db.createUserWithRole('admin', 'Admin Limite Import');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminUser.email, password: adminUser.password });
    const token = login.body.access_token;

    const csv = 'nome,cpf,cargo,filial\n' + `Via Admin,40000006900,Cargo,${unitName}\n`;

    const res = await request(app.getHttpServer())
      .post(`/employees/import?tenant_id=${tenant.tenantId}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf-8'), { filename: 'funcionarios.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(1);
    expect(res.body.erros).toHaveLength(0);
  });

  it('assinatura Enterprise ativa (employee_limit NULL) misturada com uma numérica resulta em sem limite', async () => {
    const tenant = await db.createTenantWithUser('Empresa Enterprise Misturada');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-enterprise');

    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 10 - existing, 40000007000);
    // Tenant já tem 10 funcionários (o limite do Start), mas também tem uma
    // assinatura Enterprise ativa (employee_limit NULL) — não deveria ser
    // bloqueado, já que qualquer assinatura sem limite faz o resultado ser
    // "sem limite", mesmo com outra numérica também ativa.

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;

    const res = await request(app.getHttpServer())
      .post('/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Funcionário 11 Com Enterprise Ativo', cpf: '40000007999' });

    expect(res.status).toBe(201);
  });

  it('importação via import-mapped (endpoint que o frontend usa de verdade) também respeita o limite', async () => {
    const tenant = await db.createTenantWithUser('Empresa Limite Import Mapped');
    await authorizeSubscription(db, tenant.tenantId, 'empresa-start');
    const existing = await countActiveEmployees(db, tenant.tenantId);
    await insertActiveEmployees(db, tenant.tenantId, 9 - existing, 40000008000);
    // Tenant com 9 funcionários ativos, limite Start = 10 — só a 1ª linha cabe.

    const unitRes = await (db as any).client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Matriz Limite Import Mapped', 'Rua Teste', 'Cidade Teste', 'SC', '88800000') RETURNING name`,
      [tenant.tenantId],
    );
    const unitName = unitRes.rows[0].name;

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    const token = login.body.access_token;

    const csv =
      'Documento,Nome Completo,Unidade,Função\n' +
      `40000008900,Linha Um,${unitName},Cargo\n` +
      `40000008901,Linha Dois,${unitName},Cargo\n`;

    const res = await request(app.getHttpServer())
      .post('/employees/import-mapped')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', JSON.stringify({ nome: 1, cpf: 0, cargo: 3, filial: 2 }))
      .attach('file', Buffer.from(csv, 'utf-8'), { filename: 'funcionarios.csv', contentType: 'text/csv' });

    expect(res.status).toBe(201);
    expect(res.body.importados).toBe(1);
    expect(res.body.erros).toHaveLength(1);
    expect(res.body.erros[0].motivo).toBe('Limite de funcionários do plano atingido');
  });
});
