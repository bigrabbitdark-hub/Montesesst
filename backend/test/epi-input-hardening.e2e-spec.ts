import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

// Entradas inválidas nas rotas de movimentação devem dar 400/404/409, nunca 500.
describe('Endurecimento de entrada do livro de EPI (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sql: Client;
  let token: string;
  let epiId: string;
  let lotEpiId: string;
  let employeeId: string;
  let movId: string;
  const srv = () => app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${token}` });
  let seq = 0;
  const key = () => `hard-${Date.now()}-${seq++}`;
  const mov = (id: string, body: Record<string, unknown>) =>
    request(srv()).post(`/epis/${id}/movements`).set(auth()).send({ idempotency_key: key(), ...body });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();
    const t = await db.createTenantWithUser('Empresa Epi Hardening');
    employeeId = t.employeeId;
    token = (await request(srv()).post('/auth/login').send({ email: t.email, password: t.password })).body.access_token;
    const cat = (await request(srv()).get('/epi-catalog-items').set(auth())).body;
    epiId = (await request(srv()).post('/epis').set(auth()).send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-H-1' })).body.id;
    lotEpiId = (await request(srv()).post('/epis').set(auth())
      .send({ epi_catalog_item_id: cat[1].id, ca_number: 'CA-H-2', controls_lot: true })).body.id;
    const a = await mov(epiId, { type: 'abertura', quantity: 10 });
    movId = a.body.id;
  });

  afterAll(async () => {
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  it('movements: lot_valid_until, occurred_at e NUL inválidos -> 400', async () => {
    const base = { type: 'entrada', quantity: 1, supplier: 'F', lot_code: 'L1' };
    const bad: Record<string, unknown>[] = [
      { lot_valid_until: '2026' }, { lot_valid_until: '2026-05' }, { lot_valid_until: '2026-W10-1' },
      { lot_valid_until: '2026-123' }, { lot_valid_until: '2026-02-30' }, { lot_valid_until: '0000-01-01' },
      { occurred_at: '2026-02-30' }, { occurred_at: '2026' }, { occurred_at: '2026-W10-1' },
      { occurred_at: '2026-10-01T10:00:00+16:00' }, { occurred_at: '2026-10-01T10:00:00-15:60' },
      { occurred_at: '0000-01-01' },
      { supplier: 'a\u0000b' }, { lot_code: 'a\u0000b' }, { reason: 'a\u0000b' }, { idempotency_key: 'abcdefgh\u0000x' },
    ];
    for (const b of bad) {
      const r = await mov(lotEpiId, { ...base, ...b });
      expect([JSON.stringify(b), r.status]).toEqual([JSON.stringify(b), 400]);
    }
  });

  it('adjustments e reversal: NUL em reason/idempotency_key -> 400', async () => {
    for (const body of [
      { direction: 'mais', quantity: 1, reason: 'abc\u0000de', idempotency_key: key() },
      { direction: 'mais', quantity: 1, reason: 'contagem', idempotency_key: 'abcdefgh\u0000' },
    ]) {
      expect((await request(srv()).post(`/epis/${epiId}/adjustments`).set(auth()).send(body)).status).toBe(400);
    }
    for (const body of [
      { reason: 'abc\u0000de', idempotency_key: key() },
      { reason: 'motivo', idempotency_key: 'abcdefgh\u0000' },
    ]) {
      expect((await request(srv()).post(`/epis/movements/${movId}/reversal`).set(auth()).send(body)).status).toBe(400);
    }
  });

  it('GET /epis/movements com offset fora do limite -> 400', async () => {
    for (const v of ['2026-10-01T10:00:00+16:00', '0000-01-01', '2026-10-01T10:00:00-23:00']) {
      const r = await request(srv()).get('/epis/movements').query({ from: v }).set(auth());
      expect([v, r.status]).toEqual([v, 400]);
    }
    expect((await request(srv()).get('/epis/movements').query({ from: '2026-10-01T10:00:00-03:00' }).set(auth())).status).toBe(200);
  });

  it('datas válidas continuam aceitas em movements', async () => {
    const r = await mov(lotEpiId, {
      type: 'entrada', quantity: 1, supplier: 'F', lot_code: 'LOK', lot_valid_until: '2099-01-01',
      occurred_at: '2026-10-01T10:00:00-03:00',
    });
    expect(r.status).toBe(201);
  });

  it('devolução não cria lote novo: lot_code -> 400; lot_id existente -> 201', async () => {
    const ent = await mov(lotEpiId, {
      type: 'entrada', quantity: 10, supplier: 'F', lot_code: 'L-DEV', lot_valid_until: '2099-01-01',
    });
    const lotId = ent.body.lot_id;
    const ent1 = await mov(lotEpiId, { type: 'entrega', quantity: 2, employee_id: employeeId, lot_id: lotId });
    expect(ent1.status).toBe(201);
    const novo = await mov(lotEpiId, {
      type: 'devolucao', quantity: 1, employee_id: employeeId, lot_code: 'L-NOVO', lot_valid_until: '2000-01-01',
    });
    expect(novo.status).toBe(400);
    expect((await sql.query(`SELECT 1 FROM epi_lots WHERE lot_code = 'L-NOVO'`)).rowCount).toBe(0);
    const semLote = await mov(lotEpiId, { type: 'devolucao', quantity: 1, employee_id: employeeId });
    expect(semLote.status).toBe(400);
    const inexistente = await mov(lotEpiId, {
      type: 'devolucao', quantity: 1, employee_id: employeeId, lot_id: '00000000-0000-4000-8000-000000000000',
    });
    expect(inexistente.status).toBe(404);
    const ok = await mov(lotEpiId, { type: 'devolucao', quantity: 1, employee_id: employeeId, lot_id: lotId });
    expect(ok.status).toBe(201);
  });

  it('id inválido em DELETE /epis/:id e deliveries -> 400', async () => {
    expect((await request(srv()).delete('/epis/abc').set(auth())).status).toBe(400);
    expect((await request(srv()).get('/epis/abc/deliveries').set(auth())).status).toBe(400);
    expect((await request(srv()).post('/epis/abc/deliveries').set(auth())
      .send({ employee_id: employeeId, delivered_at: '2026-10-01', signed_by_name: 'X' })).status).toBe(400);
  });

  it('saldo acima do teto de INT -> 409 (não 500)', async () => {
    await sql.query('UPDATE tenant_epis SET stock_balance = 2147483000 WHERE id = $1', [epiId]);
    const r = await mov(epiId, { type: 'entrada', quantity: 100000, supplier: 'F' });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/máximo/i);
    // lote: saldo do lote no teto, EPI com saldo baixo
    const e = await mov(lotEpiId, { type: 'entrada', quantity: 1, supplier: 'F', lot_code: 'L-MAX', lot_valid_until: '2099-01-01' });
    await sql.query('UPDATE epi_lots SET balance = 2147483000 WHERE id = $1', [e.body.lot_id]);
    const r2 = await mov(lotEpiId, { type: 'entrada', quantity: 100000, supplier: 'F', lot_code: 'L-MAX' });
    expect(r2.status).toBe(409);
  });
});
