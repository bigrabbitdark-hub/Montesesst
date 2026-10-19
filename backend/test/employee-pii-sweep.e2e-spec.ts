import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { R2Service } from '../src/common/r2/r2.service';
import { EmployeeIngestionService } from '../src/employees/employee-ingestion.service';
import { EMPLOYEE_EXTRACTION_PROVIDER } from '../src/employees/employee-extraction-provider.interface';
import { TestDb } from './db-test-helper';
import { DOCX_MIME, PDF_MIME, docxFrom, dtable, makeCpf, pdfFromLines } from './employee-docgen';

// VARREDURA DE VAZAMENTO DE PII (Fatia 4, Task 7). Percorre o ciclo completo (upload PDF/DOCX/XLSX, GET lista, GET :id,
// resolve aplicar/ignorar, reenvio `reused`, erro, imagem 400, saúde, escaneado) com CPFs e nomes fictícios CONHECIDOS e
// varre: respostas HTTP, banco depois de resolver, histórico, auditoria, log do processo e o texto entregue ao provedor FALSO.
// Nada de MiniMax real, nenhuma chave; o R2 é mockado.
const UPLOAD_RATE_LIMIT_KEY = 'ratelimit:EmployeesController.uploadDocument:::ffff:127.0.0.1';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
jest.setTimeout(120_000);

