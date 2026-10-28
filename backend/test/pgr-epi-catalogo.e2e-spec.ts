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

// PGR (sub-projeto A), Task 7b: GET /atuacao/pgr/epi-catalogo (catálogo global de EPI, somente leitura).
describe('pgr-epi-catalogo — catálogo de EPI para o sócio (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sLeitor: TestUserFixture, sEditor: TestUserFixture, sNada: TestUserFixture, admin: TestUserFixture;
  let A: { tenantId: string; userId: string; email: string; password: string };
  let tLeitor: string, tEditor: string, tNada: string, tAdmin: string, tEmp: string;
  const sufixo = randomUUID().slice(0, 8);
  let epi: string, epi2: string;

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (t: string, qs = '') => request(app.getHttpServer()).get(`/atuacao/pgr/epi-catalogo${qs}`).set(auth(t));

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
    sLeitor = await db.createUserWithRole('socio', `Socio Epi Leitor ${sufixo}`);
    sEditor = await db.createUserWithRole('socio', `Socio Epi Editor ${sufixo}`);
    sNada = await db.createUserWithRole('socio', `Socio Epi Nada ${sufixo}`);
    admin = await db.createUserWithRole('admin', 'Admin Epi');
    A = await db.createTenantWithUser('Cliente Montese Epi A');
    await db.grantSocioPermission(sLeitor.userId, 'pgr.read');
    await db.grantSocioPermission(sEditor.userId, 'pgr.read');
    await db.grantSocioPermission(sEditor.userId, 'pgr.write');
    epi = await db.insertRawRow('epi_catalog_items', { category: 'A', code: `TESTE-${sufixo}`, equipment_group: 'TESTE', description: `Zzluva 100% teste_${sufixo}`, risk_protected: 'TESTE' });
    epi2 = await db.insertRawRow('epi_catalog_items', { category: 'A', code: `TESTE2-${sufixo}`, equipment_group: 'TESTE', description: `Zzbota teste ${sufixo}`, risk_protected: 'TESTE' });
    [tLeitor, tEditor, tNada, tAdmin, tEmp] = await Promise.all([sLeitor, sEditor, sNada, admin, A].map(login));
  }, 90000);

  afterAll(async () => {
    const us = [sLeitor.userId, sEditor.userId, sNada.userId, admin.userId];
    await db.client.query('DELETE FROM pgr_risk_controls WHERE epi_catalog_item_id = ANY($1)', [[epi, epi2]]);
    await db.client.query('DELETE FROM pgr_risks WHERE tenant_id = $1', [A.tenantId]);
    await db.client.query('DELETE FROM pgr_ghes WHERE tenant_id = $1', [A.tenantId]);
    await db.client.query('DELETE FROM pgr_hazards WHERE tenant_id = $1', [A.tenantId]);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [us]);
    await db.client.query('DELETE FROM epi_catalog_items WHERE id = ANY($1)', [[epi, epi2]]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  it('exige pgr.read; empresa ⇒ 403', async () => {
    const r = await get(tNada);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('PERMISSION_DENIED');
    expect((await get(tEmp)).status).toBe(403);
    expect((await get(tLeitor)).status).toBe(200);
    expect((await get(tAdmin)).status).toBe(200);
  });

  it('lista com whitelist de colunas e limite 200; q filtra e escapa curingas', async () => {
    const all = await get(tLeitor);
    expect(all.body.length).toBeLessThanOrEqual(200);
    expect(all.body.length).toBeGreaterThan(0);
    for (const x of all.body) {
      expect(Object.keys(x).sort().join()).toBe('category,code,description,equipment_group,id,related_nr,risk_protected');
    }
    const f = await get(tLeitor, `?q=zzluva`);
    expect(f.body.map((x: any) => x.id)).toEqual([epi]);
    expect((await get(tLeitor, `?q=${encodeURIComponent('100%')}`)).body.map((x: any) => x.id)).toEqual([epi]);
    // '_' literal: "teste_<suf>" não casa com "teste <suf>" (epi2); '%' literal não vira curinga
    expect((await get(tLeitor, `?q=${encodeURIComponent(`teste_${sufixo}`)}`)).body.map((x: any) => x.id)).toEqual([epi]);
    expect((await get(tLeitor, `?q=${encodeURIComponent(`%zz%${sufixo}`)}`)).body).toEqual([]);
    expect((await get(tLeitor, `?q=nada-existe-${sufixo}`)).body).toEqual([]);
  });

  it('sócio com pgr.write cria controle EPI com id real do catálogo via API de riscos; id inexistente ⇒ 400', async () => {
    const ghe = (await request(app.getHttpServer()).post(`/atuacao/pgr/empresas/${A.tenantId}/ghes`).set(auth(tEditor)).send({ name: `TESTE ghe epi ${sufixo}` }));
    expect(ghe.status).toBe(201);
    const perigo = { id: await db.insertRawRow('pgr_hazards', { scope: 'tenant', tenant_id: A.tenantId, name: `TESTE perigo epi ${sufixo}`, category: 'fisico' }) };
    const rr = await request(app.getHttpServer()).post(`/atuacao/pgr/empresas/${A.tenantId}/ghes/${ghe.body.id}/riscos`).set(auth(tEditor))
      .send({ hazard_ids: [perigo.id] });
    expect(rr.status).toBe(201);
    const risco = { body: rr.body.riscos[0] };
    const c = await request(app.getHttpServer()).post(`/atuacao/pgr/empresas/${A.tenantId}/riscos/${risco.body.id}/controles`).set(auth(tEditor))
      .send({ kind: 'epi', status: 'existente', description: 'TESTE epi', epi_catalog_item_id: epi });
    expect(c.status).toBe(201);
    expect(c.body.epi_catalog_item_id).toBe(epi);
    const x = await request(app.getHttpServer()).post(`/atuacao/pgr/empresas/${A.tenantId}/riscos/${risco.body.id}/controles`).set(auth(tEditor))
      .send({ kind: 'epi', status: 'existente', description: 'x', epi_catalog_item_id: randomUUID() });
    expect(x.status).toBe(400);
  });
});
