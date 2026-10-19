import { deflateSync } from 'zlib';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { Worker } from 'worker_threads';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { DOCX_MIME_TYPE } from '../src/common/docx/docx-text.util';
import { extractBoundedText, WORKER_COMMON_OPTIONS, docParseSnapshot, BUSY_DETAIL, TOO_BIG_DETAIL, ENCRYPTED_DETAIL, PDF_PAGES_DETAIL, NO_TEXT_DETAIL } from '../src/employees/employee-document-text';

// Limites de tempo/memória da leitura de PDF/DOCX do cadastro (sondas p8/p8b da revisão de segurança, Fatia 4 Task 4).
// Tudo montado em memória; nenhum dado real.
jest.setTimeout(90_000);
const PDF = 'application/pdf';
const MB = 1024 * 1024;

const docxBomb = async (mb: number): Promise<Buffer> => {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const unit = '<w:p><w:r><w:t>x</w:t></w:r></w:p>';
  z.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + unit.repeat(Math.floor((mb * MB) / unit.length)) + '</w:body></w:document>');
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
const pdfKit = (draw: (d: any) => void, opts: any = {}): Promise<Buffer> =>
  new Promise((resolve) => {
    const d = new PDFDocument(opts);
    const chunks: Buffer[] = [];
    d.on('data', (c: Buffer) => chunks.push(c));
    d.on('end', () => resolve(Buffer.concat(chunks)));
    draw(d);
    d.end();
  });
const mkPdf = (content: Buffer) => {
  const z = deflateSync(content);
  const parts = ['%PDF-1.4\n', '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n', '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj\n', `4 0 obj<</Length ${z.length}/Filter/FlateDecode>>stream\n`];
  return Buffer.concat([Buffer.from(parts.join('')), z, Buffer.from('\nendstream endobj\ntrailer<</Root 1 0 R/Size 5>>\n%%EOF')]);
};

const okDocx = async () => {
  const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('Nome: ANA FICTICIA')] })] }] });
  return Buffer.from(await Packer.toBuffer(doc));
};

