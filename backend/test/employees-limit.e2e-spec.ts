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
});
