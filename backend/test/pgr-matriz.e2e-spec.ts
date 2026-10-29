import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { R2Service } from '../src/common/r2/r2.service';
import { sha256Canonico } from '../src/atuacao/pgr/matriz/matriz-config';
import { TestDb, TestUserFixture } from './db-test-helper';
import { exigirSemResiduosDeTeste, MARCA_TESTE, removerVersoesDeTeste } from './pgr-matriz-test-util';

process.env.RATE_LIMIT_MAX = '5000';

// PGR B1, Task 3: API da matriz versionada (/atuacao/pgr/matriz). Config de TESTE, sem valor normativo; a matriz não tem semente.
describe('pgr-matriz — API da matriz de risco (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let admin: TestUserFixture;
  let tecnico: TestUserFixture;
  let sLeitor: TestUserFixture; // pgr.read
  let sEditor: TestUserFixture; // pgr.read + pgr.write
  let sSoWrite: TestUserFixture; // só pgr.write
  let sNada: TestUserFixture;
  let E: { tenantId: string; userId: string; email: string; password: string };
  let tAdmin: string, tTec: string, tLeitor: string, tEditor: string, tSoWrite: string, tNada: string, tEmp: string;
  const versoes: string[] = [];
  const sufixo = randomUUID().slice(0, 8);
  const marca = `${MARCA_TESTE}${sufixo}`;

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, p = '') => request(app.getHttpServer()).get(`/atuacao/pgr/matriz${p}`).set(auth(t));
  const post = (t: string, p: string, b: object = {}) => request(app.getHttpServer()).post(`/atuacao/pgr/matriz${p}`).set(auth(t)).send(b);
  const patch = (t: string, p: string, b: object) => request(app.getHttpServer()).patch(`/atuacao/pgr/matriz${p}`).set(auth(t)).send(b);
  const q = async (sql: string, p: unknown[] = []) => (await db.client.query(sql, p)).rows;
  const criar = async (body: object = {}) => {
    const r = await post(tAdmin, '', { notes: marca, ...body });
    if (r.status === 201) versoes.push(r.body.id);
    return r;
  };

  const cfg = () => ({
    severidade: [1, 2, 3].map((v) => ({ valor: v, rotulo: `TESTE sev ${v}`, descricao: 'TESTE' })),
    probabilidade: [1, 2, 3].map((v) => ({ valor: v, rotulo: `TESTE prob ${v}`, descricao: 'TESTE' })),
    niveis: [
      { id: 'n1', rotulo: 'TESTE nivel 1', aceitabilidade: 'TESTE', decisao: 'TESTE', bloqueia_emissao: false },
      { id: 'n2', rotulo: 'TESTE nivel 2', aceitabilidade: 'TESTE', decisao: 'TESTE', bloqueia_emissao: true },
    ],
    faixas: [{ min: 1, max: 3, nivel_id: 'n1' }, { min: 4, max: 9, nivel_id: 'n2' }],
    metodologia: { formula: 'severidade*probabilidade', validada_por: 'TESTE validador', data: '2026-01-01' },
  });
  const publicada = async (config: object = cfg()) => {
    const c = await criar({ config });
    expect(c.status).toBe(201);
    const p = await post(tAdmin, `/${c.body.id}/publicar`);
    expect(p.status).toBe(201);
    return p.body as { id: string; version_number: number };
  };

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
    await exigirSemResiduosDeTeste(db.client);
    admin = await db.createUserWithRole('admin', 'Admin Matriz');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Matriz');
    sLeitor = await db.createUserWithRole('socio', `Socio Matriz Leitor ${sufixo}`);
    sEditor = await db.createUserWithRole('socio', `Socio Matriz Editor ${sufixo}`);
    sSoWrite = await db.createUserWithRole('socio', `Socio Matriz SoWrite ${sufixo}`);
    sNada = await db.createUserWithRole('socio', `Socio Matriz Nada ${sufixo}`);
    E = await db.createTenantWithUser('Cliente Matriz E');
    await db.grantSocioPermission(sLeitor.userId, 'pgr.read');
    await db.grantSocioPermission(sEditor.userId, 'pgr.read');
    await db.grantSocioPermission(sEditor.userId, 'pgr.write');
    await db.grantSocioPermission(sSoWrite.userId, 'pgr.write');
    [tAdmin, tTec, tLeitor, tEditor, tSoWrite, tNada, tEmp] = await Promise.all([admin, tecnico, sLeitor, sEditor, sSoWrite, sNada, E].map(login));
  }, 90000);

  afterAll(async () => {
    try {
      const us = [admin.userId, sLeitor.userId, sEditor.userId, sSoWrite.userId, sNada.userId];
      await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [us]);
      await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
      await db.cleanup();
      await removerVersoesDeTeste(db.client, versoes); // só depois da limpeza dos tenants
    } finally {
      await db.disconnect();
      await app.close();
    }
  }, 60000);

  it('sem token ⇒ 401; empresa e técnico ⇒ 403; sócio sem pgr.read (nada ou só pgr.write) ⇒ 403', async () => {
    expect((await request(app.getHttpServer()).get('/atuacao/pgr/matriz')).status).toBe(401);
    for (const t of [tEmp, tTec, tNada, tSoWrite]) {
      expect((await get(t)).status).toBe(403);
      expect((await get(t, '/vigente')).status).toBe(403);
      expect((await get(t, `/${randomUUID()}`)).status).toBe(403);
    }
    expect((await get(tLeitor)).status).toBe(200);
  });

  it('só o admin escreve: sócio (inclusive read+write), empresa e técnico ⇒ 403 em criar/editar/publicar/arquivar/validar', async () => {
    const r = await criar({ config: cfg() });
    expect(r.status).toBe(201);
    const antes = await q('SELECT * FROM pgr_matrix_versions WHERE id = $1', [r.body.id]);
    const n = (await q('SELECT count(*)::int n FROM pgr_matrix_versions'))[0].n;
    for (const t of [tLeitor, tEditor, tSoWrite, tNada, tEmp, tTec]) {
      expect((await post(t, '', { config: cfg() })).status).toBe(403);
      expect((await patch(t, `/${r.body.id}`, { notes: 'x' })).status).toBe(403);
      expect((await post(t, `/${r.body.id}/publicar`)).status).toBe(403);
      expect((await post(t, `/${r.body.id}/arquivar`)).status).toBe(403);
      expect((await post(t, '/validar', { config: cfg() })).status).toBe(403);
    }
    expect((await q('SELECT count(*)::int n FROM pgr_matrix_versions'))[0].n).toBe(n);
    expect(await q('SELECT * FROM pgr_matrix_versions WHERE id = $1', [r.body.id])).toEqual(antes);
  });

  it('criar rascunho: nasce vazio (config {}), status rascunho, número = max+1, validação como aviso', async () => {
    const max = (await q('SELECT COALESCE(MAX(version_number),0)::int m FROM pgr_matrix_versions'))[0].m;
    const r = await criar();
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('rascunho');
    expect(r.body.version_number).toBe(max + 1);
    expect(r.body.config).toEqual({});
    expect(r.body.config_sha256).toBeNull();
    expect(r.body.validacao.pode_publicar).toBe(false);
    expect(r.body.validacao.erros.length).toBeGreaterThan(0);
  });

  it('concorrência: criações simultâneas nunca colidem (números distintos; sem 500)', async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => criar({ notes: `${marca} conc` })));
    for (const r of rs) expect([201, 409]).toContain(r.status);
    const ok = rs.filter((r) => r.status === 201);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const nums = ok.map((r) => r.body.version_number);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it('PATCH rascunho: guarda config incompleto e devolve erros/pendências; recusa não-objeto, nulo, extras e > 200000 bytes', async () => {
    const r = await criar();
    const id = r.body.id;
    const parcial = { severidade: [{ valor: 1, rotulo: 'TESTE', descricao: '' }] };
    const p = await patch(tAdmin, `/${id}`, { config: parcial, notes: `${marca} nota` });
    expect(p.status).toBe(200);
    expect(p.body.validacao.erros.length).toBeGreaterThan(0);
    expect(p.body.validacao.pode_publicar).toBe(false);
    expect((await q('SELECT config, notes FROM pgr_matrix_versions WHERE id = $1', [id]))[0]).toEqual({ config: parcial, notes: `${marca} nota` });

    const estado = await q('SELECT config FROM pgr_matrix_versions WHERE id = $1', [id]);
    for (const config of ['texto', 5, [], [1, 2]]) expect((await patch(tAdmin, `/${id}`, { config })).status).toBe(400);
    expect((await patch(tAdmin, `/${id}`, { config: null })).status).toBe(400);
    expect((await patch(tAdmin, `/${id}`, {})).status).toBe(400);
    expect((await patch(tAdmin, `/${id}`, { status: 'publicada' })).status).toBe(400);
    expect((await patch(tAdmin, `/${id}`, { config: parcial, config_sha256: 'a'.repeat(64) })).status).toBe(400);
    const grande = await patch(tAdmin, `/${id}`, { config: { lixo: 'a'.repeat(250000) } });
    expect(grande.status).toBe(400);
    const enorme = await patch(tAdmin, `/${id}`, { config: { lixo: 'a'.repeat(400000) } });
    expect(enorme.status).toBe(413);
    expect(await q('SELECT config FROM pgr_matrix_versions WHERE id = $1', [id])).toEqual(estado);
  });

  it('publicar com updated_at: rascunho alterado depois da leitura ⇒ 409 (continua rascunho); updated_at atual ⇒ 201', async () => {
    const r = await criar({ config: cfg() });
    const lido = r.body.updated_at as string;
    const p = await patch(tAdmin, `/${r.body.id}`, { notes: `${marca} mudou` });
    expect(p.status).toBe(200);
    expect(p.body.updated_at).not.toBe(lido);
    const velho = await post(tAdmin, `/${r.body.id}/publicar`, { updated_at: lido });
    expect(velho.status).toBe(409);
    expect(velho.body.message).toMatch(/foi alterado desde que você o abriu/);
    expect((await q('SELECT status FROM pgr_matrix_versions WHERE id = $1', [r.body.id]))[0].status).toBe('rascunho');
    expect((await post(tAdmin, `/${r.body.id}/publicar`, { updated_at: 'ontem' })).status).toBe(400);
    expect((await post(tAdmin, `/${r.body.id}/publicar`, { sha: 'x' })).status).toBe(400);
    expect((await post(tAdmin, `/${r.body.id}/publicar`, { updated_at: p.body.updated_at })).status).toBe(201);
  });

  it('config com chave desconhecida em qualquer nível: rascunho guarda com aviso, publicar ⇒ 400', async () => {
    const c: any = cfg();
    c.niveis[0].cor = 'vermelho';
    const r = await criar({ config: c });
    expect(r.body.validacao.erros.join(' ')).toMatch(/campo desconhecido "cor"/);
    const p = await post(tAdmin, `/${r.body.id}/publicar`);
    expect(p.status).toBe(400);
    expect(p.body.erros.join(' ')).toMatch(/campo desconhecido/);
  });

  it('limite de corpo: 300kb só em POST/PATCH da matriz (/, /validar, /:id); publicar/arquivar e outros usam o global (100kb)', async () => {
    const r = await criar({ config: cfg() });
    const grande = { config: { lixo: 'a'.repeat(150000) } }; // ~150 KB: acima do global, abaixo de 200000 bytes
    expect((await patch(tAdmin, `/${r.body.id}`, grande)).status).toBe(200);
    expect((await post(tAdmin, '/validar', grande)).status).toBe(201);
    expect((await criar(grande)).status).toBe(201);
    // Acima do limite global (100kb) o parser padrão recusa (esta aplicação responde 4xx/5xx de erro do parser; nunca 2xx) e nada muda.
    for (const res of [
      await post(tAdmin, `/${r.body.id}/publicar`, { updated_at: 'x'.repeat(150000) }),
      await post(tAdmin, `/${r.body.id}/arquivar`, { lixo: 'a'.repeat(150000) }),
      await request(app.getHttpServer()).delete(`/atuacao/pgr/matriz/${r.body.id}`).set(auth(tAdmin)).send(grande),
    ]) expect(res.status).toBeGreaterThanOrEqual(400);
    // arquivar de rascunho daria 409 se o corpo passasse; 413/500 prova que o parser global o recusou antes
    expect([413, 500]).toContain((await post(tAdmin, `/${r.body.id}/arquivar`, { lixo: 'a'.repeat(150000) })).status);
    expect((await q('SELECT status FROM pgr_matrix_versions WHERE id = $1', [r.body.id]))[0].status).toBe('rascunho');
  });

  it('publicar inválido ⇒ 400 com erros/pendências e continua rascunho (sem hash)', async () => {
    const r = await criar({ config: { ...cfg(), faixas: [{ min: 1, max: 3, nivel_id: 'n1' }] } }); // lacuna 4–9
    const p = await post(tAdmin, `/${r.body.id}/publicar`);
    expect(p.status).toBe(400);
    expect(p.body.erros.join(' ')).toMatch(/Lacuna/);
    expect(Array.isArray(p.body.pendencias)).toBe(true);
    const sem = await criar({ config: { ...cfg(), metodologia: { formula: 'severidade*probabilidade' } } }); // pendência da metodologia
    const p2 = await post(tAdmin, `/${sem.body.id}/publicar`);
    expect(p2.status).toBe(400);
    expect(p2.body.pendencias.length).toBeGreaterThan(0);
    for (const id of [r.body.id, sem.body.id]) {
      expect((await q('SELECT status, config_sha256, published_by, published_at FROM pgr_matrix_versions WHERE id = $1', [id]))[0])
        .toEqual({ status: 'rascunho', config_sha256: null, published_by: null, published_at: null });
    }
  });

  it('publicar válido: sha256 do JSON canônico, published_by/at; imutável pela API (PATCH/republicar ⇒ 409, banco intacto)', async () => {
    const v = await publicada();
    const row = (await q('SELECT * FROM pgr_matrix_versions WHERE id = $1', [v.id]))[0];
    expect(row.status).toBe('publicada');
    expect(row.config_sha256).toBe(sha256Canonico(row.config));
    expect(row.published_by).toBe(admin.userId);
    expect(row.published_at).toBeTruthy();
    expect((await patch(tAdmin, `/${v.id}`, { config: {} })).status).toBe(409);
    expect((await patch(tAdmin, `/${v.id}`, { notes: 'mudou' })).status).toBe(409);
    expect((await post(tAdmin, `/${v.id}/publicar`)).status).toBe(409);
    expect(await q('SELECT * FROM pgr_matrix_versions WHERE id = $1', [v.id])).toEqual([row]);
    expect((await request(app.getHttpServer()).delete(`/atuacao/pgr/matriz/${v.id}`).set(auth(tAdmin))).status).toBe(404); // sem DELETE
  });

  it('vigente = MAIOR version_number; arquivar a vigente promove a anterior; publicar número menor que o de uma publicada ⇒ 409', async () => {
    const x = await criar({ config: cfg() });
    const y = await criar({ config: cfg() });
    expect(y.body.version_number).toBeGreaterThan(x.body.version_number);
    expect((await post(tAdmin, `/${x.body.id}/publicar`)).status).toBe(201);
    expect((await post(tAdmin, `/${y.body.id}/publicar`)).status).toBe(201);
    let v = await get(tLeitor, '/vigente');
    expect(v.status).toBe(200);
    expect(v.body.id).toBe(y.body.id);
    expect(v.body.config.severidade).toHaveLength(3);
    expect((await post(tAdmin, `/${y.body.id}/arquivar`)).status).toBe(201);
    v = await get(tLeitor, '/vigente');
    expect(v.body.id).toBe(x.body.id);
  });

  it('publicar rascunho de número MENOR que o de uma publicada ⇒ 409 pt-BR e continua rascunho; copiar_de gera a saída', async () => {
    const velho = await criar({ config: cfg() });
    const novo = await publicada(); // número maior, publicada
    expect(novo.version_number).toBeGreaterThan(velho.body.version_number);
    const p = await post(tAdmin, `/${velho.body.id}/publicar`);
    expect(p.status).toBe(409);
    expect(p.body.message).toBe('Existe uma versão publicada mais nova; crie uma nova versão a partir desta (copiar_de).');
    expect((await q('SELECT status FROM pgr_matrix_versions WHERE id = $1', [velho.body.id]))[0].status).toBe('rascunho');
    const c = await criar({ copiar_de: velho.body.id });
    expect((await post(tAdmin, `/${c.body.id}/publicar`)).status).toBe(201);
  });

  it('arquivar: rascunho ⇒ 409; publicada ⇒ arquivada; de novo ⇒ 409; arquivada imutável', async () => {
    const r = await criar({ config: cfg() });
    expect((await post(tAdmin, `/${r.body.id}/arquivar`)).status).toBe(409);
    expect((await post(tAdmin, `/${r.body.id}/publicar`)).status).toBe(201);
    const a = await post(tAdmin, `/${r.body.id}/arquivar`);
    expect(a.status).toBe(201);
    expect(a.body.status).toBe('arquivada');
    expect((await post(tAdmin, `/${r.body.id}/arquivar`)).status).toBe(409);
    expect((await patch(tAdmin, `/${r.body.id}`, { notes: 'x' })).status).toBe(409);
    expect((await post(tAdmin, `/${r.body.id}/publicar`)).status).toBe(409);
  });

  it('sócio só vê publicada/arquivada (sem rascunho nem ids de usuários); admin vê todas; ids inexistentes/malformados', async () => {
    const rasc = await criar({ config: cfg() });
    const pub = await publicada();
    const lista = await get(tLeitor);
    expect(lista.status).toBe(200);
    const ids = lista.body.map((x: any) => x.id);
    expect(ids).toContain(pub.id);
    expect(ids).not.toContain(rasc.body.id);
    expect(lista.body.every((x: any) => ['publicada', 'arquivada'].includes(x.status))).toBe(true);
    expect(lista.body.every((x: any) => !('config' in x) && !('created_by' in x) && !('published_by' in x))).toBe(true);
    const adm = await get(tAdmin);
    expect(adm.body.map((x: any) => x.id)).toEqual(expect.arrayContaining([rasc.body.id, pub.id]));
    expect((await get(tLeitor, `/${rasc.body.id}`)).status).toBe(404); // rascunho invisível ao sócio
    const d = await get(tLeitor, `/${pub.id}`);
    expect(d.status).toBe(200);
    expect(d.body.config.niveis).toHaveLength(2);
    expect('created_by' in d.body).toBe(false);
    expect((await get(tAdmin, `/${rasc.body.id}`)).status).toBe(200);
    expect((await get(tAdmin, `/${randomUUID()}`)).status).toBe(404);
    expect((await get(tAdmin, '/nao-e-uuid')).status).toBe(400);
  });

  it('copiar_de duplica o config; copiar_de + config ⇒ 400; origem inexistente ⇒ 404', async () => {
    const pub = await publicada();
    const c = await criar({ copiar_de: pub.id });
    expect(c.status).toBe(201);
    expect(c.body.status).toBe('rascunho');
    expect(c.body.config).toEqual(cfg());
    expect(c.body.validacao.pode_publicar).toBe(true);
    expect((await post(tAdmin, '', { copiar_de: pub.id, config: cfg() })).status).toBe(400);
    expect((await post(tAdmin, '', { copiar_de: randomUUID() })).status).toBe(404);
    expect((await post(tAdmin, '', { copiar_de: 'x' })).status).toBe(400);
  });

  it('POST validar: sem persistência; devolve erros/pendências/células; não-objeto ⇒ 400', async () => {
    const n = (await q('SELECT count(*)::int n FROM pgr_matrix_versions'))[0].n;
    const ok = await post(tAdmin, '/validar', { config: cfg(), publicar: true });
    expect(ok.status).toBe(201);
    expect(ok.body.ok).toBe(true);
    expect(ok.body.celulas).toHaveLength(9);
    const ruim = await post(tAdmin, '/validar', { config: { ...cfg(), faixas: [] } });
    expect(ruim.body.ok).toBe(false);
    expect(ruim.body.erros.join(' ')).toMatch(/Lacuna/);
    const pend = await post(tAdmin, '/validar', { config: { ...cfg(), metodologia: undefined }, publicar: true });
    expect(pend.body.ok).toBe(false);
    expect(pend.body.pendencias.length).toBeGreaterThan(0);
    const sopend = await post(tAdmin, '/validar', { config: { ...cfg(), metodologia: undefined } });
    expect(sopend.body.ok).toBe(true); // rascunho aceita pendência
    expect(sopend.body.pode_publicar).toBe(false);
    for (const config of ['x', [], null]) expect((await post(tAdmin, '/validar', { config })).status).toBe(400);
    expect((await post(tAdmin, '/validar', {})).status).toBe(400);
    expect((await q('SELECT count(*)::int n FROM pgr_matrix_versions'))[0].n).toBe(n);
  });

  it('auditoria: pgr.matrix.* com path da rota e só ids/hash (sem texto livre)', async () => {
    const r = await q(
      `SELECT action, detail, path, resource_id, resource_type FROM audit_log WHERE actor_user_id = $1 AND action LIKE 'pgr.matrix.%'`,
      [admin.userId],
    );
    const acoes = new Set(r.map((x: any) => x.action));
    for (const a of ['pgr.matrix.created', 'pgr.matrix.updated', 'pgr.matrix.published', 'pgr.matrix.archived']) expect(acoes).toContain(a);
    const todo = JSON.stringify(r);
    for (const proibido of ['TESTE', 'conc']) expect(todo).not.toContain(proibido);
    expect(r.every((x: any) => x.path.startsWith('/atuacao/pgr/matriz') && x.resource_id && x.resource_type === 'pgr_matrix_version')).toBe(true);
  });

  it('auditoria fail-closed: falha ao gravar audit_log ⇒ 500 e nada persiste (criar, editar, publicar, arquivar)', async () => {
    const pub = await publicada();
    const rasc = await criar({ config: cfg() }); // criado DEPOIS: número maior que o da publicada (senão publicar daria 409)
    await db.client.query(`CREATE FUNCTION public.tmp_falha_auditoria_matriz() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action LIKE 'pgr.matrix.%' THEN RAISE EXCEPTION 'falha simulada'; END IF; RETURN NEW; END $$`);
    await db.client.query('CREATE TRIGGER tmp_falha_auditoria_matriz BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION public.tmp_falha_auditoria_matriz()');
    try {
      const estado = () => q('SELECT * FROM pgr_matrix_versions ORDER BY id');
      const antes = await estado();
      expect((await post(tAdmin, '', { config: cfg() })).status).toBe(500);
      expect((await patch(tAdmin, `/${rasc.body.id}`, { notes: 'nao pode ficar' })).status).toBe(500);
      expect((await post(tAdmin, `/${rasc.body.id}/publicar`)).status).toBe(500);
      expect((await post(tAdmin, `/${pub.id}/arquivar`)).status).toBe(500);
      expect(await estado()).toEqual(antes);
    } finally {
      await db.client.query('DROP TRIGGER IF EXISTS tmp_falha_auditoria_matriz ON audit_log');
      await db.client.query('DROP FUNCTION IF EXISTS public.tmp_falha_auditoria_matriz()');
    }
  });
});
