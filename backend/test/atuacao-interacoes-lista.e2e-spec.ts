import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { MercadoPagoService } from '../src/payments/mercadopago.service';
import { TestDb, TestTenantFixture, TestUserFixture } from './db-test-helper';

process.env.RATE_LIMIT_MAX = '5000';

// D2 Task 2: GET /atuacao/interacoes (histórico global de atendimentos, somente leitura).
describe('atuacao-interacoes-lista — histórico global (e2e HTTP)', () => {
  let app: INestApplication;
  let db: TestDb;
  let sOk: TestUserFixture, sSem: TestUserFixture, admin: TestUserFixture, tecnico: TestUserFixture;
  let m1: TestTenantFixture, m2: TestTenantFixture, parceiro: TestTenantFixture;
  let tOk: string, tSem: string, tAdmin: string, tTec: string, tEmp: string, tPar: string;
  const sufixo = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};

  const login = async (u: { email: string; password: string }) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;
  const get = (t: string, q = '') => request(app.getHttpServer()).get(`/atuacao/interacoes${q}`).set({ Authorization: `Bearer ${t}` });
  const mk = async (tenantId: string, type: string, dia: string, summary: string, extra: { participants?: string; decisions?: string } = {}) =>
    (await db.client.query(
      `INSERT INTO client_interactions (tenant_id, created_by, type, occurred_on, summary, participants, decisions)
       VALUES ($1,$2,$3,$4::date,$5,$6,$7) RETURNING id`,
      [tenantId, sOk.userId, type, dia, summary, extra.participants ?? null, extra.decisions ?? null],
    )).rows[0].id as string;
  const doTenant = (body: any, tenantId: string) => (body.itens as any[]).filter((i) => i.tenant_id === tenantId);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MercadoPagoService).useValue({ createPreapproval: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    sOk = await db.createUserWithRole('socio', `Socio Int Ok ${sufixo}`);
    sSem = await db.createUserWithRole('socio', `Socio Int Sem ${sufixo}`);
    admin = await db.createUserWithRole('admin', `Admin Int ${sufixo}`);
    tecnico = await db.createUserWithRole('tecnico', `Tec Int ${sufixo}`);
    const parceiroUser = await db.createUserWithRole('parceiro', `Parc Int ${sufixo}`);
    m1 = await db.createTenantWithUser('Cliente Montese Int 1');
    m2 = await db.createTenantWithUser('Cliente Montese Int 2');
    parceiro = await db.createTenantWithUser('Cliente Parceiro Int');
    const tec = await db.client.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecnico.userId]);
    await db.client.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [parceiro.tenantId, tec.rows[0].id]);
    await db.grantSocioPermission(sOk.userId, 'clients.read');

    ids.a1 = await mk(m1.tenantId, 'reuniao', '2026-01-10', `A1 ${sufixo}`);
    ids.a2 = await mk(m1.tenantId, 'ligacao', '2026-01-11', `A2 ${sufixo}`);
    ids.a3 = await mk(m1.tenantId, 'visita', '2026-01-12', 'x'.repeat(250), { participants: `Participante Secreto ${sufixo}`, decisions: `Decisao Secreta ${sufixo}` });
    ids.b1 = await mk(m2.tenantId, 'reuniao', '2026-01-11', `B1 ${sufixo}`);
    ids.p1 = await mk(parceiro.tenantId, 'reuniao', '2026-01-11', `Parceiro ${sufixo}`);
    [tOk, tSem, tAdmin, tTec, tEmp, tPar] = await Promise.all([sOk, sSem, admin, tecnico, m1, parceiroUser].map(login));
  }, 90000);

  afterAll(async () => {
    const us = [sOk, sSem].map((u) => u.userId);
    await db.client.query('DELETE FROM client_interactions WHERE created_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM socio_permissions WHERE user_id = ANY($1) OR granted_by = ANY($1)', [us]);
    await db.client.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1)', [us]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  }, 60000);

  it('autorização: sem token 401; sem clients.read 403; empresa/técnico/parceiro/admin 403', async () => {
    expect((await request(app.getHttpServer()).get('/atuacao/interacoes')).status).toBe(401);
    const sem = await get(tSem);
    expect(sem.status).toBe(403);
    expect(JSON.stringify(sem.body)).toContain('PERMISSION_DENIED');
    for (const t of [tEmp, tTec, tPar, tAdmin]) expect((await get(t)).status).toBe(403);
  });

  it('lista as empresas Montese ordenada por data desc (desempate estável), com empresa, href e sem parceiro', async () => {
    const r = await get(tOk, `?from=2026-01-01&to=2026-01-31`);
    expect(r.status).toBe(200);
    const nossos = (r.body.itens as any[]).filter((i) => [m1.tenantId, m2.tenantId, parceiro.tenantId].includes(i.tenant_id));
    expect(nossos.map((i) => i.id)).toEqual([ids.a3, ids.b1, ids.a2, ids.a1]); // empate em 01-11: criado depois primeiro
    expect(nossos.map((i) => i.occurred_on)).toEqual(['2026-01-12', '2026-01-11', '2026-01-11', '2026-01-10']);
    expect(nossos.some((i) => i.tenant_id === parceiro.tenantId)).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain(`Parceiro ${sufixo}`);
    const a1 = nossos.find((i) => i.id === ids.a1);
    expect(Object.keys(a1).sort()).toEqual(['created_by_name', 'empresa', 'href', 'id', 'occurred_on', 'summary', 'summary_truncado', 'tenant_id', 'type']);
    expect(a1).toMatchObject({ empresa: expect.stringContaining('Cliente Montese Int 1'), type: 'reuniao', href: `/atuacao/empresas/${m1.tenantId}`, summary_truncado: false });
    expect(r.body.page_size).toBe(100);
  });

  it('resumo cortado em 200 e sem participantes/decisões/próximos passos', async () => {
    const r = await get(tOk, `?tenantId=${m1.tenantId}&tipo=visita`);
    expect(r.status).toBe(200);
    expect(r.body.itens).toHaveLength(1);
    expect(r.body.itens[0].summary).toHaveLength(200);
    expect(r.body.itens[0].summary_truncado).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('Secret');
  });

  it('filtros: tenantId, tipo e período (bordas inclusivas), combinados', async () => {
    expect(doTenant((await get(tOk, `?tenantId=${m2.tenantId}`)).body, m2.tenantId).map((i) => i.id)).toEqual([ids.b1]);
    expect((await get(tOk, `?tenantId=${m1.tenantId}`)).body.itens.every((i: any) => i.tenant_id === m1.tenantId)).toBe(true);
    const tipo = (await get(tOk, `?tenantId=${m1.tenantId}&tipo=ligacao`)).body;
    expect(tipo.itens.map((i: any) => i.id)).toEqual([ids.a2]);
    const so11 = (await get(tOk, `?from=2026-01-11&to=2026-01-11`)).body;
    expect(so11.itens.map((i: any) => i.id).sort()).toEqual([ids.a2, ids.b1].sort());
    const aPartir = (await get(tOk, `?tenantId=${m1.tenantId}&from=2026-01-11`)).body;
    expect(aPartir.itens.map((i: any) => i.id)).toEqual([ids.a3, ids.a2]);
    const ate = (await get(tOk, `?tenantId=${m1.tenantId}&to=2026-01-10`)).body;
    expect(ate.itens.map((i: any) => i.id)).toEqual([ids.a1]);
    expect((await get(tOk, `?tenantId=${m1.tenantId}&tipo=email`)).body).toMatchObject({ itens: [], total: 0 });
  });

  it('paginação: 100 por página, total real, página além do fim vazia', async () => {
    await db.client.query(
      `INSERT INTO client_interactions (tenant_id, created_by, type, occurred_on, summary)
       SELECT $1, $2, 'outro', '2025-06-01'::date + (g % 28), 'Lote ' || g FROM generate_series(1,130) g`,
      [m2.tenantId, sOk.userId],
    );
    const p1 = (await get(tOk, `?tenantId=${m2.tenantId}`)).body;
    expect(p1.total).toBe(131);
    expect(p1.itens).toHaveLength(100);
    const p2 = (await get(tOk, `?tenantId=${m2.tenantId}&page=2`)).body;
    expect(p2.itens).toHaveLength(31);
    const todos = [...p1.itens, ...p2.itens].map((i: any) => i.id);
    expect(new Set(todos).size).toBe(131); // sem sobreposição entre páginas
    expect(p1.itens[0].id).toBe(ids.b1); // mais recente (2026) primeiro
    const alem = (await get(tOk, `?tenantId=${m2.tenantId}&page=50`)).body;
    expect(alem.itens).toEqual([]);
    expect(alem.total).toBe(131);
  });

  it('tenantId de parceiro ou inexistente => 404 uniforme; entradas inválidas => 400', async () => {
    const par = await get(tOk, `?tenantId=${parceiro.tenantId}`);
    const inex = await get(tOk, `?tenantId=${randomUUID()}`);
    expect(par.status).toBe(404);
    expect(inex.status).toBe(404);
    expect(par.body.message).toBe(inex.body.message);
    for (const q of ['?tenantId=abc', '?tipo=zzz', '?from=2026-02-30', '?to=10/01/2026', '?from=2026-02-01&to=2026-01-01', '?page=0', '?page=x', '?foo=1']) {
      expect({ q, s: (await get(tOk, q)).status }).toEqual({ q, s: 400 });
    }
  });

  it('auditoria: company.accessed com módulo, sem texto livre', async () => {
    await get(tOk, `?tenantId=${m1.tenantId}&tipo=visita`);
    const a = await db.client.query(
      "SELECT detail, resource_id FROM audit_log WHERE actor_user_id = $1 AND action = 'company.accessed' AND detail = 'modulo: atendimentos-carteira'",
      [sOk.userId],
    );
    expect(a.rowCount).toBeGreaterThan(0);
    expect(JSON.stringify(a.rows)).not.toContain(sufixo);
    expect(JSON.stringify(a.rows)).not.toContain('xxxx');
  });
});
