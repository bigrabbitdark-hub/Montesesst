import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { TestDb, TestUserFixture } from './db-test-helper';

// Painel de Atuação, Fase 4, Task 1 (migration 0095): socio lê payment_events de
// assinaturas de tenants Montese; plans fica protegida contra escrita por papéis de
// aplicação (trigger). Conexão na role da aplicação (montese_app, sujeita a RLS), em
// transação com set_config local e ROLLBACK. Asserções de dado leem pelo superusuário.
async function comPapel<T>(role: string | null, userId: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    if (role !== null) {
      await client.query(
        "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', '', true), set_config('app.role', $2, true)",
        [userId, role],
      );
    }
    const out = await fn(client);
    await client.query('ROLLBACK');
    return out;
  } finally {
    await client.end();
  }
}

// Executa e devolve a mensagem de erro (ou null se não houve exceção) e o rowCount.
async function tenta(c: Client, sql: string, p: any[] = []) {
  await c.query('SAVEPOINT s');
  try {
    const r = await c.query(sql, p);
    return { erro: null as string | null, rows: r.rowCount ?? 0 };
  } catch (e: any) {
    await c.query('ROLLBACK TO SAVEPOINT s');
    return { erro: String(e.message), rows: 0 };
  }
}

describe('atuacao-financeiro — payment_events e plans (e2e de banco)', () => {
  let db: TestDb;
  let socio: TestUserFixture;
  let tecnicoUser: TestUserFixture;
  let parceiroUser: TestUserFixture;
  let admin: TestUserFixture;
  let montese: { tenantId: string; userId: string; email: string; password: string };
  let comTecnico: { tenantId: string; userId: string };
  let comParceiro: { tenantId: string; userId: string };
  let plano: { id: string; price_cents: number; name: string; active: boolean };
  let subMontese: string;
  let subTecnicoTenant: string;
  let subParceiroTenant: string;
  let subTecnicoAutonomo: string;
  let evMontese: string;
  let evTecTenant: string;
  let evParceiro: string;
  let evAutonomo: string;
  let evOrfao: string;
  let app: INestApplication;
  let tSocio: string;
  let tEmpresa: string;
  const sufixo = randomUUID().slice(0, 8);

  const login = async (email: string, password: string): Promise<string> =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  // A auditoria é "fire and forget": aguarda a linha aparecer (ou o tempo esgotar).
  const negacoes = async (userId: string, esperaMin = 0) => {
    let rows: any[] = [];
    for (let i = 0; i < 30; i++) {
      rows = (
        await db.client.query(
          "SELECT actor_role, method, path, status_code, resource_type FROM audit_log WHERE actor_user_id = $1 AND action = 'role.denied' ORDER BY occurred_at",
          [userId],
        )
      ).rows;
      if (rows.length >= esperaMin) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return rows;
  };
  const subStatus = async (id: string) =>
    (await db.client.query('SELECT status FROM subscriptions WHERE id = $1', [id])).rows[0].status;
  const contaSubs = async () =>
    (await db.client.query('SELECT count(*)::int AS n FROM subscriptions WHERE tenant_id = $1', [montese.tenantId])).rows[0].n;

  const mkSub = async (tenantId: string | null, techUserId: string | null, tag: string) =>
    (
      await db.client.query(
        `INSERT INTO subscriptions (plan_id, tenant_id, technician_user_id, status, mercadopago_preapproval_id)
         VALUES ($1, $2, $3, 'authorized', $4) RETURNING id`,
        [plano.id, tenantId, techUserId, `fin-${tag}-${sufixo}`],
      )
    ).rows[0].id as string;
  const mkEvt = async (subId: string | null, tag: string) =>
    (
      await db.client.query(
        `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
         VALUES ($1, $2, 1000, 'approved', now()) RETURNING id`,
        [subId, `fin-evt-${tag}-${sufixo}`],
      )
    ).rows[0].id as string;
  const planoAtual = async () =>
    (await db.client.query('SELECT price_cents, name, active FROM plans WHERE id = $1', [plano.id])).rows[0];
  const planoIntacto = async () => {
    const p = await planoAtual();
    expect(p.price_cents).toBe(plano.price_cents);
    expect(p.name).toBe(plano.name);
    expect(p.active).toBe(plano.active);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue({ createPreapproval: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', 'Socio Financeiro');
    admin = await db.createUserWithRole('admin', 'Admin Financeiro');
    tecnicoUser = await db.createUserWithRole('tecnico', 'Tec Financeiro');
    parceiroUser = await db.createUserWithRole('parceiro', 'Parc Financeiro');
    montese = await db.createTenantWithUser('Cliente Montese Fin');
    comTecnico = await db.createTenantWithUser('Cliente Tecnico Fin');
    comParceiro = await db.createTenantWithUser('Cliente Parceiro Fin');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnicoUser.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      comTecnico.tenantId,
      tec.rows[0].id,
    ]);
    const par = await db.client.query(
      "INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id",
      [parceiroUser.userId],
    );
    await db.client.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [
      comParceiro.tenantId,
      par.rows[0].id,
    ]);
    plano = (await db.client.query('SELECT id, price_cents, name, active FROM plans ORDER BY slug LIMIT 1')).rows[0];
    subMontese = await mkSub(montese.tenantId, null, 'm');
    subTecnicoTenant = await mkSub(comTecnico.tenantId, null, 't');
    subParceiroTenant = await mkSub(comParceiro.tenantId, null, 'p');
    subTecnicoAutonomo = await mkSub(null, tecnicoUser.userId, 'a');
    evMontese = await mkEvt(subMontese, 'm');
    evTecTenant = await mkEvt(subTecnicoTenant, 't');
    evParceiro = await mkEvt(subParceiroTenant, 'p');
    evAutonomo = await mkEvt(subTecnicoAutonomo, 'a');
    evOrfao = await mkEvt(null, 'o');
    tSocio = await login(socio.email, socio.password);
    tEmpresa = await login(montese.email, montese.password);
  });

  afterAll(async () => {
    await db.client.query('DELETE FROM payment_events WHERE mercadopago_payment_id LIKE $1', [`%${sufixo}`]);
    await db.client.query('DELETE FROM subscriptions WHERE technician_user_id = $1', [tecnicoUser.userId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('socio lê payment_events de assinatura de tenant Montese e NÃO os de técnico, de tenant de parceiro nem órfãos', async () => {
    const ids = [evMontese, evTecTenant, evParceiro, evAutonomo, evOrfao];
    const lidos = await comPapel('socio', socio.userId, async (c) =>
      (await c.query('SELECT id FROM payment_events WHERE id = ANY($1)', [ids])).rows.map((r: any) => r.id),
    );
    expect(lidos).toEqual([evMontese]);
    // dado de origem existe (superusuário vê os 5): a invisibilidade é da policy, não de ausência
    const todos = await db.client.query('SELECT count(*)::int AS n FROM payment_events WHERE id = ANY($1)', [ids]);
    expect(todos.rows[0].n).toBe(5);
  });

  it('socio não faz INSERT/UPDATE/DELETE em payment_events nem em subscriptions (0 linhas / erro RLS) e o dado fica intacto', async () => {
    const antesEv = (await db.client.query('SELECT status, amount_cents FROM payment_events WHERE id = $1', [evMontese])).rows[0];
    const antesSub = (await db.client.query('SELECT status FROM subscriptions WHERE id = $1', [subMontese])).rows[0];
    const r = await comPapel('socio', socio.userId, async (c) => ({
      insEv: await tenta(
        c,
        `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
         VALUES ($1, $2, 1, 'approved', now())`,
        [subMontese, `fin-socio-ins-${sufixo}`],
      ),
      updEv: await tenta(c, "UPDATE payment_events SET status = 'x', amount_cents = 1 WHERE id = $1", [evMontese]),
      delEv: await tenta(c, 'DELETE FROM payment_events WHERE id = $1', [evMontese]),
      insSub: await tenta(
        c,
        `INSERT INTO subscriptions (plan_id, tenant_id, status, mercadopago_preapproval_id) VALUES ($1, $2, 'authorized', $3)`,
        [plano.id, montese.tenantId, `fin-socio-sub-${sufixo}`],
      ),
      updSub: await tenta(c, "UPDATE subscriptions SET status = 'cancelled' WHERE id = $1", [subMontese]),
      delSub: await tenta(c, 'DELETE FROM subscriptions WHERE id = $1', [subMontese]),
    }));
    for (const k of ['insEv', 'insSub'] as const) expect(r[k].erro).toMatch(/row-level security|permission denied/i);
    for (const k of ['updEv', 'delEv', 'updSub', 'delSub'] as const) {
      expect(r[k].erro === null ? r[k].rows : 0).toBe(0);
    }
    const depEv = (await db.client.query('SELECT status, amount_cents FROM payment_events WHERE id = $1', [evMontese])).rows;
    expect(depEv).toEqual([antesEv]);
    const depSub = (await db.client.query('SELECT status FROM subscriptions WHERE id = $1', [subMontese])).rows;
    expect(depSub).toEqual([antesSub]);
    const novos = await db.client.query(
      "SELECT count(*)::int AS n FROM payment_events WHERE mercadopago_payment_id = $1", [`fin-socio-ins-${sufixo}`]);
    expect(novos.rows[0].n).toBe(0);
  });

  it('socio não altera plans: UPDATE/INSERT/DELETE com app.role=socio levantam exceção e a linha fica intacta', async () => {
    const qtd = (await db.client.query('SELECT count(*)::int AS n FROM plans')).rows[0].n;
    const r = await comPapel('socio', socio.userId, async (c) => ({
      upd: await tenta(c, 'UPDATE plans SET price_cents = 1, name = $2 WHERE id = $1', [plano.id, 'HACK']),
      ins: await tenta(c, "INSERT INTO plans (audience, slug, name, price_cents) VALUES ('empresa', $1, 'x', 1)", [`hack-${sufixo}`]),
      del: await tenta(c, 'DELETE FROM plans WHERE id = $1', [plano.id]),
    }));
    for (const k of ['upd', 'ins', 'del'] as const) expect(r[k].erro).toMatch(/plans: escrita não permitida para o papel socio/);
    await planoIntacto();
    expect((await db.client.query('SELECT count(*)::int AS n FROM plans')).rows[0].n).toBe(qtd);
  });

  it('empresa, técnico e parceiro também não alteram plans (exceção), mas leem plans normalmente', async () => {
    const contagem = (await db.client.query('SELECT count(*)::int AS n FROM plans')).rows[0].n;
    for (const [papel, uid] of [
      ['empresa', montese.userId],
      ['tecnico', tecnicoUser.userId],
      ['parceiro', parceiroUser.userId],
    ] as const) {
      const r = await comPapel(papel, uid, async (c) => ({
        upd: await tenta(c, 'UPDATE plans SET price_cents = 1 WHERE id = $1', [plano.id]),
        ins: await tenta(c, "INSERT INTO plans (audience, slug, name, price_cents) VALUES ('empresa', $1, 'x', 1)", [`hack-${papel}-${sufixo}`]),
        del: await tenta(c, 'DELETE FROM plans WHERE id = $1', [plano.id]),
        leitura: (await c.query('SELECT id, price_cents FROM plans')).rows,
      }));
      for (const k of ['upd', 'ins', 'del'] as const) {
        expect(r[k].erro).toContain(`plans: escrita não permitida para o papel ${papel}`);
      }
      expect(r.leitura.length).toBe(contagem);
      expect(r.leitura.find((p: any) => p.id === plano.id).price_cents).toBe(plano.price_cents);
      await planoIntacto();
    }
  });

  it('plans_guard_role é allowlist: papel desconhecido falha fechado; admin faz INSERT/UPDATE/DELETE', async () => {
    for (const papel of ['ADMIN', 'xyz', 'Socio', 'superuser']) {
      const r = await comPapel(papel, socio.userId, async (c) => ({
        upd: await tenta(c, 'UPDATE plans SET price_cents = 1 WHERE id = $1', [plano.id]),
        ins: await tenta(c, "INSERT INTO plans (audience, slug, name, price_cents) VALUES ('empresa', $1, 'x', 1)", [`desc-${sufixo}`]),
        del: await tenta(c, 'DELETE FROM plans WHERE id = $1', [plano.id]),
      }));
      for (const k of ['upd', 'ins', 'del'] as const) expect(r[k].erro).toContain(`plans: escrita não permitida para o papel ${papel}`);
    }
    const adm = await comPapel('admin', admin.userId, async (c) => {
      const ins = await tenta(c, "INSERT INTO plans (audience, slug, name, price_cents) VALUES ('empresa', $1, 'tmp', 1)", [`adm-${sufixo}`]);
      const lido = (await c.query('SELECT count(*)::int AS n FROM plans WHERE slug = $1', [`adm-${sufixo}`])).rows[0].n;
      const del = await tenta(c, 'DELETE FROM plans WHERE slug = $1', [`adm-${sufixo}`]);
      const depois = (await c.query('SELECT count(*)::int AS n FROM plans WHERE slug = $1', [`adm-${sufixo}`])).rows[0].n;
      return { ins, lido, del, depois };
    });
    expect(adm.ins.erro).toBeNull();
    expect(adm.lido).toBe(1);
    expect(adm.del.erro).toBeNull();
    expect(adm.del.rows).toBe(1);
    expect(adm.depois).toBe(0);
    await planoIntacto();
    expect((await db.client.query('SELECT count(*)::int AS n FROM plans WHERE slug LIKE $1', [`%${sufixo}`])).rows[0].n).toBe(0);
  });

  it('admin e contexto sem papel (migrations/superusuário) continuam alterando plans', async () => {
    // admin e contexto sem papel via montese_app; superusuário via db.client. Tudo em
    // transação com ROLLBACK (restauração do valor) e conferência final de que voltou.
    const admin1 = await comPapel('admin', admin.userId, async (c) => {
      const r = await tenta(c, 'UPDATE plans SET price_cents = $2 WHERE id = $1', [plano.id, plano.price_cents + 7]);
      const lido = (await c.query('SELECT price_cents FROM plans WHERE id = $1', [plano.id])).rows[0].price_cents;
      return { r, lido };
    });
    expect(admin1.r.erro).toBeNull();
    expect(admin1.r.rows).toBe(1);
    expect(admin1.lido).toBe(plano.price_cents + 7);

    const semPapel = await comPapel(null, '', async (c) => {
      const r = await tenta(c, 'UPDATE plans SET price_cents = $2 WHERE id = $1', [plano.id, plano.price_cents + 9]);
      const lido = (await c.query('SELECT price_cents FROM plans WHERE id = $1', [plano.id])).rows[0].price_cents;
      return { r, lido };
    });
    expect(semPapel.r.erro).toBeNull();
    expect(semPapel.r.rows).toBe(1);
    expect(semPapel.lido).toBe(plano.price_cents + 9);

    await db.client.query('BEGIN');
    try {
      const su = await db.client.query('UPDATE plans SET price_cents = $2 WHERE id = $1', [plano.id, plano.price_cents + 11]);
      expect(su.rowCount).toBe(1);
    } finally {
      await db.client.query('ROLLBACK');
    }
    await planoIntacto(); // valor restaurado pelo ROLLBACK
  });

  it('função do webhook payments_record_payment_event continua gravando evento sem contexto de papel', async () => {
    const pay = `fin-webhook-${sufixo}`;
    const preap = `fin-m-${sufixo}`;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      // sem set_config algum: contexto sem papel
      const r = await client.query('SELECT * FROM payments_record_payment_event($1, $2, $3, $4, now())', [pay, preap, 4242, 'approved']);
      expect(r.rows[0].subscription_id).toBe(subMontese);
      // webhook de status também (UPDATE de subscriptions + JOIN em plans)
      const s = await client.query('SELECT * FROM payments_update_subscription_status($1, $2)', [preap, 'paused']);
      expect(s.rows[0].subscription_id).toBe(subMontese);
    } finally {
      await client.end();
    }
    const gravado = await db.client.query(
      'SELECT subscription_id, amount_cents, status FROM payment_events WHERE mercadopago_payment_id = $1', [pay]);
    expect(gravado.rows).toEqual([{ subscription_id: subMontese, amount_cents: 4242, status: 'approved' }]);
    const st = await db.client.query('SELECT status FROM subscriptions WHERE id = $1', [subMontese]);
    expect(st.rows[0].status).toBe('paused');
    await db.client.query("UPDATE subscriptions SET status = 'authorized' WHERE id = $1", [subMontese]);
    await planoIntacto();
  });

  it('empresa e técnico continuam lendo os próprios payment_events e não os de outros', async () => {
    const ids = [evMontese, evTecTenant, evParceiro, evAutonomo, evOrfao];
    const ler = (papel: string, uid: string, tenantId: string) =>
      comPapel(papel, uid, async (c) => {
        await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        return (await c.query('SELECT id FROM payment_events WHERE id = ANY($1)', [ids])).rows.map((r: any) => r.id).sort();
      });
    expect(await ler('empresa', montese.userId, montese.tenantId)).toEqual([evMontese]);
    expect(await ler('empresa', comTecnico.userId, comTecnico.tenantId)).toEqual([evTecTenant]);
    expect(await ler('tecnico', tecnicoUser.userId, '')).toEqual([evAutonomo]);
  });

  it('HTTP: socio PATCH /plans/:id => 403, preço intacto e role.denied auditado com path sem query string', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/plans/${plano.id}?x=1`)
      .set(auth(tSocio))
      .send({ price_cents: 1 });
    expect(res.status).toBe(403);
    await planoIntacto();
    const rows = await negacoes(socio.userId, 1);
    const linha = rows.find((r) => r.path.endsWith(`/plans/${plano.id}`));
    expect(linha).toBeDefined();
    expect(linha.actor_role).toBe('socio');
    expect(linha.method).toBe('PATCH');
    expect(linha.status_code).toBe(403);
    expect(linha.resource_type).toBe('route');
    for (const r of rows) expect(r.path).not.toContain('?');
  });

  it('HTTP: socio PATCH /subscriptions/:id/status e POST /subscriptions => 403, assinatura intacta e role.denied', async () => {
    const antes = await negacoes(socio.userId);
    const statusAntes = await subStatus(subMontese);
    const qtdAntes = await contaSubs();
    const r1 = await request(app.getHttpServer())
      .patch(`/subscriptions/${subMontese}/status`)
      .set(auth(tSocio))
      .send({ status: 'cancelled' });
    const r2 = await request(app.getHttpServer())
      .post('/subscriptions')
      .set(auth(tSocio))
      .send({ plan_id: plano.id });
    expect(r1.status).toBe(403);
    expect(r2.status).toBe(403);
    expect(await subStatus(subMontese)).toBe(statusAntes);
    expect(await contaSubs()).toBe(qtdAntes);
    const rows = await negacoes(socio.userId, antes.length + 2);
    const novas = rows.slice(antes.length);
    expect(novas.some((r) => r.method === 'PATCH' && r.path.endsWith(`/subscriptions/${subMontese}/status`))).toBe(true);
    expect(novas.some((r) => r.method === 'POST' && r.path.endsWith('/subscriptions'))).toBe(true);
  });

  it('HTTP: socio GET /admin/dashboard/financeiro => 403 e role.denied; empresa => 403 sem role.denied', async () => {
    const antes = await negacoes(socio.userId);
    const r = await request(app.getHttpServer()).get('/admin/dashboard/financeiro?dias=7').set(auth(tSocio));
    expect(r.status).toBe(403);
    const rows = await negacoes(socio.userId, antes.length + 1);
    const nova = rows.slice(antes.length).find((x) => x.method === 'GET' && x.path.endsWith('/admin/dashboard/financeiro'));
    expect(nova).toBeDefined();
    expect(nova.path).not.toContain('?');

    const e = await request(app.getHttpServer()).get('/admin/dashboard/financeiro').set(auth(tEmpresa));
    expect(e.status).toBe(403);
    await new Promise((res) => setTimeout(res, 500));
    expect(await negacoes(montese.userId)).toEqual([]);
    const geral = await db.client.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE action = 'role.denied' AND actor_role <> 'socio'",
    );
    expect(geral.rows[0].n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fase 4, Task 3: consulta financeira HTTP (somente leitura). Dados controlados;
// o banco descartável pode ter outros clientes Montese, então o resumo é conferido
// por DELTA exato (antes x depois do seed) e a lista por nome único.
// ---------------------------------------------------------------------------
describe('atuacao-financeiro — consulta HTTP somente leitura (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let socio: TestUserFixture;
  let socioSem: TestUserFixture;
  let admin: TestUserFixture;
  let tecnico: TestUserFixture;
  let parceiro: TestUserFixture;
  let m1: { tenantId: string; userId: string; email: string; password: string };
  let m2: { tenantId: string };
  let m3: { tenantId: string };
  let tTec: { tenantId: string };
  let tPar: { tenantId: string };
  let plano: { id: string; price_cents: number; name: string };
  let tSocio: string;
  let tSocioSem: string;
  const tag = randomUUID().slice(0, 8);
  const sufixo = randomUUID().slice(0, 8);
  const URLS = ['/atuacao/financeiro/resumo', '/atuacao/financeiro/clientes'];
  const login = async (email: string, password: string): Promise<string> =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (url: string, t = tSocio) => request(app.getHttpServer()).get(url).set(auth(t));
  const corpos: string[] = [];
  const getOk = async (url: string) => {
    const r = await get(url);
    expect(r.status).toBe(200);
    corpos.push(JSON.stringify(r.body));
    return r.body;
  };

  const V = { m1Aprov: 73219, m1Pend: 31337, m2Aprov: 66043, m3Rej: 41117, m3Antigo: 5501, tec: 99991, orfao: 88881, auto: 77771 };
  type Ev = { chave: string; sub: string | null; valor: number; status: string; diasAtras: number; montese: boolean; dia?: string; noMes?: boolean };
  let evs: Ev[] = [];
  let hoje: string;

  const mkSub = async (tenantId: string | null, techUserId: string | null, status: string, tg: string) =>
    (
      await db.client.query(
        `INSERT INTO subscriptions (plan_id, tenant_id, technician_user_id, status, mercadopago_preapproval_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [plano.id, tenantId, techUserId, status, `fin3-${tg}-${sufixo}`],
      )
    ).rows[0].id as string;

  const somaPor = (lista: Ev[], f: (e: Ev) => boolean) => lista.filter(f).reduce((s, e) => s + e.valor, 0);

  let baseline: any;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue({ createPreapproval: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', 'Socio Fin Http');
    socioSem = await db.createUserWithRole('socio', 'Socio Sem Fin');
    admin = await db.createUserWithRole('admin', 'Admin Fin Http');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Fin Http');
    parceiro = await db.createUserWithRole('parceiro', 'Parc Fin Http');
    await db.grantSocioPermission(socio.userId, 'finance.read');
    await db.grantSocioPermission(socioSem.userId, 'clients.read');
    tSocio = await login(socio.email, socio.password);
    tSocioSem = await login(socioSem.email, socioSem.password);
    plano = (await db.client.query("SELECT id, price_cents, name FROM plans WHERE audience = 'empresa' ORDER BY slug LIMIT 1")).rows[0];

    baseline = await getOk('/atuacao/financeiro/resumo?dias=30');

    m1 = await db.createTenantWithUser(`Fin${tag} Um`);
    m2 = await db.createTenantWithUser(`Fin${tag} Dois`);
    m3 = await db.createTenantWithUser(`Fin${tag} Tres`);
    tTec = await db.createTenantWithUser(`Fin${tag} Tec`);
    tPar = await db.createTenantWithUser(`Fin${tag} Par`);
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tTec.tenantId, tec.rows[0].id]);
    const par = await db.client.query("INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul') RETURNING id", [parceiro.userId]);
    await db.client.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [tPar.tenantId, par.rows[0].id]);

    const sM1 = await mkSub(m1.tenantId, null, 'authorized', 'm1');
    const sM2 = await mkSub(m2.tenantId, null, 'cancelled', 'm2');
    const sM3 = await mkSub(m3.tenantId, null, 'authorized', 'm3');
    const sTec = await mkSub(tTec.tenantId, null, 'authorized', 'tec');
    const sPar = await mkSub(tPar.tenantId, null, 'authorized', 'par');
    const sAuto = await mkSub(null, tecnico.userId, 'authorized', 'auto');

    evs = [
      { chave: 'm1a', sub: sM1, valor: V.m1Aprov, status: 'approved', diasAtras: 0, montese: true },
      { chave: 'm1p', sub: sM1, valor: V.m1Pend, status: 'pending', diasAtras: 1, montese: true },
      { chave: 'm2a', sub: sM2, valor: V.m2Aprov, status: 'approved', diasAtras: 10, montese: true },
      { chave: 'm3r', sub: sM3, valor: V.m3Rej, status: 'rejected', diasAtras: 3, montese: true },
      { chave: 'm3o', sub: sM3, valor: V.m3Antigo, status: 'approved', diasAtras: 40, montese: true },
      { chave: 'tec', sub: sTec, valor: V.tec, status: 'approved', diasAtras: 0, montese: false },
      { chave: 'par', sub: sPar, valor: 55551, status: 'approved', diasAtras: 0, montese: false },
      { chave: 'orf', sub: null, valor: V.orfao, status: 'approved', diasAtras: 0, montese: false },
      { chave: 'aut', sub: sAuto, valor: V.auto, status: 'approved', diasAtras: 0, montese: false },
    ];
    for (const e of evs) {
      const r = await db.client.query(
        `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
         VALUES ($1, $2, $3, $4, now() - ($5::int * interval '1 day')) RETURNING id,
           to_char(occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia,
           (occurred_at AT TIME ZONE 'America/Sao_Paulo')::date >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date AS no_mes`,
        [e.sub, `fin3-evt-${e.chave}-${sufixo}`, e.valor, e.status, e.diasAtras],
      );
      e.dia = r.rows[0].dia;
      e.noMes = r.rows[0].no_mes;
    }
    hoje = (await db.client.query("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS d")).rows[0].d;
  });

  afterAll(async () => {
    await db.client.query('DELETE FROM payment_events WHERE mercadopago_payment_id LIKE $1', [`%${sufixo}`]);
    await db.client.query('DELETE FROM subscriptions WHERE mercadopago_preapproval_id LIKE $1', [`%${sufixo}`]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('resumo: bate EXATAMENTE (delta) com o seed Montese e ignora técnico, parceiro e órfão', async () => {
    const depois = await getOk('/atuacao/financeiro/resumo?dias=30');
    const mont = evs.filter((e) => e.montese);
    const d = (a: number, b: number) => a - b;
    expect(depois.periodo_dias).toBe(30);
    expect(d(depois.clientes.total, baseline.clientes.total)).toBe(3);
    expect(d(depois.clientes.ativos, baseline.clientes.ativos)).toBe(2);
    expect(d(depois.clientes.inativos, baseline.clientes.inativos)).toBe(1);
    expect(d(depois.clientes.trial, baseline.clientes.trial)).toBe(0);
    expect(d(depois.clientes.pendentes, baseline.clientes.pendentes)).toBe(0);
    expect(d(depois.clientes.com_pendencia, baseline.clientes.com_pendencia)).toBe(1);
    expect(d(depois.mrr_cents, baseline.mrr_cents)).toBe(2 * plano.price_cents);

    const hojeEv = (e: Ev) => e.dia === hoje;
    expect(d(depois.hoje.cobrado_cents, baseline.hoje.cobrado_cents)).toBe(somaPor(mont, hojeEv));
    expect(d(depois.hoje.aprovado_cents, baseline.hoje.aprovado_cents)).toBe(somaPor(mont, (e) => hojeEv(e) && e.status === 'approved'));
    expect(d(depois.hoje.pendente_cents, baseline.hoje.pendente_cents)).toBe(somaPor(mont, (e) => hojeEv(e) && e.status === 'pending'));
    expect(d(depois.mes.cobrado_cents, baseline.mes.cobrado_cents)).toBe(somaPor(mont, (e) => !!e.noMes));
    expect(d(depois.mes.aprovado_cents, baseline.mes.aprovado_cents)).toBe(somaPor(mont, (e) => !!e.noMes && e.status === 'approved'));
    expect(d(depois.mes.pendente_cents, baseline.mes.pendente_cents)).toBe(somaPor(mont, (e) => !!e.noMes && e.status === 'pending'));
    expect(d(depois.mes.recusado_cents, baseline.mes.recusado_cents)).toBe(somaPor(mont, (e) => !!e.noMes && e.status === 'rejected'));

    expect(depois.serie).toHaveLength(30);
    const base: Record<string, any> = Object.fromEntries(baseline.serie.map((s: any) => [s.data, s]));
    for (const s of depois.serie) {
      const b = base[s.data] ?? { cobrado_cents: 0, aprovado_cents: 0 };
      expect(s.cobrado_cents - b.cobrado_cents).toBe(somaPor(mont, (e) => e.dia === s.data));
      expect(s.aprovado_cents - b.aprovado_cents).toBe(somaPor(mont, (e) => e.dia === s.data && e.status === 'approved'));
    }
    // o evento de 40 dias atrás não está na série de 30 dias
    expect(depois.serie.some((s: any) => s.data === evs.find((e) => e.chave === 'm3o')!.dia)).toBe(false);
    // dias=7 e valor inválido
    const r7 = await getOk('/atuacao/financeiro/resumo?dias=7');
    expect(r7.periodo_dias).toBe(7);
    expect(r7.serie).toHaveLength(7);
    expect((await getOk('/atuacao/financeiro/resumo?dias=5')).periodo_dias).toBe(30);
  });

  it('lista: situação, pendência, dias de atraso e último pagamento corretos; técnico/parceiro fora', async () => {
    const lista = await getOk(`/atuacao/financeiro/clientes?q=Fin${tag}`);
    const porId: Record<string, any> = Object.fromEntries(lista.map((c: any) => [c.id, c]));
    expect(Object.keys(porId).sort()).toEqual([m1.tenantId, m2.tenantId, m3.tenantId].sort());
    const ev = (k: string) => evs.find((e) => e.chave === k)!;
    expect(porId[m1.tenantId]).toMatchObject({
      situacao: 'ativa', pendencia: false, dias_em_atraso: null, plano: plano.name, valor_mensal_cents: plano.price_cents,
      ultimo_pagamento: { data: ev('m1a').dia, status: 'approved', valor_cents: V.m1Aprov },
    });
    expect(porId[m2.tenantId]).toMatchObject({ situacao: 'inativa', pendencia: false, dias_em_atraso: null, valor_mensal_cents: null, plano: null });
    expect(porId[m2.tenantId].ultimo_pagamento).toEqual({ data: ev('m2a').dia, status: 'approved', valor_cents: V.m2Aprov });
    const diasEsperados = Math.round((Date.parse(hoje) - Date.parse(ev('m3r').dia!)) / 86400000);
    expect(diasEsperados).toBeGreaterThanOrEqual(3);
    expect(porId[m3.tenantId]).toMatchObject({
      situacao: 'ativa', pendencia: true, dias_em_atraso: diasEsperados,
      ultimo_pagamento: { data: ev('m3r').dia, status: 'rejected', valor_cents: V.m3Rej },
    });
    for (const c of lista) {
      expect(Object.keys(c).sort()).toEqual(
        ['dias_em_atraso', 'id', 'name', 'pendencia', 'plano', 'situacao', 'trade_name', 'ultimo_pagamento', 'valor_mensal_cents'].sort(),
      );
    }
  });

  it('filtros no SQL: situacao, pendencia=true, q com %, _ e \\ literais, situacao inválida => 400', async () => {
    const q = `q=Fin${tag}`;
    const ids = async (qs: string) => (await getOk(`/atuacao/financeiro/clientes?${qs}`)).map((c: any) => c.id).sort();
    expect(await ids(`${q}&situacao=ativa`)).toEqual([m1.tenantId, m3.tenantId].sort());
    expect(await ids(`${q}&situacao=inativa`)).toEqual([m2.tenantId]);
    expect(await ids(`${q}&situacao=trial`)).toEqual([]);
    expect(await ids(`${q}&pendencia=true`)).toEqual([m3.tenantId]);
    expect(await ids(`${q}&situacao=inativa&pendencia=true`)).toEqual([]);
    for (const coringa of ['%25', '_', '%5C', `Fin${tag}%25`, `Fin_${tag}`]) expect(await ids(`q=${coringa}`)).toEqual([]);
    expect(await ids(`q=fin${tag}%20um`)).toEqual([m1.tenantId]);
    expect((await get('/atuacao/financeiro/clientes?situacao=xyz')).status).toBe(400);
    expect((await get('/atuacao/financeiro/clientes?pendencia=false')).status).toBe(400);
  });

  it('pendência só considera assinaturas authorized; paused => inativa; pending recente => pendente', async () => {
    const p = `Fx${tag}`;
    const mk = async (nome: string) => (await db.createTenantWithUser(`${p} ${nome}`)).tenantId;
    const evento = async (sub: string, chave: string, status: string, dias: number, valor = 1000) =>
      db.client.query(
        `INSERT INTO payment_events (subscription_id, mercadopago_payment_id, amount_cents, status, occurred_at)
         VALUES ($1, $2, $3, $4, now() - ($5::int * interval '1 day'))`,
        [sub, `fin3-evt-${chave}-${sufixo}`, valor, status, dias],
      );
    // A: ativa em dia; assinatura antiga cancelada tem evento rejected MAIS NOVO => sem pendência
    const a = await mk('Aaa');
    await evento(await mkSub(a, null, 'authorized', 'fxa1'), 'fxa1', 'approved', 2);
    await evento(await mkSub(a, null, 'cancelled', 'fxa2'), 'fxa2', 'rejected', 0);
    // B: inverso — authorized com último rejected (há evento approved mais novo na cancelada) => pendência
    const b = await mk('Bbb');
    await evento(await mkSub(b, null, 'authorized', 'fxb1'), 'fxb1', 'rejected', 4);
    await evento(await mkSub(b, null, 'cancelled', 'fxb2'), 'fxb2', 'approved', 0);
    // C: paused => inativa, sem pendência (mesmo com rejected)
    const c = await mk('Ccc');
    await evento(await mkSub(c, null, 'paused', 'fxc1'), 'fxc1', 'rejected', 1);
    // D: checkout recente => pendente
    const d = await mk('Ddd');
    await mkSub(d, null, 'pending', 'fxd1');
    // E: ativa sem pagamento nas authorized (só a cancelada tem evento rejected) => sem pendência e sem último pagamento
    const e = await mk('Eee');
    await mkSub(e, null, 'authorized', 'fxe1');
    await evento(await mkSub(e, null, 'cancelled', 'fxe2'), 'fxe2', 'rejected', 0);

    const lista = await getOk(`/atuacao/financeiro/clientes?q=${p}`);
    const por: Record<string, any> = Object.fromEntries(lista.map((x: any) => [x.id, x]));
    const dia = async (dias: number) =>
      (await db.client.query("SELECT to_char((now() - ($1::int * interval '1 day')) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS d", [dias])).rows[0].d;
    expect(por[a]).toMatchObject({ situacao: 'ativa', pendencia: false, dias_em_atraso: null, ultimo_pagamento: { status: 'approved', data: await dia(2) } });
    expect(por[b]).toMatchObject({ situacao: 'ativa', pendencia: true, ultimo_pagamento: { status: 'rejected', data: await dia(4) } });
    expect(por[b].dias_em_atraso).toBeGreaterThanOrEqual(4);
    expect(por[c]).toMatchObject({ situacao: 'inativa', pendencia: false, dias_em_atraso: null });
    expect(por[d]).toMatchObject({ situacao: 'pendente', pendencia: false, ultimo_pagamento: null });
    expect(por[e]).toMatchObject({ situacao: 'ativa', pendencia: false, dias_em_atraso: null, ultimo_pagamento: null });
    expect((await getOk(`/atuacao/financeiro/clientes?q=${p}&pendencia=true`)).map((x: any) => x.id)).toEqual([b]);
    const fichaA = await getOk(`/atuacao/financeiro/clientes/${a}`);
    expect(fichaA.pendencia).toBe(false);
    expect(fichaA.pagamentos).toHaveLength(2); // histórico completo continua visível na ficha
  });

  it('ficha: assinaturas e pagamentos do cliente Montese; 24 últimos; sem mercadopago', async () => {
    const f = await getOk(`/atuacao/financeiro/clientes/${m3.tenantId}`);
    expect(f).toMatchObject({ id: m3.tenantId, situacao: 'ativa', pendencia: true });
    expect(f.assinaturas).toHaveLength(1);
    expect(f.assinaturas[0]).toMatchObject({ plano: plano.name, status: 'authorized', valor_mensal_cents: plano.price_cents });
    expect(Object.keys(f.assinaturas[0]).sort()).toEqual(['desde', 'plano', 'status', 'valor_mensal_cents']);
    expect(f.pagamentos.map((p: any) => [p.status, p.valor_cents])).toEqual([['rejected', V.m3Rej], ['approved', V.m3Antigo]]);
    expect(Object.keys(f.pagamentos[0]).sort()).toEqual(['data', 'status', 'valor_cents']);
  });

  it('ficha: tenant de técnico, de parceiro ou inexistente => 404 "Cliente não encontrado"; uuid inválido => 400', async () => {
    for (const id of [tPar.tenantId, tTec.tenantId, randomUUID()]) {
      const r = await get(`/atuacao/financeiro/clientes/${id}`);
      expect(r.status).toBe(404);
      expect(r.body.message).toBe('Cliente não encontrado');
    }
    expect((await get('/atuacao/financeiro/clientes/nao-e-uuid')).status).toBe(400);
  });

  it('autorização: sócio sem finance.read, empresa, técnico, parceiro e admin => 403 em todas as rotas', async () => {
    const tEmp = await login(m1.email, m1.password);
    const tTecn = await login(tecnico.email, tecnico.password);
    const tAdm = await login(admin.email, admin.password);
    const tPar2 = await login(parceiro.email, parceiro.password);
    for (const url of [...URLS, `/atuacao/financeiro/clientes/${m1.tenantId}`]) {
      for (const t of [tSocioSem, tEmp, tTecn, tAdm, tPar2]) {
        const r = await get(url, t);
        expect(r.status).toBe(403);
        expect(JSON.stringify(r.body)).not.toMatch(/mercadopago/i);
      }
      expect((await request(app.getHttpServer()).get(url)).status).toBe(401);
    }
  });

  it('escrita: POST/PATCH/PUT/DELETE em /atuacao/financeiro/* => 404 e nada muda', async () => {
    const conta = async () => (await db.client.query(
      `SELECT (SELECT count(*) FROM subscriptions WHERE mercadopago_preapproval_id LIKE $1)::int AS subs,
              (SELECT count(*) FROM payment_events WHERE mercadopago_payment_id LIKE $1)::int AS evs,
              (SELECT string_agg(status || amount_cents, ',' ORDER BY id) FROM payment_events WHERE mercadopago_payment_id LIKE $1) AS foto,
              (SELECT price_cents FROM plans WHERE id = $2) AS preco`,
      [`%${sufixo}`, plano.id],
    )).rows[0];
    const antes = await conta();
    for (const url of [...URLS, `/atuacao/financeiro/clientes/${m1.tenantId}`, '/atuacao/financeiro/pagamentos']) {
      for (const metodo of ['post', 'patch', 'put', 'delete'] as const) {
        const r = await (request(app.getHttpServer()) as any)[metodo](url).set(auth(tSocio)).send({ status: 'approved', amount_cents: 1, price_cents: 1 });
        expect(r.status).toBe(404);
      }
    }
    expect(await conta()).toEqual(antes);
  });

  it('nenhuma resposta contém "mercadopago" (varredura do JSON inteiro)', () => {
    expect(corpos.length).toBeGreaterThan(5);
    for (const c of corpos) expect(c.toLowerCase()).not.toContain('mercadopago');
    // sentinelas: ids do MP semeados não vazam
    for (const c of corpos) expect(c).not.toContain(`-${sufixo}`);
  });

  it('auditoria: finance.viewed por chamada, path sem query, sem valores monetários', async () => {
    await getOk(`/atuacao/financeiro/clientes/${m1.tenantId}?x=1`);
    let rows: any[] = [];
    for (let i = 0; i < 30; i++) {
      rows = (await db.client.query(
        "SELECT action, resource_type, resource_id, method, path, status_code, detail FROM audit_log WHERE actor_user_id = $1 AND action = 'finance.viewed' ORDER BY occurred_at",
        [socio.userId],
      )).rows;
      if (rows.length >= corpos.length) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // uma linha por chamada bem-sucedida de GET (as 404/400/403 não são "consulta" concluída, exceto 404 de ficha)
    expect(rows.length).toBeGreaterThanOrEqual(corpos.length);
    expect(rows.some((r) => r.path.endsWith('/atuacao/financeiro/resumo'))).toBe(true);
    const ficha = rows.find((r) => r.path.endsWith(`/clientes/${m1.tenantId}`));
    expect(ficha).toBeDefined();
    expect(ficha.method).toBe('GET');
    expect(ficha.resource_id).toBe(m1.tenantId);
    expect(ficha.detail).toContain(m1.tenantId);
    for (const r of rows) expect(r.path).not.toContain('?');
    const todas = (await db.client.query(
      'SELECT action, resource_type, method, path, detail FROM audit_log WHERE actor_user_id = $1', [socio.userId])).rows;
    const texto = JSON.stringify(todas).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'UUID');
    for (const v of Object.values(V)) expect(texto).not.toContain(String(v));
    expect(texto).not.toContain(String(plano.price_cents));
  });
});
