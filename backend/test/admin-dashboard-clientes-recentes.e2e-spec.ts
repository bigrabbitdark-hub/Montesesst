import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb, TestTenantFixture } from './db-test-helper';

const RUN = `admin-dash-cli-${Date.now()}`;

async function waitFor<T>(fn: () => Promise<T | null>, tries = 30, delayMs = 100): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

describe('GET /admin/dashboard/clientes-recentes (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let tenantA: TestTenantFixture; // com assinatura e com login
  let tenantB: TestTenantFixture; // sem assinatura, sem login (criado depois: mais novo)
  let subscriptionId: string;
  let planName: string;
  let planPriceCents: number;
  const q = (text: string, params?: unknown[]) => (db as any).client.query(text, params);

  async function list(limit?: string) {
    return request(app.getHttpServer())
      .get(`/admin/dashboard/clientes-recentes${limit === undefined ? '' : `?limit=${limit}`}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const admin = await db.createUserWithRole('admin', 'Admin Dash Clientes');
    tenantA = await db.createTenantWithUser('Empresa Recentes A');

    const plan = await q(`SELECT id, name, price_cents FROM plans WHERE audience = 'empresa' LIMIT 1`);
    planName = plan.rows[0].name;
    planPriceCents = plan.rows[0].price_cents;
    const sub = await q(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [plan.rows[0].id, tenantA.tenantId, `${RUN}-preapproval`],
    );
    subscriptionId = sub.rows[0].id;

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    // O login real da empresa A grava um `login_success` em audit_log (o
    // teste não escreve nessa tabela — ela é append-only por desenho).
    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenantA.email, password: tenantA.password });
    tokenEmpresa = loginEmpresa.body.access_token;

    tenantB = await db.createTenantWithUser('Empresa Recentes B');
  });

  afterAll(async () => {
    await q('DELETE FROM subscriptions WHERE id = $1', [subscriptionId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('exige autenticação e bloqueia empresa', async () => {
    const semToken = await request(app.getHttpServer()).get('/admin/dashboard/clientes-recentes');
    expect(semToken.status).toBe(401);
    const empresa = await request(app.getHttpServer())
      .get('/admin/dashboard/clientes-recentes')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(empresa.status).toBe(403);
  });

  it('empresa sem assinatura e sem login: plano do tenant, MRR e último acesso nulos', async () => {
    const res = await list('20');
    expect(res.status).toBe(200);
    const b = res.body.find((r: any) => r.id === tenantB.tenantId);
    expect(b).toBeDefined();
    expect(b.nome).toMatch(/^Empresa Recentes B/);
    expect(b.status).toBe('ativo');
    expect(b.plano).toBe('trial');
    expect(b.mrr_cents).toBeNull();
    expect(b.ultimo_acesso).toBeNull();
    expect(new Date(b.created_at).toString()).not.toBe('Invalid Date');
  });

  it('empresa com assinatura autorizada e login: plano, MRR e último acesso', async () => {
    const a = await waitFor(async () => {
      const res = await list('20');
      const row = res.body.find((r: any) => r.id === tenantA.tenantId);
      return row?.ultimo_acesso ? row : null;
    });
    expect(a).not.toBeNull();
    expect(a.plano).toBe(planName);
    expect(a.mrr_cents).toBe(planPriceCents);
    expect(new Date(a.ultimo_acesso).toString()).not.toBe('Invalid Date');
  });

  it('ordena da mais nova para a mais antiga', async () => {
    const res = await list('20');
    const idx = (id: string) => res.body.findIndex((r: any) => r.id === id);
    expect(idx(tenantB.tenantId)).toBeGreaterThanOrEqual(0);
    expect(idx(tenantA.tenantId)).toBeGreaterThanOrEqual(0);
    expect(idx(tenantB.tenantId)).toBeLessThan(idx(tenantA.tenantId));
  });

  it('respeita limit: padrão 5, máximo 20, inválido cai em 5', async () => {
    expect((await list()).body.length).toBeLessThanOrEqual(5);
    expect((await list('2')).body.length).toBeLessThanOrEqual(2);
    expect((await list('999')).body.length).toBeLessThanOrEqual(20);
    expect((await list('abc')).body.length).toBeLessThanOrEqual(5);
    expect((await list('0')).body.length).toBeLessThanOrEqual(5);
  });
});
