import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import Redis from 'ioredis';
import JSZip from 'jszip';
import { docParseSnapshot } from '../src/employees/employee-document-text';
import { EmployeeIngestionService } from '../src/employees/employee-ingestion.service';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { R2Service } from '../src/common/r2/r2.service';
import { EMPLOYEE_EXTRACTION_PROVIDER } from '../src/employees/employee-extraction-provider.interface';
import { TestDb } from './db-test-helper';

// Leitura de PDF/DOCX no cadastro de funcionários (Fatia 4, Task 4). Dados 100% sintéticos; o provedor de IA é FALSO
// (nenhuma chamada ao MiniMax, nenhuma chave); o R2 é mockado.
const UPLOAD_RATE_LIMIT_KEY = 'ratelimit:EmployeesController.uploadDocument:::ffff:127.0.0.1';
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('Funcionários: ingestão de PDF/DOCX (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let tokenA: string;
  let tokenB: string;
  let tecnicoToken: string;
  let tenantAId: string;
  let tenantBId: string;

  // Provedor falso, controlável por teste.
  const provider = { extract: jest.fn() };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (email: string, password: string) =>
    (await request(app.getHttpServer()).post('/auth/login').send({ email, password })).body.access_token as string;
  const sql = (text: string, params: unknown[] = []) => (db as any).client.query(text, params);

  const ENV_KEYS = ['EMPLOYEE_INGESTION_AI_ENABLED', 'EMPLOYEE_INGESTION_AI_DAILY_LIMIT', 'EMPLOYEE_DOC_PARSE_TENANT_CONCURRENCY', 'EMPLOYEE_DOC_PARSE_TENANT_QUEUE_MAX'];
  const savedEnv: Record<string, string | undefined> = {};
  const aiOn = (limit = '1000') => {
    process.env.EMPLOYEE_INGESTION_AI_ENABLED = 'true';
    process.env.EMPLOYEE_INGESTION_AI_DAILY_LIMIT = limit;
  };

  beforeAll(async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2Service)
      .useValue({ putObject: jest.fn(), deleteObject: jest.fn(), getObject: jest.fn() })
      .overrideProvider(EMPLOYEE_EXTRACTION_PROVIDER)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    const a = await db.createTenantWithUser('Empresa Texto A');
    const b = await db.createTenantWithUser('Empresa Texto B');
    tenantAId = a.tenantId;
    tenantBId = b.tenantId;
    tokenA = await login(a.email, a.password);
    tokenB = await login(b.email, b.password);
    const tec = await db.createUserWithRole('tecnico', 'Tecnico Texto');
    tecnicoToken = await login(tec.email, tec.password);
    redis = new Redis(process.env.REDIS_URL as string);
  });

  beforeEach(async () => {
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    provider.extract.mockReset();
    provider.extract.mockImplementation(async () => {
      throw new Error('provedor não deveria ser chamado neste teste');
    });
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  afterAll(async () => {
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    redis.disconnect();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  // ---- Fixtures sintéticas ----
  let cpfSeq = 1000;
  const nextCpf = (): { raw: string; fmt: string } => {
    const b = String(100000000 + cpfSeq++ * 7919 + 13).slice(0, 9).split('').map(Number);
    const dv = (d: number[]) => { const s = d.reduce((acc, v, i) => acc + v * (d.length + 1 - i), 0); const r = (s * 10) % 11; return r >= 10 ? 0 : r; };
    const d1 = dv(b);
    const d2 = dv([...b, d1]);
    const s = [...b, d1, d2].join('');
    return { raw: s, fmt: `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}` };
  };
  const pdf = (lines: string[], draw?: (d: any) => void): Promise<Buffer> =>
    new Promise((resolve) => {
      const d = new PDFDocument({ size: 'A4', margin: 30 });
      const chunks: Buffer[] = [];
      d.on('data', (c: Buffer) => chunks.push(c));
      d.on('end', () => resolve(Buffer.concat(chunks)));
      d.fontSize(12);
      for (const l of lines) d.text(l);
      if (draw) draw(d);
      d.end();
    });
  const P = (t: string) => new Paragraph({ children: [new TextRun(t)] });
  const docxBuf = async (children: (Paragraph | Table)[]) => Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children }] })));
  const cell = (t: string) => new TableCell({ children: [P(t)] });
  const row = (cells: string[]) => new TableRow({ children: cells.map(cell) });
  type Pessoa = { name: string; cpf: { raw: string; fmt: string }; pos?: string; adm?: string };
  const ficha = (ps: Pessoa[]) => ps.flatMap((p) => [`Nome: ${p.name}`, `CPF: ${p.cpf.fmt}`, `Função: ${p.pos}`, `Admissão: ${p.adm}`]);
  const lista = (ps: Pessoa[], filler = 0) => [
    'Lista de funcionarios FICTICIA',
    ...ps.flatMap((p, i) => [
      `${p.name} ${p.cpf.fmt} ${p.pos} Admissão | ${p.adm}`,
      ...(i === 0 ? Array.from({ length: filler }, (_v, k) => `Texto de preenchimento ZZLONGEZZ${k}X sem relacao com ninguem e sem numeros.`) : []),
    ]),
  ];

  const send = (token: string, buf: Buffer, mime = PDF, name = 'cadastro.pdf') =>
    request(app.getHttpServer()).post('/employees/documents').set(auth(token)).attach('file', buf, { filename: name, contentType: mime });
  const createEmp = async (token: string, body: Record<string, unknown>) => {
    const res = await request(app.getHttpServer()).post('/employees').set(auth(token)).send(body);
    expect(res.status).toBe(201);
    return res.body as { id: string };
  };
  const empCount = async (tenant: string) => Number((await sql('SELECT count(*) AS n FROM employees WHERE tenant_id = $1', [tenant])).rows[0].n);
  const docCount = async (tenant: string) => Number((await sql('SELECT count(*) AS n FROM documents WHERE tenant_id = $1', [tenant])).rows[0].n);
  const empRow = async (id: string) =>
    (await sql(`SELECT full_name, position, sex, activity_description, to_char(admission_date,'YYYY-MM-DD') AS admission_date, to_char(birth_date,'YYYY-MM-DD') AS birth_date FROM employees WHERE id = $1`, [id])).rows[0];
  const extractionRow = async (id: string) =>
    (await sql('SELECT status, summary, candidates, candidates::text AS ctext FROM employee_document_extractions WHERE id = $1', [id])).rows[0];
  const resolve = (token: string, id: string, decisions: unknown) =>
    request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth(token)).send({ decisions });
  const item = (body: any, kind: string, name?: string) => body.items.find((i: any) => i.kind === kind && (!name || i.full_name === name));

  // ---- Provedor falso: devolve valores com o trecho literal da linha do marcador ----
  const lineWith = (text: string, ref: string) => text.split('\n').find((l) => l.includes(`[${ref}]`)) as string;
  const aiReply = (text: string, spec: Record<string, Record<string, string>>) =>
    Object.entries(spec).map(([ref, fields]) => ({ cpf_ref: ref, evidence: lineWith(text, ref), ...fields }));
  const NUM_RUN = /\d(?:[^\p{L}\p{N}]{0,8}\d){8,}/u;

  // ---------------------------------------------------------------------------------------------
  it('1) PDF de ficha com IA desligada: nada auto-aplicado, method=texto, provedor não chamado; existente -> sugestao, novo -> novo', async () => {
    const ana: Pessoa = { name: 'ANA FICTICIA', cpf: nextCpf(), pos: 'SOLDADORA', adm: '05/01/2020' };
    const bruno: Pessoa = { name: 'BRUNO FICTICIO', cpf: nextCpf(), pos: 'ELETRICISTA', adm: '18/06/2018' };
    const emp = await createEmp(tokenA, { full_name: ana.name, cpf: ana.cpf.raw });
    const before = await empCount(tenantAId);
    const res = await send(tokenA, await pdf(ficha([ana, bruno])));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('requer_revisao');
    expect(res.body.summary).toMatchObject({ method: 'texto', ai_used: false, applied: 0, novo: 1 });
    expect(provider.extract).not.toHaveBeenCalled();
    const sug = item(res.body, 'sugestao', 'ANA FICTICIA');
    expect(sug.suggestions.map((s: any) => s.field).sort()).toEqual(['admission_date', 'position']);
    expect(sug.cpf_masked).toBe(`***.***.***-${ana.cpf.raw.slice(-2)}`);
    const novo = item(res.body, 'novo', 'BRUNO FICTICIO');
    expect(typeof novo.evidence).toBe('string');
    expect(novo.evidence.length).toBeLessThanOrEqual(200);
    const body = JSON.stringify(res.body);
    for (const c of [ana.cpf, bruno.cpf]) { expect(body).not.toContain(c.raw); expect(body).not.toContain(c.fmt); }
    expect(body).not.toContain('"values"');
    // Nada mudou no cadastro.
    expect(await empCount(tenantAId)).toBe(before);
    expect(await empRow(emp.id)).toMatchObject({ position: null, admission_date: null });
    expect((await sql(`SELECT count(*) AS n FROM employee_field_history WHERE employee_id = $1 AND source = 'documento'`, [emp.id])).rows[0].n).toBe('0');
    const get = await request(app.getHttpServer()).get(`/employees/extractions/${res.body.id}`).set(auth(tokenA));
    expect(JSON.stringify(get.body)).not.toContain(ana.cpf.raw);
  });

  it('2) DOCX de tabela com 3 pessoas (lido pelo mammoth): existente com campo vazio -> sugestao; as outras -> novo', async () => {
    const ps: Pessoa[] = [0, 1, 2].map((i) => ({ name: ['DAVI FICTICIO', 'ELISA FICTICIA', 'FABIO FICTICIO'][i], cpf: nextCpf(), pos: ['PINTOR', 'TORNEIRA', 'AUXILIAR'][i] }));
    const emp = await createEmp(tokenA, { full_name: ps[0].name, cpf: ps[0].cpf.raw });
    const t = new Table({ rows: [row(['Nome', 'CPF', 'Função']), ...ps.map((p) => row([p.name, p.cpf.fmt, p.pos as string]))] });
    const res = await send(tokenA, await docxBuf([t]), DOCX, 'tabela.docx');
    expect(res.status).toBe(201);
    expect(res.body.summary).toMatchObject({ method: 'texto', ai_used: false, applied: 0, novo: 2 });
    expect(item(res.body, 'sugestao', 'DAVI FICTICIO').suggestions).toEqual([{ field: 'position', proposed: 'PINTOR' }]);
    expect(res.body.items.filter((i: any) => i.kind === 'novo').map((i: any) => i.full_name).sort()).toEqual(['ELISA FICTICIA', 'FABIO FICTICIO']);
    expect((await empRow(emp.id)).position).toBeNull();
    expect(provider.extract).not.toHaveBeenCalled();
  });

  it('3) IA ligada: texto minimizado (sem CPF, sem trecho fora das janelas), 1 chamada, regex vence, valor fora do trecho descartado, nada sem resolve', async () => {
    aiOn();
    const ana: Pessoa = { name: 'GISELE FICTICIA', cpf: nextCpf(), pos: 'SOLDADORA', adm: '05/01/2020' };
    const bruno: Pessoa = { name: 'HUGO FICTICIO', cpf: nextCpf(), pos: 'ELETRICISTA', adm: '18/06/2018' };
    const carla: Pessoa = { name: 'IARA FICTICIA', cpf: nextCpf(), pos: 'PINTORA', adm: '01/03/2021' };
    const emp = await createEmp(tokenA, { full_name: ana.name, cpf: ana.cpf.raw });
    // Linha "lista": o regex só acha o nome (o separador "|" não é rótulo para ele, mas o verificador da IA aceita); cargo e admissão só a IA pode ler.
    const lines = lista([ana, bruno, carla], 40);
    const hi = lines.findIndex((l) => l.includes(bruno.cpf.fmt));
    lines[hi] = lines[hi].replace(/ Admissão \|.*/, ` Admissão | ${bruno.adm} (consta como HUGO JOSE FICTICIO)`);
    let received = '';
    const opts: any[] = [];
    provider.extract.mockImplementation(async (text: string, o: any) => {
      received = text;
      opts.push(o);
      return aiReply(text, {
        CPF_1: { full_name: ana.name, position: 'SOLDADORA', admission_date: '05/01/2020' },
        CPF_2: { full_name: 'HUGO JOSE FICTICIO', position: 'ELETRICISTA', admission_date: '18/06/2018' }, // nome diverge do regex: descartado
        CPF_3: { position: 'PINTORA', admission_date: '01/03/2022' }, // admissão não está no trecho: descartada
      });
    });
    const res = await send(tokenA, await pdf(lines));
    expect(res.status).toBe(201);
    expect(provider.extract).toHaveBeenCalledTimes(1);
    expect(opts[0].deadlineMs).toBeGreaterThan(0);
    expect(opts[0].deadlineMs).toBeLessThanOrEqual(120000);
    // Minimização: nenhum CPF (nem em dígitos soltos), nada do parágrafo fora das janelas.
    for (const c of [ana.cpf, bruno.cpf, carla.cpf]) { expect(received).not.toContain(c.raw); expect(received).not.toContain(c.fmt); }
    expect(received).not.toMatch(NUM_RUN);
    // O miolo do parágrafo (fora das janelas de ±400 caracteres) não é enviado; as bordas, sim.
    expect(received).not.toContain('ZZLONGEZZ20X');
    expect(received).toContain('[trecho omitido]');
    expect(received).toContain('[CPF_1]');
    expect(res.body.summary).toMatchObject({ method: 'texto+ia', ai_used: true, applied: 0 });
    // Existente (Gisele): sugestões vindas da IA, sem tocar o cadastro.
    const sug = item(res.body, 'sugestao', ana.name);
    expect(sug.suggestions.sort((a: any, b: any) => a.field.localeCompare(b.field))).toEqual([
      { field: 'admission_date', proposed: '2020-01-05' }, { field: 'position', proposed: 'SOLDADORA' },
    ]);
    expect(await empRow(emp.id)).toMatchObject({ position: null, admission_date: null });
    // Hugo (novo): o nome do regex vence; o da IA não entra. Iara: cargo da IA entra, admissão fora do trecho não.
    const cand = (await extractionRow(res.body.id)).candidates as any[];
    const hugo = cand.find((c) => c.kind === 'novo' && c.values.cpf === bruno.cpf.raw);
    expect(hugo.values.full_name).toBe('HUGO FICTICIO');
    expect(hugo.values.position).toBe('ELETRICISTA');
    const iara = cand.find((c) => c.kind === 'novo' && c.values.cpf === carla.cpf.raw);
    expect(iara.values.position).toBe('PINTORA');
    expect(iara.values.admission_date).toBe(undefined);
    expect(JSON.stringify(cand)).not.toContain('2022');
    expect(JSON.stringify(res.body)).not.toContain('HUGO JOSE');
    expect(await empCount(tenantAId)).toBeGreaterThan(0);
    expect((await sql('SELECT count(*) AS n FROM employees WHERE tenant_id = $1 AND cpf = $2', [tenantAId, bruno.cpf.raw])).rows[0].n).toBe('0');
  });

  it('4) IA indisponível, teto diário e flag desligada em runtime: segue só com o regex, com detail estático', async () => {
    // 4a) provedor lança
    aiOn();
    const p1: Pessoa[] = [0, 1].map((i) => ({ name: ['JULIA FICTICIA', 'KAUA FICTICIO'][i], cpf: nextCpf(), pos: 'AJUDANTE', adm: '10/10/2019' }));
    provider.extract.mockImplementation(async () => { throw new Error('boom MiniMax simulado'); });
    const r1 = await send(tokenA, await pdf(lista(p1)));
    expect(r1.status).toBe(201);
    expect(provider.extract).toHaveBeenCalled();
    expect(r1.body.status).toBe('requer_revisao');
    expect(r1.body.summary).toMatchObject({ method: 'texto', ai_used: false, ai_attempted: true, detail: 'Leitura por IA indisponível; o documento foi lido sem IA.' });
    expect(r1.body.summary.novo).toBe(2);
    expect(JSON.stringify(r1.body)).not.toContain('boom');

    // 4b) teto diário excedido: linhas de extração com ai_used / ai_attempted no banco do ensaio
    const capCount = async () =>
      Number((await sql(`SELECT count(*) AS n FROM employee_document_extractions WHERE tenant_id = $1 AND created_at > now() - interval '24 hours' AND ((summary->>'ai_used') = 'true' OR (summary->>'ai_attempted') = 'true')`, [tenantAId])).rows[0].n);
    const n0 = await capCount();
    expect(n0).toBeGreaterThanOrEqual(1); // a tentativa que falhou também conta
    const docId = (await sql('SELECT id FROM documents WHERE tenant_id = $1 LIMIT 1', [tenantAId])).rows[0].id;
    await sql(`INSERT INTO employee_document_extractions (tenant_id, document_id, content_hash, status, summary) VALUES ($1,$2,'cap-1','aplicado','{"ai_used":true}'), ($1,$2,'cap-2','aplicado','{"ai_attempted":true}')`, [tenantAId, docId]);
    try {
      aiOn(String(n0 + 2));
      provider.extract.mockReset();
      provider.extract.mockImplementation(async (t: string) => aiReplyAll(t, { position: 'AJUDANTE' }));
      const p2: Pessoa[] = [0, 1].map((i) => ({ name: ['LARA FICTICIA', 'MARCOS FICTICIO'][i], cpf: nextCpf(), pos: 'AJUDANTE', adm: '10/10/2019' }));
      const r2 = await send(tokenA, await pdf(lista(p2)));
      expect(r2.status).toBe(201);
      expect(provider.extract).not.toHaveBeenCalled();
      expect(r2.body.summary).toMatchObject({ method: 'texto', ai_used: false, detail: 'Limite diário de leituras com IA atingido; o documento foi lido sem IA.' });
      expect(r2.body.summary.novo).toBe(2);
      // Controle: com folga de 1, a IA roda.
      aiOn(String(n0 + 3));
      const p3: Pessoa[] = [0, 1].map((i) => ({ name: ['NEIDE FICTICIA', 'OTAVIO FICTICIO'][i], cpf: nextCpf(), pos: 'AJUDANTE', adm: '10/10/2019' }));
      const r3 = await send(tokenA, await pdf(lista(p3)));
      expect(r3.status).toBe(201);
      expect(provider.extract).toHaveBeenCalledTimes(1);
      expect(r3.body.summary).toMatchObject({ method: 'texto+ia', ai_used: true });
    } finally {
      await sql(`DELETE FROM employee_document_extractions WHERE tenant_id = $1 AND content_hash IN ('cap-1','cap-2')`, [tenantAId]);
    }

    // 4c) flag desligada em runtime (padrão): nem tenta
    delete process.env.EMPLOYEE_INGESTION_AI_ENABLED;
    provider.extract.mockReset();
    const p4: Pessoa[] = [{ name: 'PATRICIA FICTICIA', cpf: nextCpf(), pos: 'AJUDANTE', adm: '10/10/2019' }];
    const r4 = await send(tokenA, await pdf(lista(p4)));
    expect(r4.status).toBe(201);
    expect(provider.extract).not.toHaveBeenCalled();
    expect(r4.body.summary).toMatchObject({ method: 'texto', ai_used: false });
    expect(r4.body.summary.detail).toBeUndefined();
  });

  it('5) documento de saúde (ASO + CPF) vira sem_dados, sem chamar o provedor, nada aplicado', async () => {
    aiOn();
    const p: Pessoa = { name: 'QUITERIO FICTICIO', cpf: nextCpf(), pos: 'AJUDANTE', adm: '10/10/2019' };
    const emp = await createEmp(tokenA, { full_name: p.name, cpf: p.cpf.raw });
    const before = await empCount(tenantAId);
    const res = await send(tokenA, await pdf(['ASO - Atestado de Saúde Ocupacional', ...ficha([p])]));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('sem_dados');
    expect(res.body.summary.detail).toBe('Documento com dados de saúde ocupacional não é lido para o cadastro.');
    expect(res.body.items).toEqual([]);
    expect(provider.extract).not.toHaveBeenCalled();
    expect(await empCount(tenantAId)).toBe(before);
    expect((await empRow(emp.id)).position).toBeNull();
    // Sem nenhuma pessoa com CPF válido: também sem_dados, com texto próprio.
    const none = await send(tokenA, await pdf(['Relatorio de visita FICTICIO', 'Nenhum funcionario citado com documento.']));
    expect(none.body.status).toBe('sem_dados');
    expect(none.body.summary.detail).toBe('Nenhum funcionário identificado no documento.');
    expect(provider.extract).not.toHaveBeenCalled();
  });

  it('6) PDF escaneado -> ilegivel; imagem, .txt, .doc e PDF falso -> 400 sem armazenar nada', async () => {
    aiOn();
    const scan = await send(tokenA, await pdf([], (d) => d.rect(50, 50, 200, 100).fill('#cccccc')), PDF, 'scan.pdf');
    expect(scan.status).toBe(201);
    expect(scan.body.status).toBe('ilegivel');
    expect(scan.body.summary.detail).toBe('Documento sem texto legível (possivelmente escaneado). A leitura de imagens ainda não está disponível.');
    expect(provider.extract).not.toHaveBeenCalled();

    const docs0 = await docCount(tenantAId);
    const png1px = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const jpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
    const img = await send(tokenA, png1px, 'image/png', 'foto.png');
    expect(img.status).toBe(400);
    expect(img.body.message).toBe('Imagens ainda não são lidas para o cadastro. Envie a planilha modelo (.xlsx), um PDF com texto ou um DOCX.');
    expect((await send(tokenA, jpg, 'image/jpeg', 'foto.jpg')).status).toBe(400);
    const txt = await send(tokenA, Buffer.from('Nome: X'), 'text/plain', 'a.txt');
    expect(txt.status).toBe(400);
    for (const f of ['.xlsx', 'PDF', 'DOCX']) expect(txt.body.message).toContain(f);
    expect((await send(tokenA, Buffer.from('doc'), 'application/msword', 'a.doc')).status).toBe(400);
    expect((await send(tokenA, Buffer.from('isto nao e um pdf de verdade'), PDF, 'falso.pdf')).status).toBe(400);
    expect((await send(tokenA, Buffer.from('isto nao e um docx'), DOCX, 'falso.docx')).status).toBe(400);
    expect(await docCount(tenantAId)).toBe(docs0);
    expect(provider.extract).not.toHaveBeenCalled();
    // Tamanho: acima de 10 MB o multer recusa.
    const big = await send(tokenA, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024)]), PDF, 'grande.pdf');
    expect([400, 413]).toContain(big.status);
    expect(await docCount(tenantAId)).toBe(docs0);
    // Papéis: técnico não envia.
    expect((await send(tecnicoToken, await pdf(['x']))).status).toBe(403);
  });

  // ---- 7) resolve ----
  describe('resolve de sugestao e de conflito com suggestions', () => {
    const setup = async (existing: Record<string, unknown>, p: Pessoa) => {
      const emp = await createEmp(tokenA, { full_name: p.name, cpf: p.cpf.raw, ...existing });
      const up = await send(tokenA, await pdf(ficha([p, { name: `${p.name.split(' ')[0]} OUTRO FICTICIO`, cpf: nextCpf(), pos: 'CARGO X', adm: '01/02/2019' }])));
      expect(up.status).toBe(201);
      return { emp, up };
    };

    it('sugestao: aplica só os campos escolhidos (histórico revisao), candidates zerado, técnico 403, tenant B 404', async () => {
      const p: Pessoa = { name: 'RAQUEL FICTICIA', cpf: nextCpf(), pos: 'SOLDADORA', adm: '05/01/2020' };
      const { emp, up } = await setup({}, p);
      const it0 = item(up.body, 'sugestao');
      const outro = item(up.body, 'novo');
      const decisions = (d: unknown) => [{ line: it0.line, ...(d as object) }, { line: outro.line, action: 'ignorar' }];
      expect((await resolve(tecnicoToken, up.body.id, decisions({ action: 'aplicar', fields: ['position'] }))).status).toBe(403);
      expect((await resolve(tokenB, up.body.id, decisions({ action: 'aplicar', fields: ['position'] }))).status).toBe(404);
      // Validações (nada muda).
      expect((await resolve(tokenA, up.body.id, decisions({ action: 'aplicar' }))).status).toBe(400);
      expect((await resolve(tokenA, up.body.id, decisions({ action: 'aplicar', fields: [] }))).status).toBe(400);
      expect((await resolve(tokenA, up.body.id, decisions({ action: 'aplicar', fields: ['birth_date'] }))).status).toBe(400);
      expect((await resolve(tokenA, up.body.id, decisions({ action: 'aplicar', fields: ['position', 'position'] }))).status).toBe(400);
      expect((await extractionRow(up.body.id)).status).toBe('requer_revisao');
      expect((await empRow(emp.id)).position).toBeNull();

      const ok = await resolve(tokenA, up.body.id, decisions({ action: 'aplicar', fields: ['position'] }));
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('aplicado');
      expect(ok.body.summary.resolved).toEqual({ aplicados: 1, ignorados: 1 });
      expect(await empRow(emp.id)).toMatchObject({ position: 'SOLDADORA', admission_date: null });
      expect((await sql(`SELECT field, source FROM employee_field_history WHERE employee_id = $1 AND source = 'revisao'`, [emp.id])).rows).toEqual([{ field: 'position', source: 'revisao' }]);
      const row = await extractionRow(up.body.id);
      for (const s of ['RAQUEL', 'OUTRO', p.cpf.raw, 'CPF:', 'Nome:']) expect(row.ctext).not.toContain(s);
      expect(row.candidates).toEqual([]);
      expect(ok.body.items).toEqual([]);
    });

    it('sugestao: campo que deixou de estar vazio -> 409 estático, nada aplicado, extração segue pendente', async () => {
      const p: Pessoa = { name: 'SABRINA FICTICIA', cpf: nextCpf(), pos: 'SOLDADORA', adm: '05/01/2020' };
      const { emp, up } = await setup({}, p);
      const it0 = item(up.body, 'sugestao');
      const outro = item(up.body, 'novo');
      await sql(`UPDATE employees SET position = 'GERENTE' WHERE id = $1`, [emp.id]);
      const before = await empCount(tenantAId);
      const res = await resolve(tokenA, up.body.id, [{ line: it0.line, action: 'aplicar', fields: ['admission_date', 'position'] }, { line: outro.line, action: 'aplicar' }]);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Os dados do funcionário mudaram desde a análise. Reenvie o documento.');
      expect(JSON.stringify(res.body)).not.toMatch(/GERENTE|SOLDADORA|2020/);
      expect(await empCount(tenantAId)).toBe(before); // atomicidade: o novo não foi criado
      expect(await empRow(emp.id)).toMatchObject({ position: 'GERENTE', admission_date: null });
      expect((await extractionRow(up.body.id)).status).toBe('requer_revisao');
    });

    it('conflito com suggestions: aplica conflito + sugestão escolhidos; 409 se o conflito mudou; fields fora da união 400', async () => {
      const p: Pessoa = { name: 'TEREZA FICTICIA', cpf: nextCpf(), pos: 'SOLDADORA', adm: '05/01/2020' };
      const { emp, up } = await setup({ position: 'GERENTE' }, p);
      const it0 = item(up.body, 'conflito');
      expect(it0.conflicts).toEqual([{ field: 'position', current: 'GERENTE', proposed: 'SOLDADORA' }]);
      expect(it0.suggestions).toEqual([{ field: 'admission_date', proposed: '2020-01-05' }]);
      expect(typeof it0.evidence).toBe('string');
      const outro = item(up.body, 'novo');
      const dec = (fields: string[]) => [{ line: it0.line, action: 'aplicar', fields }, { line: outro.line, action: 'ignorar' }];
      expect((await resolve(tokenA, up.body.id, dec(['sex']))).status).toBe(400);
      // O conflito mudou desde a análise -> 409, nada aplicado (nem a sugestão).
      await sql(`UPDATE employees SET position = 'DIRETOR' WHERE id = $1`, [emp.id]);
      const stale = await resolve(tokenA, up.body.id, dec(['position', 'admission_date']));
      expect(stale.status).toBe(409);
      expect(JSON.stringify(stale.body)).not.toMatch(/DIRETOR|GERENTE/);
      expect(await empRow(emp.id)).toMatchObject({ position: 'DIRETOR', admission_date: null });
      await sql(`UPDATE employees SET position = 'GERENTE' WHERE id = $1`, [emp.id]);
      const ok = await resolve(tokenA, up.body.id, dec(['position', 'admission_date']));
      expect(ok.status).toBe(200);
      expect(await empRow(emp.id)).toMatchObject({ position: 'SOLDADORA', admission_date: '2020-01-05' });
      expect((await sql(`SELECT field FROM employee_field_history WHERE employee_id = $1 AND source = 'revisao' ORDER BY field`, [emp.id])).rows.map((r: any) => r.field)).toEqual(['admission_date', 'position']);
      expect((await extractionRow(up.body.id)).candidates).toEqual([]);
    });

    it('sugestao ignorada não muda nada; line duplicada em pending é recusada com erro estático', async () => {
      const p: Pessoa = { name: 'ULISSES FICTICIO', cpf: nextCpf(), pos: 'SOLDADORA', adm: '05/01/2020' };
      const { emp, up } = await setup({}, p);
      const it0 = item(up.body, 'sugestao');
      const outro = item(up.body, 'novo');
      // Corrompe o JSON gravado: dois itens pendentes com a mesma linha.
      const cand = (await extractionRow(up.body.id)).candidates as any[];
      const dup = cand.map((c) => (c.kind === 'novo' ? { ...c, line: it0.line } : c));
      await sql('UPDATE employee_document_extractions SET candidates = $2::jsonb WHERE id = $1', [up.body.id, JSON.stringify(dup)]);
      const bad = await resolve(tokenA, up.body.id, [{ line: it0.line, action: 'ignorar' }]);
      expect(bad.status).toBe(400);
      expect(JSON.stringify(bad.body)).not.toMatch(/ULISSES|FICTICI/);
      await sql('UPDATE employee_document_extractions SET candidates = $2::jsonb WHERE id = $1', [up.body.id, JSON.stringify(cand)]);
      const ok = await resolve(tokenA, up.body.id, [{ line: it0.line, action: 'ignorar' }, { line: outro.line, action: 'ignorar' }]);
      expect(ok.status).toBe(200);
      expect(ok.body.summary.resolved).toEqual({ aplicados: 0, ignorados: 2 });
      expect(await empRow(emp.id)).toMatchObject({ position: null, admission_date: null });
    });
  });

  it('8) mesmo PDF: concorrência e reenvio reaproveitam (reused); tenant B cria extração independente', async () => {
    const p: Pessoa = { name: 'VALERIA FICTICIA', cpf: nextCpf(), pos: 'SOLDADORA', adm: '05/01/2020' };
    const buf = await pdf(ficha([p]));
    const docs0 = await docCount(tenantAId);
    const rs = await Promise.all([send(tokenA, buf), send(tokenA, buf)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 201]);
    const [created, reused] = rs[0].status === 201 ? rs : [rs[1], rs[0]];
    expect(reused.body).toMatchObject({ reused: true, id: created.body.id });
    expect(await docCount(tenantAId)).toBe(docs0 + 1);
    const again = await send(tokenA, buf);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(created.body.id);
    const other = await send(tokenB, buf);
    expect(other.status).toBe(201);
    expect(other.body.id).not.toBe(created.body.id);
    expect(other.body.reused).toBeUndefined();
    expect(other.body.tenant_id).toBe(tenantBId);
    expect(await docCount(tenantBId)).toBe(1);
    expect((await request(app.getHttpServer()).get(`/employees/extractions/${created.body.id}`).set(auth(tokenB))).status).toBe(404);
  });

  it('9) IA lenta com 3 uploads concorrentes: nenhuma conexão presa durante a chamada e o resto da API responde rápido', async () => {
    aiOn();
    let entered = 0;
    let idleInTx = -1;
    provider.extract.mockImplementation(async (text: string) => {
      entered++;
      await new Promise((r) => setTimeout(r, 3000));
      return aiReplyAll(text, { position: 'AJUDANTE' });
    });
    const docs = await Promise.all([0, 1, 2].map(async (i) => pdf(lista([{ name: `LENTO${'ABC'[i]} FICTICIO`.replace(/\d/g, ''), cpf: nextCpf(), pos: 'AJUDANTE', adm: '10/10/2019' }]))));
    const ups = docs.map((d) => send(tokenA, d).then((r) => r));
    const t0 = Date.now();
    while (entered < 3 && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    expect(entered).toBe(3);
    await new Promise((r) => setTimeout(r, 200));
    idleInTx = Number((await sql(`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND state LIKE 'idle in transaction%' AND pid <> pg_backend_pid()`)).rows[0].n);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const s = Date.now();
      const r = await request(app.getHttpServer()).get('/employees/table').set(auth(tokenA));
      times.push(Date.now() - s);
      expect(r.status).toBe(200);
    }
    const results = await Promise.all(ups);
    expect(idleInTx).toBe(0);
    for (const t of times) expect(t).toBeLessThan(1000);
    for (const r of results) {
      expect(r.status).toBe(201);
      expect(r.body.summary).toMatchObject({ method: 'texto+ia', ai_used: true });
    }
  }, 60000);

  // ---- Rodada 1 da revisão: disponibilidade, teto atômico, detail por causa ----
  const docxBomb = async (mb: number): Promise<Buffer> => {
    const z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    const unit = '<w:p><w:r><w:t>x</w:t></w:r></w:p>';
    z.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + unit.repeat(Math.floor((mb * 1048576) / unit.length)) + `<w:p><w:r><w:t>${mb}</w:t></w:r></w:p></w:body></w:document>`);
    return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  };

  it('10) DOCX bomba (40 MB inflado, dezenas de KB): ilegivel estático e a API segue respondendo em < 1 s durante o processamento', async () => {
    const bombs = await Promise.all([38, 39, 40].map((mb) => docxBomb(mb)));
    const rss0 = process.memoryUsage().rss;
    const ups = bombs.map((b, i) => send(tokenA, b, DOCX, `bomba${i}.docx`));
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = Date.now();
      const r = await request(app.getHttpServer()).get('/employees/table').set(auth(tokenA));
      times.push(Date.now() - t);
      expect(r.status).toBe(200);
    }
    const rs = await Promise.all(ups);
    for (const t of times) expect(t).toBeLessThan(1000);
    for (const r of rs) {
      expect(r.status).toBe(201);
      expect(r.body.status).toBe('ilegivel');
      expect(r.body.summary.detail).toBe('Documento grande demais para leitura automática. Envie a planilha modelo (.xlsx) ou uma versão menor.');
    }
    expect((process.memoryUsage().rss - rss0) / 1048576).toBeLessThan(300);
    expect(provider.extract).not.toHaveBeenCalled();
  }, 60000);

  it('11) teto diário atômico: 6 uploads concorrentes com limite 3 chamam o provedor no máximo 3 vezes', async () => {
    aiOn('3');
    // Este teste mira o teto de IA, não a cota de leitura por empresa: libera a cota para os 6 uploads da mesma empresa.
    process.env.EMPLOYEE_DOC_PARSE_TENANT_CONCURRENCY = '8';
    process.env.EMPLOYEE_DOC_PARSE_TENANT_QUEUE_MAX = '100';
    const used0 = Number((await sql(`SELECT count(*) AS n FROM employee_document_extractions WHERE tenant_id = $1 AND created_at > now() - interval '24 hours' AND ((summary->>'ai_used') = 'true' OR (summary->>'ai_attempted') = 'true')`, [tenantBId])).rows[0].n);
    expect(used0).toBe(0); // tenant B ainda não usou IA neste spec
    provider.extract.mockImplementation(async (t: string) => {
      await new Promise((r) => setTimeout(r, 400));
      return aiReplyAll(t, { position: 'AJUDANTE' });
    });
    const docs = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => pdf(lista([{ name: `CONCORR${'ABCDEF'[i]} FICTICIO`, cpf: nextCpf(), pos: 'AJUDANTE', adm: '10/10/2019' }]))));
    const rs = await Promise.all(docs.map((d) => send(tokenB, d)));
    for (const r of rs) expect(r.status).toBe(201);
    expect(provider.extract.mock.calls.length).toBe(3);
    expect(rs.filter((r) => r.body.summary.ai_used === true)).toHaveLength(3);
    expect(rs.filter((r) => r.body.summary.detail === 'Limite diário de leituras com IA atingido; o documento foi lido sem IA.')).toHaveLength(3);
  });

  it('12) markError depois de uma IA chamada preserva ai_attempted (continua contando no teto)', async () => {
    aiOn();
    provider.extract.mockImplementation(async (t: string) => aiReplyAll(t, { position: 'AJUDANTE' }));
    const spy = jest.spyOn(app.get(EmployeeIngestionService), 'extract').mockRejectedValueOnce(new Error('falha simulada na tx2'));
    const bad = await send(tokenA, await pdf(lista([{ name: 'ERRADO FICTICIO', cpf: nextCpf(), pos: 'AJUDANTE', adm: '10/10/2019' }])), PDF, 'erro-ia.pdf');
    spy.mockRestore();
    expect(bad.status).toBe(500);
    expect(provider.extract).toHaveBeenCalledTimes(1);
    const row = (await sql(`SELECT d.status, d.summary FROM employee_document_extractions d JOIN documents doc ON doc.id = d.document_id WHERE doc.tenant_id = $1 AND doc.title = 'erro-ia'`, [tenantAId])).rows[0];
    expect(row.status).toBe('erro');
    expect(row.summary).toMatchObject({ ai_attempted: true, detail: 'Falha ao processar o documento.' });
  });

  it('13) IA cobre só parte das pessoas (mais que 4 lotes): ai_partial e detail', async () => {
    aiOn();
    provider.extract.mockImplementation(async (t: string) => aiReplyAll(t, { position: 'AJUDANTE' }));
    const ps: Pessoa[] = Array.from({ length: 400 }, (_v, i) => ({ name: `PESSOA${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + (Math.floor(i / 26) % 26))} FICTICIA`, cpf: nextCpf(), pos: 'AJUDANTE', adm: '10/10/2019' }));
    const res = await send(tokenA, await pdf(lista(ps)));
    expect(res.status).toBe(201);
    expect(provider.extract.mock.calls.length).toBeLessThanOrEqual(8); // MAX_AI_BATCHES
    expect(res.body.summary).toMatchObject({ method: 'texto+ia', ai_used: true, ai_partial: true, detail: 'A leitura por IA cobriu só parte do documento; revise os demais.' });
  }, 60000);

  it('14) PDF de 60 páginas lê só 50 e avisa; PDF cifrado e DOCX vazio têm detail por causa', async () => {
    const big = await pdf([], (d) => { for (let i = 1; i <= 60; i++) { if (i > 1) d.addPage(); d.text(`Nome: PAG${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))} FICTICIA`); d.text(`CPF: ${nextCpf().fmt}`); } });
    const r = await send(tokenA, big);
    expect(r.status).toBe(201);
    expect(r.body.summary.detail).toBe('Documento com mais de 50 páginas: só as primeiras 50 foram lidas.');
    expect(r.body.items.filter((i: any) => i.kind === 'novo')).toHaveLength(50);
    const enc = await new Promise<Buffer>((resolve) => {
      const d = new PDFDocument({ userPassword: 'x', ownerPassword: 'y' } as any);
      const c: Buffer[] = [];
      d.on('data', (x: Buffer) => c.push(x));
      d.on('end', () => resolve(Buffer.concat(c)));
      d.text('Nome: ZZ FICTICIO');
      d.end();
    });
    const e = await send(tokenA, enc);
    expect(e.status).toBe(201);
    expect(e.body.status).toBe('ilegivel');
    expect(e.body.summary.detail).toBe('Documento protegido por senha não pode ser lido.');
    const empty = await send(tokenA, await docxBuf([new Paragraph({ children: [] })]), DOCX, 'vazio.docx');
    expect(empty.body.status).toBe('ilegivel');
    expect(empty.body.summary.detail).toBe('O documento não tem texto.');
  });

  it('15) semáforo: 6 PDFs normais concorrentes (3 por empresa) com concorrência 2 concluem sem 500; RSS estável; fila cheia vira erro estático', async () => {
    process.env.EMPLOYEE_DOC_PARSE_MAX_CONCURRENCY = '2';
    try {
      const docs = await Promise.all(Array.from({ length: 6 }, (_v, i) => pdf(ficha([{ name: `SEMAFORO${'ABCDEF'[i]} FICTICIO`, cpf: nextCpf(), pos: 'AJUDANTE', adm: '10/10/2019' }]))));
      let peak = process.memoryUsage().rss;
      let peakRunning = 0;
      const iv = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); peakRunning = Math.max(peakRunning, docParseSnapshot().running); }, 20);
      const rss0 = process.memoryUsage().rss;
      const rs = await Promise.all(docs.map((d, i) => send(i % 2 === 0 ? tokenA : tokenB, d))); // 3 por empresa: cabe na cota por tenant (1 + fila 2)
      clearInterval(iv);
      process.stdout.write(`[semaforo e2e] rss0MB=${Math.round(rss0 / 1048576)} picoMB=${Math.round(peak / 1048576)} picoEmExecucao=${peakRunning}\n`);
      for (const r of rs) {
        expect(r.status).toBe(201);
        expect(r.body.status).toBe('requer_revisao');
        expect(r.body.summary).toMatchObject({ method: 'texto', novo: 1 });
      }
      expect(peakRunning).toBeLessThanOrEqual(2);
      expect((peak - rss0) / 1048576).toBeLessThan(400);

      // Fila cheia: concorrência 1, fila 0, seis envios: os que não pegam a permissão viram `erro` estático (201, nunca 500),
      // não contam no teto de IA e o reenvio do mesmo arquivo depois funciona (erro não é reaproveitado).
      process.env.EMPLOYEE_DOC_PARSE_MAX_CONCURRENCY = '1';
      process.env.EMPLOYEE_DOC_PARSE_QUEUE_MAX = '0';
      const docs2 = await Promise.all(Array.from({ length: 6 }, (_v, i) => pdf(ficha([{ name: `FILA${'ABCDEF'[i]} FICTICIO`, cpf: nextCpf(), pos: 'AJUDANTE', adm: '10/10/2019' }]))));
      const rs2 = await Promise.all(docs2.map((d) => send(tokenA, d)));
      for (const r of rs2) expect(r.status).toBe(201);
      const busy = rs2.map((r, i) => ({ r, i })).filter(({ r }) => r.body.status === 'erro');
      expect(busy.length).toBeGreaterThanOrEqual(1);
      expect(rs2.filter((r) => r.body.status === 'requer_revisao').length).toBeGreaterThanOrEqual(1);
      for (const { r } of busy) {
        expect(r.body.summary.detail).toBe('Muitos documentos em leitura agora. Reenvie em alguns instantes.');
        expect(r.body.summary.ai_attempted).toBeUndefined();
      }
      delete process.env.EMPLOYEE_DOC_PARSE_QUEUE_MAX;
      const retry = await send(tokenA, docs2[busy[0].i]);
      expect(retry.status).toBe(201);
      expect(retry.body.reused).toBeUndefined();
      expect(retry.body.status).toBe('requer_revisao');
    } finally {
      delete process.env.EMPLOYEE_DOC_PARSE_MAX_CONCURRENCY;
      delete process.env.EMPLOYEE_DOC_PARSE_QUEUE_MAX;
    }
  });

  it('16) 4 DOCX pesados (2,9 MB de tabelas) simultâneos: a API segue respondendo (< 1 s), semáforo mantém <= 2 em execução, ninguém recebe 500', async () => {
    process.env.EMPLOYEE_DOC_PARSE_MAX_CONCURRENCY = '2';
    try {
      const NSW = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
      const tbl = (n: number) => `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a${n % 10}</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
      const mkHeavy = async (n: number) => {
        const z = new JSZip();
        z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
        z.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
        z.file('word/document.xml', `<?xml version="1.0"?><w:document ${NSW}><w:body>` + tbl(n).repeat(Math.floor((2.9 * 1048576) / tbl(n).length)) + '</w:body></w:document>');
        return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      };
      const docs = await Promise.all([0, 1, 2, 3].map((i) => mkHeavy(i)));
      let peakRunning = 0;
      const iv = setInterval(() => { peakRunning = Math.max(peakRunning, docParseSnapshot().running); }, 10);
      const rss0 = process.memoryUsage().rss;
      const ups = docs.map((d, i) => send(i % 2 === 0 ? tokenA : tokenB, d, DOCX, `pesado${i}.docx`));
      const times: number[] = [];
      for (let i = 0; i < 8; i++) {
        const t = Date.now();
        const r = await request(app.getHttpServer()).get('/employees/table').set(auth(tokenA));
        times.push(Date.now() - t);
        expect(r.status).toBe(200);
        await new Promise((r2) => setTimeout(r2, 200));
      }
      const rs = await Promise.all(ups);
      clearInterval(iv);
      process.stdout.write(`[docx pesados e2e] maxTableMs=${Math.max(...times)} picoEmExecucao=${peakRunning} rssGrowMB=${Math.round((process.memoryUsage().rss - rss0) / 1048576)}\n`);
      for (const t of times) expect(t).toBeLessThan(1000);
      expect(peakRunning).toBeLessThanOrEqual(2);
      for (const r of rs) expect(r.status).toBe(201); // lido, ilegível ou erro estático, nunca 500
    } finally {
      delete process.env.EMPLOYEE_DOC_PARSE_MAX_CONCURRENCY;
    }
  }, 90000);

  // ---- Onda final: sanear texto, IA por lote, needsAi, contadores, título ----
  const rawDocx = async (paras: string[]): Promise<Buffer> => {
    const z = new JSZip();
    z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    z.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    z.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paras.map((t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join('') + '</w:body></w:document>');
    return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  };
  const aiReplyAll = (text: string, fields: Record<string, string>) =>
    [...text.matchAll(/\[(CPF_\d+)\]/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).map((ref) => ({ cpf_ref: ref, evidence: lineWith(text, ref), ...fields }));

  it('17) controles e RTL no documento: valor LIMPO, requer_revisao (não 500) e o resolve aplica o valor limpo', async () => {
    const p: Pessoa = { name: 'CLEUSA FICTICIA', cpf: nextCpf(), pos: 'X' };
    const emp = await createEmp(tokenA, { full_name: p.name, cpf: p.cpf.raw });
    const buf = await pdf([]); // só para garantir o gerador; o documento de teste é o DOCX abaixo
    expect(buf.length).toBeGreaterThan(0);
    const docx = await rawDocx([`Nome: ${p.name}`, `CPF: ${p.cpf.fmt}`, 'Função: SOL\u0001DA\u202EDOR\u200B']);
    const res = await send(tokenA, docx, DOCX, 'controles.docx');
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('requer_revisao');
    const sug = item(res.body, 'sugestao', p.name);
    expect(sug.suggestions).toEqual([{ field: 'position', proposed: expect.not.stringMatching(/[\u0000-\u001F‪-\u202E\u200B]/) }]);
    const ok = await resolve(tokenA, res.body.id, [{ line: sug.line, action: 'aplicar', fields: ['position'] }]);
    expect(ok.status).toBe(200);
    const pos = (await empRow(emp.id)).position as string;
    expect(pos).not.toMatch(/[\u0000-\u001F\u007F-\u009F\u200B-‏‪-\u202E]/);
    expect(pos.length).toBeGreaterThan(3);
  });

  it('17b) NUL no texto não derruba o upload (nunca 500)', async () => {
    const p: Pessoa = { name: 'NULA FICTICIA', cpf: nextCpf(), pos: 'X' };
    const res = await send(tokenA, await rawDocx([`Nome: ${p.name}`, `CPF: ${p.cpf.fmt}`, 'Função: SOL\u0000DADOR']), DOCX, 'nul.docx');
    expect(res.status).toBe(201);
    expect(['requer_revisao', 'ilegivel']).toContain(res.body.status);
    expect(JSON.stringify(res.body)).not.toContain('\\u0000');
  });

  it('18) IA por lote: o lote 2 de 3 falha e os lotes 1 e 3 são mantidos; reserva do teto é UMA por documento', async () => {
    const used = Number((await sql(`SELECT count(*) AS n FROM employee_document_extractions WHERE tenant_id = $1 AND created_at > now() - interval '24 hours' AND ((summary->>'ai_used') = 'true' OR (summary->>'ai_attempted') = 'true')`, [tenantAId])).rows[0].n);
    aiOn(String(used + 1)); // cabe exatamente UM documento: se a reserva fosse por lote, o documento não passaria
    const ps: Pessoa[] = Array.from({ length: 30 }, (_v, i) => ({ name: `LOTE${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(66 + Math.floor(i / 26))} FICTICIO`, cpf: nextCpf(), pos: 'AJUDANTE', adm: '10/10/2019' }));
    let call = 0;
    let active = 0;
    let peak = 0;
    const deadlines: number[] = [];
    provider.extract.mockImplementation(async (t: string, o: any) => {
      const n = ++call;
      deadlines.push(o.deadlineMs);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 150));
      active--;
      if (n === 2) throw new Error('lote 2 falhou');
      return aiReplyAll(t, { position: 'AJUDANTE' });
    });
    const res = await send(tokenA, await pdf(lista(ps)));
    expect(res.status).toBe(201);
    expect(call).toBeGreaterThanOrEqual(3);
    expect(peak).toBe(2); // 2 lotes em paralelo
    for (const d of deadlines) { expect(d).toBeGreaterThan(0); expect(d).toBeLessThanOrEqual(60000); }
    expect(res.body.summary).toMatchObject({ method: 'texto+ia', ai_used: true, ai_attempted: true, ai_partial: true, detail: 'A leitura por IA cobriu só parte do documento; revise os demais.' });
    const cand = (await extractionRow(res.body.id)).candidates as any[];
    const withPos = cand.filter((c) => c.kind === 'novo' && c.values.position === 'AJUDANTE').length;
    const without = cand.filter((c) => c.kind === 'novo' && !c.values.position).length;
    expect(withPos).toBeGreaterThanOrEqual(12); // lotes bons mantidos
    expect(without).toBeGreaterThanOrEqual(1); // o lote que falhou ficou só com o regex
    // Contadores do piloto: só números.
    const sm = res.body.summary;
    expect(typeof sm.ai_items_total).toBe('number');
    expect(typeof sm.ai_items_verified).toBe('number');
    expect(sm.ai_fields_applied).toBe(withPos);
    expect(Object.keys(sm.ai_discarded).sort()).toEqual(['campo', 'cpf_ref', 'duplicado', 'evidence', 'limite']);
    for (const v of Object.values(sm.ai_discarded)) expect(typeof v).toBe('number');
    const dump = JSON.stringify(sm);
    for (const pp of ps.slice(0, 5)) { expect(dump).not.toContain(pp.cpf.raw); expect(dump).not.toContain(pp.name); }
    // o teto estava em "mais um": um segundo documento já não chama a IA
    provider.extract.mockClear();
    const again = await send(tokenA, await pdf(lista([{ name: 'SOBRA FICTICIA', cpf: nextCpf(), pos: 'X', adm: '10/10/2019' }])));
    expect(again.body.summary.detail).toBe('Limite diário de leituras com IA atingido; o documento foi lido sem IA.');
    expect(provider.extract).not.toHaveBeenCalled();
  }, 60000);

  it('19) todos os lotes falham: ai_used=false, ai_attempted=true, detail estático; orçamento global esgotado pula lotes e marca ai_partial', async () => {
    aiOn();
    const mk = (tag: string) => Array.from({ length: 30 }, (_v, i) => ({ name: `${tag}${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(66 + Math.floor(i / 26))} FICTICIO`, cpf: nextCpf(), pos: 'AJUDANTE', adm: '10/10/2019' }));
    provider.extract.mockImplementation(async () => { throw new Error('todos falham'); });
    const r1 = await send(tokenA, await pdf(lista(mk('FALHA'))));
    expect(r1.body.summary).toMatchObject({ method: 'texto', ai_used: false, ai_attempted: true, detail: 'Leitura por IA indisponível; o documento foi lido sem IA.' });
    expect(r1.body.summary.ai_partial).toBeUndefined();
    // Orçamento global: a primeira fatia consome o saldo (relógio avançado) e as demais são puladas.
    const realNow = Date.now.bind(Date);
    let offset = 0;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    let calls = 0;
    provider.extract.mockReset();
    provider.extract.mockImplementation(async (t: string) => { calls++; offset += 151000; return aiReplyAll(t, { position: 'AJUDANTE' }); });
    try {
      const r2 = await send(tokenA, await pdf(lista(mk('ORCAM'))));
      expect(r2.status).toBe(201);
      expect(calls).toBe(2); // só a 1ª fatia (2 lotes em paralelo); o resto estourou o orçamento de 150 s
      expect(r2.body.summary).toMatchObject({ ai_used: true, ai_partial: true, detail: 'A leitura por IA cobriu só parte do documento; revise os demais.' });
    } finally {
      nowSpy.mockRestore();
    }
  }, 60000);

  it('20) needsAi: documento completo NÃO chama o provedor; com lacuna chama; nascimento só se a janela tem o rótulo', async () => {
    aiOn();
    provider.extract.mockImplementation(async (t: string) => aiReplyAll(t, {}));
    const full: Pessoa = { name: 'COMPLETA FICTICIA', cpf: nextCpf(), pos: 'SOLDADORA', adm: '05/01/2020' };
    const r1 = await send(tokenA, await pdf(ficha([full])));
    expect(r1.status).toBe(201);
    expect(provider.extract).not.toHaveBeenCalled();
    expect(r1.body.summary).toMatchObject({ method: 'texto', ai_used: false });
    expect(r1.body.summary.ai_attempted).toBeUndefined();
    expect(r1.body.summary.detail).toBeUndefined();
    const nasc = await send(tokenA, await pdf([`Nome: ${full.name.replace('COMPLETA', 'NASCIDA')}`, `CPF: ${nextCpf().fmt}`, 'Função: SOLDADORA', 'Admissão: 05/01/2020', 'Data de nascimento:']));
    expect(nasc.status).toBe(201);
    expect(provider.extract).toHaveBeenCalledTimes(1); // janela tem "nasc" e o nascimento falta
    provider.extract.mockClear();
    const gap = await send(tokenA, await pdf(lista([{ name: 'LACUNA FICTICIA', cpf: nextCpf(), pos: 'X', adm: '10/10/2019' }])));
    expect(gap.status).toBe(201);
    expect(provider.extract).toHaveBeenCalledTimes(1); // falta cargo/admissão no regex
  });

  it('21) título do documento sem controles/RTL, e só espaços cai no fallback', async () => {
    const mkPdf = (t: string) => pdf([t]);
    const a = await send(tokenA, await mkPdf('Nome: TITULO UM FICTICIO'), PDF, '   .pdf');
    const b = await send(tokenA, await mkPdf('Nome: TITULO DOIS FICTICIO'), PDF, '\u202E\u200B.pdf');
    const c = await send(tokenA, await mkPdf('Nome: TITULO TRES FICTICIO'), PDF, 'rel\u202Eat\u200Borio.pdf');
    for (const r of [a, b, c]) expect(r.status).toBe(201);
    const titles = async (id: string) => (await sql('SELECT doc.title FROM employee_document_extractions d JOIN documents doc ON doc.id = d.document_id WHERE d.id = $1', [id])).rows[0].title;
    expect(await titles(a.body.id)).toBe('cadastro');
    expect(await titles(b.body.id)).toBe('cadastro');
    expect(await titles(c.body.id)).toBe('relatorio');
  });

  // ---- Privacidade B2 ----
  const HOSTILE = '؜⁪᠎￹؀‍\u{E0041}‮​';
  const clean = (v: string) => expect(v).not.toMatch(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F\p{Cf}\p{Co}\p{Zl}\p{Zp}\uD800-\uDFFF]/u);

  it('22) classes de caracteres hostis em cargo, nome e título: valor/título LIMPOS, requer_revisao (não 500/erro) e o resolve aplica o limpo', async () => {
    const existing: Pessoa = { name: 'HOSTIL FICTICIA', cpf: nextCpf(), pos: 'X' };
    const novoP: Pessoa = { name: 'NOVA FICTICIA', cpf: nextCpf(), pos: 'X' };
    const emp = await createEmp(tokenA, { full_name: existing.name, cpf: existing.cpf.raw });
    const zalgo = 'A' + '́'.repeat(30);
    const docx = await rawDocx([
      `Nome: ${existing.name}`, `CPF: ${existing.cpf.fmt}`, `Função: SOL${HOSTILE}DA${zalgo}DOR`,
      '',
      `Nome: NOV${HOSTILE}A FICTICIA`, `CPF: ${novoP.cpf.fmt}`, `Função: PINTOR${HOSTILE}`,
    ]);
    const res = await send(tokenA, docx, DOCX, `rel${HOSTILE}atorio.docx`);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('requer_revisao');
    const sug = item(res.body, 'sugestao', existing.name);
    const nov = res.body.items.find((i: any) => i.kind === 'novo');
    clean(sug.suggestions[0].proposed);
    clean(nov.full_name);
    for (const f of nov.fields) clean(f.value);
    const title = (await sql('SELECT doc.title FROM employee_document_extractions d JOIN documents doc ON doc.id = d.document_id WHERE d.id = $1', [res.body.id])).rows[0].title as string;
    expect(title).toBe('relatorio');
    const ok = await resolve(tokenA, res.body.id, [{ line: sug.line, action: 'aplicar', fields: ['position'] }, { line: nov.line, action: 'aplicar' }]);
    expect(ok.status).toBe(200);
    const pos = (await empRow(emp.id)).position as string;
    clean(pos);
    expect(pos.replace(/\p{M}/gu, '')).toBe('SOLDAADOR');
    expect((pos.match(/\p{M}/gu) ?? []).length).toBeLessThanOrEqual(3); // zalgo limitado
    const created = (await sql('SELECT full_name FROM employees WHERE tenant_id = $1 AND cpf = $2', [tenantAId, novoP.cpf.raw])).rows[0];
    clean(created.full_name);
  });

  it('23) a janela é só da pessoa: vizinho com "Nascimento:" NÃO faz a pessoa do meio chamar a IA', async () => {
    aiOn();
    const a: Pessoa = { name: 'ALFA FICTICIA', cpf: nextCpf(), pos: 'SOLDADORA', adm: '05/01/2020' };
    const b: Pessoa = { name: 'BETA FICTICIA', cpf: nextCpf(), pos: 'ELETRICISTA', adm: '18/06/2018' };
    const c: Pessoa = { name: 'GAMA FICTICIA', cpf: nextCpf(), pos: 'PINTORA', adm: '01/03/2021' };
    let received = '';
    provider.extract.mockImplementation(async (t: string) => { received = t; return aiReplyAll(t, {}); });
    const res = await send(tokenA, await pdf([...ficha([a, b]), ...ficha([c]), 'Data de nascimento:']));
    expect(res.status).toBe(201);
    expect(provider.extract).toHaveBeenCalledTimes(1);
    expect(received.match(/\[CPF_\d+\]/g)?.filter((v, i, arr) => arr.indexOf(v) === i)).toHaveLength(1); // só quem precisa (a última)
    // (o lote traz o contorno de texto da pessoa que precisa; o que importa é que só ELA virou marcador)
  });

  it('24) ai_used honesto: IA respondeu sem itens verificados (vazio, undefined ou não-array) => ai_used=false, attempted, detail estático, sem ai_partial', async () => {
    aiOn();
    for (const reply of [() => [], () => undefined, () => ({ nao: 'array' })]) {
      provider.extract.mockReset();
      provider.extract.mockImplementation(async () => reply());
      const res = await send(tokenA, await pdf(lista([{ name: `VAZIA${Math.random().toString(36).slice(2, 5).replace(/\d/g, 'X').toUpperCase()} FICTICIA`, cpf: nextCpf(), pos: 'X', adm: '10/10/2019' }])));
      expect(res.status).toBe(201);
      expect(provider.extract).toHaveBeenCalledTimes(1);
      expect(res.body.summary).toMatchObject({ method: 'texto', ai_used: false, ai_attempted: true, ai_items_verified: 0, detail: 'A IA não acrescentou informações verificadas; o documento foi lido sem IA.' });
      expect(res.body.summary.ai_partial).toBeUndefined();
    }
  });

  it('25) o prazo do lote é imposto pelo serviço: provedor que ignora o deadline e nunca resolve não segura o documento', async () => {
    aiOn();
    process.env.EMPLOYEE_INGESTION_AI_BATCH_MS = '400';
    try {
      provider.extract.mockImplementation(() => new Promise(() => undefined)); // nunca responde
      const t0 = Date.now();
      const res = await send(tokenA, await pdf(lista([{ name: 'PRAZO FICTICIO', cpf: nextCpf(), pos: 'X', adm: '10/10/2019' }])));
      const ms = Date.now() - t0;
      expect(res.status).toBe(201);
      expect(ms).toBeLessThan(5000);
      expect(res.body.summary).toMatchObject({ method: 'texto', ai_used: false, ai_attempted: true, detail: 'Leitura por IA indisponível; o documento foi lido sem IA.' });
    } finally {
      delete process.env.EMPLOYEE_INGESTION_AI_BATCH_MS;
    }
  });

  it('26) o revisor vê o que será criado: linha nova expõe fields (campos não-CPF, ordem fixa, sem CPF)', async () => {
    const p: Pessoa = { name: 'REVISOR FICTICIO', cpf: nextCpf(), pos: 'ELETRICISTA', adm: '18/06/2018' };
    const res = await send(tokenA, await pdf(ficha([p])));
    expect(res.status).toBe(201);
    const nov = item(res.body, 'novo', p.name);
    expect(nov.fields).toEqual([{ field: 'position', value: 'ELETRICISTA' }, { field: 'admission_date', value: '2018-06-18' }]);
    const get = await request(app.getHttpServer()).get(`/employees/extractions/${res.body.id}`).set(auth(tokenA));
    expect(item(get.body, 'novo', p.name).fields).toEqual(nov.fields);
    expect(JSON.stringify(get.body)).not.toContain(p.cpf.raw);
    for (const f of nov.fields) expect(f.value.length).toBeLessThanOrEqual(200);
  });

  it('27) erro 5xx real: CPF e nome NÃO chegam ao log e a resposta segue genérica', async () => {
    const out: string[] = [];
    const w1 = jest.spyOn(process.stderr, 'write').mockImplementation(((c: string) => { out.push(String(c)); return true; }) as never);
    const w2 = jest.spyOn(process.stdout, 'write').mockImplementation(((c: string) => { out.push(String(c)); return true; }) as never);
    const spy = jest.spyOn(app.get(EmployeeIngestionService), 'extract').mockRejectedValueOnce(new Error('falha 52998224725 JOAO FICTICIO'));
    let res;
    try {
      res = await send(tokenA, await pdf(ficha([{ name: 'LOGADA FICTICIA', cpf: nextCpf(), pos: 'X', adm: '10/10/2019' }])), PDF, 'erro5xx.pdf');
    } finally {
      spy.mockRestore();
      w1.mockRestore();
      w2.mockRestore();
    }
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ statusCode: 500, message: 'Erro interno' });
    const log = out.join('');
    expect(log).toContain('"status_code":500'); // o filtro logou...
    expect(log).not.toContain('52998224725'); // ...sem o CPF
    expect(log).not.toContain('JOAO FICTICIO'); // ...nem o nome
    expect(log).not.toContain('LOGADA FICTICIA');
  });
});
