import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { R2Service } from '../src/common/r2/r2.service';
import { EPI_TERM } from '../src/epi-ficha/epi-ficha-term';
import { hashPin, hashToken } from '../src/epi-signature/signature-secrets.util';
import { TestDb } from './db-test-helper';

// R2 sempre simulado em memória: nenhum arquivo de teste chega a um bucket real.
const store = new Map<string, Buffer>();
const fakeR2 = {
  putObject: async (k: string, b: Buffer) => void store.set(k, b),
  getObject: async (k: string) => {
    const v = store.get(k);
    if (!v) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return v;
  },
  deleteObject: async (k: string) => void store.delete(k),
  getPresignedDownloadUrl: async () => 'x',
};

describe('GET /epi-signatures/pending (e2e)', () => {
  let app: INestApplication;
  let srv: any;
  let db: TestDb;
  let sql: Client;
  let token: string;
  let tokenB: string;
  let tokenTecLinked: string;
  let tokenTecFree: string;
  let tokenPartner: string;
  let tokenPartnerFree: string;
  let tokenAdmin: string;
  let tenantId: string;
  let tenantIdB: string;
  let userA: string;
  let appDb: Client;
  let empB: string;
  let epiId: string;
  let epiIdB: string;
  let prevDraft: string | undefined;
  let prevPublic: string | undefined;
  let seq = 0;
  const key = () => `teste-pend-${Date.now()}-${seq++}-${randomUUID().slice(0, 6)}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const auth = () => bearer(token);
  const login = async (u: { email: string; password: string }) =>
    (await request(srv).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const newEmployee = async (name: string) =>
    (await sql.query(`INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, $2, $3, 'ativo') RETURNING id`,
      [tenantId, name, String(Math.floor(Math.random() * 1e11)).padStart(11, '0')])).rows[0].id as string;
  // entrega pelo livro de estoque (nasce 'pendente')
  const deliver = async (employee: string, qty: number, tok = token, epi = epiId): Promise<string> => {
    const r = await request(srv).post(`/epis/${epi}/movements`).set(bearer(tok)).send({ type: 'entrega', quantity: qty, employee_id: employee, idempotency_key: key() });
    expect(r.status).toBe(201);
    return r.body.delivery_id as string;
  };
  const create = (employee: string, body: Record<string, unknown> = {}, tok = token) =>
    request(srv).post('/epi-signatures/requests').set(bearer(tok)).send({ employee_id: employee, idempotency_key: key(), ...body });
  const inPerson = (body: Record<string, unknown>, tok = token) =>
    request(srv).post('/epi-signatures/in-person').set(bearer(tok)).send(body);
  const statusOf = async (id: string) => (await sql.query('SELECT status FROM epi_signature_requests WHERE id = $1', [id])).rows[0].status as string;
  const delivery = async (id: string) =>
    (await sql.query('SELECT signature_status, signed_at, signed_by_name FROM employee_epi_deliveries WHERE id = $1', [id])).rows[0];
  const tokenOf = (url: string) => url.split('token=')[1];

  beforeAll(async () => {
    prevDraft = process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM;
    prevPublic = process.env.PUBLIC_APP_URL;
    process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'true';
    delete process.env.PUBLIC_APP_URL;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(R2Service).useValue(fakeR2).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    srv = app.getHttpServer();
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();

    const a = await db.createTenantWithUser('Empresa Assinatura Pendentes');
    const b = await db.createTenantWithUser('Empresa Assinatura Pendentes B');
    tenantId = a.tenantId;
    tenantIdB = b.tenantId;
    userA = a.userId;
    appDb = new Client({ connectionString: process.env.DATABASE_URL });
    await appDb.connect();
    empB = b.employeeId;
    token = await login(a);
    tokenB = await login(b);

    const tecV = await db.createUserWithRole('tecnico', 'Tecnico Vinculado Pendentes');
    const tecF = await db.createUserWithRole('tecnico', 'Tecnico Livre Pendentes');
    const parc = await db.createUserWithRole('parceiro', 'Parceiro Vinculado Pendentes');
    const parcF = await db.createUserWithRole('parceiro', 'Parceiro Livre Pendentes');
    const adm = await db.createUserWithRole('admin', 'Admin Pendentes');
    const techId = (await sql.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecV.userId])).rows[0].id;
    await sql.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tenantId, techId]);
    await sql.query('INSERT INTO technicians (user_id) VALUES ($1)', [tecF.userId]);
    const partId = (await sql.query(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`, [parc.userId])).rows[0].id;
    await sql.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [tenantId, partId]);
    await sql.query(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC')`, [parcF.userId]);
    tokenTecLinked = await login(tecV);
    tokenTecFree = await login(tecF);
    tokenPartner = await login(parc);
    tokenPartnerFree = await login(parcF);
    tokenAdmin = await login(adm);

    const cat = (await request(srv).get('/epi-catalog-items').set(auth())).body;
    epiId = (await request(srv).post('/epis').set(auth()).send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-PEND-1', manufacturer: 'Fab', model: 'M1' })).body.id;
    expect((await request(srv).post(`/epis/${epiId}/movements`).set(auth()).send({ type: 'abertura', quantity: 5000, idempotency_key: key() })).status).toBe(201);
    epiIdB = (await request(srv).post('/epis').set(bearer(tokenB)).send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-PEND-B', manufacturer: 'Fab', model: 'M1' })).body.id;
    expect((await request(srv).post(`/epis/${epiIdB}/movements`).set(bearer(tokenB)).send({ type: 'abertura', quantity: 500, idempotency_key: key() })).status).toBe(201);
  });

  afterAll(async () => {
    if (prevDraft === undefined) delete process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM; else process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = prevDraft;
    if (prevPublic === undefined) delete process.env.PUBLIC_APP_URL; else process.env.PUBLIC_APP_URL = prevPublic;
    await db.cleanup();
    await sql.end();
    await appDb.end();
    await db.disconnect();
    await app.close();
  });

  const pending = (qs = '', tok = token) => request(srv).get(`/epi-signatures/pending${qs}`).set(bearer(tok));

  it('lista entregas pendentes com funcionário, EPI e o link ativo (sem token, código nem hash)', async () => {
    const emp = await newEmployee('Func Pendente Link');
    const d1 = await deliver(emp, 1), d2 = await deliver(emp, 2);
    const link = await create(emp);
    expect(link.status).toBe(201);
    const r = await pending(`?employee_id=${emp}`);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.items.map((i: any) => i.delivery_id).sort()).toEqual([d1, d2].sort());
    for (const it of r.body.items) {
      expect(it).toMatchObject({ employee_id: emp, employee_name: 'Func Pendente Link', epi_description: expect.any(String), signature_status: 'pendente', active_request_status: 'ativa', active_request_id: link.body.id });
      expect(it.quantity).toBeGreaterThan(0);
    }
    const txt = JSON.stringify(r.body);
    expect(txt).not.toMatch(/token|pin_hash|token_hash|code|cpf/i);
    expect(txt).not.toContain(tokenOf(link.body.url));
    expect(txt).not.toContain(link.body.code);
    // sem link ativo (revogado), a entrega segue pendente mas sem requisição ativa
    expect((await request(srv).post(`/epi-signatures/requests/${link.body.id}/revoke`).set(auth())).status).toBe(201);
    const r2 = await pending(`?employee_id=${emp}`);
    expect(r2.body.items.every((i: any) => i.signature_status === 'pendente' && i.active_request_status === null && i.active_request_id === null)).toBe(true);
  });

  it('inclui recusadas; filtra por employee_id e pagina; assinadas/presenciais/estornadas/legado não aparecem', async () => {
    const emp = await newEmployee('Func Pendente Filtros');
    const other = await newEmployee('Func Pendente Outro');
    const p1 = await deliver(emp, 1), p2 = await deliver(emp, 1), p3 = await deliver(emp, 1);
    const recusada = await deliver(emp, 1);
    await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'recusada' WHERE id = $1`, [recusada]);
    const presencial = await deliver(emp, 1);
    expect((await inPerson({ delivery_ids: [presencial], witness_name: 'Testemunha Teste', reason: 'Funcionário sem celular' })).status).toBeLessThan(300);
    const estornadaMov = await request(srv).post(`/epis/${epiId}/movements`).set(auth()).send({ type: 'entrega', quantity: 1, employee_id: emp, idempotency_key: key() });
    expect(estornadaMov.status).toBe(201);
    expect((await request(srv).post(`/epis/movements/${estornadaMov.body.id}/reversal`).set(auth()).send({ reason: 'Erro de lancamento', idempotency_key: key() })).status).toBe(201);
    // legado: rota antiga em EPI sem livro (signature_status 'legado', sem quantity)
    const epiLegado = (await request(srv).post('/epis').set(auth()).send({ epi_catalog_item_id: (await request(srv).get('/epi-catalog-items').set(auth())).body[1].id, ca_number: 'CA-PEND-LEG' })).body.id;
    expect((await request(srv).post(`/epis/${epiLegado}/deliveries`).set(auth()).send({ employee_id: emp, delivered_at: '2026-10-18', signed_by_name: 'Resp' })).status).toBe(201);
    const outroPend = await deliver(other, 1);
    const assinada = await deliver(other, 1);
    await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'assinada', signed_at = now() WHERE id = $1`, [assinada]);

    const all = await pending(`?employee_id=${emp}&page_size=100`);
    expect(all.status).toBe(200);
    const ids = all.body.items.map((i: any) => i.delivery_id).sort();
    expect(ids).toEqual([p1, p2, p3, recusada].sort());
    expect(all.body.total).toBe(4);
    expect(all.body.items.find((i: any) => i.delivery_id === recusada).signature_status).toBe('recusada');
    // paginação
    const pg1 = await pending(`?employee_id=${emp}&page=1&page_size=3`);
    const pg2 = await pending(`?employee_id=${emp}&page=2&page_size=3`);
    expect(pg1.body.items).toHaveLength(3);
    expect(pg2.body.items).toHaveLength(1);
    expect(pg1.body).toMatchObject({ total: 4, page: 1, page_size: 3 });
    expect([...pg1.body.items, ...pg2.body.items].map((i: any) => i.delivery_id).sort()).toEqual(ids);
    // filtro por funcionário: só o outro
    const o = await pending(`?employee_id=${other}`);
    expect(o.body.items.map((i: any) => i.delivery_id)).toEqual([outroPend]);
    // sem filtro de funcionário, ambos aparecem e nenhuma das excluídas
    const geral = await pending('?page_size=100');
    const gids = geral.body.items.map((i: any) => i.delivery_id);
    for (const x of [p1, outroPend]) expect(gids).toContain(x);
    for (const x of [presencial, assinada, estornadaMov.body.delivery_id]) expect(gids).not.toContain(x);
  });

  it('isolamento: empresa B não vê; técnico vinculado precisa de tenant_id; não vinculado recebe 404 sem vazar', async () => {
    const emp = await newEmployee('Func Pendente Isolamento');
    const dId = await deliver(emp, 1);
    // empresa B: lista só as suas (nenhuma de A) e não filtra por A
    const b = await pending('', tokenB);
    expect(b.status).toBe(200);
    expect(b.body.items.map((i: any) => i.delivery_id)).not.toContain(dId);
    expect((await pending(`?tenant_id=${tenantId}`, tokenB)).status).toBe(400);
    expect((await pending(`?tenant_id=${tenantIdB}`, tokenB)).status).toBe(200);
    // empresa A com o próprio tenant_id
    expect((await pending(`?tenant_id=${tenantId}`)).body.items.map((i: any) => i.delivery_id)).toContain(dId);
    // técnico/parceiro vinculados: tenant_id obrigatório
    for (const tok of [tokenTecLinked, tokenPartner]) {
      expect((await pending('', tok)).status).toBe(400);
      const ok = await pending(`?tenant_id=${tenantId}`, tok);
      expect(ok.status).toBe(200);
      expect(ok.body.items.map((i: any) => i.delivery_id)).toContain(dId);
      // empresa B não é vinculada: 404 uniforme
      const alheia = await pending(`?tenant_id=${tenantIdB}`, tok);
      expect(alheia.status).toBe(404);
    }
    // não vinculados: 400 sem tenant_id, 404 com a empresa (sem oráculo)
    for (const tok of [tokenTecFree, tokenPartnerFree]) {
      expect((await pending('', tok)).status).toBe(400);
      const livre = await pending(`?tenant_id=${tenantId}`, tok);
      expect(livre.status).toBe(404);
      expect(JSON.stringify(livre.body)).not.toContain(dId);
    }
    // admin: tenant_id obrigatório; vê qualquer empresa; inexistente -> 404
    expect((await pending('', tokenAdmin)).status).toBe(400);
    expect((await pending(`?tenant_id=${tenantId}`, tokenAdmin)).body.items.map((i: any) => i.delivery_id)).toContain(dId);
    expect((await pending('?tenant_id=00000000-0000-4000-8000-000000000000', tokenAdmin)).status).toBe(404);
    // funcionário de A pedido na empresa B (admin): vazio, nunca A
    const cruzado = await pending(`?tenant_id=${tenantIdB}&employee_id=${emp}`, tokenAdmin);
    expect(cruzado.status).toBe(200);
    expect(cruzado.body.items).toEqual([]);
    expect(cruzado.body.total).toBe(0);
    // sem token
    expect((await request(srv).get('/epi-signatures/pending')).status).toBe(401);
  });

  it('entrada inválida -> 400 (nunca 500)', async () => {
    for (const qs of ['tenant_id=xyz', 'employee_id=123', 'page=0', 'page=abc', 'page=1.5', 'page_size=0', 'page_size=101', 'page=1&page=2', 'employee_id=a&employee_id=b', 'foo=1', `tenant_id=${tenantIdB}`]) {
      const r = await pending(`?${qs}`);
      expect([qs, r.status]).toEqual([qs, 400]);
    }
  });
});
