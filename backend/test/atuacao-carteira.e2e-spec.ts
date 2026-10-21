import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { TestDb, TestUserFixture } from './db-test-helper';

// Painel de Atuação, Fase 2, Task 1: RLS do papel socio sobre a carteira
// Montese (tenants sem vínculo ativo/inativo a técnico). Conexão na role da
// aplicação (montese_app, sujeita a RLS), transação com set_config local,
// sempre com ROLLBACK.
async function comoSocio<T>(userId: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', '', true), set_config('app.role', 'socio', true)",
      [userId],
    );
    const out = await fn(client);
    await client.query('ROLLBACK');
    return out;
  } finally {
    await client.end();
  }
}

describe('atuacao-carteira — RLS do socio (e2e)', () => {
  let db: TestDb;
  let socio: TestUserFixture;
  let montese: { tenantId: string };
  let parceiro: { tenantId: string };
  let subMontese: string;
  let subParceiro: string;
  let unitMontese: string;
  let unitParceiro: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', 'Socio RLS');
    montese = await db.createTenantWithUser('Cliente Montese RLS');
    parceiro = await db.createTenantWithUser('Cliente Parceiro RLS');

    const tecnico = await db.createUserWithRole('tecnico', 'Tec RLS');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      parceiro.tenantId,
      tec.rows[0].id,
    ]);

    const plano = await db.client.query('SELECT id FROM plans LIMIT 1');
    const mkSub = async (tenantId: string) =>
      (
        await db.client.query(
          `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
           VALUES ($1, $2, 'authorized', $3) RETURNING id`,
          [plano.rows[0].id, tenantId, `carteira-${Math.random()}`],
        )
      ).rows[0].id as string;
    subMontese = await mkSub(montese.tenantId);
    subParceiro = await mkSub(parceiro.tenantId);

    const mkUnit = async (tenantId: string) =>
      (
        await db.client.query(
          `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
           VALUES ($1, 'Unidade RLS', 'Rua A', 'Recife', 'PE', '50000000') RETURNING id`,
          [tenantId],
        )
      ).rows[0].id as string;
    unitMontese = await mkUnit(montese.tenantId);
    unitParceiro = await mkUnit(parceiro.tenantId);
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
  });

  it('socio vê tenant Montese (sem vínculo) e não vê tenant de técnico', async () => {
    const ids = await comoSocio(socio.userId, async (c) =>
      (await c.query('SELECT id FROM tenants')).rows.map((r: any) => r.id),
    );
    expect(ids).toContain(montese.tenantId);
    expect(ids).not.toContain(parceiro.tenantId);
  });

  it('socio atualiza campo de tenant Montese e NÃO atualiza tenant de técnico (0 linhas)', async () => {
    const r = await comoSocio(socio.userId, async (c) => {
      const a = await c.query("UPDATE tenants SET sector = 'X-socio' WHERE id = $1 RETURNING id, sector", [montese.tenantId]);
      const b = await c.query("UPDATE tenants SET sector = 'X-socio' WHERE id = $1 RETURNING id", [parceiro.tenantId]);
      return { a: a.rowCount, aSector: a.rows[0]?.sector, b: b.rowCount };
    });
    expect(r.a).toBe(1);
    expect(r.aSector).toBe('X-socio');
    expect(r.b).toBe(0);
    const dados = await db.client.query('SELECT id, sector FROM tenants WHERE id = ANY($1)', [
      [montese.tenantId, parceiro.tenantId],
    ]);
    expect(dados.rows.every((x: any) => x.sector !== 'X-socio')).toBe(true); // ROLLBACK; dado intacto
  });

  it('socio não faz INSERT nem DELETE em tenants (dado intacto)', async () => {
    await expect(
      comoSocio(socio.userId, (c) =>
        c.query("INSERT INTO tenants (name, cnpj, status) VALUES ('Intruso RLS', '99999999000199', 'ativo')"),
      ),
    ).rejects.toThrow(/row-level security/i);
    const del = await comoSocio(socio.userId, (c) =>
      c.query('DELETE FROM tenants WHERE id = ANY($1)', [[montese.tenantId, parceiro.tenantId]]),
    );
    expect(del.rowCount).toBe(0);
    const ainda = await db.client.query('SELECT count(*)::int AS n FROM tenants WHERE id = ANY($1)', [
      [montese.tenantId, parceiro.tenantId],
    ]);
    expect(ainda.rows[0].n).toBe(2);
    const intruso = await db.client.query("SELECT count(*)::int AS n FROM tenants WHERE cnpj = '99999999000199'");
    expect(intruso.rows[0].n).toBe(0);
  });

  it('socio lê subscriptions e company_units só de tenant Montese, sem escrever', async () => {
    const r = await comoSocio(socio.userId, async (c) => ({
      subs: (await c.query('SELECT id FROM subscriptions WHERE id = ANY($1)', [[subMontese, subParceiro]])).rows.map((x: any) => x.id),
      units: (await c.query('SELECT id FROM company_units WHERE id = ANY($1)', [[unitMontese, unitParceiro]])).rows.map((x: any) => x.id),
      updSub: (await c.query("UPDATE subscriptions SET status = 'cancelled' WHERE id = $1", [subMontese])).rowCount,
      updUnit: (await c.query("UPDATE company_units SET name = 'hack' WHERE id = $1", [unitMontese])).rowCount,
      delUnit: (await c.query('DELETE FROM company_units WHERE id = $1', [unitMontese])).rowCount,
    }));
    expect(r.subs).toEqual([subMontese]);
    expect(r.units).toEqual([unitMontese]);
    expect(r.updSub).toBe(0);
    expect(r.updUnit).toBe(0);
    expect(r.delUnit).toBe(0);
    const s = await db.client.query('SELECT status FROM subscriptions WHERE id = $1', [subMontese]);
    const u = await db.client.query('SELECT name FROM company_units WHERE id = $1', [unitMontese]);
    expect(s.rows[0].status).toBe('authorized');
    expect(u.rows[0].name).toBe('Unidade RLS');
  });
});

