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

// PGR (sub-projeto A), Task 5: riscos, controles e medições em /atuacao/pgr/empresas/:tenantId.
describe('pgr-riscos — riscos, controles e medições (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sLeitor: TestUserFixture; // pgr.read
  let sEditor: TestUserFixture; // pgr.read + pgr.write
  let sOutro: TestUserFixture; // pgr.read + pgr.write (dono de outro registro profissional)
  let admin: TestUserFixture;
  let tecnico: TestUserFixture;
  let A: { tenantId: string; userId: string; email: string; password: string };
  let B: typeof A;
  let P: typeof A;
  let sSoWrite: TestUserFixture;
  let tSoWrite: string;
  let tLeitor: string, tEditor: string, tAdmin: string, tTec: string, tEmp: string;
  const sufixo = randomUUID().slice(0, 8);
  const N = (s: string) => `TESTE ${s} ${sufixo}`;
  let gA1: string, gA2: string, gB: string, gP: string;
  let hGlobal: string, hA: string, hB: string, hInativo: string;
  let regEditor: string, regOutro: string, regPendente: string;
  let docA: string, docB: string, epi: string;
  const hazardIds: string[] = [];

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const url = (tenant: string, p = '') => `/atuacao/pgr/empresas/${tenant}${p}`;
  const get = (t: string, tenant: string, p = '') => request(app.getHttpServer()).get(url(tenant, p)).set(auth(t));
  const post = (t: string, tenant: string, p: string, b: object) => request(app.getHttpServer()).post(url(tenant, p)).set(auth(t)).send(b);
  const patch = (t: string, tenant: string, p: string, b: object) => request(app.getHttpServer()).patch(url(tenant, p)).set(auth(t)).send(b);
  const del = (t: string, tenant: string, p: string) => request(app.getHttpServer()).delete(url(tenant, p)).set(auth(t));
  const q = async (sql: string, p: unknown[] = []) => (await db.client.query(sql, p)).rows;
  const hazard = async (row: Record<string, unknown>) => {
    const id = await db.insertRawRow('pgr_hazards', { category: 'fisico', ...row });
    hazardIds.push(id);
    return id;
  };
  const mkReg = async (userId: string, numero: string, confirmar: boolean) => {
    const id = (await q(
      `INSERT INTO professional_registrations (user_id, council, registration_number, uf, created_by) VALUES ($1, 'TESTE', $2, 'SC', $3) RETURNING id`,
      [userId, numero, admin.userId],
    ))[0].id as string;
    if (confirmar) await q("UPDATE professional_registrations SET status = 'confirmado', confirmed_by = $2, confirmed_at = now() WHERE id = $1", [id, admin.userId]);
    return id;
  };
  const doc = (tenantId: string, userId: string) => db.insertRawRow('documents', {
    tenant_id: tenantId, category: 'laudo', title: N('laudo'), file_key: `teste/${randomUUID()}`, file_name: 'a.pdf',
    mime_type: 'application/pdf', size_bytes: 10, uploaded_by_user_id: userId, uploaded_by_role: 'empresa',
  });
  const estado = async (tenant: string) => ({
    riscos: await q('SELECT * FROM pgr_risks WHERE tenant_id = $1 ORDER BY id', [tenant]),
    controles: await q('SELECT * FROM pgr_risk_controls WHERE tenant_id = $1 ORDER BY id', [tenant]),
    medicoes: await q('SELECT * FROM pgr_risk_measurements WHERE tenant_id = $1 ORDER BY id', [tenant]),
  });

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
    sLeitor = await db.createUserWithRole('socio', `Socio Risco Leitor ${sufixo}`);
    sEditor = await db.createUserWithRole('socio', `Socio Risco Editor ${sufixo}`);
    sOutro = await db.createUserWithRole('socio', `Socio Risco Outro ${sufixo}`);
    sSoWrite = await db.createUserWithRole('socio', `Socio Risco SoWrite ${sufixo}`);
    await db.grantSocioPermission(sSoWrite.userId, 'pgr.write');
    admin = await db.createUserWithRole('admin', 'Admin Risco');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Risco');
    A = await db.createTenantWithUser('Cliente Montese Risco A');
    B = await db.createTenantWithUser('Cliente Montese Risco B');
    P = await db.createTenantWithUser('Cliente Parceiro Risco');
    for (const s of [sLeitor, sEditor, sOutro]) await db.grantSocioPermission(s.userId, 'pgr.read');
    for (const s of [sEditor, sOutro]) await db.grantSocioPermission(s.userId, 'pgr.write');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [P.tenantId, tec.rows[0].id]);

    gA1 = await db.insertRawRow('pgr_ghes', { tenant_id: A.tenantId, name: N('ghe A1') });
    gA2 = await db.insertRawRow('pgr_ghes', { tenant_id: A.tenantId, name: N('ghe A2') });
    gB = await db.insertRawRow('pgr_ghes', { tenant_id: B.tenantId, name: N('ghe B') });
    gP = await db.insertRawRow('pgr_ghes', { tenant_id: P.tenantId, name: N('ghe P') });
    hGlobal = await hazard({ scope: 'global', name: N('perigo global'), description: 'TESTE descricao', default_assessment: 'quantitativa', tolerance_limit: 'TESTE limite', esocial_code: 'TESTE1', exposure_routes: ['TESTE via'] });
    hA = await hazard({ scope: 'tenant', tenant_id: A.tenantId, name: N('perigo A'), default_assessment: 'qualitativa' });
    hB = await hazard({ scope: 'tenant', tenant_id: B.tenantId, name: N('perigo B') });
    hInativo = await hazard({ scope: 'global', name: N('perigo inativo'), active: false });
    regEditor = await mkReg(sEditor.userId, `E${sufixo}`, true);
    regOutro = await mkReg(sOutro.userId, `O${sufixo}`, true);
    regPendente = await mkReg(sEditor.userId, `P${sufixo}`, false);
    docA = await doc(A.tenantId, A.userId);
    docB = await doc(B.tenantId, B.userId);
    epi = await db.insertRawRow('epi_catalog_items', { category: 'A', code: `TESTE-${sufixo}`, equipment_group: 'TESTE', description: N('epi'), risk_protected: 'TESTE' });
    [tLeitor, tEditor, tAdmin, tTec, tEmp, tSoWrite] = await Promise.all([sLeitor, sEditor, admin, tecnico, A, sSoWrite].map(login));
  }, 90000);

  afterAll(async () => {
    const us = [sLeitor.userId, sEditor.userId, sOutro.userId, sSoWrite.userId, admin.userId];
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [us]);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM pgr_risks WHERE tenant_id = ANY($1)', [[A.tenantId, B.tenantId, P.tenantId]]);
    await db.client.query('DELETE FROM professional_registrations WHERE user_id = ANY($1) OR created_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM pgr_hazards WHERE id = ANY($1)', [hazardIds]);
    await db.client.query('DELETE FROM epi_catalog_items WHERE id = $1', [epi]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  let r1: string; // risco criado do perigo global (quantitativa)
  let r2: string; // risco criado do perigo A (qualitativa)

  it('permissões: sem pgr.write ⇒ 403 em toda escrita; leitor lê; empresa e técnico ⇒ 403', async () => {
    expect((await get(tLeitor, A.tenantId, `/ghes/${gA1}/riscos`)).status).toBe(200);
    expect((await get(tEmp, A.tenantId, `/ghes/${gA1}/riscos`)).status).toBe(403);
    expect((await get(tTec, A.tenantId, `/ghes/${gA1}/riscos`)).status).toBe(403);
    const id = randomUUID();
    expect((await post(tLeitor, A.tenantId, `/ghes/${gA1}/riscos`, { hazard_ids: [hGlobal] })).status).toBe(403);
    expect((await patch(tLeitor, A.tenantId, `/riscos/${id}`, { name: 'x' })).status).toBe(403);
    expect((await del(tLeitor, A.tenantId, `/riscos/${id}`)).status).toBe(403);
    expect((await post(tLeitor, A.tenantId, `/riscos/${id}/controles`, { kind: 'epc', status: 'existente', description: 'x' })).status).toBe(403);
    expect((await patch(tLeitor, A.tenantId, `/controles/${id}`, { description: 'x' })).status).toBe(403);
    expect((await del(tLeitor, A.tenantId, `/controles/${id}`)).status).toBe(403);
    expect((await post(tLeitor, A.tenantId, `/riscos/${id}/medicoes`, { agent: 'x' })).status).toBe(403);
    expect((await patch(tLeitor, A.tenantId, `/medicoes/${id}`, { agent: 'x' })).status).toBe(403);
    expect((await del(tLeitor, A.tenantId, `/medicoes/${id}`)).status).toBe(403);
    expect((await post(tLeitor, A.tenantId, `/ghes/${gA1}/copiar-riscos`, { from_ghe_id: gA2 })).status).toBe(403);
    expect((await estado(A.tenantId)).riscos).toEqual([]);
  });

  it('M-1: só pgr.write (sem pgr.read) ⇒ 403 nas escritas de risco/controle/medição', async () => {
    const id = randomUUID();
    const r = await post(tSoWrite, A.tenantId, `/ghes/${gA1}/riscos`, { hazard_ids: [hGlobal] });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('PERMISSION_DENIED');
    expect((await patch(tSoWrite, A.tenantId, `/riscos/${id}`, { name: 'x' })).status).toBe(403);
    expect((await post(tSoWrite, A.tenantId, `/riscos/${id}/controles`, { kind: 'epc', status: 'existente', description: 'x' })).status).toBe(403);
    expect((await post(tSoWrite, A.tenantId, `/ghes/${gA1}/copiar-riscos`, { from_ghe_id: gA2 })).status).toBe(403);
    expect((await estado(A.tenantId)).riscos).toEqual([]);
  });

  it('empresa de parceiro ⇒ 404 uniforme (inclusive admin); nada gravado', async () => {
    for (const t of [tEditor, tAdmin]) {
      expect((await get(t, P.tenantId, `/ghes/${gP}/riscos`)).status).toBe(404);
      expect((await post(t, P.tenantId, `/ghes/${gP}/riscos`, { hazard_ids: [hGlobal] })).status).toBe(404);
    }
    expect((await estado(P.tenantId)).riscos).toEqual([]);
  });

  it('copia perigos ativos e visíveis (valores copiados); duplicado no GHE é ignorado e listado', async () => {
    const r = await post(tEditor, A.tenantId, `/ghes/${gA1}/riscos`, { hazard_ids: [hGlobal, hA] });
    expect(r.status).toBe(201);
    expect(r.body.ignorados).toEqual([]);
    expect(r.body.riscos).toHaveLength(2);
    const g = r.body.riscos.find((x: any) => x.hazard_id === hGlobal);
    r1 = g.id;
    r2 = r.body.riscos.find((x: any) => x.hazard_id === hA).id;
    expect(g).toMatchObject({
      name: N('perigo global'), category: 'fisico', description: 'TESTE descricao', tolerance_limit: 'TESTE limite',
      esocial_code: 'TESTE1', exposure_routes: ['TESTE via'], assessment_type: 'quantitativa', status: 'rascunho', ghe_id: gA1, tenant_id: A.tenantId,
      controles: [], medicoes: [],
    });
    const de = await post(tEditor, A.tenantId, `/ghes/${gA1}/riscos`, { hazard_ids: [hGlobal, hGlobal] });
    expect(de.status).toBe(201);
    expect(de.body.riscos).toEqual([]);
    expect(de.body.ignorados).toEqual([hGlobal]);
    expect((await q('SELECT 1 FROM pgr_risks WHERE ghe_id = $1', [gA1])).length).toBe(2);
    const lista = await get(tLeitor, A.tenantId, `/ghes/${gA1}/riscos`);
    expect(lista.body.map((x: any) => x.id).sort()).toEqual([r1, r2].sort());
  });

  it('exposure_type omitido ⇒ NULL no banco (nada presumido); status completo exige exposição e avaliação', async () => {
    const row = (await q('SELECT exposure_type, status FROM pgr_risks WHERE id = ANY($1)', [[r1, r2]]));
    expect(row.every((x: any) => x.exposure_type === null && x.status === 'rascunho')).toBe(true);
    const antes = (await q('SELECT * FROM pgr_risks WHERE id = $1', [r2]))[0];
    const r = await patch(tEditor, A.tenantId, `/riscos/${r2}`, { status: 'completo' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('completo');
    expect((await q('SELECT * FROM pgr_risks WHERE id = $1', [r2]))[0]).toEqual(antes);
    expect((await patch(tEditor, A.tenantId, `/riscos/${r2}`, { exposure_type: 'eventual' })).status).toBe(200);
    expect((await patch(tEditor, A.tenantId, `/riscos/${r2}`, { exposure_type: null })).status).toBe(200);
    const exp = await post(tEditor, A.tenantId, `/ghes/${gA2}/riscos`, { hazard_ids: [hA], exposure_type: 'intermitente' });
    expect(exp.body.riscos[0].exposure_type).toBe('intermitente');
    expect((await del(tEditor, A.tenantId, `/riscos/${exp.body.riscos[0].id}`)).status).toBe(200);
  });

  it('imutabilidade da cópia: editar/inativar o perigo não altera o risco; esocial_code é opcional', async () => {
    const antes = await q('SELECT * FROM pgr_risks WHERE id = $1', [r1]);
    await db.client.query("UPDATE pgr_hazards SET name = $2, description = 'MUDADA', tolerance_limit = 'MUDADO', esocial_code = NULL WHERE id = $1", [hGlobal, N('perigo global renomeado')]);
    await db.client.query('UPDATE pgr_hazards SET active = false WHERE id = $1', [hGlobal]);
    expect(await q('SELECT * FROM pgr_risks WHERE id = $1', [r1])).toEqual(antes);
    const lista = await get(tLeitor, A.tenantId, `/ghes/${gA1}/riscos`);
    expect(lista.body.find((x: any) => x.id === r1)).toMatchObject({ name: N('perigo global'), description: 'TESTE descricao', tolerance_limit: 'TESTE limite' });
    // risco sem esocial_code (perigo A não tem) foi aceito
    expect(lista.body.find((x: any) => x.id === r2).esocial_code).toBeNull();
    await db.client.query('UPDATE pgr_hazards SET active = true WHERE id = $1', [hGlobal]);
  });

  it('perigo inativo, de outro tenant, inexistente ou corpo inválido ⇒ 400/404 e nada é criado', async () => {
    const antes = await estado(A.tenantId);
    expect((await post(tEditor, A.tenantId, `/ghes/${gA2}/riscos`, { hazard_ids: [hInativo] })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, `/ghes/${gA2}/riscos`, { hazard_ids: [hB] })).status).toBe(400);
    expect((await post(tAdmin, A.tenantId, `/ghes/${gA2}/riscos`, { hazard_ids: [hB] })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, `/ghes/${gA2}/riscos`, { hazard_ids: [hGlobal, randomUUID()] })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, `/ghes/${gA2}/riscos`, { hazard_ids: [] })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, `/ghes/${gA2}/riscos`, { hazard_ids: ['x'] })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, `/ghes/${gA2}/riscos`, { hazard_ids: [hGlobal], tenant_id: B.tenantId })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, `/ghes/${gB}/riscos`, { hazard_ids: [hGlobal] })).status).toBe(404);
    expect((await post(tEditor, A.tenantId, `/ghes/${randomUUID()}/riscos`, { hazard_ids: [hGlobal] })).status).toBe(404);
    expect(await estado(A.tenantId)).toEqual(antes);
    expect((await q('SELECT 1 FROM pgr_risks WHERE ghe_id = $1', [gB])).length).toBe(0);
  });

  it('PATCH risco: edita, corpo vazio/nulo obrigatório/campo proibido ⇒ 400; assessment_type', async () => {
    const ok = await patch(tEditor, A.tenantId, `/riscos/${r2}`, { exposure_type: 'intermitente', activity: 'TESTE atividade', status: 'completo' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ exposure_type: 'intermitente', activity: 'TESTE atividade', status: 'completo' });
    const snap = async () => (await q('SELECT * FROM pgr_risks WHERE id = $1', [r2]))[0];
    const s0 = await snap();
    expect((await patch(tEditor, A.tenantId, `/riscos/${r2}`, {})).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/riscos/${r2}`, { tenant_id: B.tenantId })).status).toBe(400);
    expect(await snap()).toEqual(s0);
    expect((await patch(tEditor, A.tenantId, `/riscos/${r2}`, { name: null })).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/riscos/${r2}`, { exposure_type: 'qualquer' })).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/riscos/${r2}`, { ghe_id: gA2 })).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/riscos/${r2}`, { hazard_id: hB })).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/riscos/${r2}`, { tenant_id: B.tenantId })).status).toBe(400);
    expect((await q('SELECT ghe_id, tenant_id, hazard_id FROM pgr_risks WHERE id = $1', [r2]))[0]).toEqual({ ghe_id: gA1, tenant_id: A.tenantId, hazard_id: hA });
    expect((await patch(tEditor, A.tenantId, `/riscos/${r2}`, { status: 'qualquer' })).status).toBe(400);
  });

  let c1: string, m1: string;
  it('controles: cria/edita/remove; EPI inexistente, tipo fora do vocabulário, EPI em controle não-EPI ⇒ 400', async () => {
    const c = await post(tEditor, A.tenantId, `/riscos/${r1}/controles`, { kind: 'epc', status: 'existente', description: 'TESTE enclausuramento' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ kind: 'epc', status: 'existente', effectiveness: 'nao_avaliada', risk_id: r1, tenant_id: A.tenantId });
    c1 = c.body.id;
    const e = await post(tEditor, A.tenantId, `/riscos/${r1}/controles`, { kind: 'epi', status: 'existente', description: 'TESTE epi', epi_catalog_item_id: epi });
    expect(e.status).toBe(201);
    expect(e.body.epi_catalog_item_id).toBe(epi);
    // status é obrigatório (nenhum padrão presumido)
    expect((await post(tEditor, A.tenantId, `/riscos/${r1}/controles`, { kind: 'epc', description: 'x' })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, `/riscos/${r1}/controles`, { kind: 'epi', status: 'existente', description: 'x', epi_catalog_item_id: randomUUID() })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, `/riscos/${r1}/controles`, { kind: 'epc', status: 'existente', description: 'x', epi_catalog_item_id: epi })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, `/riscos/${r1}/controles`, { kind: 'treinamento', status: 'existente', description: 'x', training_tipo: 'nr-99' })).status).toBe(400);
    const t = await post(tEditor, A.tenantId, `/riscos/${r1}/controles`, { kind: 'treinamento', description: 'TESTE trein', training_tipo: 'nr-35', status: 'planejado' });
    expect(t.status).toBe(201);
    expect(t.body.training_tipo).toBe('nr-35');
    expect((await post(tEditor, A.tenantId, `/riscos/${r1}/controles`, { kind: 'xyz', status: 'existente', description: 'x' })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, `/riscos/${r1}/controles`, { kind: 'epc', status: 'existente', description: 'x', risk_id: r2 })).status).toBe(400);
    const u = await patch(tEditor, A.tenantId, `/controles/${c1}`, { effectiveness: 'eficaz', status: 'planejado' });
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ effectiveness: 'eficaz', status: 'planejado' });
    expect((await patch(tEditor, A.tenantId, `/controles/${c1}`, {})).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/controles/${c1}`, { description: null })).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/controles/${c1}`, { risk_id: r2 })).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/controles/${c1}`, { epi_catalog_item_id: epi })).status).toBe(400); // controle é EPC
    expect((await del(tEditor, A.tenantId, `/controles/${t.body.id}`)).status).toBe(200);
    expect((await q('SELECT 1 FROM pgr_risk_controls WHERE id = $1', [t.body.id])).length).toBe(0);
    expect((await del(tEditor, A.tenantId, `/controles/${t.body.id}`)).status).toBe(404);
  });

  it('medições: só em risco quantitativo (qualitativo ⇒ 400); sem cálculo automático', async () => {
    const q2 = await post(tEditor, A.tenantId, `/riscos/${r2}/medicoes`, { agent: 'TESTE agente' });
    expect(q2.status).toBe(400);
    expect((await q('SELECT 1 FROM pgr_risk_measurements WHERE risk_id = $1', [r2])).length).toBe(0);
    const m = await post(tEditor, A.tenantId, `/riscos/${r1}/medicoes`, {
      agent: 'TESTE agente', value: 'TESTE 10', unit: 'TESTE un', tolerance_limit: 'TESTE lim', evaluated_on: '2025-01-31',
      calibration_date: '2025-01-01', equipment: 'TESTE eq', responsible_name: 'TESTE Responsavel',
    });
    expect(m.status).toBe(201);
    expect(m.body).toMatchObject({ agent: 'TESTE agente', value: 'TESTE 10', risk_id: r1, tenant_id: A.tenantId });
    expect(Object.keys(m.body)).not.toEqual(expect.arrayContaining(['action_level', 'nivel_acao']));
    m1 = m.body.id;
    expect((await post(tEditor, A.tenantId, `/riscos/${r1}/medicoes`, { agent: '' })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, `/riscos/${r1}/medicoes`, { agent: 'x', evaluated_on: '31/01/2025' })).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/medicoes/${m1}`, { value: 'TESTE 12' })).body.value).toBe('TESTE 12');
    expect((await patch(tEditor, A.tenantId, `/medicoes/${m1}`, {})).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/medicoes/${m1}`, { agent: null })).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/medicoes/${m1}`, { risk_id: r2 })).status).toBe(400);
    // com medição, o risco não pode virar qualitativo
    expect((await patch(tEditor, A.tenantId, `/riscos/${r1}`, { assessment_type: 'qualitativa' })).status).toBe(409);
    expect((await q('SELECT assessment_type FROM pgr_risks WHERE id = $1', [r1]))[0].assessment_type).toBe('quantitativa');
  });

  it('professional_registration_id: só registro CONFIRMADO e do próprio chamador (admin: qualquer confirmado)', async () => {
    const base = { agent: 'TESTE reg' };
    expect((await post(tEditor, A.tenantId, `/riscos/${r1}/medicoes`, { ...base, professional_registration_id: regEditor })).status).toBe(201);
    expect((await post(tEditor, A.tenantId, `/riscos/${r1}/medicoes`, { ...base, professional_registration_id: regPendente })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, `/riscos/${r1}/medicoes`, { ...base, professional_registration_id: regOutro })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, `/riscos/${r1}/medicoes`, { ...base, professional_registration_id: randomUUID() })).status).toBe(400);
    expect((await post(tAdmin, A.tenantId, `/riscos/${r1}/medicoes`, { ...base, professional_registration_id: regOutro })).status).toBe(201);
    expect((await patch(tEditor, A.tenantId, `/medicoes/${m1}`, { professional_registration_id: regOutro })).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/medicoes/${m1}`, { professional_registration_id: regEditor })).status).toBe(200);
    expect((await patch(tEditor, A.tenantId, `/medicoes/${m1}`, { professional_registration_id: null })).status).toBe(200);
  });

  it('document_id: do mesmo tenant ⇒ ok; de outro tenant ⇒ 400 e banco intacto', async () => {
    const antes = await estado(A.tenantId);
    expect((await post(tEditor, A.tenantId, `/riscos/${r1}/medicoes`, { agent: 'TESTE doc B', document_id: docB })).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/medicoes/${m1}`, { document_id: docB })).status).toBe(400);
    expect((await patch(tAdmin, A.tenantId, `/medicoes/${m1}`, { document_id: docB })).status).toBe(400);
    expect(await estado(A.tenantId)).toEqual(antes);
    const ok = await patch(tEditor, A.tenantId, `/medicoes/${m1}`, { document_id: docA });
    expect(ok.status).toBe(200);
    expect(ok.body.document_id).toBe(docA);
  });

  it('copiar-riscos: entre GHEs do mesmo tenant copia riscos e controles (sem medições), ignora já presentes; outro tenant ⇒ 404', async () => {
    const antesB = await estado(B.tenantId);
    const r = await post(tEditor, A.tenantId, `/ghes/${gA2}/copiar-riscos`, { from_ghe_id: gA1 });
    expect(r.status).toBe(201);
    expect(r.body.riscos).toHaveLength(2);
    expect(r.body.ignorados).toEqual([]);
    const copia = r.body.riscos.find((x: any) => x.hazard_id === hGlobal);
    expect(copia.id).not.toBe(r1);
    expect(copia.ghe_id).toBe(gA2);
    expect(copia.controles.length).toBeGreaterThan(0);
    expect(copia.medicoes).toEqual([]);
    expect((await q('SELECT 1 FROM pgr_risk_measurements WHERE risk_id = $1', [copia.id])).length).toBe(0);
    const de = await post(tEditor, A.tenantId, `/ghes/${gA2}/copiar-riscos`, { from_ghe_id: gA1 });
    expect(de.status).toBe(201);
    expect(de.body.riscos).toEqual([]);
    expect(de.body.ignorados.sort()).toEqual([hGlobal, hA].sort());
    expect((await post(tEditor, A.tenantId, `/ghes/${gA2}/copiar-riscos`, { from_ghe_id: gA2 })).status).toBe(400);
    const antes = await estado(A.tenantId);
    for (const t of [tEditor, tAdmin]) {
      expect((await post(t, A.tenantId, `/ghes/${gA2}/copiar-riscos`, { from_ghe_id: gB })).status).toBe(404);
      expect((await post(t, A.tenantId, `/ghes/${gB}/copiar-riscos`, { from_ghe_id: gA1 })).status).toBe(404);
      expect((await post(t, B.tenantId, `/ghes/${gA2}/copiar-riscos`, { from_ghe_id: gB })).status).toBe(404);
    }
    expect(await estado(A.tenantId)).toEqual(antes);
    expect(await estado(B.tenantId)).toEqual(antesB);
  });

  it('IDOR: risco/controle/medição de B pela URL de A ⇒ 404 (patch/delete/filhos) e o banco não muda', async () => {
    const rB = await db.insertRawRow('pgr_risks', { tenant_id: B.tenantId, ghe_id: gB, category: 'fisico', name: N('risco B'), exposure_type: 'eventual', assessment_type: 'quantitativa' });
    const cB = await db.insertRawRow('pgr_risk_controls', { tenant_id: B.tenantId, risk_id: rB, kind: 'epc', status: 'existente', description: 'TESTE controle B' });
    const mB = await db.insertRawRow('pgr_risk_measurements', { tenant_id: B.tenantId, risk_id: rB, agent: 'TESTE agente B' });
    const antes = await estado(B.tenantId);
    const antesA = await estado(A.tenantId);
    for (const t of [tEditor, tAdmin]) {
      expect((await get(t, A.tenantId, `/ghes/${gB}/riscos`)).status).toBe(404);
      expect((await patch(t, A.tenantId, `/riscos/${rB}`, { name: 'invadido' })).status).toBe(404);
      expect((await del(t, A.tenantId, `/riscos/${rB}`)).status).toBe(404);
      expect((await post(t, A.tenantId, `/riscos/${rB}/controles`, { kind: 'epc', status: 'existente', description: 'x' })).status).toBe(404);
      expect((await post(t, A.tenantId, `/riscos/${rB}/medicoes`, { agent: 'x' })).status).toBe(404);
      expect((await patch(t, A.tenantId, `/controles/${cB}`, { description: 'invadido' })).status).toBe(404);
      expect((await del(t, A.tenantId, `/controles/${cB}`)).status).toBe(404);
      expect((await patch(t, A.tenantId, `/medicoes/${mB}`, { agent: 'invadido' })).status).toBe(404);
      expect((await del(t, A.tenantId, `/medicoes/${mB}`)).status).toBe(404);
    }
    expect(await estado(B.tenantId)).toEqual(antes);
    expect(await estado(A.tenantId)).toEqual(antesA);
    expect((await patch(tEditor, B.tenantId, `/riscos/${rB}`, { name: N('risco B ok') })).status).toBe(200);
    expect((await patch(tEditor, A.tenantId, '/riscos/nao-uuid', { name: 'x' })).status).toBe(400);
  });

  it('empresa e técnico não escrevem (403 em todas as rotas de escrita); estado intacto', async () => {
    const antes = await estado(A.tenantId);
    for (const t of [tEmp, tTec]) {
      const id = randomUUID();
      expect((await post(t, A.tenantId, `/ghes/${gA1}/riscos`, { hazard_ids: [hA] })).status).toBe(403);
      expect((await post(t, A.tenantId, `/ghes/${gA1}/copiar-riscos`, { from_ghe_id: gA2 })).status).toBe(403);
      expect((await patch(t, A.tenantId, `/riscos/${r1}`, { activity: 'x' })).status).toBe(403);
      expect((await del(t, A.tenantId, `/riscos/${r1}`)).status).toBe(403);
      expect((await post(t, A.tenantId, `/riscos/${r1}/controles`, { kind: 'epc', status: 'existente', description: 'x' })).status).toBe(403);
      expect((await patch(t, A.tenantId, `/controles/${c1}`, { description: 'x' })).status).toBe(403);
      expect((await del(t, A.tenantId, `/controles/${id}`)).status).toBe(403);
      expect((await post(t, A.tenantId, `/riscos/${r1}/medicoes`, { agent: 'x' })).status).toBe(403);
      expect((await patch(t, A.tenantId, `/medicoes/${m1}`, { agent: 'x' })).status).toBe(403);
      expect((await del(t, A.tenantId, `/medicoes/${id}`)).status).toBe(403);
    }
    expect(await estado(A.tenantId)).toEqual(antes);
  });

  it('PATCH vazio em controle e medição ⇒ 400 e a linha não muda', async () => {
    const c0 = (await q('SELECT * FROM pgr_risk_controls WHERE id = $1', [c1]))[0];
    const m0 = (await q('SELECT * FROM pgr_risk_measurements WHERE id = $1', [m1]))[0];
    expect((await patch(tEditor, A.tenantId, `/controles/${c1}`, {})).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/controles/${c1}`, { risk_id: r2, tenant_id: B.tenantId })).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/medicoes/${m1}`, {})).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/medicoes/${m1}`, { risk_id: r2, tenant_id: B.tenantId })).status).toBe(400);
    expect((await q('SELECT * FROM pgr_risk_controls WHERE id = $1', [c1]))[0]).toEqual(c0);
    expect((await q('SELECT * FROM pgr_risk_measurements WHERE id = $1', [m1]))[0]).toEqual(m0);
  });

  it('perigo já presente no GHE e depois inativado ⇒ ignorado (não 400); índice único impede duplicata direta', async () => {
    await db.client.query('UPDATE pgr_hazards SET active = false WHERE id = $1', [hGlobal]);
    try {
      const r = await post(tEditor, A.tenantId, `/ghes/${gA1}/riscos`, { hazard_ids: [hGlobal] });
      expect(r.status).toBe(201);
      expect(r.body.riscos).toEqual([]);
      expect(r.body.ignorados).toEqual([hGlobal]);
      // inativo e NÃO presente ⇒ 400
      const gTmp = await db.insertRawRow('pgr_ghes', { tenant_id: A.tenantId, name: N('ghe tmp inativo') });
      expect((await post(tEditor, A.tenantId, `/ghes/${gTmp}/riscos`, { hazard_ids: [hGlobal] })).status).toBe(400);
      await q('DELETE FROM pgr_ghes WHERE id = $1', [gTmp]);
    } finally {
      await db.client.query('UPDATE pgr_hazards SET active = true WHERE id = $1', [hGlobal]);
    }
    await expect(db.insertRawRow('pgr_risks', { tenant_id: A.tenantId, ghe_id: gA1, hazard_id: hGlobal, category: 'fisico', name: N('dup'), exposure_type: 'eventual' }))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('copiar-riscos: origem de GHE de parceiro ⇒ 404; origem com mais de 500 riscos ⇒ 409 sem cópia parcial', async () => {
    const antesA = await estado(A.tenantId);
    const antesP = await estado(P.tenantId);
    for (const t of [tEditor, tAdmin]) expect((await post(t, A.tenantId, `/ghes/${gA2}/copiar-riscos`, { from_ghe_id: gP })).status).toBe(404);
    expect(await estado(A.tenantId)).toEqual(antesA);
    expect(await estado(P.tenantId)).toEqual(antesP);
    const gBig = await db.insertRawRow('pgr_ghes', { tenant_id: A.tenantId, name: N('ghe grande') });
    const gDest = await db.insertRawRow('pgr_ghes', { tenant_id: A.tenantId, name: N('ghe destino') });
    await q(`INSERT INTO pgr_risks (tenant_id, ghe_id, category, name) SELECT $1, $2, 'fisico', 'TESTE risco ' || g FROM generate_series(1, 501) g`, [A.tenantId, gBig]);
    const r = await post(tEditor, A.tenantId, `/ghes/${gDest}/copiar-riscos`, { from_ghe_id: gBig });
    expect(r.status).toBe(409);
    expect((await q('SELECT 1 FROM pgr_risks WHERE ghe_id = $1', [gDest])).length).toBe(0);
    await q('DELETE FROM pgr_ghes WHERE id = ANY($1)', [[gBig, gDest]]);
  });

  it('auditoria: falha ao gravar audit_log ⇒ 500 e todas as escritas sofrem ROLLBACK (fail-closed)', async () => {
    await db.client.query(`CREATE FUNCTION public.tmp_falha_auditoria_risco() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action LIKE 'pgr.risk.%' OR NEW.action LIKE 'pgr.control.%' OR NEW.action LIKE 'pgr.measurement.%' THEN RAISE EXCEPTION 'falha simulada'; END IF; RETURN NEW; END $$`);
    await db.client.query('CREATE TRIGGER tmp_falha_auditoria_risco BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION public.tmp_falha_auditoria_risco()');
    try {
      const antes = await estado(A.tenantId);
      expect((await post(tEditor, A.tenantId, `/ghes/${gA2}/riscos`, { hazard_ids: [hB] })).status).toBe(400); // sanidade: antes da auditoria
      const gNovo = await db.insertRawRow('pgr_ghes', { tenant_id: A.tenantId, name: N('ghe auditoria') });
      expect((await post(tEditor, A.tenantId, `/ghes/${gNovo}/riscos`, { hazard_ids: [hA] })).status).toBe(500);
      expect((await post(tEditor, A.tenantId, `/ghes/${gNovo}/copiar-riscos`, { from_ghe_id: gA1 })).status).toBe(500);
      expect((await patch(tEditor, A.tenantId, `/riscos/${r1}`, { activity: 'TESTE nao pode ficar' })).status).toBe(500);
      expect((await post(tEditor, A.tenantId, `/riscos/${r1}/controles`, { kind: 'epc', status: 'existente', description: 'nao pode ficar' })).status).toBe(500);
      expect((await patch(tEditor, A.tenantId, `/controles/${c1}`, { description: 'nao pode ficar' })).status).toBe(500);
      expect((await del(tEditor, A.tenantId, `/controles/${c1}`)).status).toBe(500);
      expect((await post(tEditor, A.tenantId, `/riscos/${r1}/medicoes`, { agent: 'nao pode ficar' })).status).toBe(500);
      expect((await patch(tEditor, A.tenantId, `/medicoes/${m1}`, { agent: 'nao pode ficar' })).status).toBe(500);
      expect((await del(tEditor, A.tenantId, `/medicoes/${m1}`)).status).toBe(500);
      expect((await del(tEditor, A.tenantId, `/riscos/${r1}`)).status).toBe(500);
      expect(await estado(A.tenantId)).toEqual(antes);
      await q('DELETE FROM pgr_ghes WHERE id = $1', [gNovo]);
    } finally {
      await db.client.query('DROP TRIGGER IF EXISTS tmp_falha_auditoria_risco ON audit_log');
      await db.client.query('DROP FUNCTION IF EXISTS public.tmp_falha_auditoria_risco()');
    }
  });

  it('DELETE: medição, controle e risco (cascata); inexistente ⇒ 404', async () => {
    expect((await del(tEditor, A.tenantId, `/medicoes/${m1}`)).status).toBe(200);
    expect((await q('SELECT 1 FROM pgr_risk_measurements WHERE id = $1', [m1])).length).toBe(0);
    expect((await del(tEditor, A.tenantId, `/medicoes/${m1}`)).status).toBe(404);
    expect((await del(tEditor, A.tenantId, `/controles/${c1}`)).status).toBe(200);
    expect((await del(tEditor, A.tenantId, `/riscos/${r1}`)).status).toBe(200);
    expect((await q('SELECT 1 FROM pgr_risks WHERE id = $1', [r1])).length).toBe(0);
    expect((await q('SELECT 1 FROM pgr_risk_measurements WHERE risk_id = $1', [r1])).length).toBe(0);
    expect((await del(tEditor, A.tenantId, `/riscos/${r1}`)).status).toBe(404);
    expect((await del(tAdmin, A.tenantId, `/riscos/${r2}`)).status).toBe(200);
  });

  it('auditoria pgr.risk/control/measurement: gravada com path da rota, só ids e nomes de campos (sem texto livre)', async () => {
    const r = await q(
      `SELECT action, detail, path, resource_id, resource_type FROM audit_log
        WHERE actor_user_id = ANY($1) AND (action LIKE 'pgr.risk.%' OR action LIKE 'pgr.control.%' OR action LIKE 'pgr.measurement.%')`,
      [[sEditor.userId, admin.userId]],
    );
    const acoes = new Set(r.map((x: any) => x.action));
    for (const a of ['pgr.risk.created', 'pgr.risk.updated', 'pgr.risk.deleted', 'pgr.risk.copied', 'pgr.control.created', 'pgr.control.updated', 'pgr.control.deleted',
      'pgr.measurement.created', 'pgr.measurement.updated', 'pgr.measurement.deleted']) expect(acoes).toContain(a);
    const todo = JSON.stringify(r);
    for (const proibido of ['TESTE', 'enclausuramento', 'MUDADA', sufixo]) expect(todo).not.toContain(proibido);
    expect(r.every((x: any) => x.path.startsWith('/atuacao/pgr/empresas/'))).toBe(true);
    expect(r.every((x: any) => x.resource_id)).toBe(true);
  });
});
