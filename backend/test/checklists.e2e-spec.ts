import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb, TestUserFixture } from './db-test-helper';

process.env.RATE_LIMIT_MAX = '5000';

// E3b/E3c: rotas de checklist (modelos e por documento), permissões por rota e bloqueio no envio à revisão.
// Rótulos de teste; nenhum conteúdo técnico real.
describe('checklists — modelos, documento e bloqueio de revisão (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let aprovador: TestUserFixture, preenche: TestUserFixture, leitor: TestUserFixture, semNada: TestUserFixture;
  let admin: TestUserFixture, tecnico: TestUserFixture;
  let montese: { tenantId: string; userId: string; email: string; password: string };
  let vinculado: { tenantId: string; userId: string };
  let tAprov: string, tPre: string, tLei: string, tNada: string, tAdmin: string, tTec: string, tEmp: string;
  let draft: string, draftVinc: string;
  const sufixo = randomUUID().slice(0, 8);

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = (m: 'get' | 'post' | 'put' | 'delete', t: string, path: string, body?: object) =>
    (request(app.getHttpServer()) as any)[m](`/atuacao/${path}`).set(auth(t)).send(body ?? {});

  const ITENS = [
    { label: 'TESTE sim/não obrigatório que bloqueia', kind: 'sim_nao_na', required: true, blocks_review: true },
    { label: 'TESTE número opcional', kind: 'numero', required: false, blocks_review: false },
    { label: 'TESTE data obrigatória', kind: 'data', required: true, blocks_review: false },
  ];
  async function modeloAprovado(itens = ITENS) {
    const v = await api('post', tAprov, 'checklists/modelos', { service: 'pgr', name: `TESTE modelo ${randomUUID()}` });
    expect(v.status).toBe(201);
    expect((await api('put', tAprov, `checklists/versoes/${v.body.id}/itens`, { items: itens })).status).toBe(200);
    const ap = await api('post', tAprov, `checklists/versoes/${v.body.id}/aprovar`);
    expect(ap.status).toBe(201);
    return { templateId: v.body.template_id as string, versionId: v.body.id as string, itens: ap.body.itens as any[] };
  }

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
    aprovador = await db.createUserWithRole('socio', `Socio Chk Aprov ${sufixo}`);
    preenche = await db.createUserWithRole('socio', `Socio Chk Preenche ${sufixo}`);
    leitor = await db.createUserWithRole('socio', `Socio Chk Leitor ${sufixo}`);
    semNada = await db.createUserWithRole('socio', `Socio Chk Nada ${sufixo}`);
    admin = await db.createUserWithRole('admin', 'Admin Chk');
    tecnico = await db.createUserWithRole('tecnico', 'Tec Chk');
    montese = await db.createTenantWithUser('Cliente Montese Chk');
    vinculado = await db.createTenantWithUser('Cliente Vinculado Chk');
    for (const p of ['checklists.read', 'checklists.approve']) await db.grantSocioPermission(aprovador.userId, p);
    for (const p of ['checklists.read', 'checklists.write', 'documents.read', 'documents.create_draft']) await db.grantSocioPermission(preenche.userId, p);
    for (const p of ['checklists.read', 'documents.read']) await db.grantSocioPermission(leitor.userId, p);
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [vinculado.tenantId, tec.rows[0].id]);

    const semente = async (tenantId: string) => {
      const id = (await db.client.query("INSERT INTO document_drafts (tenant_id, category, title, created_by) VALUES ($1,'pgr','TESTE doc chk',$2) RETURNING id", [tenantId, preenche.userId])).rows[0].id as string;
      const corpo = Buffer.from(`%PDF-1.4\n% ${randomUUID()}\n%%EOF\n`);
      const vid = (await db.client.query(
        `INSERT INTO document_draft_versions (draft_id, tenant_id, version_number, file_key, file_name, mime_type, size_bytes, sha256, created_by)
         VALUES ($1,$2,1,$3,'a.pdf','application/pdf',$4,$5,$6) RETURNING id`,
        [id, tenantId, `documents-fluxo/${tenantId}/${id}/1`, corpo.length, createHash('sha256').update(corpo).digest('hex'), preenche.userId])).rows[0].id;
      await db.client.query('UPDATE document_drafts SET current_version_id=$2 WHERE id=$1', [id, vid]);
      return id;
    };
    draft = await semente(montese.tenantId);
    draftVinc = await semente(vinculado.tenantId);
    await db.client.query("INSERT INTO document_type_permissions (category, user_id, action, granted_by) VALUES ('pgr',$1,'elaborar',$1)", [preenche.userId]);
    [tAprov, tPre, tLei, tNada, tAdmin, tTec, tEmp] = await Promise.all([aprovador, preenche, leitor, semNada, admin, tecnico, montese].map(login));
  }, 90000);

  afterAll(async () => {
    const us = [aprovador, preenche, leitor, semNada].map((u) => u.userId);
    await db.client.query('DELETE FROM document_checklists WHERE tenant_id = ANY($1)', [[montese.tenantId, vinculado.tenantId]]);
    await db.client.query("DELETE FROM checklist_templates WHERE name LIKE 'TESTE modelo%'");
    await db.client.query('DELETE FROM document_type_permissions WHERE user_id = ANY($1)', [us]);
    await db.client.query('DELETE FROM document_drafts WHERE created_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [us]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  it('empresa, técnico, admin e sócio sem permissão ⇒ 403; sem token ⇒ 401', async () => {
    for (const t of [tEmp, tTec, tAdmin, tNada]) {
      expect((await api('get', t, 'checklists/modelos')).status).toBe(403);
      expect((await api('get', t, `documentos/${draft}/checklists`)).status).toBe(403);
    }
    expect((await request(app.getHttpServer()).get('/atuacao/checklists/modelos')).status).toBe(401);
  });

  it('permissão por rota: leitor lê mas não cria/aprova; quem preenche não cria modelo; aprovador sem documents.read não vê o documento', async () => {
    expect((await api('get', tLei, 'checklists/modelos')).status).toBe(200);
    expect((await api('post', tLei, 'checklists/modelos', { service: 'pgr', name: 'TESTE modelo x' })).status).toBe(403);
    expect((await api('post', tPre, 'checklists/modelos', { service: 'pgr', name: 'TESTE modelo x' })).status).toBe(403);
    expect((await api('get', tAprov, `documentos/${draft}/checklists`)).status).toBe(403);
    expect((await api('post', tLei, `documentos/${draft}/checklists`, { template_version_id: randomUUID() })).status).toBe(403);
  });

  it('modelo: nasce rascunho; itens validados; aprovar exige itens; aprovado é imutável; nova versão copia os itens e substitui ao aprovar', async () => {
    const v = await api('post', tAprov, 'checklists/modelos', { service: 'pgr', name: `TESTE modelo ${randomUUID()}` });
    expect(v.status).toBe(201);
    expect(v.body).toMatchObject({ status: 'rascunho', version_number: 1, itens: [] });
    expect((await api('post', tAprov, `checklists/versoes/${v.body.id}/aprovar`)).status).toBe(409); // sem itens
    expect((await api('put', tAprov, `checklists/versoes/${v.body.id}/itens`, { items: [{ label: 'x', kind: 'qualquer', required: true, blocks_review: false }] })).status).toBe(400);
    expect((await api('put', tAprov, `checklists/versoes/${v.body.id}/itens`, { items: [{ label: 'x', kind: 'texto', required: false, blocks_review: true }] })).status).toBe(400);
    expect((await api('put', tAprov, `checklists/versoes/${v.body.id}/itens`, { items: ITENS })).body.itens.map((i: any) => i.position)).toEqual([1, 2, 3]);
    const ap = await api('post', tAprov, `checklists/versoes/${v.body.id}/aprovar`);
    expect(ap.status).toBe(201);
    expect(ap.body).toMatchObject({ status: 'aprovado' });
    expect(ap.body.approved_by_name).toBeTruthy();
    expect((await api('put', tAprov, `checklists/versoes/${v.body.id}/itens`, { items: ITENS })).status).toBe(409);
    expect((await api('delete', tAprov, `checklists/versoes/${v.body.id}`)).status).toBe(409);
    expect((await api('post', tAprov, `checklists/versoes/${v.body.id}/aprovar`)).status).toBe(409);
    const nv = await api('post', tAprov, `checklists/modelos/${v.body.template_id}/versoes`, { change_note: 'ajuste' });
    expect(nv.status).toBe(201);
    expect(nv.body).toMatchObject({ status: 'rascunho', version_number: 2 });
    expect(nv.body.itens).toHaveLength(3);
    expect((await api('post', tAprov, `checklists/modelos/${v.body.template_id}/versoes`)).status).toBe(409); // já há rascunho
    expect((await api('post', tAprov, `checklists/versoes/${nv.body.id}/aprovar`)).status).toBe(201);
    expect((await api('get', tLei, `checklists/versoes/${v.body.id}`)).body.status).toBe('substituido');
    const lista = (await api('get', tLei, 'checklists/modelos')).body.find((m: any) => m.id === v.body.template_id);
    expect(lista).toMatchObject({ versao_aprovada: 2, versao_aprovada_id: nv.body.id, rascunho_id: null });
    const rasc = await api('post', tAprov, `checklists/modelos/${v.body.template_id}/versoes`);
    expect((await api('delete', tAprov, `checklists/versoes/${rasc.body.id}`)).status).toBe(204);
  });

  it('aplicar: só modelo aprovado; documento fora da carteira ⇒ 404; duplicado ⇒ 409; leitor não aplica', async () => {
    const rasc = await api('post', tAprov, 'checklists/modelos', { service: 'ltcat', name: `TESTE modelo ${randomUUID()}` });
    expect((await api('post', tPre, `documentos/${draft}/checklists`, { template_version_id: rasc.body.id })).status).toBe(409);
    const m = await modeloAprovado();
    expect((await api('post', tPre, `documentos/${draftVinc}/checklists`, { template_version_id: m.versionId })).status).toBe(404);
    expect((await api('post', tLei, `documentos/${draft}/checklists`, { template_version_id: m.versionId })).status).toBe(403);
    expect((await api('post', tPre, `documentos/${draft}/checklists`, { template_version_id: randomUUID() })).status).toBe(404);
    const ok = await api('post', tPre, `documentos/${draft}/checklists`, { template_version_id: m.versionId });
    expect(ok.status).toBe(201);
    const cl = ok.body.find((c: any) => c.template_version_id === m.versionId);
    expect(cl.completude).toEqual({ total: 3, respondidos: 0, obrigatorios_pendentes: 2, bloqueiam_revisao: 1 });
    expect((await api('post', tPre, `documentos/${draft}/checklists`, { template_version_id: m.versionId })).status).toBe(409);
  });

  it('responder valida o tipo; envio à revisão fica bloqueado (409) até responder o item bloqueante; atualizar resposta funciona', async () => {
    const m = await modeloAprovado();
    const d2 = (await db.client.query("INSERT INTO document_drafts (tenant_id, category, title, created_by) VALUES ($1,'pgr','TESTE doc chk 2',$2) RETURNING id", [montese.tenantId, preenche.userId])).rows[0].id as string;
    const vid = (await db.client.query(
      `INSERT INTO document_draft_versions (draft_id, tenant_id, version_number, file_key, file_name, mime_type, size_bytes, sha256, created_by)
       VALUES ($1,$2,1,$3,'a.pdf','application/pdf',10,$4,$5) RETURNING id`, [d2, montese.tenantId, `documents-fluxo/${d2}/1`, 'a'.repeat(64), preenche.userId])).rows[0].id;
    await db.client.query('UPDATE document_drafts SET current_version_id=$2 WHERE id=$1', [d2, vid]);
    const ap = await api('post', tPre, `documentos/${d2}/checklists`, { template_version_id: m.versionId });
    const cl = ap.body[0];
    const [iSim, iNum, iData] = cl.itens;
    const resp = (item: any, value: string, note?: string) => api('put', tPre, `documentos/${d2}/checklists/${cl.id}/itens/${item.id}`, { value, ...(note ? { note } : {}) });

    const enviar = () => (request(app.getHttpServer()) as any).post(`/atuacao/documentos/${d2}/enviar-revisao`).set(auth(tPre)).send({});
    const r1 = await enviar();
    expect(r1.status).toBe(409);
    expect(r1.body.message).toBe('Checklist incompleto: 1 item obrigatório sem resposta.');

    expect((await resp(iSim, 'talvez')).status).toBe(400);
    expect((await resp(iNum, 'abc')).status).toBe(400);
    expect((await resp(iData, '2026-02-31')).status).toBe(400);
    expect((await resp(iData, '2026-12-01')).status).toBe(200);
    const apos = await resp(iSim, 'nao', 'observação de teste');
    expect(apos.status).toBe(200);
    const atual = apos.body[0];
    expect(atual.completude).toEqual({ total: 3, respondidos: 2, obrigatorios_pendentes: 0, bloqueiam_revisao: 0 });
    expect(atual.itens[0]).toMatchObject({ resposta: 'nao', resposta_nota: 'observação de teste' });
    expect(atual.itens[0].respondido_por).toBeTruthy();
    expect((await resp(iSim, 'sim')).body[0].itens[0].resposta).toBe('sim'); // atualiza
    expect((await resp({ id: randomUUID() }, 'sim')).status).toBe(404);
    expect((await api('put', tLei, `documentos/${d2}/checklists/${cl.id}/itens/${iSim.id}`, { value: 'sim' })).status).toBe(403);

    expect((await enviar()).status).toBe(201);
    expect((await db.client.query('SELECT status FROM document_drafts WHERE id=$1', [d2])).rows[0].status).toBe('em_revisao');
    const aud = await db.client.query("SELECT detail FROM audit_log WHERE actor_user_id=$1 AND action LIKE 'checklist.%'", [preenche.userId]);
    expect(aud.rows.length).toBeGreaterThan(0);
    expect(aud.rows.every((x: any) => !/observação de teste|TESTE item|TESTE sim/.test(x.detail ?? ''))).toBe(true);
  });
});
