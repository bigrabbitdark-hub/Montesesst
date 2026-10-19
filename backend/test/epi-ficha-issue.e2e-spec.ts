import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { EpiFichaService } from '../src/epi-ficha/epi-ficha.service';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { R2Service } from '../src/common/r2/r2.service';
import { extractPdfTextFull } from '../src/common/pdf/pdf-text.util';
import { canonicalJson, sha256Hex } from '../src/epi-ficha/canonical-json.util';
import { TestDb } from './db-test-helper';

// R2 sempre simulado em memória: nenhum arquivo de teste chega a um bucket real.
const fakeR2 = {
  store: new Map<string, Buffer>(),
  failNextPut: false,
  hangNextPut: false,
  hangDelete: false,
  hangGet: false,
  failGet: false,
  async putObject(k: string, b: Buffer) {
    if (this.hangNextPut) {
      this.hangNextPut = false;
      return new Promise<void>(() => undefined); // nunca resolve (simula R2 pendurado)
    }
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error('R2 indisponível (teste)');
    }
    this.store.set(k, b);
  },
  async getObject(k: string) {
    if (this.hangGet) return new Promise<Buffer>(() => undefined); // nunca resolve
    if (this.failGet) throw new Error('falha genérica do R2 (teste)');
    const v = this.store.get(k);
    if (!v) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return v;
  },
  async deleteObject(k: string) {
    if (this.hangDelete) return new Promise<void>(() => undefined); // nunca resolve
    this.store.delete(k);
  },
  async getPresignedDownloadUrl() {
    return 'x';
  },
};

const binaryParser = (res: any, cb: (e: Error | null, b: Buffer) => void) => {
  const c: Buffer[] = [];
  res.on('data', (d: Buffer) => c.push(d));
  res.on('end', () => cb(null, Buffer.concat(c)));
};
const extractPdfText = async (b: Buffer) => (await extractPdfTextFull(b)) ?? '';

// beforeAll com bcrypt/tenants estoura os 5 s padrão sob carga do host.
jest.setTimeout(120_000);

