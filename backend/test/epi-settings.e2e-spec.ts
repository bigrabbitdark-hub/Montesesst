import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { TestDb } from './db-test-helper';

describe('Configuração de alertas do EPI: GET/PATCH /epis/settings (e2e)', () => {
  let app: INestApplication;
  let srv: any;
  let db: TestDb;
  let sql: Client;
  let tokenA: string;
  let tokenB: string;
  let tokenTec: string;
  let tokenPartner: string;
  let tokenAdmin: string;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (u: { email: string; password: string }) =>
    (await request(srv).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const days = async (tenant: string) => (await sql.query('SELECT epi_alert_days FROM tenants WHERE id = $1', [tenant])).rows[0].epi_alert_days as number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    srv = app.getHttpServer();
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();
    const a = await db.createTenantWithUser('Empresa Settings A');
    const b = await db.createTenantWithUser('Empresa Settings B');
    tenantA = a.tenantId;
    tenantB = b.tenantId;
    userA = a.userId;
    tokenA = await login(a);
    tokenB = await login(b);
    const tec = await db.createUserWithRole('tecnico', 'Tecnico Settings');
    const parc = await db.createUserWithRole('parceiro', 'Parceiro Settings');
    const adm = await db.createUserWithRole('admin', 'Admin Settings');
    const techId = (await sql.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tec.userId])).rows[0].id;
    await sql.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tenantA, techId]);
    const partId = (await sql.query(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`, [parc.userId])).rows[0].id;
    await sql.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [tenantA, partId]);
    tokenTec = await login(tec);
    tokenPartner = await login(parc);
    tokenAdmin = await login(adm);
  }, 60000);

  afterAll(async () => {
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  it('GET devolve 30 por padrão', async () => {
    const r = await request(srv).get('/epis/settings').set(bearer(tokenA));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ epi_alert_days: 30 });
  });

  it('PATCH 10 -> 200 e persiste; GET reflete', async () => {
    const r = await request(srv).patch('/epis/settings').set(bearer(tokenA)).send({ epi_alert_days: 10 });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ epi_alert_days: 10 });
    expect(await days(tenantA)).toBe(10);
    expect((await request(srv).get('/epis/settings').set(bearer(tokenA))).body).toEqual({ epi_alert_days: 10 });
  });

  it('limites 1 e 365 passam', async () => {
    for (const n of [1, 365]) {
      const r = await request(srv).patch('/epis/settings').set(bearer(tokenA)).send({ epi_alert_days: n });
      expect(r.status).toBe(200);
      expect(r.body.epi_alert_days).toBe(n);
    }
  });

  it('valores inválidos -> 400 e nada muda', async () => {
    await request(srv).patch('/epis/settings').set(bearer(tokenA)).send({ epi_alert_days: 12 });
    const bad: unknown[] = [{ epi_alert_days: 0 }, { epi_alert_days: 366 }, { epi_alert_days: '5' }, { epi_alert_days: 5.5 }, { epi_alert_days: null },
      {}, { epi_alert_days: 5, extra: 1 }, { epi_alert_days: -1 }, { epi_alert_days: [5] }, { epi_alert_days: 1e21 }];
    for (const body of bad) {
      const r = await request(srv).patch('/epis/settings').set(bearer(tokenA)).send(body as any);
      expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400]);
    }
    expect(await days(tenantA)).toBe(12);
  });

  it('parâmetros de query inválidos -> 400', async () => {
    expect((await request(srv).get('/epis/settings?tenant_id=xyz').set(bearer(tokenA))).status).toBe(400);
    expect((await request(srv).get('/epis/settings?foo=1').set(bearer(tokenA))).status).toBe(400);
    expect((await request(srv).patch('/epis/settings?tenant_id=xyz').set(bearer(tokenA)).send({ epi_alert_days: 5 })).status).toBe(400);
  });

  it('técnico e parceiro: PATCH -> 403; GET exige tenant_id', async () => {
    for (const tok of [tokenTec, tokenPartner]) {
      expect((await request(srv).patch(`/epis/settings?tenant_id=${tenantA}`).set(bearer(tok)).send({ epi_alert_days: 3 })).status).toBe(403);
      expect((await request(srv).get('/epis/settings').set(bearer(tok))).status).toBe(400);
      const g = await request(srv).get(`/epis/settings?tenant_id=${tenantA}`).set(bearer(tok));
      expect(g.status).toBe(200);
      expect(g.body).toEqual({ epi_alert_days: 12 });
      // empresa vinculada não é B
      expect((await request(srv).get(`/epis/settings?tenant_id=${tenantB}`).set(bearer(tok))).status).toBe(404);
    }
    expect(await days(tenantA)).toBe(12);
  });

  it('empresa B não altera a A; tenant_id de outra empresa -> 400', async () => {
    const r = await request(srv).patch('/epis/settings').set(bearer(tokenB)).send({ epi_alert_days: 77 });
    expect(r.status).toBe(200);
    expect(await days(tenantB)).toBe(77);
    expect(await days(tenantA)).toBe(12);
    const cross = await request(srv).patch(`/epis/settings?tenant_id=${tenantA}`).set(bearer(tokenB)).send({ epi_alert_days: 1 });
    expect(cross.status).toBe(400);
    expect((await request(srv).get(`/epis/settings?tenant_id=${tenantA}`).set(bearer(tokenB))).status).toBe(400);
    expect(await days(tenantA)).toBe(12);
  });

  it('admin: com tenant_id -> 200; sem -> 400; inexistente -> 404', async () => {
    expect((await request(srv).patch('/epis/settings').set(bearer(tokenAdmin)).send({ epi_alert_days: 9 })).status).toBe(400);
    const ok = await request(srv).patch(`/epis/settings?tenant_id=${tenantA}`).set(bearer(tokenAdmin)).send({ epi_alert_days: 9 });
    expect(ok.status).toBe(200);
    expect(await days(tenantA)).toBe(9);
    expect((await request(srv).get(`/epis/settings?tenant_id=${tenantB}`).set(bearer(tokenAdmin))).body).toEqual({ epi_alert_days: 77 });
    const none = await request(srv).patch('/epis/settings?tenant_id=00000000-0000-4000-8000-000000000000').set(bearer(tokenAdmin)).send({ epi_alert_days: 9 });
    expect(none.status).toBe(404);
  });

  it('exige autenticação', async () => {
    expect((await request(srv).get('/epis/settings')).status).toBe(401);
    expect((await request(srv).patch('/epis/settings').send({ epi_alert_days: 5 })).status).toBe(401);
  });

  it('auditoria registra o PATCH (e não o GET)', async () => {
    await request(srv).patch('/epis/settings').set(bearer(tokenA)).send({ epi_alert_days: 20 });
    let rows: any[] = [];
    for (let i = 0; i < 20 && !rows.length; i++) {
      rows = (await sql.query(
        `SELECT action, method, path, status_code FROM audit_log WHERE actor_user_id = $1 AND path LIKE '/epis/settings%' AND method = 'PATCH'`,
        [userA])).rows;
      if (!rows.length) await new Promise((r) => setTimeout(r, 100));
    }
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ action: 'update', method: 'PATCH' });
    const gets = (await sql.query(`SELECT 1 FROM audit_log WHERE actor_user_id = $1 AND method = 'GET' AND path LIKE '/epis/settings%'`, [userA])).rowCount;
    expect(gets).toBe(0);
  });

  it('auditoria do PATCH grava resource_id = empresa alvo (empresa e admin com tenant_id)', async () => {
    const find = async (actor: string, tenant: string) => {
      for (let i = 0; i < 30; i++) {
        const r = await sql.query(
          `SELECT resource_id FROM audit_log WHERE actor_user_id = $1 AND method = 'PATCH' AND path LIKE '/epis/settings%' AND resource_id = $2`, [actor, tenant]);
        if (r.rowCount) return r.rows;
        await new Promise((x) => setTimeout(x, 100));
      }
      return [];
    };
    await request(srv).patch('/epis/settings').set(bearer(tokenA)).send({ epi_alert_days: 21 });
    expect((await find(userA, tenantA)).length).toBeGreaterThan(0);
    await request(srv).patch(`/epis/settings?tenant_id=${tenantB}`).set(bearer(tokenAdmin)).send({ epi_alert_days: 22 });
    let row: any;
    for (let i = 0; i < 30 && !row; i++) {
      row = (await sql.query(`SELECT resource_id FROM audit_log WHERE method = 'PATCH' AND path LIKE $1 ORDER BY occurred_at DESC LIMIT 1`, [`/epis/settings?tenant_id=${tenantB}%`])).rows[0];
      if (!row) await new Promise((x) => setTimeout(x, 100));
    }
    expect(row.resource_id).toBe(tenantB);
  });

  it('auditoria do PATCH que falha (404) também grava resource_id = tenant alvo', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    const r = await request(srv).patch(`/epis/settings?tenant_id=${ghost}`).set(bearer(tokenAdmin)).send({ epi_alert_days: 9 });
    expect(r.status).toBe(404);
    let row: any;
    for (let i = 0; i < 30 && !row; i++) {
      row = (await sql.query(`SELECT resource_id, status_code FROM audit_log WHERE method = 'PATCH' AND path LIKE $1 ORDER BY occurred_at DESC LIMIT 1`, [`/epis/settings?tenant_id=${ghost}%`])).rows[0];
      if (!row) await new Promise((x) => setTimeout(x, 100));
    }
    expect(row).toMatchObject({ resource_id: ghost, status_code: 404 });
  });
});
