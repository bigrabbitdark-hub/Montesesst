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

describe('Assinatura eletrônica de EPI: criação, listagem, revogação e presencial (e2e)', () => {
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
  const key = () => `teste-assinatura-${Date.now()}-${seq++}-${randomUUID().slice(0, 6)}`;
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

    const a = await db.createTenantWithUser('Empresa Assinatura Criacao');
    const b = await db.createTenantWithUser('Empresa Assinatura Criacao B');
    tenantId = a.tenantId;
    tenantIdB = b.tenantId;
    userA = a.userId;
    appDb = new Client({ connectionString: process.env.DATABASE_URL });
    await appDb.connect();
    empB = b.employeeId;
    token = await login(a);
    tokenB = await login(b);

    const tecV = await db.createUserWithRole('tecnico', 'Tecnico Vinculado Assinatura');
    const tecF = await db.createUserWithRole('tecnico', 'Tecnico Livre Assinatura');
    const parc = await db.createUserWithRole('parceiro', 'Parceiro Vinculado Assinatura');
    const parcF = await db.createUserWithRole('parceiro', 'Parceiro Livre Assinatura');
    const adm = await db.createUserWithRole('admin', 'Admin Assinatura');
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
    epiId = (await request(srv).post('/epis').set(auth()).send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-SIG-1', manufacturer: 'Fab', model: 'M1' })).body.id;
    expect((await request(srv).post(`/epis/${epiId}/movements`).set(auth()).send({ type: 'abertura', quantity: 5000, idempotency_key: key() })).status).toBe(201);
    epiIdB = (await request(srv).post('/epis').set(bearer(tokenB)).send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-SIG-B', manufacturer: 'Fab', model: 'M1' })).body.id;
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

  it('cria requisição para as entregas pendentes do funcionário e devolve link, QR e código só uma vez', async () => {
    const emp = await newEmployee('Func Criacao Basica');
    const d1 = await deliver(emp, 1), d2 = await deliver(emp, 2);
    const r = await create(emp);
    expect(r.status).toBe(201);
    expect(r.headers['cache-control']).toMatch(/no-store/);
    expect(r.body.url).toMatch(/\/assinar#token=[A-Za-z0-9_-]{43}$/);
    expect(r.body.url.startsWith('https://app.invalid/assinar#token=')).toBe(true);
    expect(r.body.qr_payload).toBe(r.body.url);
    expect(r.body.code).toMatch(/^\d{6}$/);
    expect(new Date(r.body.expires_at).getTime() - Date.now()).toBeGreaterThan(23 * 3600 * 1000);
    expect(r.body.delivery_ids.sort()).toEqual([d1, d2].sort());
    const row = (await sql.query('SELECT token_hash, pin_hash, status, tenant_id, term_version FROM epi_signature_requests WHERE id = $1', [r.body.id])).rows[0];
    const tok = tokenOf(r.body.url);
    expect(row.token_hash).toBe(hashToken(tok));
    expect(row.pin_hash).toBe(hashPin(tok, r.body.code));
    expect(JSON.stringify(row)).not.toContain(tok);
    expect(row.status).toBe('ativa');
    expect(row.tenant_id).toBe(tenantId);
    const list = await request(srv).get(`/epi-signatures/requests?employee_id=${emp}`).set(auth());
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(r.body.id);
    expect(list.body[0].status).toBe('ativa');
    expect(list.body[0].delivery_ids.sort()).toEqual([d1, d2].sort());
    const flat = JSON.stringify(list.body);
    expect(flat).not.toContain(tok);
    expect(flat).not.toContain(r.body.code.length ? `"${r.body.code}"` : 'x');
    expect(flat).not.toMatch(/token|pin_hash|code/);
  });

  it('PUBLIC_APP_URL define a base do link (sem barra final) e o token fica no fragmento', async () => {
    process.env.PUBLIC_APP_URL = 'https://app.exemplo.test/';
    try {
      const emp = await newEmployee('Func Url Base');
      await deliver(emp, 1);
      const r = await create(emp);
      expect(r.status).toBe(201);
      expect(r.body.url).toMatch(/^https:\/\/app\.exemplo\.test\/assinar#token=[A-Za-z0-9_-]{43}$/);
    } finally {
      delete process.env.PUBLIC_APP_URL;
    }
  });

  it('delivery_ids restringe o conjunto: só as entregas pedidas entram no link', async () => {
    const emp = await newEmployee('Func Subconjunto');
    const d1 = await deliver(emp, 1), d2 = await deliver(emp, 1);
    const r = await create(emp, { delivery_ids: [d1] });
    expect(r.status).toBe(201);
    expect(r.body.delivery_ids).toEqual([d1]);
    const items = (await sql.query('SELECT delivery_id FROM epi_signature_request_items WHERE request_id = $1', [r.body.id])).rows;
    expect(items.map((i) => i.delivery_id)).toEqual([d1]);
    expect((await delivery(d2)).signature_status).toBe('pendente');
  });

  it('novo link para as mesmas entregas revoga o anterior; as entregas pertencem a uma única requisição ativa', async () => {
    const emp = await newEmployee('Func Novo Link');
    const d1 = await deliver(emp, 1), d2 = await deliver(emp, 1);
    const first = await create(emp);
    const second = await create(emp);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await statusOf(first.body.id)).toBe('revogada');
    expect(await statusOf(second.body.id)).toBe('ativa');
    const active = await sql.query(
      `SELECT i.delivery_id, count(*)::int AS n FROM epi_signature_request_items i JOIN epi_signature_requests q ON q.id = i.request_id
        WHERE q.status = 'ativa' AND i.delivery_id = ANY($1::uuid[]) GROUP BY i.delivery_id`, [[d1, d2]]);
    expect(active.rows).toHaveLength(2);
    for (const row of active.rows) expect(row.n).toBe(1);
    // o link revogado deixa de ser utilizável
    const peek = await sql.query('SELECT * FROM epi_sig_peek($1)', [hashToken(tokenOf(first.body.url))]);
    expect(peek.rows[0].usable).toBe(false);
  });

  it('entrega recusada volta a pendente e é vinculada ao novo link na mesma transação', async () => {
    const emp = await newEmployee('Func Recusada');
    const d1 = await deliver(emp, 1), d2 = await deliver(emp, 1);
    const first = await create(emp);
    // recusa feita pela função pública (a requisição vira 'recusada' e as entregas, 'recusada')
    const tok = tokenOf(first.body.url);
    const ref = await sql.query('SELECT * FROM epi_sig_refuse($1, $2, $3)', [hashToken(tok), hashPin(tok, first.body.code), 'Não recebi']);
    expect(ref.rows[0].result).toBe('ok');
    expect((await delivery(d1)).signature_status).toBe('recusada');
    expect((await delivery(d2)).signature_status).toBe('recusada');
    const second = await create(emp);
    expect(second.status).toBe(201);
    expect(second.body.delivery_ids.sort()).toEqual([d1, d2].sort());
    expect((await delivery(d1)).signature_status).toBe('pendente');
    expect((await delivery(d2)).signature_status).toBe('pendente');
    const items = (await sql.query('SELECT delivery_id FROM epi_signature_request_items WHERE request_id = $1', [second.body.id])).rows;
    expect(items).toHaveLength(2);
    expect(await statusOf(second.body.id)).toBe('ativa');
    expect(await statusOf(first.body.id)).toBe('recusada'); // encerrada: não é reaberta nem alterada
  });

  it('mesma idempotency_key -> 409 (o código não é recuperável); chave igual em outra empresa é independente', async () => {
    const emp = await newEmployee('Func Idempotencia');
    await deliver(emp, 1);
    const k = key();
    const a = await create(emp, { idempotency_key: k });
    expect(a.status).toBe(201);
    const again = await create(emp, { idempotency_key: k });
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).not.toContain(a.body.code);
    expect(await statusOf(a.body.id)).toBe('ativa'); // o 409 não revoga o link já emitido
    const other = await deliver(empB, 1, tokenB, epiIdB);
    const b = await create(empB, { idempotency_key: k }, tokenB);
    expect(b.status).toBe(201);
    expect(b.body.delivery_ids).toEqual([other]);
  });

  it('sem entregas pendentes -> 409; entrega de outro funcionário ou de outra empresa -> 404; entrega estornada/assinada -> 409', async () => {
    const empNone = await newEmployee('Func Sem Entregas');
    const none = await create(empNone);
    expect(none.status).toBe(409);
    expect((await sql.query('SELECT 1 FROM epi_signature_requests WHERE employee_id = $1', [empNone])).rowCount).toBe(0);

    const emp = await newEmployee('Func Entregas Mistas');
    const mine = await deliver(emp, 1);
    const empOther = await newEmployee('Func Outro Mesmo Tenant');
    const theirs = await deliver(empOther, 1);
    const foreign = await deliver(empB, 1, tokenB, epiIdB);
    expect((await create(emp, { delivery_ids: [mine, theirs] })).status).toBe(404);
    expect((await create(emp, { delivery_ids: [mine, foreign] })).status).toBe(404);
    expect((await create(emp, { delivery_ids: [randomUUID()] })).status).toBe(404);
    expect((await sql.query('SELECT 1 FROM epi_signature_requests WHERE employee_id = $1', [emp])).rowCount).toBe(0);

    const signed = await deliver(emp, 1);
    const reversed = await deliver(emp, 1);
    await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'assinada', signed_at = now(), signed_by_name = 'X' WHERE id = $1`, [signed]);
    await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'estornada' WHERE id = $1`, [reversed]);
    expect((await create(emp, { delivery_ids: [signed] })).status).toBe(409);
    expect((await create(emp, { delivery_ids: [reversed] })).status).toBe(409);
    expect((await create(emp, { delivery_ids: [mine, signed] })).status).toBe(409);
    expect((await sql.query('SELECT 1 FROM epi_signature_requests WHERE employee_id = $1', [emp])).rowCount).toBe(0);
    // sem filtro: só a pendente entra
    const ok = await create(emp);
    expect(ok.status).toBe(201);
    expect(ok.body.delivery_ids).toEqual([mine]);
  });

  it('funcionário inexistente ou de outra empresa -> 404', async () => {
    expect((await create(randomUUID())).status).toBe(404);
    expect((await create(empB)).status).toBe(404);
  });

  it('termo em rascunho e variável desligada -> 409 sem criar requisição', async () => {
    const emp = await newEmployee('Func Termo Rascunho');
    const d = await deliver(emp, 1);
    process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'false';
    (EPI_TERM as any).draft = true; // simula um termo ainda em rascunho (o vigente é aprovado)
    try {
      const r = await create(emp);
      expect(r.status).toBe(409);
      expect((await sql.query('SELECT 1 FROM epi_signature_requests WHERE employee_id = $1', [emp])).rowCount).toBe(0);
      expect((await delivery(d)).signature_status).toBe('pendente');
    } finally {
      (EPI_TERM as any).draft = false;
      process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'true';
    }
  });

  it('revoke: a requisição vira revogada e o link deixa de abrir (peek não utilizável)', async () => {
    const emp = await newEmployee('Func Revoga');
    const d = await deliver(emp, 1);
    const r = await create(emp);
    const tok = tokenOf(r.body.url);
    expect((await sql.query('SELECT * FROM epi_sig_peek($1)', [hashToken(tok)])).rows[0].usable).toBe(true);
    const rv = await request(srv).post(`/epi-signatures/requests/${r.body.id}/revoke`).set(auth());
    expect(rv.status).toBe(201);
    expect(rv.body.status).toBe('revogada');
    expect(await statusOf(r.body.id)).toBe('revogada');
    expect((await sql.query('SELECT * FROM epi_sig_peek($1)', [hashToken(tok)])).rows[0].usable).toBe(false);
    expect((await delivery(d)).signature_status).toBe('pendente'); // a entrega segue aguardando assinatura
    // já revogada -> 409; inexistente -> 404; id inválido -> 400; outra empresa -> 404; sem token -> 401
    expect((await request(srv).post(`/epi-signatures/requests/${r.body.id}/revoke`).set(auth())).status).toBe(409);
    expect((await request(srv).post(`/epi-signatures/requests/${randomUUID()}/revoke`).set(auth())).status).toBe(404);
    expect((await request(srv).post('/epi-signatures/requests/abc/revoke').set(auth())).status).toBe(400);
    const r2 = await create(emp);
    expect((await request(srv).post(`/epi-signatures/requests/${r2.body.id}/revoke`).set(bearer(tokenB))).status).toBe(404);
    expect((await request(srv).post(`/epi-signatures/requests/${r2.body.id}/revoke`)).status).toBe(401);
    expect(await statusOf(r2.body.id)).toBe('ativa');
  });

  it('presencial: marca entregas pendentes como presencial com testemunha e motivo; sem testemunha/motivo -> 400; entrega já assinada -> 409', async () => {
    const emp = await newEmployee('Func Presencial');
    const d1 = await deliver(emp, 1), d2 = await deliver(emp, 1), d3 = await deliver(emp, 1);
    const link = await create(emp, { delivery_ids: [d1] });
    expect(await statusOf(link.body.id)).toBe('ativa');
    const body = { delivery_ids: [d1, d2], witness_name: 'Maria Testemunha', reason: 'Funcionário sem celular' };
    expect((await inPerson({ ...body, witness_name: undefined })).status).toBe(400);
    expect((await inPerson({ ...body, reason: undefined })).status).toBe(400);
    expect((await delivery(d1)).signature_status).toBe('pendente');
    const r = await inPerson(body);
    expect(r.status).toBe(201);
    expect(r.body.deliveries).toHaveLength(2);
    expect(r.body.in_person_id).toMatch(/^[0-9a-f-]{36}$/);
    for (const id of [d1, d2]) {
      const row = await delivery(id);
      expect(row.signature_status).toBe('presencial');
      expect(row.signed_at).not.toBeNull();
      expect(row.signed_by_name).toBe('Func Presencial'); // nome do funcionário, como no fluxo eletrônico
    }
    // registro imutável com autor, testemunha, motivo e data
    const reg = (await sql.query('SELECT * FROM epi_in_person_signatures WHERE id = $1', [r.body.in_person_id])).rows[0];
    expect(reg).toMatchObject({ tenant_id: tenantId, employee_id: emp, witness_name: 'Maria Testemunha', reason: 'Funcionário sem celular', registered_by_user_id: userA, term_version: EPI_TERM.version });
    expect(reg.registered_at).toBeInstanceOf(Date);
    const regItems = (await sql.query('SELECT delivery_id FROM epi_in_person_signature_items WHERE in_person_id = $1', [r.body.in_person_id])).rows;
    expect(regItems.map((x) => x.delivery_id).sort()).toEqual([d1, d2].sort());
    // imutável (UPDATE/DELETE direto, como a aplicação, com o contexto da empresa A: as linhas são visíveis, o trigger recusa)
    const asTenant = async <T>(tid: string, fn: () => Promise<T>) => {
      await appDb.query('BEGIN');
      try {
        await appDb.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.role', 'empresa', true)`, [tid]);
        return await fn();
      } finally {
        await appDb.query('ROLLBACK');
      }
    };
    const denied = (q: string) => asTenant(tenantId, async () => {
      await appDb.query('SAVEPOINT s');
      try { await appDb.query(q); return 'ok'; } catch (e: any) { return e.code as string; }
    });
    expect(await denied(`UPDATE epi_in_person_signatures SET reason = 'adulterado'`)).toBe('42501');
    expect(await denied('DELETE FROM epi_in_person_signatures')).toBe('42501');
    expect(await denied('DELETE FROM epi_in_person_signature_items')).toBe('42501');
    expect(await denied('UPDATE epi_in_person_signature_items SET delivery_id = delivery_id')).toBe('42501');
    await expect(sql.query('DELETE FROM epi_in_person_signatures WHERE id = $1', [r.body.in_person_id])).rejects.toMatchObject({ code: '42501' });
    // a empresa A enxerga; a empresa B não (RLS)
    const visible = (tid: string) => asTenant(tid, async () => ({
      p: (await appDb.query('SELECT 1 FROM epi_in_person_signatures WHERE id = $1', [r.body.in_person_id])).rowCount,
      i: (await appDb.query('SELECT 1 FROM epi_in_person_signature_items WHERE in_person_id = $1', [r.body.in_person_id])).rowCount,
    }));
    expect(await visible(tenantId)).toEqual({ p: 1, i: 2 });
    expect(await visible(tenantIdB)).toEqual({ p: 0, i: 0 });
    // testemunha/motivo só com espaços -> 400; aparado abaixo do mínimo -> 400
    const dx = await deliver(emp, 1);
    expect((await inPerson({ ...body, delivery_ids: [dx], witness_name: '        ' })).status).toBe(400);
    expect((await inPerson({ ...body, delivery_ids: [dx], reason: '          ' })).status).toBe(400);
    expect((await inPerson({ ...body, delivery_ids: [dx], witness_name: '  ab  ' })).status).toBe(400);
    expect((await inPerson({ ...body, delivery_ids: [dx], reason: ' abcd  ' })).status).toBe(400);
    expect((await delivery(dx)).signature_status).toBe('pendente');
    const trimmed = await inPerson({ ...body, delivery_ids: [dx], witness_name: '  Joao Silva  ', reason: '  Sem acesso ao celular  ' });
    expect(trimmed.status).toBe(201);
    expect((await sql.query('SELECT witness_name, reason FROM epi_in_person_signatures WHERE id = $1', [trimmed.body.in_person_id])).rows[0])
      .toEqual({ witness_name: 'Joao Silva', reason: 'Sem acesso ao celular' });
    // entregas já presenciais não podem ser registradas de novo e nada novo é gravado
    const before = (await sql.query('SELECT count(*)::int AS n FROM epi_in_person_signatures WHERE employee_id = $1', [emp])).rows[0].n;
    expect((await inPerson({ ...body, delivery_ids: [d1, d2] })).status).toBe(409);
    expect((await sql.query('SELECT count(*)::int AS n FROM epi_in_person_signatures WHERE employee_id = $1', [emp])).rows[0].n).toBe(before);
    expect((await delivery(d3)).signature_status).toBe('pendente');
    expect(await statusOf(link.body.id)).toBe('revogada'); // o link das entregas presenciais é revogado
    // já presencial -> 409; entrega assinada -> 409; de outro funcionário/empresa -> 404
    expect((await inPerson({ ...body, delivery_ids: [d1] })).status).toBe(409);
    expect((await inPerson({ ...body, delivery_ids: [d3, d1] })).status).toBe(409);
    expect((await sql.query('SELECT 1 FROM epi_in_person_signature_items WHERE delivery_id = $1', [d3])).rowCount).toBe(0);
    expect((await delivery(d3)).signature_status).toBe('pendente'); // tudo ou nada
    expect((await inPerson({ ...body, delivery_ids: [randomUUID()] })).status).toBe(404);
    const foreign = await deliver(empB, 1, tokenB, epiIdB);
    expect((await inPerson({ ...body, delivery_ids: [foreign] })).status).toBe(404);
    expect((await delivery(foreign)).signature_status).toBe('pendente');
    // recusada também pode ser registrada presencialmente
    await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'recusada' WHERE id = $1`, [d3]);
    expect((await inPerson({ ...body, delivery_ids: [d3] })).status).toBe(201);
    expect((await delivery(d3)).signature_status).toBe('presencial');
    // assinada eletronicamente -> 409
    const d4 = await deliver(emp, 1);
    await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'assinada', signed_at = now(), signed_by_name = 'X' WHERE id = $1`, [d4]);
    expect((await inPerson({ ...body, delivery_ids: [d4] })).status).toBe(409);
    expect((await delivery(d4)).signature_status).toBe('assinada');
    // entregas de funcionários diferentes na mesma chamada -> 400 e nada é alterado
    const empOther = await newEmployee('Func Presencial Outro');
    const o1 = await deliver(empOther, 1), o2 = await deliver(emp, 1);
    expect((await inPerson({ ...body, delivery_ids: [o1, o2] })).status).toBe(400);
    expect((await delivery(o1)).signature_status).toBe('pendente');
    expect((await delivery(o2)).signature_status).toBe('pendente');
  });

  it('presencial depende do termo aprovado: variável desligada -> 409 e nada gravado; ligada -> term_version gravado', async () => {
    const emp = await newEmployee('Func Presencial Termo');
    const d = await deliver(emp, 1);
    const link = await create(emp);
    const body = { delivery_ids: [d], witness_name: 'Testemunha Termo', reason: 'Funcionário sem celular' };
    process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'false';
    (EPI_TERM as any).draft = true; // simula um termo ainda em rascunho (o vigente é aprovado)
    try {
      const off = await inPerson(body);
      expect(off.status).toBe(409);
      expect((await delivery(d)).signature_status).toBe('pendente');
      expect((await sql.query('SELECT 1 FROM epi_in_person_signatures WHERE employee_id = $1', [emp])).rowCount).toBe(0);
      expect(await statusOf(link.body.id)).toBe('ativa'); // o link também não foi revogado
    } finally {
      (EPI_TERM as any).draft = false;
      process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'true';
    }
    const on = await inPerson(body);
    expect(on.status).toBe(201);
    expect((await sql.query('SELECT term_version FROM epi_in_person_signatures WHERE id = $1', [on.body.in_person_id])).rows[0].term_version).toBe(EPI_TERM.version);
  });

  it('presencial mede testemunha e motivo por caracteres (code points): emoji não vira 500', async () => {
    const emp = await newEmployee('Func Presencial Emoji');
    const d = await deliver(emp, 1);
    const base = { delivery_ids: [d], witness_name: 'Testemunha Emoji', reason: 'Funcionário sem celular' };
    // ' 😀😀 ' aparado tem 2 code points (4 unidades UTF-16): abaixo do mínimo de 3 -> 400, nunca 500
    expect((await inPerson({ ...base, witness_name: ' \u{1F600}\u{1F600} ' })).status).toBe(400);
    expect((await inPerson({ ...base, reason: ' \u{1F600}\u{1F600}\u{1F600}\u{1F600} ' })).status).toBe(400); // 4 code points < 5
    expect((await delivery(d)).signature_status).toBe('pendente');
    // 3 e 5 code points são aceitos (e gravados aparados)
    const ok = await inPerson({ ...base, witness_name: ' \u{1F600}\u{1F600}\u{1F600} ', reason: ' \u{1F600}\u{1F600}\u{1F600}\u{1F600}\u{1F600} ' });
    expect(ok.status).toBe(201);
  });

  it('permissões e isolamento: empresa B 404; técnico/parceiro vinculados 201; não vinculados 404; admin 201; sem token 401', async () => {
    const emp = await newEmployee('Func Permissoes');
    await deliver(emp, 1);
    expect((await create(emp, {}, tokenB)).status).toBe(404);
    expect((await create(emp, {}, tokenTecFree)).status).toBe(404);
    expect((await create(emp, {}, tokenPartnerFree)).status).toBe(404);
    expect((await request(srv).post('/epi-signatures/requests').send({ employee_id: emp, idempotency_key: key() })).status).toBe(401);
    expect((await sql.query('SELECT 1 FROM epi_signature_requests WHERE employee_id = $1', [emp])).rowCount).toBe(0);
    for (const [nome, t] of [['tecnico', tokenTecLinked], ['parceiro', tokenPartner], ['admin', tokenAdmin]] as const) {
      const r = await create(emp, {}, t);
      expect([nome, r.status]).toEqual([nome, 201]);
      const row = (await sql.query('SELECT tenant_id FROM epi_signature_requests WHERE id = $1', [r.body.id])).rows[0];
      expect(row.tenant_id).toBe(tenantId); // o tenant é o da linha do funcionário, mesmo para o admin
      const l = await request(srv).get(`/epi-signatures/requests?employee_id=${emp}`).set(bearer(t));
      expect([nome, l.status]).toEqual([nome, 200]);
    }
    // listagem e presencial: não vinculados e empresa B não enxergam nem agem
    expect((await request(srv).get(`/epi-signatures/requests?employee_id=${emp}`).set(bearer(tokenB))).status).toBe(404);
    expect((await request(srv).get(`/epi-signatures/requests?employee_id=${emp}`).set(bearer(tokenTecFree))).status).toBe(404);
    expect((await request(srv).get(`/epi-signatures/requests?employee_id=${emp}`)).status).toBe(401);
    const pend = (await sql.query(`SELECT id FROM employee_epi_deliveries WHERE employee_id = $1`, [emp])).rows[0].id;
    const ip = { delivery_ids: [pend], witness_name: 'Testemunha Teste', reason: 'Sem celular' };
    expect((await inPerson(ip, tokenB)).status).toBe(404);
    expect((await inPerson(ip, tokenTecFree)).status).toBe(404);
    expect((await inPerson(ip, tokenPartnerFree)).status).toBe(404);
    expect((await request(srv).post('/epi-signatures/in-person').send(ip)).status).toBe(401);
    expect((await delivery(pend)).signature_status).toBe('pendente');
    const ok = await inPerson(ip, tokenTecLinked);
    expect(ok.status).toBe(201);
  });

  it('entrada inválida -> 400: delivery_ids não UUID/duplicados/>50, idempotency_key curta/NUL, corpo extra, employee_id inválido', async () => {
    const emp = await newEmployee('Func Entrada Invalida');
    const d = await deliver(emp, 1);
    const bad = async (body: Record<string, unknown>) => (await request(srv).post('/epi-signatures/requests').set(auth()).send(body)).status;
    const k = key();
    expect(await bad({ employee_id: 'abc', idempotency_key: k })).toBe(400);
    expect(await bad({ idempotency_key: k })).toBe(400);
    expect(await bad({ employee_id: emp })).toBe(400);
    expect(await bad({ employee_id: emp, idempotency_key: 'curta' })).toBe(400);
    expect(await bad({ employee_id: emp, idempotency_key: 'x'.repeat(101) })).toBe(400);
    expect(await bad({ employee_id: emp, idempotency_key: 'chave-com-nul-\u0000-no-meio' })).toBe(400);
    expect(await bad({ employee_id: emp, idempotency_key: k, delivery_ids: ['abc'] })).toBe(400);
    expect(await bad({ employee_id: emp, idempotency_key: k, delivery_ids: [d, d] })).toBe(400);
    expect(await bad({ employee_id: emp, idempotency_key: k, delivery_ids: Array.from({ length: 51 }, () => randomUUID()) })).toBe(400);
    expect(await bad({ employee_id: emp, idempotency_key: k, delivery_ids: 'x' })).toBe(400);
    expect(await bad({ employee_id: emp, idempotency_key: k, tenant_id: tenantId })).toBe(400);
    expect(await bad({ employee_id: emp, idempotency_key: k, expires_at: '2030-01-01' })).toBe(400);
    expect((await request(srv).get('/epi-signatures/requests?employee_id=abc').set(auth())).status).toBe(400);
    expect((await request(srv).get('/epi-signatures/requests').set(auth())).status).toBe(400);
    expect((await request(srv).get(`/epi-signatures/requests?employee_id=${emp}&x=1`).set(auth())).status).toBe(400);
    expect((await sql.query('SELECT 1 FROM epi_signature_requests WHERE employee_id = $1', [emp])).rowCount).toBe(0);
    // presencial
    const ip = { delivery_ids: [d], witness_name: 'Testemunha Teste', reason: 'Sem celular' };
    const badIp = async (body: Record<string, unknown>) => (await inPerson(body)).status;
    expect(await badIp({ ...ip, delivery_ids: [] })).toBe(400);
    expect(await badIp({ ...ip, delivery_ids: ['abc'] })).toBe(400);
    expect(await badIp({ ...ip, delivery_ids: [d, d] })).toBe(400);
    expect(await badIp({ ...ip, delivery_ids: Array.from({ length: 51 }, () => randomUUID()) })).toBe(400);
    expect(await badIp({ ...ip, witness_name: 'ab' })).toBe(400);
    expect(await badIp({ ...ip, witness_name: 'x'.repeat(121) })).toBe(400);
    expect(await badIp({ ...ip, witness_name: 'Nome\u0000Nulo' })).toBe(400);
    expect(await badIp({ ...ip, reason: 'curt' })).toBe(400);
    expect(await badIp({ ...ip, reason: 'x'.repeat(301) })).toBe(400);
    expect(await badIp({ ...ip, reason: 'Motivo\u0000nulo' })).toBe(400);
    expect(await badIp({ ...ip, tenant_id: tenantId })).toBe(400);
    expect((await delivery(d)).signature_status).toBe('pendente');
  });

  it('auditoria: a criação passa pelo AuditInterceptor e o corpo (código) não é registrado', async () => {
    const emp = await newEmployee('Func Auditoria');
    await deliver(emp, 1);
    const r = await create(emp);
    expect(r.status).toBe(201);
    const tok = tokenOf(r.body.url);
    await new Promise((res) => setTimeout(res, 300)); // o registro é assíncrono (fire-and-forget)
    const rows = (await sql.query(
      `SELECT * FROM audit_log WHERE resource_type = 'epi-signatures' AND resource_id = $1`, [r.body.id])).rows;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].method).toBe('POST');
    expect(rows[0].status_code).toBe(201);
    const all = JSON.stringify((await sql.query(`SELECT * FROM audit_log WHERE actor_tenant_id = $1`, [tenantId])).rows);
    expect(all).not.toContain(tok);
    expect(all).not.toContain(`"${r.body.code}"`);
    expect(all).not.toContain(`"detail":"${r.body.code}`);
  });

  it('criações concorrentes para as MESMAS entregas: exatamente 1 requisição ativa, sem 500 e sem deadlock', async () => {
    const emp = await newEmployee('Func Concorrencia');
    const d1 = await deliver(emp, 1), d2 = await deliver(emp, 1);
    const rs = await Promise.all([create(emp), create(emp), create(emp)]);
    for (const r of rs) expect([201, 409, 503]).toContain(r.status); // nunca 500 (40P01 seria 500)
    const ok = rs.filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const all = (await sql.query('SELECT id, status FROM epi_signature_requests WHERE employee_id = $1', [emp])).rows;
    expect(all).toHaveLength(ok.length);
    expect(all.filter((q) => q.status === 'ativa')).toHaveLength(1);
    for (const q of all.filter((x) => x.status !== 'ativa')) expect(q.status).toBe('revogada');
    const active = await sql.query(
      `SELECT i.delivery_id, count(*)::int AS n FROM epi_signature_request_items i JOIN epi_signature_requests q ON q.id = i.request_id
        WHERE q.status = 'ativa' AND i.delivery_id = ANY($1::uuid[]) GROUP BY i.delivery_id`, [[d1, d2]]);
    expect(active.rows).toHaveLength(2);
    for (const row of active.rows) expect(row.n).toBe(1);
  });
});
