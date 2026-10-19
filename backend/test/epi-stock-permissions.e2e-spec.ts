import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('Permissões e isolamento do estoque de EPI (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tokenTec: string;
  let tokenAdmin: string;
  let tokenTecLinked: string;
  let tokenPartner: string;
  let userA: string;
  let epiA: string;
  let epiB: string;
  let movA: string;

  const srv = () => app.getHttpServer();
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const authA = () => bearer(tokenA);
  const authB = () => bearer(tokenB);
  const tec = () => bearer(tokenTec);
  const adm = () => bearer(tokenAdmin);
  const login = async (email: string, password: string) =>
    (await request(srv()).post('/auth/login').send({ email, password })).body.access_token as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    const a = await db.createTenantWithUser('Empresa Epi Perm A');
    const b = await db.createTenantWithUser('Empresa Epi Perm B');
    const tecnico = await db.createUserWithRole('tecnico', 'Tecnico Epi Perm');
    const admin = await db.createUserWithRole('admin', 'Admin Epi Perm');
    const tecV = await db.createUserWithRole('tecnico', 'Tecnico Vinculado Epi Perm');
    const parc = await db.createUserWithRole('parceiro', 'Parceiro Vinculado Epi Perm');
    const c = (db as any).client;
    const techId = (await c.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecV.userId])).rows[0].id;
    await c.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [a.tenantId, techId]);
    const partId = (await c.query(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`, [parc.userId])).rows[0].id;
    await c.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [a.tenantId, partId]);
    tokenTecLinked = await login(tecV.email, tecV.password);
    tokenPartner = await login(parc.email, parc.password);
    userA = a.userId;
    tokenA = await login(a.email, a.password);
    tokenB = await login(b.email, b.password);
    tokenTec = await login(tecnico.email, tecnico.password);
    tokenAdmin = await login(admin.email, admin.password);

    const cat = (await request(srv()).get('/epi-catalog-items').set(authA())).body;
    epiA = (await request(srv()).post('/epis').set(authA())
      .send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-PERM-A' })).body.id;
    epiB = (await request(srv()).post('/epis').set(authB())
      .send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-PERM-B' })).body.id;
    const m = await request(srv()).post(`/epis/${epiA}/movements`).set(authA())
      .send({ type: 'abertura', quantity: 20, idempotency_key: 'perm-open-0001' });
    movA = m.body.id;
  });

  afterAll(async () => {
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('técnico não faz ajuste, estorno nem abertura (403)', async () => {
    expect((await request(srv()).post(`/epis/${epiA}/adjustments`).set(tec())
      .send({ direction: 'mais', quantity: 1, reason: 'Contagem', idempotency_key: 'perm-adj-0001' })).status).toBe(403);
    expect((await request(srv()).post(`/epis/movements/${movA}/reversal`).set(tec())
      .send({ reason: 'Teste', idempotency_key: 'perm-rev-0001' })).status).toBe(403);
    expect((await request(srv()).post(`/epis/${epiA}/movements`).set(tec())
      .send({ type: 'abertura', quantity: 1, idempotency_key: 'perm-open-0002' })).status).toBe(403);
  });

  it('empresa B não vê nem movimenta o EPI da empresa A', async () => {
    const r = await request(srv()).post(`/epis/${epiA}/movements`).set(authB())
      .send({ type: 'entrada', quantity: 1, supplier: 'F', idempotency_key: 'perm-iso-0001' });
    expect(r.status).toBe(404);
    const list = await request(srv()).get(`/epis/movements?tenant_epi_id=${epiA}`).set(authB());
    expect(list.body.total).toBe(0);
    const rev = await request(srv()).post(`/epis/movements/${movA}/reversal`).set(authB())
      .send({ reason: 'Tentativa', idempotency_key: 'perm-iso-0002' });
    expect(rev.status).toBe(404);
    const adj = await request(srv()).post(`/epis/${epiA}/adjustments`).set(authB())
      .send({ direction: 'mais', quantity: 1, reason: 'Tentativa', idempotency_key: 'perm-iso-0003' });
    expect(adj.status).toBe(404);
  });

  it('a mesma idempotency_key pode existir em empresas diferentes sem colidir', async () => {
    const a = await request(srv()).post(`/epis/${epiA}/movements`).set(authA())
      .send({ type: 'entrada', quantity: 1, supplier: 'F', idempotency_key: 'chave-compartilhada-1' });
    const b = await request(srv()).post(`/epis/${epiB}/movements`).set(authB())
      .send({ type: 'entrada', quantity: 1, supplier: 'F', idempotency_key: 'chave-compartilhada-1' });
    expect([a.status, b.status]).toEqual([201, 201]);
  });

  it('ajuste manual exige motivo e fica registrado com autor', async () => {
    const r = await request(srv()).post(`/epis/${epiA}/adjustments`).set(authA())
      .send({ direction: 'menos', quantity: 1, reason: 'Contagem física', idempotency_key: 'perm-adj-0002' });
    expect(r.status).toBe(201);
    expect(r.body.created_by_user_id).toBe(userA);
    expect((await request(srv()).post(`/epis/${epiA}/adjustments`).set(authA())
      .send({ direction: 'menos', quantity: 1, reason: '', idempotency_key: 'perm-adj-0003' })).status).toBe(400);
  });

  it('admin faz ajuste e estorno em EPI de qualquer empresa (tenant vem da linha do EPI)', async () => {
    const adj = await request(srv()).post(`/epis/${epiA}/adjustments`).set(adm())
      .send({ direction: 'mais', quantity: 2, reason: 'Ajuste do administrador', idempotency_key: 'perm-adm-0001' });
    expect(adj.status).toBe(201);
    const rev = await request(srv()).post(`/epis/movements/${adj.body.id}/reversal`).set(adm())
      .send({ reason: 'Estorno do administrador', idempotency_key: 'perm-adm-0002' });
    expect(rev.status).toBe(201);
    expect(rev.body.reverses_movement_id).toBe(adj.body.id);
  });

  it('técnico e parceiro vinculados: 403 em ajuste, estorno e abertura (RolesGuard), mas 201 em entrada e baixa', async () => {
    for (const [nome, h] of [['tecnico', () => bearer(tokenTecLinked)], ['parceiro', () => bearer(tokenPartner)]] as const) {
      const r = (path: string, body: Record<string, unknown>) => request(srv()).post(path).set(h()).send(body);
      expect([nome, (await r(`/epis/${epiA}/adjustments`, { direction: 'mais', quantity: 1, reason: 'Contagem', idempotency_key: `perm-${nome}-adj01` })).status]).toEqual([nome, 403]);
      expect([nome, (await r(`/epis/movements/${movA}/reversal`, { reason: 'Teste', idempotency_key: `perm-${nome}-rev01` })).status]).toEqual([nome, 403]);
      expect([nome, (await r(`/epis/${epiA}/movements`, { type: 'abertura', quantity: 1, idempotency_key: `perm-${nome}-open1` })).status]).toEqual([nome, 403]);
      expect([nome, (await r(`/epis/${epiA}/movements`, { type: 'entrada', quantity: 2, supplier: 'F', idempotency_key: `perm-${nome}-ent01` })).status]).toEqual([nome, 201]);
      expect([nome, (await r(`/epis/${epiA}/movements`, { type: 'baixa', quantity: 1, reason: 'Item danificado', idempotency_key: `perm-${nome}-bai01` })).status]).toEqual([nome, 201]);
    }
  });
});