describe('POST /epi-fichas/employees/:employeeId/issue e documentos (e2e)', () => {
  let app: INestApplication;
  let srv: any;
  let db: TestDb;
  let sql: Client;
  let token: string;
  let tokenB: string;
  let tenantId: string;
  let emp: string;
  let emp2: string;
  let emp3: string;
  let freshEmployeeId: string;
  let otherEmp: string;
  let epiId: string;
  const otherTenantRandomUuid = randomUUID();

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const authB = () => ({ Authorization: `Bearer ${tokenB}` });
  let seq = 0;
  const key = () => `teste-emissao-${Date.now()}-${seq++}`;
  const issue = (employee: string, body: Record<string, unknown>) =>
    request(srv).post(`/epi-fichas/employees/${employee}/issue`).set(auth()).send(body);
  const download = (id: string, h: Record<string, string> = auth()) =>
    request(srv).get(`/epi-fichas/documents/${id}/download`).set(h).buffer(true).parse(binaryParser as any);
  const newEmployee = async (name: string, cpf: string) =>
    (await sql.query(`INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, $2, $3, 'ativo') RETURNING id`, [tenantId, name, cpf]))
      .rows[0].id as string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(R2Service).useValue(fakeR2).compile();
    app = moduleRef.createNestApplication();
    configureApp(app); // espelha a produção (ValidationPipe global)
    await app.init();
    srv = app.getHttpServer();
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();

    const t = await db.createTenantWithUser('Empresa Epi Emissao');
    tenantId = t.tenantId;
    emp = t.employeeId;
    token = (await request(srv).post('/auth/login').send({ email: t.email, password: t.password })).body.access_token;
    const b = await db.createTenantWithUser('Empresa Epi Emissao B');
    otherEmp = b.employeeId;
    tokenB = (await request(srv).post('/auth/login').send({ email: b.email, password: b.password })).body.access_token;

    emp2 = await newEmployee('Funcionário Emissão Dois', '39053344705');
    emp3 = await newEmployee('Funcionário Emissão Três', '11144477735');
    freshEmployeeId = await newEmployee('Funcionário Emissão Novo', '52998224725');

    const cat = (await request(srv).get('/epi-catalog-items').set(auth())).body;
    epiId = (await request(srv).post('/epis').set(auth()).send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-EMIT-1', manufacturer: 'Fab', model: 'M1' })).body.id;
    const mov = (body: Record<string, unknown>) => request(srv).post(`/epis/${epiId}/movements`).set(auth()).send(body);
    expect((await mov({ type: 'abertura', quantity: 100, idempotency_key: key() })).status).toBe(201);
    expect((await mov({ type: 'entrega', quantity: 2, employee_id: emp, idempotency_key: key() })).status).toBe(201);
  });

  afterAll(async () => {
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  it('emite a versão 1, grava o arquivo no R2 e o registro; o hash confere', async () => {
    const r = await issue(emp, { idempotency_key: key() });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ version: 1 });
    expect(r.body.document_code).toMatch(/^FEPI-\d{8}-[0-9A-F]{8}$/);
    expect(r.body.tenant_id).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/file_key|"snapshot"|idempotency/);
    const row = (await sql.query('SELECT * FROM epi_ficha_documents WHERE id = $1', [r.body.id])).rows[0];
    expect(row.tenant_id).toBe(tenantId); // tenant vem da linha do funcionário
    const stored = fakeR2.store.get(row.file_key)!;
    expect(sha256Hex(stored)).toBe(row.file_sha256);
    expect(stored.subarray(0, 5).toString()).toBe('%PDF-');
    expect(JSON.stringify(row.snapshot)).not.toMatch(/\b\d{11}\b/); // sem CPF no instantâneo
    expect(row.snapshot.employee.cpf_masked).toMatch(/^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
    expect(JSON.stringify(row.snapshot)).not.toContain(row.file_key); // instantâneo sem file_key
    expect(row.snapshot_sha256).toBe(sha256Hex(canonicalJson(row.snapshot)));
  });

  it('emissões seguintes viram versão 2, 3...; as anteriores permanecem intactas', async () => {
    const v1 = await issue(emp, { idempotency_key: key() });
    const h1 = (await sql.query('SELECT file_sha256 FROM epi_ficha_documents WHERE id = $1', [v1.body.id])).rows[0].file_sha256;
    const v2 = await issue(emp, { idempotency_key: key() });
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(v1.body.version + 1);
    const again = (await sql.query('SELECT file_sha256 FROM epi_ficha_documents WHERE id = $1', [v1.body.id])).rows[0].file_sha256;
    expect(again).toBe(h1);
    const list = await request(srv).get(`/epi-fichas/employees/${emp}/documents`).set(auth());
    expect(list.status).toBe(200);
    expect(list.body.map((d: any) => d.version)).toEqual([...list.body.map((d: any) => d.version)].sort((a, b) => b - a));
    expect(JSON.stringify(list.body)).not.toMatch(/file_key|"snapshot"/); // lista pública não expõe chave do R2 nem o instantâneo
  });

  it('mesma idempotency_key devolve o mesmo documento (200); outros filtros ou outro funcionário -> 409', async () => {
    const k = key();
    const a = await issue(emp, { idempotency_key: k });
    const b = await issue(emp, { idempotency_key: k });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect((await issue(emp, { idempotency_key: k, from: '2020-01-01' })).status).toBe(409);
    expect((await issue(emp2, { idempotency_key: k })).status).toBe(409);
    const n = await sql.query('SELECT count(*)::int AS n FROM epi_ficha_documents WHERE idempotency_key = $1', [k]);
    expect(n.rows[0].n).toBe(1);
  });

  it('emissões concorrentes (8 em paralelo, chaves diferentes) geram versões distintas e consecutivas', async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => issue(freshEmployeeId, { idempotency_key: key() })));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(rs.map((r) => r.body.version).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('documento antigo continua íntegro e idêntico depois de mudar o cadastro do funcionário e do EPI', async () => {
    const d = await issue(emp, { idempotency_key: key() });
    const before = Buffer.from((await download(d.body.id)).body);
    await sql.query(`UPDATE employees SET full_name = 'Nome Alterado Depois', department = 'Outro Setor' WHERE id = $1`, [emp]);
    await request(srv).patch(`/epis/${epiId}`).set(auth()).send({ manufacturer: 'Fabricante Alterado' });
    const after = Buffer.from((await download(d.body.id)).body);
    expect(sha256Hex(after)).toBe(sha256Hex(before));
    expect((await request(srv).get(`/epi-fichas/documents/${d.body.id}/verify`).set(auth())).body.status).toBe('integro');
    // uma nova emissão reflete o cadastro novo, sem alterar a antiga
    const novo = await issue(emp, { idempotency_key: key() });
    const snap = (await sql.query('SELECT snapshot FROM epi_ficha_documents WHERE id = $1', [novo.body.id])).rows[0].snapshot;
    expect(snap.employee.full_name).toBe('Nome Alterado Depois');
  });

  it('verify: íntegro; arquivo adulterado no R2 -> divergente; arquivo ausente -> arquivo_ausente', async () => {
    const d = await issue(emp, { idempotency_key: key() });
    const row = (await sql.query('SELECT file_key FROM epi_ficha_documents WHERE id = $1', [d.body.id])).rows[0];
    const verify = async () => (await request(srv).get(`/epi-fichas/documents/${d.body.id}/verify`).set(auth())).body;
    expect((await verify()).status).toBe('integro');
    const orig = fakeR2.store.get(row.file_key)!;
    fakeR2.store.set(row.file_key, Buffer.concat([orig, Buffer.from('x')]));
    const bad = await verify();
    expect(bad.status).toBe('divergente');
    expect(bad.actual_sha256).not.toBe(bad.expected_sha256);
    fakeR2.store.delete(row.file_key);
    expect((await verify()).status).toBe('arquivo_ausente');
    fakeR2.store.set(row.file_key, orig); // restaura
  });

  it('falha no R2 (putObject lança) devolve 502, sem registro e sem consumir a versão; a mensagem não traz dado pessoal', async () => {
    const count = async () => (await sql.query('SELECT count(*)::int AS n FROM epi_ficha_documents WHERE employee_id = $1', [emp2])).rows[0].n;
    const before = await count();
    fakeR2.failNextPut = true;
    const r = await issue(emp2, { idempotency_key: key() });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toMatch(/Funcionário|\d{11}|R2 indisponível/);
    expect(await count()).toBe(before);
    const ok = await issue(emp2, { idempotency_key: key() });
    expect(ok.status).toBe(201);
    expect(ok.body.version).toBe(before + 1);
  });

  it('falha ao gravar o registro remove o arquivo órfão do R2', async () => {
    const filesBefore = fakeR2.store.size;
    // trigger descartável que rejeita inserts do funcionário emp3 (violação controlada no INSERT, depois do R2)
    await sql.query(`CREATE OR REPLACE FUNCTION epi_ficha_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.employee_id = '${emp3}' THEN RAISE EXCEPTION 'rejeitado pelo teste' USING ERRCODE = '23514'; END IF; RETURN NEW; END; $$`);
    await sql.query('CREATE TRIGGER trg_epi_ficha_test_reject BEFORE INSERT ON epi_ficha_documents FOR EACH ROW EXECUTE FUNCTION epi_ficha_test_reject()');
    try {
      const r = await issue(emp3, { idempotency_key: key() });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(fakeR2.store.size).toBe(filesBefore); // nenhum arquivo órfão ficou
      expect((await sql.query('SELECT count(*)::int AS n FROM epi_ficha_documents WHERE employee_id = $1', [emp3])).rows[0].n).toBe(0);
    } finally {
      await sql.query('DROP TRIGGER IF EXISTS trg_epi_ficha_test_reject ON epi_ficha_documents');
      await sql.query('DROP FUNCTION IF EXISTS epi_ficha_test_reject()');
    }
  });

  it('download devolve application/pdf com os mesmos bytes e cabeçalhos privados; outra empresa recebe 404', async () => {
    const d = await issue(emp, { idempotency_key: key() });
    const row = (await sql.query('SELECT file_key, file_sha256 FROM epi_ficha_documents WHERE id = $1', [d.body.id])).rows[0];
    const r = await download(d.body.id);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/pdf/);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(sha256Hex(Buffer.from(r.body))).toBe(row.file_sha256);
    expect((await download(d.body.id, authB())).status).toBe(404);
    expect((await request(srv).get(`/epi-fichas/documents/${d.body.id}/verify`).set(authB())).status).toBe(404);
  });

  it('download de documento cujo arquivo sumiu do R2 -> 404', async () => {
    const d = await issue(emp, { idempotency_key: key() });
    const row = (await sql.query('SELECT file_key FROM epi_ficha_documents WHERE id = $1', [d.body.id])).rows[0];
    const orig = fakeR2.store.get(row.file_key)!;
    fakeR2.store.delete(row.file_key);
    expect((await download(d.body.id)).status).toBe(404);
    fakeR2.store.set(row.file_key, orig);
  });

  it('PDF emitido sem assinatura confirmada: "Pendente", sem selo; entrega presencial aparece como Registrada presencialmente', async () => {
    const d = await issue(emp, { idempotency_key: key() });
    const file = fakeR2.store.get((await sql.query('SELECT file_key FROM epi_ficha_documents WHERE id = $1', [d.body.id])).rows[0].file_key)!;
    const text = await extractPdfText(file);
    expect(text).toContain('Pendente');
    expect(text).not.toMatch(/assinado digitalmente|ICP/i);
    expect(text).toContain(d.body.document_code);
    expect(text).toContain(`Versão ${d.body.version}`);
    expect(text).not.toMatch(/Emitido em \d{4}-\d{2}-\d{2}T/); // data legível, não ISO bruto
    // presencial real: registro + itens e só então o UPDATE (o trigger da entrega exige o registro; o COMMIT confere o conjunto)
    await sql.query('BEGIN');
    const reg = await sql.query(
      `INSERT INTO epi_in_person_signatures (tenant_id, employee_id, witness_name, reason, registered_by_user_id, term_version)
       SELECT $1, $2, 'Testemunha Teste', 'Funcionário sem celular', id, 'rascunho-1' FROM users WHERE tenant_id = $1 LIMIT 1 RETURNING id`, [tenantId, emp]);
    await sql.query('INSERT INTO epi_in_person_signature_items (in_person_id, delivery_id) SELECT $1, id FROM employee_epi_deliveries WHERE employee_id = $2', [reg.rows[0].id, emp]);
    await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'presencial', signed_at = now(), signed_by_name = 'Responsável' WHERE employee_id = $1`, [emp]);
    await sql.query('COMMIT');
    const d2 = await issue(emp, { idempotency_key: key() });
    const text2 = await extractPdfText(fakeR2.store.get((await sql.query('SELECT file_key FROM epi_ficha_documents WHERE id = $1', [d2.body.id])).rows[0].file_key)!);
    expect(text2).toContain('Registrada presencialmente');
  });

  it('entrada inválida -> 400: idempotency_key curta/longa/NUL, filtros inválidos, corpo extra, ids não UUID; funcionário inexistente -> 404', async () => {
    for (const body of [{}, { idempotency_key: 'curta' }, { idempotency_key: 'x'.repeat(101) }, { idempotency_key: 'abcdefgh\u0000' },
      { idempotency_key: key(), from: '2026-02-30' }, { idempotency_key: key(), to: 'abc' }, { idempotency_key: key(), signature_status: 'nada' }, { idempotency_key: key(), extra: 1 }]) {
      expect((await issue(emp, body)).status).toBe(400);
    }
    expect((await request(srv).post('/epi-fichas/employees/abc/issue').set(auth()).send({ idempotency_key: key() })).status).toBe(400);
    expect((await request(srv).get('/epi-fichas/documents/abc/download').set(auth())).status).toBe(400);
    expect((await request(srv).get('/epi-fichas/documents/abc/verify').set(auth())).status).toBe(400);
    expect((await issue(otherTenantRandomUuid, { idempotency_key: key() })).status).toBe(404);
    expect((await issue(otherEmp, { idempotency_key: key() })).status).toBe(404); // funcionário de outra empresa
    expect((await request(srv).get(`/epi-fichas/employees/${otherTenantRandomUuid}/documents`).set(auth())).status).toBe(404);
  });

  it('não há rota de edição/exclusão de documentos nem verificação por upload (PATCH/DELETE/POST -> 404)', async () => {
    const d = await issue(emp, { idempotency_key: key() });
    expect((await request(srv).patch(`/epi-fichas/documents/${d.body.id}`).set(auth()).send({ version: 9 })).status).toBe(404);
    expect((await request(srv).delete(`/epi-fichas/documents/${d.body.id}`).set(auth())).status).toBe(404);
    expect((await request(srv).post(`/epi-fichas/documents/${d.body.id}/verify`).set(auth()).send({})).status).toBe(404);
  });

  it('código usa a data de São Paulo (2026-10-15T01:30Z -> FEPI-20261014-...) e duas emissões nunca compartilham file_key', async () => {
    const svc = app.get(EpiFichaService) as any;
    const spy = jest.spyOn(svc, 'now').mockReturnValue(new Date('2026-10-15T01:30:00.000Z'));
    try {
      const a = await issue(emp, { idempotency_key: key() });
      expect(a.status).toBe(201);
      expect(a.body.document_code).toMatch(/^FEPI-20261014-[0-9A-F]{8}$/);
    } finally {
      spy.mockRestore();
    }
    const b = await issue(emp, { idempotency_key: key() });
    const c = await issue(emp, { idempotency_key: key() });
    const keys = (await sql.query('SELECT file_key FROM epi_ficha_documents WHERE id = ANY($1)', [[b.body.id, c.body.id]])).rows.map((r) => r.file_key);
    expect(new Set(keys).size).toBe(2);
  });

  it('colisão de document_code não apaga o arquivo do documento original (verify continua íntegro)', async () => {
    const orig = await issue(emp, { idempotency_key: key() });
    const svc = app.get(EpiFichaService) as any;
    const spy = jest.spyOn(svc, 'newDocumentCode').mockReturnValue(orig.body.document_code);
    try {
      const r = await issue(emp, { idempotency_key: key() });
      expect(r.status).toBe(409);
    } finally {
      spy.mockRestore();
    }
    const v = await request(srv).get(`/epi-fichas/documents/${orig.body.id}/verify`).set(auth());
    expect(v.body.status).toBe('integro');
    expect((await download(orig.body.id)).status).toBe(200);
  });

  it('PUT do R2 pendurado: 502 em menos de 2 s, sem registro, e a próxima emissão funciona sem consumir a versão', async () => {
    process.env.EPI_FICHA_R2_TIMEOUT_MS = '300';
    try {
      const count = async () => (await sql.query('SELECT count(*)::int AS n FROM epi_ficha_documents WHERE employee_id = $1', [emp3])).rows[0].n;
      const before = await count();
      fakeR2.hangNextPut = true;
      const t0 = Date.now();
      const r = await issue(emp3, { idempotency_key: key() });
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(r.status).toBe(502);
      expect(await count()).toBe(before);
      const ok = await issue(emp3, { idempotency_key: key() });
      expect(ok.status).toBe(201);
      expect(ok.body.version).toBe(before + 1);
    } finally {
      delete process.env.EPI_FICHA_R2_TIMEOUT_MS;
    }
  });

  it('emissões de funcionários diferentes em paralelo funcionam', async () => {
    const rs = await Promise.all([issue(emp, { idempotency_key: key() }), issue(emp2, { idempotency_key: key() }), issue(emp3, { idempotency_key: key() })]);
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201]);
  });

  it('lock_timeout: outra transação segurando o funcionário -> 503 (não 500) e depois a emissão funciona', async () => {
    process.env.EPI_FICHA_LOCK_TIMEOUT_MS = '200';
    const holder = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM employees WHERE id = $1 FOR NO KEY UPDATE', [freshEmployeeId]);
      const r = await issue(freshEmployeeId, { idempotency_key: key() });
      expect(r.status).toBe(503);
      expect(JSON.stringify(r.body)).not.toMatch(/Funcionário|\d{11}/);
      await holder.query('ROLLBACK');
      expect((await issue(freshEmployeeId, { idempotency_key: key() })).status).toBe(201);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
      delete process.env.EPI_FICHA_LOCK_TIMEOUT_MS;
    }
  });

  it('a trava não bloqueia entrega ao mesmo funcionário (FOR NO KEY UPDATE)', async () => {
    const holder = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM employees WHERE id = $1 FOR NO KEY UPDATE', [emp2]);
      const r = await request(srv).post(`/epis/${epiId}/movements`).set(auth())
        .send({ type: 'entrega', quantity: 1, employee_id: emp2, idempotency_key: key() }).timeout(5000);
      expect(r.status).toBe(201);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await holder.end();
    }
  });

  it('mesma idempotency_key em paralelo para o mesmo funcionário -> [201, 200], mesmo id, um só registro', async () => {
    const k = key();
    const rs = await Promise.all([issue(emp2, { idempotency_key: k }), issue(emp2, { idempotency_key: k })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(rs[0].body.id).toBe(rs[1].body.id);
    expect((await sql.query('SELECT count(*)::int AS n FROM epi_ficha_documents WHERE idempotency_key = $1', [k])).rows[0].n).toBe(1);
  });

  it('getObject com erro genérico (não NoSuchKey): download e verify dão 502 e verify nunca diz íntegro', async () => {
    const d = await issue(emp, { idempotency_key: key() });
    fakeR2.failGet = true;
    try {
      expect((await download(d.body.id)).status).toBe(502);
      const v = await request(srv).get(`/epi-fichas/documents/${d.body.id}/verify`).set(auth());
      expect(v.status).toBe(502);
      expect(v.body.status).toBeUndefined();
    } finally {
      fakeR2.failGet = false;
    }
  });

  it('a mesma idempotency_key pode ser usada por empresas diferentes (201 nas duas)', async () => {
    const k = key();
    expect((await issue(emp, { idempotency_key: k })).status).toBe(201);
    const b = await request(srv).post(`/epi-fichas/employees/${otherEmp}/issue`).set(authB()).send({ idempotency_key: k });
    expect(b.status).toBe(201);
  });

  it('PUT estoura o timeout E o delete pendura: 502 em tempo limitado, sem registro, trava liberada', async () => {
    process.env.EPI_FICHA_R2_TIMEOUT_MS = '300';
    try {
      const count = async () => (await sql.query('SELECT count(*)::int AS n FROM epi_ficha_documents WHERE employee_id = $1', [emp2])).rows[0].n;
      const before = await count();
      fakeR2.hangNextPut = true;
      fakeR2.hangDelete = true;
      const t0 = Date.now();
      const r = await issue(emp2, { idempotency_key: key() });
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(r.status).toBe(502);
      expect(await count()).toBe(before);
      fakeR2.hangDelete = false;
      const ok = await issue(emp2, { idempotency_key: key() });
      expect(ok.status).toBe(201);
      expect(ok.body.version).toBe(before + 1);
    } finally {
      fakeR2.hangDelete = false;
      delete process.env.EPI_FICHA_R2_TIMEOUT_MS;
    }
  });

  it('falha do INSERT com delete pendurado: erro volta em tempo limitado e a trava é liberada', async () => {
    process.env.EPI_FICHA_R2_TIMEOUT_MS = '300';
    await sql.query(`CREATE OR REPLACE FUNCTION epi_ficha_test_reject2() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.employee_id = '${emp3}' THEN RAISE EXCEPTION 'rejeitado pelo teste' USING ERRCODE = '23514'; END IF; RETURN NEW; END; $$`);
    await sql.query('CREATE TRIGGER trg_epi_ficha_test_reject2 BEFORE INSERT ON epi_ficha_documents FOR EACH ROW EXECUTE FUNCTION epi_ficha_test_reject2()');
    try {
      fakeR2.hangDelete = true;
      const t0 = Date.now();
      const r = await issue(emp3, { idempotency_key: key() });
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(r.status).toBeGreaterThanOrEqual(400);
      fakeR2.hangDelete = false;
    } finally {
      fakeR2.hangDelete = false;
      await sql.query('DROP TRIGGER IF EXISTS trg_epi_ficha_test_reject2 ON epi_ficha_documents');
      await sql.query('DROP FUNCTION IF EXISTS epi_ficha_test_reject2()');
      delete process.env.EPI_FICHA_R2_TIMEOUT_MS;
    }
    expect((await issue(emp3, { idempotency_key: key() })).status).toBe(201); // trava liberada
  });

  it('getObject pendurado: download e verify respondem 502 em menos de 2 s (timeout curto por env)', async () => {
    const d = await issue(emp, { idempotency_key: key() });
    process.env.EPI_FICHA_R2_TIMEOUT_MS = '300';
    fakeR2.hangGet = true;
    try {
      const t0 = Date.now();
      expect((await download(d.body.id)).status).toBe(502);
      const v = await request(srv).get(`/epi-fichas/documents/${d.body.id}/verify`).set(auth());
      expect(v.status).toBe(502);
      expect(v.body.status).toBeUndefined();
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally {
      fakeR2.hangGet = false;
      delete process.env.EPI_FICHA_R2_TIMEOUT_MS;
    }
  });

  it('12 downloads simultâneos com R2 pendurado (> DB_POOL_MAX) não prendem o pool: requisição comum responde 200 rápido', async () => {
    const d = await issue(emp, { idempotency_key: key() });
    process.env.EPI_FICHA_R2_TIMEOUT_MS = '3000';
    fakeR2.hangGet = true;
    try {
      const pend = Array.from({ length: 12 }, () => download(d.body.id).then((r) => r.status));
      await new Promise((r) => setTimeout(r, 500)); // os 12 já passaram pela transação e esperam o R2
      const t0 = Date.now();
      const ok = await request(srv).get(`/epi-fichas/employees/${emp}`).set(auth());
      expect(ok.status).toBe(200);
      expect(Date.now() - t0).toBeLessThan(2000);
      expect((await Promise.all(pend)).every((st) => st === 502)).toBe(true);
    } finally {
      fakeR2.hangGet = false;
      delete process.env.EPI_FICHA_R2_TIMEOUT_MS;
    }
  });
});
