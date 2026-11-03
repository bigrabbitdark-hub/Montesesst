import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { R2Service } from '../src/common/r2/r2.service';
import { RedisService } from '../src/common/redis/redis.service';
import { RATE_LIMIT_KEY } from '../src/common/rate-limit/rate-limit.decorator';
import { sha256Hex } from '../src/epi-ficha/canonical-json.util';
import { EPI_TERM } from '../src/epi-ficha/epi-ficha-term';
import { EpiSignaturePublicController } from '../src/epi-signature/epi-signature-public.controller';
import { hashPin } from '../src/epi-signature/signature-secrets.util';
import { TestDb } from './db-test-helper';
import { blankPng, decodeUnfilteredPixels, makeFilteredPng, noisePng, strokePng } from './helpers/png';
import { validateSignaturePng } from '../src/epi-signature/signature-png.util';
import * as pngUtil from '../src/epi-signature/signature-png.util';
import { termTextSha256 } from '../src/epi-signature/signature-secrets.util';

jest.setTimeout(60_000);

// R2 sempre simulado em memória: nenhum arquivo de teste chega a um bucket real.
const fakeR2 = {
  store: new Map<string, Buffer>(),
  putCount: 0,
  deleteCount: 0,
  putDelayMs: 0,
  failNextPut: false,
  hangNextPut: false,
  async putObject(k: string, b: Buffer) {
    this.putCount++;
    if (this.hangNextPut) {
      this.hangNextPut = false;
      return new Promise<void>(() => undefined); // nunca resolve (simula R2 pendurado)
    }
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error('R2 indisponível (teste)');
    }
    if (this.putDelayMs) await new Promise((r) => setTimeout(r, this.putDelayMs));
    this.store.set(k, b);
  },
  async getObject(k: string) {
    const v = this.store.get(k);
    if (!v) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return v;
  },
  async deleteObject(k: string) {
    this.deleteCount++;
    this.store.delete(k);
  },
  async getPresignedDownloadUrl() {
    return 'x';
  },
};

const INVALID = 'Link inválido ou expirado';
const IP_PREFIX = '10.77.'; // IPs de teste (X-Forwarded-For, trust proxy = 1): um contador de rate limit por IP

