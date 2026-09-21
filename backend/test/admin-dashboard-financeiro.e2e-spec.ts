import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

const RUN = `admin-dash-fin-${Date.now()}`;

// Data de hoje no fuso de São Paulo, formato YYYY-MM-DD.
function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

describe('GET /admin/dashboard/financeiro (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenAdmin: string;
  let tokenEmpresa: string;
  let subscriptionId: string;
  let tenantName: string;
  let planName: string;
  const q = (text: string, params?: unknown[]) => (db as any).client.query(text, params);

  async function get(query = '') {
    return request(app.getHttpServer())
      .get(`/admin/dashboard/financeiro${query}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
  }

  async function insertEvent(
    suffix: string,
    cents: number,
    status: string,
    occurredAtSql: string,
    withSubscription = true,
  ) {
    await q(
      `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
       VALUES ($1, $2, $3, $4, ${occurredAtSql})`,
      [withSubscription ? subscriptionId : null, `${RUN}-${suffix}`, cents, status],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();

    const tenant = await db.createTenantWithUser('Empresa Dash Financeiro');
    const admin = await db.createUserWithRole('admin', 'Admin Dash Financeiro');

    tenantName = (await q('SELECT name FROM tenants WHERE id = $1', [tenant.tenantId])).rows[0].name;
    const plan = await q(`SELECT id, name FROM plans WHERE audience = 'empresa' LIMIT 1`);
    planName = plan.rows[0].name;
    const sub = await q(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3) RETURNING id`,
      [plan.rows[0].id, tenant.tenantId, `${RUN}-preapproval`],
    );
    subscriptionId = sub.rows[0].id;

    const loginAdmin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.email, password: admin.password });
    tokenAdmin = loginAdmin.body.access_token;

    const loginEmpresa = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: tenant.email, password: tenant.password });
    tokenEmpresa = loginEmpresa.body.access_token;
  });

  afterAll(async () => {
    await q(`DELETE FROM payment_events WHERE mercadopago_payment_id LIKE $1`, [`${RUN}-%`]);
    await q('DELETE FROM subscriptions WHERE id = $1', [subscriptionId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('exige autenticação e bloqueia empresa', async () => {
    const semToken = await request(app.getHttpServer()).get('/admin/dashboard/financeiro');
    expect(semToken.status).toBe(401);
    const empresa = await request(app.getHttpServer())
      .get('/admin/dashboard/financeiro')
      .set('Authorization', `Bearer ${tokenEmpresa}`);
    expect(empresa.status).toBe(403);
  });

  it('aceita 7, 30 e 90 dias; qualquer outro valor cai em 30', async () => {
    const casos: [string | undefined, number][] = [
      ['7', 7],
      ['30', 30],
      ['90', 90],
      ['15', 30],
      ['abc', 30],
      [undefined, 30],
    ];
    for (const [param, esperado] of casos) {
      const res = await get(param === undefined ? '' : `?dias=${param}`);
      expect(res.status).toBe(200);
      expect(res.body.periodo_dias).toBe(esperado);
      expect(res.body.serie).toHaveLength(esperado);
    }
  });

  it('devolve uma série completa, ordenada, terminando hoje (São Paulo)', async () => {
    const { serie } = (await get('?dias=7')).body;
    for (let i = 1; i < serie.length; i++) {
      expect(serie[i].data > serie[i - 1].data).toBe(true);
    }
    for (const ponto of serie) {
      expect(ponto.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isInteger(ponto.cobrado_cents)).toBe(true);
      expect(Number.isInteger(ponto.aprovado_cents)).toBe(true);
      expect(ponto.aprovado_cents).toBeLessThanOrEqual(ponto.cobrado_cents);
    }
    expect(serie[serie.length - 1].data).toBe(hojeSaoPaulo());
  });

  it('classifica cobrado, aprovado, pendente e recusado e vincula cliente e plano', async () => {
    const antes = (await get('?dias=7')).body;

    await insertEvent('ok', 12345, 'approved', 'now()');
    await insertEvent('pend', 2345, 'pending', 'now()');
    await insertEvent('rej', 345, 'rejected', 'now()');
    await insertEvent('ref', 45, 'refunded', 'now()'); // só conta em "cobrado"
    await insertEvent('orfao', 6, 'approved', 'now()', false); // sem assinatura

    const depois = (await get('?dias=7')).body;
    const total = 12345 + 2345 + 345 + 45 + 6;

    expect(depois.hoje.cobrado_cents - antes.hoje.cobrado_cents).toBe(total);
    expect(depois.hoje.aprovado_cents - antes.hoje.aprovado_cents).toBe(12345 + 6);
    expect(depois.hoje.pendente_cents - antes.hoje.pendente_cents).toBe(2345);
    expect(depois.mes.recusado_cents - antes.mes.recusado_cents).toBe(345);

    const ultimo = depois.serie[depois.serie.length - 1];
    const ultimoAntes = antes.serie[antes.serie.length - 1];
    expect(ultimo.cobrado_cents - ultimoAntes.cobrado_cents).toBe(total);
    expect(ultimo.aprovado_cents - ultimoAntes.aprovado_cents).toBe(12345 + 6);

    expect(depois.recentes.length).toBeLessThanOrEqual(5);
    const ok = depois.recentes.find((r: any) => r.mercadopago_payment_id === `${RUN}-ok`);
    expect(ok).toMatchObject({ amount_cents: 12345, status: 'approved', cliente: tenantName, plano: planName });
    const orfao = depois.recentes.find((r: any) => r.mercadopago_payment_id === `${RUN}-orfao`);
    expect(orfao.cliente).toBeNull();
    expect(orfao.plano).toBeNull();
  });

  it('atribui o evento ao dia de São Paulo, não ao dia UTC', async () => {
    const antes = (await get('?dias=7')).body.serie;

    // 23:59 de ontem no horário de São Paulo — em UTC isso já é "hoje".
    await insertEvent(
      'tz',
      777,
      'approved',
      `(date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 minute') AT TIME ZONE 'America/Sao_Paulo'`,
    );

    const depois = (await get('?dias=7')).body.serie;
    const n = depois.length;
    expect(depois[n - 2].cobrado_cents - antes[n - 2].cobrado_cents).toBe(777);
    expect(depois[n - 1].cobrado_cents - antes[n - 1].cobrado_cents).toBe(0);
  });
});
