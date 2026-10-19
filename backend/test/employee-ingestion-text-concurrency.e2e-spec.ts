import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { R2Service } from '../src/common/r2/r2.service';
import { EMPLOYEE_EXTRACTION_PROVIDER } from '../src/employees/employee-extraction-provider.interface';
import { TestDb } from './db-test-helper';
import { Cpf, DOCX_MIME, PDF_MIME, docxFrom, dtable, makeCpf, pdfFromLines } from './employee-docgen';

// Multi-tenant e concorrência do caminho de PDF/DOCX (Fatia 4, Task 7). Não repete os testes de DoS/semáforo/teto atômico
// já existentes em employee-ingestion-text.e2e-spec.ts. Provedor de IA FALSO; R2 mockado; dados sintéticos.
const UPLOAD_RATE_LIMIT_KEY = 'ratelimit:EmployeesController.uploadDocument:::ffff:127.0.0.1';
jest.setTimeout(120_000);

describe('Ingestão de PDF/DOCX: multi-tenant e concorrência (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let tokenA: string;
  let tokenB: string;
  let tecnicoToken: string;
  let parceiroToken: string;
  let tenantAId: string;
  let tenantBId: string;
  const provider = { extract: jest.fn() };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (email: string, password: string) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token as string;
  const sql = (text: string, params: unknown[] = []) => (db as any).client.query(text, params);
  const ENV_KEYS = ['EMPLOYEE_INGESTION_AI_ENABLED', 'EMPLOYEE_INGESTION_AI_DAILY_LIMIT'];
  const aiOn = (limit = '1000') => { process.env.EMPLOYEE_INGESTION_AI_ENABLED = 'true'; process.env.EMPLOYEE_INGESTION_AI_DAILY_LIMIT = limit; };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2Service).useValue({ putObject: jest.fn(), deleteObject: jest.fn(), getObject: jest.fn() })
      .overrideProvider(EMPLOYEE_EXTRACTION_PROVIDER).useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    const a = await db.createTenantWithUser('Empresa Conc A');
    const b = await db.createTenantWithUser('Empresa Conc B');
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    tokenA = await login(a.email, a.password);
    tokenB = await login(b.email, b.password);
    tecnicoToken = await login(...(await db.createUserWithRole('tecnico', 'Tec Conc').then((u) => [u.email, u.password] as [string, string])));
    parceiroToken = await login(...(await db.createUserWithRole('parceiro', 'Parc Conc').then((u) => [u.email, u.password] as [string, string])));
    redis = new Redis(process.env.REDIS_URL as string);
  });
  beforeEach(async () => {
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    provider.extract.mockReset();
    provider.extract.mockImplementation(async () => { throw new Error('provedor não deveria ser chamado neste teste'); });
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterAll(async () => {
    for (const k of ENV_KEYS) delete process.env[k];
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    redis.disconnect();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  // ---- Fixtures ----
  let seq = 20000;

  // Resposta realista da IA: o cargo escrito logo depois do marcador (verificável no trecho). ai_used só é true se algo foi verificado.
  const okReply = async (t: string) =>
    [...new Set([...t.matchAll(/\[(CPF_\d+)\]/g)].map((m) => m[1]))].map((ref) => {
      const line = t.split('\n').find((l) => l.includes(`[${ref}]`)) as string;
      const pos = new RegExp(`\\[${ref}\\]\\s+(.+?)\\s+Admiss`).exec(line)?.[1] ?? 'SOLDADOR';
      return { cpf_ref: ref, evidence: line, position: pos };
    });
  const pessoa = (tag: string, pos = 'SOLDADOR') => {
    const n = seq++;
    const L = (x: number) => String.fromCharCode(65 + (x % 26));
    return { name: `${tag}${L(n)}${L(n / 26)}${L(n / 676)} FICTICIO`, cpf: makeCpf(n) as Cpf, pos, adm: `${String(1 + (n % 28)).padStart(2, '0')}/0${1 + (n % 9)}/2020` };
  };
  type Pe = ReturnType<typeof pessoa>;
  const ficha = (ps: Pe[]) => ps.flatMap((p) => [`Nome: ${p.name}`, `CPF: ${p.cpf.fmt}`, `Função: ${p.pos}`, `Admissão: ${p.adm}`]);
  const lista = (ps: Pe[]) => ['Lista de funcionarios FICTICIA', ...ps.map((p) => `${p.name} ${p.cpf.fmt} ${p.pos} Admissão | ${p.adm}`)];
  const send = (token: string, buf: Buffer, mime = PDF_MIME, name = 'cadastro.pdf') =>
    request(app.getHttpServer()).post('/employees/documents').set(auth(token)).attach('file', buf, { filename: name, contentType: mime });
  const createEmp = async (token: string, body: Record<string, unknown>) => {
    const res = await request(app.getHttpServer()).post('/employees').set(auth(token)).send(body);
    expect(res.status).toBe(201);
    return res.body as { id: string };
  };
  const exRow = async (id: string) => (await sql('SELECT status, tenant_id, candidates FROM employee_document_extractions WHERE id = $1', [id])).rows[0];
  const empRow = async (id: string) => (await sql(`SELECT position, to_char(admission_date,'YYYY-MM-DD') AS admission_date, full_name FROM employees WHERE id = $1`, [id])).rows[0];
  const resolve = (token: string, id: string, decisions: unknown) =>
    request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth(token)).send({ decisions });
  const getOne = (token: string, id: string) => request(app.getHttpServer()).get(`/employees/extractions/${id}`).set(auth(token));
  const listPending = (token: string) => request(app.getHttpServer()).get('/employees/extractions?status=requer_revisao').set(auth(token));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------------------------------------
  it('1) tenant B nunca vê nem resolve extração de A (PDF e DOCX; sugestão e conflito); A não é alterada', async () => {
    const mk = async (kind: 'pdf' | 'docx') => {
      const sug = pessoa('SUGE'); const con = pessoa('CONF'); const novo = pessoa('NOVO');
      const eSug = await createEmp(tokenA, { full_name: sug.name, cpf: sug.cpf.raw });
      const eCon = await createEmp(tokenA, { full_name: con.name, cpf: con.cpf.raw, position: 'GERENTE' });
      const buf = kind === 'pdf'
        ? await pdfFromLines(ficha([sug, con, novo]))
        : await docxFrom([dtable([['Nome', 'CPF', 'Função', 'Admissão'], ...[sug, con, novo].map((p) => [p.name, p.cpf.fmt, p.pos, p.adm])])]);
      const up = await send(tokenA, buf, kind === 'pdf' ? PDF_MIME : DOCX_MIME, `iso.${kind}`);
      expect(up.status).toBe(201);
      expect(up.body.items.map((i: any) => i.kind).sort()).toEqual(['conflito', 'novo', 'sugestao']);
      return { up, eSug, eCon, sug, con, novo };
    };
    for (const kind of ['pdf', 'docx'] as const) {
      const { up, eSug, eCon, sug, con, novo } = await mk(kind);
      const id = up.body.id as string;
      // B: nada de A aparece (detalhe 404, lista sem o id, resolve 404 com decisões corretas e com decisões inventadas).
      expect((await getOne(tokenB, id)).status).toBe(404);
      const lb = await listPending(tokenB);
      expect(lb.status).toBe(200);
      expect(JSON.stringify(lb.body)).not.toContain(id);
      expect(JSON.stringify(lb.body)).not.toContain(sug.name);
      const right = up.body.items.map((i: any) => ({ line: i.line, action: 'aplicar', ...(i.kind === 'novo' ? {} : { fields: (i.conflicts ?? i.suggestions).map((f: any) => f.field).concat(i.suggestions && i.conflicts ? i.suggestions.map((f: any) => f.field) : []).filter((v: string, k: number, arr: string[]) => arr.indexOf(v) === k) }) }));
      expect((await resolve(tokenB, id, right)).status).toBe(404);
      expect((await resolve(tokenB, id, [{ line: 1, action: 'aplicar' }])).status).toBe(404);
      expect((await resolve(tokenB, id, [])).status).toBe(404);
      // Nada mudou em A.
      expect((await exRow(id)).status).toBe('requer_revisao');
      expect((await empRow(eSug.id)).position).toBeNull();
      expect((await empRow(eCon.id)).position).toBe('GERENTE');
      expect((await sql('SELECT count(*) AS n FROM employees WHERE tenant_id = $1 AND cpf = $2', [tenantAId, novo.cpf.raw])).rows[0].n).toBe('0');
      expect((await sql('SELECT count(*) AS n FROM employees WHERE tenant_id = $1 AND cpf = $2', [tenantBId, novo.cpf.raw])).rows[0].n).toBe('0');
      // B tem funcionário com o MESMO CPF: continua sem efeito sobre a extração de A (o vínculo é por tenant).
      const bEmp = await createEmp(tokenB, { full_name: 'DOUTRA EMPRESA FICTICIO', cpf: con.cpf.raw, position: 'DIRETOR' });
      expect((await resolve(tokenB, id, right)).status).toBe(404);
      expect((await empRow(bEmp.id)).position).toBe('DIRETOR');
      expect((await empRow(eCon.id)).position).toBe('GERENTE');
      // A resolve normalmente e só os seus dados mudam.
      const ok = await resolve(tokenA, id, right);
      expect(ok.status).toBe(200);
      expect((await empRow(eSug.id)).position).toBe('SOLDADOR');
      expect((await empRow(eCon.id)).position).toBe('SOLDADOR');
      expect((await empRow(bEmp.id)).position).toBe('DIRETOR');
      expect((await exRow(id)).tenant_id).toBe(tenantAId);
    }
  });

  it('2) técnico e parceiro: 403 nas 4 rotas; sem token: 401; o provedor nunca é chamado', async () => {
    aiOn();
    provider.extract.mockImplementation(okReply);
    const p = pessoa('ROLE');
    const up = await send(tokenA, await pdfFromLines(ficha([p])));
    expect(up.status).toBe(201);
    const id = up.body.id as string;
    const callsBefore = provider.extract.mock.calls.length; // a empresa legítima pode chamar a IA (faltam campos); os demais não
    const buf = await pdfFromLines(ficha([pessoa('ROLE')]));
    const docs0 = Number((await sql('SELECT count(*) AS n FROM documents WHERE tenant_id = $1', [tenantAId])).rows[0].n);
    for (const t of [tecnicoToken, parceiroToken]) {
      expect((await send(t, buf)).status).toBe(403);
      expect((await listPending(t)).status).toBe(403);
      expect((await getOne(t, id)).status).toBe(403);
      expect((await resolve(t, id, [{ line: 1, action: 'ignorar' }])).status).toBe(403);
      // com tenant_id na query (caminho que o técnico usa em outras rotas): continua 403
      expect((await request(app.getHttpServer()).get(`/employees/extractions?tenant_id=${tenantAId}`).set(auth(t))).status).toBe(403);
    }
    expect((await request(app.getHttpServer()).post('/employees/documents').attach('file', buf, { filename: 'a.pdf', contentType: PDF_MIME })).status).toBe(401);
    expect((await request(app.getHttpServer()).get(`/employees/extractions/${id}`)).status).toBe(401);
    expect(Number((await sql('SELECT count(*) AS n FROM documents WHERE tenant_id = $1', [tenantAId])).rows[0].n)).toBe(docs0);
    expect((await exRow(id)).status).toBe('requer_revisao');
    expect(provider.extract.mock.calls.length).toBe(callsBefore); // nenhuma tentativa de papel indevido chegou ao provedor
  });

  it('3) duas empresas enviando o MESMO PDF ao mesmo tempo: extrações independentes; resolver uma não toca a outra', async () => {
    const p = pessoa('GEMEO');
    const buf = await pdfFromLines(ficha([p, pessoa('GEMEO')]));
    const eA = await createEmp(tokenA, { full_name: p.name, cpf: p.cpf.raw });
    const eB = await createEmp(tokenB, { full_name: p.name, cpf: p.cpf.raw });
    const [ra, rb] = await Promise.all([send(tokenA, buf), send(tokenB, buf)]);
    expect([ra.status, rb.status]).toEqual([201, 201]);
    expect(ra.body.reused).toBeUndefined();
    expect(rb.body.reused).toBeUndefined();
    expect(ra.body.id).not.toBe(rb.body.id);
    expect(ra.body.tenant_id).toBe(tenantAId);
    expect(rb.body.tenant_id).toBe(tenantBId);
    expect(ra.body.document_id).not.toBe(rb.body.document_id);
    expect((await listPending(tokenA)).body.items.map((i: any) => i.id)).toContain(ra.body.id);
    expect((await listPending(tokenA)).body.items.map((i: any) => i.id)).not.toContain(rb.body.id);
    expect((await listPending(tokenB)).body.items.map((i: any) => i.id)).not.toContain(ra.body.id);
    // Resolve A aplicando; B segue pendente e o funcionário de B intacto.
    const itemA = ra.body.items.find((i: any) => i.kind === 'sugestao');
    const novoA = ra.body.items.find((i: any) => i.kind === 'novo');
    const ok = await resolve(tokenA, ra.body.id, [{ line: itemA.line, action: 'aplicar', fields: itemA.suggestions.map((s: any) => s.field) }, { line: novoA.line, action: 'ignorar' }]);
    expect(ok.status).toBe(200);
    expect((await empRow(eA.id)).position).toBe('SOLDADOR');
    expect((await empRow(eB.id)).position).toBeNull();
    expect((await exRow(rb.body.id)).status).toBe('requer_revisao');
    expect((await getOne(tokenB, rb.body.id)).body.items.length).toBe(2);
    // B reenviando depois do resolve de A: reaproveita a SUA, nunca a de A.
    const again = await send(tokenB, buf);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ reused: true, id: rb.body.id, tenant_id: tenantBId });
  });

  it('4) seis uploads simultâneos do MESMO PDF na mesma empresa: 1 criado (201), 5 reused (200), 1 documento, 1 extração, IA chamada no máximo uma vez', async () => {
    aiOn();
    provider.extract.mockImplementation(async (t: string) => {
      await sleep(300);
      return t.split('\n').filter((l) => /\[CPF_\d+\]/.test(l)).map((l) => ({ cpf_ref: /\[(CPF_\d+)\]/.exec(l)![1], evidence: l }));
    });
    const ps = [pessoa('SEIS'), pessoa('SEIS')];
    const buf = await pdfFromLines(lista(ps));
    const docs0 = Number((await sql('SELECT count(*) AS n FROM documents WHERE tenant_id = $1', [tenantAId])).rows[0].n);
    const rs = await Promise.all(Array.from({ length: 6 }, () => send(tokenA, buf)));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);
    const created = rs.find((r) => r.status === 201)!;
    for (const r of rs.filter((x) => x.status === 200)) expect(r.body).toMatchObject({ reused: true, id: created.body.id });
    expect(Number((await sql('SELECT count(*) AS n FROM documents WHERE tenant_id = $1', [tenantAId])).rows[0].n)).toBe(docs0 + 1);
    expect(Number((await sql('SELECT count(*) AS n FROM employee_document_extractions WHERE tenant_id = $1 AND content_hash = $2', [tenantAId, (await sql('SELECT content_hash FROM employee_document_extractions WHERE id = $1', [created.body.id])).rows[0].content_hash])).rows[0].n)).toBe(1);
    expect(provider.extract.mock.calls.length).toBeLessThanOrEqual(1);
    // Os reaproveitados enquanto processava podem ter status processando; depois o estado final é um só.
    expect((await getOne(tokenA, created.body.id)).body.status).toBe('requer_revisao');
  });

  it('5) flag de IA desligada em runtime: provedor NUNCA chamado (ausente, false, vazio, TRUE, 1, " true"); ligada e desligada de novo no meio', async () => {
    const mk = async (n: number) => await pdfFromLines(lista(Array.from({ length: n }, () => pessoa('FLAG'))));
    // controle: ligada chama
    aiOn();
    provider.extract.mockImplementation(okReply);
    expect((await send(tokenA, await mk(2))).body.summary).toMatchObject({ method: 'texto+ia', ai_used: true });
    expect(provider.extract).toHaveBeenCalledTimes(1);
    provider.extract.mockClear();
    // Desliga em runtime (sem reiniciar o app): cada valor que não seja exatamente "true" mantém a IA desligada.
    for (const v of [undefined, 'false', '', 'TRUE', '1', ' true', 'yes']) {
      if (v === undefined) delete process.env.EMPLOYEE_INGESTION_AI_ENABLED; else process.env.EMPLOYEE_INGESTION_AI_ENABLED = v;
      const r = await send(tokenA, await mk(2));
      expect(r.status).toBe(201);
      expect(r.body.summary).toMatchObject({ method: 'texto', ai_used: false });
      expect(r.body.summary.ai_attempted).toBeUndefined();
      expect(r.body.summary.detail).toBeUndefined();
    }
    expect(provider.extract).not.toHaveBeenCalled();
    // Religa e desliga de novo durante um upload lento: o que já estava em voo conclui; o seguinte não chama.
    aiOn();
    provider.extract.mockImplementation(async (t: string) => { await sleep(600); return okReply(t); });
    const slow = send(tokenA, await mk(2)).then((r) => r); // supertest só dispara com then()
    const t0 = Date.now();
    while (provider.extract.mock.calls.length < 1 && Date.now() - t0 < 15000) await sleep(25);
    expect(provider.extract).toHaveBeenCalledTimes(1);
    process.env.EMPLOYEE_INGESTION_AI_ENABLED = 'false';
    const after = await send(tokenA, await mk(2));
    expect(after.body.summary.ai_used).toBe(false);
    expect((await slow).status).toBe(201);
    expect(provider.extract).toHaveBeenCalledTimes(1);
  });

  it('6) teto diário por tenant não vaza: A no limite não impede B (e B no limite não impede A)', async () => {
    const cnt = async (t: string) => Number((await sql(`SELECT count(*) AS n FROM employee_document_extractions WHERE tenant_id = $1 AND created_at > now() - interval '24 hours' AND ((summary->>'ai_used') = 'true' OR (summary->>'ai_attempted') = 'true')`, [t])).rows[0].n);
    const a0 = await cnt(tenantAId);
    const b0 = await cnt(tenantBId);
    const LIMIT = Math.max(a0, b0) + 2; // mesmo teto configurado para as duas empresas
    aiOn(String(LIMIT));
    provider.extract.mockImplementation(okReply);
    const up = async (token: string) => (await send(token, await pdfFromLines(lista([pessoa('TETO'), pessoa('TETO')])))).body.summary;
    // Leva A exatamente ao teto.
    for (let i = a0; i < LIMIT; i++) expect(await up(tokenA)).toMatchObject({ ai_used: true });
    expect(await cnt(tenantAId)).toBe(LIMIT);
    expect(await up(tokenA)).toMatchObject({ ai_used: false, detail: 'Limite diário de leituras com IA atingido; o documento foi lido sem IA.' });
    // B, com o MESMO teto, ainda tem a cota (a de A não conta para B).
    provider.extract.mockClear();
    expect(await up(tokenB)).toMatchObject({ ai_used: true });
    expect(provider.extract).toHaveBeenCalledTimes(1);
    expect(await cnt(tenantBId)).toBe(b0 + 1);
    // Leva B ao teto: A continua barrada e B passa a ser barrada, cada uma pela própria contagem.
    for (let i = b0 + 1; i < LIMIT; i++) expect(await up(tokenB)).toMatchObject({ ai_used: true });
    expect(await up(tokenB)).toMatchObject({ ai_used: false, detail: 'Limite diário de leituras com IA atingido; o documento foi lido sem IA.' });
    expect(await cnt(tenantAId)).toBe(LIMIT);
    expect(await cnt(tenantBId)).toBe(LIMIT);
    // Subir o teto só de uma vez libera as duas (o teto é configuração global, a contagem é por tenant).
    aiOn(String(LIMIT + 1));
    provider.extract.mockClear();
    expect(await up(tokenA)).toMatchObject({ ai_used: true });
    expect(await up(tokenB)).toMatchObject({ ai_used: true });
    expect(provider.extract).toHaveBeenCalledTimes(2);
  });

  it('7) extração `processando` de A não bloqueia B (mesmo PDF ou outro); A reenviando durante o processamento recebe reused/processando', async () => {
    aiOn();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let entered = 0;
    provider.extract.mockImplementation(async (t: string) => {
      entered++;
      if (entered === 1) await gate; // só a 1ª chamada (de A) fica presa
      return t.split('\n').filter((l) => /\[CPF_\d+\]/.test(l)).map((l) => ({ cpf_ref: /\[(CPF_\d+)\]/.exec(l)![1], evidence: l }));
    });
    const pa = [pessoa('SLOW'), pessoa('SLOW')];
    const bufA = await pdfFromLines(lista(pa));
    const slow = send(tokenA, bufA).then((r) => r); // supertest só dispara com then()
    const t0 = Date.now();
    while (entered < 1 && Date.now() - t0 < 15000) await sleep(25);
    expect(entered).toBe(1);
    const proc = (await sql(`SELECT id FROM employee_document_extractions WHERE tenant_id = $1 AND status = 'processando'`, [tenantAId])).rows;
    expect(proc.length).toBeGreaterThanOrEqual(1);
    // B envia OUTRO documento: conclui rápido enquanto a de A segue processando.
    const tB = Date.now();
    const rb = await send(tokenB, await pdfFromLines(lista([pessoa('RAPIDO'), pessoa('RAPIDO')])));
    expect(rb.status).toBe(201);
    expect(rb.body.status).toBe('requer_revisao');
    expect(Date.now() - tB).toBeLessThan(5000);
    // B envia o MESMO arquivo que A está processando: cria a sua (nunca recebe a de A).
    const rb2 = await send(tokenB, bufA);
    expect(rb2.status).toBe(201);
    expect(rb2.body.tenant_id).toBe(tenantBId);
    expect(rb2.body.reused).toBeUndefined();
    // A reenvia durante o processamento: reused + processando.
    const again = await send(tokenA, bufA);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ reused: true, status: 'processando', tenant_id: tenantAId });
    expect(again.body.items).toEqual([]);
    // Resolver uma extração em processamento é recusado (409) e nada muda.
    const rr = await resolve(tokenA, again.body.id, [{ line: 1, action: 'ignorar' }]);
    expect(rr.status).toBe(409);
    release();
    const done = await slow;
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('requer_revisao');
    expect(done.body.id).toBe(again.body.id);
    expect((await exRow(rb2.body.id)).tenant_id).toBe(tenantBId);
  });
});