describe('Varredura de PII: ingestão de PDF/DOCX/XLSX (e2e)', () => {
  let app: INestApplication;
  let db: TestDb;
  let redis: Redis;
  let token: string;
  let tenantId: string;
  const provider = { extract: jest.fn() };
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const sql = (text: string, params: unknown[] = []) => (db as any).client.query(text, params);

  // ---- Captura de logs do processo ----
  const logs: string[] = [];
  const restores: (() => void)[] = [];
  const fmt = (a: unknown[]) => a.map((x) => (typeof x === 'string' ? x : x instanceof Error ? `${x.name}: ${x.message}\n${x.stack}` : JSON.stringify(x))).join(' ');
  const capture = () => {
    for (const m of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      const orig = (Logger.prototype as any)[m];
      (Logger.prototype as any)[m] = function (...a: unknown[]) { logs.push(fmt(a)); return orig.apply(this, a); };
      restores.push(() => { (Logger.prototype as any)[m] = orig; });
      const sOrig = (Logger as any)[m];
      (Logger as any)[m] = (...a: unknown[]) => { logs.push(fmt(a)); return sOrig.apply(Logger, a); };
      restores.push(() => { (Logger as any)[m] = sOrig; });
    }
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      const orig = (console as any)[m];
      (console as any)[m] = (...a: unknown[]) => { logs.push(fmt(a)); return orig.apply(console, a); };
      restores.push(() => { (console as any)[m] = orig; });
    }
    for (const s of [process.stdout, process.stderr]) {
      const orig = s.write.bind(s);
      (s as any).write = (chunk: any, ...rest: any[]) => { logs.push(String(chunk)); return (orig as any)(chunk, ...rest); };
      restores.push(() => { (s as any).write = orig; });
    }
  };

  // ---- Pessoas fictícias com marcador (só letras: o extrator lê nomes só com letras) ----
  const letters = (n: number) => String.fromCharCode(65 + Math.floor(n / 26) % 26) + String.fromCharCode(65 + (n % 26));
  const people: { name: string; cpf: { raw: string; fmt: string } }[] = [];
  const person = (tag = '') => {
    const n = people.length;
    const p = { name: `ZZPII${letters(n)}${tag} FICTICIO`, cpf: makeCpf(9000 + n * 13) };
    people.push(p);
    return p;
  };
  const NAME_RE = /ZZPII[A-Z]+/g;
  const cpfRes = () => people.flatMap((p) => [new RegExp(p.cpf.raw.split('').join('[^0-9]{0,8}')), new RegExp(p.cpf.raw.slice(0, 9).split('').join('[^0-9]{0,8}'))]);
  // Qualquer CPF formatado ou 11 dígitos soltos (mesmo de pessoa não cadastrada aqui).
  const GENERIC_CPF = [/\d{3}\.\d{3}\.\d{3}-\d{2}/, /(?<![0-9a-fA-F-])\d{11}(?![0-9a-fA-F])/];

  // ---- Respostas gravadas ----
  const bodies: { label: string; json: unknown; text: string }[] = [];
  const rec = <T extends request.Response>(label: string, res: T): T => {
    bodies.push({ label, json: res.body, text: res.text ?? '' });
    return res;
  };
  // Os nomes são permitidos em `full_name` e `evidence` dos itens PENDENTES (a revisão precisa mostrar quem é); o resto não.
  const stripAllowedNames = (v: any): any => {
    if (Array.isArray(v)) return v.map(stripAllowedNames);
    if (v && typeof v === 'object') {
      const pending = v.kind === 'novo' || v.kind === 'conflito' || v.kind === 'sugestao';
      return Object.fromEntries(Object.entries(v).filter(([k]) => !(pending && (k === 'full_name' || k === 'evidence'))).map(([k, x]) => [k, stripAllowedNames(x)]));
    }
    return v;
  };

  // ---- Provedor falso: devolve valores plausíveis a partir da linha do marcador e captura o texto recebido ----
  const received: string[] = [];
  const plausibleAi = async (text: string) => {
    received.push(text);
    const out: any[] = [];
    for (const line of text.split('\n')) {
      const ref = /\[CPF_(\d+)\]/.exec(line);
      if (!ref) continue;
      const m = /\] (.+?) Admissão \| (\d{2}\/\d{2}\/\d{4})/.exec(line);
      out.push({ cpf_ref: `CPF_${ref[1]}`, evidence: line, ...(m ? { position: m[1], admission_date: m[2] } : {}) });
    }
    return out;
  };

  // NOTA (achado do relatório da Task 7): o AllExceptionsFilter global (pré-existente) grava message+stack de todo 5xx; por isso
  // as falhas simuladas aqui usam mensagens SEM dado pessoal (o controller nunca repassa a mensagem ao log por conta própria).
  const send = (buf: Buffer, mime: string, name: string) =>
    request(app.getHttpServer()).post('/employees/documents').set(auth()).attach('file', buf, { filename: name, contentType: mime });
  const createEmp = async (body: Record<string, unknown>) => {
    const res = await request(app.getHttpServer()).post('/employees').set(auth()).send(body);
    expect(res.status).toBe(201);
    return res.body as { id: string };
  };
  const getOne = async (id: string) => rec(`GET extractions/${id}`, await request(app.getHttpServer()).get(`/employees/extractions/${id}`).set(auth()));
  const getList = async () => rec('GET extractions', await request(app.getHttpServer()).get('/employees/extractions?status=requer_revisao').set(auth()));
  const resolve = async (id: string, decisions: unknown) =>
    rec(`resolve ${id}`, await request(app.getHttpServer()).post(`/employees/extractions/${id}/resolve`).set(auth()).send({ decisions }));
  const lista = (ps: ReturnType<typeof person>[], pos = 'SOLDADOR') => [
    'Lista de funcionarios FICTICIA',
    ...ps.map((p, i) => `${p.name} ${p.cpf.fmt} ${pos} Admissão | ${String(1 + i).padStart(2, '0')}/0${1 + (i % 9)}/2020`),
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2Service).useValue({ putObject: jest.fn(), deleteObject: jest.fn(), getObject: jest.fn() })
      .overrideProvider(EMPLOYEE_EXTRACTION_PROVIDER).useValue(provider)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    db = new TestDb();
    await db.connect();
    const t = await db.createTenantWithUser('Empresa PII Sweep');
    tenantId = t.tenantId;
    token = (await request(app.getHttpServer()).post('/auth/login').send({ email: t.email, password: t.password })).body.access_token;
    redis = new Redis(process.env.REDIS_URL as string);
    capture();
  });
  beforeEach(async () => {
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    provider.extract.mockReset();
    provider.extract.mockImplementation(plausibleAi);
    process.env.EMPLOYEE_INGESTION_AI_ENABLED = 'true';
    process.env.EMPLOYEE_INGESTION_AI_DAILY_LIMIT = '1000';
  });
  afterAll(async () => {
    for (const r of restores.reverse()) r();
    delete process.env.EMPLOYEE_INGESTION_AI_ENABLED;
    delete process.env.EMPLOYEE_INGESTION_AI_DAILY_LIMIT;
    await redis.del(UPLOAD_RATE_LIMIT_KEY);
    redis.disconnect();
    await db.cleanup();
    await db.disconnect();
    await app.close();
  });

  const pending: string[] = [];
  const FAR = 'ZZPIIFAROUT FICTICIO'; // nome SEM CPF, longe de qualquer janela: nunca pode chegar ao provedor

  it('1) PDF com IA: existente vazio (sugestao), existente divergente (conflito), 2 novos; listagem, detalhe, reenvio reused, resolve aplicar/ignorar', async () => {
    const [e1, e2, n1, n2] = [person(), person(), person(), person()];
    await createEmp({ full_name: e1.name, cpf: e1.cpf.raw });
    await createEmp({ full_name: e2.name, cpf: e2.cpf.raw, position: 'GERENTE' });
    const filler = Array.from({ length: 60 }, (_v, i) => `Paragrafo de preenchimento ${i} que cita ${i === 30 ? FAR : 'ninguem'} sem documento algum e sem numeros longos aqui.`);
    const lines = lista([e1, e2]).concat(filler, lista([n1, n2]).slice(1));
    const buf = await pdfFromLines(lines);
    const up = rec('upload pdf', await send(buf, PDF_MIME, 'cadastro-pii.pdf'));
    expect(up.status).toBe(201);
    expect(up.body.status).toBe('requer_revisao');
    expect(up.body.summary).toMatchObject({ method: 'texto+ia', ai_used: true });
    expect(provider.extract).toHaveBeenCalled();
    const kinds = up.body.items.map((i: any) => i.kind).sort();
    expect(kinds).toEqual(['conflito', 'novo', 'novo', 'sugestao']);
    await getList();
    await getOne(up.body.id);
    const again = rec('reenvio pdf', await send(buf, PDF_MIME, 'cadastro-pii.pdf'));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ reused: true, id: up.body.id });
    const byKind = (k: string) => up.body.items.filter((i: any) => i.kind === k);
    const sug = byKind('sugestao')[0];
    const con = byKind('conflito')[0];
    const [novoA, novoB] = byKind('novo');
    const res = await resolve(up.body.id, [
      { line: sug.line, action: 'aplicar', fields: sug.suggestions.map((s: any) => s.field) },
      { line: con.line, action: 'ignorar' },
      { line: novoA.line, action: 'aplicar' },
      { line: novoB.line, action: 'ignorar' },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('aplicado');
    expect(res.body.items).toEqual([]);
  });

  it('2) DOCX (tabela Nome|CPF) com IA: upload, resolve aplicar e ignorar', async () => {
    const [d1, d2] = [person(), person()];
    const buf = await docxFrom([dtable([['Nome', 'CPF'], [d1.name, d1.cpf.fmt], [d2.name, d2.cpf.raw]])]);
    const up = rec('upload docx', await send(buf, DOCX_MIME, 'tabela-pii.docx'));
    expect(up.status).toBe(201);
    expect(up.body.status).toBe('requer_revisao');
    await getOne(up.body.id);
    const [a, b] = up.body.items;
    const res = await resolve(up.body.id, [{ line: a.line, action: 'aplicar' }, { line: b.line, action: 'ignorar' }]);
    expect(res.status).toBe(200);
  });

  it('3) XLSX com linhas inválidas (CPF malformado, CPF repetido): invalida só com linha+motivo; auto-aplicação e resolve', async () => {
    const [x1, x2, dup] = [person(), person(), person()];
    await createEmp({ full_name: x1.name, cpf: x1.cpf.raw });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cadastro');
    ['Funcionário', 'Matrícula eSocial', 'CPF', 'Data de Nascimento', 'Sexo F/M', 'Função/Cargo', 'Data de Admissão'].forEach((h, i) => (ws.getRow(8).getCell(i + 1).value = h));
    const rows = [[x1.name, '', x1.cpf.raw, '', 'F', 'SOLDADOR', ''], [x2.name, '', x2.cpf.fmt, '', '', 'PINTOR', ''], ['ZZPIIINVALIDO FICTICIO', '', '123.456', '', '', '', ''], [dup.name, '', dup.cpf.raw, '', '', '', ''], [dup.name, '', dup.cpf.raw, '', '', '', '']];
    rows.forEach((r, i) => r.forEach((v, c) => (ws.getRow(10 + i).getCell(c + 1).value = v)));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const up = rec('upload xlsx', await send(buf, XLSX_MIME, 'planilha-pii.xlsx'));
    expect(up.status).toBe(201);
    expect(provider.extract).not.toHaveBeenCalled();
    expect(up.body.summary.method).toBe('planilha');
    expect(up.body.summary.invalida).toBeGreaterThanOrEqual(2);
    for (const i of up.body.items.filter((x: any) => x.kind === 'invalida')) expect(Object.keys(i).sort()).toEqual(['kind', 'line', 'reason']);
    await getList();
    const pend = up.body.items.filter((i: any) => i.kind !== 'invalida');
    const res = await resolve(up.body.id, pend.map((i: any) => ({ line: i.line, action: 'aplicar', ...(i.kind === 'novo' ? {} : { fields: (i.conflicts ?? i.suggestions).map((f: any) => f.field) }) })));
    expect(res.status).toBe(200);
    expect(res.body.items.every((i: any) => i.kind === 'invalida')).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('4) provedor lança: segue só com regex, detalhe estático; falha na tx2 vira 500 genérico; nada vaza', async () => {
    const ps = [person(), person()];
    provider.extract.mockImplementation(async (text: string) => { received.push(text); throw new Error('falha simulada do provedor'); });
    const up = rec('upload provedor lança', await send(await pdfFromLines(lista(ps)), PDF_MIME, 'erro-provedor.pdf'));
    expect(up.status).toBe(201);
    expect(up.body.summary).toMatchObject({ method: 'texto', ai_used: false, ai_attempted: true, detail: 'Leitura por IA indisponível; o documento foi lido sem IA.' });
    pending.push(up.body.id);

    provider.extract.mockImplementation(plausibleAi);
    const qs = [person(), person()];
    const spy = jest.spyOn(app.get(EmployeeIngestionService), 'extract').mockRejectedValueOnce(new Error('falha simulada na tx2'));
    const bad = rec('upload erro tx2', await send(await pdfFromLines(lista(qs)), PDF_MIME, 'erro-tx2.pdf'));
    spy.mockRestore();
    expect(bad.status).toBe(500);
    expect(JSON.stringify(bad.body)).not.toMatch(/ZZPII|FICTICIO/);
  });

  it('5) imagem 400, documento de saúde, PDF escaneado, planilha-modelo vazia e PDF sem funcionários', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    expect(rec('imagem', await send(png, 'image/png', 'ZZPIIFOTO-FICTICIO.png')).status).toBe(400);
    const h = person('SAUDE');
    const health = rec('saude', await send(await pdfFromLines(['ASO - Atestado de Saúde Ocupacional', `Nome: ${h.name}`, `CPF: ${h.cpf.fmt}`, 'Exame clinico: apto', 'CID: Z10']), PDF_MIME, 'aso.pdf'));
    expect(health.status).toBe(201);
    expect(health.body.status).toBe('sem_dados');
    const scan = rec('escaneado', await send(await pdfFromLines([]), PDF_MIME, 'scan.pdf'));
    expect(scan.status).toBe(201);
    expect(scan.body.status).toBe('ilegivel');
    const nobody = person('SEMCPF');
    const none = rec('sem cpf', await send(await pdfFromLines([`Relatorio de visita de ${nobody.name}`, 'Sem documento algum.']), PDF_MIME, 'visita.pdf'));
    expect(none.body.status).toBe('sem_dados');
    // O provedor nunca recebeu o documento de saúde.
    expect(received.join('\n')).not.toContain(h.name);
  });

  it('6) VARREDURA: respostas HTTP, banco (candidates/summary/histórico/auditoria), log do processo e texto do provedor', async () => {
    // Resolve tudo o que ficou pendente (ignorar), para varrer o estado final do banco.
    const list = await getList();
    for (const e of list.body.items as any[]) {
      const full = await getOne(e.id);
      await resolve(e.id, full.body.items.filter((i: any) => i.kind !== 'invalida').map((i: any) => ({ line: i.line, action: 'ignorar' })));
    }
    const left = await request(app.getHttpServer()).get('/employees/extractions?status=requer_revisao').set(auth());
    expect(left.body.items).toEqual([]);

    const findings: string[] = [];
    const scan = (where: string, text: string, opts: { allowNames?: boolean } = {}) => {
      for (const re of cpfRes()) if (re.test(text)) findings.push(`${where}: CPF conhecido (${re.source.slice(0, 12)}...)`);
      for (const re of GENERIC_CPF) { const m = re.exec(text); if (m) findings.push(`${where}: padrão de CPF "${m[0].slice(0, 3)}***"`); }
      if (!opts.allowNames) { const m = text.match(NAME_RE); if (m) findings.push(`${where}: nome marcador ${m[0]}`); }
    };

    // Autoteste do varredor e da captura: um vazamento sintético TEM de ser visto (senão a varredura seria cega).
    const canary = person('CANARIO');
    new Logger('Canary').warn(`teste ${canary.name}`);
    process.stderr.write(`{"message":"${canary.cpf.fmt}"}\n`);
    expect(logs.some((l) => l.includes(canary.name))).toBe(true);
    expect(logs.some((l) => l.includes(canary.cpf.fmt))).toBe(true);
    scan('canario', `x ${canary.cpf.raw.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1 $2 $3 $4')} ${canary.name}`);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    findings.length = 0;
    people.pop(); // o canário não faz parte da varredura real
    // (a) corpos HTTP (nomes só nos itens pendentes)
    expect(bodies.length).toBeGreaterThan(15);
    for (const b of bodies) { scan(`http[${b.label}] json`, JSON.stringify(stripAllowedNames(b.json))); scan(`http[${b.label}] texto bruto`, b.text, { allowNames: true }); }
    // (b) banco: depois de resolver, candidates só tem invalida (linha+motivo) e nada de nome/CPF em candidates/summary
    const ex = (await sql('SELECT id, status, summary, candidates FROM employee_document_extractions WHERE tenant_id = $1', [tenantId])).rows;
    expect(ex.length).toBeGreaterThanOrEqual(8);
    for (const r of ex) {
      scan(`db summary ${r.status}`, JSON.stringify(r.summary));
      scan(`db candidates ${r.status}`, JSON.stringify(r.candidates));
      for (const c of r.candidates as any[]) {
        if (c.kind !== 'invalida' || Object.keys(c).sort().join() !== 'kind,line,reason') findings.push(`db candidates: item ${c.kind} sobrou após o resolve (${r.status})`);
      }
    }
    expect(ex.some((r: any) => (r.candidates as any[]).some((c) => c.kind === 'invalida'))).toBe(true);
    // (c) histórico: CPF só mascarado; nome só no campo full_name do próprio funcionário
    const hist = (await sql('SELECT field, old_value, new_value, source FROM employee_field_history WHERE tenant_id = $1', [tenantId])).rows;
    expect(hist.length).toBeGreaterThan(0);
    for (const h of hist) {
      scan(`history ${h.field}`, `${h.old_value ?? ''} ${h.new_value ?? ''}`, { allowNames: h.field === 'full_name' });
      if (h.field === 'cpf') expect(`${h.new_value}`).toMatch(/^\*\*\*\.\*\*\*\.\*\*\*-\d{2}$/);
    }
    // auditoria do tenant (rota, detalhe)
    const audit = (await sql('SELECT row_to_json(a)::text AS j FROM audit_log a WHERE actor_tenant_id = $1', [tenantId])).rows;
    for (const a of audit) scan('audit_log', a.j);
    // documentos: título = nome do arquivo (não carrega nome de pessoa neste teste)
    // (d) log do processo
    expect(logs.length).toBeGreaterThan(5);
    for (const l of logs.filter((x) => !x.includes(canary.name) && !x.includes(canary.cpf.fmt))) scan('log', l);
    // (e) texto entregue ao provedor: nenhum CPF; nome só de quem tem CPF numa janela; nunca o nome solto, nem o de documento de saúde
    expect(received.length).toBeGreaterThan(0);
    for (const t of received) {
      scan('provedor', t, { allowNames: true });
      expect(t).not.toContain(FAR);
      expect(t).not.toMatch(/ZZPII[A-Z]*(SAUDE|SEMCPF)/);
    }
    // o cadastro de funcionários (employees.full_name) é o único destino legítimo do nome: confere que existe
    const emps = (await sql('SELECT count(*) AS n FROM employees WHERE tenant_id = $1 AND full_name LIKE $2', [tenantId, 'ZZPII%'])).rows[0].n;
    expect(Number(emps)).toBeGreaterThanOrEqual(3);

    process.stdout.write(`[varredura PII] respostas=${bodies.length} extracoes=${ex.length} historico=${hist.length} auditoria=${audit.length} linhasDeLog=${logs.length} chamadasAoProvedor=${received.length}\n`);
    expect(findings).toEqual([]);
  });
});
