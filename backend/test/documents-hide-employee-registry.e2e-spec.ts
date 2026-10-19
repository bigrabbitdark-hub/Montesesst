import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import ExcelJS from 'exceljs';
import { Client } from 'pg';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { R2Service } from '../src/common/r2/r2.service';
import { TestDb } from './db-test-helper';

// Migration 0083: política RESTRICTIVE que esconde cadastro_funcionarios de técnico/parceiro (e de papel vazio).
const UPLOAD_RATE_LIMIT_KEY = 'ratelimit:EmployeesController.uploadDocument:::ffff:127.0.0.1';
const CAD = 'cadastro_funcionarios';

describe('documents: cadastro_funcionarios escondido de técnico/parceiro (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let appClient: Client; // montese_app (sujeito a RLS)
  let tokenA: string;
  let tokenB: string;
  let tokenAdmin: string;
  let tecToken: string;
  let parToken: string;
  let tenantAId: string;
  let tenantBId: string;
  let userAId: string;
  let uploadedCadId: string;
  let laudoId: string;
  let cadExpiringId: string;
  let laudoExpiringId: string;
  const extraIds: Record<string, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (email: string, password: string) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token as string;
  const sql = (text: string, params: unknown[] = []) => (db as any).client.query(text, params);
  const insertDoc = async (tenant: string, category: string, title: string, expires: string | null = null) =>
    (
      await sql(
        `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, expires_at, uploaded_by_user_id, uploaded_by_role)
         VALUES ($1, $2, $3, $4, 'x.bin', 'application/octet-stream', 1, $5, $6, 'empresa') RETURNING id`,
        [tenant, category, title, `k/${category}/${title}`, expires, userAId],
      )
    ).rows[0].id as string;
  const list = async (token: string, tenant: string) => {
    const res = await request(app.getHttpServer()).get('/documents').query({ tenant_id: tenant }).set(auth(token));
    expect(res.status).toBe(200);
    return (res.body as { id: string }[]).map((d) => d.id);
  };
  const asRole = async <T>(role: string, tenant: string, fn: () => Promise<T>): Promise<T> => {
    await appClient.query('BEGIN');
    try {
      await appClient.query(`SELECT set_config('app.role', $1, true), set_config('app.tenant_id', $2, true), set_config('app.user_id', '', true)`, [role, tenant]);
      return await fn();
    } finally {
      await appClient.query('ROLLBACK');
    }
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2Service)
      .useValue({
        putObject: jest.fn(),
        deleteObject: jest.fn(),
        getObject: jest.fn(),
        getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://r2.invalid/x'),
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    appClient = new Client({ connectionString: process.env.DATABASE_URL });
    await appClient.connect();
    redis = new Redis(process.env.REDIS_URL as string);

    const a = await db.createTenantWithUser('Empresa Oculta A');
    const b = await db.createTenantWithUser('Empresa Oculta B');
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    userAId = a.userId;
    tokenA = await login(a.email, a.password);
    tokenB = await login(b.email, b.password);
    const admin = await db.createUserWithRole('admin', 'Admin Oculta');
    tokenAdmin = await login(admin.email, admin.password);

    const tec = await db.createUserWithRole('tecnico', 'Tecnico Oculta');
    const tecRow = await sql('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tec.userId]);
    await sql('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [tenantAId, tecRow.rows[0].id]);
    tecToken = await login(tec.email, tec.password);
    const par = await db.createUserWithRole('parceiro', 'Parceiro Oculta');
    const parRow = await sql(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`, [par.userId]);
    await sql('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [tenantAId, parRow.rows[0].id]);
    parToken = await login(par.email, par.password);

    // (a) upload real da planilha sintética pela empresa A
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cadastro');
    ['Funcionário', 'CPF', 'Função/Cargo'].forEach((h, i) => (ws.getRow(8).getCell(i + 1).value = h));
    ws.getRow(10).getCell(1).value = 'Fulano Sintetico Oculto';
    ws.getRow(10).getCell(2).value = '52998224725';
    ws.getRow(10).getCell(3).value = 'Soldador';
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const up = await request(app.getHttpServer())
      .post('/employees/documents')
      .set(auth(tokenA))
      .attach('file', buf, { filename: 'cadastro.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(up.status).toBe(201);

    const found = await sql(`SELECT id FROM documents WHERE tenant_id = $1 AND category = $2`, [tenantAId, CAD]);
    expect(found.rowCount).toBe(1);
    uploadedCadId = found.rows[0].id;

    laudoId = await insertDoc(tenantAId, 'laudo', 'Laudo visivel');
    for (const c of ['pgr', 'pcmso', 'ltcat', 'lip', 'treinamento', 'ficha_epi', 'cipa_ata', 'relatorio_visita']) {
      extraIds[c] = await insertDoc(tenantAId, c, `Outro ${c}`);
    }
    cadExpiringId = await insertDoc(tenantAId, CAD, 'Cadastro vencido', '2020-01-01');
    laudoExpiringId = await insertDoc(tenantAId, 'laudo', 'Laudo com validade', '2099-01-01');
  });

  afterAll(async () => {
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    redis.disconnect();
    await appClient.end();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  it('(a) empresa A e admin listam o documento cadastro_funcionarios', async () => {
    expect(await list(tokenA, tenantAId)).toContain(uploadedCadId);
    expect(await list(tokenAdmin, tenantAId)).toContain(uploadedCadId);
  });

  it.each([['tecnico'], ['parceiro']])('(b) %s vinculado: não lista o cadastro, mas vê todos os outros documentos', async (who) => {
    const ids = await list(who === 'tecnico' ? tecToken : parToken, tenantAId);
    expect(ids).not.toContain(uploadedCadId);
    expect(ids).not.toContain(cadExpiringId);
    expect(ids).toContain(laudoId);
    expect(ids).toContain(laudoExpiringId);
    // (e) nenhuma outra categoria é afetada
    for (const id of Object.values(extraIds)) expect(ids).toContain(id);
    // sem filtro de tenant (carteira) o mesmo vale
    const res = await request(app.getHttpServer()).get('/documents').set(auth(who === 'tecnico' ? tecToken : parToken));
    expect(res.status).toBe(200);
    expect((res.body as { category: string }[]).some((d) => d.category === CAD)).toBe(false);
  });

  it.each([['tecnico'], ['parceiro']])('(b) %s: download e DELETE do cadastro dão 404 idêntico ao de id inexistente', async (who) => {
    const t = who === 'tecnico' ? tecToken : parToken;
    const ghost = '00000000-0000-4000-8000-000000000000';
    const dl = await request(app.getHttpServer()).get(`/documents/${uploadedCadId}/download`).set(auth(t));
    const dlGhost = await request(app.getHttpServer()).get(`/documents/${ghost}/download`).set(auth(t));
    expect(dl.status).toBe(404);
    expect(dl.body).toEqual(dlGhost.body);
    const del = await request(app.getHttpServer()).delete(`/documents/${uploadedCadId}`).set(auth(t));
    const delGhost = await request(app.getHttpServer()).delete(`/documents/${ghost}`).set(auth(t));
    expect(del.status).toBe(404);
    expect(del.body).toEqual(delGhost.body);
    // continua existindo e a empresa ainda baixa
    expect((await sql('SELECT 1 FROM documents WHERE id = $1', [uploadedCadId])).rowCount).toBe(1);
    // controle: o laudo continua baixável pelo técnico/parceiro
    const ok = await request(app.getHttpServer()).get(`/documents/${laudoId}/download`).set(auth(t));
    expect(ok.status).toBe(200);
  });

  it('(a) empresa A baixa o cadastro (200)', async () => {
    const res = await request(app.getHttpServer()).get(`/documents/${uploadedCadId}/download`).set(auth(tokenA));
    expect(res.status).toBe(200);
  });

  it.each([['tecnico'], ['parceiro']])('(b) %s: compliance e portfolio não listam nem contam o cadastro', async (who) => {
    const t = who === 'tecnico' ? tecToken : parToken;
    const comp = await request(app.getHttpServer()).get('/documents/compliance').query({ tenant_id: tenantAId }).set(auth(t));
    expect(comp.status).toBe(200);
    const all = [...comp.body.pendencias, ...comp.body.avisos].map((i: { id: string }) => i.id);
    expect(all).not.toContain(cadExpiringId);
    const port = await request(app.getHttpServer()).get('/documents/compliance/portfolio').set(auth(t));
    expect(port.status).toBe(200);
    const row = (port.body as any[]).find((r) => r.tenant_id === tenantAId);
    // Só o laudo com validade conta (o cadastro vencido seria 1 pendência e score 50).
    expect(row.pendencias_count).toBe(0);
    expect(row.score).toBe(100); // vazaria 50 com o cadastro vencido contado
    // controle: a empresa vê a pendência do cadastro vencido
    const compA = await request(app.getHttpServer()).get('/documents/compliance').query({ tenant_id: tenantAId }).set(auth(tokenA));
    expect(compA.body.pendencias.map((i: { id: string }) => i.id)).toContain(cadExpiringId);
  });

  it('(c) empresa B não vê nada do tenant A (nem pelo id)', async () => {
    const ids = await list(tokenB, tenantAId);
    expect(ids).toEqual([]);
    const dl = await request(app.getHttpServer()).get(`/documents/${uploadedCadId}/download`).set(auth(tokenB));
    expect(dl.status).toBe(404);
  });

  it('(d) CHECK de status aceita expirado e recusa valor inventado', async () => {
    const def = (
      await sql(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'employee_document_extractions'::regclass AND contype = 'c'`)
    ).rows.map((r: { d: string }) => r.d);
    expect(def).toHaveLength(1);
    for (const s of ['processando', 'aplicado', 'requer_revisao', 'sem_dados', 'ilegivel', 'erro', 'expirado']) expect(def[0]).toContain(`'${s}'`);
    await sql('BEGIN');
    try {
      await sql(`INSERT INTO employee_document_extractions (tenant_id, document_id, content_hash, status) VALUES ($1, $2, 'h-exp', 'expirado')`, [tenantAId, laudoId]);
      await sql('SAVEPOINT s');
      await expect(
        sql(`INSERT INTO employee_document_extractions (tenant_id, document_id, content_hash, status) VALUES ($1, $2, 'h-inv', 'inventado')`, [tenantAId, laudoId]),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await sql('ROLLBACK');
    }
  });

  it('(d2) 0084 é idempotente: reexecutar não duplica nem perde a CHECK', async () => {
    const m = readFileSync(join(__dirname, '..', 'db', 'migrations', '0084_employee_extraction_expired_status.sql'), 'utf8');
    await sql('BEGIN');
    try {
      await sql(m);
      await sql(m);
      const r = await sql(`SELECT conname, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'employee_document_extractions'::regclass AND contype = 'c'`);
      expect(r.rowCount).toBe(1);
      expect(r.rows[0].d).toContain("'expirado'");
    } finally {
      await sql('ROLLBACK');
    }
  });

  it('(f) a política é RESTRICTIVE e documents_isolation segue permissiva e inalterada (mesma definição da 0011)', async () => {
    const pol = await sql(
      `SELECT policyname, permissive, cmd, pg_get_expr(pc.polqual, pc.polrelid) AS qual
         FROM pg_policies p JOIN pg_policy pc ON pc.polname = p.policyname AND pc.polrelid = 'documents'::regclass
        WHERE p.tablename = 'documents' ORDER BY policyname`,
    );
    const byName = Object.fromEntries(pol.rows.map((r: any) => [r.policyname, r]));
    expect(byName.documents_hide_employee_registry.permissive).toBe('RESTRICTIVE');
    expect(byName.documents_hide_employee_registry.cmd).toBe('ALL');
    expect(byName.documents_isolation.permissive).toBe('PERMISSIVE');
    // documents_isolation: tem os ramos da 0011 (admin, tenant, técnico, parceiro) e nada da categoria.
    const q = byName.documents_isolation.qual as string;
    for (const part of ["'admin'", 'tenant_technicians', 'tenant_partners', "'tecnico'", "'parceiro'"]) expect(q).toContain(part);
    expect(q).not.toContain('cadastro_funcionarios');
    // a 0083 não contém ALTER POLICY nem DROP em documents_isolation
    const m = readFileSync(join(__dirname, '..', 'db', 'migrations', '0083_documents_hide_employee_registry.sql'), 'utf8');
    expect(m).not.toMatch(/(ALTER|DROP)\s+POLICY\s+(IF EXISTS\s+)?documents_isolation/i);
    // WITH CHECK também foi gravado
    expect((await sql(`SELECT polwithcheck IS NOT NULL AS wc FROM pg_policy WHERE polname = 'documents_hide_employee_registry'`)).rows[0].wc).toBe(true);
  });

  it('(f2) papéis na role da aplicação: empresa/admin veem; técnico, parceiro e papel vazio não veem; outras categorias seguem visíveis', async () => {
    const cnt = (cat: string) => async () =>
      Number((await appClient.query(`SELECT count(*) AS n FROM documents WHERE tenant_id = $1 AND category = $2`, [tenantAId, cat])).rows[0].n);
    expect((await appClient.query('SELECT current_user AS u')).rows[0].u).toBe('montese_app');
    expect(await asRole('empresa', tenantAId, cnt(CAD))).toBeGreaterThanOrEqual(2);
    expect(await asRole('admin', '', cnt(CAD))).toBeGreaterThanOrEqual(2);
    expect(await asRole('', tenantAId, cnt(CAD))).toBe(0);
    expect(await asRole('desconhecido', tenantAId, cnt(CAD))).toBe(0);
    // papel vazio ainda enxerga as demais categorias do tenant do contexto (só a categoria sensível some)
    expect(await asRole('', tenantAId, cnt('laudo'))).toBeGreaterThanOrEqual(2);
    // WITH CHECK: papel vazio não consegue inserir a categoria
    await asRole('', tenantAId, async () => {
      await expect(
        appClient.query(
          `INSERT INTO documents (tenant_id, category, title, file_key, file_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_role)
           VALUES ($1, $2, 't', 'k/wc', 'wc.xlsx', 'x', 1, $3, 'empresa')`,
          [tenantAId, CAD, userAId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
