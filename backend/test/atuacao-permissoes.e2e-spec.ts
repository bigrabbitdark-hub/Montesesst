import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { PERMISSIONS } from '../src/common/permissions';
import { TestDb, TestUserFixture } from './db-test-helper';

process.env.RATE_LIMIT_MAX = '5000';

// Painel de Atuação, Fase 7, Task 1: GET/PUT /atuacao/admin/permissoes (somente admin).
describe('atuacao-permissoes — admin gerencia socio_permissions (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let A: TestUserFixture;
  let B: TestUserFixture;
  let admin: TestUserFixture;
  let empresa: { tenantId: string; userId: string; email: string; password: string };
  let tecnicoUser: TestUserFixture;
  let parceiroUser: TestUserFixture;
  let tA: string, tAdmin: string, tEmp: string, tTec: string, tPar: string;
  const URL = '/atuacao/admin/permissoes';
  const sufixo = randomUUID().slice(0, 8);

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, path = '') => request(app.getHttpServer()).get(`${URL}${path}`).set(auth(t));
  const put = (t: string, userId: string, body: object) => request(app.getHttpServer()).put(`${URL}/${userId}`).set(auth(t)).send(body);
  const doBanco = async (userId: string) =>
    (await db.client.query('SELECT permission, granted_by FROM socio_permissions WHERE user_id=$1 ORDER BY permission', [userId])).rows;
  const nomes = async (userId: string) => (await doBanco(userId)).map((x: any) => x.permission);
  const auditorias = async () =>
    (await db.client.query("SELECT * FROM audit_log WHERE actor_user_id=$1 AND action='socio_permissions.changed' ORDER BY occurred_at", [admin.userId])).rows;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService).useValue({ createPreapproval: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    A = await db.createUserWithRole('socio', `Socio Perm A ${sufixo}`);
    B = await db.createUserWithRole('socio', `Socio Perm B ${sufixo}`);
    admin = await db.createUserWithRole('admin', `Admin Perm ${sufixo}`);
    tecnicoUser = await db.createUserWithRole('tecnico', 'Tec Perm');
    parceiroUser = await db.createUserWithRole('parceiro', 'Parc Perm');
    empresa = await db.createTenantWithUser('Cliente Perm');
    [tA, tAdmin, tEmp, tTec, tPar] = await Promise.all([A, admin, empresa, tecnicoUser, parceiroUser].map(login));
  }, 60000);

  afterAll(async () => {
    const us = [A.userId, B.userId, admin.userId];
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [us]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  it('GET: admin lê catálogo (cobre PERMISSIONS) e sócios ativos com permissões, sem e-mail', async () => {
    await db.grantSocioPermission(B.userId, 'finance.read');
    const r = await get(tAdmin);
    expect(r.status).toBe(200);
    const itens = r.body.catalogo.grupos.flatMap((g: any) => g.itens.map((i: any) => i.permissao));
    expect([...itens].sort()).toEqual([...PERMISSIONS].sort());
    expect(r.body.catalogo.grupos).toHaveLength(4);
    const sa = r.body.socios.find((s: any) => s.id === A.userId);
    const sb = r.body.socios.find((s: any) => s.id === B.userId);
    expect(sa).toEqual({ id: A.userId, nome: `Socio Perm A ${sufixo}`, ativo: true, permissoes: [] });
    expect(sb.permissoes).toEqual(['finance.read']);
    expect(r.body.socios.find((s: any) => s.id === admin.userId)).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/@|email/i);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id=$1', [B.userId]);
  });

  it('PUT altera exatamente o conjunto, granted_by = admin, substitui e remove (vazio)', async () => {
    const r1 = await put(tAdmin, A.userId, { permissoes: ['clients.read', 'tasks.read'] });
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ id: A.userId, nome: `Socio Perm A ${sufixo}`, permissoes: ['clients.read', 'tasks.read'], adicionadas: ['clients.read', 'tasks.read'], removidas: [] });
    expect(await doBanco(A.userId)).toEqual([
      { permission: 'clients.read', granted_by: admin.userId }, { permission: 'tasks.read', granted_by: admin.userId },
    ]);
    const r2 = await put(tAdmin, A.userId, { permissoes: ['tasks.read', 'finance.read'] });
    expect(r2.body.adicionadas).toEqual(['finance.read']);
    expect(r2.body.removidas).toEqual(['clients.read']);
    expect(await nomes(A.userId)).toEqual(['finance.read', 'tasks.read']);
    expect((await put(tAdmin, A.userId, { permissoes: [] })).status).toBe(200);
    expect(await doBanco(A.userId)).toEqual([]);
  });

  it('sensível sem confirmar_sensiveis => 400 e nada muda; com => 200', async () => {
    await put(tAdmin, A.userId, { permissoes: ['clients.read'] });
    for (const body of [{ permissoes: ['clients.read', 'documents.sign'] }, { permissoes: ['documents.view_registration'], confirmar_sensiveis: false }]) {
      const r = await put(tAdmin, A.userId, body);
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toContain('Confirme a concessão de permissões sensíveis.');
    }
    expect(await nomes(A.userId)).toEqual(['clients.read']);
    const ok = await put(tAdmin, A.userId, { permissoes: ['clients.read', 'documents.sign'], confirmar_sensiveis: true });
    expect(ok.status).toBe(200);
    expect(await nomes(A.userId)).toEqual(['clients.read', 'documents.sign']);
    // manter a sensível já concedida não exige confirmação
    expect((await put(tAdmin, A.userId, { permissoes: ['documents.sign'] })).status).toBe(200);
    await put(tAdmin, A.userId, { permissoes: [] });
  });

  it('permissão fora da lista / repetida / formato inválido => 400 e nada muda', async () => {
    await put(tAdmin, A.userId, { permissoes: ['clients.read'] });
    for (const body of [
      { permissoes: ['x.y'] }, { permissoes: ['clients.read', 'clients.read'] }, { permissoes: 'clients.read' }, {}, { permissoes: [1] },
    ]) expect((await put(tAdmin, A.userId, body)).status).toBe(400);
    expect(await nomes(A.userId)).toEqual(['clients.read']);
    await put(tAdmin, A.userId, { permissoes: [] });
  });

  it('usuário que não é sócio (admin, empresa, inexistente) => 400; id não-uuid => 400', async () => {
    for (const id of [admin.userId, empresa.userId, randomUUID()]) {
      const r = await put(tAdmin, id, { permissoes: ['clients.read'] });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).toContain('Responsável inválido');
    }
    expect((await put(tAdmin, 'nao-e-uuid', { permissoes: [] })).status).toBe(400);
    expect((await db.client.query('SELECT 1 FROM socio_permissions WHERE user_id = ANY($1)', [[admin.userId, empresa.userId]])).rows).toHaveLength(0);
  });

  it('PUT idêntico => 200 sem alterar e sem nova auditoria', async () => {
    await put(tAdmin, A.userId, { permissoes: ['tasks.read'] });
    const antes = (await auditorias()).length;
    const antesBanco = await doBanco(A.userId);
    const r = await put(tAdmin, A.userId, { permissoes: ['tasks.read'] });
    expect(r.status).toBe(200);
    expect(r.body.adicionadas).toEqual([]);
    expect(r.body.removidas).toEqual([]);
    expect((await auditorias()).length).toBe(antes);
    expect(await doBanco(A.userId)).toEqual(antesBanco);
    await put(tAdmin, A.userId, { permissoes: [] });
  });

  it('EFEITO REAL: conceder tasks.read muda GET /atuacao/tarefas de 403 PERMISSION_DENIED para 200; remover volta a 403', async () => {
    await db.client.query('DELETE FROM socio_permissions WHERE user_id=$1', [A.userId]);
    const antes = await request(app.getHttpServer()).get('/atuacao/tarefas').set(auth(tA));
    expect(antes.status).toBe(403);
    expect(JSON.stringify(antes.body)).toContain('PERMISSION_DENIED');
    expect((await put(tAdmin, A.userId, { permissoes: ['tasks.read'] })).status).toBe(200);
    expect((await request(app.getHttpServer()).get('/atuacao/tarefas').set(auth(tA))).status).toBe(200);
    expect((await put(tAdmin, A.userId, { permissoes: [] })).status).toBe(200);
    const depois = await request(app.getHttpServer()).get('/atuacao/tarefas').set(auth(tA));
    expect(depois.status).toBe(403);
    expect(JSON.stringify(depois.body)).toContain('PERMISSION_DENIED');
  });

  it('sócio, empresa, técnico e parceiro => 403 em todas as rotas; o sócio não altera as próprias permissões', async () => {
    await db.grantSocioPermission(A.userId, 'clients.read');
    for (const t of [tA, tEmp, tTec, tPar]) {
      expect((await get(t)).status).toBe(403);
      expect((await put(t, A.userId, { permissoes: PERMISSIONS as unknown as string[], confirmar_sensiveis: true })).status).toBe(403);
    }
    expect((await get('')).status).toBe(401);
    expect(await nomes(A.userId)).toEqual(['clients.read']);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id=$1', [A.userId]);
  });

  it('auditoria socio_permissions.changed só com ids e nomes de permissão (sem e-mail/nome)', async () => {
    await db.client.query("DELETE FROM audit_log WHERE actor_user_id=$1 AND action='socio_permissions.changed'", [admin.userId]);
    await put(tAdmin, A.userId, { permissoes: ['clients.read', 'documents.review'], confirmar_sensiveis: true });
    await put(tAdmin, A.userId, { permissoes: ['documents.review'] });
    const aud = await auditorias();
    expect(aud).toHaveLength(2);
    for (const a of aud) {
      expect(a.resource_type).toBe('socio_permissions');
      expect(a.resource_id).toBe(A.userId);
      expect(a.method).toBe('PUT');
      expect(a.path).toBe(`${URL}/${A.userId}`);
      expect(a.status_code).toBe(200);
    }
    expect(aud[0].detail).toBe(`usuario: ${A.userId}; adicionadas(2): clients.read, documents.review; removidas(0): `);
    expect(aud[1].detail).toBe(`usuario: ${A.userId}; adicionadas(0): ; removidas(1): clients.read`);
    const tudo = (await db.client.query('SELECT * FROM audit_log WHERE actor_user_id=$1', [admin.userId])).rows.map((r: any) => JSON.stringify(r)).join('\n');
    expect(tudo).not.toContain(admin.email);
    expect(tudo).not.toContain(A.email);
    expect(tudo).not.toContain(`Socio Perm A ${sufixo}`);
    expect(tudo).not.toContain(`Admin Perm ${sufixo}`);
    await put(tAdmin, A.userId, { permissoes: [] });
  });


  it('bypass de tipo em confirmar_sensiveis (string, número, objeto, array) => 400 e nada muda', async () => {
    await put(tAdmin, A.userId, { permissoes: ['clients.read'] });
    for (const v of ['true', 1, {}, ['true']]) {
      const r = await put(tAdmin, A.userId, { permissoes: ['clients.read', 'documents.publish'], confirmar_sensiveis: v });
      expect(r.status).toBe(400);
    }
    expect(await nomes(A.userId)).toEqual(['clients.read']);
    await put(tAdmin, A.userId, { permissoes: [] });
  });

  it('EFEITO REAL (documentos) e JWT antigo: documents.read/create_draft abrem GET /atuacao/documentos; remover tudo => 403 PERMISSION_DENIED com o mesmo token ainda autenticado', async () => {
    await db.client.query('DELETE FROM socio_permissions WHERE user_id=$1', [A.userId]);
    const docs = () => request(app.getHttpServer()).get('/atuacao/documentos').set(auth(tA));
    expect((await docs()).status).toBe(403);
    expect((await put(tAdmin, A.userId, { permissoes: ['documents.read', 'documents.create_draft'] })).status).toBe(200);
    expect((await docs()).status).toBe(200);
    expect((await put(tAdmin, A.userId, { permissoes: [] })).status).toBe(200);
    const depois = await docs();
    expect(depois.status).toBe(403);
    expect(JSON.stringify(depois.body)).toContain('PERMISSION_DENIED');
    expect((await request(app.getHttpServer()).get('/auth/me').set(auth(tA))).status).toBe(200);
    for (const rota of ['/atuacao/tarefas', '/atuacao/clientes']) {
      const r = await request(app.getHttpServer()).get(rota).set(auth(tA));
      expect(r.status).toBe(403);
    }
  });

  it('auditoria na mesma transação: falha no INSERT de audit_log => 500, permissões NÃO mudam e não há linha de auditoria', async () => {
    await put(tAdmin, A.userId, { permissoes: ['clients.read'] });
    const antes = (await auditorias()).length;
    await db.client.query(`CREATE FUNCTION public.tmp_falha_auditoria_perm() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'socio_permissions.changed' THEN RAISE EXCEPTION 'falha simulada'; END IF; RETURN NEW; END $$`);
    await db.client.query('CREATE TRIGGER tmp_falha_auditoria_perm BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION public.tmp_falha_auditoria_perm()');
    try {
      const r = await put(tAdmin, A.userId, { permissoes: ['tasks.read'] });
      expect(r.status).toBe(500);
      expect(await nomes(A.userId)).toEqual(['clients.read']);
      expect((await auditorias()).length).toBe(antes);
    } finally {
      await db.client.query('DROP TRIGGER IF EXISTS tmp_falha_auditoria_perm ON audit_log');
      await db.client.query('DROP FUNCTION IF EXISTS public.tmp_falha_auditoria_perm()');
    }
    expect((await put(tAdmin, A.userId, { permissoes: ['tasks.read'] })).status).toBe(200);
    expect((await auditorias()).length).toBe(antes + 1); // exatamente uma linha (sem duplicar)
    await put(tAdmin, A.userId, { permissoes: [] });
  });

  it('sócio inativo: aparece no GET com ativo=false; só remove; adicionar => 400; admin/empresa continuam 400', async () => {
    const I = await db.createUserWithRole('socio', `Socio Perm I ${sufixo}`);
    try {
      await db.grantSocioPermission(I.userId, 'clients.read');
      await db.grantSocioPermission(I.userId, 'tasks.read');
      await db.client.query("UPDATE users SET status='inativo' WHERE id=$1", [I.userId]);
      const g = await get(tAdmin);
      expect(g.body.socios.find((x: any) => x.id === I.userId)).toEqual({ id: I.userId, nome: `Socio Perm I ${sufixo}`, ativo: false, permissoes: ['clients.read', 'tasks.read'] });
      expect(g.body.socios.find((x: any) => x.id === A.userId).ativo).toBe(true);
      const add = await put(tAdmin, I.userId, { permissoes: ['clients.read', 'tasks.read', 'finance.read'] });
      expect(add.status).toBe(400);
      expect(JSON.stringify(add.body)).toContain('Sócio inativo: só é possível remover permissões.');
      expect(await nomes(I.userId)).toEqual(['clients.read', 'tasks.read']);
      const parcial = await put(tAdmin, I.userId, { permissoes: ['tasks.read'] });
      expect(parcial.status).toBe(200);
      expect(await nomes(I.userId)).toEqual(['tasks.read']);
      expect((await put(tAdmin, I.userId, { permissoes: [] })).status).toBe(200);
      expect(await nomes(I.userId)).toEqual([]);
      // sem permissões e inativo: some da lista
      expect((await get(tAdmin)).body.socios.find((x: any) => x.id === I.userId)).toBeUndefined();
      for (const id of [admin.userId, empresa.userId]) expect((await put(tAdmin, id, { permissoes: [] })).status).toBe(400);
    } finally {
      await db.client.query('DELETE FROM socio_permissions WHERE user_id=$1', [I.userId]);
      await db.client.query('DELETE FROM audit_log WHERE actor_user_id=$1 OR resource_id=$2', [admin.userId, I.userId]).catch(() => undefined);
    }
  });

  it('4 PUTs concorrentes terminam em um dos conjuntos, íntegro e sem erro', async () => {
    const conjuntos = [['clients.read'], ['tasks.read', 'tasks.write'], ['finance.read'], ['appointments.manage', 'clients.read']];
    const rs = await Promise.all(conjuntos.map((permissoes) => put(tAdmin, A.userId, { permissoes })));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const final = await nomes(A.userId);
    expect(conjuntos.map((c) => [...c].sort())).toContainEqual(final);
    await put(tAdmin, A.userId, { permissoes: [] });
  });
});
