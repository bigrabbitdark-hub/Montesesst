import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { TestDb, TestTenantFixture, TestUserFixture } from './db-test-helper';

process.env.RATE_LIMIT_MAX = '5000';

// D2 Task 2: status de espera, histórico e encaminhar tarefa (HTTP).
describe('atuacao-tarefas-espera — status de espera e encaminhar (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sA: TestUserFixture, sB: TestUserFixture, sRO: TestUserFixture, sInativo: TestUserFixture, sLeitorTudo: TestUserFixture;
  let admin: TestUserFixture, tecnico: TestUserFixture;
  let m1: TestTenantFixture, m2: TestTenantFixture, parceiro: TestTenantFixture;
  let tA: string, tRO: string, tAdmin: string, tTec: string, tEmpresa: string;
  const sufixo = randomUUID().slice(0, 8);

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const http = () => request(app.getHttpServer());
  const criar = async (tenantId: string, assignee: string, title = 'T') =>
    (await http().post('/atuacao/tarefas').set(auth(tA)).send({ tenant_id: tenantId, title: `${title} ${sufixo}`, assignee_user_id: assignee })).body.id as string;
  const status = (t: string, id: string, body: any) => http().post(`/atuacao/tarefas/${id}/status`).set(auth(t)).send(body);
  const encaminhar = (t: string, id: string, body: any) => http().post(`/atuacao/tarefas/${id}/encaminhar`).set(auth(t)).send(body);
  const eventos = async (id: string) =>
    (await db.client.query('SELECT type, from_value, to_value, note, actor_user_id FROM task_events WHERE task_id = $1 ORDER BY created_at, id', [id])).rows;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService).useValue({ createPreapproval: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    sA = await db.createUserWithRole('socio', `Socio Esp A ${sufixo}`);
    sB = await db.createUserWithRole('socio', `Socio Esp B ${sufixo}`);
    sRO = await db.createUserWithRole('socio', `Socio Esp RO ${sufixo}`);
    sInativo = await db.createUserWithRole('socio', `Socio Esp Inativo ${sufixo}`);
    sLeitorTudo = await db.createUserWithRole('socio', `Socio Esp Leitor ${sufixo}`);
    await db.client.query("UPDATE users SET status = 'inativo' WHERE id = $1", [sInativo.userId]);
    admin = await db.createUserWithRole('admin', `Admin Esp ${sufixo}`);
    tecnico = await db.createUserWithRole('tecnico', `Tec Esp ${sufixo}`);
    m1 = await db.createTenantWithUser('Cliente Montese Esp 1');
    m2 = await db.createTenantWithUser('Cliente Montese Esp 2');
    parceiro = await db.createTenantWithUser('Cliente Parceiro Esp');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [parceiro.tenantId, tec.rows[0].id]);
    for (const u of [sA, sB, sLeitorTudo]) { await db.grantSocioPermission(u.userId, 'tasks.read'); await db.grantSocioPermission(u.userId, 'tasks.write'); }
    await db.grantSocioPermission(sRO.userId, 'tasks.read');
    [tA, tRO, tAdmin, tTec, tEmpresa] = await Promise.all([sA, sRO, admin, tecnico, m1].map(login));
  }, 90000);

  afterAll(async () => {
    const us = [sA, sB, sRO, sInativo, sLeitorTudo].map((u) => u.userId);
    await db.client.query('DELETE FROM tasks WHERE assignee_user_id = ANY($1) OR created_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [us]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  describe('status de espera', () => {
    it('fluxo livre entre abertos com eventos status_changed from/to; concluir a partir de espera; encerradas são finais', async () => {
      const id = await criar(m1.tenantId, sA.userId, 'Fluxo');
      const passos = ['awaiting_client', 'awaiting_execution', 'awaiting_efficacy', 'awaiting_review', 'blocked', 'pending', 'awaiting_client'];
      for (const [i, s] of passos.entries()) {
        const r = await status(tA, id, s === 'blocked' ? { status: s, note: 'motivo' } : { status: s });
        expect({ i, s, http: r.status, status: r.body.status }).toEqual({ i, s, http: 201, status: s });
      }
      const ev = (await eventos(id)).filter((e) => e.type === 'status_changed');
      expect(ev.map((e) => `${e.from_value}>${e.to_value}`)).toEqual([
        'pending>awaiting_client', 'awaiting_client>awaiting_execution', 'awaiting_execution>awaiting_efficacy',
        'awaiting_efficacy>awaiting_review', 'awaiting_review>blocked', 'blocked>pending', 'pending>awaiting_client',
      ]);
      expect((await status(tA, id, { status: 'awaiting_client' })).status).toBe(400); // mesmo estado
      expect((await status(tA, id, { status: 'completed' })).status).toBe(201);
      const fim = await db.client.query('SELECT completed_at FROM tasks WHERE id = $1', [id]);
      expect(fim.rows[0].completed_at).not.toBeNull();
      expect((await status(tA, id, { status: 'awaiting_client' })).status).toBe(400); // finais
      expect((await status(tA, id, { status: 'cancelled', note: 'x' })).status).toBe(400);
    });

    it('valor fora da lista => 400; sem tasks.write => 403; sem token => 401', async () => {
      const id = await criar(m1.tenantId, sA.userId, 'Validacao');
      expect((await status(tA, id, { status: 'awaiting_other' })).status).toBe(400);
      const ro = await status(tRO, id, { status: 'awaiting_client' });
      expect(ro.status).toBe(403);
      expect(JSON.stringify(ro.body)).toContain('PERMISSION_DENIED');
      expect((await http().post(`/atuacao/tarefas/${id}/status`).send({ status: 'awaiting_client' })).status).toBe(401);
    });

    it('lista filtrada por status de espera e resumo com contagens por categoria (só as do próprio sócio)', async () => {
      const a = await criar(m1.tenantId, sLeitorTudo.userId, 'Cat1');
      const b = await criar(m2.tenantId, sLeitorTudo.userId, 'Cat2');
      const c = await criar(m1.tenantId, sLeitorTudo.userId, 'Cat3');
      await criar(m1.tenantId, sA.userId, 'Alheia');
      const tL = await login(sLeitorTudo);
      for (const [id, s] of [[a, 'awaiting_client'], [b, 'awaiting_efficacy'], [c, 'awaiting_client']]) await status(tL, id, { status: s });
      const lista = await http().get('/atuacao/tarefas?status=awaiting_client&assignee=me').set(auth(tL));
      expect(lista.status).toBe(200);
      expect(lista.body.map((t: any) => t.id).sort()).toEqual([a, c].sort());
      const r = await http().get('/atuacao/tarefas/resumo').set(auth(tL));
      expect(r.body).toEqual({
        abertas: 3, vencidas: 0, hoje: 0, bloqueadas: 0,
        aguardando_cliente: 2, aguardando_avaliacao: 0, aguardando_execucao: 0, aguardando_eficacia: 1,
      });
    });
  });

  describe('encaminhar', () => {
    it('sócio com tasks.write encaminha: responsável muda, evento assigned com antes/depois e nota; auditoria só com ids', async () => {
      const id = await criar(m1.tenantId, sA.userId, 'Enc');
      const nota = `NotaSecretaEnc${sufixo}`;
      const r = await encaminhar(tA, id, { assignee_user_id: sB.userId, nota });
      expect(r.status).toBe(201);
      expect(r.body.assignee_user_id).toBe(sB.userId);
      const ev = (await eventos(id)).filter((e) => e.type === 'assigned');
      expect(ev).toEqual([{ type: 'assigned', from_value: sA.userId, to_value: sB.userId, note: nota, actor_user_id: sA.userId }]);
      expect(r.body.eventos.some((e: any) => e.type === 'assigned' && e.note === nota)).toBe(true);
      const aud = await db.client.query("SELECT action, detail FROM audit_log WHERE resource_id = $1 AND action = 'task.reassigned'", [id]);
      expect(aud.rowCount).toBe(1);
      expect(aud.rows[0].detail).toBe(`de: ${sA.userId}; para: ${sB.userId}`);
      expect(JSON.stringify(aud.rows)).not.toContain('Secreta');
      // nota é opcional
      const id2 = await criar(m2.tenantId, sA.userId, 'Enc2');
      expect((await encaminhar(tA, id2, { assignee_user_id: sB.userId })).status).toBe(201);
    });

    it('validações: si mesmo 400, responsável atual 400, inativo 400, não-sócio 400, inexistente 400, nota>500 400, campo extra 400', async () => {
      const id = await criar(m1.tenantId, sB.userId, 'Val');
      expect((await encaminhar(tA, id, { assignee_user_id: sA.userId })).status).toBe(400);
      expect((await encaminhar(tA, id, { assignee_user_id: sB.userId })).status).toBe(400);
      expect((await encaminhar(tA, id, { assignee_user_id: sInativo.userId })).status).toBe(400);
      expect((await encaminhar(tA, id, { assignee_user_id: admin.userId })).status).toBe(400);
      expect((await encaminhar(tA, id, { assignee_user_id: tecnico.userId })).status).toBe(400);
      expect((await encaminhar(tA, id, { assignee_user_id: m1.userId })).status).toBe(400);
      expect((await encaminhar(tA, id, { assignee_user_id: randomUUID() })).status).toBe(400);
      expect((await encaminhar(tA, id, { assignee_user_id: sLeitorTudo.userId, nota: 'x'.repeat(501) })).status).toBe(400);
      expect((await encaminhar(tA, id, { assignee_user_id: sLeitorTudo.userId, status: 'completed' })).status).toBe(400);
      expect((await encaminhar(tA, id, {})).status).toBe(400);
      expect((await db.client.query('SELECT assignee_user_id FROM tasks WHERE id = $1', [id])).rows[0].assignee_user_id).toBe(sB.userId);
      expect((await eventos(id)).filter((e) => e.type === 'assigned')).toHaveLength(0);
    });

    it('tarefa concluída ou cancelada => 409 e nada muda', async () => {
      const id = await criar(m1.tenantId, sA.userId, 'Fechada');
      await status(tA, id, { status: 'in_progress' });
      await status(tA, id, { status: 'completed' });
      expect((await encaminhar(tA, id, { assignee_user_id: sB.userId })).status).toBe(409);
      const id2 = await criar(m1.tenantId, sA.userId, 'Cancelada');
      await status(tA, id2, { status: 'cancelled', note: 'x' });
      expect((await encaminhar(tA, id2, { assignee_user_id: sB.userId })).status).toBe(409);
      expect((await db.client.query('SELECT assignee_user_id FROM tasks WHERE id = $1', [id])).rows[0].assignee_user_id).toBe(sA.userId);
    });

    it('sem tasks.write 403; empresa/técnico/admin 403; id inexistente 404; id inválido 400', async () => {
      const id = await criar(m1.tenantId, sA.userId, 'Perm');
      expect((await encaminhar(tRO, id, { assignee_user_id: sB.userId })).status).toBe(403);
      for (const t of [tEmpresa, tTec, tAdmin]) expect((await encaminhar(t, id, { assignee_user_id: sB.userId })).status).toBe(403);
      expect((await encaminhar(tA, randomUUID(), { assignee_user_id: sB.userId })).status).toBe(404);
      expect((await encaminhar(tA, 'abc', { assignee_user_id: sB.userId })).status).toBe(400);
      expect((await db.client.query('SELECT assignee_user_id FROM tasks WHERE id = $1', [id])).rows[0].assignee_user_id).toBe(sA.userId);
    });

    it('IDOR: tarefa de empresa de parceiro => 404 uniforme (igual a inexistente) e inalterada; tarefa de outro cliente Montese é alcançável', async () => {
      const ins = await db.client.query(
        `INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id) VALUES ($1,$2,$3,$3) RETURNING id`,
        [parceiro.tenantId, `Parceiro ${sufixo}`, sA.userId],
      );
      const pid = ins.rows[0].id as string;
      const r = await encaminhar(tA, pid, { assignee_user_id: sB.userId });
      const inex = await encaminhar(tA, randomUUID(), { assignee_user_id: sB.userId });
      expect(r.status).toBe(404);
      expect(r.body.message).toBe(inex.body.message);
      expect((await status(tA, pid, { status: 'awaiting_client' })).status).toBe(404);
      const row = (await db.client.query('SELECT assignee_user_id, status FROM tasks WHERE id = $1', [pid])).rows[0];
      expect(row).toEqual({ assignee_user_id: sA.userId, status: 'pending' });
      const m2id = await criar(m2.tenantId, sA.userId, 'M2');
      expect((await encaminhar(tA, m2id, { assignee_user_id: sB.userId })).status).toBe(201);
    });
  });
});