// Task 3: HTTP do módulo atuacao (resumo, lista, ficha, edição operacional).
describe('atuacao — HTTP (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let socio: TestUserFixture;
  let semPerm: TestUserFixture;
  let admin: TestUserFixture;
  let tecnicoUser: TestUserFixture;
  let montese: { tenantId: string; email: string; password: string };
  let parceiro: { tenantId: string };
  let token: string;
  let tokenSemPerm: string;

  const login = async (email: string, password: string): Promise<string> =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tenantRow = async (id: string) =>
    (await db.client.query('SELECT name, cnpj, plan, status, sector, notes FROM tenants WHERE id = $1', [id])).rows[0];

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue({ createPreapproval: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app); // mesmo ValidationPipe global (whitelist + forbidNonWhitelisted) da produção
    await app.init();

    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', 'Socio Http');
    semPerm = await db.createUserWithRole('socio', 'Socio SemPerm');
    admin = await db.createUserWithRole('admin', 'Admin Http');
    tecnicoUser = await db.createUserWithRole('tecnico', 'Tec Http');
    montese = await db.createTenantWithUser('Cliente Montese Http');
    parceiro = await db.createTenantWithUser('Cliente Parceiro Http');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnicoUser.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      parceiro.tenantId,
      tec.rows[0].id,
    ]);
    await db.client.query(
      `INSERT INTO company_units (tenant_id, name, address_street, address_city, address_state, address_zip)
       VALUES ($1, 'Unidade Http', 'Rua A', 'Recife', 'PE', '50000000')`,
      [montese.tenantId],
    );
    await db.grantSocioPermission(socio.userId, 'clients.read');
    token = await login(socio.email, socio.password);
    tokenSemPerm = await login(semPerm.email, semPerm.password);
  });

  afterAll(async () => {
    await db.client.query('DELETE FROM audit_log WHERE resource_id = $1 OR actor_user_id = ANY($2)', [
      montese.tenantId,
      [socio.userId, semPerm.userId],
    ]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('socio sem permissão recebe 403 PERMISSION_DENIED e a negação é auditada', async () => {
    const res = await request(app.getHttpServer()).get('/atuacao/clientes').set(auth(tokenSemPerm));
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('PERMISSION_DENIED');
    const n = await db.client.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE action = 'permission.denied' AND actor_user_id = $1",
      [semPerm.userId],
    );
    expect(n.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('com clients.read lista só clientes Montese', async () => {
    const res = await request(app.getHttpServer()).get('/atuacao/clientes').set(auth(token));
    expect(res.status).toBe(200);
    const ids = res.body.map((c: any) => c.id);
    expect(ids).toContain(montese.tenantId);
    expect(ids).not.toContain(parceiro.tenantId);
    const filtrada = await request(app.getHttpServer()).get('/atuacao/clientes?situacao=trial&q=Montese Http').set(auth(token));
    expect(filtrada.status).toBe(200);
    expect(filtrada.body.map((c: any) => c.id)).toContain(montese.tenantId);
    const invalida = await request(app.getHttpServer()).get('/atuacao/clientes?situacao=xyz').set(auth(token));
    expect(invalida.status).toBe(400);
    const extra = await request(app.getHttpServer()).get('/atuacao/clientes?foo=1').set(auth(token));
    expect(extra.status).toBe(400);
  });

  it('ficha de tenant de técnico retorna 404 (não 403) e a de Montese 200 com units', async () => {
    const ruim = await request(app.getHttpServer()).get(`/atuacao/clientes/${parceiro.tenantId}`).set(auth(token));
    expect(ruim.status).toBe(404);
    const ok = await request(app.getHttpServer()).get(`/atuacao/clientes/${montese.tenantId}`).set(auth(token));
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(montese.tenantId);
    expect(ok.body.units).toHaveLength(1);
    expect(ok.body.units[0].address_city).toBe('Recife');
    const invalidoUuid = await request(app.getHttpServer()).get('/atuacao/clientes/nao-uuid').set(auth(token));
    expect(invalidoUuid.status).toBe(400);
  });

  it('resumo bate com a contagem real: cria assinatura authorized num tenant e confere ativos', async () => {
    const antes = await request(app.getHttpServer()).get('/atuacao/resumo').set(auth(token));
    expect(antes.status).toBe(200);
    const reais = await db.client.query(
      `SELECT count(*)::int AS n FROM tenants t WHERE is_montese_tenant(t.id)`,
    );
    expect(antes.body.total).toBe(reais.rows[0].n);
    expect(antes.body.ativos + antes.body.trial + antes.body.pendentes + antes.body.inativos).toBe(antes.body.total);

    const plano = await db.client.query('SELECT id FROM plans LIMIT 1');
    await db.client.query(
      `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id)
       VALUES ($1, $2, 'authorized', $3)`,
      [plano.rows[0].id, montese.tenantId, `resumo-${Math.random()}`],
    );
    const depois = await request(app.getHttpServer()).get('/atuacao/resumo').set(auth(token));
    expect(depois.body.total).toBe(antes.body.total);
    expect(depois.body.ativos).toBe(antes.body.ativos + 1);
    expect(depois.body.trial).toBe(antes.body.trial - 1);
    const ficha = await request(app.getHttpServer()).get(`/atuacao/clientes/${montese.tenantId}`).set(auth(token));
    expect(ficha.body.situacao).toBe('ativa');
  });

  it('PATCH altera sector, e cnpj/plan/name/status no corpo retornam 400 e o dado NÃO muda', async () => {
    await db.grantSocioPermission(socio.userId, 'clients.update_operational');
    const antes = await tenantRow(montese.tenantId);
    const ok = await request(app.getHttpServer())
      .patch(`/atuacao/clientes/${montese.tenantId}`).set(auth(token)).send({ sector: 'Metalurgia', notes: 'ok' });
    expect(ok.status).toBe(200);
    expect(ok.body.sector).toBe('Metalurgia');
    const meio = await tenantRow(montese.tenantId);
    expect(meio.sector).toBe('Metalurgia');
    expect(meio.cnpj).toBe(antes.cnpj);

    for (const proibido of [{ cnpj: '11111111000111' }, { plan: 'x' }, { name: 'Hack' }, { status: 'inativo' }, { sector: 'Y', cnpj: '1' }]) {
      const r = await request(app.getHttpServer()).patch(`/atuacao/clientes/${montese.tenantId}`).set(auth(token)).send(proibido);
      expect(r.status).toBe(400);
    }
    const depois = await tenantRow(montese.tenantId);
    expect(depois).toEqual(meio);
    expect(depois.name).toBe(antes.name);
    expect(depois.plan).toBe(antes.plan);
    expect(depois.status).toBe(antes.status);
  });

  it('PATCH em tenant de técnico retorna 404 e o dado NÃO muda', async () => {
    const antes = await tenantRow(parceiro.tenantId);
    const r = await request(app.getHttpServer())
      .patch(`/atuacao/clientes/${parceiro.tenantId}`).set(auth(token)).send({ sector: 'Invasao' });
    expect(r.status).toBe(404);
    expect(await tenantRow(parceiro.tenantId)).toEqual(antes);
  });

  it('PATCH sem clients.update_operational retorna 403 e o dado NÃO muda', async () => {
    await db.grantSocioPermission(semPerm.userId, 'clients.read');
    const antes = await tenantRow(montese.tenantId);
    const r = await request(app.getHttpServer())
      .patch(`/atuacao/clientes/${montese.tenantId}`).set(auth(tokenSemPerm)).send({ sector: 'NaoDeve' });
    expect(r.status).toBe(403);
    expect(await tenantRow(montese.tenantId)).toEqual(antes);
  });

  it('PATCH grava auditoria com nomes de campos e sem valores', async () => {
    const valor = 'SetorSecretoXYZ';
    const r = await request(app.getHttpServer())
      .patch(`/atuacao/clientes/${montese.tenantId}`).set(auth(token)).send({ sector: valor, contact_name: 'Fulano Sigiloso' });
    expect(r.status).toBe(200);
    const a = await db.client.query(
      "SELECT detail, actor_user_id FROM audit_log WHERE action = 'client.update_operational' AND resource_id = $1 ORDER BY occurred_at DESC LIMIT 1",
      [montese.tenantId],
    );
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].actor_user_id).toBe(socio.userId);
    expect(a.rows[0].detail).toContain('sector');
    expect(a.rows[0].detail).toContain('contact_name');
    expect(a.rows[0].detail).not.toContain(valor);
    expect(a.rows[0].detail).not.toContain('Fulano');
  });

  it('empresa, técnico e admin recebem 403 em /atuacao/*', async () => {
    const tokens = [
      await login(montese.email, montese.password),
      await login(tecnicoUser.email, tecnicoUser.password),
      await login(admin.email, admin.password),
    ];
    for (const t of tokens) {
      for (const path of ['/atuacao/resumo', '/atuacao/clientes', `/atuacao/clientes/${montese.tenantId}`]) {
        const r = await request(app.getHttpServer()).get(path).set(auth(t));
        expect(r.status).toBe(403);
      }
      const p = await request(app.getHttpServer()).patch(`/atuacao/clientes/${montese.tenantId}`).set(auth(t)).send({ sector: 'Hack' });
      expect(p.status).toBe(403);
    }
    expect((await tenantRow(montese.tenantId)).sector).not.toBe('Hack');
  });
});
