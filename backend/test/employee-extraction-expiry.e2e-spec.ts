import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { R2Service } from '../src/common/r2/r2.service';
import { EMPLOYEE_EXTRACTION_PROVIDER } from '../src/employees/employee-extraction-provider.interface';
import { EmployeeExtractionExpiryCronService, EXPIRED_DETAIL, ORPHAN_DETAIL } from '../src/employees/employee-extraction-expiry.cron';
import { TestDb } from './db-test-helper';
import { makeCpf, pdfFromLines } from './employee-docgen';

// TTL das revisões pendentes (privacidade): job diário que expira `requer_revisao` antigas (zera nome/CPF/trecho, mantém só
// `invalida`) e encerra `processando` órfãs. Linhas antigas são fabricadas pelo cliente superusuário do helper. Dados sintéticos.
const UPLOAD_RATE_LIMIT_KEY = 'ratelimit:EmployeesController.uploadDocument:::ffff:127.0.0.1';
jest.setTimeout(120_000);

describe('Expiração de extrações de cadastro (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let cron: EmployeeExtractionExpiryCronService;
  let tokenA: string;
  let tokenB: string;
  let tenantAId: string;
  let tenantBId: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const sql = (text: string, params: unknown[] = []) => (db as any).client.query(text, params);
  const saved = process.env.EMPLOYEE_EXTRACTION_TTL_DAYS;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2Service).useValue({ putObject: jest.fn(), deleteObject: jest.fn(), getObject: jest.fn() })
      .overrideProvider(EMPLOYEE_EXTRACTION_PROVIDER).useValue({ extract: jest.fn() })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    const a = await db.createTenantWithUser('Empresa Expira A');
    const b = await db.createTenantWithUser('Empresa Expira B');
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    const login = async (e: string, p: string) => (await request(app.getHttpServer()).post('/auth/login').send({ email: e, password: p })).body.access_token as string;
    tokenA = await login(a.email, a.password);
    tokenB = await login(b.email, b.password);
    redis = new Redis(process.env.REDIS_URL as string);
    cron = app.get(EmployeeExtractionExpiryCronService);
  });
  beforeEach(async () => { await redis.del(UPLOAD_RATE_LIMIT_KEY); delete process.env.EMPLOYEE_EXTRACTION_TTL_DAYS; });
  afterAll(async () => {
    if (saved === undefined) delete process.env.EMPLOYEE_EXTRACTION_TTL_DAYS; else process.env.EMPLOYEE_EXTRACTION_TTL_DAYS = saved;
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    redis.disconnect();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  let seq = 0;
  const upload = async (token: string, name: string) => {
    const c = makeCpf(7000 + seq++);
    const cpf = c.raw;
    const pdf = await pdfFromLines([`Nome: ${name}`, `CPF: ${c.fmt}`, 'Função: SOLDADOR']);
    const res = await request(app.getHttpServer()).post('/employees/documents').set(auth(token)).attach('file', pdf, { filename: `${name}.pdf`, contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('requer_revisao');
    return { id: res.body.id as string, cpf, item: res.body.items[0] };
  };
  const row = async (id: string) => (await sql('SELECT status, summary, candidates, candidates::text AS ctext, created_at FROM employee_document_extractions WHERE id = $1', [id])).rows[0];
  const age = (id: string, interval: string) => sql(`UPDATE employee_document_extractions SET created_at = now() - $2::interval WHERE id = $1`, [id, interval]);
  const counts = async () => ({
    docs: (await sql('SELECT count(*) AS n FROM documents')).rows[0].n,
    emps: (await sql('SELECT count(*) AS n FROM employees')).rows[0].n,
    hist: (await sql('SELECT count(*) AS n FROM employee_field_history')).rows[0].n,
    users: (await sql('SELECT count(*) AS n FROM users')).rows[0].n,
  });

  it('expira revisões antigas (candidatos sem nome/CPF, só invalida), preserva as recentes, encerra processando órfã e é idempotente', async () => {
    const old = await upload(tokenA, 'ANTIGA FICTICIA');
    const recent = await upload(tokenA, 'RECENTE FICTICIA');
    const other = await upload(tokenB, 'OUTRA FICTICIA');
    // a antiga também tem um item `invalida` (linha + motivo), que sobrevive
    const cand = (await row(old.id)).candidates as any[];
    await sql('UPDATE employee_document_extractions SET candidates = $2::jsonb WHERE id = $1', [old.id, JSON.stringify([...cand, { line: 99, kind: 'invalida', reason: 'Dados inválidos ou ausentes' }])]);
    await age(old.id, '31 days');
    await age(other.id, '45 days');
    // processando: uma velha (órfã) e uma recente
    const docId = (await sql('SELECT document_id FROM employee_document_extractions WHERE id = $1', [old.id])).rows[0].document_id;
    const orphan = (await sql(`INSERT INTO employee_document_extractions (tenant_id, document_id, content_hash, status, created_at) VALUES ($1,$2,'orf-1','processando', now() - interval '2 hours') RETURNING id`, [tenantAId, docId])).rows[0].id;
    const fresh = (await sql(`INSERT INTO employee_document_extractions (tenant_id, document_id, content_hash, status) VALUES ($1,$2,'orf-2','processando') RETURNING id`, [tenantAId, docId])).rows[0].id;
    // aplicado antigo: não é tocado
    const applied = (await sql(`INSERT INTO employee_document_extractions (tenant_id, document_id, content_hash, status, created_at) VALUES ($1,$2,'apl-1','aplicado', now() - interval '90 days') RETURNING id`, [tenantAId, docId])).rows[0].id;

    const before = await counts();
    const r1 = await cron.run();
    expect(r1.expired).toBeGreaterThanOrEqual(2); // a de A e a de B (outros specs podem ter linhas antigas)
    expect(r1.orphaned).toBeGreaterThanOrEqual(1);

    const o = await row(old.id);
    expect(o.status).toBe('expirado');
    expect(o.candidates).toEqual([{ line: 99, kind: 'invalida', reason: 'Dados inválidos ou ausentes' }]);
    for (const s of ['ANTIGA', old.cpf, 'SOLDADOR', 'Nome:']) expect(o.ctext).not.toContain(s);
    expect(o.summary).toMatchObject({ detail: EXPIRED_DETAIL });
    expect(new Date(o.summary.expired_at).toString()).not.toBe('Invalid Date');
    expect((await row(other.id)).status).toBe('expirado'); // tenant B também (job de sistema)
    expect((await row(recent.id)).status).toBe('requer_revisao');
    expect(((await row(recent.id)).candidates as any[]).length).toBeGreaterThan(0);
    const orf = await row(orphan);
    expect(orf.status).toBe('erro');
    expect(orf.summary).toMatchObject({ detail: ORPHAN_DETAIL });
    expect((await row(fresh)).status).toBe('processando');
    expect((await row(applied)).status).toBe('aplicado');
    expect(await counts()).toEqual(before); // nenhuma outra tabela foi tocada

    // idempotente: nada mais para expirar das mesmas linhas
    const snap = JSON.stringify([await row(old.id), await row(recent.id), await row(orphan)]);
    await cron.run();
    expect(JSON.stringify([await row(old.id), await row(recent.id), await row(orphan)])).toBe(snap);

    // API: GET lista só requer_revisao (expirado fora); GET por id mostra o estado; resolve => 409 estático
    const list = await request(app.getHttpServer()).get('/employees/extractions?status=requer_revisao').set(auth(tokenA));
    expect(list.status).toBe(200);
    const ids = list.body.items.map((i: any) => i.id);
    expect(ids).toContain(recent.id);
    expect(ids).not.toContain(old.id);
    const get = await request(app.getHttpServer()).get(`/employees/extractions/${old.id}`).set(auth(tokenA));
    expect(get.body.status).toBe('expirado');
    expect(get.body.items).toEqual([{ line: 99, kind: 'invalida', reason: 'Dados inválidos ou ausentes' }]);
    expect(get.body.summary.detail).toBe(EXPIRED_DETAIL);
    const res = await request(app.getHttpServer()).post(`/employees/extractions/${old.id}/resolve`).set(auth(tokenA)).send({ decisions: [] });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Esta revisão expirou. Reenvie o documento.');
    // isolamento: B não resolve a de A (404), e o reenvio do mesmo arquivo cria extração nova
    expect((await request(app.getHttpServer()).post(`/employees/extractions/${old.id}/resolve`).set(auth(tokenB)).send({ decisions: [] })).status).toBe(404);
  });

  it('TTL por env: 1 dia expira uma linha de 2 dias e mantém a de 2 horas; limites (mín. 1, máx. 365)', async () => {
    const twoDays = await upload(tokenA, 'DOISDIAS FICTICIA');
    const twoHours = await upload(tokenA, 'DUASHORAS FICTICIA');
    await age(twoDays.id, '2 days');
    await age(twoHours.id, '2 hours');
    process.env.EMPLOYEE_EXTRACTION_TTL_DAYS = '0'; // abaixo do mínimo => 1
    expect(EmployeeExtractionExpiryCronService.ttlDays()).toBe(1);
    process.env.EMPLOYEE_EXTRACTION_TTL_DAYS = '9999';
    expect(EmployeeExtractionExpiryCronService.ttlDays()).toBe(365);
    process.env.EMPLOYEE_EXTRACTION_TTL_DAYS = '1';
    await cron.run();
    expect((await row(twoDays.id)).status).toBe('expirado');
    expect((await row(twoHours.id)).status).toBe('requer_revisao');
    delete process.env.EMPLOYEE_EXTRACTION_TTL_DAYS; // padrão 30
    expect(EmployeeExtractionExpiryCronService.ttlDays()).toBe(30);
  });

  it('o job nunca derruba o processo: erro de banco vira log estático e retorno zerado', async () => {
    const db2 = (cron as any).db;
    const spy = jest.spyOn(db2, 'withTenantContext').mockRejectedValueOnce(Object.assign(new Error('falha com 52998224725 NOME FICTICIO'), { code: 'XX000' }));
    const out: string[] = [];
    const w = jest.spyOn(process.stdout, 'write').mockImplementation(((c: string) => { out.push(String(c)); return true; }) as never);
    const w2 = jest.spyOn(process.stderr, 'write').mockImplementation(((c: string) => { out.push(String(c)); return true; }) as never);
    try {
      expect(await cron.run()).toEqual({ expired: 0, orphaned: 0 });
    } finally {
      w.mockRestore();
      w2.mockRestore();
      spy.mockRestore();
    }
    const log = out.join('');
    expect(log).not.toContain('52998224725');
    expect(log).not.toContain('NOME FICTICIO');
  });
});
