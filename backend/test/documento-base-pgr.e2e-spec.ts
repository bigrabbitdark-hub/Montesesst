import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb, TestUserFixture } from './db-test-helper';

process.env.RATE_LIMIT_MAX = '5000';

// E5b: vínculo opcional LTCAT/LIP/laudo -> PGR (criação, PATCH :id/base, avisos no detalhe) e visão por empresa.
describe('documentos — PGR-base e visão por empresa (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let socio: TestUserFixture, semPerm: TestUserFixture, admin: TestUserFixture;
  let a: { tenantId: string; userId: string }, b: { tenantId: string; userId: string };
  let tS: string, tSem: string;
  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const api = (m: 'get' | 'post' | 'patch', t: string, path: string, body?: object) =>
    (request(app.getHttpServer()) as any)[m](`/atuacao/documentos/${path}`).set({ Authorization: `Bearer ${t}` }).send(body ?? {});
  const criar = (tenant: string, category: string, title: string, base?: string) =>
    api('post', tS, '', { tenant_id: tenant, category, title, ...(base ? { base_draft_id: base } : {}) });

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
    socio = await db.createUserWithRole('socio', 'Socio Base E2E');
    semPerm = await db.createUserWithRole('socio', 'Socio Sem Perm Base');
    admin = await db.createUserWithRole('admin', 'Admin Base E2E');
    a = await db.createTenantWithUser('Cliente Montese Base E2E A');
    b = await db.createTenantWithUser('Cliente Montese Base E2E B');
    for (const p of ['documents.read', 'documents.create_draft', 'empresas.read']) await db.grantSocioPermission(socio.userId, p);
    await db.grantSocioPermission(semPerm.userId, 'documents.read');
    for (const c of ['pgr', 'ltcat', 'pcmso']) {
      await db.client.query("INSERT INTO document_type_permissions (category, user_id, action, granted_by) VALUES ($1,$2,'elaborar',$3)", [c, socio.userId, admin.userId]);
    }
    [tS, tSem] = await Promise.all([socio, semPerm].map(login));
  }, 90000);

  afterAll(async () => {
    try {
      const us = [socio, semPerm, admin].map((u) => u.userId);
      await db.client.query('DELETE FROM document_drafts WHERE tenant_id = ANY($1)', [[a.tenantId, b.tenantId]]);
      await db.client.query('DELETE FROM document_type_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
      await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
      await db.cleanup();
    } finally {
      await db.disconnect();
      await app.close();
    }
  });

  it('cria LTCAT ligado ao PGR da mesma empresa; detalhe do LTCAT mostra a base e o do PGR lista o derivado', async () => {
    const pgr = (await criar(a.tenantId, 'pgr', 'PGR base A')).body;
    const lt = await criar(a.tenantId, 'ltcat', 'LTCAT A', pgr.id);
    expect(lt.status).toBe(201);
    expect(lt.body.base).toMatchObject({ id: pgr.id, category: 'pgr', status: 'em_elaboracao' });
    expect(lt.body.avisos_base.map((x: any) => x.codigo)).toContain('base_nao_publicada');
    const det = (await api('get', tS, pgr.id)).body;
    expect(det.derivados.map((x: any) => x.id)).toContain(lt.body.id);
    expect(det.base).toBeNull();
  });

  it('recusa base de outra empresa, base que não é PGR e categoria sem direito a base (sem vazar mensagem do banco)', async () => {
    const pgrB = (await criar(b.tenantId, 'pgr', 'PGR B')).body;
    const pcmso = (await criar(a.tenantId, 'pcmso', 'PCMSO A')).body;
    const r1 = await criar(a.tenantId, 'ltcat', 'LTCAT x', pgrB.id);
    expect(r1.status).toBe(409);
    expect(JSON.stringify(r1.body)).not.toMatch(/document_drafts:/);
    expect((await criar(a.tenantId, 'ltcat', 'LTCAT y', pcmso.id)).status).toBe(409);
    const pgrA = (await criar(a.tenantId, 'pgr', 'PGR A2')).body;
    expect((await criar(a.tenantId, 'pcmso', 'PCMSO z', pgrA.id)).status).toBe(409);
  });

  it('PATCH :id/base define, troca e remove; exige a ação elaborar da matriz e permissão de rascunho', async () => {
    const pgr1 = (await criar(a.tenantId, 'pgr', 'PGR P1')).body;
    const pgr2 = (await criar(a.tenantId, 'pgr', 'PGR P2')).body;
    const lt = (await criar(a.tenantId, 'ltcat', 'LTCAT patch')).body;
    expect((await api('patch', tS, `${lt.id}/base`, { base_draft_id: pgr1.id })).body.base_draft_id).toBe(pgr1.id);
    expect((await api('patch', tS, `${lt.id}/base`, { base_draft_id: pgr2.id })).body.base_draft_id).toBe(pgr2.id);
    expect((await api('patch', tS, `${lt.id}/base`, { base_draft_id: null })).body.base_draft_id).toBeNull();
    expect((await api('patch', tS, `${lt.id}/base`, { base_draft_id: 'nao-uuid' })).status).toBe(400);
    expect((await api('patch', tSem, `${lt.id}/base`, { base_draft_id: pgr1.id })).status).toBe(403);
    // sem 'elaborar' em lip na matriz
    const lip = (await db.client.query("INSERT INTO document_drafts (tenant_id, category, title, created_by) VALUES ($1,'lip','LIP sem matriz',$2) RETURNING id", [a.tenantId, socio.userId])).rows[0].id;
    expect((await api('patch', tS, `${lip}/base`, { base_draft_id: pgr1.id })).status).toBe(403);
    const aud = await db.client.query("SELECT detail FROM audit_log WHERE action='document_draft.base_defined' AND resource_id=$1", [lt.id]);
    expect(aud.rowCount).toBeGreaterThanOrEqual(3);
    expect(aud.rows.every((r: any) => !/PGR|LTCAT/.test(r.detail))).toBe(true);
  });

  it('aviso base_mais_nova quando o PGR-base tem versão mais recente que a do documento', async () => {
    const pgr = (await criar(a.tenantId, 'pgr', 'PGR versao')).body;
    const lt = (await criar(a.tenantId, 'ltcat', 'LTCAT versao', pgr.id)).body;
    const v = async (draft: string, n: number, quando: string) => {
      const id = (await db.client.query(
        "INSERT INTO document_draft_versions (draft_id, tenant_id, version_number, file_key, file_name, mime_type, size_bytes, sha256, created_by, created_at) VALUES ($1,$2,$3,$4,'a.pdf','application/pdf',10,$5,$6,$7) RETURNING id",
        [draft, a.tenantId, n, `documents-fluxo/teste/${draft}/${n}`, 'c'.repeat(64), socio.userId, quando])).rows[0].id;
      await db.client.query('UPDATE document_drafts SET current_version_id=$2 WHERE id=$1', [draft, id]);
    };
    await v(lt.id, 1, '2026-01-01T00:00:00Z');
    await v(pgr.id, 1, '2026-02-01T00:00:00Z');
    const det = (await api('get', tS, lt.id)).body;
    expect(det.avisos_base.map((x: any) => x.codigo)).toEqual(expect.arrayContaining(['base_mais_nova', 'base_nao_publicada']));
  });

  it('visão por empresa: um rascunho por tipo técnico, só da empresa pedida; exige empresas.read; 404 para empresa inexistente', async () => {
    const r = await api('get', tS, `empresa/${a.tenantId}/tecnicos`);
    expect(r.status).toBe(200);
    const cats = r.body.map((x: any) => x.category);
    expect(new Set(cats).size).toBe(cats.length);
    expect(cats).toEqual(expect.arrayContaining(['pgr', 'ltcat']));
    expect(r.body.every((x: any) => ['pgr', 'ltcat', 'lip', 'laudo', 'pcmso'].includes(x.category))).toBe(true);
    const lt = r.body.find((x: any) => x.category === 'ltcat');
    expect(lt).toHaveProperty('avisos_base');
    expect(lt).toHaveProperty('correcoes_pendentes');
    const rb = await api('get', tS, `empresa/${b.tenantId}/tecnicos`);
    expect(rb.body.every((x: any) => x.title !== 'LTCAT A')).toBe(true);
    expect((await api('get', tSem, `empresa/${a.tenantId}/tecnicos`)).status).toBe(403);
    expect((await api('get', tS, 'empresa/00000000-0000-4000-8000-000000000000/tecnicos')).status).toBe(404);
  });
});
