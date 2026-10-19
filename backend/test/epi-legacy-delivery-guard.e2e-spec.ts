import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { TestDb } from './db-test-helper';

describe('Rota legada POST /epis/:id/deliveries endurecida (e2e)', () => {
  let app: INestApplication;
  let srv: any;
  let db: TestDb;
  let sql: Client;
  let token: string;
  let tenantId: string;
  let emp: string;
  let catId: string;
  let seq = 0;
  const key = () => `teste-legado-${Date.now()}-${seq++}-${randomUUID().slice(0, 6)}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const mkEpi = async (ca: string) => {
    const r = await request(srv).post('/epis').set(auth()).send({ epi_catalog_item_id: catId, ca_number: ca });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };
  const mov = (id: string, body: Record<string, unknown>) =>
    request(srv).post(`/epis/${id}/movements`).set(auth()).send({ idempotency_key: key(), ...body });
  const legacy = (id: string) =>
    request(srv).post(`/epis/${id}/deliveries`).set(auth()).send({ employee_id: emp, delivered_at: '2026-10-18', signed_by_name: 'Responsável' });
  const countDeliveries = async (id: string) =>
    Number((await sql.query('SELECT count(*) AS n FROM employee_epi_deliveries WHERE tenant_epi_id = $1', [id])).rows[0].n);

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
    const a = await db.createTenantWithUser('Empresa Entrega Legada');
    tenantId = a.tenantId;
    emp = a.employeeId;
    token = (await request(srv).post('/auth/login').send({ email: a.email, password: a.password })).body.access_token;
    catId = (await request(srv).get('/epi-catalog-items').set(auth())).body[0].id;
  });

  afterAll(async () => {
    await sql.query('DELETE FROM employee_epi_deliveries WHERE tenant_id = $1', [tenantId]);
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  it('EPI inativo -> 409 e nenhuma entrega gravada', async () => {
    const id = await mkEpi('CA-LEG-INATIVO');
    await sql.query(`UPDATE tenant_epis SET status = 'inativo' WHERE id = $1`, [id]);
    const r = await legacy(id);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/inativo/i);
    expect(await countDeliveries(id)).toBe(0);
  });

  it('CA vencido -> 409 com a mesma mensagem do fluxo novo', async () => {
    const id = await mkEpi('CA-LEG-VENCIDO');
    await sql.query(`UPDATE tenant_epis SET ca_valid_until = (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1 WHERE id = $1`, [id]);
    const r = await legacy(id);
    expect(r.status).toBe(409);
    expect(await countDeliveries(id)).toBe(0);
    // mensagem de referência: a do fluxo novo (livro) para o mesmo EPI vencido
    const outro = await mkEpi('CA-LEG-VENCIDO-LIVRO');
    expect((await mov(outro, { type: 'abertura', quantity: 5 })).status).toBe(201);
    await sql.query(`UPDATE tenant_epis SET ca_valid_until = (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1 WHERE id = $1`, [outro]);
    const novo = await mov(outro, { type: 'entrega', quantity: 1, employee_id: emp });
    expect(novo.status).toBe(409);
    expect(novo.body.message).toMatch(/CA vencido/);
    expect(r.body.message).toBe(novo.body.message);
  });

  it('EPI que já tem movimentação no livro -> 409 orientando a usar a movimentação', async () => {
    const id = await mkEpi('CA-LEG-LIVRO');
    expect((await mov(id, { type: 'abertura', quantity: 5 })).status).toBe(201);
    const r = await legacy(id);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/movimenta/i);
    expect(await countDeliveries(id)).toBe(0);
    const saldo = (await sql.query('SELECT stock_balance FROM tenant_epis WHERE id = $1', [id])).rows[0].stock_balance;
    expect(Number(saldo)).toBe(5);
  });

  it('EPI sem livro, ativo e com CA válido continua funcionando como antes (regressão do contrato legado)', async () => {
    const id = await mkEpi('CA-LEG-OK');
    await sql.query(`UPDATE tenant_epis SET ca_valid_until = (now() AT TIME ZONE 'America/Sao_Paulo')::date + 365 WHERE id = $1`, [id]);
    const r = await legacy(id);
    expect(r.status).toBe(201);
    expect(r.body.tenant_id).toBe(tenantId);
    expect(r.body.signed_by_name).toBe('Responsável');
    expect(r.body.signed_at).not.toBeNull();
    expect(await countDeliveries(id)).toBe(1);
  });

  it('borda: CA que vence hoje ainda é aceito na rota legada (201)', async () => {
    const id = await mkEpi('CA-LEG-HOJE');
    await sql.query(`UPDATE tenant_epis SET ca_valid_until = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = $1`, [id]);
    const r = await legacy(id);
    expect(r.status).toBe(201);
    expect(await countDeliveries(id)).toBe(1);
  });

  it('abertura de estoque concorrente com entrega legada: combinações consistentes, sem entrega após o livro', async () => {
    for (let round = 0; round < 6; round++) {
      const id = await mkEpi(`CA-LEG-CONC-${round}`);
      const [leg, ab] = await Promise.all([legacy(id), mov(id, { type: 'abertura', quantity: 5 })]);
      expect([201, 409]).toContain(leg.status);
      expect([201, 409]).toContain(ab.status);
      expect(ab.status).toBe(201); // a abertura nunca é recusada por causa da entrega legada
      const entregas = await countDeliveries(id);
      expect(entregas).toBe(leg.status === 201 ? 1 : 0);
      if (leg.status === 409) {
        // perdeu a corrida para o livro: a mensagem orienta a usar a movimentação e nada foi gravado
        expect(leg.body.message).toMatch(/movimenta/i);
      }
      const saldo = (await sql.query('SELECT stock_balance FROM tenant_epis WHERE id = $1', [id])).rows[0].stock_balance;
      expect(Number(saldo)).toBe(5);
    }
  });
});