describe('extractBoundedText', () => {
  afterEach(() => jest.restoreAllMocks());

  for (const mb of [5, 40]) {
    it(`DOCX com document.xml de ${mb} MB inflado: ilegivel rápido, sem chamar o mammoth e sem estourar a memória`, async () => {
      const buf = await docxBomb(mb);
      expect(buf.length).toBeLessThan(200 * 1024);
      let peakRunning = 0;
      const iv = setInterval(() => { peakRunning = Math.max(peakRunning, docParseSnapshot().running); }, 2);
      const rss0 = process.memoryUsage().rss;
      const t0 = Date.now();
      const r = await extractBoundedText(DOCX_MIME_TYPE, buf);
      const ms = Date.now() - t0;
      const grow = (process.memoryUsage().rss - rss0) / MB;
      process.stdout.write(`[docx ${mb} MB] ms=${ms} rssGrowMB=${Math.round(grow)} arquivo=${buf.length}B\n`);
      expect(r).toEqual({ status: 'ilegivel', detail: TOO_BIG_DETAIL });
      clearInterval(iv);
      expect(peakRunning).toBe(0); // barrada no pré-teste: nenhuma permissão tomada, nenhum worker iniciado
      expect(ms).toBeLessThan(2000);
      expect(grow).toBeLessThan(150);
    });
  }

  it('DOCX normal continua lido', async () => {
    const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('Nome: ANA FICTICIA')] })] }] });
    const r = await extractBoundedText(DOCX_MIME_TYPE, Buffer.from(await Packer.toBuffer(doc)));
    expect(r).toMatchObject({ status: 'ok' });
    expect((r as any).text).toContain('Nome: ANA FICTICIA');
  });

  it('DOCX vazio e lixo: ilegivel com detail próprio', async () => {
    const empty = new Document({ sections: [{ children: [new Paragraph({ children: [] })] }] });
    expect(await extractBoundedText(DOCX_MIME_TYPE, Buffer.from(await Packer.toBuffer(empty)))).toEqual({ status: 'ilegivel', detail: 'O documento não tem texto.' });
    expect((await extractBoundedText(DOCX_MIME_TYPE, Buffer.from('nao e zip'))).status).toBe('ilegivel');
  });

  it('PDF de 200 páginas: lê só as 50 primeiras e registra o detail', async () => {
    const buf = await pdfKit((d) => { for (let i = 1; i <= 200; i++) { if (i > 1) d.addPage(); d.text(`PAGINA${i}X Nome: ANA FICTICIA`); } });
    const r = await extractBoundedText(PDF, buf);
    expect(r.status).toBe('ok');
    const text = (r as any).text as string;
    expect(text).toContain('PAGINA1X');
    expect(text).toContain('PAGINA50X');
    expect(text).not.toContain('PAGINA51X');
    expect(text).not.toContain('PAGINA200X');
    expect((r as any).detail).toBe(PDF_PAGES_DETAIL);
  });

  it('PDF normal curto: sem detail; PDF sem texto: detail por causa', async () => {
    const ok = await extractBoundedText(PDF, await pdfKit((d) => d.text('Nome: ANA FICTICIA')));
    expect(ok).toMatchObject({ status: 'ok' });
    expect((ok as any).detail).toBeUndefined();
    expect(await extractBoundedText(PDF, await pdfKit((d) => d.rect(50, 50, 100, 100).fill('#ccc')))).toEqual({ status: 'ilegivel', detail: NO_TEXT_DETAIL });
  });

  it('PDF cifrado (/Encrypt): ilegivel com detail de senha', async () => {
    const buf = await pdfKit((d) => d.text('Nome: ANA FICTICIA CPF 529.982.247-25'), { userPassword: 'x', ownerPassword: 'y' });
    expect(buf.includes('/Encrypt')).toBe(true);
    expect(await extractBoundedText(PDF, buf)).toEqual({ status: 'ilegivel', detail: ENCRYPTED_DETAIL });
  });

  it('PDF bomba (120 MB de operadores de texto): ilegivel por tempo/memória (< 25 s) e o loop segue livre (a leitura roda em worker, encerrado no estouro)', async () => {
    const N = 120 * MB;
    const buf = mkPdf(Buffer.from('BT /F1 12 Tf (A) Tj ET '.repeat(Math.floor(N / 23))));
    expect(buf.length).toBeLessThan(1 * MB);
    let maxLag = 0;
    let last = Date.now();
    const iv = setInterval(() => { const n = Date.now(); maxLag = Math.max(maxLag, n - last - 50); last = n; }, 50);
    const t0 = Date.now();
    const r = await extractBoundedText(PDF, buf);
    const ms = Date.now() - t0;
    clearInterval(iv);
    process.stdout.write(`[pdf bomba 120 MB] ms=${ms} status=${r.status} maxLagMs=${maxLag}\n`);
    expect(maxLag).toBeLessThan(500);
    expect(ms).toBeLessThan(25_000);
    expect(r.status).toBe('ilegivel');
  });

  // ---- Variantes pesadas (sondas q1/q2 da re-revisão): o loop principal não pode congelar ----
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const CT = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  const RELS = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  const wdoc = (body: string) => `<?xml version="1.0"?><w:document ${NS}><w:body>${body}</w:body></w:document>`;
  const mk = async (parts: Record<string, string>, extra?: (z: JSZip) => void) => {
    const z = new JSZip();
    z.file('[Content_Types].xml', CT);
    z.file('_rels/.rels', RELS);
    for (const [k, v] of Object.entries(parts)) z.file(k, v);
    extra?.(z);
    return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  };
  const rep = (u: string, bytes: number) => u.repeat(Math.floor(bytes / u.length));
  const P = '<w:p><w:r><w:t>x</w:t></w:r></w:p>';
  const T = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  const heavy = () => mk({ 'word/document.xml': wdoc(rep(T, 2.9 * MB)) }); // legítimo no limite do pré-teste, caro para o mammoth
  const lagRun = async (buf: Buffer, tenant?: string) => {
    let maxLag = 0;
    let last = Date.now();
    const iv = setInterval(() => { const n = Date.now(); maxLag = Math.max(maxLag, n - last - 20); last = n; }, 20);
    const rss0 = process.memoryUsage().rss;
    const t0 = Date.now();
    const r = await extractBoundedText(DOCX_MIME_TYPE, buf, tenant);
    clearInterval(iv);
    return { r, ms: Date.now() - t0, maxLag, rssGrowMB: Math.round((process.memoryUsage().rss - rss0) / MB) };
  };

  describe('DOCX pesado: lag do loop principal <= 100 ms em todas as variantes', () => {
    const variants: [string, () => Promise<Buffer>, 'ok' | 'ilegivel'][] = [
      ['A document.xml 2,9 MB de parágrafos', () => mk({ 'word/document.xml': wdoc(rep(P, 2.9 * MB)) }), 'ok'],
      ['B document.xml 2,9 MB de tabelas', heavy, 'ok'],
      ['B2 document.xml 2,9 MB de elementos vazios', () => mk({ 'word/document.xml': wdoc(rep('<w:r/>', 2.9 * MB)) }), 'ok'],
      ['B3 aninhamento 2,9 MB', () => mk({ 'word/document.xml': wdoc('<w:tbl><w:tr><w:tc>'.repeat(Math.floor((2.9 * MB) / 42)) + '<w:p/>' + '</w:tc></w:tr></w:tbl>'.repeat(Math.floor((2.9 * MB) / 42))) }), 'ok'],
      ['C styles.xml 19 MB (pré-teste: outro XML > 4 MB)', () => mk({ 'word/document.xml': wdoc(P.repeat(10)), 'word/styles.xml': `<?xml version="1.0"?><w:styles ${NS}>` + rep('<w:style w:type="paragraph" w:styleId="s"><w:name w:val="n"/></w:style>', 19 * MB) + '</w:styles>' }), 'ilegivel'],
      ['C2 numbering.xml 19 MB', () => mk({ 'word/document.xml': wdoc(P.repeat(10)), 'word/numbering.xml': `<?xml version="1.0"?><w:numbering ${NS}>` + rep('<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"/></w:abstractNum>', 19 * MB) + '</w:numbering>' }), 'ilegivel'],
      ['C3 numbering.xml 3,9 MB (dentro do limite)', () => mk({ 'word/document.xml': wdoc(P.repeat(10)), 'word/numbering.xml': `<?xml version="1.0"?><w:numbering ${NS}>` + rep('<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"/></w:abstractNum>', 3.9 * MB) + '</w:numbering>' }), 'ok'],
      ['D 100 entradas x 190 KB', () => mk({ 'word/document.xml': wdoc(P.repeat(10)) }, (z) => { for (let i = 0; i < 100; i++) z.file(`word/e${i}.xml`, rep('<a/>', 190 * 1024)); }), 'ok'],
      ['E sem document.xml, xml 15 MB', () => mk({ 'word/other.xml': rep('<a/>', 15 * MB) }, (z) => z.remove('_rels/.rels')), 'ilegivel'],
      ['F entradas com ../', () => mk({ 'word/document.xml': wdoc(P.repeat(10)), '../evil.xml': 'x' }), 'ok'],
    ];
    for (const [label, build, expected] of variants) {
      it(label, async () => {
        const { r, ms, maxLag, rssGrowMB } = await lagRun(await build());
        process.stdout.write(`[${label}] status=${r.status} ms=${ms} lagMs=${maxLag} rssGrowMB=${rssGrowMB}\n`);
        expect(maxLag).toBeLessThanOrEqual(100);
        expect(docParseSnapshot()).toEqual({ running: 0, queued: 0 });
        if (expected === 'ilegivel') expect(r).toEqual({ status: 'ilegivel', detail: TOO_BIG_DETAIL });
        else expect(['ok', 'ilegivel']).toContain(r.status); // lê ou recusa por conteúdo, mas nunca congela
      });
    }
  });

  // ---- Semáforo de leituras pesadas ----
  describe('semáforo de leituras simultâneas', () => {
    const ENV = ['EMPLOYEE_DOC_PARSE_MAX_CONCURRENCY', 'EMPLOYEE_DOC_PARSE_QUEUE_MAX', 'EMPLOYEE_DOC_PARSE_WAIT_MS', 'EMPLOYEE_DOC_PARSE_TIMEOUT_MS', 'EMPLOYEE_DOC_PARSE_TENANT_CONCURRENCY', 'EMPLOYEE_DOC_PARSE_TENANT_QUEUE_MAX'];
    afterEach(() => { for (const k of ENV) delete process.env[k]; });
    const peakOf = () => {
      const st = { peak: 0 };
      const iv = setInterval(() => { st.peak = Math.max(st.peak, docParseSnapshot().running); }, 2);
      return { st, stop: () => clearInterval(iv) };
    };

    it('(a) concorrência 2 com 5 leituras simultâneas de DOCX e PDF: no máximo 2 em execução e todas terminam', async () => {
      process.env.EMPLOYEE_DOC_PARSE_MAX_CONCURRENCY = '2';
      const docx = await heavy();
      const pdfBuf = await pdfKit((d) => d.text('Nome: ANA FICTICIA'));
      const pk = peakOf();
      const rs = await Promise.all([extractBoundedText(DOCX_MIME_TYPE, docx), extractBoundedText(PDF, pdfBuf), extractBoundedText(DOCX_MIME_TYPE, docx), extractBoundedText(PDF, pdfBuf), extractBoundedText(DOCX_MIME_TYPE, docx)]);
      pk.stop();
      expect(rs.every((r) => r.status === 'ok')).toBe(true);
      expect(pk.st.peak).toBe(2);
      expect(docParseSnapshot()).toEqual({ running: 0, queued: 0 });
    });

    it('(b) fila cheia (concorrência 1, fila 2, 6 leituras): as excedentes recebem o erro estático sem lançar', async () => {
      process.env.EMPLOYEE_DOC_PARSE_MAX_CONCURRENCY = '1';
      process.env.EMPLOYEE_DOC_PARSE_QUEUE_MAX = '2';
      const docx = await heavy();
      const rs = await Promise.all(Array.from({ length: 6 }, () => extractBoundedText(DOCX_MIME_TYPE, docx)));
      expect(rs.filter((r) => r.status === 'ok')).toHaveLength(3);
      const busy = rs.filter((r) => r.status === 'erro');
      expect(busy).toHaveLength(3);
      for (const r of busy) expect(r).toEqual({ status: 'erro', detail: BUSY_DETAIL });
      expect(docParseSnapshot()).toEqual({ running: 0, queued: 0 });
    });

    it('espera acima do limite vira o mesmo erro estático e sai da fila', async () => {
      process.env.EMPLOYEE_DOC_PARSE_MAX_CONCURRENCY = '1';
      process.env.EMPLOYEE_DOC_PARSE_WAIT_MS = '100';
      const docx = await heavy();
      const [a, b] = await Promise.all([extractBoundedText(DOCX_MIME_TYPE, docx), extractBoundedText(DOCX_MIME_TYPE, docx)]);
      // Qual dos dois termina o pré-teste primeiro depende da carga: um lê, o outro desiste da fila.
      expect([a.status, b.status].sort()).toEqual(['erro', 'ok']);
      expect([a, b].find((r) => r.status === 'erro')).toEqual({ status: 'erro', detail: BUSY_DETAIL });
      expect(docParseSnapshot()).toEqual({ running: 0, queued: 0 });
    });

    it('(c) terminate no timeout e permissão devolvida após exceção/timeout: a 11ª leitura ainda roda', async () => {
      process.env.EMPLOYEE_DOC_PARSE_MAX_CONCURRENCY = '1';
      const docx = await heavy();
      const broken = await mk({ 'word/document.xml': 'isto nao e xml <<<' });
      for (let i = 0; i < 10; i++) {
        let r;
        if (i % 2 === 0) r = await extractBoundedText(DOCX_MIME_TYPE, broken);
        else {
          process.env.EMPLOYEE_DOC_PARSE_TIMEOUT_MS = '80';
          const t0 = Date.now();
          r = await extractBoundedText(DOCX_MIME_TYPE, docx);
          expect(Date.now() - t0).toBeLessThan(7500); // terminate: não espera o mammoth acabar
          delete process.env.EMPLOYEE_DOC_PARSE_TIMEOUT_MS;
          expect(r).toEqual({ status: 'ilegivel', detail: TOO_BIG_DETAIL });
        }
        expect(r.status).toBe('ilegivel');
        expect(docParseSnapshot().running).toBe(0);
      }
      expect((await extractBoundedText(DOCX_MIME_TYPE, await okDocx())).status).toBe('ok');
      // PDF: timeout do worker também devolve a permissão.
      process.env.EMPLOYEE_DOC_PARSE_TIMEOUT_MS = '50';
      const big = mkPdf(Buffer.from('BT /F1 12 Tf (A) Tj ET '.repeat(Math.floor((60 * MB) / 23))));
      expect((await extractBoundedText(PDF, big)).status).toBe('ilegivel');
      expect(docParseSnapshot().running).toBe(0);
      delete process.env.EMPLOYEE_DOC_PARSE_TIMEOUT_MS;
      expect((await extractBoundedText(PDF, await pdfKit((d) => d.text('Nome: ANA FICTICIA')))).status).toBe('ok');
    });

    it('(c2) a variável de timeout é ignorada em produção', async () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      process.env.EMPLOYEE_DOC_PARSE_TIMEOUT_MS = '1';
      try {
        expect((await extractBoundedText(DOCX_MIME_TYPE, await okDocx())).status).toBe('ok');
      } finally {
        process.env.NODE_ENV = prev;
      }
    });

    it('(e) a bomba de DOCX barrada pelo pré-teste não ocupa permissão nem entra na fila', async () => {
      process.env.EMPLOYEE_DOC_PARSE_MAX_CONCURRENCY = '1';
      process.env.EMPLOYEE_DOC_PARSE_QUEUE_MAX = '0';
      const bombBuf = await docxBomb(40);
      const docx = await heavy();
      const holder = extractBoundedText(DOCX_MIME_TYPE, docx); // ocupa a única permissão
      for (let i = 0; i < 400 && docParseSnapshot().running < 1; i++) await new Promise((r) => setTimeout(r, 25)); // espera a permissão
      expect(docParseSnapshot()).toEqual({ running: 1, queued: 0 });
      const t0 = Date.now();
      const bomb = await extractBoundedText(DOCX_MIME_TYPE, bombBuf);
      expect(bomb).toEqual({ status: 'ilegivel', detail: TOO_BIG_DETAIL }); // não é o erro de fila cheia
      expect(Date.now() - t0).toBeLessThan(5000); // folga para carga; o importante é não ser o erro de fila cheia nem tomar permissão
      expect(docParseSnapshot().running).toBeLessThanOrEqual(1);
      expect(docParseSnapshot().queued).toBe(0);
      await holder;
    });

    it('N2) cota por tenant: um tenant com 6 leituras concorrentes (1 em execução + 2 na fila) não impede outro de ler', async () => {
      process.env.EMPLOYEE_DOC_PARSE_MAX_CONCURRENCY = '2';
      const docx = await heavy();
      const pdfBuf = await pdfKit((d) => d.text('Nome: ANA FICTICIA'));
      const hog = Array.from({ length: 6 }, () => extractBoundedText(DOCX_MIME_TYPE, docx, 'tenant-hog'));
      // O pré-teste (inflar o ZIP) é assíncrono: espera as 3 posições (1 em execução + 2 na fila) se formarem.
      for (let i = 0; i < 200 && docParseSnapshot().queued < 2; i++) await new Promise((r) => setTimeout(r, 25));
      expect(docParseSnapshot()).toEqual({ running: 1, queued: 2 });
      const t0 = Date.now();
      const other = await extractBoundedText(PDF, pdfBuf, 'tenant-outro');
      expect(other.status).toBe('ok'); // não é o erro de fila: outro tenant não é barrado pela cota do primeiro
      process.stdout.write(`[N2] outro tenant leu em ${Date.now() - t0} ms com o hog ocupando\n`);
      const rs = await Promise.all(hog);
      expect(rs.filter((r) => r.status === 'ok')).toHaveLength(3);
      for (const r of rs.filter((x) => x.status === 'erro')) expect(r).toEqual({ status: 'erro', detail: BUSY_DETAIL });
      expect(rs.filter((x) => x.status === 'erro')).toHaveLength(3);
      expect(docParseSnapshot()).toEqual({ running: 0, queued: 0 });
    });
  });

  describe('workers sem segredos do processo', () => {
    it('o worker NÃO enxerga MINIMAX_API_KEY nem outras variáveis, e a leitura de PDF/DOCX continua funcionando', async () => {
      process.env.MINIMAX_API_KEY = 'chave-falsa-de-teste';
      process.env.JWT_SECRET_FAKE_PROBE = 'segredo-falso';
      try {
        // Worker de sonda criado no TESTE com exatamente as opções dos workers de produção.
        const keys: string[] = await new Promise((resolve, reject) => {
          const w = new Worker("require('worker_threads').parentPort.postMessage(Object.keys(process.env));", { eval: true, ...WORKER_COMMON_OPTIONS });
          w.once('message', (m) => { void w.terminate(); resolve(m as string[]); });
          w.once('error', reject);
        });
        expect(keys).toEqual([]);
        expect(keys).not.toContain('MINIMAX_API_KEY');
        expect((await extractBoundedText(PDF, await pdfKit((d) => d.text('Nome: ANA FICTICIA')))).status).toBe('ok');
        expect((await extractBoundedText(DOCX_MIME_TYPE, await okDocx())).status).toBe('ok');
      } finally {
        delete process.env.MINIMAX_API_KEY;
        delete process.env.JWT_SECRET_FAKE_PROBE;
      }
    });
  });
});
