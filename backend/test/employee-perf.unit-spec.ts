import { Paragraph, TextRun } from 'docx';
import { extractBoundedText } from '../src/employees/employee-document-text';
import { extractLocalPeople } from '../src/employees/employee-text-extractor';
import { classifyRows } from '../src/employees/employee-ingestion.classifier';
import { DOCX_MIME, PDF_MIME, docxFrom, dtable, makeCpf, pdfFromLines } from './employee-docgen';
import PDFDocument from 'pdfkit';

// MEDIÇÃO de desempenho do caminho de leitura (extractBoundedText + extractLocalPeople + classifyRows) com PDF/DOCX reais
// de 1/20/100/200 páginas e 10/100/500/2000 CPFs. Imprime a tabela; os limites afirmados são DE PROPÓSITO muito folgados
// (só pegam regressão grosseira: > 60 s, > 1,5 GB de RSS ou event loop travado por > 3 s). Dados 100% sintéticos.
jest.setTimeout(600_000);
const MB = 1048576;
const PAGES = [1, 20, 100, 200];
const CPFS = [10, 100, 500, 2000];

const personLine = (i: number) => `${['ALINE', 'BENTO', 'CELIA', 'DANILO'][i % 4]} ${['AGUIAR', 'BARROS', 'CAMPOS', 'DUARTE', 'ESTEVES'][Math.floor(i / 4) % 5]} FICTICIO${i} ${makeCpf(i).fmt} SOLDADOR`.replace(/\d+(?= \d{3}\.)/, '');
const FILLER = 'Texto de preenchimento da pagina sem relacao com nenhum funcionario e sem numeros longos.';

const nameOf = (i: number) => `${['ALINE', 'BENTO', 'CELIA', 'DANILO'][i % 4]} ${['AGUIAR', 'BARROS', 'CAMPOS', 'DUARTE', 'ESTEVES'][Math.floor(i / 4) % 5]} ${'ABCDEFGHIJ'[i % 10]}${'KLMNOPQRST'[Math.floor(i / 10) % 10]}${'UVWXYZABCD'[Math.floor(i / 100) % 10]}${'EFGHIJKLMN'[Math.floor(i / 1000) % 10]} FICTICIO`;
const fichaLines = (i: number) => [`Nome: ${nameOf(i)}`, `CPF: ${makeCpf(i).fmt}`, 'Função: SOLDADOR', 'Admissão: 05/01/2020'];
// Distribui as pessoas por páginas; páginas a mais ficam com texto de preenchimento.
function plan(pages: number, cpfs: number, style: 'lista' | 'ficha' = 'lista'): string[][] {
  const per = Math.ceil(cpfs / pages);
  const out: string[][] = [];
  for (let p = 0; p < pages; p++) {
    const lines: string[] = [`Pagina ${p + 1} - Relacao de funcionarios FICTICIA`];
    for (let k = p * per; k < Math.min(cpfs, (p + 1) * per); k++) lines.push(...(style === 'ficha' ? fichaLines(k) : [personLine(k)]));
    if (lines.length < 4) lines.push(FILLER, FILLER);
    out.push(lines);
  }
  return out;
}
const pdfBuf = (pages: string[][]) =>
  new Promise<Buffer>((resolve) => {
    const d = new PDFDocument({ size: 'A4', margin: 30 });
    const chunks: Buffer[] = [];
    d.on('data', (c: Buffer) => chunks.push(c));
    d.on('end', () => resolve(Buffer.concat(chunks)));
    d.fontSize(9);
    pages.forEach((lines, i) => { if (i > 0) d.addPage(); for (const l of lines) d.text(l); });
    d.end();
  });
const docxBuf = (pages: string[][]) =>
  docxFrom(pages.flatMap((lines, pi) => lines.map((l, li) => new Paragraph({ pageBreakBefore: pi > 0 && li === 0, children: [new TextRun(l)] }))));

interface Row { kind: string; pages: number; cpfs: number; kb: number; textKB: number; people: number; readMs: number; regexMs: number; classMs: number; totalMs: number; rssPeakMB: number; lagMs: number; status: string }
const rows: Row[] = [];

