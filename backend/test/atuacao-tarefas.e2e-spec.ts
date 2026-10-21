import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { TestDb, TestUserFixture } from './db-test-helper';

// Painel de Atuação, Fase 3A, Task 1: RLS de tasks, task_events, tenant_owners e
// list_socios(). Conexão na role da aplicação (montese_app, sujeita a RLS),
// transação com set_config local, sempre com ROLLBACK. Asserções de dado
// leem pelo superusuário (db.client).
async function comoPapel<T>(
  role: string,
  userId: string,
  tenantId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true), set_config('app.role', $3, true)",
      [userId, tenantId, role],
    );
    const out = await fn(client);
    await client.query('ROLLBACK');
    return out;
  } finally {
    await client.end();
  }
}
const comoSocio = <T>(userId: string, fn: (c: Client) => Promise<T>) => comoPapel('socio', userId, '', fn);

describe('atuacao-tarefas — RLS de tasks/task_events/tenant_owners (e2e)', () => {
  let db: TestDb;
  let socio: TestUserFixture;
  let outroSocio: TestUserFixture;
  let socioInativo: TestUserFixture;
  let admin: TestUserFixture;
  let tecnicoUser: TestUserFixture;
  let parceiroUser: TestUserFixture;
  let montese: { tenantId: string; userId: string };
  let comTecnico: { tenantId: string };
  let taskMontese: string;
  let taskTecnico: string;
  let eventMontese: string;

  beforeAll(async () => {
    db = new TestDb();
    await db.connect();
    socio = await db.createUserWithRole('socio', 'Socio Tarefas');
    outroSocio = await db.createUserWithRole('socio', 'Outro Socio Tarefas');
    socioInativo = await db.createUserWithRole('socio', 'Socio Inativo Tarefas');
    await db.client.query("UPDATE users SET status = 'inativo' WHERE id = $1", [socioInativo.userId]);
    admin = await db.createUserWithRole('admin', 'Admin Tarefas');
    tecnicoUser = await db.createUserWithRole('tecnico', 'Tec Tarefas');
    parceiroUser = await db.createUserWithRole('parceiro', 'Parc Tarefas');
    montese = await db.createTenantWithUser('Cliente Montese Tarefas');
    comTecnico = await db.createTenantWithUser('Cliente Tecnico Tarefas');

    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnicoUser.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      comTecnico.tenantId,
      tec.rows[0].id,
    ]);

    const mkTask = async (tenantId: string, titulo: string) =>
      (
        await db.client.query(
          'INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id) VALUES ($1, $2, $3, $3) RETURNING id',
          [tenantId, titulo, socio.userId],
        )
      ).rows[0].id as string;
    taskMontese = await mkTask(montese.tenantId, 'Tarefa Montese');
    taskTecnico = await mkTask(comTecnico.tenantId, 'Tarefa Tecnico');
    eventMontese = (
      await db.client.query(
        "INSERT INTO task_events (task_id, tenant_id, actor_user_id, type) VALUES ($1, $2, $3, 'created') RETURNING id",
        [taskMontese, montese.tenantId, socio.userId],
      )
    ).rows[0].id;
    await db.client.query('INSERT INTO tenant_owners (tenant_id, user_id, assigned_by) VALUES ($1, $2, $3)', [
      montese.tenantId,
      socio.userId,
      admin.userId,
    ]);
    await db.client.query('INSERT INTO tenant_owners (tenant_id, user_id, assigned_by) VALUES ($1, $2, $3)', [
      comTecnico.tenantId,
      socio.userId,
      admin.userId,
    ]);
  });

  afterAll(async () => {
    // tasks.created_by/assignee referenciam users sem CASCADE: cleanup apaga tenants
    // (leva tasks/events/owners em cascata) antes dos users.
    await db.cleanup();
    await db.disconnect();
  });

  it('socio cria e lê tarefa em tenant Montese; não em tenant de técnico', async () => {
    const r = await comoSocio(socio.userId, async (c) => {
      const ins = await c.query(
        'INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id) VALUES ($1, $2, $3, $4) RETURNING id, title',
        [montese.tenantId, 'Criada pelo socio', socio.userId, outroSocio.userId],
      );
      const lidas = (await c.query('SELECT id FROM tasks WHERE id = ANY($1)', [[taskMontese, taskTecnico]])).rows.map(
        (x: any) => x.id,
      );
      const eventos = (await c.query('SELECT id FROM task_events')).rows.map((x: any) => x.id);
      const upd = await c.query("UPDATE tasks SET status = 'in_progress' WHERE id = $1", [taskMontese]);
      const updTec = await c.query("UPDATE tasks SET status = 'in_progress' WHERE id = $1", [taskTecnico]);
      const evIns = await c.query(
        "INSERT INTO task_events (task_id, tenant_id, actor_user_id, type) VALUES ($1, $2, $3, 'updated') RETURNING id",
        [taskMontese, montese.tenantId, socio.userId],
      );
      return { ins: ins.rows[0], lidas, eventos, upd: upd.rowCount, updTec: updTec.rowCount, evIns: evIns.rowCount };
    });
    expect(r.ins.title).toBe('Criada pelo socio');
    expect(r.lidas).toEqual([taskMontese]);
    expect(r.eventos).toContain(eventMontese);
    expect(r.upd).toBe(1);
    expect(r.updTec).toBe(0);
    expect(r.evIns).toBe(1);

    // INSERT em tenant de técnico é barrado pela RLS
    await expect(
      comoSocio(socio.userId, (c) =>
        c.query('INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id) VALUES ($1, $2, $3, $3)', [
          comTecnico.tenantId,
          'Invasora',
          socio.userId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      comoSocio(socio.userId, (c) =>
        c.query("INSERT INTO task_events (task_id, tenant_id, actor_user_id, type) VALUES ($1, $2, $3, 'created')", [
          taskTecnico,
          comTecnico.tenantId,
          socio.userId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);

    // ROLLBACK: nada persistiu
    const dados = await db.client.query('SELECT id, title, status FROM tasks WHERE tenant_id = ANY($1) ORDER BY title', [
      [montese.tenantId, comTecnico.tenantId],
    ]);
    expect(dados.rows.map((x: any) => x.title)).toEqual(['Tarefa Montese', 'Tarefa Tecnico']);
    expect(dados.rows.every((x: any) => x.status === 'pending')).toBe(true);
    const ev = await db.client.query('SELECT count(*)::int AS n FROM task_events WHERE tenant_id = ANY($1)', [
      [montese.tenantId, comTecnico.tenantId],
    ]);
    expect(ev.rows[0].n).toBe(1);
  });

  it('socio não faz DELETE em tasks nem UPDATE/DELETE em task_events (append-only)', async () => {
    const r = await comoSocio(socio.userId, async (c) => ({
      delTask: (await c.query('DELETE FROM tasks WHERE id = $1', [taskMontese])).rowCount,
      updEv: (await c.query("UPDATE task_events SET note = 'adulterado' WHERE id = $1", [eventMontese])).rowCount,
      delEv: (await c.query('DELETE FROM task_events WHERE id = $1', [eventMontese])).rowCount,
    }));
    expect(r.delTask).toBe(0);
    expect(r.updEv).toBe(0);
    expect(r.delEv).toBe(0);
    const t = await db.client.query('SELECT title FROM tasks WHERE id = $1', [taskMontese]);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0].title).toBe('Tarefa Montese');
    const e = await db.client.query('SELECT id, note, type FROM task_events WHERE id = $1', [eventMontese]);
    expect(e.rows).toHaveLength(1);
    expect(e.rows[0].note).toBeNull();
    expect(e.rows[0].type).toBe('created');
  });

  it('admin lê/escreve tasks, lê task_events e também não altera nem apaga eventos (append-only)', async () => {
    const r = await comoPapel('admin', admin.userId, '', async (c) => ({
      lidas: (await c.query('SELECT id FROM tasks WHERE id = ANY($1)', [[taskMontese, taskTecnico]])).rows.length,
      ev: (await c.query('SELECT id FROM task_events WHERE id = $1', [eventMontese])).rows.length,
      updEv: (await c.query("UPDATE task_events SET note = 'x' WHERE id = $1", [eventMontese])).rowCount,
      delEv: (await c.query('DELETE FROM task_events WHERE id = $1', [eventMontese])).rowCount,
    }));
    expect(r.lidas).toBe(2);
    expect(r.ev).toBe(1);
    expect(r.updEv).toBe(0);
    expect(r.delEv).toBe(0);
    const e = await db.client.query('SELECT note FROM task_events WHERE id = $1', [eventMontese]);
    expect(e.rows[0].note).toBeNull();
  });

  it('socio não consegue INSERT de tarefa com created_by de outro usuário', async () => {
    await expect(
      comoSocio(socio.userId, (c) =>
        c.query('INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id) VALUES ($1, $2, $3, $3)', [
          montese.tenantId,
          'Falsa autoria',
          outroSocio.userId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      comoSocio(socio.userId, (c) =>
        c.query("INSERT INTO task_events (task_id, tenant_id, actor_user_id, type) VALUES ($1, $2, $3, 'updated')", [
          taskMontese,
          montese.tenantId,
          outroSocio.userId,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
    const t = await db.client.query("SELECT count(*)::int AS n FROM tasks WHERE title = 'Falsa autoria'");
    expect(t.rows[0].n).toBe(0);
    const e = await db.client.query('SELECT count(*)::int AS n FROM task_events WHERE actor_user_id = $1', [
      outroSocio.userId,
    ]);
    expect(e.rows[0].n).toBe(0);
  });

  it('empresa, técnico e parceiro não leem tasks/task_events/tenant_owners (0 linhas) nem escrevem', async () => {
    const empresaUser = montese.userId;
    const atores: Array<[string, string, string]> = [
      ['empresa', empresaUser, montese.tenantId],
      ['tecnico', tecnicoUser.userId, comTecnico.tenantId],
      ['parceiro', parceiroUser.userId, ''],
    ];
    for (const [role, uid, tid] of atores) {
      const r = await comoPapel(role, uid, tid, async (c) => ({
        tasks: (await c.query('SELECT id FROM tasks')).rowCount,
        events: (await c.query('SELECT id FROM task_events')).rowCount,
        owners: (await c.query('SELECT tenant_id FROM tenant_owners')).rowCount,
        upd: (await c.query("UPDATE tasks SET title = 'hack'")).rowCount,
        del: (await c.query('DELETE FROM tenant_owners')).rowCount,
      }));
      expect({ role, ...r }).toEqual({ role, tasks: 0, events: 0, owners: 0, upd: 0, del: 0 });
      await expect(
        comoPapel(role, uid, tid, (c) =>
          c.query('INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id) VALUES ($1, $2, $3, $3)', [
            tid || montese.tenantId,
            'Intrusa',
            uid,
          ]),
        ),
      ).rejects.toThrow(/row-level security|permission denied/i);
    }
    const t = await db.client.query('SELECT title FROM tasks WHERE tenant_id = ANY($1) ORDER BY title', [
      [montese.tenantId, comTecnico.tenantId],
    ]);
    expect(t.rows.map((x: any) => x.title)).toEqual(['Tarefa Montese', 'Tarefa Tecnico']);
    const o = await db.client.query('SELECT count(*)::int AS n FROM tenant_owners WHERE tenant_id = ANY($1)', [
      [montese.tenantId, comTecnico.tenantId],
    ]);
    expect(o.rows[0].n).toBe(2);
  });

  it('socio lê tenant_owners de Montese e NÃO escreve nela; admin escreve', async () => {
    const r = await comoSocio(socio.userId, async (c) => ({
      lidos: (await c.query('SELECT tenant_id FROM tenant_owners WHERE tenant_id = ANY($1)', [
        [montese.tenantId, comTecnico.tenantId],
      ])).rows.map((x: any) => x.tenant_id),
      upd: (await c.query('UPDATE tenant_owners SET assigned_by = NULL WHERE tenant_id = $1', [montese.tenantId])).rowCount,
      del: (await c.query('DELETE FROM tenant_owners WHERE tenant_id = $1', [montese.tenantId])).rowCount,
    }));
    expect(r.lidos).toEqual([montese.tenantId]);
    expect(r.upd).toBe(0);
    expect(r.del).toBe(0);
    await expect(
      comoSocio(socio.userId, (c) =>
        c.query('INSERT INTO tenant_owners (tenant_id, user_id) VALUES ($1, $2)', [montese.tenantId, outroSocio.userId]),
      ),
    ).rejects.toThrow(/row-level security/i);
    const intacto = await db.client.query('SELECT user_id, assigned_by FROM tenant_owners WHERE tenant_id = $1', [
      montese.tenantId,
    ]);
    expect(intacto.rows).toEqual([{ user_id: socio.userId, assigned_by: admin.userId }]);

    // admin escreve (ROLLBACK ao final; checa dentro da própria transação)
    const adm = await comoPapel('admin', admin.userId, '', async (c) => {
      const ins = await c.query('INSERT INTO tenant_owners (tenant_id, user_id, assigned_by) VALUES ($1, $2, $3)', [
        montese.tenantId,
        outroSocio.userId,
        admin.userId,
      ]);
      const del = await c.query('DELETE FROM tenant_owners WHERE tenant_id = $1 AND user_id = $2', [
        montese.tenantId,
        socio.userId,
      ]);
      const restam = (await c.query('SELECT user_id FROM tenant_owners WHERE tenant_id = $1', [montese.tenantId])).rows.map(
        (x: any) => x.user_id,
      );
      return { ins: ins.rowCount, del: del.rowCount, restam };
    });
    expect(adm.ins).toBe(1);
    expect(adm.del).toBe(1);
    expect(adm.restam).toEqual([outroSocio.userId]);
    const final = await db.client.query('SELECT user_id FROM tenant_owners WHERE tenant_id = $1', [montese.tenantId]);
    expect(final.rows.map((x: any) => x.user_id)).toEqual([socio.userId]); // rollback: intacto
  });

  it('list_socios() devolve só socios ativos para socio/admin e vazio para empresa/técnico', async () => {
    const esperado = (
      await db.client.query("SELECT id, full_name FROM users WHERE role = 'socio' AND status = 'ativo' ORDER BY full_name")
    ).rows;
    expect(esperado.map((x: any) => x.id)).toEqual(expect.arrayContaining([socio.userId, outroSocio.userId]));
    expect(esperado.map((x: any) => x.id)).not.toContain(socioInativo.userId);

    const comoSocioLista = await comoSocio(socio.userId, async (c) => (await c.query('SELECT id, full_name FROM list_socios()')).rows);
    expect(comoSocioLista).toEqual(esperado);
    const comoAdmin = await comoPapel('admin', admin.userId, '', async (c) => (await c.query('SELECT id, full_name FROM list_socios()')).rows);
    expect(comoAdmin).toEqual(esperado);

    for (const [role, uid, tid] of [
      ['empresa', montese.userId, montese.tenantId],
      ['tecnico', tecnicoUser.userId, comTecnico.tenantId],
      ['parceiro', parceiroUser.userId, ''],
    ] as Array<[string, string, string]>) {
      const rows = await comoPapel(role, uid, tid, async (c) => (await c.query('SELECT id FROM list_socios()')).rows);
      expect({ role, rows }).toEqual({ role, rows: [] });
    }
  });

  it('list_socios() tem dono montese_auth_bypass com BYPASSRLS', async () => {
    const r = await db.client.query(
      `SELECT r.rolname, r.rolbypassrls, p.prosecdef
         FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.proname = 'list_socios'`,
    );
    expect(r.rows).toEqual([{ rolname: 'montese_auth_bypass', rolbypassrls: true, prosecdef: true }]);
    const priv = await db.client.query(
      `SELECT has_function_privilege('montese_app', 'list_socios()', 'EXECUTE') AS app,
              has_function_privilege('public', 'list_socios()', 'EXECUTE') AS pub`,
    );
    expect(priv.rows[0]).toEqual({ app: true, pub: false });
  });

  it('montese_app com set_config de empresa/técnico/parceiro lê 0 linhas das 3 tabelas (conexão própria)', async () => {
    // Redundante de propósito com o caso acima: confirma por contagem global, não por id.
    for (const [role, uid, tid] of [
      ['empresa', montese.userId, montese.tenantId],
      ['tecnico', tecnicoUser.userId, comTecnico.tenantId],
      ['parceiro', parceiroUser.userId, ''],
    ] as Array<[string, string, string]>) {
      const n = await comoPapel(role, uid, tid, async (c) => {
        const q = async (t: string) => (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
        return [await q('tasks'), await q('task_events'), await q('tenant_owners')];
      });
      expect({ role, n }).toEqual({ role, n: [0, 0, 0] });
    }
    const real = await db.client.query(
      'SELECT (SELECT count(*) FROM tasks)::int AS t, (SELECT count(*) FROM task_events)::int AS e, (SELECT count(*) FROM tenant_owners)::int AS o',
    );
    expect(real.rows[0].t).toBeGreaterThanOrEqual(2);
    expect(real.rows[0].e).toBeGreaterThanOrEqual(1);
    expect(real.rows[0].o).toBeGreaterThanOrEqual(2);
  });
});

// Task 3: HTTP de /atuacao/tarefas (criar, atribuir, fluxo de status, resumo, auditoria).
describe('atuacao-tarefas — HTTP (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let socioA: TestUserFixture; // cria
  let socioB: TestUserFixture; // responsável
  let soLeitura: TestUserFixture; // só tasks.read
  let semPerm: TestUserFixture; // nenhuma permissão
  let resumoSocio: TestUserFixture; // dados de data controlados
  let admin: TestUserFixture;
  let tecnicoUser: TestUserFixture;
  let montese: { tenantId: string; email: string; password: string };
  let parceiro: { tenantId: string };
  let tA: string;
  let tB: string;
  let tRO: string;
  let tSem: string;
  let tResumo: string;

  const login = async (email: string, password: string): Promise<string> =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const http = () => request(app.getHttpServer());
  const contaTarefas = async () =>
    (await db.client.query('SELECT count(*)::int AS n FROM tasks WHERE tenant_id = ANY($1)', [[montese.tenantId, parceiro.tenantId]]))
      .rows[0].n as number;
  const criar = (t: string, body: any) => http().post('/atuacao/tarefas').set(auth(t)).send(body);
  const status = (t: string, id: string, body: any) => http().post(`/atuacao/tarefas/${id}/status`).set(auth(t)).send(body);
  const linha = async (id: string) =>
    (await db.client.query('SELECT status, completed_at, created_by, assignee_user_id FROM tasks WHERE id = $1', [id])).rows[0];

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue({ createPreapproval: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    db = new TestDb();
    await db.connect();
    socioA = await db.createUserWithRole('socio', 'Socio Tar A');
    socioB = await db.createUserWithRole('socio', 'Socio Tar B');
    soLeitura = await db.createUserWithRole('socio', 'Socio Tar Leitura');
    semPerm = await db.createUserWithRole('socio', 'Socio Tar SemPerm');
    resumoSocio = await db.createUserWithRole('socio', 'Socio Tar Resumo');
    admin = await db.createUserWithRole('admin', 'Admin Tar Http');
    const tecnicoUser2 = await db.createUserWithRole('tecnico', 'Tec Tar Http');
    tecnicoUser = tecnicoUser2;
    montese = await db.createTenantWithUser('Cliente Montese Tar Http');
    parceiro = await db.createTenantWithUser('Cliente Parceiro Tar Http');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnicoUser.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      parceiro.tenantId,
      tec.rows[0].id,
    ]);
    for (const u of [socioA, socioB, resumoSocio]) {
      await db.grantSocioPermission(u.userId, 'tasks.read');
      await db.grantSocioPermission(u.userId, 'tasks.write');
    }
    await db.grantSocioPermission(soLeitura.userId, 'tasks.read');
    tA = await login(socioA.email, socioA.password);
    tB = await login(socioB.email, socioB.password);
    tRO = await login(soLeitura.email, soLeitura.password);
    tSem = await login(semPerm.email, semPerm.password);
    tResumo = await login(resumoSocio.email, resumoSocio.password);
  });

  afterAll(async () => {
    const ids = [socioA, socioB, soLeitura, semPerm, resumoSocio].map((u) => u.userId);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [ids]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('criar tarefa para outro socio; ele a vê em assignee=me; o criador também a vê na lista geral', async () => {
    const r = await criar(tA, { tenant_id: montese.tenantId, title: 'Visita de rotina', assignee_user_id: socioB.userId, priority: 'alta' });
    expect(r.status).toBe(201);
    expect(r.body.created_by_name).toBe('Socio Tar A');
    expect(r.body.assignee_name).toBe('Socio Tar B');
    expect(r.body.tenant_name).toContain('Cliente Montese Tar Http');
    expect(r.body.status).toBe('pending');
    expect(r.body.eventos).toHaveLength(1);
    expect(r.body.eventos[0]).toMatchObject({ type: 'created', actor_name: 'Socio Tar A', to_value: 'pending' });
    expect((await linha(r.body.id)).created_by).toBe(socioA.userId);

    const meB = await http().get('/atuacao/tarefas?assignee=me').set(auth(tB));
    expect(meB.status).toBe(200);
    expect(meB.body.map((x: any) => x.id)).toContain(r.body.id);
    const meA = await http().get('/atuacao/tarefas?assignee=me').set(auth(tA));
    expect(meA.body.map((x: any) => x.id)).not.toContain(r.body.id);
    const geralA = await http().get('/atuacao/tarefas').set(auth(tA));
    expect(geralA.body.map((x: any) => x.id)).toContain(r.body.id);
    const porTenant = await http().get(`/atuacao/tarefas?tenantId=${montese.tenantId}&status=pending`).set(auth(tA));
    expect(porTenant.body.every((x: any) => x.tenant_id === montese.tenantId && x.status === 'pending')).toBe(true);
    const detalhe = await http().get(`/atuacao/tarefas/${r.body.id}`).set(auth(tB));
    expect(detalhe.status).toBe(200);
    expect(detalhe.body.title).toBe('Visita de rotina');
    expect((await http().get('/atuacao/tarefas/nao-uuid').set(auth(tA))).status).toBe(400);
    expect((await http().get('/atuacao/tarefas?foo=1').set(auth(tA))).status).toBe(400);
    expect((await http().get('/atuacao/tarefas?assignee=x').set(auth(tA))).status).toBe(400);
  });

  it('sem tasks.write => 403 e nada é criado; sem tasks.read => 403', async () => {
    const antes = await contaTarefas();
    const corpo = { tenant_id: montese.tenantId, title: 'Nao deve', assignee_user_id: socioB.userId };
    expect((await criar(tRO, corpo)).status).toBe(403);
    expect((await criar(tSem, corpo)).status).toBe(403);
    expect(await contaTarefas()).toBe(antes);
    expect((await http().get('/atuacao/tarefas').set(auth(tSem))).status).toBe(403);
    expect((await http().get('/atuacao/tarefas/resumo').set(auth(tSem))).status).toBe(403);
    expect((await http().get('/atuacao/tarefas').set(auth(tRO))).status).toBe(200);
  });

  it('tenant de técnico => 404; assignee que não é socio => 400; created_by sempre do JWT (corpo com created_by => 400)', async () => {
    const antes = await contaTarefas();
    const tec = await criar(tA, { tenant_id: parceiro.tenantId, title: 'Invasao', assignee_user_id: socioB.userId });
    expect(tec.status).toBe(404);
    const naoSocio = await criar(tA, { tenant_id: montese.tenantId, title: 'Resp invalido', assignee_user_id: admin.userId });
    expect(naoSocio.status).toBe(400);
    expect(JSON.stringify(naoSocio.body)).toContain('Responsável inválido');
    const forjada = await criar(tA, {
      tenant_id: montese.tenantId, title: 'Autoria forjada', assignee_user_id: socioB.userId, created_by: socioB.userId,
    });
    expect(forjada.status).toBe(400);
    expect(await contaTarefas()).toBe(antes);
  });

  it('fluxo: pending -> in_progress -> blocked (sem nota 400; com nota 200) -> in_progress -> awaiting_review -> completed; histórico tem 1 evento por passo, em ordem, com ator correto', async () => {
    const t = await criar(tA, { tenant_id: montese.tenantId, title: 'Fluxo completo', assignee_user_id: socioB.userId });
    const id = t.body.id;
    expect((await status(tB, id, { status: 'in_progress' })).status).toBe(201);
    expect((await status(tA, id, { status: 'blocked' })).status).toBe(400);
    expect((await linha(id)).status).toBe('in_progress');
    expect((await status(tA, id, { status: 'blocked', note: 'Aguardando cliente' })).status).toBe(201);
    expect((await status(tB, id, { status: 'in_progress' })).status).toBe(201);
    expect((await status(tA, id, { status: 'awaiting_review' })).status).toBe(201);
    const fim = await status(tB, id, { status: 'completed' });
    expect(fim.status).toBe(201);
    expect(fim.body.status).toBe('completed');
    expect((await linha(id)).completed_at).not.toBeNull();
    const ev = fim.body.eventos;
    expect(ev.map((e: any) => [e.type, e.from_value, e.to_value, e.actor_name])).toEqual([
      ['created', null, 'pending', 'Socio Tar A'],
      ['status_changed', 'pending', 'in_progress', 'Socio Tar B'],
      ['status_changed', 'in_progress', 'blocked', 'Socio Tar A'],
      ['status_changed', 'blocked', 'in_progress', 'Socio Tar B'],
      ['status_changed', 'in_progress', 'awaiting_review', 'Socio Tar A'],
      ['status_changed', 'awaiting_review', 'completed', 'Socio Tar B'],
    ]);
    expect(ev[2].note).toBe('Aguardando cliente');
  });

  it('transição inválida (pending -> completed) => 400 e status inalterado no banco', async () => {
    const t = await criar(tA, { tenant_id: montese.tenantId, title: 'Transicao ruim', assignee_user_id: socioA.userId });
    const r = await status(tA, t.body.id, { status: 'completed' });
    expect(r.status).toBe(400);
    expect((await linha(t.body.id)).status).toBe('pending');
    expect((await status(tA, t.body.id, { status: 'inexistente' })).status).toBe(400);
    const ev = await db.client.query('SELECT count(*)::int AS n FROM task_events WHERE task_id = $1', [t.body.id]);
    expect(ev.rows[0].n).toBe(1);
  });

  it('reabrir completed limpa completed_at', async () => {
    const t = await criar(tA, { tenant_id: montese.tenantId, title: 'Reabrir', assignee_user_id: socioA.userId });
    const id = t.body.id;
    await status(tA, id, { status: 'in_progress' });
    await status(tA, id, { status: 'completed' });
    expect((await linha(id)).completed_at).not.toBeNull();
    const re = await status(tA, id, { status: 'in_progress' });
    expect(re.status).toBe(201);
    const l = await linha(id);
    expect(l.status).toBe('in_progress');
    expect(l.completed_at).toBeNull();
  });

  it('PATCH: reatribui (evento assigned), atualiza campos (evento updated sem valores) e ignora string vazia', async () => {
    const t = await criar(tA, {
      tenant_id: montese.tenantId, title: 'Editar', description: 'Descricao original', assignee_user_id: socioA.userId,
    });
    const id = t.body.id;
    const p = await http().patch(`/atuacao/tarefas/${id}`).set(auth(tA)).send({ assignee_user_id: socioB.userId, priority: 'urgente', description: '' });
    expect(p.status).toBe(200);
    expect(p.body.assignee_user_id).toBe(socioB.userId);
    expect(p.body.priority).toBe('urgente');
    expect(p.body.description).toBe('Descricao original');
    const tipos = p.body.eventos.map((e: any) => e.type);
    expect(tipos).toEqual(['created', 'assigned', 'updated']);
    expect(p.body.eventos[1]).toMatchObject({ from_value: socioA.userId, to_value: socioB.userId });
    expect(p.body.eventos[2].to_value).toBe('priority');
    for (const proibido of [{ title: '' }, { status: 'completed' }, { created_by: socioB.userId }, { tenant_id: parceiro.tenantId }, { assignee_user_id: admin.userId }]) {
      const r = await http().patch(`/atuacao/tarefas/${id}`).set(auth(tA)).send(proibido);
      expect(r.status).toBe(400);
    }
    expect((await linha(id)).status).toBe('pending');
    expect((await http().patch(`/atuacao/tarefas/${id}`).set(auth(tRO)).send({ priority: 'baixa' })).status).toBe(403);
    expect((await http().patch(`/atuacao/tarefas/00000000-0000-4000-8000-000000000000`).set(auth(tA)).send({ priority: 'baixa' })).status).toBe(404);
  });

  it('PATCH com null => 400 e a tarefa permanece intacta (sem evento updated novo)', async () => {
    const t = await criar(tA, { tenant_id: montese.tenantId, title: 'Intacta', description: 'Desc', category: 'Cat', due_date: '2030-01-15', assignee_user_id: socioA.userId });
    const id = t.body.id;
    const snap = async () => (await db.client.query('SELECT title, description, category, due_date::text AS due_date, priority, assignee_user_id FROM tasks WHERE id = $1', [id])).rows[0];
    const antes = await snap();
    for (const corpo of [{ title: null }, { priority: null }, { assignee_user_id: null }, { description: null }, { category: null }, { due_date: null }]) {
      expect((await http().patch(`/atuacao/tarefas/${id}`).set(auth(tA)).send(corpo)).status).toBe(400);
    }
    expect(await snap()).toEqual(antes);
    const ev = await db.client.query('SELECT count(*)::int AS n FROM task_events WHERE task_id = $1', [id]);
    expect(ev.rows[0].n).toBe(1);
  });

  it('datas: 2026-02-30 => 400; 2026-02-28 => 201/200; datetime ISO => 400; título só com espaços => 400', async () => {
    const base = { tenant_id: montese.tenantId, assignee_user_id: socioA.userId };
    const antes = await contaTarefas();
    expect((await criar(tA, { ...base, title: 'D1', due_date: '2026-02-30' })).status).toBe(400);
    expect((await criar(tA, { ...base, title: 'D2', due_date: '2026-02-28T10:00:00Z' })).status).toBe(400);
    expect((await criar(tA, { ...base, title: '   ' })).status).toBe(400);
    expect(await contaTarefas()).toBe(antes);
    const ok = await criar(tA, { ...base, title: '  D3  ', due_date: '2026-02-28' });
    expect(ok.status).toBe(201);
    expect(ok.body.title).toBe('D3');
    expect(ok.body.due_date).toBe('2026-02-28');
    const p = await http().patch(`/atuacao/tarefas/${ok.body.id}`).set(auth(tA)).send({ due_date: '2026-03-01' });
    expect(p.status).toBe(200);
    expect(p.body.due_date).toBe('2026-03-01');
    expect((await http().patch(`/atuacao/tarefas/${ok.body.id}`).set(auth(tA)).send({ due_date: '2026-02-30' })).status).toBe(400);
    expect((await http().patch(`/atuacao/tarefas/${ok.body.id}`).set(auth(tA)).send({ title: '   ' })).status).toBe(400);
  });

  it('resumo bate com a contagem real (abertas, vencidas, hoje, bloqueadas) com datas controladas', async () => {
    const hoje: string = (await db.client.query("SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::text AS d")).rows[0].d;
    const mk = async (titulo: string, st: string, dueSql: string) =>
      (
        await db.client.query(
          `INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id, status, due_date)
           VALUES ($1, $2, $3, $3, $4, ${dueSql}) RETURNING id`,
          [montese.tenantId, titulo, resumoSocio.userId, st],
        )
      ).rows[0].id as string;
    const dH = "((now() AT TIME ZONE 'America/Sao_Paulo')::date)";
    const vencidaId = await mk('R vencida', 'pending', `${dH} - 3`);
    await mk('R hoje', 'in_progress', dH);
    await mk('R bloqueada futura', 'blocked', `${dH} + 5`);
    await mk('R concluida passada', 'completed', `${dH} - 10`);
    await mk('R cancelada passada', 'cancelled', `${dH} - 10`);
    await mk('R sem data', 'pending', 'NULL');
    // tarefa de outro responsável não entra no resumo
    await db.client.query(
      "INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id, due_date) VALUES ($1, 'R alheia', $2, $2, $3::date - 1)",
      [montese.tenantId, socioA.userId, hoje],
    );
    const r = await http().get('/atuacao/tarefas/resumo').set(auth(tResumo));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ abertas: 4, vencidas: 1, hoje: 1, bloqueadas: 1 });

    const venc = await http().get('/atuacao/tarefas?assignee=me&vencidas=true').set(auth(tResumo));
    expect(venc.body.map((x: any) => x.id)).toEqual([vencidaId]);
    expect(venc.body[0].vencida).toBe(true);
    const todas = await http().get('/atuacao/tarefas?assignee=me').set(auth(tResumo));
    expect(todas.body).toHaveLength(6);
    expect(todas.body.filter((x: any) => x.vencida)).toHaveLength(1);
    // abertas primeiro
    const ordem = todas.body.map((x: any) => x.status);
    expect(ordem.slice(0, 4).every((s: string) => ['pending', 'in_progress', 'blocked'].includes(s))).toBe(true);
    expect(ordem.slice(4).sort()).toEqual(['cancelled', 'completed']);
  });

  it('empresa, técnico e admin => 403 em /atuacao/tarefas*', async () => {
    const tokens = [
      await login(montese.email, montese.password),
      await login(tecnicoUser.email, tecnicoUser.password),
      await login(admin.email, admin.password),
    ];
    const antes = await contaTarefas();
    const alvo = '00000000-0000-4000-8000-000000000000';
    for (const t of tokens) {
      for (const path of ['/atuacao/tarefas', '/atuacao/tarefas/resumo', `/atuacao/tarefas/${alvo}`]) {
        expect((await http().get(path).set(auth(t))).status).toBe(403);
      }
      expect((await criar(t, { tenant_id: montese.tenantId, title: 'X', assignee_user_id: socioA.userId })).status).toBe(403);
      expect((await http().patch(`/atuacao/tarefas/${alvo}`).set(auth(t)).send({ priority: 'baixa' })).status).toBe(403);
      expect((await status(t, alvo, { status: 'in_progress' })).status).toBe(403);
    }
    expect(await contaTarefas()).toBe(antes);
  });

  it('auditoria task.created/task.reassigned/task.completed existe e não contém título nem descrição', async () => {
    const titulo = 'TituloSecretoAud123';
    const descr = 'DescricaoSecretaAud456';
    const t = await criar(tA, { tenant_id: montese.tenantId, title: titulo, description: descr, assignee_user_id: socioA.userId });
    const id = t.body.id;
    await http().patch(`/atuacao/tarefas/${id}`).set(auth(tA)).send({ assignee_user_id: socioB.userId, title: `${titulo}2` });
    await status(tB, id, { status: 'in_progress', note: 'NotaSecretaAud789' });
    await status(tB, id, { status: 'completed', note: 'NotaSecretaAud789' });
    const a = await db.client.query(
      'SELECT action, detail, actor_user_id, resource_id FROM audit_log WHERE resource_id = $1 AND action LIKE $2 ORDER BY occurred_at',
      [id, 'task.%'],
    );
    expect(a.rows.map((x: any) => x.action).sort()).toEqual(['task.completed', 'task.created', 'task.reassigned']);
    expect(a.rows.find((x: any) => x.action === 'task.completed').actor_user_id).toBe(socioB.userId);
    for (const row of a.rows) {
      const txt = JSON.stringify(row);
      expect(txt).not.toContain('Secreta');
      expect(txt).not.toContain('SecretoAud');
    }
  });
});

// Task 4: equipe e responsáveis por cliente.
describe('atuacao-tarefas — equipe e responsáveis (HTTP e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let socioA: TestUserFixture;
  let socioB: TestUserFixture;
  let socioC: TestUserFixture;
  let socioInativo: TestUserFixture;
  let admin: TestUserFixture;
  let tecnicoUser: TestUserFixture;
  let montese: { tenantId: string; email: string; password: string };
  let montese2: { tenantId: string };
  let parceiro: { tenantId: string };
  let tA: string;
  let tAdmin: string;

  const login = async (email: string, password: string): Promise<string> =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const http = () => request(app.getHttpServer());
  const put = (t: string, tenantId: string, body: any) =>
    http().put(`/atuacao/admin/clientes/${tenantId}/responsaveis`).set(auth(t)).send(body);
  const donos = async (tenantId: string): Promise<string[]> =>
    (await db.client.query('SELECT user_id FROM tenant_owners WHERE tenant_id = $1 ORDER BY user_id', [tenantId])).rows
      .map((r: any) => r.user_id as string)
      .sort();

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || 'b'.repeat(64);
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'fake-client-id-for-e2e';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'fake-client-secret-for-e2e';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService)
      .useValue({ createPreapproval: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    db = new TestDb();
    await db.connect();
    socioA = await db.createUserWithRole('socio', 'Socio Eq A');
    socioB = await db.createUserWithRole('socio', 'Socio Eq B');
    socioC = await db.createUserWithRole('socio', 'Socio Eq C');
    socioInativo = await db.createUserWithRole('socio', 'Socio Eq Inativo');
    await db.client.query("UPDATE users SET status = 'inativo' WHERE id = $1", [socioInativo.userId]);
    admin = await db.createUserWithRole('admin', 'Admin Eq');
    tecnicoUser = await db.createUserWithRole('tecnico', 'Tec Eq');
    montese = await db.createTenantWithUser('Cliente Montese Eq');
    montese2 = await db.createTenantWithUser('Cliente Montese Eq2');
    parceiro = await db.createTenantWithUser('Cliente Parceiro Eq');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnicoUser.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [
      parceiro.tenantId,
      tec.rows[0].id,
    ]);
    for (const u of [socioA, socioB, socioC]) {
      await db.grantSocioPermission(u.userId, 'tasks.read');
      await db.grantSocioPermission(u.userId, 'clients.read');
    }
    tA = await login(socioA.email, socioA.password);
    tAdmin = await login(admin.email, admin.password);
  });

  afterAll(async () => {
    const ids = [socioA, socioB, socioC, socioInativo, admin].map((u) => u.userId);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [ids]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('GET /atuacao/equipe devolve só sócios ativos {id, full_name}; empresa/técnico/admin => 403', async () => {
    const r = await http().get('/atuacao/equipe').set(auth(tA));
    expect(r.status).toBe(200);
    const ids = r.body.map((x: any) => x.id);
    expect(ids).toEqual(expect.arrayContaining([socioA.userId, socioB.userId, socioC.userId]));
    expect(ids).not.toContain(socioInativo.userId);
    expect(ids).not.toContain(admin.userId);
    for (const x of r.body) expect(Object.keys(x).sort()).toEqual(['full_name', 'id']);
    for (const t of [await login(montese.email, montese.password), await login(tecnicoUser.email, tecnicoUser.password), tAdmin]) {
      expect((await http().get('/atuacao/equipe').set(auth(t))).status).toBe(403);
    }
  });

  it('PUT por admin troca o conjunto inteiro, a ficha traz responsaveis e audita só ids', async () => {
    const r1 = await put(tAdmin, montese.tenantId, { user_ids: [socioA.userId, socioB.userId] });
    expect(r1.status).toBe(200);
    expect(r1.body.tenant_id).toBe(montese.tenantId);
    expect(r1.body.responsaveis.map((x: any) => x.id).sort()).toEqual([socioA.userId, socioB.userId].sort());
    expect(await donos(montese.tenantId)).toEqual([socioA.userId, socioB.userId].sort());
    const ass = await db.client.query('SELECT DISTINCT assigned_by FROM tenant_owners WHERE tenant_id = $1', [montese.tenantId]);
    expect(ass.rows.map((x: any) => x.assigned_by)).toEqual([admin.userId]);

    const r2 = await put(tAdmin, montese.tenantId, { user_ids: [socioC.userId] });
    expect(r2.status).toBe(200);
    expect(await donos(montese.tenantId)).toEqual([socioC.userId]);

    const ficha = await http().get(`/atuacao/clientes/${montese.tenantId}`).set(auth(tA));
    expect(ficha.status).toBe(200);
    expect(ficha.body.responsaveis).toEqual([{ id: socioC.userId, full_name: expect.any(String) }]);

    const a = await db.client.query(
      "SELECT detail, actor_user_id FROM audit_log WHERE action = 'client.owners_changed' AND resource_id = $1 ORDER BY occurred_at",
      [montese.tenantId],
    );
    expect(a.rows).toHaveLength(2);
    expect(a.rows[0].actor_user_id).toBe(admin.userId);
    for (const row of a.rows) expect(JSON.stringify(row)).not.toContain('Socio Eq');
    expect(a.rows[1].detail).toContain(socioC.userId);

    const vazio = await put(tAdmin, montese.tenantId, { user_ids: [] });
    expect(vazio.status).toBe(200);
    expect(vazio.body.responsaveis).toEqual([]);
    expect(await donos(montese.tenantId)).toEqual([]);
  });

  it('GET /atuacao/clientes?meus=true devolve só os clientes atribuídos ao usuário; valor inválido => 400', async () => {
    await put(tAdmin, montese.tenantId, { user_ids: [socioA.userId] });
    await put(tAdmin, montese2.tenantId, { user_ids: [socioB.userId] });
    const meusA = await http().get('/atuacao/clientes?meus=true').set(auth(tA));
    expect(meusA.status).toBe(200);
    const ids = meusA.body.map((c: any) => c.id);
    expect(ids).toContain(montese.tenantId);
    expect(ids).not.toContain(montese2.tenantId);
    const todos = await http().get('/atuacao/clientes').set(auth(tA));
    const todosIds = todos.body.map((c: any) => c.id);
    expect(todosIds).toEqual(expect.arrayContaining([montese.tenantId, montese2.tenantId]));
    expect((await http().get('/atuacao/clientes?meus=talvez').set(auth(tA))).status).toBe(400);
  });

  it('PUT por socio, empresa e técnico => 403 e tenant_owners intacto', async () => {
    await put(tAdmin, montese.tenantId, { user_ids: [socioA.userId] });
    const antes = await donos(montese.tenantId);
    const tokens = [tA, await login(montese.email, montese.password), await login(tecnicoUser.email, tecnicoUser.password)];
    for (const t of tokens) {
      expect((await put(t, montese.tenantId, { user_ids: [socioB.userId] })).status).toBe(403);
    }
    expect(await donos(montese.tenantId)).toEqual(antes);
  });

  it('PUT com id que não é sócio ativo => 400 "Responsável inválido" e nada muda', async () => {
    await put(tAdmin, montese.tenantId, { user_ids: [socioA.userId] });
    const antes = await donos(montese.tenantId);
    for (const id of [admin.userId, tecnicoUser.userId, socioInativo.userId, '00000000-0000-4000-8000-000000000000']) {
      const r = await put(tAdmin, montese.tenantId, { user_ids: [socioB.userId, id] });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toContain('Responsável inválido');
    }
    expect(await donos(montese.tenantId)).toEqual(antes);
  });

  it('PUT em tenant de parceiro ou inexistente => 404 e nada é gravado', async () => {
    const r = await put(tAdmin, parceiro.tenantId, { user_ids: [socioA.userId] });
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.body)).toContain('Cliente não encontrado');
    expect((await put(tAdmin, '00000000-0000-4000-8000-000000000000', { user_ids: [] })).status).toBe(404);
    expect(await donos(parceiro.tenantId)).toEqual([]);
  });

  it('PUT com ids repetidos, mais de 5, não-UUID ou corpo inválido => 400 e conjunto intacto', async () => {
    await put(tAdmin, montese.tenantId, { user_ids: [socioA.userId] });
    const antes = await donos(montese.tenantId);
    const seis = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);
    const casos = [
      { user_ids: [socioA.userId, socioA.userId] },
      { user_ids: seis },
      { user_ids: ['nao-e-uuid'] },
      { user_ids: 'x' },
      {},
      { user_ids: [socioB.userId], extra: 1 },
    ];
    for (const body of casos) expect((await put(tAdmin, montese.tenantId, body)).status).toBe(400);
    expect(await donos(montese.tenantId)).toEqual(antes);
  });
});
