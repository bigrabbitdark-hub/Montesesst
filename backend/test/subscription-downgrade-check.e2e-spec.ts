import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

// ITEM 031 (auditoria 2026-09-27): downgrade nunca desativa funcionário (decisão do
// fundador), mas a empresa precisa ser AVISADA no momento da troca, antes do checkout.
describe('GET /subscriptions/downgrade-check (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let startPlanId: string;
  let premiumPlanId: string;
  let tecnicoPlanId: string;

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const raw = (db as any).client;
    const plans = await raw.query(`SELECT id, slug FROM plans WHERE slug IN ('empresa-start','empresa-premium','tecnico-start')`);
    const idOf = (slug: string) => plans.rows.find((p: any) => p.slug === slug).id;
    startPlanId = idOf('empresa-start'); // employee_limit 10
    premiumPlanId = idOf('empresa-premium'); // employee_limit 50
    tecnicoPlanId = idOf('tecnico-start'); // employee_limit null
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const login = (email: string, password: string) => api().post('/auth/login').send({ email, password });
  const check = (token: string, planId: string) =>
    api().get('/subscriptions/downgrade-check').query({ plan_id: planId }).set('Authorization', `Bearer ${token}`);

  const addEmployees = async (tenantId: string, count: number, status = 'ativo') => {
    const raw = (db as any).client;
    for (let i = 0; i < count; i++) {
      await raw.query(`INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, $2, $3, $4)`, [
        tenantId,
        `Func Downgrade ${i}`,
        String(10000000000 + Math.floor(Math.random() * 89999999999)),
        status,
      ]);
    }
  };

  it('sem exceder o limite do novo plano: warning null, nada é criado', async () => {
    const tenant = await db.createTenantWithUser('Empresa Downgrade Sem Excesso');
    const token = (await login(tenant.email, tenant.password)).body.access_token;
    await addEmployees(tenant.tenantId, 3); // 1 (fixture) + 3 = 4, bem abaixo de 10

    const res = await check(token, startPlanId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ warning: null });
  });

  it('excedendo o limite do novo plano: warning com o número certo de funcionários e o limite', async () => {
    const tenant = await db.createTenantWithUser('Empresa Downgrade Com Excesso');
    const token = (await login(tenant.email, tenant.password)).body.access_token;
    await addEmployees(tenant.tenantId, 12); // 1 (fixture) + 12 = 13 > limite 10 do Start

    const res = await check(token, startPlanId);
    expect(res.status).toBe(200);
    expect(res.body.warning).toContain('10 funcionários');
    expect(res.body.warning).toContain('13 hoje');
    expect(res.body.warning).not.toMatch(/desativad/i); // decisão do fundador: nunca desativa
  });

  it('exatamente no limite (não excede): sem aviso', async () => {
    const tenant = await db.createTenantWithUser('Empresa Downgrade No Limite');
    const token = (await login(tenant.email, tenant.password)).body.access_token;
    await addEmployees(tenant.tenantId, 9); // 1 (fixture) + 9 = 10, igual ao limite

    const res = await check(token, startPlanId);
    expect(res.body).toEqual({ warning: null });
  });

  it('funcionário INATIVO não conta pro excedente', async () => {
    const tenant = await db.createTenantWithUser('Empresa Downgrade Inativos');
    const token = (await login(tenant.email, tenant.password)).body.access_token;
    await addEmployees(tenant.tenantId, 3, 'ativo'); // 1 + 3 = 4 ativos
    await addEmployees(tenant.tenantId, 20, 'inativo'); // não deveria contar

    const res = await check(token, startPlanId);
    expect(res.body).toEqual({ warning: null });
  });

  it('plano SEM limite (Enterprise) nunca gera aviso, mesmo com muitos funcionários', async () => {
    const enterprisePlan = (await (db as any).client.query(`SELECT id FROM plans WHERE slug = 'empresa-enterprise'`)).rows[0].id;
    const tenant = await db.createTenantWithUser('Empresa Downgrade Enterprise');
    const token = (await login(tenant.email, tenant.password)).body.access_token;
    await addEmployees(tenant.tenantId, 15);

    const res = await check(token, enterprisePlan);
    expect(res.body).toEqual({ warning: null });
  });

  it('plano de OUTRA empresa não é confundido: cada checagem usa só o próprio tenant', async () => {
    const a = await db.createTenantWithUser('Empresa Downgrade A');
    const b = await db.createTenantWithUser('Empresa Downgrade B');
    await addEmployees(a.tenantId, 12); // A excede
    const tokenB = (await login(b.email, b.password)).body.access_token; // B não excede (só o fixture)

    const res = await check(tokenB, startPlanId);
    expect(res.body).toEqual({ warning: null });
  });

  it('plan_id de plano de TÉCNICO (sem employee_limit, audience errada): 404', async () => {
    const tenant = await db.createTenantWithUser('Empresa Downgrade Plano Errado');
    const token = (await login(tenant.email, tenant.password)).body.access_token;

    const res = await check(token, tecnicoPlanId);
    expect(res.status).toBe(404);
  });

  it('plan_id inexistente: 404 (não 500)', async () => {
    const tenant = await db.createTenantWithUser('Empresa Downgrade Plano Inexistente');
    const token = (await login(tenant.email, tenant.password)).body.access_token;

    const res = await check(token, '00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('plan_id que não é um UUID válido: 404 (não 500)', async () => {
    const tenant = await db.createTenantWithUser('Empresa Downgrade UUID Invalido');
    const token = (await login(tenant.email, tenant.password)).body.access_token;

    const res = await check(token, 'nao-e-um-uuid');
    expect(res.status).toBe(404);
  });

  it('bloqueia role técnico e admin (só empresa usa esta checagem)', async () => {
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Downgrade Check');
    const admin = await db.createUserWithRole('admin', 'Admin Downgrade Check');
    const tokenTecnico = (await login(tecnico.email, tecnico.password)).body.access_token;
    const tokenAdmin = (await login(admin.email, admin.password)).body.access_token;

    expect((await check(tokenTecnico, startPlanId)).status).toBe(403);
    expect((await check(tokenAdmin, startPlanId)).status).toBe(403);
  });

  it('sem login: 401', async () => {
    const res = await api().get('/subscriptions/downgrade-check').query({ plan_id: startPlanId });
    expect(res.status).toBe(401);
  });

  it('continua acessível mesmo com assinatura inativa (faz parte do fluxo de trocar de plano, como POST /subscriptions)', async () => {
    const tenant = await db.createTenantWithUser('Empresa Downgrade Bloqueada');
    const planRes = await (db as any).client.query('SELECT id FROM plans WHERE slug = $1', ['empresa-start']);
    await (db as any).client.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id) VALUES ($1, $2, 'cancelled', $3)`,
      [planRes.rows[0].id, tenant.tenantId, `test-preapproval-downgrade-${tenant.tenantId}`],
    );
    const token = (await login(tenant.email, tenant.password)).body.access_token;

    const res = await check(token, premiumPlanId);
    expect(res.status).toBe(200); // não é bloqueado pela SubscriptionStatusGuard
  });

  it('não cria assinatura nem chama o Mercado Pago — é só leitura', async () => {
    const tenant = await db.createTenantWithUser('Empresa Downgrade So Leitura');
    const token = (await login(tenant.email, tenant.password)).body.access_token;
    const before = Number(
      (await (db as any).client.query('SELECT count(*) FROM subscriptions WHERE tenant_id = $1', [tenant.tenantId])).rows[0].count,
    );

    await check(token, startPlanId);

    const after = Number(
      (await (db as any).client.query('SELECT count(*) FROM subscriptions WHERE tenant_id = $1', [tenant.tenantId])).rows[0].count,
    );
    expect(after).toBe(before);
  });
});
