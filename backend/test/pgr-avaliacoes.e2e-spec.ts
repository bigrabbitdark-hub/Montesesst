import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb, TestUserFixture } from './db-test-helper';
import { exigirSemResiduosDeTeste, MARCA_TESTE, removerVersoesDeTeste } from './pgr-matriz-test-util';

process.env.RATE_LIMIT_MAX = '5000';

// PGR B1, Task 3: avaliações de risco (inerente / residual previsto) e mapa de calor. Config de TESTE, sem valor normativo.
describe('pgr-avaliacoes — avaliações e mapa de calor (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let admin: TestUserFixture;
  let tecnico: TestUserFixture;
  let sLeitor: TestUserFixture; // pgr.read
  let sEditor: TestUserFixture; // pgr.read + pgr.write
  let sSoWrite: TestUserFixture; // só pgr.write
  let sNada: TestUserFixture;
  let A: { tenantId: string; userId: string; email: string; password: string };
  let B: typeof A;
  let P: typeof A;
  let tAdmin: string, tTec: string, tLeitor: string, tEditor: string, tSoWrite: string, tNada: string, tEmp: string;
  let rA1: string, rA2: string, rA3: string, rA4: string, rB: string, rP: string;
  let M1: { id: string; n: number };
  let M2: { id: string; n: number };
  const versoes: string[] = [];
  const sufixo = randomUUID().slice(0, 8);
  const marca = `${MARCA_TESTE}${sufixo}`;

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const url = (tenant: string, p = '') => `/atuacao/pgr/empresas/${tenant}${p}`;
  const get = (t: string, tenant: string, p = '') => request(app.getHttpServer()).get(url(tenant, p)).set(auth(t));
  const post = (t: string, tenant: string, p: string, b: object) => request(app.getHttpServer()).post(url(tenant, p)).set(auth(t)).send(b);
  const q = async (sql: string, p: unknown[] = []) => (await db.client.query(sql, p)).rows;
  const aval = (t: string, tenant: string, risco: string, b: object) => post(t, tenant, `/riscos/${risco}/avaliacoes`, b);
  const corpo = (extra: object = {}) => ({ kind: 'inerente', severity_value: 2, probability_value: 3, justification: 'TESTE motivo da classificação', ...extra });

  const cfg1 = () => ({
    severidade: [1, 2, 3].map((v) => ({ valor: v, rotulo: `TESTE sev ${v}`, descricao: 'TESTE' })),
    probabilidade: [1, 2, 3].map((v) => ({ valor: v, rotulo: `TESTE prob ${v}`, descricao: 'TESTE' })),
    niveis: [
      { id: 'n1', rotulo: 'TESTE nivel 1', aceitabilidade: 'TESTE', decisao: 'TESTE', bloqueia_emissao: false },
      { id: 'n2', rotulo: 'TESTE nivel 2', aceitabilidade: 'TESTE', decisao: 'TESTE', bloqueia_emissao: true },
    ],
    faixas: [{ min: 1, max: 3, nivel_id: 'n1' }, { min: 4, max: 9, nivel_id: 'n2' }],
    metodologia: { formula: 'severidade*probabilidade', validada_por: 'TESTE validador', data: '2026-01-01' },
  });
  // Escala não quadrada e faixas diferentes: 2 x 4.
  const cfg2 = () => ({
    severidade: [1, 2].map((v) => ({ valor: v, rotulo: `TESTE sev ${v}`, descricao: 'TESTE' })),
    probabilidade: [1, 2, 3, 4].map((v) => ({ valor: v, rotulo: `TESTE prob ${v}`, descricao: 'TESTE' })),
    niveis: [
      { id: 'baixo', rotulo: 'TESTE baixo', aceitabilidade: 'TESTE', decisao: 'TESTE', bloqueia_emissao: false },
      { id: 'alto', rotulo: 'TESTE alto', aceitabilidade: 'TESTE', decisao: 'TESTE', bloqueia_emissao: true },
    ],
    faixas: [{ min: 1, max: 2, nivel_id: 'baixo' }, { min: 3, max: 8, nivel_id: 'alto' }],
    metodologia: { formula: 'severidade*probabilidade', validada_por: 'TESTE validador', data: '2026-02-02' },
  });
  const publicar = async (config: object) => {
    const c = await request(app.getHttpServer()).post('/atuacao/pgr/matriz').set(auth(tAdmin)).send({ config, notes: marca });
    expect(c.status).toBe(201);
    versoes.push(c.body.id);
    const p = await request(app.getHttpServer()).post(`/atuacao/pgr/matriz/${c.body.id}/publicar`).set(auth(tAdmin));
    expect(p.status).toBe(201);
    return { id: c.body.id as string, n: c.body.version_number as number };
  };
  const risco = async (tenantId: string, nome: string) => {
    const ghe = await db.insertRawRow('pgr_ghes', { tenant_id: tenantId, name: `TESTE GHE ${nome} ${sufixo}` });
    return db.insertRawRow('pgr_risks', { tenant_id: tenantId, ghe_id: ghe, category: 'fisico', name: `TESTE Risco ${nome} ${sufixo}`, exposure_type: 'eventual' });
  };
  const nAval = async (riscoId?: string) => (await q(`SELECT count(*)::int n FROM pgr_risk_assessments ${riscoId ? 'WHERE risk_id = $1' : ''}`, riscoId ? [riscoId] : []))[0].n as number;

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
    admin = await db.createUserWithRole('admin', 'Admin Aval');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Aval');
    sLeitor = await db.createUserWithRole('socio', `Socio Aval Leitor ${sufixo}`);
    sEditor = await db.createUserWithRole('socio', `Socio Aval Editor ${sufixo}`);
    sSoWrite = await db.createUserWithRole('socio', `Socio Aval SoWrite ${sufixo}`);
    sNada = await db.createUserWithRole('socio', `Socio Aval Nada ${sufixo}`);
    A = await db.createTenantWithUser('Cliente Montese Aval A');
    B = await db.createTenantWithUser('Cliente Montese Aval B');
    P = await db.createTenantWithUser('Cliente Parceiro Aval');
    await db.grantSocioPermission(sLeitor.userId, 'pgr.read');
    await db.grantSocioPermission(sEditor.userId, 'pgr.read');
    await db.grantSocioPermission(sEditor.userId, 'pgr.write');
    await db.grantSocioPermission(sSoWrite.userId, 'pgr.write');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [P.tenantId, tec.rows[0].id]);
    [rA1, rA2, rA3, rA4] = await Promise.all(['A1', 'A2', 'A3', 'A4'].map((n) => risco(A.tenantId, n)));
    rB = await risco(B.tenantId, 'B');
    rP = await risco(P.tenantId, 'P');
    [tAdmin, tTec, tLeitor, tEditor, tSoWrite, tNada, tEmp] = await Promise.all([admin, tecnico, sLeitor, sEditor, sSoWrite, sNada, A].map(login));
  }, 90000);

  afterAll(async () => {
    try {
      const us = [admin.userId, sLeitor.userId, sEditor.userId, sSoWrite.userId, sNada.userId];
      await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [us]);
      await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
      await db.cleanup(); // cascata do tenant leva riscos e avaliações (append-only só cai em cascata)
      await removerVersoesDeTeste(db.client, versoes); // só depois da limpeza dos tenants
    } finally {
      await db.disconnect();
      await app.close();
    }
  }, 60000);

  it('sem matriz publicada e sem versão informada ⇒ 409 "Aguardando matriz publicada pela equipe técnica." (banco descartável sem publicadas)', async () => {
    // Banco descartável do ensaio: precisa estar sem publicadas. Se não estiver, o teste FALHA (nada de passar em silêncio);
    // o caminho também é coberto de forma determinística no unit (pgr-matriz-service.unit-spec).
    const pubs = (await q("SELECT count(*)::int n FROM pgr_matrix_versions WHERE status = 'publicada'"))[0].n;
    expect(pubs).toBe(0);
    const r = await aval(tEditor, A.tenantId, rA1, corpo());
    expect(r.status).toBe(409);
    expect(r.body.message).toBe('Aguardando matriz publicada pela equipe técnica.');
    expect((await get(tEditor, A.tenantId, '/mapa-calor?kind=inerente')).status).toBe(409);
    expect(await nAval(rA1)).toBe(0);
    M1 = await publicar(cfg1());
  });

  it('permissões: só pgr.write / nada / empresa / técnico ⇒ 403; leitor lê mas não escreve; sem token ⇒ 401', async () => {
    expect((await request(app.getHttpServer()).get(url(A.tenantId, `/riscos/${rA1}/avaliacoes`))).status).toBe(401);
    for (const t of [tSoWrite, tNada, tEmp, tTec]) {
      expect((await get(t, A.tenantId, `/riscos/${rA1}/avaliacoes`)).status).toBe(403);
      expect((await get(t, A.tenantId, '/mapa-calor?kind=inerente')).status).toBe(403);
      expect((await aval(t, A.tenantId, rA1, corpo())).status).toBe(403);
    }
    expect((await get(tLeitor, A.tenantId, `/riscos/${rA1}/avaliacoes`)).status).toBe(200);
    expect((await aval(tLeitor, A.tenantId, rA1, corpo())).status).toBe(403);
    expect(await nAval(rA1)).toBe(0);
  });

  it('classificar: servidor calcula escore/nível (cliente não envia), grava versão exata e justificativa aparada; auditoria só com ids', async () => {
    const r = await aval(tEditor, A.tenantId, rA1, corpo({ justification: '   TESTE motivo secreto   ' }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: 'inerente', matrix_version_id: M1.id, matrix_version_number: M1.n, severity_value: 2, probability_value: 3, score: 6, level_id: 'n2' });
    expect(r.body.nivel).toMatchObject({ id: 'n2', bloqueia_emissao: true });
    expect(r.body.justification).toBe('TESTE motivo secreto');
    expect(r.body).not.toHaveProperty('assessed_by'); // sócio não recebe o id do avaliador
    const row = (await q('SELECT * FROM pgr_risk_assessments WHERE id = $1', [r.body.id]))[0];
    expect(row).toMatchObject({ tenant_id: A.tenantId, risk_id: rA1, matrix_version_id: M1.id, score: 6, level_id: 'n2', assessed_by: sEditor.userId });
    const a = await q(`SELECT action, detail, resource_id, path FROM audit_log WHERE action = 'pgr.assessment.created' AND resource_id = $1`, [r.body.id]);
    expect(a).toHaveLength(1);
    expect(JSON.stringify(a)).not.toMatch(/secreto|TESTE/);
    expect(a[0].path).toBe(`/atuacao/pgr/empresas/${A.tenantId}/riscos/${rA1}/avaliacoes`);
    // admin também classifica
    const adm = await aval(tAdmin, A.tenantId, rA4, corpo({ kind: 'residual_previsto', severity_value: 1, probability_value: 1 }));
    expect(adm.status).toBe(201);
    expect(adm.body.assessed_by).toBe(admin.userId); // admin continua vendo o autor
  });

  it('cliente não decide escore/nível: score, level_id, nivel e campos extras ⇒ 400 e nada gravado', async () => {
    const antes = await nAval();
    for (const extra of [{ score: 1 }, { level_id: 'n1' }, { nivel: 'n1' }, { assessed_by: randomUUID() }, { tenant_id: B.tenantId }, { risk_id: rB }]) {
      expect((await aval(tEditor, A.tenantId, rA1, corpo(extra))).status).toBe(400);
    }
    expect(await nAval()).toBe(antes);
  });

  it('justificativa obrigatória (ausente, vazia, só espaços, > 4000) e valores inválidos ⇒ 400 com mensagem precisa', async () => {
    const antes = await nAval();
    const semJ: any = corpo(); delete semJ.justification;
    for (const b of [semJ, corpo({ justification: '' }), corpo({ justification: '   \n ' }), corpo({ justification: 'x'.repeat(4001) })]) {
      expect((await aval(tEditor, A.tenantId, rA1, b)).status).toBe(400);
    }
    expect((await aval(tEditor, A.tenantId, rA1, corpo({ justification: 'x'.repeat(4000) }))).status).toBe(201); // limite exato
    for (const b of [corpo({ kind: 'outro' }), corpo({ severity_value: 1.5 }), corpo({ severity_value: '2' }), corpo({ probability_value: 0 }), corpo({ probability_value: null })]) {
      expect((await aval(tEditor, A.tenantId, rA1, b)).status).toBe(400);
    }
    const fora = await aval(tEditor, A.tenantId, rA1, corpo({ severity_value: 4 }));
    expect(fora.status).toBe(400);
    expect(fora.body.message).toMatch(/Severidade 4 fora da escala.*1, 2, 3/);
    const fora2 = await aval(tEditor, A.tenantId, rA1, corpo({ probability_value: 9 }));
    expect(fora2.body.message).toMatch(/Probabilidade 9 fora da escala/);
    expect(await nAval()).toBe(antes + 1);
  });

  it('matrix_version_id: rascunho, inexistente ⇒ 400; sócio nem enxerga rascunho; versão informada publicada é usada', async () => {
    const r = await request(app.getHttpServer()).post('/atuacao/pgr/matriz').set(auth(tAdmin)).send({ config: cfg1(), notes: marca });
    versoes.push(r.body.id);
    const antes = await nAval();
    for (const t of [tEditor, tAdmin]) {
      expect((await aval(t, A.tenantId, rA2, corpo({ matrix_version_id: r.body.id }))).status).toBe(400);
    }
    expect((await aval(tEditor, A.tenantId, rA2, corpo({ matrix_version_id: randomUUID() }))).status).toBe(400);
    expect((await aval(tEditor, A.tenantId, rA2, corpo({ matrix_version_id: 'x' }))).status).toBe(400);
    expect(await nAval()).toBe(antes);
    const ok = await aval(tEditor, A.tenantId, rA2, corpo({ matrix_version_id: M1.id }));
    expect(ok.status).toBe(201);
    expect(ok.body.matrix_version_id).toBe(M1.id);
  });

  it('parceiro ⇒ 404 para TODOS os papéis (admin e sócio com permissão) em listar, classificar e mapa de calor; nada gravado', async () => {
    for (const t of [tAdmin, tEditor, tLeitor]) {
      expect((await get(t, P.tenantId, `/riscos/${rP}/avaliacoes`)).status).toBe(404);
      expect((await get(t, P.tenantId, '/mapa-calor?kind=inerente')).status).toBe(404);
    }
    for (const t of [tAdmin, tEditor]) expect((await aval(t, P.tenantId, rP, corpo())).status).toBe(404);
    expect(await nAval(rP)).toBe(0);
  });

  it('IDOR entre dois clientes Montese: risco de B pela URL de A ⇒ 404 (GET e POST); nada gravado; mapa de A não conta B', async () => {
    for (const t of [tAdmin, tEditor]) {
      expect((await aval(t, A.tenantId, rB, corpo())).status).toBe(404);
      expect((await aval(t, B.tenantId, rA1, corpo())).status).toBe(404);
    }
    expect((await get(tEditor, A.tenantId, `/riscos/${rB}/avaliacoes`)).status).toBe(404);
    expect((await get(tEditor, B.tenantId, `/riscos/${rA1}/avaliacoes`)).status).toBe(404);
    expect((await get(tEditor, A.tenantId, `/riscos/${randomUUID()}/avaliacoes`)).status).toBe(404);
    expect((await get(tEditor, A.tenantId, '/riscos/x/avaliacoes')).status).toBe(400);
    expect(await nAval(rB)).toBe(0);
    expect((await aval(tEditor, B.tenantId, rB, corpo())).status).toBe(201); // B legítimo funciona
    const mapaA = await get(tEditor, A.tenantId, '/mapa-calor?kind=inerente');
    expect(mapaA.body.total_riscos).toBe(4); // rA1..rA4, nunca o de B
    expect(await nAval(rB)).toBe(1);
  });

  it('histórico append-only: nova avaliação do mesmo tipo vira a vigente e o histórico é mantido; residual é independente; sem PUT/PATCH/DELETE', async () => {
    const r1 = await aval(tEditor, A.tenantId, rA3, corpo({ severity_value: 1, probability_value: 1, justification: 'TESTE primeira' }));
    const r2 = await aval(tEditor, A.tenantId, rA3, corpo({ severity_value: 3, probability_value: 3, justification: 'TESTE segunda' }));
    const rr = await aval(tEditor, A.tenantId, rA3, corpo({ kind: 'residual_previsto', severity_value: 1, probability_value: 2, justification: 'TESTE residual' }));
    expect([r1.status, r2.status, rr.status]).toEqual([201, 201, 201]);
    const h = await get(tLeitor, A.tenantId, `/riscos/${rA3}/avaliacoes`);
    expect(h.status).toBe(200);
    expect(h.body.historico).toHaveLength(3);
    for (const x of h.body.historico) expect(x).not.toHaveProperty('assessed_by'); // sócio
    expect(h.body.vigente.inerente).not.toHaveProperty('assessed_by');
    const ha = await get(tAdmin, A.tenantId, `/riscos/${rA3}/avaliacoes`);
    expect(ha.body.historico.every((x: any) => x.assessed_by === sEditor.userId)).toBe(true); // admin vê o autor

    expect(h.body.historico[0].id).toBe(rr.body.id);
    expect(h.body.vigente.inerente.id).toBe(r2.body.id);
    expect(h.body.vigente.inerente.score).toBe(9);
    expect(h.body.vigente.inerente.nivel.rotulo).toBe('TESTE nivel 2');
    expect(h.body.vigente.residual_previsto.id).toBe(rr.body.id);
    expect((await q('SELECT score FROM pgr_risk_assessments WHERE id = $1', [r1.body.id]))[0].score).toBe(1); // antiga intacta
    const base = `${url(A.tenantId)}/riscos/${rA3}/avaliacoes`;
    for (const m of ['put', 'patch', 'delete'] as const) {
      expect([404]).toContain((await (request(app.getHttpServer()) as any)[m](`${base}/${r1.body.id}`).set(auth(tAdmin)).send({})).status);
    }
    const vazio = await get(tLeitor, A.tenantId, `/riscos/${rA2}/avaliacoes`);
    expect(vazio.body.vigente.residual_previsto).toBeNull();
  });

  it('DELETE de risco com avaliações ⇒ 409 em pt-BR (risco e avaliações intactos); sem avaliações ⇒ 200', async () => {
    const antes = await nAval(rA1);
    expect(antes).toBeGreaterThan(0);
    const d = await request(app.getHttpServer()).delete(url(A.tenantId, `/riscos/${rA1}`)).set(auth(tEditor));
    expect(d.status).toBe(409);
    expect(d.body.message).toMatch(/avaliações registradas/);
    expect((await q('SELECT 1 FROM pgr_risks WHERE id = $1', [rA1])).length).toBe(1);
    expect(await nAval(rA1)).toBe(antes);
    const livre = await risco(A.tenantId, 'livre');
    expect((await request(app.getHttpServer()).delete(url(A.tenantId, `/riscos/${livre}`)).set(auth(tEditor))).status).toBe(200);
  });

  it('auditoria fail-closed: falha ao gravar audit_log ⇒ 500 e a avaliação NÃO persiste', async () => {
    await db.client.query(`CREATE FUNCTION public.tmp_falha_auditoria_aval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action LIKE 'pgr.assessment.%' THEN RAISE EXCEPTION 'falha simulada'; END IF; RETURN NEW; END $$`);
    await db.client.query('CREATE TRIGGER tmp_falha_auditoria_aval BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION public.tmp_falha_auditoria_aval()');
    try {
      const antes = await nAval();
      expect((await aval(tEditor, A.tenantId, rA2, corpo({ justification: 'nao pode ficar' }))).status).toBe(500);
      expect((await aval(tAdmin, A.tenantId, rA2, corpo({ justification: 'nao pode ficar' }))).status).toBe(500);
      expect(await nAval()).toBe(antes);
      expect((await q("SELECT 1 FROM pgr_risk_assessments WHERE justification = 'nao pode ficar'")).length).toBe(0);
    } finally {
      await db.client.query('DROP TRIGGER IF EXISTS tmp_falha_auditoria_aval ON audit_log');
      await db.client.query('DROP FUNCTION IF EXISTS public.tmp_falha_auditoria_aval()');
    }
  });

  it('mapa de calor (versão M1): contagem por célula usa a avaliação vigente de cada risco; sem avaliação e outra versão separados', async () => {
    // Estado de A (inerente, M1): rA1 vigente 2x3 (última antes das de 4000 chars: ver abaixo), rA2 2x3, rA3 3x3 (reavaliada), rA4 só residual.
    await aval(tEditor, A.tenantId, rA1, corpo({ severity_value: 3, probability_value: 1, justification: 'TESTE reavaliado' })); // rA1 passa a 3x1
    const m = await get(tLeitor, A.tenantId, `/mapa-calor?kind=inerente&matrix_version_id=${M1.id}`);
    expect(m.status).toBe(200);
    expect(m.body.matrix_version).toMatchObject({ id: M1.id, version_number: M1.n, status: 'publicada' });
    expect(m.body.cells).toHaveLength(9);
    const cel = (s: number, p: number) => m.body.cells.find((c: any) => c.severidade === s && c.probabilidade === p);
    expect(cel(3, 1)).toMatchObject({ quantidade: 1, score: 3, nivel_id: 'n1' }); // rA1 (a de 2x3 foi substituída)
    expect(cel(2, 3)).toMatchObject({ quantidade: 1, score: 6, nivel_id: 'n2' }); // rA2
    expect(cel(3, 3)).toMatchObject({ quantidade: 1 }); // rA3
    expect(m.body.cells.reduce((s: number, c: any) => s + c.quantidade, 0)).toBe(3);
    expect(m.body).toMatchObject({ total_riscos: 4, classificados: 3, em_outra_versao: 0, sem_avaliacao: 1, por_versao: [{ version_number: M1.n, n: 3 }] }); // rA4 só tem residual
    const r = await get(tLeitor, A.tenantId, `/mapa-calor?kind=residual_previsto&matrix_version_id=${M1.id}`);
    expect(r.body).toMatchObject({ total_riscos: 4, classificados: 2, sem_avaliacao: 2 }); // rA3 e rA4
    expect(r.body.cells.find((c: any) => c.severidade === 1 && c.probabilidade === 1).quantidade).toBe(1);
    // padrão = vigente (M1 por enquanto)
    expect((await get(tLeitor, A.tenantId, '/mapa-calor?kind=inerente')).body.matrix_version.id).toBe(M1.id);
  });

  it('mapa de calor: parâmetros inválidos ⇒ 400 (kind ausente/inválido, versão rascunho/inexistente/malformada)', async () => {
    const rasc = (await request(app.getHttpServer()).post('/atuacao/pgr/matriz').set(auth(tAdmin)).send({ config: cfg1(), notes: marca })).body.id;
    versoes.push(rasc);
    for (const qs of ['', '?kind=x', `?kind=inerente&matrix_version_id=${rasc}`, `?kind=inerente&matrix_version_id=${randomUUID()}`, '?kind=inerente&matrix_version_id=z', '?kind=inerente&extra=1']) {
      expect((await get(tLeitor, A.tenantId, `/mapa-calor${qs}`)).status).toBe(400);
    }
  });

  it('nova versão da matriz NÃO altera avaliações antigas; padrão passa a ser a nova; arquivada é recusada; histórico mostra cada versão', async () => {
    const antes = await q('SELECT * FROM pgr_risk_assessments WHERE tenant_id = $1 ORDER BY id', [A.tenantId]);
    M2 = await publicar(cfg2());
    expect(M2.n).toBeGreaterThan(M1.n);
    expect((await get(tLeitor, A.tenantId, '/mapa-calor?kind=inerente')).body.matrix_version.id).toBe(M2.id);
    expect(await q('SELECT * FROM pgr_risk_assessments WHERE tenant_id = $1 ORDER BY id', [A.tenantId])).toEqual(antes);

    const n = await aval(tEditor, A.tenantId, rA2, corpo({ severity_value: 2, probability_value: 4, justification: 'TESTE reavaliada na M2' }));
    expect(n.status).toBe(201); // sem matrix_version_id ⇒ vigente (M2)
    expect(n.body).toMatchObject({ matrix_version_id: M2.id, score: 8, level_id: 'alto' });
    expect((await aval(tEditor, A.tenantId, rA2, corpo({ severity_value: 3, probability_value: 1 }))).status).toBe(400); // 3 fora da escala 1–2 da M2
    // I1: M1 ainda está publicada, mas já não é a vigente ⇒ 409 (recarregar); a vigente (M2) explícita ⇒ 201
    const antesVelha = await nAval(rA2);
    const velha = await aval(tEditor, A.tenantId, rA2, corpo({ matrix_version_id: M1.id }));
    expect(velha.status).toBe(409);
    expect(velha.body.message).toMatch(/matriz vigente mudou; recarregue/);
    expect(await nAval(rA2)).toBe(antesVelha);
    const explicita = await aval(tEditor, A.tenantId, rA2, corpo({ matrix_version_id: M2.id, severity_value: 1, probability_value: 1 }));
    expect(explicita.status).toBe(201);
    expect(explicita.body.matrix_version_id).toBe(M2.id);
    // mapa-calor com versão explícita (não vigente) continua permitido
    expect((await get(tLeitor, A.tenantId, `/mapa-calor?kind=inerente&matrix_version_id=${M1.id}`)).status).toBe(200);

    // arquiva M1: recusada para novas avaliações, mas as antigas continuam legíveis, com nível da config da M1
    expect((await request(app.getHttpServer()).post(`/atuacao/pgr/matriz/${M1.id}/arquivar`).set(auth(tAdmin))).status).toBe(201);
    const rec = await aval(tEditor, A.tenantId, rA2, corpo({ matrix_version_id: M1.id }));
    expect(rec.status).toBe(400);
    expect(rec.body.message).toMatch(/arquivada/);
    const h = await get(tLeitor, A.tenantId, `/riscos/${rA2}/avaliacoes`);
    const versoesUsadas = new Set(h.body.historico.map((x: any) => x.matrix_version_number));
    expect(versoesUsadas).toEqual(new Set([M1.n, M2.n]));
    const origem = antes.find((x: any) => x.risk_id === rA2)!; // avaliação anterior à M2
    const antiga = h.body.historico.find((x: any) => x.id === origem.id);
    expect(antiga).toMatchObject({ matrix_version_id: M1.id, score: 6, matrix_version_number: M1.n });
    expect(antiga.nivel.rotulo).toBe('TESTE nivel 2');
    expect(await q('SELECT * FROM pgr_risk_assessments WHERE id = $1', [origem.id])).toEqual([origem]);
  });

  it('mapa de calor após a M2: padrão = M2 com avaliações da M1 em "em_outra_versao"; versão arquivada (M1) continua consultável', async () => {
    const m2 = await get(tLeitor, A.tenantId, '/mapa-calor?kind=inerente');
    expect(m2.body.matrix_version.id).toBe(M2.id);
    expect(m2.body.cells).toHaveLength(8); // escala 2 x 4, não quadrada
    // Vigentes de inerente: rA1 (M1), rA2 (M2, 1x1 classificada na vigente), rA3 (M1); rA4 sem inerente.
    expect(m2.body).toMatchObject({ classificados: 1, em_outra_versao: 2, sem_avaliacao: 1, total_riscos: 4 });
    const nova = await aval(tEditor, A.tenantId, rA4, corpo({ severity_value: 1, probability_value: 4 })); // M2: 4 => alto
    expect(nova.status).toBe(201);
    const m3 = await get(tLeitor, A.tenantId, '/mapa-calor?kind=inerente');
    expect(m3.body).toMatchObject({ classificados: 2, em_outra_versao: 2, sem_avaliacao: 0, por_versao: [{ version_number: M1.n, n: 2 }, { version_number: M2.n, n: 2 }] });
    expect(m3.body.cells.find((c: any) => c.severidade === 1 && c.probabilidade === 4)).toMatchObject({ quantidade: 1, nivel_id: 'alto' });
    const m1 = await get(tLeitor, A.tenantId, `/mapa-calor?kind=inerente&matrix_version_id=${M1.id}`);
    expect(m1.status).toBe(200);
    expect(m1.body.matrix_version.status).toBe('arquivada');
    expect(m1.body).toMatchObject({ classificados: 2, em_outra_versao: 2 });
  });
});
