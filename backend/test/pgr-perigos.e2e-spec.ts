import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb, TestUserFixture } from './db-test-helper';

process.env.RATE_LIMIT_MAX = '5000';

// PGR (sub-projeto A), Task 3: /atuacao/pgr/perigos (biblioteca de perigos). A biblioteca nasce vazia.
describe('pgr-perigos — biblioteca de perigos (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sLeitor: TestUserFixture; // pgr.read
  let sEditor: TestUserFixture; // pgr.read + pgr.write
  let sNada: TestUserFixture;
  let sSoWrite: TestUserFixture; // só pgr.write (sem pgr.read)
  let admin: TestUserFixture;
  let tecnico: TestUserFixture;
  let tecRow: string;
  let parcUser: TestUserFixture;
  let tParc: string;
  let montese: { tenantId: string; userId: string; email: string; password: string };
  let parceiro: { tenantId: string; userId: string; email: string; password: string };
  let tSoWrite: string;
  let tLeitor: string, tEditor: string, tNada: string, tAdmin: string, tTec: string, tEmp: string;
  const sufixo = randomUUID().slice(0, 8);
  const N = (s: string) => `TESTE ${s} ${sufixo}`;
  let globalId: string, tenantHazId: string, parceiroHazId: string;

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const BASE = '/atuacao/pgr/perigos';
  const get = (t: string, p = '') => request(app.getHttpServer()).get(`${BASE}${p}`).set(auth(t));
  const post = (t: string, p: string, b: object) => request(app.getHttpServer()).post(`${BASE}${p}`).set(auth(t)).send(b);
  const patch = (t: string, p: string, b: object) => request(app.getHttpServer()).patch(`${BASE}${p}`).set(auth(t)).send(b);
  const contar = async (like: string) =>
    Number((await db.client.query('SELECT count(*)::int AS n FROM pgr_hazards WHERE name LIKE $1', [like])).rows[0].n);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService).useValue({ createPreapproval: jest.fn() })
      .overrideProvider(R2Service).useValue({ getPresignedDownloadUrl: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    sLeitor = await db.createUserWithRole('socio', `Socio Pgr Leitor ${sufixo}`);
    sEditor = await db.createUserWithRole('socio', `Socio Pgr Editor ${sufixo}`);
    sNada = await db.createUserWithRole('socio', `Socio Pgr Nada ${sufixo}`);
    sSoWrite = await db.createUserWithRole('socio', `Socio Pgr SoWrite ${sufixo}`);
    parcUser = await db.createUserWithRole('parceiro', 'Parc Pgr');
    admin = await db.createUserWithRole('admin', 'Admin Pgr');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Pgr');
    montese = await db.createTenantWithUser('Cliente Montese Pgr');
    parceiro = await db.createTenantWithUser('Cliente Parceiro Pgr');
    await db.grantSocioPermission(sLeitor.userId, 'pgr.read');
    await db.grantSocioPermission(sEditor.userId, 'pgr.read');
    await db.grantSocioPermission(sEditor.userId, 'pgr.write');
    await db.grantSocioPermission(sSoWrite.userId, 'pgr.write');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    tecRow = tec.rows[0].id;
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [parceiro.tenantId, tecRow]);

    globalId = await db.insertRawRow('pgr_hazards', { scope: 'global', category: 'fisico', name: N('global base') });
    tenantHazId = await db.insertRawRow('pgr_hazards', { scope: 'tenant', tenant_id: montese.tenantId, category: 'quimico', name: N('tenant montese') });
    parceiroHazId = await db.insertRawRow('pgr_hazards', { scope: 'tenant', tenant_id: parceiro.tenantId, category: 'quimico', name: N('tenant parceiro') });

    [tLeitor, tEditor, tNada, tAdmin, tTec, tEmp, tSoWrite, tParc] = await Promise.all([sLeitor, sEditor, sNada, admin, tecnico, montese, sSoWrite, parcUser].map(login));
  }, 90000);

  afterAll(async () => {
    const us = [sLeitor.userId, sEditor.userId, sNada.userId, sSoWrite.userId, admin.userId];
    await db.client.query('DELETE FROM pgr_hazards WHERE name LIKE $1', [`TESTE % ${sufixo}%`]);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [us]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  it('sócio sem pgr.read ⇒ 403 PERMISSION_DENIED; empresa e técnico ⇒ 403', async () => {
    const r = await get(tNada);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('PERMISSION_DENIED');
    expect((await get(tNada, `/${globalId}`)).status).toBe(403);
    expect((await get(tEmp)).status).toBe(403);
    expect((await get(tTec)).status).toBe(403);
  });

  it('com pgr.read: lê global e tenant Montese, não o de parceiro; lista sem textos longos', async () => {
    const r = await get(tLeitor, `?q=${encodeURIComponent(sufixo)}&tenantId=${montese.tenantId}`);
    expect(r.status).toBe(200);
    const nomes = r.body.map((x: any) => x.name);
    expect(nomes).toContain(N('global base'));
    expect(nomes).toContain(N('tenant montese'));
    expect(nomes).not.toContain(N('tenant parceiro'));
    expect(Object.keys(r.body[0]).sort()).toEqual(
      ['active', 'category', 'default_assessment', 'description', 'esocial_code', 'id', 'name', 'scope', 'tenant_id'].sort(),
    );
    expect((await get(tLeitor, `/${globalId}`)).status).toBe(200);
    expect((await get(tLeitor, `/${tenantHazId}?tenantId=${montese.tenantId}`)).status).toBe(200);
    expect((await get(tLeitor, `/${parceiroHazId}`)).status).toBe(404);
    expect((await get(tLeitor, `/${parceiroHazId}?tenantId=${parceiro.tenantId}`)).status).toBe(404);
    expect((await get(tLeitor, `?tenantId=${parceiro.tenantId}`)).status).toBe(404);
  });

  it('I-2: sócio sem tenantId vê só global; GET /:id de perigo de empresa sem tenantId ⇒ 404', async () => {
    const r = await get(tLeitor, `?q=${encodeURIComponent(sufixo)}`);
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.every((x: any) => x.scope === 'global' && x.tenant_id === null)).toBe(true);
    const todos = await get(tLeitor);
    expect(todos.body.every((x: any) => x.scope === 'global')).toBe(true);
    expect((await get(tLeitor, `/${tenantHazId}`)).status).toBe(404);
    expect((await get(tLeitor, `/${tenantHazId}?tenantId=${randomUUID()}`)).status).toBe(404);
    const e = await get(tLeitor, '/exportar');
    expect(e.body.itens.every((x: any) => typeof x.name === 'string')).toBe(true);
    expect(e.body.itens.map((x: any) => x.name)).not.toContain(N('tenant montese'));
  });

  it('I-1: admin com tenant parceiro ⇒ 404 em tudo, sem gravar nem auditar', async () => {
    const antesAud = Number((await db.client.query("SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id = $1 AND action LIKE 'pgr.hazard.%'", [admin.userId])).rows[0].n);
    const antesHaz = Number((await db.client.query('SELECT count(*)::int AS n FROM pgr_hazards')).rows[0].n);
    const P = parceiro.tenantId;
    expect((await post(tAdmin, '', { tenant_id: P, category: 'fisico', name: N('adm parc') })).status).toBe(404);
    expect((await post(tAdmin, `/${globalId}/duplicar`, { tenant_id: P, name: N('adm parc dup') })).status).toBe(404);
    expect((await post(tAdmin, '/importar', { tenant_id: P, itens: [{ category: 'fisico', name: N('adm parc imp') }] })).status).toBe(404);
    expect((await get(tAdmin, `/exportar?tenantId=${P}`)).status).toBe(404);
    expect((await get(tAdmin, `?tenantId=${P}`)).status).toBe(404);
    expect((await get(tAdmin, `/${parceiroHazId}`)).status).toBe(404);
    expect((await patch(tAdmin, `/${parceiroHazId}`, { description: 'x' })).status).toBe(404);
    expect((await patch(tAdmin, `/${parceiroHazId}/ativo`, { active: false })).status).toBe(404);
    expect((await post(tAdmin, `/${parceiroHazId}/duplicar`, { para_global: true })).status).toBe(404);
    const todos = await get(tAdmin, `?q=${encodeURIComponent(sufixo)}`);
    expect(todos.body.map((x: any) => x.name)).not.toContain(N('tenant parceiro'));
    const depAud = Number((await db.client.query("SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id = $1 AND action LIKE 'pgr.hazard.%'", [admin.userId])).rows[0].n);
    expect(depAud).toBe(antesAud);
    expect(Number((await db.client.query('SELECT count(*)::int AS n FROM pgr_hazards')).rows[0].n)).toBe(antesHaz);
    expect((await db.client.query('SELECT active, description FROM pgr_hazards WHERE id = $1', [parceiroHazId])).rows[0]).toEqual({ active: true, description: null });
  });

  it('M-1: sócio com pgr.write mas sem pgr.read ⇒ 403 nas rotas de escrita', async () => {
    const r = await post(tSoWrite, '', { tenant_id: montese.tenantId, category: 'fisico', name: N('so write') });
    expect(r.status).toBe(403);
    expect(await contar(N('so write'))).toBe(0);
    expect((await patch(tSoWrite, `/${tenantHazId}`, { description: 'y' })).status).toBe(403);
    expect((await patch(tSoWrite, `/${tenantHazId}/ativo`, { active: false })).status).toBe(403);
    expect((await post(tSoWrite, `/${globalId}/duplicar`, { tenant_id: montese.tenantId })).status).toBe(403);
  });

  it('M-9: tecnico, empresa e parceiro ⇒ 403 em todas as rotas de escrita e exportar; nada muda nem é auditado', async () => {
    const cnt = async () => [
      Number((await db.client.query('SELECT count(*)::int AS n FROM pgr_hazards')).rows[0].n),
      Number((await db.client.query("SELECT count(*)::int AS n FROM audit_log WHERE action LIKE 'pgr.hazard.%'")).rows[0].n),
    ];
    const antes = await cnt();
    const snap = (await db.client.query('SELECT active, description FROM pgr_hazards WHERE id = $1', [tenantHazId])).rows[0];
    for (const t of [tTec, tEmp, tParc]) {
      expect((await post(t, '', { tenant_id: montese.tenantId, category: 'fisico', name: N('papel x') })).status).toBe(403);
      expect((await patch(t, `/${tenantHazId}`, { description: 'invasor' })).status).toBe(403);
      expect((await patch(t, `/${tenantHazId}/ativo`, { active: false })).status).toBe(403);
      expect((await post(t, `/${globalId}/duplicar`, { tenant_id: montese.tenantId, name: N('papel dup') })).status).toBe(403);
      expect((await post(t, '/importar', { itens: [{ category: 'fisico', name: N('papel imp') }] })).status).toBe(403);
      expect((await get(t, '/exportar')).status).toBe(403);
    }
    expect(await cnt()).toEqual(antes);
    expect((await db.client.query('SELECT active, description FROM pgr_hazards WHERE id = $1', [tenantHazId])).rows[0]).toEqual(snap);
    expect(await contar(`TESTE papel % ${sufixo}`)).toBe(0);
  });

  it('M-9: sócio só com pgr.write ⇒ 403 em importar e exportar', async () => {
    expect((await post(tSoWrite, '/importar', { itens: [{ category: 'fisico', name: N('sw imp') }] })).status).toBe(403);
    expect((await get(tSoWrite, '/exportar')).status).toBe(403);
    expect(await contar(N('sw imp'))).toBe(0);
  });

  it('M-2: psychosocial aceita só as 5 chaves (texto ≤2000); o banco limita o tamanho total', async () => {
    const ok = await post(tAdmin, '', { category: 'psicossocial', name: N('psico ok'), psychosocial: { jornada: 'texto', metas: 'm' } });
    expect(ok.status).toBe(201);
    expect(ok.body.psychosocial).toEqual({ jornada: 'texto', metas: 'm' });
    expect((await post(tAdmin, '', { category: 'psicossocial', name: N('psico x'), psychosocial: { qualquer: 'a' } })).status).toBe(400);
    expect((await post(tAdmin, '', { category: 'psicossocial', name: N('psico y'), psychosocial: { jornada: 'x'.repeat(2001) } })).status).toBe(400);
    expect((await patch(tAdmin, `/${ok.body.id}`, { psychosocial: { jornada: 5 } })).status).toBe(400);
    await expect(db.client.query(
      "INSERT INTO pgr_hazards (scope, category, name, psychosocial) VALUES ('global','psicossocial',$1,$2::jsonb)",
      [N('psico grande'), JSON.stringify({ a: 'x'.repeat(13000) })],
    )).rejects.toThrow();
  });

  it('filtros categoria e ativo; parâmetros inválidos ⇒ 400', async () => {
    const r = await get(tLeitor, `?q=${sufixo}&categoria=quimico`);
    expect(r.body.every((x: any) => x.category === 'quimico')).toBe(true);
    expect((await get(tLeitor, '?categoria=nada')).status).toBe(400);
    expect((await get(tLeitor, `?ativo=false&q=${sufixo}`)).body).toEqual([]);
  });

  it('sócio sem pgr.write não escreve (403)', async () => {
    const r = await post(tLeitor, '', { tenant_id: montese.tenantId, category: 'fisico', name: N('sem write') });
    expect(r.status).toBe(403);
    expect(await contar(N('sem write'))).toBe(0);
  });

  it('sócio cria perigo do tenant Montese (201); origem manual; global ⇒ 403 e nada gravado; parceiro ⇒ 404', async () => {
    const ok = await post(tEditor, '', { tenant_id: montese.tenantId, category: 'fisico', name: N('socio ok'), esocial_code: 'ABC' });
    expect(ok.status).toBe(201);
    expect(ok.body.scope).toBe('tenant');
    expect(ok.body.origin).toBe('manual');
    const g = await post(tEditor, '', { scope: 'global', category: 'fisico', name: N('socio global') });
    expect(g.status).toBe(403);
    const g2 = await post(tEditor, '', { category: 'fisico', name: N('socio global') });
    expect([400, 403]).toContain(g2.status);
    expect(await contar(N('socio global'))).toBe(0);
    const p = await post(tEditor, '', { tenant_id: parceiro.tenantId, category: 'fisico', name: N('socio parceiro') });
    expect(p.status).toBe(404);
    expect(await contar(N('socio parceiro'))).toBe(0);
  });

  it('admin cria global; validações: nome duplicado 409, esocial_code >20 400, categoria 400, campo extra 400', async () => {
    const ok = await post(tAdmin, '', { category: 'quimico', name: N('admin global') });
    expect(ok.status).toBe(201);
    expect(ok.body.scope).toBe('global');
    expect(ok.body.tenant_id).toBeNull();
    expect((await post(tAdmin, '', { category: 'quimico', name: N('ADMIN GLOBAL') })).status).toBe(409);
    expect((await post(tAdmin, '', { category: 'fisico', name: N('admin global') })).status).toBe(201);
    expect((await post(tAdmin, '', { category: 'fisico', name: N('cod longo'), esocial_code: 'x'.repeat(21) })).status).toBe(400);
    expect((await post(tAdmin, '', { category: 'inexistente', name: N('cat') })).status).toBe(400);
    expect((await post(tAdmin, '', { category: 'fisico', name: N('extra'), tenant_x: 1 })).status).toBe(400);
    expect(await contar(N('cod longo'))).toBe(0);
  });

  it('PATCH: corpo vazio 400; sócio edita o do tenant Montese; sócio não edita global; admin edita global', async () => {
    expect((await patch(tEditor, `/${tenantHazId}`, {})).status).toBe(400);
    const ok = await patch(tEditor, `/${tenantHazId}`, { description: 'desc de teste', esocial_code: null });
    expect(ok.status).toBe(200);
    expect(ok.body.description).toBe('desc de teste');
    expect((await get(tEditor, `/${tenantHazId}?tenantId=${montese.tenantId}`)).body.description).toBe('desc de teste');
    expect((await patch(tEditor, `/${globalId}`, { description: 'x' })).status).toBe(403);
    expect((await patch(tEditor, `/${parceiroHazId}`, { description: 'x' })).status).toBe(404);
    expect((await patch(tAdmin, `/${globalId}`, { description: 'global ed' })).status).toBe(200);
    expect((await patch(tAdmin, `/${globalId}`, { name: null })).status).toBe(400);
  });

  it('duplicar: sócio cria cópia tenant (origem duplicado); admin cria cópia global; 409 se o nome colide', async () => {
    const s = await post(tEditor, `/${globalId}/duplicar`, { tenant_id: montese.tenantId, name: N('copia socio') });
    expect(s.status).toBe(201);
    expect(s.body.scope).toBe('tenant');
    expect(s.body.tenant_id).toBe(montese.tenantId);
    expect(s.body.origin).toBe('duplicado');
    expect((await post(tEditor, `/${globalId}/duplicar`, {})).status).toBe(400); // sócio precisa informar a empresa
    const semFlag = await post(tAdmin, `/${tenantHazId}/duplicar`, { name: N('copia admin') });
    expect(semFlag.status).toBe(400);
    expect(await contar(N('copia admin'))).toBe(0);
    const a = await post(tAdmin, `/${tenantHazId}/duplicar`, { name: N('copia admin'), para_global: true });
    expect(a.status).toBe(201);
    expect(a.body.scope).toBe('global');
    expect((await post(tAdmin, `/${globalId}/duplicar`, { name: N('global base') })).status).toBe(409);
  });

  it('inativar não apaga e mantém a leitura; reativar; sócio não inativa global', async () => {
    const r = await patch(tEditor, `/${tenantHazId}/ativo`, { active: false });
    expect(r.status).toBe(200);
    expect(r.body.active).toBe(false);
    expect((await get(tLeitor, `/${tenantHazId}?tenantId=${montese.tenantId}`)).body.active).toBe(false);
    expect((await get(tLeitor, `?ativo=false&q=${sufixo}&tenantId=${montese.tenantId}`)).body.map((x: any) => x.id)).toContain(tenantHazId);
    expect((await patch(tEditor, `/${tenantHazId}/ativo`, { active: true })).body.active).toBe(true);
    expect((await patch(tEditor, `/${globalId}/ativo`, { active: false })).status).toBe(403);
    expect((await patch(tEditor, `/${tenantHazId}/ativo`, { active: 'sim' })).status).toBe(400);
  });

  it('exportar (JSON) lê com pgr.read; importar só admin', async () => {
    const e = await get(tLeitor, '/exportar');
    expect(e.status).toBe(200);
    expect(Array.isArray(e.body.itens)).toBe(true);
    expect(e.body.truncado).toBe(false);
    expect(e.body.itens.map((x: any) => x.name)).toContain(N('global base'));
    expect((await post(tEditor, '/importar', { itens: [{ category: 'fisico', name: N('imp socio') }] })).status).toBe(403);
    expect(await contar(N('imp socio'))).toBe(0);
  });

  it('importar com 1 linha inválida ⇒ 400, relatório lista a linha e NADA é gravado', async () => {
    const r = await post(tAdmin, '/importar', {
      itens: [
        { category: 'fisico', name: N('imp a') },
        { category: 'fisico', name: N('imp b'), esocial_code: 'x'.repeat(30) },
        { category: 'quimico', name: N('imp c') },
      ],
    });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.erros)).toContain('"linha":2');
    expect(r.body.erros).toHaveLength(1);
    expect(await contar(`TESTE imp % ${sufixo}`)).toBe(0);
    // colisão com item existente conta como erro da linha
    const c = await post(tAdmin, '/importar', { itens: [{ category: 'fisico', name: N('global base') }] });
    expect(c.status).toBe(400);
    expect(c.body.erros[0].linha).toBe(1);
  });

  it('importar válido grava tudo (origem importado); >500 ⇒ 400; vazio ⇒ 400', async () => {
    const r = await post(tAdmin, '/importar', { itens: [{ category: 'fisico', name: N('imp ok1') }, { category: 'psicossocial', name: N('imp ok2') }] });
    expect(r.status).toBe(201);
    expect(r.body.importados).toBe(2);
    const o = await db.client.query('SELECT DISTINCT origin FROM pgr_hazards WHERE name LIKE $1', [`TESTE imp ok% ${sufixo}`]);
    expect(o.rows).toEqual([{ origin: 'importado' }]);
    const muitos = Array.from({ length: 501 }, (_, i) => ({ category: 'fisico', name: N(`m${i}`) }));
    expect((await post(tAdmin, '/importar', { itens: muitos })).status).toBe(400);
    expect((await post(tAdmin, '/importar', { itens: [] })).status).toBe(400);
  });

  it('M-6: import ~500 itens (≥150 KB) passa; corpo >2 MB ⇒ 413; outras rotas seguem em 100 KB', async () => {
    const itens = Array.from({ length: 500 }, (_, i) => ({ category: 'ergonomico', name: N(`vol ${i}`), description: 'd'.repeat(300) }));
    expect(Buffer.byteLength(JSON.stringify({ itens }))).toBeGreaterThan(150 * 1024);
    const r = await post(tAdmin, '/importar', { itens });
    expect(r.status).toBe(201);
    expect(r.body.importados).toBe(500);
    const grande = await post(tAdmin, '/importar', { itens: [{ category: 'fisico', name: N('grande'), description: 'x'.repeat(2.2 * 1024 * 1024) }] });
    expect(grande.status).toBe(413);
    const outra = await post(tAdmin, '', { category: 'fisico', name: N('outra grande'), description: 'x'.repeat(150 * 1024) });
    expect([413, 500]).toContain(outra.status); // 100 KB global: recusado (o filtro global hoje devolve 500 p/ PayloadTooLarge)
    expect(await contar(N('outra grande'))).toBe(0);
  });

  it('auditoria pgr.hazard.* gravada, sem texto livre', async () => {
    const r = await db.client.query(
      `SELECT action, detail, path FROM audit_log WHERE actor_user_id = ANY($1) AND action LIKE 'pgr.hazard.%'`,
      [[sEditor.userId, admin.userId]],
    );
    const acoes = new Set(r.rows.map((x: any) => x.action));
    for (const a of ['pgr.hazard.created', 'pgr.hazard.updated', 'pgr.hazard.duplicated', 'pgr.hazard.toggled', 'pgr.hazard.imported']) {
      expect(acoes).toContain(a);
    }
    const todo = JSON.stringify(r.rows);
    expect(todo).not.toContain('desc de teste');
    expect(todo).not.toContain('global ed');
    expect(todo).not.toContain(sufixo);
    expect(r.rows.every((x: any) => x.path.startsWith(BASE))).toBe(true);
  });

  it('biblioteca vazia ⇒ lista []', async () => {
    expect((await get(tLeitor, `?q=${encodeURIComponent('zzz-inexistente-' + sufixo)}`)).body).toEqual([]);
  });
});