describe('Assinatura eletrônica de EPI: rotas públicas peek/open/sign/refuse (e2e)', () => {
  let app: INestApplication;
  let srv: any;
  let db: TestDb;
  let sql: Client;
  let redis: RedisService;
  let token: string; // JWT do responsável
  let tenantId: string;
  let epiId: string;
  let prevDraft: string | undefined;
  let prevPublic: string | undefined;
  let seq = 0;
  let ipSeq = 0;
  const key = () => `teste-pub-${Date.now()}-${seq++}-${randomUUID().slice(0, 6)}`;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  // Cada chamada usa um IP novo (a menos que o teste fixe um): o limite por IP nunca atrapalha os demais testes.
  const nextIp = () => `${IP_PREFIX}${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
  const post = (path: string, body: object, ip: string = nextIp()) =>
    request(srv).post(`/epi-signatures/public/${path}`).set('X-Forwarded-For', ip).send(body);

  interface Link { emp: string; cpf: string; delivery: string; id: string; token: string; code: string }
  const newEmployee = async (name: string) => {
    const cpf = String(Math.floor(Math.random() * 1e11)).padStart(11, '0');
    const id = (await sql.query(`INSERT INTO employees (tenant_id, full_name, cpf, status) VALUES ($1, $2, $3, 'ativo') RETURNING id`, [tenantId, name, cpf])).rows[0].id as string;
    return { id, cpf };
  };
  const deliver = async (employee: string, qty = 1): Promise<string> => {
    const r = await request(srv).post(`/epis/${epiId}/movements`).set(auth()).send({ type: 'entrega', quantity: qty, employee_id: employee, idempotency_key: key() });
    expect(r.status).toBe(201);
    return r.body.delivery_id as string;
  };
  const link = async (name = 'Func Assinatura Publica'): Promise<Link> => {
    const e = await newEmployee(name);
    const delivery = await deliver(e.id);
    const r = await request(srv).post('/epi-signatures/requests').set(auth()).send({ employee_id: e.id, idempotency_key: key() });
    expect(r.status).toBe(201);
    return { emp: e.id, cpf: e.cpf, delivery, id: r.body.id, token: r.body.url.split('token=')[1], code: r.body.code };
  };
  const signBody = (l: Link, over: Record<string, unknown> = {}) => ({
    token: l.token, code: l.code, accepted: true, term_version: EPI_TERM.version, signature_png_base64: strokePng().toString('base64'), ...over,
  });
  const row = async (id: string) => (await sql.query('SELECT status, attempts, refusal_reason FROM epi_signature_requests WHERE id = $1', [id])).rows[0];
  const deliveryOf = async (id: string) => (await sql.query('SELECT signature_status, signed_at, signed_by_name FROM employee_epi_deliveries WHERE id = $1', [id])).rows[0];
  const evidenceCount = async (id: string) => (await sql.query('SELECT count(*)::int AS n FROM epi_signatures WHERE request_id = $1', [id])).rows[0].n as number;
  const noStore = (r: { headers: Record<string, string> }) => expect(r.headers['cache-control']).toBe('no-store');
  const sigKeys = () => [...fakeR2.store.keys()].filter((k) => k.startsWith(`tenants/${tenantId}/epi-signatures/`));
  // O link continua utilizável: abre com o código certo e nada foi gasto.
  const stillUsable = async (l: Link) => {
    const o = await post('open', { token: l.token, code: l.code });
    expect(o.status).toBe(200);
    expect((await row(l.id)).status).toBe('ativa');
    expect(await evidenceCount(l.id)).toBe(0);
    expect((await deliveryOf(l.delivery)).signature_status).toBe('pendente');
  };

  beforeAll(async () => {
    prevDraft = process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM;
    prevPublic = process.env.PUBLIC_APP_URL;
    process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'true';
    delete process.env.PUBLIC_APP_URL;
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

    const a = await db.createTenantWithUser('Empresa Assinatura Publica');
    tenantId = a.tenantId;
    token = (await request(srv).post('/auth/login').send({ email: a.email, password: a.password })).body.access_token as string;
    const cat = (await request(srv).get('/epi-catalog-items').set(auth())).body;
    epiId = (await request(srv).post('/epis').set(auth()).send({ epi_catalog_item_id: cat[0].id, ca_number: 'CA-PUB-1', manufacturer: 'Fab', model: 'M1' })).body.id;
    expect((await request(srv).post(`/epis/${epiId}/movements`).set(auth()).send({ type: 'abertura', quantity: 5000, idempotency_key: key() })).status).toBe(201);
  });

  afterAll(async () => {
    if (prevDraft === undefined) delete process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM; else process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = prevDraft;
    if (prevPublic === undefined) delete process.env.PUBLIC_APP_URL; else process.env.PUBLIC_APP_URL = prevPublic;
    // limpa só os contadores deste arquivo (rota pública + IPs de teste); nunca FLUSHALL
    const keys = await redis.client.keys(`ratelimit:EpiSignaturePublicController.*:${IP_PREFIX}*`);
    if (keys.length) await redis.client.del(...keys);
    await db.cleanup();
    await sql.end();
    await db.disconnect();
    await app.close();
  });

  it('peek: link ativo mostra só o nome da empresa; inexistente/expirado/revogado/usado respondem IGUAL', async () => {
    const l = await link('Func Peek');
    const exp = await link('Func Peek Expirado');
    const rev = await link('Func Peek Revogado');
    const used = await link('Func Peek Usado');
    await sql.query(`UPDATE epi_signature_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [exp.id]);
    expect((await request(srv).post(`/epi-signatures/requests/${rev.id}/revoke`).set(auth())).status).toBe(201);
    expect((await post('sign', signBody(used))).status).toBe(201);

    const ok = await post('peek', { token: l.token });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ usable: true, company_name: expect.any(String) });
    expect(ok.body.company_name).toMatch(/^Empresa Assinatura Publica/);
    expect(JSON.stringify(ok.body)).not.toContain(l.cpf);
    noStore(ok);
    const bodies = await Promise.all([
      post('peek', { token: 'x'.repeat(43) }), post('peek', { token: exp.token }), post('peek', { token: rev.token }), post('peek', { token: used.token }),
    ]);
    for (const r of bodies) {
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ usable: false });
      noStore(r);
    }
  });

  it('open: código certo devolve nome do funcionário, itens e termo — sem CPF; errado -> 401 com tentativas restantes; 5ª -> 403 e bloqueia', async () => {
    const l = await link('Func Open Dados');
    const ok = await post('open', { token: l.token, code: l.code });
    expect(ok.status).toBe(200);
    noStore(ok);
    expect(ok.body.employee_name).toBe('Func Open Dados');
    expect(ok.body.attempts_left).toBe(5);
    expect(ok.body.items).toHaveLength(1);
    expect(ok.body.items[0]).toMatchObject({ delivery_id: l.delivery, quantity: 1, ca_number: 'CA-PUB-1', manufacturer: 'Fab', model: 'M1', epi_description: expect.any(String) });
    expect(ok.body.term).toEqual({ version: EPI_TERM.version, draft: EPI_TERM.draft, title: EPI_TERM.title, paragraphs: [...EPI_TERM.paragraphs] });
    expect(new Date(ok.body.expires_at).getTime()).toBeGreaterThan(Date.now());
    const flat = JSON.stringify(ok.body);
    expect(flat).not.toContain(l.cpf);
    expect(flat).not.toMatch(/\b\d{11}\b/);
    expect(flat).not.toContain(l.token);
    expect(flat).not.toContain(l.code);
    expect(flat).not.toContain(tenantId);
    expect(flat).not.toContain(l.emp);
    expect(Object.keys(ok.body).sort()).toEqual(['attempts_left', 'employee_name', 'expires_at', 'items', 'term']);

    const l2 = await link('Func Open Tentativas');
    const wrong = l2.code === '000000' ? '111111' : '000000';
    for (const left of [4, 3, 2, 1]) {
      const r = await post('open', { token: l2.token, code: wrong });
      expect(r.status).toBe(401);
      expect(r.body.attempts_left).toBe(left);
      expect(r.body.message).toBe('Código incorreto');
      noStore(r);
    }
    const fifth = await post('open', { token: l2.token, code: wrong });
    expect(fifth.status).toBe(403);
    noStore(fifth);
    expect((await row(l2.id)).status).toBe('bloqueada');
    // bloqueado: nem o código certo abre
    const after = await post('open', { token: l2.token, code: l2.code });
    expect(after.status).toBe(403);
    expect(JSON.stringify(after.body)).not.toContain('Func Open Tentativas');
    expect((await post('sign', signBody(l2))).status).toBe(404); // link bloqueado não é mais utilizável: a rota de sign responde 404 uniforme antes de validar a imagem
    expect((await post('refuse', { token: l2.token, code: l2.code })).status).toBe(403);
  });

  it('open com token inexistente/expirado/revogado/usado -> 404 com a MESMA mensagem; bloqueado -> 403', async () => {
    const exp = await link('Func Open Expirado');
    const rev = await link('Func Open Revogado');
    const used = await link('Func Open Usado');
    await sql.query(`UPDATE epi_signature_requests SET expires_at = now() - interval '1 minute' WHERE id = $1`, [exp.id]);
    expect((await request(srv).post(`/epi-signatures/requests/${rev.id}/revoke`).set(auth())).status).toBe(201);
    expect((await post('sign', signBody(used))).status).toBe(201);
    const cases = [
      { token: 'y'.repeat(43), code: '123456' },
      { token: exp.token, code: exp.code },
      { token: rev.token, code: rev.code },
      { token: used.token, code: used.code },
    ];
    const rs = await Promise.all(cases.map((c) => post('open', c)));
    for (const r of rs) {
      expect(r.status).toBe(404);
      expect(r.body.message).toBe(INVALID);
      expect(r.body).toEqual(rs[0].body); // corpo idêntico: não distingue os casos
      noStore(r);
    }
    // sign e refuse usam a mesma resposta uniforme
    for (const route of ['sign', 'refuse']) {
      const r = await post(route, route === 'sign' ? signBody(used) : { token: rev.token, code: rev.code });
      expect(r.status).toBe(404);
      expect(r.body).toEqual(rs[0].body);
      noStore(r);
    }
    // código errado em link inexistente: igual (não revela se o link existe)
    const ghost = await post('open', { token: 'z'.repeat(43), code: '999999' });
    expect(ghost.status).toBe(404);
    expect(ghost.body).toEqual(rs[0].body);
  });

  it('sign: PNG válido + aceite -> 201, evidência gravada, entregas assinadas, imagem no R2 com hash igual, comprovante com código; a ficha passa a mostrar a assinatura', async () => {
    const l = await link('Func Sign Feliz');
    const png = strokePng();
    const ua = 'Mozilla/5.0 ' + 'x'.repeat(400);
    const ip = nextIp();
    const r = await request(srv).post('/epi-signatures/public/sign').set('X-Forwarded-For', ip).set('User-Agent', ua)
      .send({ token: l.token, code: l.code, accepted: true, term_version: EPI_TERM.version, signature_png_base64: png.toString('base64') });
    expect(r.status).toBe(201);
    noStore(r);
    expect(r.body).toMatchObject({ receipt_code: expect.stringMatching(/^ASEPI-\d{8}-[0-9A-F]{8}$/), signed_at: expect.any(String), evidence_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const flat = JSON.stringify(r.body);
    expect(flat).not.toContain(l.token);
    expect(flat).not.toContain(l.code);
    const ev = (await sql.query('SELECT * FROM epi_signatures WHERE receipt_code = $1', [r.body.receipt_code])).rows[0];
    expect(ev.tenant_id).toBe(tenantId);
    expect(ev.employee_id).toBe(l.emp);
    expect(ev.request_id).toBe(l.id);
    expect(ev.code_verified).toBe(true);
    expect(ev.accepted).toBe(true);
    expect(ev.evidence_sha256).toBe(r.body.evidence_sha256);
    expect(ev.signature_file_key).toMatch(new RegExp(`^tenants/${tenantId}/epi-signatures/[0-9a-f-]{36}\\.png$`));
    expect(ev.signature_file_key).not.toContain(l.token);
    expect(sha256Hex(fakeR2.store.get(ev.signature_file_key)!)).toBe(ev.signature_sha256);
    expect(ev.signature_sha256).toBe(sha256Hex(validateSignaturePng(png).canonical)); // guarda-se o PNG canônico, não os bytes enviados
    expect(fakeR2.store.get(ev.signature_file_key)!.equals(png)).toBe(false);
    expect(decodeUnfilteredPixels(fakeR2.store.get(ev.signature_file_key)!).px.equals(decodeUnfilteredPixels(png).px)).toBe(true);
    expect(ev.ip).toBe(ip); // vem de req.ip (trust proxy = 1 usa a última entrada do X-Forwarded-For)
    expect(ev.user_agent).toBe(ua.slice(0, 300));
    expect(ev.user_agent).toHaveLength(300);
    expect(ev.term_version).toBe(EPI_TERM.version);
    expect(JSON.stringify(ev.items_snapshot)).not.toMatch(/\b\d{11}\b/);
    expect(JSON.stringify(ev.evidence_payload)).not.toContain(l.cpf);
    expect(JSON.stringify(ev)).not.toContain(l.token);
    expect(JSON.stringify(ev)).not.toContain(l.code);
    const d = await deliveryOf(l.delivery);
    expect(d).toMatchObject({ signature_status: 'assinada', signed_by_name: 'Func Sign Feliz' });
    expect(d.signed_at).toBeTruthy();
    expect(await row(l.id)).toMatchObject({ status: 'assinada' });
    // a ficha (visão do responsável) passa a mostrar a assinatura
    const ficha = await request(srv).get(`/epi-fichas/employees/${l.emp}?from=2020-01-01&to=2099-12-31`).set(auth());
    expect(ficha.status).toBe(200);
    expect(ficha.body.lines.find((x: any) => x.delivery_id === l.delivery)).toMatchObject({ signature_status: 'assinada' });
    // o link foi consumido
    const again = await post('open', { token: l.token, code: l.code });
    expect(again.status).toBe(404);
    expect(again.body.message).toBe(INVALID);
  });

  it('sign: imagem em branco / não PNG / grande / base64 inválido / sem aceite / termo desatualizado -> 400 sem gravar nada e sem consumir o link', async () => {
    const l = await link('Func Sign Rejeicoes');
    const puts = fakeR2.putCount;
    const keysBefore = sigKeys().length;
    const big = noisePng(230, 230); // ~211 KB: base64 cabe no DTO (<= 300.000), mas o PNG passa de 200 KB
    expect(big.length).toBeGreaterThan(200 * 1024);
    const cases: Array<[string, Record<string, unknown>, RegExp?]> = [
      ['branco', { signature_png_base64: blankPng().toString('base64') }, /em branco/i],
      ['não PNG', { signature_png_base64: Buffer.from('isto não é uma imagem png, apenas texto longo o suficiente para passar do mínimo de bytes ok').toString('base64') }, /inválida/i],
      ['PNG grande', { signature_png_base64: big.toString('base64') }, /tamanho/i],
      ['base64 inválido', { signature_png_base64: '***não-é-base64***' }],
      ['base64 com comprimento torto', { signature_png_base64: strokePng().toString('base64').replace(/=+$/, '').slice(0, -1) + 'AA' + 'A' }],
      ['sem aceite', { accepted: false }, /aceitar/i],
      ['aceite como texto', { accepted: 'true' }],
      ['termo desatualizado', { term_version: 'rascunho-0' }, /Termo desatualizado: recarregue a página/],
      ['sem imagem', { signature_png_base64: undefined }],
      ['imagem vazia', { signature_png_base64: '' }],
    ];
    for (const [nome, over, msg] of cases) {
      const r = await post('sign', signBody(l, over));
      expect({ nome, status: r.status }).toEqual({ nome, status: 400 });
      noStore(r);
      if (msg) expect(JSON.stringify(r.body.message)).toMatch(msg);
    }
    // nada gravado, nada enviado ao R2, nenhuma tentativa gasta, link intacto
    expect(fakeR2.putCount).toBe(puts);
    expect(sigKeys()).toHaveLength(keysBefore);
    expect((await row(l.id)).attempts).toBe(0);
    await stillUsable(l);
  });

  it('sign: código errado conta tentativa (401) e NÃO envia imagem ao R2', async () => {
    const l = await link('Func Sign Codigo Errado');
    const before = fakeR2.putCount;
    const wrong = l.code === '000000' ? '111111' : '000000';
    const r = await post('sign', signBody(l, { code: wrong }));
    expect(r.status).toBe(401);
    expect(r.body.attempts_left).toBe(4);
    noStore(r);
    expect(fakeR2.putCount).toBe(before);
    expect((await row(l.id)).attempts).toBe(1);
    expect(await evidenceCount(l.id)).toBe(0);
    // token de um link com código de OUTRO link também falha
    const other = await link('Func Sign Outro Link');
    const cross = await post('sign', signBody(l, { code: other.code === l.code ? wrong : other.code }));
    expect(cross.status).toBe(401);
    expect(fakeR2.putCount).toBe(before);
    expect((await deliveryOf(l.delivery)).signature_status).toBe('pendente');
  });

  it('sign duas vezes com o mesmo link -> segunda é 404 uniforme; 6 assinaturas simultâneas -> exatamente 1 vence e o R2 não fica com imagem órfã das perdedoras', async () => {
    const l = await link('Func Sign Duas Vezes');
    expect((await post('sign', signBody(l))).status).toBe(201);
    const second = await post('sign', signBody(l));
    expect(second.status).toBe(404);
    expect(second.body.message).toBe(INVALID);
    expect(await evidenceCount(l.id)).toBe(1);

    const c = await link('Func Sign Corrida');
    const keysBefore = sigKeys().length;
    const puts = fakeR2.putCount, dels = fakeR2.deleteCount;
    fakeR2.putDelayMs = 300; // garante que as 6 passem por epi_sig_open antes de qualquer epi_sig_sign
    let rs;
    try {
      rs = await Promise.all(Array.from({ length: 6 }, () => post('sign', signBody(c))));
    } finally {
      fakeR2.putDelayMs = 0;
    }
    const statuses = rs.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 404, 404, 404, 404, 404]);
    expect(rs.filter((r) => r.status === 404).every((r) => r.body.message === INVALID)).toBe(true);
    expect(await evidenceCount(c.id)).toBe(1);
    expect(fakeR2.putCount - puts).toBe(6); // todas enviaram a imagem...
    expect(fakeR2.deleteCount - dels).toBe(5); // ...e as 5 perdedoras removeram a sua
    expect(sigKeys()).toHaveLength(keysBefore + 1); // só a imagem da vencedora ficou no R2
    const ev = (await sql.query('SELECT signature_file_key FROM epi_signatures WHERE request_id = $1', [c.id])).rows[0];
    expect(fakeR2.store.has(ev.signature_file_key)).toBe(true);
  });

  it('refuse: entregas viram recusada, link encerrado, motivo guardado; recusa com NUL/ >300 -> 400', async () => {
    const l = await link('Func Refuse');
    const puts = fakeR2.putCount;
    const bad = [{ reason: 'a\u0000b' }, { reason: 'x'.repeat(301) }, { reason: 123 }, { reason: ['a'] }];
    for (const b of bad) {
      const r = await post('refuse', { token: l.token, code: l.code, ...b });
      expect(r.status).toBe(400);
      noStore(r);
    }
    await stillUsable(l);
    const wrong = l.code === '000000' ? '111111' : '000000';
    const w = await post('refuse', { token: l.token, code: wrong, reason: 'tentativa' });
    expect(w.status).toBe(401);
    expect(w.body.message).toBe('Código incorreto');
    // epi_sig_refuse só devolve `result` (sem attempts_left): a tentativa é contada no banco, mas o corpo não traz o saldo
    expect((await row(l.id)).attempts).toBe(1);
    expect((await row(l.id)).status).toBe('ativa'); // código errado não recusa
    expect((await deliveryOf(l.delivery)).signature_status).toBe('pendente');

    const r = await post('refuse', { token: l.token, code: l.code, reason: 'Não recebi estes itens' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'recusada' });
    noStore(r);
    expect(await row(l.id)).toMatchObject({ status: 'recusada', refusal_reason: 'Não recebi estes itens' });
    expect((await deliveryOf(l.delivery)).signature_status).toBe('recusada');
    expect(await evidenceCount(l.id)).toBe(0);
    expect(fakeR2.putCount).toBe(puts); // recusa nunca toca o R2
    // link encerrado: abrir, assinar e recusar de novo -> 404 uniforme
    for (const route of ['open', 'sign', 'refuse']) {
      const x = await post(route, route === 'sign' ? signBody(l) : { token: l.token, code: l.code });
      expect(x.status).toBe(404);
      expect(x.body.message).toBe(INVALID);
    }
    // sem motivo também vale
    const l2 = await link('Func Refuse Sem Motivo');
    const r2 = await post('refuse', { token: l2.token, code: l2.code });
    expect(r2.status).toBe(200);
    expect((await row(l2.id)).refusal_reason).toBeNull();
    // motivo no limite (300) é aceito
    const l3 = await link('Func Refuse Limite');
    expect((await post('refuse', { token: l3.token, code: l3.code, reason: 'y'.repeat(300) })).status).toBe(200);
  });

  it('R2 indisponível no sign -> 502 e o link continua utilizável', async () => {
    const l = await link('Func Sign R2 Falha');
    const keysBefore = sigKeys().length;
    fakeR2.failNextPut = true;
    const r = await post('sign', signBody(l));
    expect(r.status).toBe(502);
    noStore(r);
    expect(sigKeys()).toHaveLength(keysBefore);
    expect((await row(l.id)).attempts).toBe(0); // a tentativa com código certo não é gasta
    await stillUsable(l);
    // mesmo link, R2 de volta: assina normalmente
    expect((await post('sign', signBody(l))).status).toBe(201);
    expect(await evidenceCount(l.id)).toBe(1);

    // R2 pendurado: responde 502 dentro do prazo (EPI_FICHA_R2_TIMEOUT_MS) e o link continua utilizável
    const h = await link('Func Sign R2 Pendurado');
    process.env.EPI_FICHA_R2_TIMEOUT_MS = '300';
    fakeR2.hangNextPut = true;
    try {
      const t0 = Date.now();
      const rh = await post('sign', signBody(h));
      expect(rh.status).toBe(502);
      expect(Date.now() - t0).toBeLessThan(3000);
    } finally {
      delete process.env.EPI_FICHA_R2_TIMEOUT_MS;
      fakeR2.hangNextPut = false;
    }
    await stillUsable(h);
  });

  it('termo rascunho com a variável desligada -> sign devolve 409 e nada é gravado', async () => {
    const l = await link('Func Sign Termo Rascunho');
    const puts = fakeR2.putCount;
    process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'false';
    (EPI_TERM as any).draft = true; // simula um termo ainda em rascunho (o vigente é aprovado)
    try {
      const r = await post('sign', signBody(l));
      expect(r.status).toBe(409);
      noStore(r);
      expect(fakeR2.putCount).toBe(puts);
      expect((await row(l.id)).attempts).toBe(0);
      expect(await evidenceCount(l.id)).toBe(0);
    } finally {
      (EPI_TERM as any).draft = false;
      process.env.EPI_SIGNATURE_ALLOW_DRAFT_TERM = 'true';
    }
    await stillUsable(l);
    expect((await post('sign', signBody(l))).status).toBe(201); // liberada a variável, assina
  });

  describe('rate limit por IP e por rota (@RateLimit explícito: não usa RATE_LIMIT_MAX)', () => {
    // O guard conta por `ratelimit:<Controller.handler>:<req.ip>` e req.ip vem do X-Forwarded-For (trust proxy = 1):
    // cada teste usa um IP próprio (nextIp), então os contadores nunca se cruzam; o afterAll apaga as chaves deste arquivo.
    it('os limites escolhidos estão fixados nos metadados das rotas (open/sign/refuse 120 por 10 min; peek 200 por 10 min; por IP)', () => {
      const meta = (h: string) => Reflect.getMetadata(RATE_LIMIT_KEY, (EpiSignaturePublicController.prototype as any)[h]);
      expect(meta('peek')).toEqual({ limit: 200, windowSeconds: 600, keyBy: 'ip' });
      for (const h of ['open', 'sign', 'refuse']) expect(meta(h)).toEqual({ limit: 120, windowSeconds: 600, keyBy: 'ip' });
    });

    it('acima do limite por IP a rota devolve 429 (open: 121ª; peek: 201ª), com no-store; outra rota e outro IP não são afetados', async () => {
      const ip = nextIp();
      const body = { token: 'r'.repeat(43), code: '123456' };
      for (let i = 0; i < 120; i++) {
        const r = await post('open', body, ip);
        expect(r.status).toBe(404); // dentro do limite (link inexistente)
      }
      const blocked = await post('open', body, ip);
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBeDefined();
      noStore(blocked);
      // mesmo IP em outra rota (contador isolado por rota) e outro IP na mesma rota continuam livres
      expect((await post('peek', { token: body.token }, ip)).status).toBe(200);
      expect((await post('open', body, nextIp())).status).toBe(404);
      // 429 também para entrada inválida (o guard roda antes da validação)
      expect((await post('open', { token: 'curto', code: 'x' }, ip)).status).toBe(429);

      const ip2 = nextIp();
      for (let i = 0; i < 200; i++) expect((await post('peek', { token: body.token }, ip2)).status).toBe(200);
      const p61 = await post('peek', { token: body.token }, ip2);
      expect(p61.status).toBe(429);
      noStore(p61);
    });
  });

  describe('pilha do Express, CORS e login', () => {
    it('após app.init há exatamente UMA camada jsonParser (a do Nest) e o prefixo público vem antes dela', () => {
      const stack: any[] = (app.getHttpAdapter().getInstance() as any)._router.stack;
      const jsonIdx = stack.map((l, i) => (l.name === 'jsonParser' ? i : -1)).filter((i) => i >= 0);
      expect(jsonIdx).toHaveLength(1);
      const pubIdx = stack.map((l, i) => (!l.route && l.regexp?.test('/epi-signatures/public/sign') && !l.regexp.test('/auth/login') && l.name !== 'jsonParser' && i < jsonIdx[0] ? i : -1)).filter((i) => i >= 0);
      expect(pubIdx.length).toBeGreaterThanOrEqual(2); // no-store e parser público
      expect(Math.max(...pubIdx)).toBeLessThan(jsonIdx[0]);
    });

    it('login (rota comum) segue aceitando JSON normal; só o caminho público tem limite maior', async () => {
      const r = await request(srv).post('/auth/login').send({ email: 'ninguem@teste.montese.local', password: 'senha-errada-123' });
      expect(r.status).toBe(401); // o corpo foi lido e validado (não 400 por corpo vazio)
    });

    it('preflight (OPTIONS) e origem não permitida também saem com no-store', async () => {
      const pre = await request(srv).options('/epi-signatures/public/sign').set('Origin', 'https://montesesst.com.br')
        .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type');
      expect(pre.status).toBeLessThan(300);
      noStore(pre);
      const denied = await request(srv).post('/epi-signatures/public/peek').set('Origin', 'https://evil.example').set('X-Forwarded-For', nextIp()).send({ token: 'x'.repeat(43) });
      expect(denied.status).toBeGreaterThanOrEqual(400);
      noStore(denied);
    });

    it('PNG com byte de filtro inválido (7) -> 400, nada vai ao R2 nem gasta o link; filtros 1-4 válidos são aceitos', async () => {
      const l = await link('Func Filtro Invalido');
      const px = (x: number, y: number): [number, number, number, number] => (Math.abs(y - 50 - Math.round(20 * Math.sin(x / 15))) <= 2 ? [0, 0, 0, 255] : [0, 0, 0, 0]);
      const puts = fakeR2.putCount;
      const r = await post('sign', signBody(l, { signature_png_base64: makeFilteredPng(300, 100, px, 7).toString('base64') }));
      expect(r.status).toBe(400);
      expect(fakeR2.putCount).toBe(puts);
      await stillUsable(l);
      const ok = await post('sign', signBody(l, { signature_png_base64: makeFilteredPng(300, 100, px, (y) => 1 + (y % 4)).toString('base64') }));
      expect(ok.status).toBe(201);
    });
  });

  describe('limite de corpo', () => {
    it('uma rota qualquer do sistema continua rejeitando corpo acima do limite global (100 KB)', async () => {
      // Comportamento do parser padrão do Nest (pré-existente): acima de 100 KB o corpo é recusado. O status HOJE é 500 (o
      // AllExceptionsFilter global não reconhece o erro do body-parser); o que se prova aqui é que o limite global não subiu.
      const under = await request(srv).post('/auth/login').send({ email: 'a@b.com', password: 'x'.repeat(80_000) });
      expect([400, 401]).toContain(under.status); // 80 KB passa pelo parser (a validação/regra de negócio responde, não o limite)
      const over = await request(srv).post('/auth/login').send({ email: 'a@b.com', password: 'x'.repeat(150_000) });
      expect([413, 500]).toContain(over.status);
      // rota autenticada do próprio módulo (mesmo prefixo /epi-signatures, fora de /public): também recusa
      const other = await request(srv).post('/epi-signatures/requests').set(auth()).send({ employee_id: randomUUID(), idempotency_key: 'x'.repeat(150_000) });
      expect([413, 500]).toContain(other.status);
      const mid = await request(srv).post('/epi-signatures/requests').set(auth()).send({ employee_id: randomUUID(), idempotency_key: 'x'.repeat(80_000) });
      expect(mid.status).toBe(400); // 80 KB passa pelo parser e cai na validação do DTO
      // a rota pública, ao contrário, lê até 300 KB: 150 KB chega à validação (400), não é recusada pelo parser
      const pub = await post('peek', { token: 'x'.repeat(43), junk: 'j'.repeat(150_000) });
      expect(pub.status).toBe(400);
    });

    it('sign aceita o PNG máximo válido (~200 KB) e rejeita corpo acima do limite com 413 (nunca 500)', async () => {
      const l = await link('Func Corpo Grande');
      const big = noisePng(224, 225);
      expect(big.length).toBeGreaterThan(195 * 1024);
      expect(big.length).toBeLessThanOrEqual(200 * 1024);
      const b64 = big.toString('base64');
      expect(JSON.stringify(signBody(l, { signature_png_base64: b64 })).length).toBeGreaterThan(100 * 1024); // acima do limite global
      const ok = await post('sign', signBody(l, { signature_png_base64: b64 }));
      expect(ok.status).toBe(201);
      const ev = (await sql.query('SELECT signature_file_key, signature_sha256 FROM epi_signatures WHERE request_id = $1', [l.id])).rows[0];
      expect(decodeUnfilteredPixels(fakeR2.store.get(ev.signature_file_key)!).px.equals(decodeUnfilteredPixels(big).px)).toBe(true);
      expect(ev.signature_sha256).toBe(sha256Hex(fakeR2.store.get(ev.signature_file_key)!));

      const l2 = await link('Func Corpo Gigante');
      const puts = fakeR2.putCount;
      const huge = await post('sign', signBody(l2, { signature_png_base64: 'A'.repeat(320_000) }));
      expect(huge.status).toBe(413);
      noStore(huge);
      expect(huge.body.message).toBe('Corpo da requisição grande demais');
      const enormous = await post('sign', signBody(l2, { signature_png_base64: 'A'.repeat(2_000_000) }));
      expect(enormous.status).toBe(413);
      // dentro do corpo permitido, mas acima do máximo de caracteres do campo: 400 pelo DTO, antes de decodificar
      const long = await post('sign', signBody(l2, { signature_png_base64: 'A'.repeat(305_000) }));
      expect(long.status).toBe(400);
      expect(fakeR2.putCount).toBe(puts);
      await stillUsable(l2);
    });
  });

  it('entrada inválida -> 400 (nunca 500): token fora do formato, code que não seja 6 dígitos, corpo extra, JSON ruim, tipo de conteúdo errado', async () => {
    const l = await link('Func Entrada Invalida');
    const goodTok = l.token;
    const tokens: unknown[] = ['', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}+`, `${'a'.repeat(42)}/`, `${'a'.repeat(42)}=`, ` ${'a'.repeat(42)}`, 12345, null, ['a'.repeat(43)], { x: 1 }, `${'a'.repeat(42)}\n`];
    for (const t of tokens) {
      for (const route of ['peek', 'open', 'refuse']) {
        const r = await post(route, { token: t, code: '123456' });
        expect({ route, t, status: r.status }).toEqual({ route, t, status: 400 });
        noStore(r);
      }
    }
    const codes: unknown[] = ['', '12345', '1234567', 'abcdef', '12345a', ' 12345', '１２３４５６', 123456, null, ['123456'], '123456\n'];
    for (const c of codes) {
      for (const route of ['open', 'refuse']) {
        const r = await post(route, { token: goodTok, code: c });
        expect({ route, c, status: r.status }).toEqual({ route, c, status: 400 });
      }
      expect((await post('sign', signBody(l, { code: c }))).status).toBe(400);
    }
    // campo extra / ausente / corpo vazio
    expect((await post('peek', { token: goodTok, extra: 1 })).status).toBe(400);
    expect((await post('open', { token: goodTok, code: l.code, extra: 1 })).status).toBe(400);
    expect((await post('open', { token: goodTok })).status).toBe(400);
    expect((await post('open', { code: l.code })).status).toBe(400);
    expect((await post('sign', signBody(l, { tenant_id: tenantId }))).status).toBe(400);
    expect((await post('refuse', { token: goodTok, code: l.code, tenant_id: tenantId })).status).toBe(400);
    expect((await post('peek', {})).status).toBe(400);
    expect((await request(srv).post('/epi-signatures/public/peek').set('X-Forwarded-For', nextIp())).status).toBe(400);
    // token na URL é ignorado: nada decide por query/params
    const q = await request(srv).post(`/epi-signatures/public/peek?token=${goodTok}`).set('X-Forwarded-For', nextIp()).send({});
    expect(q.status).toBe(400);
    // JSON malformado e outros tipos de conteúdo
    const bad = await request(srv).post('/epi-signatures/public/peek').set('X-Forwarded-For', nextIp()).set('Content-Type', 'application/json').send('{"token": ');
    expect(bad.status).toBe(400);
    noStore(bad);
    expect(JSON.stringify(bad.body)).not.toMatch(/at |node_modules|<html/i); // sem stack nem HTML
    const txt = await request(srv).post('/epi-signatures/public/peek').set('X-Forwarded-For', nextIp()).set('Content-Type', 'text/plain').send(goodTok);
    expect(txt.status).toBe(400);
    const arr = await request(srv).post('/epi-signatures/public/peek').set('X-Forwarded-For', nextIp()).send([{ token: goodTok }]);
    expect(arr.status).toBe(400);
    // o link continua intacto e nenhuma tentativa foi gasta
    expect((await row(l.id)).attempts).toBe(0);
    await stillUsable(l);
    // GET não existe nessas rotas: o token nunca trafega pela URL
    expect((await request(srv).get(`/epi-signatures/public/${goodTok}`).set('X-Forwarded-For', nextIp())).status).toBe(404);
    expect((await request(srv).get('/epi-signatures/public/peek').set('X-Forwarded-For', nextIp())).status).toBe(404);
  });

  it('nenhuma resposta ou log contém o token, o código, o base64 da imagem ou CPF (fluxos feliz e de erro)', async () => {
    const captured: string[] = [];
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    const spy = (orig: typeof origOut) => ((chunk: any, ...rest: any[]) => { captured.push(String(chunk)); return (orig as any)(chunk, ...rest); }) as typeof origOut;

    const happy = await link('Func Log Feliz');
    const refused = await link('Func Log Recusa');
    const failing = await link('Func Log R2');
    const wrongL = await link('Func Log Errado');
    // código com valor distintivo (evita falso positivo de 6 dígitos em ids/duração nos logs)
    const PIN = '907351';
    const links = [happy, refused, failing, wrongL];
    // pin_hash é imutável por trigger: só o superusuário do ensaio, desligando o trigger só durante o ajuste da fixture
    await sql.query('ALTER TABLE epi_signature_requests DISABLE TRIGGER trg_epi_signature_requests_guard');
    try {
      for (const l of links) {
        await sql.query('UPDATE epi_signature_requests SET pin_hash = $1 WHERE id = $2', [hashPin(l.token, PIN), l.id]);
        l.code = PIN;
      }
    } finally {
      await sql.query('ALTER TABLE epi_signature_requests ENABLE TRIGGER trg_epi_signature_requests_guard');
    }
    const png = strokePng();
    const b64 = png.toString('base64');
    const snippets = [b64, b64.slice(120, 220), b64.slice(-60, -8)];
    const secrets = [...links.flatMap((l) => [l.token, l.code, l.cpf, `${l.cpf.slice(0, 3)}.${l.cpf.slice(3, 6)}.${l.cpf.slice(6, 9)}-${l.cpf.slice(9)}`]), ...snippets];
    const responses: string[] = [];
    const keep = <T extends { text: string }>(r: T): T => { responses.push(r.text); return r; };

    process.stdout.write = spy(origOut);
    process.stderr.write = spy(origErr);
    try {
      new (require('@nestjs/common').Logger)('ControleLog').error('SENTINELA-CAPTURA'); // controle positivo: a captura enxerga o Logger
      // feliz: peek, open, sign
      keep(await post('peek', { token: happy.token }));
      keep(await post('open', { token: happy.token, code: PIN }));
      expect(keep(await post('sign', signBody(happy, { signature_png_base64: b64 }))).status).toBe(201);
      // erro: código errado, link usado, inexistente, entrada inválida, corpo gigante, termo velho, imagem em branco
      keep(await post('open', { token: wrongL.token, code: '000001' }));
      keep(await post('sign', signBody(wrongL, { code: '000002' })));
      keep(await post('sign', signBody(happy, { signature_png_base64: b64 })));
      keep(await post('open', { token: 'q'.repeat(43), code: PIN }));
      keep(await post('open', { token: wrongL.token, code: 'abc' }));
      keep(await post('sign', signBody(wrongL, { term_version: 'velho' })));
      keep(await post('sign', signBody(wrongL, { signature_png_base64: blankPng().toString('base64') })));
      keep(await post('sign', signBody(wrongL, { signature_png_base64: 'A'.repeat(400_000) })));
      keep(await request(srv).post('/epi-signatures/public/sign').set('X-Forwarded-For', nextIp()).set('Content-Type', 'application/json').send(`{"token":"${wrongL.token}","code":"${PIN}",`));
      // R2 falhando (log de erro do serviço) e recusa
      fakeR2.failNextPut = true;
      expect(keep(await post('sign', signBody(failing, { signature_png_base64: b64 }))).status).toBe(502);
      expect(keep(await post('refuse', { token: refused.token, code: PIN, reason: 'motivo qualquer' })).status).toBe(200);
      keep(await post('refuse', { token: refused.token, code: PIN }));
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
    const logs = captured.join('');
    expect(logs).toContain('SENTINELA-CAPTURA');
    expect(logs).toContain('/epi-signatures/public/'); // as requisições foram de fato logadas (path, sem corpo)
    for (const s of secrets) {
      expect(logs.includes(s)).toBe(false);
      for (const resp of responses) expect(resp.includes(s)).toBe(false);
    }
    // trilha de auditoria (audit_log) das rotas públicas: nenhum segredo no caminho nem no detalhe
    const audit = (await sql.query(`SELECT to_jsonb(a)::text AS t FROM audit_log a WHERE a.path LIKE '/epi-signatures/public/%' LIMIT 500`)).rows.map((r) => r.t).join('');
    expect(audit.length).toBeGreaterThan(0);
    for (const s of secrets) expect(audit.includes(s)).toBe(false);
  });

  it('sign: token inexistente com PNG pesado -> 404 rápido SEM validar o PNG; token válido + PNG inválido -> 400 sem gastar tentativa', async () => {
    const spy = jest.spyOn(pngUtil, 'validateSignaturePng');
    try {
      const heavy = noisePng(300, 100).toString('base64');
      const fake = { token: 'A'.repeat(43), code: '123456', accepted: true, term_version: EPI_TERM.version, signature_png_base64: heavy };
      const t0 = Date.now();
      const r = await post('sign', fake);
      expect(r.status).toBe(404);
      expect(r.body.message).toBe(INVALID);
      expect(Date.now() - t0).toBeLessThan(2000);
      expect(spy).not.toHaveBeenCalled();
      // link revogado/usado: idem (nenhum custo de CPU para quem não tem um link utilizável)
      const rev = await link('Func Sign Revogado');
      await request(srv).post(`/epi-signatures/requests/${rev.id}/revoke`).set(auth()).send();
      const r2 = await post('sign', signBody(rev, { signature_png_base64: heavy }));
      expect(r2.status).toBe(404);
      expect(spy).not.toHaveBeenCalled();
      // token válido + PNG inválido: o PNG é validado (400) e nenhuma tentativa é gasta
      const l = await link('Func Sign Png Invalido');
      const bad = await post('sign', signBody(l, { signature_png_base64: blankPng().toString('base64') }));
      expect(bad.status).toBe(400);
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await row(l.id)).attempts).toBe(0);
      await stillUsable(l);
    } finally {
      spy.mockRestore();
    }
  });

  it('hash do texto do termo diferente do vigente -> open e sign respondem 404 uniforme (sem gastar assinatura)', async () => {
    const l = await link('Func Termo Hash');
    const stale = 'e'.repeat(64);
    expect(stale).not.toBe(termTextSha256());
    await sql.query('ALTER TABLE epi_signature_requests DISABLE TRIGGER trg_epi_signature_requests_guard');
    try {
      await sql.query('UPDATE epi_signature_requests SET term_text_sha256 = $1 WHERE id = $2', [stale, l.id]);
    } finally {
      await sql.query('ALTER TABLE epi_signature_requests ENABLE TRIGGER trg_epi_signature_requests_guard');
    }
    const o = await post('open', { token: l.token, code: l.code });
    expect(o.status).toBe(404);
    expect(o.body.message).toBe(INVALID);
    const put0 = fakeR2.putCount;
    const sg = await post('sign', signBody(l));
    expect(sg.status).toBe(404);
    expect(await evidenceCount(l.id)).toBe(0);
    expect((await deliveryOf(l.delivery)).signature_status).toBe('pendente');
    expect(fakeR2.putCount).toBe(put0); // nada foi enviado ao R2
  });
});