async function measure(kind: 'PDF' | 'DOCX', pages: number, cpfs: number, style: 'lista' | 'ficha' | 'tabela' = 'lista') {
  const pl = plan(pages, cpfs, style === 'ficha' ? 'ficha' : 'lista');
  const buf = style === 'tabela' ? await docxFrom([dtable([['Nome', 'CPF', 'Função', 'Admissão'], ...Array.from({ length: cpfs }, (_v, i) => [nameOf(i), makeCpf(i).fmt, 'SOLDADOR', '05/01/2020'])])]) : kind === 'PDF' ? await pdfBuf(pl) : await docxBuf(pl);
  const mime = kind === 'PDF' ? PDF_MIME : DOCX_MIME;
  if (global.gc) global.gc();
  const rss0 = process.memoryUsage().rss;
  let peak = rss0;
  let lag = 0;
  let last = Date.now();
  const iv = setInterval(() => {
    const now = Date.now();
    lag = Math.max(lag, now - last - 10);
    last = now;
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 10);
  const t0 = Date.now();
  const bounded = await extractBoundedText(mime, buf, 'perf-tenant');
  const t1 = Date.now();
  let people = 0; let t2 = t1; let t3 = t1;
  if (bounded.status === 'ok') {
    const ps = extractLocalPeople(bounded.text);
    t2 = Date.now();
    people = ps.length;
    classifyRows(ps.map((p, i) => ({ line: i + 1, values: { ...p.values, cpf: p.cpf }, reviewOnly: Object.keys(p.values) as any, evidence: p.evidence })), new Map(), null);
    t3 = Date.now();
  }
  clearInterval(iv);
  peak = Math.max(peak, process.memoryUsage().rss);
  const r: Row = {
    kind: style === 'lista' ? kind : `${kind}/${style}`, pages, cpfs, kb: Math.round(buf.length / 1024), textKB: bounded.status === 'ok' ? Math.round(bounded.text.length / 1024) : 0, people,
    readMs: t1 - t0, regexMs: t2 - t1, classMs: t3 - t2, totalMs: t3 - t0, rssPeakMB: Math.round((peak - rss0) / MB), lagMs: lag, status: bounded.status,
  };
  rows.push(r);
  expect(r.totalMs).toBeLessThan(60_000);
  expect(r.rssPeakMB).toBeLessThan(1500);
  expect(r.lagMs).toBeLessThan(3000);
  expect(bounded.status).toBe('ok');
  if (style !== 'lista') {
    // PDF de ficha com 2000 pessoas passa de 50 páginas físicas: só as 50 primeiras são lidas (e o aviso estático acompanha).
    if (kind === 'PDF' && cpfs >= 2000) { expect(people).toBeGreaterThanOrEqual(500); expect((bounded as { detail?: string }).detail).toContain('50 páginas'); } else expect(people).toBeGreaterThanOrEqual(Math.floor(cpfs * 0.9));
    return;
  }
  // Sem perda grosseira: com PDF o teto é 50 páginas; fora disso quase todas as pessoas são lidas.
  const readable = kind === 'PDF' ? Math.min(cpfs, Math.ceil(cpfs / pages) * Math.min(pages, 50)) : cpfs;
  expect(people).toBeGreaterThanOrEqual(Math.floor(readable * 0.9));
}

describe('desempenho do caminho de leitura de PDF/DOCX', () => {
  for (const kind of ['PDF', 'DOCX'] as const) {
    for (const pages of PAGES) {
      for (const cpfs of CPFS) {
        it(`${kind} ${pages} páginas, ${cpfs} CPFs`, () => measure(kind, pages, cpfs));
      }
    }
  }
  for (const cpfs of [500, 2000]) {
    it(`PDF/ficha 20 páginas, ${cpfs} CPFs (4 linhas por pessoa)`, () => measure('PDF', 20, cpfs, 'ficha'));
    it(`DOCX/ficha 20 páginas, ${cpfs} CPFs (4 parágrafos por pessoa)`, () => measure('DOCX', 20, cpfs, 'ficha'));
    it(`DOCX/tabela ${cpfs} CPFs (uma tabela com cabeçalho)`, () => measure('DOCX', 1, cpfs, 'tabela'));
  }
  afterAll(() => {
    const hdr = 'tipo        paginas cpfs  arquivoKB textoKB pessoas leituraMs regexMs classifMs totalMs pico+RSS(MB) lagLoop(ms) status';
    const body = rows.map((r) => [r.kind.padEnd(11), String(r.pages).padStart(6), String(r.cpfs).padStart(5), String(r.kb).padStart(9), String(r.textKB).padStart(7), String(r.people).padStart(7), String(r.readMs).padStart(9), String(r.regexMs).padStart(7), String(r.classMs).padStart(9), String(r.totalMs).padStart(7), String(r.rssPeakMB).padStart(13), String(r.lagMs).padStart(12), r.status].join(' '));
    // eslint-disable-next-line no-console
    console.log(`PERF\n${hdr}\n${body.join('\n')}`);
  });
});
void pdfFromLines;
