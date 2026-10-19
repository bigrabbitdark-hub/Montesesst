import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb } from './db-test-helper';

// R2 sempre simulado em memória.
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

// beforeAll com bcrypt/tenants estoura os 5 s padrão sob carga do host.
jest.setTimeout(120_000);

describe('Permissões e isolamento da ficha de EPI emitida (e2e)', () => {
  let app: INestApplication;
  let srv: any;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tokenTecLinked: string;
  let tokenTecFree: string;
  let tokenPartner: string;
  let tokenPartnerFree: string;
  let tokenAdmin: string;
  let empA: string;
  let docA: string;
  let seq = 0;
  const key = () => `perm-ficha-${Date.now()}-${seq++}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (u: { email: string; password: string }) =>
    (await request(srv).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(R2Service).useValue(fakeR2).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    srv = app.getHttpServer();
    db = new TestDb();
    await db.connect();
    const a = await db.createTenantWithUser('Empresa Ficha Perm A');
    const b = await db.createTenantWithUser('Empresa Ficha Perm B');
    empA = a.employeeId;
    const tecV = await db.createUserWithRole('tecnico', 'Tecnico Vinculado Ficha Perm');
    const tecF = await db.createUserWithRole('tecnico', 'Tecnico Livre Ficha Perm');
    const parc = await db.createUserWithRole('parceiro', 'Parceiro Vinculado Ficha Perm');
    const parcF = await db.createUserWithRole('parceiro', 'Parceiro Livre Ficha Perm');
    const adm = await db.createUserWithRole('admin', 'Admin Ficha Perm');
    const c = (db as any).client;
    const techId = (await c.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecV.userId])).rows[0].id;
    await c.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [a.tenantId, techId]);
    await c.query('INSERT INTO technicians (user_id) VALUES ($1)', [tecF.userId]);
    const partId = (await c.query(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`, [parc.userId])).rows[0].id;
    await c.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [a.tenantId, partId]);
    await c.query(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC')`, [parcF.userId]);
    tokenPartnerFree = await login(parcF);
    tokenA = await login(a);
    tokenB = await login(b);
    tokenTecLinked = await login(tecV);
    tokenTecFree = await login(tecF);
    tokenPartner = await login(parc);
    tokenAdmin = await login(adm);
    const d = await request(srv).post(`/epi-fichas/employees/${empA}/issue`).set(bearer(tokenA)).send({ idempotency_key: key() });
    expect(d.status).toBe(201);
    docA = d.body.id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('empresa B recebe 404 em emitir, listar, baixar e verificar documento da empresa A', async () => {
    const h = bearer(tokenB);
    expect((await request(srv).post(`/epi-fichas/employees/${empA}/issue`).set(h).send({ idempotency_key: key() })).status).toBe(404);
    expect((await request(srv).get(`/epi-fichas/employees/${empA}/documents`).set(h)).status).toBe(404);
    expect((await request(srv).get(`/epi-fichas/documents/${docA}/download`).set(h)).status).toBe(404);
    expect((await request(srv).get(`/epi-fichas/documents/${docA}/verify`).set(h)).status).toBe(404);
  });

  it('técnico NÃO vinculado recebe 404 em tudo', async () => {
    const h = bearer(tokenTecFree);
    expect((await request(srv).post(`/epi-fichas/employees/${empA}/issue`).set(h).send({ idempotency_key: key() })).status).toBe(404);
    expect((await request(srv).get(`/epi-fichas/employees/${empA}/documents`).set(h)).status).toBe(404);
    expect((await request(srv).get(`/epi-fichas/documents/${docA}/download`).set(h)).status).toBe(404);
    expect((await request(srv).get(`/epi-fichas/documents/${docA}/verify`).set(h)).status).toBe(404);
  });

  it('técnico vinculado, parceiro vinculado e admin emitem, listam, baixam e verificam', async () => {
    for (const [nome, t] of [['tecnico', tokenTecLinked], ['parceiro', tokenPartner], ['admin', tokenAdmin]] as const) {
      const h = bearer(t);
      const i = await request(srv).post(`/epi-fichas/employees/${empA}/issue`).set(h).send({ idempotency_key: key() });
      expect([nome, i.status]).toEqual([nome, 201]);
      expect([nome, (await request(srv).get(`/epi-fichas/employees/${empA}/documents`).set(h)).status]).toEqual([nome, 200]);
      expect([nome, (await request(srv).get(`/epi-fichas/documents/${i.body.id}/download`).set(h)).status]).toEqual([nome, 200]);
      const v = await request(srv).get(`/epi-fichas/documents/${i.body.id}/verify`).set(h);
      expect([nome, v.status, v.body.status]).toEqual([nome, 200, 'integro']);
    }
  });

  it('o tenant do documento é o do funcionário, mesmo quando quem emite é o admin (sem tenant no token)', async () => {
    const i = await request(srv).post(`/epi-fichas/employees/${empA}/issue`).set(bearer(tokenAdmin)).send({ idempotency_key: key() });
    expect(i.status).toBe(201);
    const t = (await (db as any).client.query('SELECT tenant_id FROM epi_ficha_documents WHERE id = $1', [i.body.id])).rows[0].tenant_id;
    const e = (await (db as any).client.query('SELECT tenant_id FROM employees WHERE id = $1', [empA])).rows[0].tenant_id;
    expect(t).toBe(e);
  });

  it('ids não UUID -> 400; sem token -> 401', async () => {
    const h = bearer(tokenA);
    expect((await request(srv).get('/epi-fichas/employees/abc/documents').set(h)).status).toBe(400);
    expect((await request(srv).get('/epi-fichas/documents/abc/download').set(h)).status).toBe(400);
    expect((await request(srv).get(`/epi-fichas/documents/${docA}/download`)).status).toBe(401);
    expect((await request(srv).get(`/epi-fichas/documents/${docA}/verify`)).status).toBe(401);
    expect((await request(srv).post(`/epi-fichas/employees/${empA}/issue`).send({ idempotency_key: key() })).status).toBe(401);
  });

  it('não existem rotas de edição/exclusão de documentos: PATCH/PUT/DELETE -> 404', async () => {
    const h = bearer(tokenA);
    expect((await request(srv).patch(`/epi-fichas/documents/${docA}`).set(h).send({})).status).toBe(404);
    expect((await request(srv).put(`/epi-fichas/documents/${docA}`).set(h).send({})).status).toBe(404);
    expect((await request(srv).delete(`/epi-fichas/documents/${docA}`).set(h)).status).toBe(404);
  });

  it('parceiro NÃO vinculado recebe 404 na ficha, na prévia, na emissão, na lista, no download e no verify', async () => {
    const h = bearer(tokenPartnerFree);
    expect((await request(srv).get(`/epi-fichas/employees/${empA}`).set(h)).status).toBe(404);
    expect((await request(srv).get(`/epi-fichas/employees/${empA}/preview.pdf`).set(h)).status).toBe(404);
    expect((await request(srv).post(`/epi-fichas/employees/${empA}/issue`).set(h).send({ idempotency_key: key() })).status).toBe(404);
    expect((await request(srv).get(`/epi-fichas/employees/${empA}/documents`).set(h)).status).toBe(404);
    expect((await request(srv).get(`/epi-fichas/documents/${docA}/download`).set(h)).status).toBe(404);
    expect((await request(srv).get(`/epi-fichas/documents/${docA}/verify`).set(h)).status).toBe(404);
  });

  // 403 por papel fora do @Roles: NÃO APLICÁVEL. Os 4 papéis existentes (empresa, tecnico, parceiro, admin)
  // estão todos na lista de todas as rotas da ficha; o único bloqueio possível é 401 (sem token), testado acima.
});
