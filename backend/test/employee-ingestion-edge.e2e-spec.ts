import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import JSZip from 'jszip';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { R2Service } from '../src/common/r2/r2.service';
import { EMPLOYEE_EXTRACTION_PROVIDER } from '../src/employees/employee-extraction-provider.interface';
import { TestDb } from './db-test-helper';
import { randomValidCnpj } from './helpers/cnpj';
import { Paragraph, TextRun } from 'docx';
import { DOCX_MIME, PDF_MIME, docxFrom, makeCpf, pdfFromLines, P } from './employee-docgen';

// Defeitos de ponta e textos de erro do upload de cadastro (Fatia 4, Task 7). Usa o ValidationPipe/helmet de produção
// (configureApp). Em TODOS os caminhos de erro: nunca 500, resposta sem stack, caminho de arquivo, nome de biblioteca ou
// trecho do documento. Provedor de IA FALSO (desligado); R2 mockado; dados sintéticos.
const UPLOAD_RATE_LIMIT_KEY = 'ratelimit:EmployeesController.uploadDocument:::ffff:127.0.0.1';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
jest.setTimeout(120_000);

describe('Ingestão de cadastro: defeitos de ponta e textos de erro (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let token: string;
  let tokenB: string;
  let tenantAId: string;
  let unitB: string;
  const putObject = jest.fn();
  const provider = { extract: jest.fn() };
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const sql = (text: string, params: unknown[] = []) => (db as any).client.query(text, params);

  // Tudo o que o cliente vê em respostas de erro/estado: frases estáticas, sem internals.
  const LEAK = /(\bat\s+[\w$.<>]+\s+\(|\.(?:ts|js):\d+|\/app\/|\/opt\/|node_modules|\bstack\b|pdf-?parse|pdfjs|mammoth|jszip|exceljs|multer|busboy|supertest|nestjs|postgres|\bpg\b|TypeError|RangeError|ReferenceError|SyntaxError|\bError:|ENOENT|EACCES|undefined|\[object|ZZEDGE)/i;
  const messages = new Map<string, Set<number>>();
  const clean = (res: request.Response, ctx: string) => {
    expect([ctx, res.status < 500 ? 'ok' : `HTTP ${res.status}`]).toEqual([ctx, 'ok']);
    const body = JSON.stringify(res.body ?? {}) + (res.text && res.text[0] !== '{' ? res.text : '');
    const m = LEAK.exec(body);
    expect([ctx, m ? m[0] : null, body.slice(0, 200)]).toEqual([ctx, null, body.slice(0, 200)]);
    const msg = res.body?.message;
    for (const t of Array.isArray(msg) ? msg : msg !== undefined ? [msg] : []) {
      if (typeof t === 'string') messages.set(t, (messages.get(t) ?? new Set()).add(res.status));
    }
    if (res.body?.summary?.detail) messages.set(res.body.summary.detail, (messages.get(res.body.summary.detail) ?? new Set()).add(res.status));
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2Service).useValue({ putObject, deleteObject: jest.fn(), getObject: jest.fn() })
      .overrideProvider(EMPLOYEE_EXTRACTION_PROVIDER).useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = new TestDb();
    await db.connect();
    const a = await db.createTenantWithUser('Empresa Edge A');
    const b = await db.createTenantWithUser('Empresa Edge B');
    tenantAId = a.tenantId;
    token = (await request(app.getHttpServer()).post('/auth/login').send({ email: a.email, password: a.password })).body.access_token;
    tokenB = (await request(app.getHttpServer()).post('/auth/login').send({ email: b.email, password: b.password })).body.access_token;
    unitB = (await request(app.getHttpServer()).post('/company-units').set(auth(tokenB))
      .send({ name: 'Filial Edge B', cnpj: randomValidCnpj(), address_street: 'Rua T', address_city: 'Criciúma', address_state: 'SC', address_zip: '88801000' })).body.id;
    redis = new Redis(process.env.REDIS_URL as string);
  });
  beforeEach(async () => {
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    putObject.mockClear();
    provider.extract.mockReset();
    provider.extract.mockImplementation(async () => { throw new Error('provedor não deveria ser chamado neste teste'); });
    delete process.env.EMPLOYEE_INGESTION_AI_ENABLED;
  });
  afterAll(async () => {
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    redis.disconnect();
    await db.cleanup();
    await db.disconnect();
    await app.close();
    // eslint-disable-next-line no-console
    console.log(`MENSAGENS DE ERRO/ESTADO OBSERVADAS (${messages.size})\n${[...messages].map(([m, s]) => `[${[...s].join(',')}] ${m}`).join('\n')}`);
  });

  let seq = 40000;
  const okPdf = (tag = 'EDGE') => {
    const n = seq++;
    return pdfFromLines([`Nome: ${tag} ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + (Math.floor(n / 26) % 26))} FICTICIO`, `CPF: ${makeCpf(n).fmt}`, 'Função: SOLDADOR']);
  };
  const send = (buf: Buffer | null, opts: { name?: string; mime?: string; field?: string; fields?: Record<string, string | string[]>; tok?: string } = {}) => {
    const rq = request(app.getHttpServer()).post('/employees/documents').set(auth(opts.tok ?? token));
    for (const [k, v] of Object.entries(opts.fields ?? {})) for (const x of Array.isArray(v) ? v : [v]) rq.field(k, x);
    if (buf !== null) rq.attach(opts.field ?? 'file', buf, { filename: opts.name ?? 'cadastro.pdf', contentType: opts.mime ?? PDF_MIME });
    return rq.then((r) => r);
  };
  const docs = async () => Number((await sql('SELECT count(*) AS n FROM documents WHERE tenant_id = $1', [tenantAId])).rows[0].n);

  it('1) nomes de arquivo hostis: nunca 500, chave do R2 sempre segura, resposta limpa', async () => {
    const names = [
      '../x.pdf', '..\\..\\windows\\system32\\x.pdf', '/etc/passwd.pdf', 'a\tb\u0001\u007f.pdf', 'a\r\nContent-Type: text/html\r\n.pdf', 'a\u0000b.pdf',
      `${'x'.repeat(300)}.pdf`, '   .pdf', '   ', '', '.pdf', '‮gpj.fdp.pdf', 'ficha​‍.pdf', 'ficha 😀.pdf', 'ficha.PDF', 'a.b.c.d.pdf', "o'brien\";x=1.pdf",
      `${'ç'.repeat(150)}.pdf`, '<script>alert(1)</script>.pdf',
    ];
    const rows: string[] = [];
    for (const name of names) {
      const before = await docs();
      putObject.mockClear();
      const res = await send(await okPdf(), { name });
      clean(res, `nome ${JSON.stringify(name).slice(0, 40)}`);
      expect([201, 400]).toContain(res.status);
      if (res.status === 201) {
        expect(await docs()).toBe(before + 1);
        const key = putObject.mock.calls[0][0] as string;
        // tenants/<uuid>/documents/<uuid>/<arquivo>: um único segmento final, só caracteres seguros, tamanho limitado
        expect(key).toMatch(/^tenants\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/);
        expect(key.length).toBeLessThan(600);
        expect(key.split('/').filter((s) => s === '..' || s === '.')).toEqual([]);
        const row = (await sql('SELECT title, file_name FROM documents WHERE id = (SELECT document_id FROM employee_document_extractions WHERE id = $1)', [res.body.id])).rows[0];
        expect(row.title.length).toBeLessThanOrEqual(200);
        rows.push(`${JSON.stringify(name).slice(0, 30).padEnd(32)} -> 201 key=...${key.slice(-30)} title=${JSON.stringify(row.title).slice(0, 40)}`);
      } else {
        expect(await docs()).toBe(before);
        rows.push(`${JSON.stringify(name).slice(0, 30).padEnd(32)} -> ${res.status} ${JSON.stringify(res.body.message)}`);
      }
    }
    process.stdout.write(`[nomes hostis]\n${rows.join('\n')}\n`);
  });

  it('2) content-type x extensão x conteúdo divergentes', async () => {
    const docx = await docxFrom([P('Nome: DOCX EDGE FICTICIO'), P(`CPF: ${makeCpf(seq++).fmt}`)]);
    const cases: { name: string; buf: Buffer; mime?: string; file: string; expect: number[] }[] = [
      { name: 'PDF com extensão .docx e mime pdf (vale o conteúdo/mime)', buf: await okPdf(), mime: PDF_MIME, file: 'ficha.docx', expect: [201] },
      { name: 'PDF com mime DOCX', buf: await okPdf(), mime: DOCX_MIME, file: 'ficha.docx', expect: [400] },
      { name: 'DOCX com mime PDF', buf: docx, mime: PDF_MIME, file: 'ficha.pdf', expect: [400] },
      { name: 'DOCX com assinatura de PDF no início (mime docx)', buf: Buffer.concat([Buffer.from('%PDF-1.4\n'), docx]), mime: DOCX_MIME, file: 'ficha.docx', expect: [400] },
      { name: 'PDF dentro de zip chamado docx', buf: await (async () => { const z = new JSZip(); z.file('ficha.pdf', await okPdf()); return z.generateAsync({ type: 'nodebuffer' }); })(), mime: DOCX_MIME, file: 'ficha.docx', expect: [400] },
      { name: 'mime octet-stream com extensão .pdf', buf: await okPdf(), mime: 'application/octet-stream', file: 'ficha.pdf', expect: [400] },
      { name: 'mime text/html', buf: Buffer.from('<html>Nome: X</html>'), mime: 'text/html', file: 'ficha.pdf', expect: [400] },
      { name: 'mime image/svg+xml', buf: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>Nome: X</text></svg>'), mime: 'image/svg+xml', file: 'a.svg', expect: [400] },
      { name: 'mime em maiúsculas (APPLICATION/PDF)', buf: await okPdf(), mime: 'APPLICATION/PDF', file: 'ficha.pdf', expect: [201, 400] },
      { name: 'mime com parâmetro (application/pdf; charset=utf-8)', buf: await okPdf(), mime: 'application/pdf; charset=utf-8', file: 'ficha.pdf', expect: [201, 400] },
      { name: 'xlsx com mime pdf', buf: Buffer.from('PK\u0003\u0004 nao eh xlsx'), mime: PDF_MIME, file: 'a.xlsx', expect: [400] },
      { name: 'xlsx quebrado com mime xlsx', buf: Buffer.from('PK\u0003\u0004 lixo'), mime: XLSX_MIME, file: 'a.xlsx', expect: [400] },
      { name: 'PDF truncado (só cabeçalho)', buf: Buffer.from('%PDF-1.4\n%ZZEDGE-FRAGMENTO\n'), mime: PDF_MIME, file: 'a.pdf', expect: [201, 400] },
      { name: 'PDF com lixo após o cabeçalho', buf: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(Array.from({ length: 2000 }, (_v, i) => (i * 37 + 11) % 256))]), mime: PDF_MIME, file: 'a.pdf', expect: [201, 400] },
    ];
    const rows: string[] = [];
    for (const c of cases) {
      const before = await docs();
      const res = await send(c.buf, { name: c.file, mime: c.mime });
      clean(res, c.name);
      expect([c.name, c.expect.includes(res.status) ? res.status : `esperado ${c.expect}, veio ${res.status}`]).toEqual([c.name, res.status]);
      if (res.status === 400) expect(await docs()).toBe(before);
      rows.push(`${c.name.padEnd(62)} -> ${res.status} ${res.status === 201 ? res.body.status : JSON.stringify(res.body.message)}`);
    }
    process.stdout.write(`[divergências]\n${rows.join('\n')}\n`);
    expect(provider.extract).not.toHaveBeenCalled();
  });

  it('3) arquivo de 0 bytes e upload sem arquivo (campo ausente, campo com outro nome, só campos de texto)', async () => {
    const before = await docs();
    const zero = await send(Buffer.alloc(0));
    clean(zero, '0 bytes');
    expect(zero.status).toBe(400);
    const none = await send(null);
    clean(none, 'sem arquivo');
    expect(none.status).toBe(400);
    expect(none.body.message).toBe('Nenhum arquivo enviado');
    const otherField = await send(await okPdf(), { field: 'arquivo' });
    clean(otherField, 'campo com outro nome');
    expect(otherField.status).toBe(400);
    const json = await request(app.getHttpServer()).post('/employees/documents').set(auth()).send({ file: 'x' });
    clean(json, 'JSON em vez de multipart');
    expect(json.status).toBe(400);
    const wrongCt = await request(app.getHttpServer()).post('/employees/documents').set(auth()).set('Content-Type', 'text/plain').send('Nome: X');
    clean(wrongCt, 'text/plain');
    expect(wrongCt.status).toBe(400);
    const bad = await request(app.getHttpServer()).post('/employees/documents').set(auth()).set('Content-Type', 'multipart/form-data; boundary=abc').send('--abc\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n\r\ntruncado');
    clean(bad, 'multipart truncado');
    expect(bad.status).toBe(400);
    expect(await docs()).toBe(before);
  });

  it('4) company_unit_id: inválido, de outro tenant, array, vazio, inexistente, objeto', async () => {
    const before = await docs();
    const cases: [string, Record<string, string | string[]>, number[]][] = [
      ['texto', { company_unit_id: 'abc' }, [400]],
      ['uuid de OUTRO tenant', { company_unit_id: unitB }, [400]],
      ['uuid inexistente', { company_unit_id: '00000000-0000-4000-8000-000000000000' }, [400]],
      ['array (campo repetido)', { company_unit_id: [unitB, unitB] }, [400]],
      ['objeto estilo company_unit_id[x]', { 'company_unit_id[x]': 'y' }, [201, 400]],
      ['SQL-injection no valor', { company_unit_id: "'; DROP TABLE documents;--" }, [400]],
      ['uuid em maiúsculas de outro tenant', { company_unit_id: unitB.toUpperCase() }, [400]],
    ];
    for (const [name, fields, expectStatus] of cases) {
      const res = await send(await okPdf(), { fields });
      clean(res, `company_unit_id ${name}`);
      expect([name, expectStatus.includes(res.status) ? res.status : `esperado ${expectStatus}, veio ${res.status}`]).toEqual([name, res.status]);
      if (res.status === 400) expect(JSON.stringify(res.body)).not.toContain(unitB);
    }
    // Só os casos aceitos criaram documento (no máximo 1: o do "objeto").
    expect((await docs()) - before).toBeLessThanOrEqual(1);
    // vazio é igual a ausente
    const empty = await send(await okPdf(), { fields: { company_unit_id: '' } });
    clean(empty, 'company_unit_id vazio');
    expect(empty.status).toBe(201);
    // A extração de "uuid de outro tenant" nunca rotula documento com a filial de B.
    expect(Number((await sql('SELECT count(*) AS n FROM documents WHERE tenant_id = $1 AND company_unit_id = $2', [tenantAId, unitB])).rows[0].n)).toBe(0);
  });

  it('5) arquivos que o leitor não consegue ler viram estado estático (201/ilegivel|sem_dados) e nunca ecoam o conteúdo', async () => {
    const SECRET = 'ZZEDGE-CONTEUDO-SECRETO';
    const mkZip = async (files: Record<string, string>) => { const z = new JSZip(); for (const [k, v] of Object.entries(files)) z.file(k, v); return z.generateAsync({ type: 'nodebuffer' }); };
    const cases: [string, Buffer, string][] = [
      ['PDF sem texto', await pdfFromLines([]), PDF_MIME],
      ['DOCX sem texto', await docxFrom([P('')]), DOCX_MIME],
      ['PDF só com texto sem funcionários', await pdfFromLines([SECRET, 'nenhum cpf aqui']), PDF_MIME],
      ['DOCX só com texto sem funcionários', await docxFrom([P(SECRET)]), DOCX_MIME],
      ['DOCX com document.xml malformado', await mkZip({ '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>', 'word/document.xml': `<w:document>${SECRET}` }), DOCX_MIME],
      ['PDF com Nome/CPF inválido (CPF 111.111.111-11)', await pdfFromLines([`Nome: ${SECRET} FICTICIO`, 'CPF: 111.111.111-11']), PDF_MIME],
      ['PDF com 1 MB de uma linha só', await pdfFromLines(['Nome: ' + 'A'.repeat(900) + ' FICTICIO CPF: ' + makeCpf(77001).fmt]), PDF_MIME],
    ];
    for (const [name, buf, mime] of cases) {
      const res = await send(buf, { mime, name: mime === PDF_MIME ? 'a.pdf' : 'a.docx' });
      clean(res, name);
      expect([name, [201, 400].includes(res.status)]).toEqual([name, true]);
      if (res.status === 201) {
        expect(['ilegivel', 'sem_dados', 'requer_revisao', 'erro', 'aplicado']).toContain(res.body.status);
        // 'aplicado' sem nada para revisar só pode carregar itens inválidos (linha + motivo)
        if (res.body.status === 'aplicado') expect(res.body.items.every((i: any) => i.kind === 'invalida')).toBe(true);
        expect(JSON.stringify(res.body)).not.toContain(SECRET);
      }
    }
    expect(provider.extract).not.toHaveBeenCalled();
  });

  it('6) rotas de extração: ids e corpos malformados dão 400/404 estáticos, nunca 500 nem eco do que foi enviado', async () => {
    const up = await send(await okPdf('ROTA'));
    expect(up.status).toBe(201);
    const id = up.body.id as string;
    const eco = 'ZZEDGE-ECO';
    const reqs: [string, () => request.Test][] = [
      ['GET id não-uuid', () => request(app.getHttpServer()).get(`/employees/extractions/${eco}`).set(auth())],
      ['GET id uuid inexistente', () => request(app.getHttpServer()).get('/employees/extractions/00000000-0000-4000-8000-000000000000').set(auth())],
      ['GET id com SQL', () => request(app.getHttpServer()).get(`/employees/extractions/${encodeURIComponent("' OR 1=1 --")}`).set(auth())],
      ['GET lista status inválido', () => request(app.getHttpServer()).get(`/employees/extractions?status=${eco}`).set(auth())],
      ['GET lista status duplicado', () => request(app.getHttpServer()).get('/employees/extractions?status=requer_revisao&status=aplicado').set(auth())],
      ['resolve id não-uuid', () => request(app.getHttpServer()).post(`/employees/extractions/${eco}/resolve`).set(auth()).send({ decisions: [] })],
      ['resolve sem corpo', () => request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth())],
      ['resolve decisions string', () => request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth()).send({ decisions: eco })],
      ['resolve decisions null', () => request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth()).send({ decisions: null })],
      ['resolve decisions vazio com pendente', () => request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth()).send({ decisions: [] })],
      ['resolve line string', () => request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth()).send({ decisions: [{ line: eco, action: 'aplicar' }] })],
      ['resolve line negativa', () => request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth()).send({ decisions: [{ line: -1, action: 'ignorar' }] })],
      ['resolve line 1e9', () => request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth()).send({ decisions: [{ line: 1e9, action: 'ignorar' }] })],
      ['resolve action inválida', () => request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth()).send({ decisions: [{ line: 1, action: eco }] })],
      ['resolve fields não-lista', () => request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth()).send({ decisions: [{ line: 1, action: 'aplicar', fields: eco }] })],
      ['resolve propriedade extra', () => request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth()).send({ decisions: [{ line: 1, action: 'ignorar', tenant_id: 'x' }] })],
      ['resolve decisions gigante', () => request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth()).send({ decisions: Array.from({ length: 2001 }, (_v, i) => ({ line: i + 1, action: 'ignorar' })) })],
      ['resolve JSON inválido', () => request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth()).set('Content-Type', 'application/json').send('{"decisions": [')],
      ['resolve prototype pollution', () => request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth()).set('Content-Type', 'application/json').send('{"__proto__":{"polluted":1},"decisions":[{"line":99999,"action":"ignorar"}]}')],
    ];
    for (const [name, rq] of reqs) {
      const res = await rq().then((r) => r);
      clean(res, name);
      expect([name, res.status >= 400 && res.status < 500]).toEqual([name, true]);
      expect(JSON.stringify(res.body)).not.toContain(eco);
    }
    expect(({} as any).polluted).toBeUndefined();
    // Depois de toda a bateria a extração segue pendente e intacta.
    const still = await request(app.getHttpServer()).get(`/employees/extractions/${id}`).set(auth());
    expect(still.body.status).toBe('requer_revisao');
    expect(still.body.items).toHaveLength(up.body.items.length);
  });

  it('7) tamanho: 11 MB recusado sem armazenar; rate limit responde 429 estático; sem 500', async () => {
    const before = await docs();
    const big = await send(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(11 * 1024 * 1024)]), { name: 'grande.pdf' });
    clean(big, '11 MB');
    expect([400, 413]).toContain(big.status);
    expect(await docs()).toBe(before);
    // Estoura o limite por IP (20/h): o 21º recebe 429 com texto estático e nada é gravado.
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    const buf = Buffer.from('nao sou pdf');
    let last: request.Response | undefined;
    for (let i = 0; i < 22; i++) { last = await send(buf); clean(last, `rate ${i}`); }
    expect(last!.status).toBe(429);
    expect(await docs()).toBe(before);
    expect(provider.extract).not.toHaveBeenCalled();
  });
  it('8) inventário das mensagens vistas: as não portuguesas são só as de bibliotecas já conhecidas (achado Minor do relatório)', () => {
    // Frases em inglês/técnicas que o framework devolve sem passar pelo texto do produto. Lista FECHADA: qualquer nova
    // mensagem fora do português entra aqui só por decisão consciente (e o ideal é traduzi-las no filtro global).
    const KNOWN_FRAMEWORK = new Set([
      'Multipart: Malformed part header', 'Multipart: Unexpected end of form', 'Unexpected field', 'File too large',
      'Unexpected end of JSON input', 'each value in nested property decisions must be either object or array',
      'decisions.0.property tenant_id should not exist',
    ]);
    const PT = /[ãõçáéíóúâêô]|\b(?:não|formato|arquivo|enviado|inválid|deve|aceita|extração|encontrad|envie|decisão|informe|conteúdo|requisições|filial|documento|funcionário|status|tem|itens|demais)\b/i;
    const unknown = [...messages.keys()].filter((m) => !KNOWN_FRAMEWORK.has(m) && !PT.test(m));
    expect(unknown).toEqual([]);
    expect(messages.size).toBeGreaterThan(15);
  });
  it('9) tempo total do POST /employees/documents (parse + gravação + classificação, IA desligada): 1 e 50 páginas, PDF e DOCX', async () => {
    const mkPages = (pages: number, per: number, base: number) =>
      Array.from({ length: pages }, (_v, p) => Array.from({ length: per }, (_w, k) => {
        const n = base + p * per + k;
        return [`Nome: TEMPO ${String.fromCharCode(65 + (n % 26))}${String.fromCharCode(65 + (Math.floor(n / 26) % 26))}${String.fromCharCode(65 + (Math.floor(n / 676) % 26))} FICTICIO`, `CPF: ${makeCpf(n).fmt}`, 'Função: SOLDADOR', 'Admissão: 05/01/2020'];
      }).flat());
    const rows: string[] = [];
    for (const [kind, pages, per, base] of [['PDF', 1, 3, 50000], ['PDF', 50, 2, 50100], ['DOCX', 1, 3, 50400], ['DOCX', 50, 2, 50500]] as const) {
      const pg = mkPages(pages, per, base);
      const buf = kind === 'PDF'
        ? await pdfFromLines(pg.flatMap((lines, i) => (i > 0 ? ['\f', ...lines] : lines)))
        : await docxFrom(pg.flatMap((lines, i) => lines.map((l, li) => new Paragraph({ pageBreakBefore: i > 0 && li === 0, children: [new TextRun(l)] }))));
      const t0 = Date.now();
      const res = await send(buf, { mime: kind === 'PDF' ? PDF_MIME : DOCX_MIME, name: `tempo.${kind.toLowerCase()}` });
      const ms = Date.now() - t0;
      clean(res, `tempo ${kind} ${pages}`);
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('requer_revisao');
      expect(res.body.items.length).toBe(pages * per);
      expect(ms).toBeLessThan(20_000); // folga ampla: serve só para pegar regressão grosseira
      rows.push(`${kind.padEnd(5)} ${String(pages).padStart(3)} páginas ${String(pages * per).padStart(4)} pessoas arquivo=${Math.round(buf.length / 1024)}KB  POST total=${ms} ms`);
      await redis.del(UPLOAD_RATE_LIMIT_KEY);
    }
    process.stdout.write(`[tempo endpoint]\n${rows.join('\n')}\n`);
  });
});
