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

// PGR (sub-projeto A), Task 4: /atuacao/pgr/empresas/:tenantId/{ghes,resumo}.
describe('pgr-ghes — GHEs, cargos, expostos e resumo (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sLeitor: TestUserFixture; // pgr.read
  let sEditor: TestUserFixture; // pgr.read + pgr.write
  let sNada: TestUserFixture;
  let admin: TestUserFixture;
  let tecnico: TestUserFixture;
  let A: { tenantId: string; userId: string; email: string; password: string };
  let B: typeof A;
  let P: typeof A; // parceiro
  let sSoWrite: TestUserFixture;
  let tSoWrite: string;
  let tLeitor: string, tEditor: string, tNada: string, tAdmin: string, tTec: string, tEmp: string;
  const sufixo = randomUUID().slice(0, 8);
  const N = (s: string) => `TESTE ${s} ${sufixo}`;
  let uA1: string, uA2: string, uB1: string;
  let pA1: string, pA2: string, pA3: string, pB1: string;
  let gheB: string;
  const NOME_FUNC = `TESTE Trabalhador Sigiloso ${sufixo}`;

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const url = (tenant: string, p = '') => `/atuacao/pgr/empresas/${tenant}${p}`;
  const get = (t: string, tenant: string, p = '') => request(app.getHttpServer()).get(url(tenant, p)).set(auth(t));
  const post = (t: string, tenant: string, p: string, b: object) => request(app.getHttpServer()).post(url(tenant, p)).set(auth(t)).send(b);
  const patch = (t: string, tenant: string, p: string, b: object) => request(app.getHttpServer()).patch(url(tenant, p)).set(auth(t)).send(b);
  const put = (t: string, tenant: string, p: string, b: object) => request(app.getHttpServer()).put(url(tenant, p)).set(auth(t)).send(b);
  const del = (t: string, tenant: string, p: string) => request(app.getHttpServer()).delete(url(tenant, p)).set(auth(t));
  const cpf = () => String(Math.floor(Math.random() * 1e11)).padStart(11, '0');
  const unidade = (tenantId: string, nome: string) => db.insertRawRow('company_units', {
    tenant_id: tenantId, name: nome, address_street: 'Rua Teste', address_city: 'Cidade', address_state: 'SP', address_zip: '01000000',
  });
  const func = (tenantId: string, status: string, positionId: string | null, unitId: string | null) => db.insertRawRow('employees', {
    tenant_id: tenantId, full_name: NOME_FUNC, cpf: cpf(), status, position_id: positionId, company_unit_id: unitId,
  });
  const ghesDe = async (tenant: string) => (await db.client.query('SELECT id, name, company_unit_id FROM pgr_ghes WHERE tenant_id = $1 ORDER BY id', [tenant])).rows;

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
    sLeitor = await db.createUserWithRole('socio', `Socio Ghe Leitor ${sufixo}`);
    sEditor = await db.createUserWithRole('socio', `Socio Ghe Editor ${sufixo}`);
    sNada = await db.createUserWithRole('socio', `Socio Ghe Nada ${sufixo}`);
    sSoWrite = await db.createUserWithRole('socio', `Socio Ghe SoWrite ${sufixo}`);
    await db.grantSocioPermission(sSoWrite.userId, 'pgr.write');
    admin = await db.createUserWithRole('admin', 'Admin Ghe');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Ghe');
    A = await db.createTenantWithUser('Cliente Montese Ghe A');
    B = await db.createTenantWithUser('Cliente Montese Ghe B');
    P = await db.createTenantWithUser('Cliente Parceiro Ghe');
    await db.grantSocioPermission(sLeitor.userId, 'pgr.read');
    await db.grantSocioPermission(sEditor.userId, 'pgr.read');
    await db.grantSocioPermission(sEditor.userId, 'pgr.write');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [P.tenantId, tec.rows[0].id]);

    uA1 = await unidade(A.tenantId, N('unidade A1'));
    uA2 = await unidade(A.tenantId, N('unidade A2'));
    uB1 = await unidade(B.tenantId, N('unidade B1'));
    pA1 = await db.insertRawRow('positions', { tenant_id: A.tenantId, name: N('cargo A1') });
    pA2 = await db.insertRawRow('positions', { tenant_id: A.tenantId, name: N('cargo A2') });
    pA3 = await db.insertRawRow('positions', { tenant_id: A.tenantId, name: N('cargo A3 sem vinculo') });
    pB1 = await db.insertRawRow('positions', { tenant_id: B.tenantId, name: N('cargo B1') });
    // A1: 3 ativos (unidade A1, unidade A2, sem unidade) + 1 inativo; A2: 1 ativo na unidade A1; A3: 2 ativos.
    await func(A.tenantId, 'ativo', pA1, uA1);
    await func(A.tenantId, 'ativo', pA1, uA2);
    await func(A.tenantId, 'ativo', pA1, null);
    await func(A.tenantId, 'inativo', pA1, uA1);
    await func(A.tenantId, 'ativo', pA2, uA1);
    await func(A.tenantId, 'ativo', pA3, uA1);
    await func(A.tenantId, 'ativo', pA3, null);
    gheB = await db.insertRawRow('pgr_ghes', { tenant_id: B.tenantId, name: N('ghe de B') });

    [tLeitor, tEditor, tNada, tAdmin, tTec, tEmp, tSoWrite] = await Promise.all([sLeitor, sEditor, sNada, admin, tecnico, A, sSoWrite].map(login));
  }, 90000);

  afterAll(async () => {
    const us = [sLeitor.userId, sEditor.userId, sNada.userId, sSoWrite.userId, admin.userId];
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [us]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  it('M-1: só pgr.write (sem pgr.read) ⇒ 403 nas escritas de GHE', async () => {
    const r = await post(tSoWrite, A.tenantId, '/ghes', { name: N('so write') });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('PERMISSION_DENIED');
    expect((await patch(tSoWrite, A.tenantId, `/ghes/${gheB}`, { name: 'x' })).status).toBe(403);
    expect((await del(tSoWrite, A.tenantId, `/ghes/${gheB}`)).status).toBe(403);
    expect((await db.client.query('SELECT 1 FROM pgr_ghes WHERE name = $1', [N('so write')])).rowCount).toBe(0);
  });

  it('permissões: sem pgr.read ⇒ 403 PERMISSION_DENIED; empresa e técnico ⇒ 403; leitor não escreve', async () => {
    const r = await get(tNada, A.tenantId, '/ghes');
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('PERMISSION_DENIED');
    expect((await get(tNada, A.tenantId, '/resumo')).status).toBe(403);
    expect((await get(tEmp, A.tenantId, '/ghes')).status).toBe(403);
    expect((await get(tTec, A.tenantId, '/ghes')).status).toBe(403);
    expect((await get(tLeitor, A.tenantId, '/ghes')).status).toBe(200);
    expect((await post(tLeitor, A.tenantId, '/ghes', { name: N('sem write') })).status).toBe(403);
    expect((await patch(tLeitor, A.tenantId, `/ghes/${gheB}`, { name: 'x' })).status).toBe(403);
    expect((await del(tLeitor, A.tenantId, `/ghes/${gheB}`)).status).toBe(403);
    expect((await put(tLeitor, A.tenantId, `/ghes/${gheB}/cargos`, { position_ids: [] })).status).toBe(403);
    expect(await ghesDe(A.tenantId)).toEqual([]);
  });

  it('empresa de parceiro ⇒ 404 uniforme (listar, criar, resumo); tenantId inválido ⇒ 400', async () => {
    expect((await get(tEditor, P.tenantId, '/ghes')).status).toBe(404);
    expect((await get(tEditor, P.tenantId, '/resumo')).status).toBe(404);
    expect((await post(tEditor, P.tenantId, '/ghes', { name: N('parceiro') })).status).toBe(404);
    expect((await get(tEditor, randomUUID(), '/ghes')).status).toBe(404);
    expect((await get(tEditor, 'nao-uuid', '/ghes')).status).toBe(400);
    expect((await ghesDe(P.tenantId))).toEqual([]);
  });

  it('admin em empresa de parceiro ⇒ 404 (GET ghes, POST ghes, GET resumo); em cliente Montese segue funcionando', async () => {
    expect((await get(tAdmin, P.tenantId, '/ghes')).status).toBe(404);
    expect((await post(tAdmin, P.tenantId, '/ghes', { name: N('admin parceiro') })).status).toBe(404);
    expect((await get(tAdmin, P.tenantId, '/resumo')).status).toBe(404);
    expect(await ghesDe(P.tenantId)).toEqual([]);
    expect((await get(tAdmin, A.tenantId, '/ghes')).status).toBe(200);
    expect((await get(tAdmin, A.tenantId, '/resumo')).status).toBe(200);
  });

  let g1: string, g2: string;
  it('cria GHE (201), valida corpo; unidade de outra empresa ⇒ 400', async () => {
    const ok = await post(tEditor, A.tenantId, '/ghes', { name: N('ghe sem unidade'), activities: 'texto livre sigiloso da inspeção' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ name: N('ghe sem unidade'), company_unit_id: null, positions: [], expostos: 0, riscos: 0 });
    g1 = ok.body.id;
    const u = await post(tEditor, A.tenantId, '/ghes', { name: N('ghe unidade A1'), company_unit_id: uA1 });
    expect(u.status).toBe(201);
    g2 = u.body.id;
    expect(u.body.company_unit_id).toBe(uA1);
    expect((await post(tEditor, A.tenantId, '/ghes', { name: N('ghe unid B'), company_unit_id: uB1 })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, '/ghes', { name: '' })).status).toBe(400);
    expect((await post(tEditor, A.tenantId, '/ghes', { name: N('x'), tenant_id: B.tenantId })).status).toBe(400);
    expect((await ghesDe(A.tenantId)).map((x: any) => x.name).sort()).toEqual([N('ghe sem unidade'), N('ghe unidade A1')].sort());
  });

  it('expostos: ativos via cargo; inativo e cargo sem vínculo não contam; GHE com unidade só conta a da unidade', async () => {
    const r1 = await put(tEditor, A.tenantId, `/ghes/${g1}/cargos`, { position_ids: [pA1, pA2] });
    expect(r1.status).toBe(200);
    expect(r1.body.positions.map((p: any) => p.id).sort()).toEqual([pA1, pA2].sort());
    expect(r1.body.expostos).toBe(4); // A1: 3 ativos + A2: 1; o inativo e o cargo A3 ficam de fora
    const r2 = await put(tEditor, A.tenantId, `/ghes/${g2}/cargos`, { position_ids: [pA1, pA2] });
    expect(r2.body.expostos).toBe(2); // só os ativos da unidade A1: um de A1 e o de A2
    const lista = await get(tLeitor, A.tenantId, '/ghes');
    expect(lista.status).toBe(200);
    const item = lista.body.find((x: any) => x.id === g1);
    expect(Object.keys(item).sort()).toEqual(['company_unit_id', 'expostos', 'id', 'name', 'positions', 'riscos']);
    expect(item.expostos).toBe(4);
    expect(JSON.stringify(lista.body)).not.toContain('Sigiloso');
    expect(JSON.stringify(lista.body)).not.toMatch(/cpf|full_name|birth/);
    // PUT é idempotente/substitui: remove A2, expostos cai
    expect((await put(tEditor, A.tenantId, `/ghes/${g1}/cargos`, { position_ids: [pA1, pA1] })).body.expostos).toBe(3);
    expect((await put(tEditor, A.tenantId, `/ghes/${g1}/cargos`, { position_ids: [] })).body.expostos).toBe(0);
    await put(tEditor, A.tenantId, `/ghes/${g1}/cargos`, { position_ids: [pA1, pA2] });
  });

  it('cargo de outro tenant ⇒ 400 e vínculos NÃO mudam; uuid inválido ⇒ 400', async () => {
    const antes = (await db.client.query('SELECT position_id FROM pgr_ghe_positions WHERE ghe_id = $1 ORDER BY 1', [g1])).rows;
    const r = await put(tEditor, A.tenantId, `/ghes/${g1}/cargos`, { position_ids: [pA1, pB1] });
    expect(r.status).toBe(400);
    expect((await put(tEditor, A.tenantId, `/ghes/${g1}/cargos`, { position_ids: ['x'] })).status).toBe(400);
    expect((await put(tEditor, A.tenantId, `/ghes/${g1}/cargos`, {})).status).toBe(400);
    const depois = (await db.client.query('SELECT position_id FROM pgr_ghe_positions WHERE ghe_id = $1 ORDER BY 1', [g1])).rows;
    expect(depois).toEqual(antes);
  });

  it('PATCH: altera, remove unidade, corpo vazio/name null ⇒ 400; admin também lê e escreve', async () => {
    const r = await patch(tEditor, A.tenantId, `/ghes/${g2}`, { name: N('ghe renomeado') });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe(N('ghe renomeado'));
    expect((await patch(tEditor, A.tenantId, `/ghes/${g2}`, {})).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/ghes/${g2}`, { name: null })).status).toBe(400);
    expect((await patch(tEditor, A.tenantId, `/ghes/${g2}`, { company_unit_id: uB1 })).status).toBe(400);
    const semUnidade = await patch(tEditor, A.tenantId, `/ghes/${g2}`, { company_unit_id: null });
    expect(semUnidade.status).toBe(200);
    expect(semUnidade.body.company_unit_id).toBeNull();
    expect(semUnidade.body.expostos).toBe(4);
    expect((await get(tAdmin, A.tenantId, '/ghes')).status).toBe(200);
    expect((await patch(tAdmin, A.tenantId, `/ghes/${g2}`, { company_unit_id: uA1 })).status).toBe(200);
  });

  it('IDOR: GHE de B pela URL de A ⇒ 404 (patch/delete/cargos) e o banco não muda; pela URL de B o GHE existe', async () => {
    const antes = await db.client.query('SELECT name, company_unit_id, updated_at FROM pgr_ghes WHERE id = $1', [gheB]);
    for (const t of [tEditor, tAdmin]) {
      expect((await patch(t, A.tenantId, `/ghes/${gheB}`, { name: 'invadido' })).status).toBe(404);
      expect((await del(t, A.tenantId, `/ghes/${gheB}`)).status).toBe(404);
      expect((await put(t, A.tenantId, `/ghes/${gheB}/cargos`, { position_ids: [pA1] })).status).toBe(404);
    }
    const depois = await db.client.query('SELECT name, company_unit_id, updated_at FROM pgr_ghes WHERE id = $1', [gheB]);
    expect(depois.rows).toEqual(antes.rows);
    expect((await db.client.query('SELECT 1 FROM pgr_ghe_positions WHERE ghe_id = $1', [gheB])).rowCount).toBe(0);
    expect((await get(tEditor, B.tenantId, '/ghes')).body.map((x: any) => x.id)).toContain(gheB);
    expect((await get(tEditor, A.tenantId, '/ghes')).body.map((x: any) => x.id)).not.toContain(gheB);
    expect((await patch(tEditor, A.tenantId, '/ghes/nao-uuid', { name: 'x' })).status).toBe(400);
  });

  it('DELETE: com riscos ⇒ 409 e GHE permanece; sem riscos ⇒ 200 e some', async () => {
    await db.insertRawRow('pgr_risks', { tenant_id: A.tenantId, ghe_id: g1, category: 'fisico', name: N('risco'), exposure_type: 'habitual_permanente' });
    const lista = await get(tEditor, A.tenantId, '/ghes');
    expect(lista.body.find((x: any) => x.id === g1).riscos).toBe(1);
    expect((await del(tEditor, A.tenantId, `/ghes/${g1}`)).status).toBe(409);
    expect((await db.client.query('SELECT 1 FROM pgr_ghes WHERE id = $1', [g1])).rowCount).toBe(1);
    expect((await del(tEditor, A.tenantId, `/ghes/${g2}`)).status).toBe(200);
    expect((await db.client.query('SELECT 1 FROM pgr_ghes WHERE id = $1', [g2])).rowCount).toBe(0);
    expect((await db.client.query('SELECT 1 FROM pgr_ghe_positions WHERE ghe_id = $1', [g2])).rowCount).toBe(0);
    expect((await del(tEditor, A.tenantId, `/ghes/${g2}`)).status).toBe(404);
  });

  it('auditoria: falha ao gravar audit_log ⇒ 500 e a alteração sofre ROLLBACK (fail-closed)', async () => {
    await db.client.query(`CREATE FUNCTION public.tmp_falha_auditoria_ghe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action LIKE 'pgr.ghe.%' THEN RAISE EXCEPTION 'falha simulada'; END IF; RETURN NEW; END $$`);
    await db.client.query('CREATE TRIGGER tmp_falha_auditoria_ghe BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION public.tmp_falha_auditoria_ghe()');
    try {
      const n0 = (await ghesDe(A.tenantId)).length;
      const vinc0 = (await db.client.query('SELECT count(*)::int AS n FROM pgr_ghe_positions WHERE ghe_id = $1', [g1])).rows[0].n;
      expect((await patch(tEditor, A.tenantId, `/ghes/${g1}`, { name: N('nome que nao pode ficar') })).status).toBe(500);
      expect((await post(tEditor, A.tenantId, '/ghes', { name: N('nao pode ficar') })).status).toBe(500);
      expect((await put(tEditor, A.tenantId, `/ghes/${g1}/cargos`, { position_ids: [] })).status).toBe(500);
      expect((await ghesDe(A.tenantId)).length).toBe(n0);
      expect((await db.client.query('SELECT name FROM pgr_ghes WHERE id = $1', [g1])).rows[0].name).toBe(N('ghe sem unidade'));
      expect((await db.client.query('SELECT count(*)::int AS n FROM pgr_ghe_positions WHERE ghe_id = $1', [g1])).rows[0].n).toBe(vinc0);
    } finally {
      await db.client.query('DROP TRIGGER IF EXISTS tmp_falha_auditoria_ghe ON audit_log');
      await db.client.query('DROP FUNCTION IF EXISTS public.tmp_falha_auditoria_ghe()');
    }
  });

  it('resumo: pendências do que falta, sem inventar; empresa com dados completos reduz pendências; parceiro 404', async () => {
    const vazio = await get(tLeitor, B.tenantId, '/resumo');
    expect(vazio.status).toBe(200);
    expect(vazio.body.empresa.id).toBe(B.tenantId);
    expect(vazio.body.importados).toMatchObject({ cnpj: true, cnae: false, grau_risco: null, endereco: false, unidades: 1, cargos: 1, funcionarios: 1 });
    expect(vazio.body.pendencias).toEqual(expect.arrayContaining(['cnae', 'endereco', 'riscos']));
    expect(vazio.body.pendencias).not.toContain('unidades');
    expect(vazio.body.pendencias).not.toContain('grau_risco');
    expect(vazio.body.ghes).toBe(1);
    expect(vazio.body.riscos).toBe(0);
    await db.client.query(
      `UPDATE tenants SET cnae_code = '6201501', address_street = 'Rua X', address_city = 'Cidade', address_state = 'SP', address_zip = '01000000' WHERE id = $1`,
      [A.tenantId],
    );
    const a = await get(tLeitor, A.tenantId, '/resumo');
    expect(a.body.importados).toMatchObject({ cnae: true, endereco: true, unidades: 2, cargos: 3 });
    expect(a.body.importados.funcionarios).toBe(7); // 6 ativos inseridos (o inativo não conta) + o funcionário-fixture do helper
    expect(a.body.pendencias).toEqual([]);
    expect(a.body.completude).toBe(100);
    expect(a.body.completude).toBeGreaterThan(vazio.body.completude);
    expect(JSON.stringify(a.body)).not.toContain('Sigiloso');
    expect((await get(tLeitor, P.tenantId, '/resumo')).status).toBe(404);
  });

  it('cargos: GET /empresas/:id/cargos só id+name ordenados; sem pgr.read ⇒ 403; parceiro ⇒ 404 (também admin); nunca de outra empresa', async () => {
    const r = await get(tLeitor, A.tenantId, '/cargos');
    expect(r.status).toBe(200);
    expect(r.body.map((x: any) => x.id)).toEqual([pA1, pA2, pA3]);
    expect(r.body.every((x: any) => Object.keys(x).sort().join() === 'id,name')).toBe(true);
    expect(r.body.map((x: any) => x.id)).not.toContain(pB1);
    expect((await get(tNada, A.tenantId, '/cargos')).status).toBe(403);
    expect((await get(tEmp, A.tenantId, '/cargos')).status).toBe(403);
    expect((await get(tTec, A.tenantId, '/cargos')).status).toBe(403);
    expect((await get(tLeitor, P.tenantId, '/cargos')).status).toBe(404);
    expect((await get(tAdmin, P.tenantId, '/cargos')).status).toBe(404);
    expect((await get(tAdmin, A.tenantId, '/cargos')).status).toBe(200);
    expect((await get(tLeitor, 'nao-uuid', '/cargos')).status).toBe(400);
  });

  it('auditoria pgr.ghe.*: gravada, com path da rota, sem texto livre nem dado de trabalhador', async () => {
    const r = await db.client.query(
      `SELECT action, detail, path, resource_id FROM audit_log WHERE actor_user_id = ANY($1) AND action LIKE 'pgr.ghe.%'`,
      [[sEditor.userId, admin.userId]],
    );
    const acoes = new Set(r.rows.map((x: any) => x.action));
    for (const a of ['pgr.ghe.created', 'pgr.ghe.updated', 'pgr.ghe.deleted', 'pgr.ghe.positions_set']) expect(acoes).toContain(a);
    const todo = JSON.stringify(r.rows);
    expect(todo).not.toContain('Sigiloso');
    expect(todo).not.toContain('sigiloso');
    expect(todo).not.toContain(NOME_FUNC);
    expect(todo).not.toContain(sufixo);
    expect(r.rows.every((x: any) => x.path.startsWith('/atuacao/pgr/empresas/'))).toBe(true);
    expect(r.rows.every((x: any) => x.resource_id)).toBe(true);
    // nenhuma alteração rejeitada (403/404/409/400/500) deixou auditoria: só as 4 ações acima
    expect([...acoes].every((a) => String(a).startsWith('pgr.ghe.'))).toBe(true);
  });
});
