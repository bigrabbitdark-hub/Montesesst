import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

// Data (AAAA-MM-DD) de hoje + n dias no fuso de São Paulo.
const spDate = (plusDays: number) => {
  const base = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  base.setDate(base.getDate() + plusDays);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${base.getFullYear()}-${p(base.getMonth() + 1)}-${p(base.getDate())}`;
};

describe('Cadastro ampliado de EPI: edição, busca e lotes (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sql: Client;
  let token: string;
  let tokenTecLinked: string;
  let tokenTecOther: string;
  let tokenOther: string;
  let tenantId: string;
  let catId: string;
  let cats: any[];
  let epiId: string;

  const srv = () => app.getHttpServer();
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const auth = () => bearer(token);
  const login = async (email: string, password: string) =>
    (await request(srv()).post('/auth/login').send({ email, password })).body.access_token as string;
  const mov = (id: string, body: Record<string, unknown>) =>
    request(srv()).post(`/epis/${id}/movements`).set(auth()).send(body);
  let seq = 0;
  const key = () => `teste-sr-${Date.now()}-${seq++}`;
  const mk = async (body: Record<string, unknown>) => {
    const r = await request(srv()).post('/epis').set(auth()).send({ epi_catalog_item_id: catId, ...body });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();
    const t = await db.createTenantWithUser('Empresa Epi Search');
    const o = await db.createTenantWithUser('Empresa Epi Search Outra');
    tenantId = t.tenantId;
    token = await login(t.email, t.password);
    tokenOther = await login(o.email, o.password);
    const tecV = await db.createUserWithRole('tecnico', 'Tecnico Vinculado Epi Search');
    const tecO = await db.createUserWithRole('tecnico', 'Tecnico Sem Vinculo Epi Search');
    const c = (db as any).client;
    const techId = (await c.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecV.userId])).rows[0].id;
    await c.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tenantId, techId]);
    tokenTecLinked = await login(tecV.email, tecV.password);
    tokenTecOther = await login(tecO.email, tecO.password);
    cats = (await request(srv()).get('/epi-catalog-items').set(auth())).body;
    catId = cats[0].id;
    epiId = await mk({ ca_number: 'CA-UPD-1', manufacturer: 'Fab', model: 'M1' });
  });

  afterAll(async () => {
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  it('PATCH edita campos permitidos, ignora saldo e não permite mudar controls_lot com histórico', async () => {
    const r = await request(srv()).patch(`/epis/${epiId}`).set(auth())
      .send({ manufacturer: 'Fabricante Novo', min_stock: 5, max_stock: 50, unit_cost: 12.5 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ manufacturer: 'Fabricante Novo', min_stock: 5, max_stock: 50, unit_cost: '12.50' });
    expect((await request(srv()).patch(`/epis/${epiId}`).set(auth()).send({ stock_balance: 999 })).status).toBe(400);
    await mov(epiId, { type: 'abertura', quantity: 10, idempotency_key: key() });
    expect((await request(srv()).patch(`/epis/${epiId}`).set(auth()).send({ controls_lot: true })).status).toBe(409);
    expect((await request(srv()).patch(`/epis/${epiId}`).set(auth()).send({ min_stock: 60, max_stock: 50 })).status).toBe(400);
    // considera o valor atual: max atual = 50, subir min para 60 é inválido
    expect((await request(srv()).patch(`/epis/${epiId}`).set(auth()).send({ min_stock: 60 })).status).toBe(400);
    // mesmo valor de controls_lot não conta como mudança
    expect((await request(srv()).patch(`/epis/${epiId}`).set(auth()).send({ controls_lot: false })).status).toBe(200);
  });

  it('PATCH limpa campos anuláveis com null e rejeita null em campos obrigatórios', async () => {
    const id = await mk({ ca_number: 'CA-NULL', ca_valid_until: '2099-01-01', manufacturer: 'X' });
    const r = await request(srv()).patch(`/epis/${id}`).set(auth()).send({ ca_valid_until: null, manufacturer: null });
    expect(r.status).toBe(200);
    expect(r.body.ca_valid_until).toBeNull();
    expect(r.body.manufacturer).toBeNull();
    for (const body of [{ ca_number: null }, { unit: null }, { controls_lot: null }, { status: null }]) {
      expect((await request(srv()).patch(`/epis/${id}`).set(auth()).send(body)).status).toBe(400);
    }
    expect((await request(srv()).patch(`/epis/${id}`).set(auth()).send({})).status).toBe(200);
  });

  it('PATCH rejeita entradas inválidas com 400 (nunca 500)', async () => {
    const bad: Record<string, unknown>[] = [
      { tenant_id: tenantId }, { epi_catalog_item_id: catId }, { status: 'x' }, { min_stock: -1 },
      { min_stock: 1.5 }, { min_stock: 99999999999 }, { unit_cost: 1e12 }, { unit_cost: 'abc' },
      { replacement_days: 0 }, { ca_valid_until: '2026' }, { ca_valid_until: '2026-13-45' },
      { ca_valid_until: '2026-W10-1' }, { ca_valid_until: '2026-02-30' }, { ca_valid_until: '0000-01-01' }, { ca_number: '' }, { ca_number: 'a\u0000b' }, { manufacturer: 5 },
    ];
    for (const b of bad) {
      const r = await request(srv()).patch(`/epis/${epiId}`).set(auth()).send(b);
      expect([JSON.stringify(b), r.status]).toEqual([JSON.stringify(b), 400]);
    }
    expect((await request(srv()).patch('/epis/nao-e-uuid').set(auth()).send({})).status).toBe(400);
  });

  it('PATCH com identidade duplicada retorna 409', async () => {
    const a = await mk({ ca_number: 'CA-ID-A', manufacturer: 'F', model: 'M' });
    await mk({ ca_number: 'CA-ID-B', manufacturer: 'F', model: 'M' });
    const r = await request(srv()).patch(`/epis/${a}`).set(auth()).send({ ca_number: 'CA-ID-B' });
    expect(r.status).toBe(409);
  });

  it('permissões do PATCH: outra empresa e técnico sem vínculo recebem 404; técnico vinculado edita', async () => {
    const body = { manufacturer: 'Por Outro' };
    expect((await request(srv()).patch(`/epis/${epiId}`).set(bearer(tokenOther)).send(body)).status).toBe(404);
    expect((await request(srv()).patch(`/epis/${epiId}`).set(bearer(tokenTecOther)).send(body)).status).toBe(404);
    const ok = await request(srv()).patch(`/epis/${epiId}`).set(bearer(tokenTecLinked)).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.manufacturer).toBe('Por Outro');
  });

  it('duplicidade: mesmo catálogo+CA+fabricante+modelo na mesma empresa retorna 409', async () => {
    const body = { epi_catalog_item_id: catId, ca_number: 'CA-DUP', manufacturer: 'F', model: 'M' };
    expect((await request(srv()).post('/epis').set(auth()).send(body)).status).toBe(201);
    expect((await request(srv()).post('/epis').set(auth()).send(body)).status).toBe(409);
  });

  it('search pagina e filtra por faixa de estoque e por situação do CA', async () => {
    const zero = await mk({ ca_number: 'CA-S-ZERO' });
    const abaixo = await mk({ ca_number: 'CA-S-ABX', min_stock: 5 });
    await mov(abaixo, { type: 'abertura', quantity: 2, idempotency_key: key() });
    const otimo = await mk({ ca_number: 'CA-S-OTM', min_stock: 5, max_stock: 50 });
    await mov(otimo, { type: 'abertura', quantity: 20, idempotency_key: key() });
    const acima = await mk({ ca_number: 'CA-S-ACM', max_stock: 10 });
    await mov(acima, { type: 'abertura', quantity: 30, idempotency_key: key() });
    const venc = await mk({ ca_number: 'CA-S-VENC', ca_valid_until: spDate(-3) });

    const r = await request(srv()).get('/epis/search?stock_band=abaixo&page=1&page_size=10').set(auth());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ page: 1, page_size: 10 });
    expect(r.body.items.map((i: any) => i.id)).toEqual([abaixo]);
    const ids = async (qs: string) =>
      (await request(srv()).get(`/epis/search?${qs}`).set(auth())).body.items.map((i: any) => i.id);
    expect(await ids('stock_band=otimo')).toContain(otimo);
    expect(await ids('stock_band=acima')).toEqual([acima]);
    expect(await ids('stock_band=sem_estoque')).toContain(zero);
    expect(await ids('stock_band=sem_estoque')).not.toContain(otimo);
    const ca = await request(srv()).get('/epis/search?ca_alert=vencido').set(auth());
    expect(ca.body.items.map((i: any) => i.id)).toEqual([venc]);
    expect(ca.body.items.every((i: any) => i.ca_alert === 'vencido')).toBe(true);
    expect(await ids('ca_alert=sem_validade')).toContain(zero);
    const q = await request(srv()).get('/epis/search?q=CA-DUP').set(auth());
    expect(q.body.total).toBeGreaterThanOrEqual(1);
    // paginação
    const p1 = await request(srv()).get('/epis/search?page=1&page_size=2').set(auth());
    const p2 = await request(srv()).get('/epis/search?page=2&page_size=2').set(auth());
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.total).toBeGreaterThan(2);
    expect(p2.body.items.map((i: any) => i.id)).not.toEqual(expect.arrayContaining(p1.body.items.map((i: any) => i.id)));
    // valor do estoque = saldo x custo (null -> 0)
    await request(srv()).patch(`/epis/${otimo}`).set(auth()).send({ unit_cost: 2.5 });
    const val = (await request(srv()).get('/epis/search?q=CA-S-OTM').set(auth())).body.items[0];
    expect(val.stock_value).toBe('50.00');
    const nul = (await request(srv()).get('/epis/search?q=CA-S-ACM').set(auth())).body.items[0];
    expect(nul.stock_value).toBe('0.00');
  });

  it('search: q escapa curingas, filtra por category/status e isola por empresa', async () => {
    await mk({ ca_number: 'CA-100%-X' });
    await mk({ ca_number: 'CA-100A-X' });
    const pct = await request(srv()).get('/epis/search').query({ q: '100%' }).set(auth());
    expect(pct.body.items.map((i: any) => i.ca_number)).toEqual(['CA-100%-X']);
    const us = await request(srv()).get('/epis/search').query({ q: 'CA-_' }).set(auth());
    expect(us.body.total).toBe(0);
    const bs = await request(srv()).get('/epis/search').query({ q: '\\' }).set(auth());
    expect(bs.status).toBe(200);
    const cat = await request(srv()).get(`/epis/search?category=${cats[0].category}`).set(auth());
    expect(cat.body.items.every((i: any) => i.category === cats[0].category)).toBe(true);
    await request(srv()).patch(`/epis/${epiId}`).set(auth()).send({ status: 'inativo' });
    const ina = await request(srv()).get('/epis/search?status=inativo').set(auth());
    expect(ina.body.items.map((i: any) => i.id)).toEqual([epiId]);
    const other = await request(srv()).get('/epis/search').set(bearer(tokenOther));
    expect(other.body.total).toBe(0);
  });

  it('search rejeita parâmetros inválidos, desconhecidos ou repetidos com 400 (nunca 500)', async () => {
    const qs = [
      'stock_band=x', 'ca_alert=x', 'status=x', 'category=Z', 'category=a', 'page=0', 'page=10001', 'page=-1',
      'page=1.5', 'page=1e3', 'page=abc', 'page_size=0', 'page_size=101', 'page_size=0x10', 'page_size=%20',
      'foo=bar', 'tenant_id=x', 'status=ativo&status=inativo', 'page=1&page=2', 'q=a&q=b', `q=${'a'.repeat(101)}`,
      'q=a%00b', 'page=99999999999999999999',
    ];
    for (const s of qs) {
      const r = await request(srv()).get(`/epis/search?${s}`).set(auth());
      expect([s, r.status]).toEqual([s, 400]);
    }
  });

  it('alerta de CA respeita epi_alert_days da empresa (inclusive para técnico vinculado)', async () => {
    await sql.query('UPDATE tenants SET epi_alert_days = 10 WHERE id = $1', [tenantId]);
    const em5 = await mk({ ca_number: 'CA-AL-5', ca_valid_until: spDate(5) });
    const em20 = await mk({ ca_number: 'CA-AL-20', ca_valid_until: spDate(20) });
    for (const t of [token, tokenTecLinked]) {
      const r = await request(srv()).get('/epis/search?q=CA-AL-').set(bearer(t));
      expect(r.status).toBe(200);
      const by = (id: string) => r.body.items.find((i: any) => i.id === id);
      expect(by(em5).ca_alert).toBe('a_vencer');
      expect(by(em20).ca_alert).toBe('ok');
    }
  });

  it('lotes: contagem de vencidos/a vencer só com saldo e GET :id/lots', async () => {
    await sql.query('UPDATE tenants SET epi_alert_days = 10 WHERE id = $1', [tenantId]);
    const id = await mk({ ca_number: 'CA-LOTS', controls_lot: true });
    const ent = (lot: string, valid: string, qty = 5) =>
      mov(id, { type: 'entrada', quantity: qty, supplier: 'F', lot_code: lot, lot_valid_until: valid, idempotency_key: key() });
    const ok = [await ent('L-VENC', spDate(-2)), await ent('L-SOON', spDate(3)), await ent('L-FAR', spDate(40)),
      await ent('L-ZERO', spDate(-5))];
    ok.forEach((r) => expect(r.status).toBe(201));
    await mov(id, { type: 'baixa', quantity: 5, reason: 'Teste', lot_id: ok[3].body.lot_id, idempotency_key: key() });
    const it = (await request(srv()).get('/epis/search?q=CA-LOTS').set(auth())).body.items[0];
    expect(it.lots_expired).toBe(1);
    expect(it.lots_expiring).toBe(1);
    const lots = await request(srv()).get(`/epis/${id}/lots`).set(auth());
    expect(lots.status).toBe(200);
    expect(lots.body.map((l: any) => l.lot_code)).toEqual(['L-ZERO', 'L-VENC', 'L-SOON', 'L-FAR']);
    expect((await request(srv()).get(`/epis/${id}/lots`).set(bearer(tokenOther))).status).toBe(404);
    expect((await request(srv()).get('/epis/00000000-0000-4000-8000-000000000000/lots').set(auth())).status).toBe(404);
    expect((await request(srv()).get('/epis/abc/lots').set(auth())).status).toBe(400);
  });

  it('rotas literais não são engolidas por :id e GET /epis continua devolvendo array', async () => {
    expect(Array.isArray((await request(srv()).get('/epis').set(auth())).body)).toBe(true);
    expect((await request(srv()).get('/epis/movements').set(auth())).status).toBe(200);
    expect((await request(srv()).get('/epis/search').set(auth())).status).toBe(200);
  });
});
