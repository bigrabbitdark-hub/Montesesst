import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { R2Service } from '../src/common/r2/r2.service';
import { RedisService } from '../src/common/redis/redis.service';
import { extractPdfTextFull } from '../src/common/pdf/pdf-text.util';
import { sha256Hex } from '../src/epi-ficha/canonical-json.util';
import { EPI_TERM } from '../src/epi-ficha/epi-ficha-term';
import { TestDb } from './db-test-helper';
import { makePng, strokePng } from './helpers/png';

jest.setTimeout(600_000);

// R2 sempre simulado em memória: nenhum arquivo de teste chega a um bucket real.
const fakeR2 = {
  store: new Map<string, Buffer>(),
  getCount: 0,
  failGet: false,
  hangGet: false,
  getDelayMs: 0,
  putDelayMs: 0,
  async putObject(k: string, b: Buffer) {
    if (this.putDelayMs) await new Promise((r) => setTimeout(r, this.putDelayMs));
    this.store.set(k, b);
  },
  async getObject(k: string) {
    this.getCount++;
    if (this.getDelayMs) await new Promise((r) => setTimeout(r, this.getDelayMs));
    if (this.hangGet) return new Promise<Buffer>(() => undefined); // nunca resolve
    if (this.failGet) throw new Error('falha genérica do R2 (teste)');
    const v = this.store.get(k);
    if (!v) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return v;
  },
  async deleteObject(k: string) {
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
const flat = async (b: Buffer) => ((await extractPdfTextFull(b)) ?? '').replace(/\s+/g, ' ');
const IP_PREFIX = '10.78.';

describe('Ficha de EPI com assinatura eletrônica e comprovante em PDF (e2e)', () => {
  let app: INestApplication;
  let srv: any;
  let db: TestDb;
  let sql: Client;
  let redis: RedisService;
  let tokenA: string;
  let tokenB: string;
  let tokenTecLinked: string;
  let tokenTecFree: string;
  let tokenPartner: string;
  let tokenPartnerFree: string;
  let tokenAdmin: string;
  let tenantA: string;
  let epiId: string;
  let prevDraft: string | undefined;
  let prevTimeout: string | undefined;
  let prevBudget: string | undefined;
  let seq = 0;
  let ipSeq = 0;
  const key = () => `teste-sigficha-${Date.now()}-${seq++}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const authA = () => bearer(tokenA);
  const nextIp = () => `${IP_PREFIX}${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
  const pub = (path: string, body: object) => request(srv).post(`/epi-signatures/public/${path}`).set('X-Forwarded-For', nextIp()).send(body);
  const login = async (u: { email: string; password: string }) =>
    (await request(srv).post('/auth/login').send({ email: u.email, password: u.password })).body.access_token as string;

  const newEmployee = async (name: string, cpf = String(Math.floor(Math.random() * 1e11)).padStart(11, '0')) => {
    const id = (await sql.query(`INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, $2, $3, 'ativo') RETURNING id`, [tenantA, name, cpf])).rows[0].id as string;
    return { id, cpf };
  };
  const deliver = async (employee: string): Promise<string> => {
    const r = await request(srv).post(`/epis/${epiId}/movements`).set(authA()).send({ type: 'entrega', quantity: 1, employee_id: employee, idempotency_key: key() });
    expect(r.status).toBe(201);
    return r.body.delivery_id as string;
  };
  // FLUXO REAL: criar link -> open (opcional) -> sign com PNG válido. Devolve o código do comprovante.
  const signFlow = async (employee: string, deliveries: string[], opts: { open?: boolean; png?: Buffer } = {}) => {
    const c = await request(srv).post('/epi-signatures/requests').set(authA()).send({ employee_id: employee, delivery_ids: deliveries, idempotency_key: key() });
    expect(c.status).toBe(201);
    const token = c.body.url.split('token=')[1] as string;
    if (opts.open !== false) expect((await pub('open', { token, code: c.body.code })).status).toBe(200);
    const s = await pub('sign', { token, code: c.body.code, accepted: true, term_version: EPI_TERM.version, signature_png_base64: (opts.png ?? strokePng()).toString('base64') });
    expect(s.status).toBe(201);
    return { receipt_code: s.body.receipt_code as string, evidence_sha256: s.body.evidence_sha256 as string };
  };
  const sigRow = async (code: string) =>
    (await sql.query('SELECT id, request_id, evidence_sha256, signature_sha256, signature_file_key, evidence_payload FROM epi_signatures WHERE receipt_code = $1', [code])).rows[0];
  const issue = (employee: string, body: Record<string, unknown> = {}, h = authA()) =>
    request(srv).post(`/epi-fichas/employees/${employee}/issue`).set(h).send({ idempotency_key: key(), ...body });
  const download = (id: string) => request(srv).get(`/epi-fichas/documents/${id}/download`).set(authA()).buffer(true).parse(binaryParser as any);
  const preview = (employee: string) => request(srv).get(`/epi-fichas/employees/${employee}/preview.pdf`).set(authA()).buffer(true).parse(binaryParser as any);
  const receipt = (id: string, h: Record<string, string> = authA()) => request(srv).get(`/epi-signatures/${id}/receipt.pdf`).set(h).buffer(true).parse(binaryParser as any);
  const docCount = async (employee: string) => (await sql.query('SELECT count(*)::int AS n FROM epi_ficha_documents WHERE employee_id = $1', [employee])).rows[0].n as number;

  beforeAll(async () => {
    prevDraft = process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM;
    prevTimeout = process.env.EPI_FICHA_R2_TIMEOUT_MS;
    prevBudget = process.env.EPI_FICHA_LOCKED_BUDGET_MS;
    process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(R2Service).useValue(fakeR2).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    srv = app.getHttpServer();
    redis = app.get(RedisService);
    db = new TestDb();
    await db.connect();
    sql = new Client({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
    await sql.connect();

    const a = await db.createTenantWithUser('Empresa Sig Ficha A');
    const b = await db.createTenantWithUser('Empresa Sig Ficha B');
    tenantA = a.tenantId;
    const tecV = await db.createUserWithRole('tecnico', 'Tecnico Vinculado Sig Ficha');
    const tecF = await db.createUserWithRole('tecnico', 'Tecnico Livre Sig Ficha');
    const parc = await db.createUserWithRole('parceiro', 'Parceiro Vinculado Sig Ficha');
    const parcF = await db.createUserWithRole('parceiro', 'Parceiro Livre Sig Ficha');
    const adm = await db.createUserWithRole('admin', 'Admin Sig Ficha');
    const c = (db as any).client;
    const techId = (await c.query('INSERT INTO technicians (user_id) VALUES ($1) RETURNING id', [tecV.userId])).rows[0].id;
    await c.query('INSERT INTO tenant_technicians (tenant_id, technician_id) VALUES ($1, $2)', [a.tenantId, techId]);
    await c.query('INSERT INTO technicians (user_id) VALUES ($1)', [tecF.userId]);
    const partId = (await c.query(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC') RETURNING id`, [parc.userId])).rows[0].id;
    await c.query('INSERT INTO tenant_partners (tenant_id, partner_id) VALUES ($1, $2)', [a.tenantId, partId]);
    await c.query(`INSERT INTO partners (user_id, service_region) VALUES ($1, 'Sul de SC')`, [parcF.userId]);
    tokenA = await login(a);
    tokenB = await login(b);
    tokenTecLinked = await login(tecV);
    tokenTecFree = await login(tecF);
    tokenPartner = await login(parc);
    tokenPartnerFree = await login(parcF);
    tokenAdmin = await login(adm);

    const cat = (await request(srv).get('/epi-catalog-items').set(authA())).body;
    epiId = (await request(srv).post('/epis').set(authA()).send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-SIGF-1', manufacturer: 'Fab', model: 'M1' })).body.id;
    expect((await request(srv).post(`/epis/${epiId}/movements`).set(authA()).send({ type: 'abertura', quantity: 5000, idempotency_key: key() })).status).toBe(201);
  });

  afterAll(async () => {
    if (prevDraft === undefined) delete process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM; else process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = prevDraft;
    if (prevTimeout === undefined) delete process.env.EPI_FICHA_R2_TIMEOUT_MS; else process.env.EPI_FICHA_R2_TIMEOUT_MS = prevTimeout;
    if (prevBudget === undefined) delete process.env.EPI_FICHA_LOCKED_BUDGET_MS; else process.env.EPI_FICHA_LOCKED_BUDGET_MS = prevBudget;
    const keys = await redis.client.keys(`ratelimit:EpiSignaturePublicController.*:${IP_PREFIX}*`);
    if (keys.length) await redis.client.del(...keys);
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  // ---------------------------------------------------------------- ficha
  it('sem evidência eletrônica: nenhum anexo, nenhuma imagem, nenhuma leitura do R2 e linha "assinada" legada fica só "Assinada"', async () => {
    const e = await newEmployee('Func Sem Evidencia');
    const d1 = await deliver(e.id);
    await deliver(e.id); // pendente
    // entrega marcada como assinada por fluxo ANTERIOR ao módulo (sem registro em epi_signatures)
    await sql.query(`UPDATE employee_epi_deliveries SET signature_status = 'assinada', signed_at = now() WHERE id = $1`, [d1]);
    const before = fakeR2.getCount;
    const i = await issue(e.id);
    expect(i.status).toBe(201);
    expect(fakeR2.getCount).toBe(before); // sem evidência a emissão não lê imagem (o download abaixo lê o PDF)
    const pdf = (await download(i.body.id)).body as Buffer;
    const text = await flat(pdf);
    expect(text).not.toContain('Comprovantes de assinatura');
    expect(text).not.toContain('Assinada eletronicamente');
    expect(text).toContain('Assinada');
    expect(text).not.toContain('ASEPI-');
    const j = await request(srv).get(`/epi-fichas/employees/${e.id}`).set(authA());
    expect(j.body.signatures).toEqual([]);
    expect(j.body.lines.every((l: any) => l.receipt_code === null && l.signed_at === null)).toBe(true);
  });

  it('com evidência: getFicha devolve receipt_code/signed_at nas linhas e "signatures" sem chave de arquivo', async () => {
    const e = await newEmployee('Func Com Evidencia JSON');
    const d1 = await deliver(e.id);
    const d2 = await deliver(e.id);
    const d3 = await deliver(e.id); // fica pendente
    const s = await signFlow(e.id, [d1, d2]);
    const row = await sigRow(s.receipt_code);
    const r = await request(srv).get(`/epi-fichas/employees/${e.id}`).set(authA());
    expect(r.status).toBe(200);
    const signed = r.body.lines.filter((l: any) => l.signature_status === 'assinada');
    expect(signed).toHaveLength(2);
    for (const l of signed) {
      expect(l.receipt_code).toBe(s.receipt_code);
      expect(l.signed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    }
    const pend = r.body.lines.find((l: any) => l.delivery_id === d3);
    expect(pend.receipt_code).toBeNull();
    expect(pend.signed_at).toBeNull();
    expect(r.body.signatures).toEqual([{ receipt_code: s.receipt_code, signed_at: signed[0].signed_at, evidence_sha256: row.evidence_sha256, signature_sha256: row.signature_sha256 }]);
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain('signature_file_key');
    expect(raw).not.toContain(row.signature_file_key);
    expect(raw).not.toContain('epi-signatures/');
    expect(raw).not.toContain(e.cpf);
  });

  it('prévia mostra só código e data (sem ler imagens do R2); a emissão lê a imagem e inclui o anexo; o instantâneo não guarda chave, token nem CPF', async () => {
    const e = await newEmployee('Func Com Evidencia PDF', '12353344799');
    const d1 = await deliver(e.id);
    const s = await signFlow(e.id, [d1]);
    const row = await sigRow(s.receipt_code);

    const g0 = fakeR2.getCount;
    const pv = (await preview(e.id)).body as Buffer;
    expect(fakeR2.getCount).toBe(g0); // prévia NÃO lê imagem
    const pvText = await flat(pv);
    expect(pvText).toContain(s.receipt_code);
    expect(pvText).toContain('Assinada eletronicamente em');
    expect(pvText).toContain('(America/Sao_Paulo) — comprovante');
    expect(pvText).toContain('Comprovantes de assinatura');

    const i = await issue(e.id);
    expect(i.status).toBe(201);
    expect(fakeR2.getCount).toBe(g0 + 1); // a emissão leu exatamente 1 imagem
    const pdf = (await download(i.body.id)).body as Buffer;
    const text = await flat(pdf);
    expect(text).toContain(s.receipt_code);
    expect(text).toContain('Comprovantes de assinatura');
    expect(text).toContain(row.evidence_sha256);
    expect(text).toContain(row.signature_sha256);
    expect(text).not.toContain('imagem indisponível/divergente');
    expect(text).not.toMatch(/\b\d{11}\b/);
    expect(pdf.length).toBeGreaterThan(pv.length); // a emissão carrega a imagem; a prévia não

    const snap = (await sql.query('SELECT snapshot, snapshot_sha256 FROM epi_ficha_documents WHERE id = $1', [i.body.id])).rows[0];
    const snapText = JSON.stringify(snap.snapshot);
    expect(snapText).not.toContain('signature_file_key');
    expect(snapText).not.toContain(row.signature_file_key);
    expect(snapText).not.toContain('epi-signatures/');
    expect(snapText).not.toContain('12353344799');
    expect(snapText).not.toContain('token');
    expect(snap.snapshot.signatures).toEqual([{
      receipt_code: s.receipt_code, signed_at: expect.any(String), evidence_sha256: row.evidence_sha256, signature_sha256: row.signature_sha256,
    }]);
    expect(snap.snapshot.lines[0].receipt_code).toBe(s.receipt_code);
    expect(i.body.snapshot_sha256).toBe(snap.snapshot_sha256);
    expect(JSON.stringify(i.body)).not.toContain('signature_file_key');
  });

  it('entrega presencial aparece como "Registrada presencialmente", sem comprovante nem anexo', async () => {
    const e = await newEmployee('Func Presencial');
    const d1 = await deliver(e.id);
    const r = await request(srv).post('/epi-signatures/in-person').set(authA()).send({ delivery_ids: [d1], witness_name: 'Testemunha Teste', reason: 'Sem celular no ato' });
    expect(r.status).toBe(201);
    const g0 = fakeR2.getCount;
    const i = await issue(e.id);
    expect(i.status).toBe(201);
    expect(fakeR2.getCount).toBe(g0); // nenhuma imagem lida na emissão
    const text = await flat((await download(i.body.id)).body as Buffer);
    expect(text).toContain('Registrada presencialmente');
    expect(text).not.toContain('Comprovantes de assinatura');
    expect(text).not.toContain('Assinada eletronicamente');
    expect((await request(srv).get(`/epi-fichas/employees/${e.id}`).set(authA())).body.signatures).toEqual([]);
  });

  it('imagem ausente ou com hash divergente no R2: emite sem desenhar a imagem e registra "imagem indisponível/divergente"', async () => {
    const e = await newEmployee('Func Imagem Divergente');
    const d1 = await deliver(e.id);
    const d2 = await deliver(e.id);
    const s1 = await signFlow(e.id, [d1]);
    const s2 = await signFlow(e.id, [d2]);
    const r1 = await sigRow(s1.receipt_code);
    const r2 = await sigRow(s2.receipt_code);
    const original = fakeR2.store.get(r1.signature_file_key) as Buffer;
    try {
      fakeR2.store.set(r1.signature_file_key, Buffer.from('conteúdo trocado no R2')); // divergente
      fakeR2.store.delete(r2.signature_file_key); // ausente
      const i = await issue(e.id);
      expect(i.status).toBe(201);
      const text = await flat((await download(i.body.id)).body as Buffer);
      expect((text.match(/imagem indisponível\/divergente/g) ?? []).length).toBe(2);
      expect(text).toContain(s1.receipt_code);
      expect(text).toContain(s2.receipt_code);
    } finally {
      fakeR2.store.set(r1.signature_file_key, original);
      fakeR2.store.set(r2.signature_file_key, original);
    }
  });

  it('falha ou prazo estourado ao ler as imagens no R2: 502 e NENHUM documento registrado', async () => {
    const e = await newEmployee('Func R2 Falha Leitura');
    const d1 = await deliver(e.id);
    await signFlow(e.id, [d1]);
    expect(await docCount(e.id)).toBe(0);

    fakeR2.failGet = true;
    try {
      expect((await issue(e.id)).status).toBe(502);
    } finally {
      fakeR2.failGet = false;
    }
    expect(await docCount(e.id)).toBe(0);

    process.env.EPI_FICHA_R2_TIMEOUT_MS = '300';
    fakeR2.hangGet = true;
    const t0 = Date.now();
    try {
      expect((await issue(e.id)).status).toBe(502);
    } finally {
      fakeR2.hangGet = false;
      if (prevTimeout === undefined) delete process.env.EPI_FICHA_R2_TIMEOUT_MS; else process.env.EPI_FICHA_R2_TIMEOUT_MS = prevTimeout;
    }
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(await docCount(e.id)).toBe(0);
    // e a trava foi liberada: a emissão seguinte funciona
    expect((await issue(e.id)).status).toBe(201);
  });

  it('repetição idempotente da emissão não relê as imagens', async () => {
    const e = await newEmployee('Func Idempotente Sig');
    const d1 = await deliver(e.id);
    await signFlow(e.id, [d1]);
    const k = key();
    expect((await issue(e.id, { idempotency_key: k })).status).toBe(201);
    const g = fakeR2.getCount;
    expect((await issue(e.id, { idempotency_key: k })).status).toBe(200);
    expect(fakeR2.getCount).toBe(g);
  });

  it('filtro signature_status=assinada mantém receipt_code e a lista de assinaturas coerentes', async () => {
    const e = await newEmployee('Func Filtro Sig');
    const d1 = await deliver(e.id);
    await deliver(e.id);
    const s = await signFlow(e.id, [d1]);
    const r = await request(srv).get(`/epi-fichas/employees/${e.id}?signature_status=assinada`).set(authA());
    expect(r.status).toBe(200);
    expect(r.body.lines).toHaveLength(1);
    expect(r.body.lines[0].receipt_code).toBe(s.receipt_code);
    expect(r.body.signatures.map((x: any) => x.receipt_code)).toEqual([s.receipt_code]);
    const p = await request(srv).get(`/epi-fichas/employees/${e.id}?signature_status=pendente`).set(authA());
    expect(p.body.signatures).toEqual([]);
  });

  it('120 linhas e mais de 100 assinaturas não estouram: só 100 imagens, o restante lista código/data, e há um rodapé por página', async () => {
    const e = await newEmployee('Func Muitas Assinaturas');
    const codes: string[] = [];
    for (let n = 0; n < 102; n++) {
      const d = await deliver(e.id);
      codes.push((await signFlow(e.id, [d], { open: false })).receipt_code);
    }
    for (let n = 0; n < 18; n++) await deliver(e.id); // 120 linhas no total (18 pendentes)
    const g0 = fakeR2.getCount;
    const t0 = Date.now();
    const i = await issue(e.id);
    const ms = Date.now() - t0;
    expect(i.status).toBe(201);
    expect(fakeR2.getCount - g0).toBe(100); // no máximo 100 leituras
    const pdf = (await download(i.body.id)).body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = await flat(pdf);
    for (const c of codes) expect(text).toContain(c);
    expect(text).toMatch(/limite de 100/);
    const m = text.match(/Página (\d+) de (\d+)/g) ?? [];
    const total = Number(/de (\d+)/.exec(m[0] as string)?.[1]);
    expect(m.length).toBe(total);
    console.log(`[medição] emissão com 102 assinaturas: ${ms} ms, PDF ${(pdf.length / 1024).toFixed(0)} KB, ${total} páginas`);
  });

  it('objeto do R2 maior que 256 KB é tratado como indisponível (sem hashear nem desenhar)', async () => {
    const e = await newEmployee('Func Objeto Grande');
    const d1 = await deliver(e.id);
    const s = await signFlow(e.id, [d1]);
    const r = await sigRow(s.receipt_code);
    const original = fakeR2.store.get(r.signature_file_key) as Buffer;
    try {
      fakeR2.store.set(r.signature_file_key, Buffer.concat([original, Buffer.alloc(300 * 1024)]));
      const i = await issue(e.id);
      expect(i.status).toBe(201);
      const text = await flat((await download(i.body.id)).body as Buffer);
      expect(text).toContain('imagem indisponível/divergente');
    } finally {
      fakeR2.store.set(r.signature_file_key, original);
    }
  });

  it('orçamento total da trava (EPI_FICHA_LOCKED_BUDGET_MS): R2 de 3 s por operação com orçamento de 5 s -> 502 em ~5 s, sem registro, e a emissão seguinte funciona', async () => {
    const e = await newEmployee('Func Orcamento Trava');
    const d1 = await deliver(e.id);
    await signFlow(e.id, [d1]);
    process.env.EPI_FICHA_LOCKED_BUDGET_MS = '5000';
    fakeR2.getDelayMs = 3000;
    fakeR2.putDelayMs = 3000;
    const t0 = Date.now();
    try {
      expect((await issue(e.id)).status).toBe(502); // leitura 3 s + PUT limitado aos 2 s restantes
    } finally {
      fakeR2.getDelayMs = 0;
      fakeR2.putDelayMs = 0;
      if (prevBudget === undefined) delete process.env.EPI_FICHA_LOCKED_BUDGET_MS; else process.env.EPI_FICHA_LOCKED_BUDGET_MS = prevBudget;
    }
    const ms = Date.now() - t0;
    console.log(`[medição] orçamento 5 s com R2 de 3 s/op: 502 em ${ms} ms`);
    expect(ms).toBeGreaterThanOrEqual(4500);
    expect(ms).toBeLessThan(7500);
    expect(await docCount(e.id)).toBe(0);
    expect((await issue(e.id)).status).toBe(201);
  });

  it('pior caso: 100 assinaturas 1200x600 de traço denso respeitam o orçamento de 12 megapixels (só 16 imagens), terminam rápido e o PDF fica razoável', async () => {
    // padrão pseudoaleatório com ~1/12 dos pixels pretos: comprime mal e ainda cabe nos 200 KB de entrada
    let seed = 987654321;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 8; };
    const dense = makePng(1200, 600, () => (rnd() % 12 === 0 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    expect(dense.length).toBeLessThanOrEqual(200 * 1024);
    const e = await newEmployee('Func Pior Caso Denso');
    const codes: string[] = [];
    for (let n = 0; n < 100; n++) {
      const d = await deliver(e.id);
      codes.push((await signFlow(e.id, [d], { open: false, png: dense })).receipt_code);
    }
    const rss0 = process.memoryUsage().rss;
    let peak = rss0;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 50);
    const t0 = Date.now();
    const i = await issue(e.id);
    const ms = Date.now() - t0;
    clearInterval(timer);
    peak = Math.max(peak, process.memoryUsage().rss);
    expect(i.status).toBe(201);
    expect(ms).toBeLessThan(30_000);
    const pdf = (await download(i.body.id)).body as Buffer;
    expect(pdf.length).toBeLessThan(25 * 1024 * 1024);
    const text = await flat(pdf);
    expect((text.match(/imagem não incluída \(limite do documento\)/g) ?? []).length).toBe(100 - Math.floor(12_000_000 / (1200 * 600)));
    for (const c of codes) expect(text).toContain(c);
    console.log(`[medição] pior caso denso: entrada ${(dense.length / 1024).toFixed(0)} KB/img; emissão ${ms} ms; RSS ${(rss0 / 1048576).toFixed(0)} -> pico ${(peak / 1048576).toFixed(0)} MB; PDF ${(pdf.length / 1048576).toFixed(2)} MB`);
  });

  // ---------------------------------------------------------------- comprovante
  describe('GET /epi-signatures/:id/receipt.pdf', () => {
    let emp: { id: string; cpf: string };
    let code: string;
    let sigId: string;
    let evidence: string;

    beforeAll(async () => {
      emp = await newEmployee('João Comprovante Silva', '98753344711');
      const d1 = await deliver(emp.id);
      const d2 = await deliver(emp.id);
      code = (await signFlow(emp.id, [d1, d2])).receipt_code;
      const row = await sigRow(code);
      sigId = row.id;
      evidence = row.evidence_sha256;
    });

    it('200 com %PDF, texto confere com a evidência, sem ler o R2 e com cabeçalhos de não-cache', async () => {
      const g0 = fakeR2.getCount;
      const r = await receipt(sigId);
      expect(r.status).toBe(200);
      expect(fakeR2.getCount).toBe(g0); // o comprovante NÃO lê o R2 (nem embute a imagem)
      expect(r.headers['content-type']).toMatch(/application\/pdf/);
      expect(r.headers['cache-control']).toBe('private, no-store');
      expect(r.headers['content-disposition']).toBe(`inline; filename="${code}.pdf"`);
      const pdf = r.body as Buffer;
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      const text = await flat(pdf);
      const row = await sigRow(code);
      expect(text).toContain(code);
      expect(text).toContain(evidence);
      expect(text).toContain(row.signature_sha256);
      expect(text).toContain('***.533.447-**');
      expect(text).not.toContain('98753344711');
      expect(text).toContain('João Comprovante Silva');
      expect(text).toContain('CA CA-SIGF-1');
      expect(text).toContain('Assinatura eletrônica simples, registrada com aceite explícito, código de confirmação e evidências técnicas; não é assinatura digital com certificado ICP-Brasil.');
      expect(text).toContain('RASCUNHO');
      expect(text).toContain('America/Sao_Paulo');
      // o hash exibido é mesmo o SHA-256 do payload JSON da evidência (o banco hasheia v_payload::text)
      const payloadText = (await sql.query('SELECT evidence_payload::text AS t FROM epi_signatures WHERE id = $1', [sigId])).rows[0].t as string;
      expect(sha256Hex(payloadText)).toBe(evidence);
      const items = row.evidence_payload.items as any[];
      expect(items).toHaveLength(2);
      for (const it of items) expect(text).toContain(it.epi_description);
    });

    it('empresa B recebe 404; técnico e parceiro NÃO vinculados recebem 404', async () => {
      expect((await receipt(sigId, bearer(tokenB))).status).toBe(404);
      expect((await receipt(sigId, bearer(tokenTecFree))).status).toBe(404);
      expect((await receipt(sigId, bearer(tokenPartnerFree))).status).toBe(404);
    });

    it('empresa dona, técnico vinculado, parceiro vinculado e admin recebem 200', async () => {
      for (const [nome, t] of [['empresa', tokenA], ['tecnico', tokenTecLinked], ['parceiro', tokenPartner], ['admin', tokenAdmin]] as const) {
        const r = await receipt(sigId, bearer(t));
        expect([nome, r.status]).toEqual([nome, 200]);
      }
    });

    it('id inexistente 404; id inválido 400; sem token 401; receipt_code no lugar do id 400', async () => {
      expect((await receipt('00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await receipt('abc')).status).toBe(400);
      expect((await receipt(code)).status).toBe(400);
      expect((await request(srv).get(`/epi-signatures/${sigId}/receipt.pdf`)).status).toBe(401);
    });

    it('o id da requisição (e não o da assinatura) não abre comprovante', async () => {
      const row = await sigRow(code);
      expect((await receipt(row.request_id)).status).toBe(404);
    });
  });
});
