import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { TestDb, TestUserFixture } from './db-test-helper';

process.env.RATE_LIMIT_MAX = '5000';

// D0 Task 2: /admin/carteira-socios (somente admin). Reflexo imediato no que o sócio enxerga.
describe('admin-carteira-socios (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let admin: TestUserFixture, admin2: TestUserFixture, socio: TestUserFixture, tecnicoUser: TestUserFixture, parceiroUser: TestUserFixture;
  let empresa: { tenantId: string; userId: string; email: string; password: string };
  let auto: { tenantId: string }, link: { tenantId: string }, linkPar: { tenantId: string };
  let tAdmin: string, tAdmin2: string, tSocio: string, tTec: string, tPar: string, tEmp: string;
  const URL = '/admin/carteira-socios';
  const sufixo = randomUUID().slice(0, 8);
  const nomeAuto = `CartAuto ${sufixo}`;

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, qs = '') => request(app.getHttpServer()).get(`${URL}${qs}`).set(auth(t));
  const put = (t: string, id: string, body: object = {}) => request(app.getHttpServer()).put(`${URL}/${id}`).set(auth(t)).send(body);
  const del = (t: string, id: string) => request(app.getHttpServer()).delete(`${URL}/${id}`).set(auth(t));
  const linhas = async (id: string) => (await db.client.query('SELECT * FROM socio_portfolio WHERE tenant_id=$1', [id])).rows;
  const auditorias = async (id: string) =>
    (await db.client.query("SELECT * FROM audit_log WHERE resource_id=$1 AND action LIKE 'carteira.%' ORDER BY occurred_at", [id])).rows;
  const clientesDoSocio = async () =>
    ((await request(app.getHttpServer()).get(`/atuacao/clientes?q=${encodeURIComponent(sufixo)}`).set(auth(tSocio))).body as any[]).map((c) => c.id);
  // Conexão na role da aplicação (sujeita a RLS), como o técnico.
  async function comoTecnico<T>(userId: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', '', true), set_config('app.role', 'tecnico', true)", [userId]);
      const out = await fn(c);
      await c.query('ROLLBACK');
      return out;
    } finally { await c.end(); }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService).useValue({ createPreapproval: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    admin = await db.createUserWithRole('admin', `Admin Cart ${sufixo}`);
    admin2 = await db.createUserWithRole('admin', `Admin2 Cart ${sufixo}`);
    socio = await db.createUserWithRole('socio', `Socio Cart ${sufixo}`);
    tecnicoUser = await db.createUserWithRole('tecnico', 'Tec Cart');
    parceiroUser = await db.createUserWithRole('parceiro', 'Parc Cart');
    empresa = await db.createTenantWithUser('Empresa Cart');
    auto = await db.createTenantWithUser(`CartAuto ${sufixo}`.replace(` ${sufixo}`, '')); // nome ganha sufixo próprio
    await db.client.query('UPDATE tenants SET name=$2 WHERE id=$1', [auto.tenantId, nomeAuto]);
    link = await db.createTenantWithUser('CartLink');
    await db.client.query('UPDATE tenants SET name=$2 WHERE id=$1', [link.tenantId, `CartLink ${sufixo}`]);
    linkPar = await db.createTenantWithUser('CartLinkPar');
    await db.client.query('UPDATE tenants SET name=$2 WHERE id=$1', [linkPar.tenantId, `CartLinkPar ${sufixo}`]);
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnicoUser.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [link.tenantId, tec.rows[0].id]);
    const par = await db.client.query("INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul') RETURNING id", [parceiroUser.userId]);
    await db.client.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [linkPar.tenantId, par.rows[0].id]);
    await db.grantSocioPermission(socio.userId, 'clients.read');
    [tAdmin, tAdmin2, tSocio, tTec, tPar, tEmp] = await Promise.all([admin, admin2, socio, tecnicoUser, parceiroUser, empresa].map(login));
  }, 90000);

  afterAll(async () => {
    const ts = [auto.tenantId, link.tenantId, linkPar.tenantId, empresa.tenantId];
    await db.client.query('DROP TRIGGER IF EXISTS trg_teste_cart_audit ON audit_log');
    await db.client.query('DROP FUNCTION IF EXISTS teste_cart_audit()');
    await db.client.query('DELETE FROM socio_portfolio WHERE tenant_id = ANY($1)', [ts]);
    await db.client.query('DELETE FROM audit_log WHERE resource_id = ANY($1) OR actor_user_id = ANY($2)', [ts, [admin.userId, admin2.userId, socio.userId]]);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = $1', [socio.userId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  it('papéis diferentes de admin => 403 em GET/PUT/DELETE; sem token => 401', async () => {
    for (const t of [tSocio, tTec, tPar, tEmp]) {
      expect((await get(t)).status).toBe(403);
      expect((await put(t, link.tenantId)).status).toBe(403);
      expect((await del(t, link.tenantId)).status).toBe(403);
    }
    expect((await request(app.getHttpServer()).get(URL)).status).toBe(401);
    expect(await linhas(link.tenantId)).toHaveLength(0);
  });

  it('empresa inexistente => 404; id inválido => 400; corpo com campo extra => 400; nota > 500 => 400', async () => {
    expect((await put(tAdmin, randomUUID())).status).toBe(404);
    expect((await del(tAdmin, randomUUID())).status).toBe(404);
    expect((await put(tAdmin, 'nao-uuid')).status).toBe(400);
    expect((await put(tAdmin, link.tenantId, { foo: 1 })).status).toBe(400);
    expect((await put(tAdmin, link.tenantId, { note: 'x'.repeat(501) })).status).toBe(400);
    expect(await linhas(link.tenantId)).toHaveLength(0);
  });

  it('automática (sem vínculos) => PUT 409 e nada gravado; DELETE não marcada => 404', async () => {
    const r = await put(tAdmin, auto.tenantId);
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toContain('automaticamente');
    expect(await linhas(auto.tenantId)).toHaveLength(0);
    expect((await del(tAdmin, auto.tenantId)).status).toBe(404);
    expect((await del(tAdmin, link.tenantId)).status).toBe(404);
  });

  it('GET: origem e vínculos corretos (automatica / fora / explicita) e filtros', async () => {
    const todos = await get(tAdmin, `?q=${encodeURIComponent(sufixo)}`);
    expect(todos.status).toBe(200);
    expect(todos.body).toMatchObject({ page: 1, page_size: 100 });
    const por = (id: string) => todos.body.itens.find((i: any) => i.tenant_id === id);
    expect(por(auto.tenantId)).toMatchObject({ nome: nomeAuto, origem: 'automatica', vinculos: { tecnicos: 0, parceiros: 0 } });
    expect(por(link.tenantId)).toMatchObject({ origem: 'fora', vinculos: { tecnicos: 1, parceiros: 0 } });
    expect(por(linkPar.tenantId)).toMatchObject({ origem: 'fora', vinculos: { tecnicos: 0, parceiros: 1 } });
    expect(por(link.tenantId)).not.toHaveProperty('marcada_por_nome');
    expect(todos.body.total).toBe(3);
    const fora = await get(tAdmin, `?q=${encodeURIComponent(sufixo)}&origem=fora`);
    expect(fora.body.itens.map((i: any) => i.tenant_id).sort()).toEqual([link.tenantId, linkPar.tenantId].sort());
    expect(fora.body.total).toBe(2);
    expect((await get(tAdmin, `?q=${encodeURIComponent(sufixo)}&origem=explicita`)).body.total).toBe(0);
    expect((await get(tAdmin, '?origem=xyz')).status).toBe(400);
    expect((await get(tAdmin, '?page=0')).status).toBe(400);
    expect((await get(tAdmin, '?foo=1')).status).toBe(400);
  });

  it('busca por CNPJ (com pontuação) e escape de curingas', async () => {
    const cnpj = (await db.client.query('SELECT cnpj FROM tenants WHERE id=$1', [link.tenantId])).rows[0].cnpj as string;
    const mascarado = `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
    const r = await get(tAdmin, `?q=${encodeURIComponent(mascarado)}`);
    expect(r.body.itens.map((i: any) => i.tenant_id)).toContain(link.tenantId);
    for (const q of ['%', '_', '\\', `%${sufixo}`, `Cart_ink ${sufixo}`]) {
      const x = await get(tAdmin, `?q=${encodeURIComponent(q)}`);
      expect(x.status).toBe(200);
      expect(x.body.itens.map((i: any) => i.tenant_id)).not.toContain(link.tenantId);
    }
  });

  it('paginação: 100 por página, page além do fim => itens vazios e total preservado', async () => {
    const p1 = await get(tAdmin);
    expect(p1.body.itens.length).toBeLessThanOrEqual(100);
    expect(p1.body.total).toBeGreaterThanOrEqual(4);
    const longe = await get(tAdmin, '?page=99999');
    expect(longe.status).toBe(200);
    expect(longe.body.itens).toEqual([]);
    expect(longe.body.total).toBe(p1.body.total);
  });

  it('PUT marca (added_by = admin do JWT), audita sem nota, é idempotente; sócio passa a ver a empresa', async () => {
    expect(await clientesDoSocio()).not.toContain(link.tenantId);
    const r = await put(tAdmin, link.tenantId, { note: 'combinado com Danilo - sigiloso' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ tenant_id: link.tenantId, origem: 'explicita', vinculos: { tecnicos: 1, parceiros: 0 }, marcada_por_nome: `Admin Cart ${sufixo}`, note: 'combinado com Danilo - sigiloso' });
    expect(typeof r.body.marcada_em).toBe('string');
    const l = await linhas(link.tenantId);
    expect(l).toHaveLength(1);
    expect(l[0].added_by).toBe(admin.userId);
    const a = await auditorias(link.tenantId);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ action: 'carteira.added', actor_user_id: admin.userId, resource_type: 'tenant', path: `${URL}/${link.tenantId}`, method: 'PUT' });
    expect(a[0].detail).toContain(link.tenantId);
    expect(JSON.stringify(a[0])).not.toContain('sigiloso');
    // idempotente
    const again = await put(tAdmin, link.tenantId);
    expect(again.status).toBe(200);
    expect(again.body.note).toBe('combinado com Danilo - sigiloso');
    expect(await linhas(link.tenantId)).toHaveLength(1);
    expect(await auditorias(link.tenantId)).toHaveLength(1);
    // efeito imediato
    expect(await clientesDoSocio()).toContain(link.tenantId);
    // listagem: explícita, com autor
    const lst = await get(tAdmin, `?q=${encodeURIComponent(sufixo)}&origem=explicita`);
    expect(lst.body.itens.map((i: any) => i.tenant_id)).toEqual([link.tenantId]);
    // o técnico responsável continua enxergando o próprio vínculo
    const vis = await comoTecnico(tecnicoUser.userId, async (c) => (await c.query('SELECT 1 FROM tenant_technicians WHERE tenant_id=$1', [link.tenantId])).rowCount);
    expect(vis).toBe(1);
  });

  it('PUT com nota alterada por outro admin atualiza nota/autor sem nova auditoria added; nota null limpa', async () => {
    const r = await put(tAdmin2, link.tenantId, { note: 'nova nota' });
    expect(r.status).toBe(200);
    expect(r.body.note).toBe('nova nota');
    expect((await linhas(link.tenantId))[0].added_by).toBe(admin2.userId);
    expect(await auditorias(link.tenantId)).toHaveLength(1);
    const limpa = await put(tAdmin, link.tenantId, { note: null });
    expect(limpa.body.note).toBeNull();
  });

  it('DELETE desmarca, audita carteira.removed e o sócio deixa de ver; técnico segue com o vínculo', async () => {
    const r = await del(tAdmin, link.tenantId);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ tenant_id: link.tenantId, origem: 'fora' });
    expect(await linhas(link.tenantId)).toHaveLength(0);
    const a = await auditorias(link.tenantId);
    expect(a.map((x: any) => x.action)).toEqual(['carteira.added', 'carteira.removed']);
    expect(await clientesDoSocio()).not.toContain(link.tenantId);
    const vis = await comoTecnico(tecnicoUser.userId, async (c) => (await c.query('SELECT 1 FROM tenant_technicians WHERE tenant_id=$1', [link.tenantId])).rowCount);
    expect(vis).toBe(1);
    expect((await del(tAdmin, link.tenantId)).status).toBe(404);
  });

  it('empresa marcada que perdeu os vínculos continua explícita; ao desmarcar vira automática (sócio segue vendo)', async () => {
    await put(tAdmin, linkPar.tenantId);
    await db.client.query('DELETE FROM tenant_partners WHERE tenant_id=$1', [linkPar.tenantId]);
    const lst = await get(tAdmin, `?q=${encodeURIComponent(sufixo)}`);
    expect(lst.body.itens.find((i: any) => i.tenant_id === linkPar.tenantId)).toMatchObject({ origem: 'explicita' });
    const r = await del(tAdmin, linkPar.tenantId);
    expect(r.body.origem).toBe('automatica');
    expect(await clientesDoSocio()).toContain(linkPar.tenantId);
  });

  it('auditoria fail-closed: se o INSERT em audit_log falha, PUT e DELETE sofrem rollback', async () => {
    await db.client.query(`CREATE OR REPLACE FUNCTION teste_cart_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action LIKE 'carteira.%' THEN RAISE EXCEPTION 'falha simulada'; END IF; RETURN NEW; END $$`);
    await db.client.query('CREATE TRIGGER trg_teste_cart_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION teste_cart_audit()');
    try {
      const r = await put(tAdmin, link.tenantId, { note: 'x' });
      expect(r.status).toBe(500);
      expect(await linhas(link.tenantId)).toHaveLength(0);
      expect(await clientesDoSocio()).not.toContain(link.tenantId);
      // DELETE: marca por fora (superuser) e confirma que a remoção é revertida
      await db.client.query('INSERT INTO socio_portfolio (tenant_id, added_by) VALUES ($1, $2)', [link.tenantId, admin.userId]);
      const d = await del(tAdmin, link.tenantId);
      expect(d.status).toBe(500);
      expect(await linhas(link.tenantId)).toHaveLength(1);
    } finally {
      await db.client.query('DROP TRIGGER IF EXISTS trg_teste_cart_audit ON audit_log');
      await db.client.query('DROP FUNCTION IF EXISTS teste_cart_audit()');
      await db.client.query('DELETE FROM socio_portfolio WHERE tenant_id=$1', [link.tenantId]);
    }
  });
});
