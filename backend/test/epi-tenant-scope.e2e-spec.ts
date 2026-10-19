import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { TestDb } from './db-test-helper';

describe('tenant_id opcional em GET /epis/search e GET /epis/movements (e2e)', () => {
  let app: INestApplication;
  let srv: any;
  let db: TestDb;
  let sql: Client;
  let tokA: string;
  let tokB: string;
  let tokTec: string;
  let tokTecFree: string;
  let tokAdmin: string;
  let tenantA: string;
  let tenantB: string;
  let tenantC: string;
  let epiA: string;
  let epiB: string;
  let epiC: string;
  let seq = 0;
  const key = () => `teste-escopo-${Date.now()}-${seq++}-${randomUUID().slice(0, 6)}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (u: { email: string; password: string }) =>
    (await request(srv).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const search = (qs: string, tok: string) => request(srv).get(`/epis/search${qs}`).set(bearer(tok));
  const movs = (qs: string, tok: string) => request(srv).get(`/epis/movements${qs}`).set(bearer(tok));
  const mkEpi = async (tok: string, ca: string) => {
    const cat = (await request(srv).get('/epi-catalog-items').set(bearer(tok))).body;
    const r = await request(srv).post('/epis').set(bearer(tok)).send({ epi_catalog_item_id: cat[0].id, ca_number: ca });
    expect(r.status).toBe(201);
    const o = await request(srv).post(`/epis/${r.body.id}/movements`).set(bearer(tok)).send({ type: 'abertura', quantity: 3, idempotency_key: key() });
    expect(o.status).toBe(201);
    return r.body.id as string;
  };
  const epiIds = (r: any) => r.body.items.map((i: any) => i.id as string);
  const tenantsOf = (r: any) => Array.from(new Set(r.body.items.map((i: any) => i.tenant_id as string))).sort();

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

    const a = await db.createTenantWithUser('Empresa Escopo A');
    const b = await db.createTenantWithUser('Empresa Escopo B');
    const c = await db.createTenantWithUser('Empresa Escopo C');
    tenantA = a.tenantId; tenantB = b.tenantId; tenantC = c.tenantId;
    tokA = await login(a); tokB = await login(b);
    const tokC = await login(c);
    const tec = await db.createUserWithRole('tecnico', 'Tecnico Escopo');
    const tecF = await db.createUserWithRole('tecnico', 'Tecnico Livre Escopo');
    const adm = await db.createUserWithRole('admin', 'Admin Escopo');
    const techId = (await sql.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tec.userId])).rows[0].id;
    await sql.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2), ($3, $2)', [tenantA, techId, tenantB]);
    await sql.query('INSERT INTO technicians (user_id) VALUES ($1)', [tecF.userId]);
    tokTec = await login(tec); tokTecFree = await login(tecF); tokAdmin = await login(adm);

    epiA = await mkEpi(tokA, 'CA-ESC-A');
    epiB = await mkEpi(tokB, 'CA-ESC-B');
    epiC = await mkEpi(tokC, 'CA-ESC-C');
  });

  afterAll(async () => {
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  it('empresa: tenant_id próprio -> 200 só com seus dados; de outra empresa -> 400; sem o parâmetro igual ao próprio', async () => {
    const own = await search(`?tenant_id=${tenantA}&page_size=100`, tokA);
    expect(own.status).toBe(200);
    expect(epiIds(own)).toContain(epiA);
    expect(tenantsOf(own)).toEqual([tenantA]);
    expect((await search(`?tenant_id=${tenantB}`, tokA)).status).toBe(400);
    expect((await movs(`?tenant_id=${tenantB}`, tokA)).status).toBe(400);
    const semParam = await search('?page_size=100', tokA);
    expect(semParam.status).toBe(200);
    expect(epiIds(semParam).sort()).toEqual(epiIds(own).sort());
    const m = await movs(`?tenant_id=${tenantA}`, tokA);
    expect(m.status).toBe(200);
    expect(m.body.total).toBeGreaterThan(0);
    expect(m.body.items.every((x: any) => x.tenant_id === tenantA)).toBe(true);
  });

  it('técnico vinculado a A e B: sem o parâmetro vê as duas (RLS); com tenant_id filtra uma; empresa não vinculada fica invisível', async () => {
    const todas = await search('?page_size=100', tokTec);
    expect(todas.status).toBe(200);
    expect(epiIds(todas)).toEqual(expect.arrayContaining([epiA, epiB]));
    expect(epiIds(todas)).not.toContain(epiC);
    const soA = await search(`?tenant_id=${tenantA}&page_size=100`, tokTec);
    expect(epiIds(soA)).toContain(epiA);
    expect(epiIds(soA)).not.toContain(epiB);
    expect(tenantsOf(soA)).toEqual([tenantA]);
    const mB = await movs(`?tenant_id=${tenantB}&page_size=100`, tokTec);
    expect(mB.status).toBe(200);
    expect(mB.body.total).toBeGreaterThan(0);
    expect(mB.body.items.every((x: any) => x.tenant_id === tenantB)).toBe(true);
    const mTodas = await movs('?page_size=100', tokTec);
    expect(new Set(mTodas.body.items.map((x: any) => x.tenant_id))).toEqual(new Set([tenantA, tenantB]));
    // empresa C não vinculada: filtro devolve vazio (a RLS vale), nunca os dados de C
    const c = await search(`?tenant_id=${tenantC}`, tokTec);
    expect(c.status).toBe(200);
    expect(c.body.items).toEqual([]);
    expect((await movs(`?tenant_id=${tenantC}`, tokTec)).body.items).toEqual([]);
    // técnico sem vínculos: nada
    const livre = await search(`?tenant_id=${tenantA}`, tokTecFree);
    expect(livre.status).toBe(200);
    expect(livre.body.items).toEqual([]);
  });

  it('admin: filtra qualquer empresa; sem o parâmetro vê todas', async () => {
    const soC = await search(`?tenant_id=${tenantC}&page_size=100`, tokAdmin);
    expect(soC.status).toBe(200);
    expect(epiIds(soC)).toContain(epiC);
    expect(tenantsOf(soC)).toEqual([tenantC]);
    const todas = await search('?page_size=100', tokAdmin);
    expect(epiIds(todas)).toEqual(expect.arrayContaining([epiA, epiB, epiC]));
    const m = await movs(`?tenant_id=${tenantB}&page_size=100`, tokAdmin);
    expect(m.status).toBe(200);
    expect(m.body.items.every((x: any) => x.tenant_id === tenantB)).toBe(true);
    expect(m.body.total).toBeGreaterThan(0);
  });

  it('UUID inválido ou repetido -> 400 em ambas as listagens', async () => {
    for (const tok of [tokA, tokTec, tokAdmin]) {
      for (const qs of ['?tenant_id=xyz', '?tenant_id=123', `?tenant_id=${tenantA}x`, `?tenant_id=${tenantA}&tenant_id=${tenantB}`]) {
        expect([qs, (await search(qs, tok)).status]).toEqual([qs, 400]);
        expect([qs, (await movs(qs, tok)).status]).toEqual([qs, 400]);
      }
    }
  });
});
