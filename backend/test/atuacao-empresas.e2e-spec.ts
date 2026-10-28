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

// Sub-projeto Z, Task 3: /atuacao/empresas/:tenantId/* (somente socio, com empresas.read / empresas.documentos).
describe('atuacao-empresas — rotas por empresa do socio (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sLeitor: TestUserFixture; // empresas.read
  let sEditor: TestUserFixture; // empresas.read + empresas.documentos
  let sNada: TestUserFixture; // nenhuma permissão
  let admin: TestUserFixture;
  let tecnico: TestUserFixture;
  let parceiroUser: TestUserFixture;
  let monteseB: { tenantId: string; userId: string };
  let docDeB: string;
  let montese: { tenantId: string; userId: string; email: string; password: string; employeeId: string };
  let parceiro: { tenantId: string; userId: string; email: string; password: string; employeeId: string };
  let tLeitor: string, tEditor: string, tNada: string, tAdmin: string, tTec: string, tPar: string, tEmp: string;
  let docPgr: string, docCadastro: string, docParceiro: string;
  const sufixo = randomUUID().slice(0, 8);
  const CPF = '98765432100';

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, path: string) => request(app.getHttpServer()).get(`/atuacao/empresas/${path}`).set(auth(t));
  const patch = (t: string, path: string, body: object) =>
    request(app.getHttpServer()).patch(`/atuacao/empresas/${path}`).set(auth(t)).send(body);
  const LEITURAS = ['visao-geral', 'documentos', 'vencimentos', 'funcionarios', 'epi'];

  const mkDoc = (t: { tenantId: string; userId: string }, category: string, extra: Record<string, unknown> = {}) =>
    db.insertRawRow('documents', {
      tenant_id: t.tenantId, category, title: `Doc ${category} ${sufixo}`, file_key: `segredo/${randomUUID()}`,
      file_name: 'a.pdf', mime_type: 'application/pdf', size_bytes: 10, uploaded_by_user_id: t.userId,
      uploaded_by_role: 'empresa', ...extra,
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService).useValue({ createPreapproval: jest.fn() })
      .overrideProvider(R2Service).useValue({ getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://example.com/fake-url') })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    sLeitor = await db.createUserWithRole('socio', `Socio Emp Leitor ${sufixo}`);
    sEditor = await db.createUserWithRole('socio', `Socio Emp Editor ${sufixo}`);
    sNada = await db.createUserWithRole('socio', `Socio Emp Nada ${sufixo}`);
    admin = await db.createUserWithRole('admin', 'Admin Emp');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Emp');
    parceiroUser = await db.createUserWithRole('parceiro', 'Parc Emp');
    montese = await db.createTenantWithUser('Cliente Montese Z');
    parceiro = await db.createTenantWithUser('Cliente Parceiro Z');
    monteseB = await db.createTenantWithUser('Cliente Montese B Z');
    await db.grantSocioPermission(sLeitor.userId, 'empresas.read');
    await db.grantSocioPermission(sEditor.userId, 'empresas.read');
    await db.grantSocioPermission(sEditor.userId, 'empresas.documentos');

    // parceiro = tenant vinculado a técnico (fora da carteira Montese)
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [parceiro.tenantId, tec.rows[0].id]);

    for (const t of [montese, parceiro]) {
      await db.client.query("UPDATE employees SET birth_date = '1990-05-05', cpf = $2, department = 'Setor X' WHERE id = $1", [t.employeeId, CPF]);
      const cat = await db.client.query('SELECT id FROM epi_catalog_items ORDER BY code, description LIMIT 1');
      await db.insertRawRow('tenant_epis', {
        tenant_id: t.tenantId, epi_catalog_item_id: cat.rows[0].id, ca_number: '12345', created_by_user_id: t.userId,
      });
    }
    docPgr = await mkDoc(montese, 'pgr', { expires_at: '2030-01-01', valid_from: '2029-01-01' });
    await mkDoc(montese, 'laudo', { expires_at: '2020-01-01' });
    docCadastro = await mkDoc(montese, 'cadastro_funcionarios', { expires_at: '2031-01-01' });
    docDeB = await mkDoc(monteseB, 'pgr', { expires_at: '2033-03-03' });
    docParceiro = await mkDoc(parceiro, 'pgr', { expires_at: '2030-01-01' });

    [tLeitor, tEditor, tNada, tAdmin, tTec, tPar, tEmp] = await Promise.all(
      [sLeitor, sEditor, sNada, admin, tecnico, parceiroUser, montese].map(login),
    );
  }, 90000);

  afterAll(async () => {
    const us = [sLeitor.userId, sEditor.userId, sNada.userId];
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [us]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  it('sem empresas.read ⇒ 403 PERMISSION_DENIED em todas as rotas de leitura', async () => {
    for (const m of [...LEITURAS, `documentos/${docPgr}/download`]) {
      const r = await get(tNada, `${montese.tenantId}/${m}`);
      expect(r.status).toBe(403);
      expect(JSON.stringify(r.body)).toContain('PERMISSION_DENIED');
    }
  });

  it('empresa, técnico, parceiro e admin ⇒ 403', async () => {
    for (const t of [tEmp, tTec, tPar, tAdmin]) {
      for (const m of LEITURAS) expect((await get(t, `${montese.tenantId}/${m}`)).status).toBe(403);
    }
  });

  it('com empresas.read: leituras da empresa Montese ⇒ 200 e dados do próprio tenant', async () => {
    const id = montese.tenantId;
    const v = await get(tLeitor, `${id}/visao-geral`);
    expect(v.status).toBe(200);
    expect(v.body.empresa.id).toBe(id);
    expect(['ativa', 'trial', 'pendente', 'inativa']).toContain(v.body.empresa.situacao);
    expect(v.body.funcionarios_ativos).toBe(1);
    expect(v.body.documentos.total).toBe(2); // cadastro_funcionarios oculto
    expect(v.body.documentos.vencidos).toBe(1);
    expect(v.body.epis_cadastrados).toBe(1);

    const d = await get(tLeitor, `${id}/documentos`);
    expect(d.status).toBe(200);
    expect(d.body).toHaveLength(2);

    const venc = await get(tLeitor, `${id}/vencimentos`);
    expect(venc.status).toBe(200);
    expect(venc.body.map((x: any) => x.expires_at)).toEqual(['2020-01-01', '2030-01-01']);
    expect(venc.body[0].dias_para_vencer).toBeLessThan(0);
    expect(venc.body[1].dias_para_vencer).toBeGreaterThan(0);

    const f = await get(tLeitor, `${id}/funcionarios`);
    expect(f.status).toBe(200);
    expect(f.body).toHaveLength(1);
    expect(f.body[0].department).toBe('Setor X');

    const e = await get(tLeitor, `${id}/epi`);
    expect(e.status).toBe(200);
    expect(e.body).toHaveLength(1);
    expect(Object.keys(e.body[0]).sort()).toEqual(['code', 'description', 'equipment_group', 'id']);
  });

  it('download: documento da empresa ⇒ 200 { url, file_name }; de outra empresa ⇒ 404', async () => {
    const ok = await get(tLeitor, `${montese.tenantId}/documentos/${docPgr}/download`);
    expect(ok.status).toBe(200);
    expect(ok.body.file_name).toBe('a.pdf');
    expect(typeof ok.body.url).toBe('string');
    const outra = await get(tLeitor, `${montese.tenantId}/documentos/${docParceiro}/download`);
    expect(outra.status).toBe(404);
  });

  it('empresa de parceiro ⇒ 404 em todas as rotas (sem vazar dados)', async () => {
    for (const m of [...LEITURAS, `documentos/${docParceiro}/download`]) {
      const r = await get(tLeitor, `${parceiro.tenantId}/${m}`);
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain(parceiro.tenantId);
    }
    expect((await patch(tEditor, `${parceiro.tenantId}/documentos/${docParceiro}/vigencia`, { expires_at: '2031-01-01' })).status).toBe(404);
  });

  it('tenant inexistente ⇒ 404; id não-uuid ⇒ 400', async () => {
    const r = await get(tLeitor, `${randomUUID()}/visao-geral`);
    expect(r.status).toBe(404);
    expect(r.body.message).toBe('Empresa não encontrada');
    expect((await get(tLeitor, 'nao-e-uuid/visao-geral')).status).toBe(400);
  });

  it('funcionarios não retorna cpf nem birth_date, mesmo existindo no banco', async () => {
    const r = await get(tLeitor, `${montese.tenantId}/funcionarios`);
    expect(Object.keys(r.body[0]).sort()).toEqual(['admission_date', 'company_unit_id', 'cargo', 'department', 'full_name', 'id', 'status'].sort());
    expect(JSON.stringify(r.body)).not.toMatch(new RegExp(`cpf|birth_date|${CPF}|1990-05-05`));
    const all = await get(tLeitor, `${montese.tenantId}/visao-geral`);
    expect(JSON.stringify(all.body)).not.toContain(CPF);
  });

  it('documentos não retornam file_key; categoria cadastro_funcionarios não aparece', async () => {
    const r = await get(tLeitor, `${montese.tenantId}/documentos`);
    expect(JSON.stringify(r.body)).not.toMatch(/file_key|segredo/);
    expect(r.body.map((x: any) => x.id)).not.toContain(docCadastro);
    expect(r.body.map((x: any) => x.category)).not.toContain('cadastro_funcionarios');
    expect(Object.keys(r.body[0]).sort()).toEqual(['category', 'expires_at', 'file_name', 'id', 'situacao', 'title', 'valid_from']);
    const venc = await get(tLeitor, `${montese.tenantId}/vencimentos`);
    expect(venc.body.map((x: any) => x.id)).not.toContain(docCadastro);
    expect((await get(tLeitor, `${montese.tenantId}/documentos/${docCadastro}/download`)).status).toBe(404);
  });

  it('vigencia: com empresas.documentos ⇒ 200 e grava expires_at; sem a permissão ⇒ 403; outra empresa ⇒ 404', async () => {
    const url = `${montese.tenantId}/documentos/${docPgr}/vigencia`;
    expect((await patch(tLeitor, url, { expires_at: '2032-02-02' })).status).toBe(403);
    expect((await patch(tNada, url, { expires_at: '2032-02-02' })).status).toBe(403);
    const r = await patch(tEditor, url, { expires_at: '2032-02-02' });
    expect(r.status).toBe(200);
    expect(r.body.expires_at).toBe('2032-02-02');
    expect(r.body.file_key).toBeUndefined();
    const db1 = await db.client.query('SELECT expires_at::text AS e, title FROM documents WHERE id=$1', [docPgr]);
    expect(db1.rows[0].e).toBe('2032-02-02');
    expect(db1.rows[0].title).toBe(`Doc pgr ${sufixo}`);
    expect((await patch(tEditor, `${montese.tenantId}/documentos/${docParceiro}/vigencia`, { expires_at: '2032-02-02' })).status).toBe(404);
    const intocado = await db.client.query('SELECT expires_at::text AS e FROM documents WHERE id=$1', [docParceiro]);
    expect(intocado.rows[0].e).toBe('2030-01-01');
  });

  it('vigencia: title ou data malformada ⇒ 400 (forbidNonWhitelisted)', async () => {
    const url = `${montese.tenantId}/documentos/${docPgr}/vigencia`;
    expect((await patch(tEditor, url, { title: 'hack' })).status).toBe(400);
    expect((await patch(tEditor, url, { expires_at: '02/02/2032' })).status).toBe(400);
    expect((await patch(tEditor, url, { file_key: 'x' })).status).toBe(400);
  });

  it('auditoria: company.accessed e company.documents.changed existem, sem e-mail/nome/cpf no detail', async () => {
    const rows = (await db.client.query(
      "SELECT action, detail, resource_id, path FROM audit_log WHERE actor_user_id = ANY($1) AND action IN ('company.accessed','company.documents.changed')",
      [[sLeitor.userId, sEditor.userId]],
    )).rows;
    expect(rows.some((r: any) => r.action === 'company.accessed' && /^modulo: /.test(r.detail))).toBe(true);
    const alt = rows.find((r: any) => r.action === 'company.documents.changed');
    expect(alt.detail).toMatch(new RegExp(`^documento: ${docPgr}; expires_at: (—|\\d{4}-\\d{2}-\\d{2})→2032-02-02$`));
    expect(alt.detail).not.toMatch(/valid_from/);
    expect(alt.resource_id).toBe(montese.tenantId);
    for (const r of rows) {
      expect(r.detail).not.toMatch(/@|cpf|Socio|Cliente|segredo/i);
      if (r.action === 'company.accessed') expect(r.detail).not.toMatch(/2032/);
      expect(r.path).toMatch(/^\/atuacao\/empresas\//);
    }
  });

  it('sócio não consegue DELETE nem upload: rotas inexistentes ⇒ 404; /documents ⇒ 403', async () => {
    const del = await request(app.getHttpServer()).delete(`/atuacao/empresas/${montese.tenantId}/documentos/${docPgr}`).set(auth(tEditor));
    expect(del.status).toBe(404);
    const up = await request(app.getHttpServer()).post(`/atuacao/empresas/${montese.tenantId}/documentos`).set(auth(tEditor)).send({});
    expect(up.status).toBe(404);
    expect((await request(app.getHttpServer()).post('/documents').set(auth(tEditor)).send({})).status).toBe(403);
    expect((await request(app.getHttpServer()).delete(`/documents/${docPgr}`).set(auth(tEditor))).status).toBe(403);
    const intacto = await db.client.query('SELECT 1 FROM documents WHERE id=$1', [docPgr]);
    expect(intacto.rowCount).toBe(1);
  });

  it('auditoria na mesma transação: falha no INSERT de audit_log => 500 e expires_at do documento NÃO muda', async () => {
    const antes = (await db.client.query('SELECT expires_at::text AS e FROM documents WHERE id=$1', [docPgr])).rows[0].e;
    await db.client.query(`CREATE FUNCTION public.tmp_falha_auditoria_doc() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action = 'company.documents.changed' THEN RAISE EXCEPTION 'falha simulada'; END IF; RETURN NEW; END $$`);
    await db.client.query('CREATE TRIGGER tmp_falha_auditoria_doc BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION public.tmp_falha_auditoria_doc()');
    try {
      const r = await patch(tEditor, `${montese.tenantId}/documentos/${docPgr}/vigencia`, { expires_at: '2039-09-09' });
      expect(r.status).toBe(500);
      const depois = (await db.client.query('SELECT expires_at::text AS e FROM documents WHERE id=$1', [docPgr])).rows[0].e;
      expect(depois).toBe(antes);
    } finally {
      await db.client.query('DROP TRIGGER IF EXISTS tmp_falha_auditoria_doc ON audit_log');
      await db.client.query('DROP FUNCTION IF EXISTS public.tmp_falha_auditoria_doc()');
    }
  });

  it('IDOR: documento de OUTRO tenant Montese pela URL do tenant A ⇒ 404 e nada muda no banco', async () => {
    const dl = await get(tEditor, `${montese.tenantId}/documentos/${docDeB}/download`);
    expect(dl.status).toBe(404);
    const pt = await patch(tEditor, `${montese.tenantId}/documentos/${docDeB}/vigencia`, { expires_at: '2034-04-04' });
    expect(pt.status).toBe(404);
    const r = await db.client.query('SELECT expires_at::text AS e FROM documents WHERE id=$1', [docDeB]);
    expect(r.rows[0].e).toBe('2033-03-03');
    // Pela URL correta (B) o mesmo documento é acessível: prova que o 404 acima veio do check de tenant.
    expect((await get(tEditor, `${monteseB.tenantId}/documentos/${docDeB}/download`)).status).toBe(200);
  });

  it('vigencia: corpo {} ⇒ 400 sem UPDATE e sem auditoria', async () => {
    const antes = await db.client.query('SELECT expires_at::text AS e, updated_at FROM documents WHERE id=$1', [docPgr]);
    const n0 = (await db.client.query("SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id=$1 AND action='company.documents.changed'", [sEditor.userId])).rows[0].n;
    const r = await patch(tEditor, `${montese.tenantId}/documentos/${docPgr}/vigencia`, {});
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('Informe valid_from e/ou expires_at');
    const depois = await db.client.query('SELECT expires_at::text AS e, updated_at FROM documents WHERE id=$1', [docPgr]);
    expect(depois.rows[0]).toEqual(antes.rows[0]);
    const n1 = (await db.client.query("SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id=$1 AND action='company.documents.changed'", [sEditor.userId])).rows[0].n;
    expect(n1).toBe(n0);
  });
});
