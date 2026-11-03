import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { TestDb, TestUserFixture } from './db-test-helper';

const fakeMercadoPago = {
  createPreapproval: jest.fn().mockResolvedValue({ id: 'fake', initPoint: 'https://example.test', status: 'pending' }),
};

async function loginToken(app: INestApplication, email: string, password: string): Promise<string> {
  const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
  return login.body.access_token;
}

// Abre transação na role da aplicação (montese_app, sujeita a RLS) com
// set_config local, como o DatabaseService faz; sempre faz ROLLBACK.
async function asApp<T>(
  appClient: Client,
  ctx: { role: string; userId?: string; tenantId?: string },
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  await appClient.query('BEGIN');
  try {
    await appClient.query('SELECT set_config($1, $2, true)', ['app.user_id', ctx.userId ?? '']);
    await appClient.query('SELECT set_config($1, $2, true)', ['app.tenant_id', ctx.tenantId ?? '']);
    await appClient.query('SELECT set_config($1, $2, true)', ['app.role', ctx.role]);
    return await fn(appClient);
  } finally {
    await appClient.query('ROLLBACK');
  }
}

describe('papel socio — matriz de acesso (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let appClient: Client;
  let socio: TestUserFixture;
  let socio2: TestUserFixture;
  let token: string;

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue(fakeMercadoPago)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    appClient = new Client({ connectionString: process.env.DATABASE_URL });
    await appClient.connect();

    socio = await db.createUserWithRole('socio', 'Socio Teste');
    socio2 = await db.createUserWithRole('socio', 'Socio Outro');
    token = await loginToken(app, socio.email, socio.password);
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await appClient.end();
    await app.close();
  });

  it('autentica e /auth/me devolve role socio', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('socio');
  });

  it.each([
    ['GET', '/admin/dashboard/financeiro'],
    ['GET', '/admin/dashboard/alertas'],
    ['GET', '/admin/dashboard/clientes-recentes'],
  ])('nega %s %s (admin-only)', async (method, path) => {
    const res = await (request(app.getHttpServer()) as any)[method.toLowerCase()](path).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('nega alterar status de assinatura e plano e NÃO muda o dado', async () => {
    const plano = await db.client.query('SELECT id, price_cents FROM plans LIMIT 1');
    const antes = plano.rows[0];
    const patchPlano = await request(app.getHttpServer())
      .patch(`/plans/${antes.id}`).set('Authorization', `Bearer ${token}`).send({ price_cents: 1 });
    expect(patchPlano.status).toBe(403);
    const depois = await db.client.query('SELECT price_cents FROM plans WHERE id = $1', [antes.id]);
    expect(depois.rows[0].price_cents).toBe(antes.price_cents);

    const patchSub = await request(app.getHttpServer())
      .patch('/subscriptions/00000000-0000-0000-0000-000000000000/status')
      .set('Authorization', `Bearer ${token}`).send({ status: 'cancelled' });
    expect(patchSub.status).toBe(403);
  });

  it('nega rota de empresa (sem @Roles socio) mesmo autenticado', async () => {
    const res = await request(app.getHttpServer()).get('/employees').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('is_montese_tenant: verdadeiro sem vínculo, falso com vínculo (inclusive inativo) a técnico', async () => {
    const livre = await db.createTenantWithUser('Cliente Montese Teste');
    const r1 = await db.client.query('SELECT is_montese_tenant($1) AS v', [livre.tenantId]);
    expect(r1.rows[0].v).toBe(true);

    const tecnico = await db.createUserWithRole('tecnico', 'Tec Teste');
    const tecRow = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    const vinculado = await db.createTenantWithUser('Cliente Parceiro Teste');
    await db.client.query(
      "INSERT INTO tenant_technicians (tenant_id, technician_id, status) VALUES ($1, $2, 'inativo')",
      [vinculado.tenantId, tecRow.rows[0].id],
    );
    const r2 = await db.client.query('SELECT is_montese_tenant($1) AS v', [vinculado.tenantId]);
    expect(r2.rows[0].v).toBe(false);
  });

  it('is_montese_tenant pertence a montese_auth_bypass (BYPASSRLS), como as demais SECURITY DEFINER', async () => {
    const r = await db.client.query(
      `SELECT r.rolname, r.rolbypassrls FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.proname = 'is_montese_tenant'`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].rolname).toBe('montese_auth_bypass');
    expect(r.rows[0].rolbypassrls).toBe(true);
  });

  it('is_montese_tenant como montese_app + app.role=socio (RLS real): vínculo => false, sem vínculo => true', async () => {
    const livre = await db.createTenantWithUser('Cliente Livre RLS');
    const tecnico = await db.createUserWithRole('tecnico', 'Tec RLS');
    const tecRow = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    const vinculado = await db.createTenantWithUser('Cliente Vinculado RLS');
    await db.client.query(
      "INSERT INTO tenant_technicians (tenant_id, technician_id, status) VALUES ($1, $2, 'ativo')",
      [vinculado.tenantId, tecRow.rows[0].id],
    );
    const ctx = { role: 'socio', userId: socio.userId };
    const who = await appClient.query('SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su');
    expect(who.rows[0].su).toBe(false);
    const comVinculo = await asApp(appClient, ctx, async (c) =>
      (await c.query('SELECT is_montese_tenant($1) AS v', [vinculado.tenantId])).rows[0].v);
    const semVinculo = await asApp(appClient, ctx, async (c) =>
      (await c.query('SELECT is_montese_tenant($1) AS v', [livre.tenantId])).rows[0].v);
    expect(comVinculo).toBe(false);
    expect(semVinculo).toBe(true);
  });

  it('CHECK da lista fechada de permissões e helper de concessão', async () => {
    await expect(
      db.client.query("INSERT INTO socio_permissions (user_id, permission) VALUES ($1, 'finance.write')", [socio.userId]),
    ).rejects.toThrow();
    await db.grantSocioPermission(socio.userId, 'finance.read');
    await db.grantSocioPermission(socio2.userId, 'tasks.read');
    const ok = await db.client.query('SELECT count(*)::int AS n FROM socio_permissions WHERE user_id = $1', [socio.userId]);
    expect(ok.rows[0].n).toBe(1);
  });

  it('RLS socio_permissions_select: sócio (tenant NULL) lê só as próprias linhas', async () => {
    await db.grantSocioPermission(socio.userId, 'finance.read');
    await db.grantSocioPermission(socio2.userId, 'tasks.read');
    const rows = await asApp(appClient, { role: 'socio', userId: socio.userId }, async (c) =>
      (await c.query('SELECT user_id, permission FROM socio_permissions')).rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.user_id === socio.userId)).toBe(true);
    expect(rows.some((r) => r.user_id === socio2.userId)).toBe(false);

    const outro = await asApp(appClient, { role: 'socio', userId: socio.userId }, async (c) =>
      (await c.query('SELECT 1 FROM socio_permissions WHERE user_id = $1', [socio2.userId])).rowCount);
    expect(outro).toBe(0);
  });

  it('montese_app com app.role=socio NÃO consegue INSERT em socio_permissions', async () => {
    await expect(
      asApp(appClient, { role: 'socio', userId: socio.userId }, (c) =>
        c.query("INSERT INTO socio_permissions (user_id, permission) VALUES ($1, 'tasks.write')", [socio.userId])),
    ).rejects.toThrow(/row-level security/i);
    const n = await db.client.query(
      "SELECT count(*)::int AS n FROM socio_permissions WHERE user_id = $1 AND permission = 'tasks.write'", [socio.userId]);
    expect(n.rows[0].n).toBe(0);
  });

  it('montese_app com app.role=socio NÃO escreve em subscriptions (RLS); plans sem RLS, mas escrita bloqueada por trigger (0095)', async () => {
    const plano = await db.client.query('SELECT id, price_cents FROM plans LIMIT 1');
    const tenant = await db.createTenantWithUser('Cliente Assinatura');
    const sub = await db.client.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [plano.rows[0].id, tenant.tenantId, `socio-matrix-${Math.random()}`]);
    const ctx = { role: 'socio', userId: socio.userId };

    // subscriptions: RLS ativa, sem policy para socio -> UPDATE afeta 0 linhas, INSERT é rejeitado.
    const upd = await asApp(appClient, ctx, (c) =>
      c.query("UPDATE subscriptions SET status = 'cancelled' WHERE id = $1", [sub.rows[0].id]));
    expect(upd.rowCount).toBe(0);
    await expect(
      asApp(appClient, ctx, (c) =>
        c.query(`INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
                 VALUES ($1, $2, 'authorized', 'socio-ins')`, [plano.rows[0].id, tenant.tenantId])),
    ).rejects.toThrow(/row-level security/i);
    const st = await db.client.query('SELECT status FROM subscriptions WHERE id = $1', [sub.rows[0].id]);
    expect(st.rows[0].status).toBe('authorized');

    // plans: sem RLS, mas o trigger trg_plans_guard_role (0095) levanta exceção para o socio.
    const rls = await db.client.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'plans'");
    expect(rls.rows[0].relrowsecurity).toBe(false); // proteção é o trigger, não RLS
    await expect(
      asApp(appClient, ctx, (c) => c.query('UPDATE plans SET price_cents = 1 WHERE id = $1', [plano.rows[0].id])),
    ).rejects.toThrow(/plans: escrita não permitida para o papel socio/);
    const dep = await db.client.query('SELECT price_cents FROM plans WHERE id = $1', [plano.rows[0].id]);
    expect(dep.rows[0].price_cents).toBe(plano.rows[0].price_cents); // preço intacto
  });
});
