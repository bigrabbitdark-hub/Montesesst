import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Concorrência no estoque de EPI (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sql: Client;
  let token: string;
  let epiId: string;
  let employeeId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const mov = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(`/epis/${id}/movements`).set(auth()).send(body);
  const balance = async (id: string) =>
    (await sql.query('SELECT stock_balance FROM tenant_epis WHERE id = $1', [id])).rows[0].stock_balance;
  let seq = 0;
  const key = () => `teste-conc-${Date.now()}-${seq++}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();
    const t = await db.createTenantWithUser('Empresa Epi Concorrencia');
    employeeId = t.employeeId;
    token = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: t.email, password: t.password })
    ).body.access_token;
    const cat = (await request(app.getHttpServer()).get('/epi-catalog-items').set(auth())).body;
    epiId = (
      await request(app.getHttpServer())
        .post('/epis').set(auth())
        .send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-CONC-1' })
    ).body.id;
  });

  afterAll(async () => {
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  it('10 entregas simultâneas de 1 unidade sobre saldo 5: exatamente 5 passam, 5 falham, saldo 0', async () => {
    await mov(epiId, { type: 'abertura', quantity: 5, idempotency_key: key() });
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        mov(epiId, { type: 'entrega', quantity: 1, employee_id: employeeId, idempotency_key: key() }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const conflito = results.filter((r) => r.status === 409).length;
    expect(ok).toBe(5);
    expect(conflito).toBe(5);
    expect(await balance(epiId)).toBe(0);
    const soma = await sql.query(
      'SELECT COALESCE(SUM(direction * quantity),0)::int AS s FROM epi_movements WHERE tenant_epi_id = $1', [epiId]);
    expect(soma.rows[0].s).toBe(0);
    const entregas = await sql.query('SELECT count(*)::int AS n FROM employee_epi_deliveries WHERE tenant_epi_id = $1', [epiId]);
    expect(entregas.rows[0].n).toBe(5); // as 5 rejeitadas não deixam entrega órfã
  });

  it('10 requisições idênticas em paralelo (mesma chave) geram 1 movimentação', async () => {
    const k = key();
    const rs = await Promise.all(
      Array.from({ length: 10 }, () => mov(epiId, { type: 'entrada', quantity: 4, supplier: 'F', idempotency_key: k })),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(9);
    expect(await balance(epiId)).toBe(4);
  });

  it('devoluções simultâneas: 3 entregues e 7 pedidos em paralelo => 3 passam, 4 falham, estoque = abertura', async () => {
    const cat = (await request(app.getHttpServer()).get('/epi-catalog-items').set(auth())).body;
    const novo = (await request(app.getHttpServer()).post('/epis').set(auth())
      .send({ epi_catalog_item_id: cat[1].id, ca_number: 'CA-CONC-2' })).body.id;
    const emp = (await sql.query(
      `INSERT INTO employees (tenant_id, full_name, cpf, status)
       SELECT tenant_id, 'Funcionário Devolução Concorrente', $2, 'ativo' FROM employees WHERE id = $1 RETURNING id`,
      [employeeId, String(Date.now()).padStart(11, '7').slice(-11)],
    )).rows[0].id;
    expect((await mov(novo, { type: 'abertura', quantity: 10, idempotency_key: key() })).status).toBe(201);
    expect((await mov(novo, { type: 'entrega', quantity: 3, employee_id: emp, idempotency_key: key() })).status).toBe(201);
    const rs = await Promise.all(
      Array.from({ length: 7 }, () =>
        mov(novo, { type: 'devolucao', quantity: 1, employee_id: emp, idempotency_key: key() }),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(3);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await balance(novo)).toBe(10);
    const saldoFunc = await sql.query(
      `SELECT COALESCE(SUM(CASE WHEN type IN ('entrega','troca') THEN quantity ELSE -quantity END),0)::int AS s
       FROM epi_movements WHERE tenant_epi_id = $1 AND employee_id = $2`, [novo, emp]);
    expect(saldoFunc.rows[0].s).toBe(0);
  });
});
