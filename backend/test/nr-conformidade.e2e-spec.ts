import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TestDb } from './db-test-helper';

describe('GET /dashboard/nr-conformidade e /nr-aplicaveis (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let tokenA: string;
  let tokenB: string;
  let tenantA: string;
  let tenantB: string;
  let userA: string;
  let userB: string;
  let techToken: string;
  let techUserId: string;
  let technicianId: string;
  let tenantC: string; // não vinculado ao técnico
  const client = () => (db as any).client;

  async function login(email: string, password: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    return res.body.access_token;
  }
  async function doc(tenantId: string, userId: string, category: string, expiresSql: string) {
    await client().query(
      `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
       VALUES ($1, $2, 'Doc NR Teste', 'fixture/x.pdf', 'x.pdf', 'application/pdf', 100, ${expiresSql}, $3, 'empresa')`,
      [tenantId, category, userId],
    );
  }
  async function marcar(tenantId: string, code: string, userId: string) {
    await client().query(
      `INSERT INTO company_applicable_nrs (tenant_id, nr_code, marked_by_user_id) VALUES ($1, $2, $3)`,
      [tenantId, code, userId],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = new TestDb();
    await db.connect();
    const a = await db.createTenantWithUser('Empresa NR A Teste');
    const b = await db.createTenantWithUser('Empresa NR B Teste');
    const c = await db.createTenantWithUser('Empresa NR C Teste');
    tenantA = a.tenantId;
    tenantB = b.tenantId;
    tenantC = c.tenantId;
    userA = a.userId;
    userB = b.userId;
    tokenA = await login(a.email, a.password);
    tokenB = await login(b.email, b.password);

    const tech = await db.createUserWithRole('tecnico', 'Tecnico NR Teste');
    techUserId = tech.userId;
    const t = await client().query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tech.userId]);
    technicianId = t.rows[0].id;
    await client().query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tenantA, technicianId]);
    techToken = await login(tech.email, tech.password);

    // Empresa A: NR-1 e NR-7 marcadas; PGR vigente (+200 dias), PCMSO vencido (-5 dias).
    await marcar(tenantA, 'NR-1', userA);
    await marcar(tenantA, 'NR-7', userA);
    await doc(tenantA, userA, 'pgr', 'current_date + 200');
    await doc(tenantA, userA, 'pcmso', 'current_date - 5');
    // Empresa B: documento PGR e UMA marca própria e distinta (NR-5), que A nunca deve ver
    // e que B deve ver sozinha (prova isolamento nos dois sentidos).
    await doc(tenantB, b.userId, 'pgr', 'current_date + 200');
    await marcar(tenantB, 'NR-5', userB);
    // Empresa C: marcada e com dados, mas o técnico NÃO é vinculado a ela.
    await marcar(tenantC, 'NR-1', c.userId);
  });

  afterAll(async () => {
    await client().query('DELETE FROM company_applicable_nrs WHERE tenant_id = ANY($1::uuid[])', [[tenantA, tenantB, tenantC]]);
    await client().query('DELETE FROM tenant_technicians WHERE tenant_id = $1', [tenantA]);
    await client().query('DELETE FROM technicians WHERE id = $1', [technicianId]);
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('calcula o status por NR marcada, na ordem do catálogo, com fonte oficial', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.nrs.map((n: any) => [n.code, n.status])).toEqual([
      ['NR-1', 'em_dia'],
      ['NR-7', 'pendente'],
    ]);
    expect(res.body.nrs[0].evidencia.quantidade).toBe(1);
    expect(res.body.nrs[0].evidencia.proxima_validade).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.nrs[0].fonte_oficial_url).toMatch(/^https:\/\//);
  });

  it('cada empresa vê só as próprias marcas: B vê exatamente NR-5 (isolamento A×B)', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.nrs.map((n: any) => n.code)).toEqual(['NR-5']);
    expect(res.body.nrs.map((n: any) => n.code)).not.toContain('NR-1');
    expect(res.body.nrs.map((n: any) => n.code)).not.toContain('NR-7');
  });

  it('A nunca vê a NR-5 de B', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.nrs.map((n: any) => n.code)).not.toContain('NR-5');
    expect(res.body.nrs.map((n: any) => n.code)).toEqual(['NR-1', 'NR-7']);
  });

  it('empresa ignora tenant_id da query e só vê a própria (nunca confia no id do frontend)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/dashboard/nr-conformidade?tenant_id=${tenantA}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.nrs.map((n: any) => n.code)).toEqual(['NR-5']);
  });

  it('empresa sem NR vigente recebe lista vazia, mesmo com documentos (estado vazio)', async () => {
    await client().query(`UPDATE company_applicable_nrs SET unmarked_at = now() WHERE tenant_id = $1 AND nr_code = 'NR-5'`, [tenantB]);
    try {
      const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade').set('Authorization', `Bearer ${tokenB}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ nrs: [] });
    } finally {
      await client().query(`UPDATE company_applicable_nrs SET unmarked_at = NULL WHERE tenant_id = $1 AND nr_code = 'NR-5'`, [tenantB]);
    }
  });

  it('técnico vinculado lê a empresa A pelo tenant_id', async () => {
    const res = await request(app.getHttpServer())
      .get(`/dashboard/nr-conformidade?tenant_id=${tenantA}`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.nrs.map((n: any) => n.code)).toEqual(['NR-1', 'NR-7']);
  });

  it('técnico NÃO vinculado recebe 403 (não um "tudo vazio")', async () => {
    const res = await request(app.getHttpServer())
      .get(`/dashboard/nr-conformidade?tenant_id=${tenantC}`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(403);
  });

  it('técnico sem tenant_id recebe 400', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade').set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(400);
  });

  it('sem token recebe 401', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade');
    expect(res.status).toBe(401);
  });

  it('nr-aplicaveis devolve o catálogo completo e só as marcadas vigentes', async () => {
    const res = await request(app.getHttpServer())
      .get(`/dashboard/nr-aplicaveis?tenant_id=${tenantA}`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.catalogo.map((n: any) => n.code)).toEqual(['NR-1', 'NR-5', 'NR-6', 'NR-7', 'NR-15', 'NR-16', 'NR-23']);
    expect(res.body.marcadas).toEqual(['NR-1', 'NR-7']);
  });

  it('NR desmarcada (unmarked_at) some do cálculo', async () => {
    await client().query(`UPDATE company_applicable_nrs SET unmarked_at = now() WHERE tenant_id = $1 AND nr_code = 'NR-7'`, [tenantA]);
    const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade').set('Authorization', `Bearer ${tokenA}`);
    expect(res.body.nrs.map((n: any) => n.code)).toEqual(['NR-1']);
    await client().query(`UPDATE company_applicable_nrs SET unmarked_at = NULL WHERE tenant_id = $1 AND nr_code = 'NR-7'`, [tenantA]);
  });

  it('NR marcada sem nenhuma evidência fica pendente com quantidade 0', async () => {
    await marcar(tenantA, 'NR-23', userA);
    const res = await request(app.getHttpServer()).get('/dashboard/nr-conformidade').set('Authorization', `Bearer ${tokenA}`);
    const nr23 = res.body.nrs.find((n: any) => n.code === 'NR-23');
    expect(nr23.status).toBe('pendente');
    expect(nr23.evidencia.quantidade).toBe(0);
  });
});
