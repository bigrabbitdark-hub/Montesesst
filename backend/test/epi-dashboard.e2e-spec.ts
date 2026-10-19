import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { randomBytes } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { TestDb } from './db-test-helper';

describe('Painel agregado de EPI: GET /epis/dashboard (e2e)', () => {
  let app: INestApplication;
  let srv: any;
  let db: TestDb;
  let sql: Client;
  let tokenA: string;
  let tokenB: string;
  let tokenTecLinked: string;
  let tokenTecFree: string;
  let tokenPartner: string;
  let tokenAdmin: string;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let f1: string;
  let f1Cpf: string;
  let f2: string;
  let epi: Record<'e1' | 'e2' | 'e3' | 'e4' | 'e5', string>;
  let deliveryPending: string;
  let deliveryOlder: string;
  let epiB0: string;
  let seq = 0;
  const key = () => `teste-dash-${Date.now()}-${seq++}-${randomBytes(3).toString('hex')}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const auth = () => bearer(tokenA);
  const login = async (u: { email: string; password: string }) =>
    (await request(srv).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const mov = (tok: string, id: string, body: Record<string, unknown>) =>
    request(srv).post(`/epis/${id}/movements`).set(bearer(tok)).send({ idempotency_key: key(), ...body });
  const cpf11 = () => String(Math.floor(Math.random() * 1e11)).padStart(11, '0');
  const newEmployee = async (tenant: string, name: string, cpf = cpf11()) =>
    (await sql.query(`INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, $2, $3, 'ativo') RETURNING id`, [tenant, name, cpf])).rows[0].id as string;
  const dash = (qs = '', tok = tokenA) => request(srv).get(`/epis/dashboard${qs}`).set(bearer(tok));
  const sqlDay = async (offset: number) =>
    (await sql.query(`SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date + $1::int, 'YYYY-MM-DD') AS d`, [offset])).rows[0].d as string;

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

    const a = await db.createTenantWithUser('Empresa Dashboard A');
    const b = await db.createTenantWithUser('Empresa Dashboard B');
    tenantA = a.tenantId;
    tenantB = b.tenantId;
    userA = a.userId;
    tokenA = await login(a);
    tokenB = await login(b);
    const tecV = await db.createUserWithRole('tecnico', 'Tecnico Vinculado Dashboard');
    const tecF = await db.createUserWithRole('tecnico', 'Tecnico Livre Dashboard');
    const parc = await db.createUserWithRole('parceiro', 'Parceiro Vinculado Dashboard');
    const adm = await db.createUserWithRole('admin', 'Admin Dashboard');
    const techId = (await sql.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecV.userId])).rows[0].id;
    await sql.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tenantA, techId]);
    await sql.query('INSERT INTO technicians (user_id) VALUES ($1)', [tecF.userId]);
    const partId = (await sql.query(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`, [parc.userId])).rows[0].id;
    await sql.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [tenantA, partId]);
    tokenTecLinked = await login(tecV);
    tokenTecFree = await login(tecF);
    tokenPartner = await login(parc);
    tokenAdmin = await login(adm);

    // Funcionários de A: F1 (com CPF conhecido para provar que não vaza) e F2.
    f1Cpf = '98765432100';
    f1 = await newEmployee(tenantA, 'Funcionário F1', f1Cpf);
    f2 = await newEmployee(tenantA, 'Funcionário F2');

    const cat = (await request(srv).get('/epi-catalog-items').set(auth())).body;
    const mk = async (i: number, body: Record<string, unknown>) => {
      const r = await request(srv).post('/epis').set(auth()).send({ epi_catalog_item_id: cat[i].id, ca_number: `CA-DASH-${i}`, ...body });
      expect(r.status).toBe(201);
      return r.body.id as string;
    };
    const e1 = await mk(0, { min_stock: 10, max_stock: 50, unit_cost: 5 });
    const e2 = await mk(1, {});
    const e3 = await mk(2, { unit_cost: 1 });
    const e4 = await mk(3, { unit_cost: 3.5 });
    const e5 = await mk(4, { controls_lot: true, unit_cost: 2.5 });
    epi = { e1, e2, e3, e4, e5 };
    expect((await mov(tokenA, e1, { type: 'abertura', quantity: 4 })).status).toBe(201);
    expect((await mov(tokenA, e3, { type: 'abertura', quantity: 20 })).status).toBe(201);
    expect((await mov(tokenA, e4, { type: 'abertura', quantity: 30 })).status).toBe(201);
    expect((await mov(tokenA, e5, { type: 'abertura', quantity: 3, lot_code: 'L-VENC', lot_valid_until: '2000-01-01' })).status).toBe(201);
    expect((await mov(tokenA, e5, { type: 'abertura', quantity: 2, lot_code: 'L-AVENC', lot_valid_until: await sqlDay(10) })).status).toBe(201);
    // CA: e3 venceu ontem; e4 vence em 10 dias (dentro dos 30 de aviso).
    await sql.query(`UPDATE tenant_epis SET ca_valid_until = (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1 WHERE id = $1`, [e3]);
    await sql.query(`UPDATE tenant_epis SET ca_valid_until = (now() AT TIME ZONE 'America/Sao_Paulo')::date + 10 WHERE id = $1`, [e4]);

    // Uma entrega pendente (F1) e uma assinada (F2), ambas pelo livro (baixam 1 cada do e4: 30 -> 28).
    const dP = await mov(tokenA, e4, { type: 'entrega', quantity: 1, employee_id: f1 });
    expect(dP.status).toBe(201);
    deliveryPending = dP.body.delivery_id;
    const dS = await mov(tokenA, e4, { type: 'entrega', quantity: 1, employee_id: f2 });
    expect(dS.status).toBe(201);
    await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'assinada', signed_at = now() WHERE id = $1`, [dS.body.delivery_id]);
    // Entrega pendente mais antiga (legada, sem movimentação) para provar a ordem "mais antigas primeiro".
    deliveryOlder = (await sql.query(
      `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, signed_by_name, created_by_user_id, signature_status, quantity)
       VALUES ($1, $2, $3, '2020-01-01', 'F2', $4, 'pendente', 1) RETURNING id`, [tenantA, e4, f2, userA])).rows[0].id;
    // Solicitação ativa só para a entrega pendente de F1.
    const reqId = (await sql.query(
      `INSERT INTO epi_signature_requests (tenant_id, employee_id, token_hash, pin_hash, status, expires_at, term_version, term_text_sha256, created_by_user_id, idempotency_key)
       VALUES ($1, $2, $3, $4, 'ativa', now() + interval '1 day', 'x', $5, $6, $7) RETURNING id`,
      [tenantA, f1, randomBytes(32).toString('hex'), randomBytes(32).toString('hex'), randomBytes(32).toString('hex'), userA, key()])).rows[0].id;
    await sql.query('INSERT INTO epi_signature_request_items (request_id, delivery_id) VALUES ($1, $2)', [reqId, deliveryPending]);

    // Empresa B: 12 EPIs; o primeiro recebe estoque com data fixa no passado (fronteira do dia de São Paulo).
    const catB = (await request(srv).get('/epi-catalog-items').set(bearer(tokenB))).body;
    const bIds: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await request(srv).post('/epis').set(bearer(tokenB)).send({ epi_catalog_item_id: catB[i % catB.length].id, ca_number: `CA-DASH-B-${i}` });
      expect(r.status).toBe(201);
      bIds.push(r.body.id);
    }
    epiB0 = bIds[0];
    // 2026-01-16T02:00Z = 15/01 23:00 em São Paulo.
    const past = await mov(tokenB, epiB0, { type: 'entrada', quantity: 7, supplier: 'F', occurred_at: '2026-01-16T02:00:00Z' });
    expect(past.status).toBe(201);
  }, 120000);

  afterAll(async () => {
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  it('KPIs batem com as fixtures (estoque, valor, faixas, CA e lotes)', async () => {
    const r = await dash();
    expect(r.status).toBe(200);
    // estoque: e1=4, e2=0, e3=20, e4=30-2 entregas=28, e5=3+2=5 -> 57
    // valor: 4*5 + 0 + 20*1 + 28*3.5 + 5*2.5 = 20 + 20 + 98 + 12.5 = 150.50
    expect(r.body.kpis).toEqual({
      epis_total: 5, stock_total: 57, stock_value: '150.50', zero_stock: 1, low_stock: 1,
      ca_expired: 1, ca_expiring: 1, lots_expired: 1, lots_expiring: 1, pending_signatures: 2,
    });
    expect(r.body.alert_days).toBe(30);
  });

  it('alerts lista só EPIs em situação crítica, ordenados por gravidade', async () => {
    const r = await dash();
    const ids = r.body.alerts.map((a: any) => a.epi_id);
    // gravidade 0 primeiro (sem estoque, CA vencido, lote vencido); depois abaixo do mínimo e CA a vencer
    expect(ids.slice(0, 3)).toEqual([epi.e2, epi.e3, epi.e5]);
    expect(new Set(ids.slice(3))).toEqual(new Set([epi.e1, epi.e4]));
    expect(ids).toHaveLength(5);
    const byId = Object.fromEntries(r.body.alerts.map((a: any) => [a.epi_id, a]));
    expect(byId[epi.e2]).toMatchObject({ stock_band: 'sem_estoque', stock_balance: 0, ca_alert: 'sem_validade' });
    expect(byId[epi.e3]).toMatchObject({ ca_alert: 'vencido', stock_band: 'otimo' });
    expect(byId[epi.e5]).toMatchObject({ lots_expired: 1, lots_expiring: 1 });
    expect(byId[epi.e1]).toMatchObject({ stock_band: 'abaixo', min_stock: 10, stock_balance: 4 });
    expect(byId[epi.e4]).toMatchObject({ ca_alert: 'a_vencer', stock_balance: 28 });
    expect(byId[epi.e4].ca_valid_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('alerts e pending respeitam o máximo de 10 itens; KPIs contam tudo', async () => {
    const r = await dash('', tokenB);
    expect(r.status).toBe(200);
    expect(r.body.kpis.epis_total).toBe(12);
    expect(r.body.kpis.zero_stock).toBe(11);
    expect(r.body.alerts).toHaveLength(10);
    const e = await newEmployee(tenantB, 'Funcionário B1');
    const rows = Array.from({ length: 11 }, (_, i) =>
      sql.query(
        `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, signed_by_name, created_by_user_id, signature_status, quantity)
         VALUES ($1, $2, $3, ('2021-01-01'::date + $4::int), 'B1', (SELECT id FROM users WHERE tenant_id = $1 LIMIT 1), 'pendente', 1)`,
        [tenantB, epiB0, e, i],
      ));
    await Promise.all(rows);
    const r2 = await dash('', tokenB);
    expect(r2.body.kpis.pending_signatures).toBe(11);
    expect(r2.body.pending).toHaveLength(10);
    expect(r2.body.pending[0].delivered_at).toBe('2021-01-01');
    expect(r2.body.pending[9].delivered_at).toBe('2021-01-10');
  });

  it('recent_movements respeita o período, epi_id e employee_id e traz só nome do funcionário (sem CPF)', async () => {
    const wide = `from=${await sqlDay(-300)}&to=${await sqlDay(0)}`;
    const r = await dash(`?${wide}&employee_id=${f1}`);
    expect(r.status).toBe(200);
    expect(r.body.recent_movements).toHaveLength(1);
    expect(r.body.recent_movements.every((m: any) => m.employee_name === 'Funcionário F1')).toBe(true);
    expect(r.body.recent_movements[0]).toMatchObject({ type: 'entrega', quantity: 1, epi_id: epi.e4, reversed: false });
    const all = JSON.stringify((await dash(`?${wide}`)).body);
    expect(all).not.toContain(f1Cpf);
    expect(all).not.toMatch(/(?<![0-9A-Za-z])\d{11}(?![0-9A-Za-z])/);

    const porEpi = await dash(`?epi_id=${epi.e1}`);
    expect(porEpi.body.recent_movements).toHaveLength(1);
    expect(porEpi.body.recent_movements[0]).toMatchObject({ type: 'abertura', epi_id: epi.e1, employee_name: null });
    expect(porEpi.body.kpis).toMatchObject({ epis_total: 1, stock_total: 4, stock_value: '20.00', low_stock: 1, pending_signatures: 0 });

    const semF = await dash(`?employee_id=${f2}&epi_id=${epi.e1}`);
    expect(semF.body.recent_movements).toEqual([]);
  });

  it('recent_movements marca a movimentação estornada', async () => {
    const e = await mov(tokenA, epi.e3, { type: 'entrada', quantity: 1, supplier: 'F' });
    expect(e.status).toBe(201);
    const rev = await request(srv).post(`/epis/movements/${e.body.id}/reversal`).set(auth()).send({ reason: 'Erro de digitação', idempotency_key: key() });
    expect(rev.status).toBe(201);
    const r = await dash(`?epi_id=${epi.e3}`);
    const byId = Object.fromEntries(r.body.recent_movements.map((m: any) => [m.id, m]));
    expect(byId[e.body.id].reversed).toBe(true);
    expect(byId[rev.body.id].reversed).toBe(false);
  });

  it('o período usa o dia de São Paulo nas duas pontas', async () => {
    // movimento de B em 15/01/2026 23:00 (SP)
    const dia15 = await dash('?from=2026-01-15&to=2026-01-15', tokenB);
    expect(dia15.status).toBe(200);
    expect(dia15.body.recent_movements).toHaveLength(1);
    expect(dia15.body.recent_movements[0]).toMatchObject({ type: 'entrada', quantity: 7 });
    expect((await dash('?from=2026-01-16&to=2026-01-16', tokenB)).body.recent_movements).toEqual([]);
    expect((await dash('?from=2026-01-14&to=2026-01-14', tokenB)).body.recent_movements).toEqual([]);
  });

  it('entrega recusada entra na contagem e na lista de pendências (como na Ficha)', async () => {
    const id = (await sql.query(
      `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, signed_by_name, created_by_user_id, signature_status, quantity)
       VALUES ($1, $2, $3, '2019-06-01', 'F2', $4, 'recusada', 1) RETURNING id`, [tenantA, epi.e4, f2, userA])).rows[0].id as string;
    try {
      const r = await dash();
      expect(r.status).toBe(200);
      expect(r.body.kpis.pending_signatures).toBe(3);
      expect(r.body.pending.map((p: any) => p.delivery_id)).toEqual([id, deliveryOlder, deliveryPending]);
      expect(r.body.pending[0].signature_status).toBe('recusada');
    } finally {
      await sql.query('DELETE FROM employee_epi_deliveries WHERE id = $1', [id]);
    }
  });

  it('valor de estoque alto (custo máximo x saldo alto) não estoura: 200 com valores corretos', async () => {
    const o = await db.createTenantWithUser('Empresa Dashboard Overflow');
    const tok = await login(o);
    const cat = (await request(srv).get('/epi-catalog-items').set(bearer(tok))).body;
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const c = await request(srv).post('/epis').set(bearer(tok)).send({ epi_catalog_item_id: cat[i].id, ca_number: `CA-OVF-${i}` });
      expect(c.status).toBe(201);
      ids.push(c.body.id);
    }
    await sql.query('UPDATE tenant_epis SET stock_balance = 100000, unit_cost = 10000000.00 WHERE id = $1', [ids[0]]);
    await sql.query('UPDATE tenant_epis SET stock_balance = 2147483647, unit_cost = 9999999999.99 WHERE id = $1', [ids[1]]);
    const r = await dash('', tok);
    expect(r.status).toBe(200);
    // 100000 x 10000000.00 + 2147483647 x 9999999999.99 (cada parcela estouraria numeric(14,2))
    expect(r.body.kpis.stock_value).toBe('21474837469978525163.53');
    expect(r.body.kpis.stock_total).toBe(2147583647);
    const list = await request(srv).get('/epis').set(bearer(tok));
    expect(list.status).toBe(200);
  });

  it('recent_movements: ordem DESC e no máximo 10 linhas (11 movimentos)', async () => {
    const o = await db.createTenantWithUser('Empresa Dashboard Limite');
    const tok = await login(o);
    const cat = (await request(srv).get('/epi-catalog-items').set(bearer(tok))).body;
    const c = await request(srv).post('/epis').set(bearer(tok)).send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-LIM-1' });
    expect(c.status).toBe(201);
    const times: string[] = [];
    for (let i = 0; i < 11; i++) {
      const at = new Date(Date.now() - (11 - i) * 60_000).toISOString(); // i=10 é o mais recente
      times.push(at);
      expect((await mov(tok, c.body.id, { type: 'entrada', quantity: i + 1, supplier: 'F', occurred_at: at })).status).toBe(201);
    }
    const r = await dash('', tok);
    expect(r.status).toBe(200);
    const mv = r.body.recent_movements;
    expect(mv).toHaveLength(10);
    expect(mv.map((m: any) => m.quantity)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const ts = mv.map((m: any) => new Date(m.occurred_at).getTime());
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);
  });

  it('solicitação de assinatura expirada não conta como link ativo em pending', async () => {
    // empresa própria: solicitações não podem ser apagadas, então não sujam a fixture principal
    const o = await db.createTenantWithUser('Empresa Dashboard Link Expirado');
    const tok = await login(o);
    const cat = (await request(srv).get('/epi-catalog-items').set(bearer(tok))).body;
    const c = await request(srv).post('/epis').set(bearer(tok)).send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-EXP-1' });
    expect(c.status).toBe(201);
    expect((await mov(tok, c.body.id, { type: 'abertura', quantity: 5 })).status).toBe(201);
    const d = await mov(tok, c.body.id, { type: 'entrega', quantity: 1, employee_id: o.employeeId });
    expect(d.status).toBe(201);
    const reqId = (await sql.query(
      `INSERT INTO epi_signature_requests (tenant_id, employee_id, token_hash, pin_hash, status, created_at, expires_at, term_version, term_text_sha256, created_by_user_id, idempotency_key)
       VALUES ($1, $2, $3, $4, 'ativa', now() - interval '3 days', now() - interval '1 day', 'x', $5, $6, $7) RETURNING id`,
      [o.tenantId, o.employeeId, randomBytes(32).toString('hex'), randomBytes(32).toString('hex'), randomBytes(32).toString('hex'), o.userId, key()])).rows[0].id;
    await sql.query('INSERT INTO epi_signature_request_items (request_id, delivery_id) VALUES ($1, $2)', [reqId, d.body.delivery_id]);
    const r = await dash('', tok);
    expect(r.status).toBe(200);
    const row = r.body.pending.find((p: any) => p.delivery_id === d.body.delivery_id);
    expect(row).toBeDefined();
    expect(row.active_request_expires_at).toBeNull();
  });

  it('entrega sem quantidade (legada) não entra em pending, como em /epi-signatures/pending', async () => {
    const id = (await sql.query(
      `INSERT INTO employee_epi_deliveries (tenant_id, tenant_epi_id, employee_id, delivered_at, signed_by_name, created_by_user_id, signature_status)
       VALUES ($1, $2, $3, '2017-01-01', 'F1', $4, 'pendente') RETURNING id`, [tenantA, epi.e4, f1, userA])).rows[0].id as string;
    try {
      expect((await sql.query('SELECT quantity FROM employee_epi_deliveries WHERE id = $1', [id])).rows[0].quantity).toBeNull();
      const r = await dash();
      expect(r.body.kpis.pending_signatures).toBe(2);
      expect(r.body.pending.map((p: any) => p.delivery_id)).not.toContain(id);
    } finally {
      await sql.query('DELETE FROM employee_epi_deliveries WHERE id = $1', [id]);
    }
  });

  it('parceiro sem vínculo: 404 com tenant_id; 400 sem', async () => {
    const free = await db.createUserWithRole('parceiro', 'Parceiro Livre Dashboard');
    await sql.query(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC')`, [free.userId]);
    const tok = await login(free);
    expect((await dash('', tok)).status).toBe(400);
    const r = await dash(`?tenant_id=${tenantA}`, tok);
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).not.toContain('kpis');
  });

  it('pending traz as entregas aguardando assinatura mais antigas primeiro', async () => {
    const r = await dash();
    expect(r.body.pending.map((p: any) => p.delivery_id)).toEqual([deliveryOlder, deliveryPending]);
    expect(r.body.pending[0]).toMatchObject({
      delivered_at: '2020-01-01', employee_id: f2, employee_name: 'Funcionário F2', epi_id: epi.e4,
      signature_status: 'pendente', active_request_expires_at: null,
    });
    expect(r.body.pending[1]).toMatchObject({ employee_id: f1, employee_name: 'Funcionário F1', quantity: 1 });
    expect(new Date(r.body.pending[1].active_request_expires_at).getTime()).toBeGreaterThan(Date.now());
    // a entrega assinada não aparece
    expect(r.body.pending.every((p: any) => p.signature_status === 'pendente')).toBe(true);
    const soF1 = await dash(`?employee_id=${f1}`);
    expect(soF1.body.pending.map((p: any) => p.delivery_id)).toEqual([deliveryPending]);
    expect(soF1.body.kpis.pending_signatures).toBe(1);
  });

  it('período padrão de 30 dias quando from/to ausentes', async () => {
    const r = await dash();
    expect(r.body.period.to).toBe(await sqlDay(0));
    expect(r.body.period.from).toBe(await sqlDay(-29));
    const so = await dash('?from=2026-01-01&to=2026-01-31');
    expect(so.body.period).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(so.body.recent_movements).toEqual([]);
  });

  it('empresa B vê só os próprios números (isolamento)', async () => {
    const r = await dash(`?from=${await sqlDay(-300)}&to=${await sqlDay(0)}`, tokenB);
    expect(r.status).toBe(200);
    expect(r.body.kpis).toMatchObject({ epis_total: 12, stock_total: 7, ca_expired: 0, lots_expired: 0 });
    const txt = JSON.stringify(r.body);
    for (const id of Object.values(epi)) expect(txt).not.toContain(id);
    expect(txt).not.toContain('Funcionário F1');
    const a = await dash(`?from=${await sqlDay(-300)}&to=${await sqlDay(0)}`);
    expect(JSON.stringify(a.body)).not.toContain(epiB0);
    // epi_id da empresa A consultado por B: sem dados (nada vaza)
    const cruz = await dash(`?epi_id=${epi.e4}`, tokenB);
    expect(cruz.status).toBe(200);
    expect(cruz.body.kpis).toMatchObject({ epis_total: 0, stock_total: 0, pending_signatures: 0 });
    expect(cruz.body.recent_movements).toEqual([]);
    expect(cruz.body.pending).toEqual([]);
  });

  it('técnico/parceiro vinculados exigem tenant_id; não vinculados e admin', async () => {
    for (const tok of [tokenTecLinked, tokenPartner]) {
      expect((await dash('', tok)).status).toBe(400);
      const ok = await dash(`?tenant_id=${tenantA}`, tok);
      expect(ok.status).toBe(200);
      expect(ok.body.kpis.epis_total).toBe(5);
    }
    // vinculado a A, mas pedindo B: a RLS não enxerga a empresa
    const outra = await dash(`?tenant_id=${tenantB}`, tokenTecLinked);
    expect(outra.status).toBe(404);
    expect(JSON.stringify(outra.body)).not.toContain('kpis');
    // técnico sem vínculo
    expect((await dash('', tokenTecFree)).status).toBe(400);
    const livre = await dash(`?tenant_id=${tenantA}`, tokenTecFree);
    expect(livre.status).toBe(404);
    // admin
    expect((await dash('', tokenAdmin)).status).toBe(400);
    const adm = await dash(`?tenant_id=${tenantB}`, tokenAdmin);
    expect(adm.status).toBe(200);
    expect(adm.body.kpis.epis_total).toBe(12);
    // tenant_id inexistente
    expect((await dash('?tenant_id=00000000-0000-4000-8000-000000000000', tokenAdmin)).status).toBe(404);
  });

  it('empresa com tenant_id de outra empresa -> 400; com o próprio -> 200', async () => {
    expect((await dash(`?tenant_id=${tenantB}`)).status).toBe(400);
    expect((await dash(`?tenant_id=${tenantA}`)).status).toBe(200);
  });

  it('exige autenticação', async () => {
    expect((await request(srv).get('/epis/dashboard')).status).toBe(401);
  });

  it('entrada inválida -> 400 (nunca 500)', async () => {
    const bad = [
      'from=20260101', 'from=2026-1-1', 'from=2026-02-30', 'to=2026-13-01', 'from=2026-01-01T00:00:00Z', 'to=abc', 'from=0000-01-01',
      'from=2026-02-10&to=2026-02-09',
      'from=2024-01-01&to=2026-01-01',
      'epi_id=abc', `epi_id=${epi.e1}x`, 'employee_id=123', 'tenant_id=xyz',
      'foo=1', 'page=2',
      `from=2026-01-01&from=2026-01-02`, `epi_id=${epi.e1}&epi_id=${epi.e2}`,
      'from[]=2026-01-01', 'from=',
    ];
    for (const qs of bad) {
      const r = await dash(`?${qs}`);
      expect([qs, r.status]).toEqual([qs, 400]);
    }
  });

  it('dias de aviso diferentes mudam ca_expiring/lots_expiring (PATCH settings epi_alert_days=5 -> 0 a vencer)', async () => {
    const p = await request(srv).patch('/epis/settings').set(auth()).send({ epi_alert_days: 5 });
    expect(p.status).toBe(200);
    const r = await dash();
    expect(r.body.alert_days).toBe(5);
    expect(r.body.kpis).toMatchObject({ ca_expiring: 0, lots_expiring: 0, ca_expired: 1, lots_expired: 1 });
    const alerts = Object.fromEntries(r.body.alerts.map((a: any) => [a.epi_id, a]));
    expect(alerts[epi.e4]).toBeUndefined(); // CA em 10 dias não é mais "a vencer"
    expect(alerts[epi.e5]).toMatchObject({ lots_expired: 1, lots_expiring: 0 });
    // com 10 dias o limite é inclusivo (CA e lote vencem exatamente em hoje+10)
    expect((await request(srv).patch('/epis/settings').set(auth()).send({ epi_alert_days: 10 })).status).toBe(200);
    expect((await dash()).body.kpis).toMatchObject({ ca_expiring: 1, lots_expiring: 1 });
    await request(srv).patch('/epis/settings').set(auth()).send({ epi_alert_days: 30 });
  });

  it('EPI inativo sai dos indicadores', async () => {
    await sql.query(`UPDATE tenant_epis SET status = 'inativo' WHERE id = $1`, [epi.e2]);
    const r = await dash();
    expect(r.body.kpis).toMatchObject({ epis_total: 4, zero_stock: 0 });
    expect(r.body.alerts.map((a: any) => a.epi_id)).not.toContain(epi.e2);
    await sql.query(`UPDATE tenant_epis SET status = 'ativo' WHERE id = $1`, [epi.e2]);
  });
});
