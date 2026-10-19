import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/common/database/database.service';
import { EpiStockService } from '../src/epi/epi-stock.service';
import { TestDb } from './db-test-helper';

describe('Movimentações de estoque de EPI (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sql: Client;
  let token: string;
  let epiId: string;
  let epiLotId: string;
  let tenantId: string;
  let employeeId: string;
  let userId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const mov = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/epis/${id}/movements`).set(auth()).send(body);
  const balance = async (id: string) =>
    (await sql.query('SELECT stock_balance FROM tenant_epis WHERE id = $1', [id])).rows[0].stock_balance;
  let seq = 0;
  const key = () => `teste-mov-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();
    const t = await db.createTenantWithUser('Empresa Epi Estoque');
    tenantId = t.tenantId;
    employeeId = t.employeeId;
    userId = t.userId;
    token = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: t.email, password: t.password })
    ).body.access_token;
    const cat = (await request(app.getHttpServer()).get('/epi-catalog-items').set(auth())).body;
    epiId = (
      await request(app.getHttpServer())
        .post('/epis')
        .set(auth())
        .send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-EST-1', manufacturer: 'Fab', model: 'M1' })
    ).body.id;
    epiLotId = (
      await request(app.getHttpServer())
        .post('/epis')
        .set(auth())
        .send({ epi_catalog_item_id: cat[1].id, ca_number: 'CA-EST-2', controls_lot: true })
    ).body.id;
  });

  afterAll(async () => {
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  it('abertura define o saldo inicial e só pode existir uma por EPI', async () => {
    const r = await mov(epiId, { type: 'abertura', quantity: 10, idempotency_key: key() });
    expect(r.status).toBe(201);
    expect(r.body.balance_after).toBe(10);
    expect(await balance(epiId)).toBe(10);
    const again = await mov(epiId, { type: 'abertura', quantity: 5, idempotency_key: key() });
    expect(again.status).toBe(409);
    expect(await balance(epiId)).toBe(10);
  });

  it('entrada soma ao saldo e baixa subtrai, ambas com histórico', async () => {
    await mov(epiId, { type: 'entrada', quantity: 100, supplier: 'Fornecedor A', idempotency_key: key() });
    expect(await balance(epiId)).toBe(110);
    const b = await mov(epiId, { type: 'baixa', quantity: 3, reason: 'Item danificado', idempotency_key: key() });
    expect(b.status).toBe(201);
    expect(await balance(epiId)).toBe(107);
    const list = await request(app.getHttpServer()).get(`/epis/movements?tenant_epi_id=${epiId}`).set(auth());
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(3);
  });

  it('rejeita saída maior que o saldo, sem alterar nada', async () => {
    const r = await mov(epiId, { type: 'baixa', quantity: 999, reason: 'Teste', idempotency_key: key() });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/insuficiente/i);
    expect(await balance(epiId)).toBe(107);
  });

  it('repetir a mesma idempotency_key devolve a mesma movimentação sem mexer no saldo', async () => {
    const k = key();
    const first = await mov(epiId, { type: 'entrada', quantity: 1, supplier: 'F', idempotency_key: k });
    const second = await mov(epiId, { type: 'entrada', quantity: 1, supplier: 'F', idempotency_key: k });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await balance(epiId)).toBe(108);
    const conflict = await mov(epiId, { type: 'entrada', quantity: 7, supplier: 'F', idempotency_key: k });
    expect(conflict.status).toBe(409);
  });

  it('exige motivo em baixa e fornecedor/origem em entrada', async () => {
    expect((await mov(epiId, { type: 'baixa', quantity: 1, idempotency_key: key() })).status).toBe(400);
    expect((await mov(epiId, { type: 'entrada', quantity: 1, idempotency_key: key() })).status).toBe(400);
  });

  it('EPI com controle de lote exige lote e mantém saldo por lote', async () => {
    const semLote = await mov(epiLotId, { type: 'entrada', quantity: 5, supplier: 'F', idempotency_key: key() });
    expect(semLote.status).toBe(400);
    const ok = await mov(epiLotId, {
      type: 'entrada', quantity: 5, supplier: 'F', lot_code: 'L-001', lot_valid_until: '2099-12-31',
      idempotency_key: key(),
    });
    expect(ok.status).toBe(201);
    expect(ok.body.lot_id).toBeTruthy();
    const lot = await sql.query('SELECT balance FROM epi_lots WHERE id = $1', [ok.body.lot_id]);
    expect(lot.rows[0].balance).toBe(5);
    const saida = await mov(epiLotId, {
      type: 'baixa', quantity: 9, reason: 'Teste', lot_id: ok.body.lot_id, idempotency_key: key(),
    });
    expect(saida.status).toBe(409);
  });

  it('abertura em EPI com lote: uma por lote (409 se o lote já tem movimentação)', async () => {
    const a = await mov(epiLotId, {
      type: 'abertura', quantity: 4, lot_code: 'L-AB-1', lot_valid_until: '2099-12-31', idempotency_key: key(),
    });
    expect(a.status).toBe(201);
    const dup = await mov(epiLotId, { type: 'abertura', quantity: 2, lot_code: 'L-AB-1', idempotency_key: key() });
    expect(dup.status).toBe(409);
    const dupId = await mov(epiLotId, { type: 'abertura', quantity: 2, lot_id: a.body.lot_id, idempotency_key: key() });
    expect(dupId.status).toBe(409);
    const outro = await mov(epiLotId, {
      type: 'abertura', quantity: 3, lot_code: 'L-AB-2', lot_valid_until: '2099-12-31', idempotency_key: key(),
    });
    expect(outro.status).toBe(201);
  });

  it('lote vencido (validade vinda do pg como Date) bloqueia entrega', async () => {
    const l = await mov(epiLotId, {
      type: 'entrada', quantity: 5, supplier: 'F', lot_code: 'L-VENC', lot_valid_until: '2000-01-01',
      idempotency_key: key(),
    });
    expect(l.status).toBe(201);
    const e = await mov(epiLotId, {
      type: 'entrega', quantity: 1, employee_id: employeeId, lot_id: l.body.lot_id, idempotency_key: key(),
    });
    expect(e.status).toBe(409);
    expect(e.body.message).toMatch(/vencido/i);
  });

  it('entrega vincula uma entrega pendente e valida o funcionário do tenant', async () => {
    const e = await mov(epiId, { type: 'entrega', quantity: 1, employee_id: employeeId, idempotency_key: key() });
    expect(e.status).toBe(201);
    expect(e.body.delivery_id).toBeTruthy();
    const d = await sql.query('SELECT signature_status FROM employee_epi_deliveries WHERE id = $1', [e.body.delivery_id]);
    expect(d.rows[0].signature_status).toBe('pendente');
    const fake = await mov(epiId, {
      type: 'entrega', quantity: 1, employee_id: '00000000-0000-4000-8000-000000000000', idempotency_key: key(),
    });
    expect(fake.status).toBe(404);
  });

  it('entrega cria a entrega pendente e baixa o saldo; estorno devolve ao estoque e marca a entrega', async () => {
    await mov(epiId, { type: 'entrada', quantity: 10, supplier: 'F', idempotency_key: key() });
    const before = await balance(epiId);
    const e = await mov(epiId, { type: 'entrega', quantity: 2, employee_id: employeeId, idempotency_key: key() });
    expect(e.status).toBe(201);
    expect(e.body.delivery_id).toBeTruthy();
    expect(await balance(epiId)).toBe(before - 2);
    const del = await sql.query('SELECT signature_status, quantity, signed_at FROM employee_epi_deliveries WHERE id = $1', [e.body.delivery_id]);
    expect(del.rows[0]).toMatchObject({ signature_status: 'pendente', quantity: 2, signed_at: null });

    const rev = await request(app.getHttpServer())
      .post(`/epis/movements/${e.body.id}/reversal`).set(auth())
      .send({ reason: 'Entrega cancelada', idempotency_key: key() });
    expect(rev.status).toBe(201);
    expect(rev.body.type).toBe('estorno');
    expect(rev.body.reverses_movement_id).toBe(e.body.id);
    expect(await balance(epiId)).toBe(before);
    const del2 = await sql.query('SELECT signature_status FROM employee_epi_deliveries WHERE id = $1', [e.body.delivery_id]);
    expect(del2.rows[0].signature_status).toBe('estornada');
    // a movimentação original continua no histórico, intacta
    const orig = await sql.query('SELECT quantity FROM epi_movements WHERE id = $1', [e.body.id]);
    expect(orig.rows[0].quantity).toBe(2);
  });

  it('não estorna duas vezes nem estorna um estorno', async () => {
    const e = await mov(epiId, { type: 'entrada', quantity: 3, supplier: 'F', idempotency_key: key() });
    expect(e.status).toBe(201);
    const r1 = await request(app.getHttpServer()).post(`/epis/movements/${e.body.id}/reversal`).set(auth())
      .send({ reason: 'Erro de digitação', idempotency_key: key() });
    expect(r1.status).toBe(201);
    const r2 = await request(app.getHttpServer()).post(`/epis/movements/${e.body.id}/reversal`).set(auth())
      .send({ reason: 'De novo', idempotency_key: key() });
    expect(r2.status).toBe(409);
    const r3 = await request(app.getHttpServer()).post(`/epis/movements/${r1.body.id}/reversal`).set(auth())
      .send({ reason: 'Estornar estorno', idempotency_key: key() });
    expect(r3.status).toBe(409);
  });

  it('devolução soma ao saldo e exige funcionário; funcionário de outra empresa é recusado', async () => {
    await mov(epiId, { type: 'entrega', quantity: 1, employee_id: employeeId, idempotency_key: key() });
    const before = await balance(epiId);
    const d = await mov(epiId, { type: 'devolucao', quantity: 1, employee_id: employeeId, reason: 'Fim de uso', idempotency_key: key() });
    expect(d.status).toBe(201);
    expect(await balance(epiId)).toBe(before + 1);
    expect((await mov(epiId, { type: 'devolucao', quantity: 1, idempotency_key: key() })).status).toBe(400);
    const outro = await db.createTenantWithUser('Empresa Epi Estoque Outra');
    const bad = await mov(epiId, { type: 'entrega', quantity: 1, employee_id: outro.employeeId, idempotency_key: key() });
    expect(bad.status).toBe(404);
  });

  it('devolução não pode exceder o que foi entregue ao funcionário (nem em EPI sem entrega)', async () => {
    const cat = (await request(app.getHttpServer()).get('/epi-catalog-items').set(auth())).body;
    const novo = (await request(app.getHttpServer()).post('/epis').set(auth())
      .send({ epi_catalog_item_id: cat[3].id, ca_number: 'CA-DEV-1' })).body.id;
    await mov(novo, { type: 'abertura', quantity: 10, idempotency_key: key() });
    const semEntrega = await mov(novo, { type: 'devolucao', quantity: 1, employee_id: employeeId, idempotency_key: key() });
    expect(semEntrega.status).toBe(409);
    expect(semEntrega.body.message).toMatch(/Devolução maior que a quantidade entregue/);
    await mov(novo, { type: 'entrega', quantity: 2, employee_id: employeeId, idempotency_key: key() });
    const maior = await mov(novo, { type: 'devolucao', quantity: 3, employee_id: employeeId, idempotency_key: key() });
    expect(maior.status).toBe(409);
    expect(await balance(novo)).toBe(8);
  });

  it('devolução de item cuja entrega foi estornada é recusada', async () => {
    const cat = (await request(app.getHttpServer()).get('/epi-catalog-items').set(auth())).body;
    const novo = (await request(app.getHttpServer()).post('/epis').set(auth())
      .send({ epi_catalog_item_id: cat[4].id, ca_number: 'CA-DEV-2' })).body.id;
    await mov(novo, { type: 'abertura', quantity: 10, idempotency_key: key() });
    const e = await mov(novo, { type: 'entrega', quantity: 2, employee_id: employeeId, idempotency_key: key() });
    const rv = await request(app.getHttpServer()).post(`/epis/movements/${e.body.id}/reversal`).set(auth())
      .send({ reason: 'Entrega cancelada', idempotency_key: key() });
    expect(rv.status).toBe(201);
    const d = await mov(novo, { type: 'devolucao', quantity: 1, employee_id: employeeId, idempotency_key: key() });
    expect(d.status).toBe(409);
    expect(await balance(novo)).toBe(10);
  });

  it('devoluções parciais somam o entregue; a seguinte excede e é recusada', async () => {
    const cat = (await request(app.getHttpServer()).get('/epi-catalog-items').set(auth())).body;
    const novo = (await request(app.getHttpServer()).post('/epis').set(auth())
      .send({ epi_catalog_item_id: cat[5].id, ca_number: 'CA-DEV-3' })).body.id;
    await mov(novo, { type: 'abertura', quantity: 10, idempotency_key: key() });
    await mov(novo, { type: 'entrega', quantity: 3, employee_id: employeeId, idempotency_key: key() });
    const mk = () => mov(novo, { type: 'devolucao', quantity: 2, employee_id: employeeId, idempotency_key: key() });
    const mk1 = () => mov(novo, { type: 'devolucao', quantity: 1, employee_id: employeeId, idempotency_key: key() });
    expect((await mk()).status).toBe(201);
    expect((await mk1()).status).toBe(201);
    expect((await mk1()).status).toBe(409);
    expect(await balance(novo)).toBe(10);
  });

  it('estornar a devolução libera de novo a quantidade devolvível', async () => {
    const cat = (await request(app.getHttpServer()).get('/epi-catalog-items').set(auth())).body;
    const novo = (await request(app.getHttpServer()).post('/epis').set(auth())
      .send({ epi_catalog_item_id: cat[6].id, ca_number: 'CA-DEV-4' })).body.id;
    await mov(novo, { type: 'abertura', quantity: 5, idempotency_key: key() });
    await mov(novo, { type: 'entrega', quantity: 2, employee_id: employeeId, idempotency_key: key() });
    const d = await mov(novo, { type: 'devolucao', quantity: 2, employee_id: employeeId, idempotency_key: key() });
    expect(d.status).toBe(201);
    expect((await mov(novo, { type: 'devolucao', quantity: 1, employee_id: employeeId, idempotency_key: key() })).status).toBe(409);
    const rvd = await request(app.getHttpServer()).post(`/epis/movements/${d.body.id}/reversal`).set(auth())
      .send({ reason: 'Devolução lançada errada', idempotency_key: key() });
    expect(rvd.status).toBe(201);
    expect((await mov(novo, { type: 'devolucao', quantity: 2, employee_id: employeeId, idempotency_key: key() })).status).toBe(201);
  });

  it('estorno de entrega já devolvida exige estornar antes a devolução; sem devolução o estorno passa', async () => {
    const cat = (await request(app.getHttpServer()).get('/epi-catalog-items').set(auth())).body;
    const novo = (await request(app.getHttpServer()).post('/epis').set(auth())
      .send({ epi_catalog_item_id: cat[7].id, ca_number: 'CA-DEV-5' })).body.id;
    const rev = (id: string) =>
      request(app.getHttpServer()).post(`/epis/movements/${id}/reversal`).set(auth())
        .send({ reason: 'Correção de lançamento', idempotency_key: key() });
    await mov(novo, { type: 'abertura', quantity: 10, idempotency_key: key() });
    // (c) sem devolução, o estorno da entrega continua valendo
    const e0 = await mov(novo, { type: 'entrega', quantity: 1, employee_id: employeeId, idempotency_key: key() });
    expect((await rev(e0.body.id)).status).toBe(201);
    expect(await balance(novo)).toBe(10);
    // (a) com devolução pendente: 409 e estoque inalterado
    const e = await mov(novo, { type: 'entrega', quantity: 2, employee_id: employeeId, idempotency_key: key() });
    expect(await balance(novo)).toBe(8);
    const d = await mov(novo, { type: 'devolucao', quantity: 1, employee_id: employeeId, idempotency_key: key() });
    expect(d.status).toBe(201);
    expect(await balance(novo)).toBe(9);
    const bloq = await rev(e.body.id);
    expect(bloq.status).toBe(409);
    expect(bloq.body.message).toMatch(/Estorne antes as devoluções/);
    expect(await balance(novo)).toBe(9);
    // (b) estornando a devolução e depois a entrega, o estoque volta ao valor anterior à entrega
    expect((await rev(d.body.id)).status).toBe(201);
    expect((await rev(e.body.id)).status).toBe(201);
    expect(await balance(novo)).toBe(10);
  });

  it('bloqueia entrega de EPI com CA vencido', async () => {
    const cat = (await request(app.getHttpServer()).get('/epi-catalog-items').set(auth())).body;
    const vencido = (await request(app.getHttpServer()).post('/epis').set(auth())
      .send({ epi_catalog_item_id: cat[2].id, ca_number: 'CA-VENC', ca_valid_until: '2020-01-01' })).body.id;
    await mov(vencido, { type: 'abertura', quantity: 5, idempotency_key: key() });
    const r = await mov(vencido, { type: 'entrega', quantity: 1, employee_id: employeeId, idempotency_key: key() });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/CA vencido/);
  });

  it('rotas com UUID inválido devolvem 400', async () => {
    const a = await request(app.getHttpServer()).post('/epis/xx/adjustments').set(auth())
      .send({ direction: 'mais', quantity: 1, reason: 'Contagem', idempotency_key: key() });
    expect(a.status).toBe(400);
    const r = await request(app.getHttpServer()).post('/epis/movements/xx/reversal').set(auth())
      .send({ reason: 'Teste', idempotency_key: key() });
    expect(r.status).toBe(400);
  });

  it('ajuste: soma/subtrai com motivo, exige lote em EPI com lote e recusa lote em EPI sem lote', async () => {
    const adj = (id: string, body: Record<string, unknown>) =>
      request(app.getHttpServer()).post(`/epis/${id}/adjustments`).set(auth()).send({ idempotency_key: key(), ...body });
    const before = await balance(epiId);
    const mais = await adj(epiId, { direction: 'mais', quantity: 2, reason: 'Contagem física' });
    expect(mais.status).toBe(201);
    expect(mais.body.type).toBe('ajuste');
    expect(await balance(epiId)).toBe(before + 2);
    expect((await adj(epiId, { direction: 'menos', quantity: 1, reason: 'Contagem física' })).status).toBe(201);
    expect((await adj(epiId, { direction: 'menos', quantity: 1, reason: 'abc' })).status).toBe(400);
    expect((await adj(epiId, { direction: 'menos', quantity: 9999, reason: 'Contagem física' })).status).toBe(409);
    expect((await adj(epiId, { direction: 'mais', quantity: 1, reason: 'Contagem física', lot_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await adj(epiLotId, { direction: 'mais', quantity: 1, reason: 'Contagem física' })).status).toBe(400);
    const k = key();
    expect((await adj(epiId, { direction: 'mais', quantity: 1, reason: 'Repetido ok', idempotency_key: k })).status).toBe(201);
    expect((await adj(epiId, { direction: 'mais', quantity: 1, reason: 'Repetido ok', idempotency_key: k })).status).toBe(200);
  });

  it('GET /epis/movements valida UUIDs de query', async () => {
    const r = await request(app.getHttpServer()).get('/epis/movements?tenant_epi_id=xx').set(auth());
    expect(r.status).toBe(400);
    const r2 = await request(app.getHttpServer()).get('/epis/movements?employee_id=xx').set(auth());
    expect(r2.status).toBe(400);
  });

  it('GET /epis/movements rejeita parâmetros inválidos com 400 e aceita filtro válido', async () => {
    const get = (qs: string) => request(app.getHttpServer()).get(`/epis/movements?${qs}`).set(auth());
    for (const qs of [
      'from=abc', 'to=2026-13-45', 'type=inexistente', 'page=0', 'page=100000000000000000000',
      'page_size=101', 'page=1e3', 'from=2026-01-01&from=2026-02-01',
    ]) {
      expect([qs, (await get(qs)).status]).toEqual([qs, 400]);
    }
    const ok = await get(`tenant_epi_id=${epiId}&type=entrada&from=2020-01-01&to=2099-12-31&page=1&page_size=10`);
    expect(ok.status).toBe(200);
    expect(ok.body.total).toBeGreaterThan(0);
  });

  it('idempotência compara funcionário, fornecedor e EPI, não só tipo e quantidade', async () => {
    const k = key();
    const body = { type: 'entrega', quantity: 1, employee_id: employeeId, idempotency_key: k };
    const first = await mov(epiId, body);
    expect(first.status).toBe(201);
    expect((await mov(epiId, body)).status).toBe(200);
    const outro = await mov(epiId, { ...body, employee_id: '00000000-0000-4000-8000-000000000001' });
    expect(outro.status).toBe(409);
    const k2 = key();
    expect((await mov(epiId, { type: 'entrada', quantity: 1, supplier: 'F1', idempotency_key: k2 })).status).toBe(201);
    expect((await mov(epiId, { type: 'entrada', quantity: 1, supplier: 'F2', idempotency_key: k2 })).status).toBe(409);
    expect((await mov(epiLotId, { type: 'entrada', quantity: 1, supplier: 'F1', idempotency_key: k2 })).status).toBe(409);
  });

  it('GET /epis/movements: formas ISO que o Postgres rejeitaria dão 400; formas válidas dão 200', async () => {
    const get = (qs: string) => request(app.getHttpServer()).get(`/epis/movements?${qs}`).set(auth());
    for (const v of ['2026-W01', '2026-W01-1', '2026-001', '2026', '2026-01']) {
      expect([v, (await get(`from=${v}`)).status]).toEqual([v, 400]);
      expect([v, (await get(`to=${v}`)).status]).toEqual([v, 400]);
    }
    for (const v of [
      '2026-10-01', '2026-10-01T10:00:00Z', '2026-10-01T10:00', '2026-10-01T10:00:00.123Z',
      '2026-10-01T10:00:00-03:00', '2026-10-01T10:00+03:00',
    ]) {
      expect([v, (await get(`from=${encodeURIComponent(v)}&to=${encodeURIComponent(v)}`)).status]).toEqual([v, 200]);
    }
  });

  it('idempotência do estorno compara a movimentação estornada (serviço)', async () => {
    const stock = app.get(EpiStockService);
    const database = app.get(DatabaseService);
    const a = await mov(epiId, { type: 'entrada', quantity: 2, supplier: 'F', idempotency_key: key() });
    const b = await mov(epiId, { type: 'entrada', quantity: 2, supplier: 'F', idempotency_key: key() });
    const k = key();
    const ctx = { userId, tenantId, role: 'empresa' };
    const rev = (id: string) =>
      database.withTenantContext(ctx, (c) => stock.reverse(c, id, { reason: 'Erro', idempotencyKey: k, userId }));
    const first = await rev(a.body.id);
    expect(first.replayed).toBe(false);
    expect((await rev(a.body.id)).replayed).toBe(true);
    await expect(rev(b.body.id)).rejects.toMatchObject({ status: 409 });
  });

  it('GET /epis/movements devolve reversed: original estornada true, estorno false, mesmo com filtro e paginação', async () => {
    const epi = (
      await request(app.getHttpServer()).post('/epis').set(auth()).send({
        epi_catalog_item_id: (await request(app.getHttpServer()).get('/epi-catalog-items').set(auth())).body[2].id,
        ca_number: 'CA-REV-1',
      })
    ).body.id;
    await mov(epi, { type: 'abertura', quantity: 20, idempotency_key: key() });
    const e1 = await mov(epi, { type: 'entrega', quantity: 1, employee_id: employeeId, idempotency_key: key() });
    const e2 = await mov(epi, { type: 'entrega', quantity: 1, employee_id: employeeId, idempotency_key: key() });
    expect([e1.status, e2.status]).toEqual([201, 201]);
    const rev = await request(app.getHttpServer())
      .post(`/epis/movements/${e1.body.id}/reversal`).set(auth())
      .send({ reason: 'Erro de lançamento', idempotency_key: key() });
    expect(rev.status).toBe(201);
    const list = (qs: string) => request(app.getHttpServer()).get(`/epis/movements?tenant_epi_id=${epi}&${qs}`).set(auth());
    const byId = (items: any[], id: string) => items.find((i) => i.id === id);

    // (1) lista completa
    const all = await list('page_size=50');
    expect(all.status).toBe(200);
    expect(byId(all.body.items, e1.body.id).reversed).toBe(true);
    expect(byId(all.body.items, rev.body.id).reversed).toBe(false);
    expect(byId(all.body.items, e2.body.id).reversed).toBe(false);

    // (2) filtro por tipo: o estorno não aparece, mas a original continua marcada
    const f = await list('type=entrega&page_size=50');
    expect(f.body.items.map((i: any) => i.id).sort()).toEqual([e1.body.id, e2.body.id].sort());
    expect(byId(f.body.items, e1.body.id).reversed).toBe(true);
    expect(byId(f.body.items, e2.body.id).reversed).toBe(false);

    // (3) paginação: o estorno (mais recente) na página 1, a original em outra página
    const p1 = await list('page=1&page_size=1');
    expect(p1.body.items).toHaveLength(1);
    expect(p1.body.items[0].id).toBe(rev.body.id);
    expect(p1.body.items[0].reversed).toBe(false);
    const p3 = await list('page=3&page_size=1');
    expect(p3.body.items[0].id).toBe(e1.body.id);
    expect(p3.body.items[0].reversed).toBe(true);

    // (4) outro tenant: não enxerga os movimentos e as próprias linhas não herdam reversed
    const o = await db.createTenantWithUser('Empresa Epi Reversed Outra');
    const tokenO = (await request(app.getHttpServer()).post('/auth/login').send({ email: o.email, password: o.password })).body.access_token;
    const authO = { Authorization: `Bearer ${tokenO}` };
    const catO = (await request(app.getHttpServer()).get('/epi-catalog-items').set(authO)).body;
    const epiO = (await request(app.getHttpServer()).post('/epis').set(authO).send({ epi_catalog_item_id: catO[0].id, ca_number: 'CA-REV-O' })).body.id;
    const ab = await request(app.getHttpServer()).post(`/epis/${epiO}/movements`).set(authO)
      .send({ type: 'abertura', quantity: 5, idempotency_key: key() });
    expect(ab.status).toBe(201);
    const lo = await request(app.getHttpServer()).get('/epis/movements?page_size=50').set(authO);
    expect(lo.status).toBe(200);
    const ids = lo.body.items.map((i: any) => i.id);
    expect(ids).toContain(ab.body.id);
    expect(ids).not.toContain(e1.body.id);
    expect(lo.body.items.every((i: any) => i.reversed === false)).toBe(true);
    const again = await list('type=entrega&page_size=50');
    expect(byId(again.body.items, e1.body.id).reversed).toBe(true);
  });

  it('o saldo materializado sempre bate com a soma das movimentações', async () => {
    const r = await sql.query(
      `SELECT te.id, te.stock_balance, COALESCE(SUM(m.direction * m.quantity), 0)::int AS soma
       FROM tenant_epis te LEFT JOIN epi_movements m ON m.tenant_epi_id = te.id
       WHERE te.tenant_id = $1 GROUP BY te.id, te.stock_balance`,
      [tenantId],
    );
    for (const row of r.rows) expect(row.stock_balance).toBe(row.soma);
  });
});
