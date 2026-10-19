import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { extractPdfTextFull } from '../src/common/pdf/pdf-text.util';
import { TestDb } from './db-test-helper';

// beforeAll com bcrypt/tenants estoura os 5 s padrão sob carga do host.
jest.setTimeout(120_000);

describe('GET /epi-fichas/employees/:employeeId/preview.pdf (e2e)', () => {
  let app: INestApplication;
  let srv: any;
  let db: TestDb;
  let sql: Client;
  let token: string;
  let tokenB: string;
  let tenantId: string;
  let employeeId: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const binary = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };
  const preview = (id: string, qs = '', h: Record<string, string> = auth()) =>
    request(srv).get(`/epi-fichas/employees/${id}/preview.pdf${qs}`).set(h).buffer(true).parse(binary as any);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app); // espelha a produção (ValidationPipe global)
    await app.init();
    srv = app.getHttpServer();
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();
    const t = await db.createTenantWithUser('Empresa Epi Pdf');
    tenantId = t.tenantId;
    employeeId = t.employeeId;
    token = (await request(srv).post('/auth/login').send({ email: t.email, password: t.password })).body.access_token;
    const b = await db.createTenantWithUser('Empresa Epi Pdf B');
    tokenB = (await request(srv).post('/auth/login').send({ email: b.email, password: b.password })).body.access_token;
  });

  afterAll(async () => {
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  it('200, application/pdf, sem cache; texto traz NÃO EMITIDO e o nome do funcionário', async () => {
    const r = await preview(employeeId);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.headers['cache-control']).toBe('private, no-store');
    const buf = r.body as Buffer;
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const name = (await sql.query('SELECT full_name FROM employees WHERE id = $1', [employeeId])).rows[0].full_name;
    const text = (await extractPdfTextFull(buf)) ?? '';
    expect(text).toContain('NÃO EMITIDO');
    expect(text).toContain(name);
  });

  it('a prévia não grava nada em epi_ficha_documents', async () => {
    const count = async () =>
      Number((await sql.query('SELECT count(*)::int AS n FROM epi_ficha_documents WHERE tenant_id = $1', [tenantId])).rows[0].n);
    const before = await count();
    expect((await preview(employeeId)).status).toBe(200);
    expect(await count()).toBe(before);
  });

  it('empresa B recebe 404 para funcionário da A', async () => {
    const r = await preview(employeeId, '', { Authorization: `Bearer ${tokenB}` });
    expect(r.status).toBe(404);
  });

  it('filtro inválido e id não UUID -> 400', async () => {
    expect((await preview(employeeId, '?from=ontem')).status).toBe(400);
    expect((await preview(employeeId, '?signature_status=xyz')).status).toBe(400);
    expect((await preview('abc')).status).toBe(400);
  });

  it('sem token -> 401', async () => {
    expect((await preview(employeeId, '', {})).status).toBe(401);
  });
});
