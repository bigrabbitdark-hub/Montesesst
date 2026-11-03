import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { R2Service } from '../src/common/r2/r2.service';
import { AlertasJobService } from '../src/atuacao/alertas/alertas-job.service';
import { TestDb, TestUserFixture } from './db-test-helper';

process.env.RATE_LIMIT_MAX = '5000';

// E4: regras de antecedência, revisão por mudança, job de notificações (idempotente) e API de notificações.
describe('alertas — regras, mudanças, job e notificações (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sA: TestUserFixture, sB: TestUserFixture, sNada: TestUserFixture, sSemEmp: TestUserFixture, admin: TestUserFixture, tecnico: TestUserFixture;
  let montese: { tenantId: string; userId: string; email: string; password: string };
  let vinculado: { tenantId: string; userId: string };
  let tA: string, tB: string, tNada: string, tAdmin: string, tTec: string, tEmp: string;
  const sufixo = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  let regraLaudoOriginal: any;

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (m: 'get' | 'post' | 'put', t: string, path: string, body?: object) =>
    (request(app.getHttpServer()) as any)[m](`/atuacao/${path}`).set(auth(t)).send(body ?? {});
  const SP = "(now() AT TIME ZONE 'America/Sao_Paulo')::date";
  const mkDoc = async (t: { tenantId: string; userId: string }, category: string, offset: number | null, titulo: string) =>
    (await db.client.query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role, expires_at)
       VALUES ($1,$2,$3,$4,'a.pdf','application/pdf',10,$5,'empresa', ${offset === null ? 'NULL' : `${SP} + ${offset}`}) RETURNING id`,
      [t.tenantId, category, `${titulo} ${sufixo}`, `segredo/${randomUUID()}`, t.userId])).rows[0].id as string;
  const notifs = async (userId: string) =>
    (await db.client.query('SELECT type, priority, title, href, dedupe_key, read_at FROM notifications WHERE user_id = $1 ORDER BY dedupe_key', [userId])).rows;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService).useValue({ createPreapproval: jest.fn() })
      .overrideProvider(R2Service).useValue({ getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://example.com/f') })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    sA = await db.createUserWithRole('socio', `Socio Alerta A ${sufixo}`);
    sB = await db.createUserWithRole('socio', `Socio Alerta B ${sufixo}`);
    sNada = await db.createUserWithRole('socio', `Socio Alerta Nada ${sufixo}`);
    admin = await db.createUserWithRole('admin', 'Admin Alertas');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Alertas');
    montese = await db.createTenantWithUser('Cliente Montese Alertas');
    vinculado = await db.createTenantWithUser('Cliente Vinculado Alertas');
    for (const p of ['alertas.read', 'alertas.manage', 'tasks.read', 'empresas.read']) await db.grantSocioPermission(sA.userId, p);
    for (const p of ['alertas.read', 'empresas.read']) await db.grantSocioPermission(sB.userId, p);
    sSemEmp = await db.createUserWithRole('socio', `Socio Alerta SemEmp ${sufixo}`);
    await db.grantSocioPermission(sSemEmp.userId, 'alertas.read'); // sem empresas.read: não recebe aviso
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [vinculado.tenantId, tec.rows[0].id]);
    regraLaudoOriginal = (await db.client.query("SELECT notice_days, source FROM document_validity_rules WHERE category='laudo'")).rows[0];

    ids.d7 = await mkDoc(montese, 'pgr', 7, 'Doc sete');           // faixa 7 (alta)
    ids.d20 = await mkDoc(montese, 'pcmso', 20, 'Doc vinte');      // faixa 30 (média)
    ids.d100 = await mkDoc(montese, 'ltcat', 100, 'Doc cem');      // nenhuma
    ids.venc = await mkDoc(montese, 'treinamento', -1, 'Doc vencido'); // vencido (alta)
    ids.laudo = await mkDoc(montese, 'laudo', 9, 'Doc laudo');     // regra própria [10,0] => faixa 10
    ids.fora = await mkDoc(vinculado, 'pgr', 3, 'Doc fora');       // fora da carteira
    ids.cad = await mkDoc(montese, 'cadastro_funcionarios', -5, 'Cadastro'); // excluído
    await db.client.query(
      "INSERT INTO tasks (tenant_id, title, created_by, assignee_user_id, due_date, priority) VALUES ($1,'TESTE tarefa atrasada',$2,$2, " + SP + " - 2, 'alta')",
      [montese.tenantId, sA.userId]);
    [tA, tB, tNada, tAdmin, tTec, tEmp] = await Promise.all([sA, sB, sNada, admin, tecnico, montese].map(login));
  }, 90000);

  afterAll(async () => {
    const us = [sA, sB, sNada, sSemEmp].map((u) => u.userId);
    await db.client.query('UPDATE document_validity_rules SET notice_days=$1, source=$2 WHERE category=\'laudo\'', [regraLaudoOriginal.notice_days, regraLaudoOriginal.source]);
    await db.client.query('DELETE FROM notifications WHERE user_id = ANY($1)', [us]);
    await db.client.query('DELETE FROM document_drafts WHERE tenant_id = ANY($1)', [[montese.tenantId, vinculado.tenantId]]);
    await db.client.query('DELETE FROM document_change_flags WHERE tenant_id = ANY($1)', [[montese.tenantId, vinculado.tenantId]]);
    await db.client.query('DELETE FROM tasks WHERE assignee_user_id = ANY($1)', [us]);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1) OR action = \'alertas.job_run\'', [us]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  it('acesso: empresa, técnico, admin e sócio sem permissão ⇒ 403; sem token ⇒ 401', async () => {
    for (const t of [tEmp, tTec, tAdmin, tNada]) {
      expect((await api('get', t, 'notificacoes')).status).toBe(403);
      expect((await api('get', t, 'alertas/regras')).status).toBe(403);
    }
    expect((await request(app.getHttpServer()).get('/atuacao/notificacoes')).status).toBe(401);
  });

  it('regras: lista as 12 do 0079 com padrão efetivo; só quem gerencia altera; validações; meses intactos', async () => {
    const l = await api('get', tB, 'alertas/regras');
    expect(l.status).toBe(200);
    expect(l.body).toHaveLength(12);
    const pgr = l.body.find((r: any) => r.category === 'pgr');
    expect(pgr).toMatchObject({ validity_months: 24, notice_days_efetivo: [60, 30, 15, 7, 0] });
    expect((await api('put', tB, 'alertas/regras/laudo', { notice_days: [10, 0] })).status).toBe(403);
    expect((await api('put', tA, 'alertas/regras/laudo', { notice_days: [] })).status).toBe(400);
    expect((await api('put', tA, 'alertas/regras/laudo', { notice_days: [10, 10] })).status).toBe(400);
    expect((await api('put', tA, 'alertas/regras/laudo', { notice_days: [-1] })).status).toBe(400);
    expect((await api('put', tA, 'alertas/regras/laudo', { notice_days: [366] })).status).toBe(400);
    expect((await api('put', tA, 'alertas/regras/invalida', { notice_days: [1] })).status).toBe(400);
    const ok = await api('put', tA, 'alertas/regras/laudo', { notice_days: [0, 10], source: 'Fonte de teste' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ category: 'laudo', notice_days: [10, 0], source: 'Fonte de teste', usa_padrao: false });
    expect((await db.client.query("SELECT validity_months FROM document_validity_rules WHERE category='pgr'")).rows[0].validity_months).toBe(24);
  });

  it('job: gera notificações só da carteira, com faixa correta, texto genérico, para sócios com alertas.read; idempotente', async () => {
    const job = app.get(AlertasJobService);
    const r1 = await job.runOnce();
    expect(r1.criadas).toBeGreaterThan(0);
    const a = await notifs(sA.userId);
    const b = await notifs(sB.userId);
    expect(await notifs(sNada.userId)).toEqual([]);
    expect(await notifs(sSemEmp.userId)).toEqual([]);
    const chavesDoc = (l: any[]) => l.filter((n) => n.dedupe_key.startsWith('doc:')).map((n) => n.dedupe_key.replace(/:\d{4}-\d{2}-\d{2}:/, ':')).sort();
    const esperado = [`doc:${ids.d7}:7`, `doc:${ids.d20}:30`, `doc:${ids.venc}:vencido`, `doc:${ids.laudo}:10`].sort();
    expect(chavesDoc(a)).toEqual(expect.arrayContaining(esperado));
    expect(chavesDoc(a).some((k) => k.includes(ids.d100) || k.includes(ids.fora) || k.includes(ids.cad))).toBe(false);
    expect(chavesDoc(b)).toEqual(chavesDoc(a));
    const d7 = a.find((n) => n.dedupe_key.startsWith(`doc:${ids.d7}:`));
    expect(d7).toMatchObject({ type: 'documento_vencendo', priority: 'alta' });
    expect(d7.title).toMatch(/^PGR vence em 7 dias — /);
    expect(a.find((n) => n.dedupe_key.startsWith(`doc:${ids.d20}:`))).toMatchObject({ priority: 'media' });
    expect(a.find((n) => n.dedupe_key.startsWith(`doc:${ids.venc}:`))).toMatchObject({ type: 'documento_vencido', priority: 'alta' });
    expect(a.every((n) => !/Doc sete|Doc vinte|Doc vencido|segredo/.test(n.title))).toBe(true);
    expect(a.every((n) => n.href === null || /^\/atuacao\//.test(n.href))).toBe(true);
    // tarefa atrasada: só do responsável (A)
    expect(a.some((n) => n.type === 'tarefa_atrasada')).toBe(true);
    expect(b.some((n) => n.type === 'tarefa_atrasada')).toBe(false);
    expect(a.find((n) => n.type === 'tarefa_atrasada')!.title).not.toMatch(/TESTE tarefa/);
    // idempotência
    const r2 = await job.runOnce();
    expect(r2.criadas).toBe(0);
    expect((await notifs(sA.userId)).length).toBe(a.length);
    const aud = await db.client.query("SELECT detail FROM audit_log WHERE action='alertas.job_run' ORDER BY occurred_at DESC LIMIT 1");
    expect(aud.rows[0].detail).toMatch(/^criadas: 0;/);
  });

  it('mudança nas condições de trabalho: exige permissão; valida alvo e documento do mesmo tenant; vira alerta para todos; resolver uma vez', async () => {
    expect((await api('post', tB, 'alertas/mudancas', { tenant_id: montese.tenantId, category: 'pgr', reason: 'funcao' })).status).toBe(403);
    expect((await api('post', tA, 'alertas/mudancas', { tenant_id: montese.tenantId, reason: 'funcao' })).status).toBe(400);
    expect((await api('post', tA, 'alertas/mudancas', { tenant_id: montese.tenantId, category: 'pgr', reason: 'invalido' })).status).toBe(400);
    expect((await api('post', tA, 'alertas/mudancas', { tenant_id: montese.tenantId, document_id: ids.fora, reason: 'risco' })).status).toBe(409);
    expect((await api('post', tA, 'alertas/mudancas', { tenant_id: vinculado.tenantId, category: 'pgr', reason: 'risco' })).status).toBe(404);
    const c = await api('post', tA, 'alertas/mudancas', { tenant_id: montese.tenantId, category: 'pgr', reason: 'equipamento', note: 'nova prensa' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ reason: 'equipamento', resolved_at: null });
    const job = app.get(AlertasJobService);
    expect((await job.runOnce()).criadas).toBe(2); // um para A e um para B
    expect((await notifs(sB.userId)).some((n) => n.type === 'revisao_por_mudanca' && n.priority === 'alta')).toBe(true);
    expect((await notifs(sB.userId)).every((n) => !/prensa/.test(n.title))).toBe(true);
    expect((await api('post', tB, `alertas/mudancas/${c.body.id}/resolver`, {})).status).toBe(403);
    const rs = await api('post', tA, `alertas/mudancas/${c.body.id}/resolver`, { nota: 'PGR revisado' });
    expect(rs.status).toBe(201);
    expect(rs.body.resolved_at).toBeTruthy();
    expect((await api('post', tA, `alertas/mudancas/${c.body.id}/resolver`, {})).status).toBe(409);
    expect((await api('get', tB, 'alertas/mudancas')).body).toEqual([]);
    expect((await api('get', tB, 'alertas/mudancas?abertas=false')).body).toHaveLength(1);
  });

  it('notificações: cada sócio vê só as próprias; marcar lida; marcar todas; ids alheios ⇒ 404', async () => {
    const a = await api('get', tA, 'notificacoes');
    const b = await api('get', tB, 'notificacoes');
    expect(a.status).toBe(200);
    expect(a.body.total).toBeGreaterThan(0);
    const idsA = a.body.itens.map((n: any) => n.id);
    expect(b.body.itens.some((n: any) => idsA.includes(n.id))).toBe(false);
    expect(a.body.itens[0]).not.toHaveProperty('user_id');
    const r0 = await api('get', tB, 'notificacoes/resumo');
    expect(r0.body.nao_lidas).toBe(b.body.total);
    expect((await api('post', tB, `notificacoes/${idsA[0]}/lida`)).status).toBe(404); // de outro usuário
    expect((await api('post', tB, `notificacoes/${randomUUID()}/lida`)).status).toBe(404);
    const idB = b.body.itens[0].id;
    const um = await api('post', tB, `notificacoes/${idB}/lida`);
    expect(um.status).toBe(201);
    expect(um.body.nao_lidas).toBe(b.body.total - 1);
    expect((await api('post', tB, `notificacoes/${idB}/lida`)).status).toBe(201); // idempotente
    expect((await api('get', tB, 'notificacoes?naoLidas=true')).body.itens.some((n: any) => n.id === idB)).toBe(false);
    const todas = await api('post', tB, 'notificacoes/lidas');
    expect(todas.body.nao_lidas).toBe(0);
    expect((await api('get', tA, 'notificacoes/resumo')).body.nao_lidas).toBe(a.body.total); // as de A seguem intactas
  });

  it('PGR-base atualizado: avisa uma vez por (documento, versão do PGR), texto genérico, só carteira; nova versão do PGR gera novo aviso', async () => {
    const mk = async (tenantId: string, category: string, base: string | null) => (await db.client.query(
      "INSERT INTO document_drafts (tenant_id, category, title, created_by, base_draft_id) VALUES ($1,$2,'TESTE segredo base',$3,$4) RETURNING id", [tenantId, category, sA.userId, base])).rows[0].id as string;
    const ver = async (draft: string, tenantId: string, n: number, quando: string) => {
      const id = (await db.client.query(
        "INSERT INTO document_draft_versions (draft_id, tenant_id, version_number, file_key, file_name, mime_type, size_bytes, sha256, created_by, created_at) VALUES ($1,$2,$3,$4,'a.pdf','application/pdf',10,$5,$6,$7) RETURNING id",
        [draft, tenantId, n, `documents-fluxo/teste/${draft}/${n}`, 'd'.repeat(64), sA.userId, quando])).rows[0].id as string;
      await db.client.query('UPDATE document_drafts SET current_version_id=$2 WHERE id=$1', [draft, id]);
      return id;
    };
    const pgr = await mk(montese.tenantId, 'pgr', null);
    const lt = await mk(montese.tenantId, 'ltcat', pgr);
    const pgrV = await mk(vinculado.tenantId, 'pgr', null);
    const ltV = await mk(vinculado.tenantId, 'ltcat', pgrV);
    await ver(lt, montese.tenantId, 1, '2026-01-01T00:00:00Z');
    await ver(ltV, vinculado.tenantId, 1, '2026-01-01T00:00:00Z');
    const job = app.get(AlertasJobService);
    const base = async () => (await notifs(sA.userId)).filter((n) => n.dedupe_key.startsWith(`base:${lt}:`));
    await job.runOnce();
    expect(await base()).toHaveLength(0);                        // PGR ainda sem versão
    const v1 = await ver(pgr, montese.tenantId, 1, '2026-02-01T00:00:00Z');
    await ver(pgrV, vinculado.tenantId, 1, '2026-02-01T00:00:00Z');
    await job.runOnce();
    const n1 = await base();
    expect(n1).toHaveLength(1);
    expect(n1[0]).toMatchObject({ type: 'revisao_por_mudanca', priority: 'media', dedupe_key: `base:${lt}:${v1}` });
    expect(n1[0].title).toMatch(/^PGR atualizado — revisar LTCAT — /);
    expect(n1[0].title).not.toMatch(/segredo/);
    expect(n1[0].href).toBe(`/atuacao/documentos/${lt}`);
    expect((await notifs(sB.userId)).some((n) => n.dedupe_key === `base:${lt}:${v1}`)).toBe(true);
    expect((await notifs(sA.userId)).some((n) => n.dedupe_key.startsWith(`base:${ltV}:`))).toBe(false); // fora da carteira
    await job.runOnce();
    expect(await base()).toHaveLength(1);                        // idempotente
    const v2 = await ver(pgr, montese.tenantId, 2, '2026-03-01T00:00:00Z');
    await job.runOnce();
    expect((await base()).map((n) => n.dedupe_key).sort()).toEqual([`base:${lt}:${v1}`, `base:${lt}:${v2}`].sort());
  });
});
