import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import { extractFullText } from '../src/common/documents/extract-full-text.util';
import { extractLocalPeople } from '../src/employees/employee-text-extractor';

// Textos gerados pelos GERADORES REAIS (pdfkit -> pdf-parse; docx -> mammoth) e lidos por extractFullText:
// a segmentação precisa funcionar com o que os extratores realmente devolvem (sem linha em branco no PDF, "\n\n" no DOCX).
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const CPFS = ['529.982.247-25', '111.444.777-35', '168.995.350-09'];
function makeCpf(n: number): string {
  const b = String(100000000 + n * 7919 + 13).slice(0, 9).split('').map(Number);
  const dv = (d: number[]) => { const s = d.reduce((a, v, i) => a + v * (d.length + 1 - i), 0); const r = (s * 10) % 11; return r >= 10 ? 0 : r; };
  const d1 = dv(b); const d2 = dv([...b, d1]);
  const s = [...b, d1, d2].join('');
  return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
}
const NOMES = ['ANA FICTICIA', 'BRUNO FICTICIO', 'CARLA FICTICIA'];
const CARGOS = ['SOLDADORA', 'ELETRICISTA', 'PINTORA'];
const ADM = ['05/01/2020', '18/06/2018', '01/03/2021'];

async function pdf(lines: (string | null)[], size = 12): Promise<Buffer> {
  return new Promise((resolve) => {
    const d = new PDFDocument({ size: 'A4', margin: 30 });
    const chunks: Buffer[] = [];
    d.on('data', (c: Buffer) => chunks.push(c));
    d.on('end', () => resolve(Buffer.concat(chunks)));
    d.fontSize(size);
    for (const l of lines) { if (l === null) d.moveDown(1); else d.text(l); }
    d.end();
  });
}
const P = (t: string) => new Paragraph({ children: [new TextRun(t)] });
async function docx(children: (Paragraph | Table)[]): Promise<Buffer> {
  return Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children }] })));
}
const cell = (t: string) => new TableCell({ children: [P(t)] });
const row = (cells: string[]) => new TableRow({ children: cells.map(cell) });

type Exp = Record<string, Record<string, string>>; // cpf (11 dígitos) -> valores esperados
const digits = (c: string) => c.replace(/\D/g, '');
const recall: { layout: string; expected: number; correct: number; wrong: number }[] = [];

async function check(layout: string, mime: string, buf: Buffer, expected: Exp) {
  const text = await extractFullText(mime, buf);
  expect(text).toBeTruthy();
  const people = extractLocalPeople(text as string);
  expect(people.map((p) => p.cpf).sort()).toEqual(Object.keys(expected).sort()); // todas as pessoas identificadas pelo CPF
  let exp = 0; let ok = 0; let wrong = 0;
  for (const [cpf, ev] of Object.entries(expected)) {
    const got = people.find((p) => p.cpf === cpf);
    exp += Object.keys(ev).length;
    for (const [k, v] of Object.entries(got?.values ?? {})) {
      if (ev[k] === v) ok++; else wrong++; // valor fora do esperado = erro (cruzamento ou leitura errada)
    }
  }
  recall.push({ layout, expected: exp, correct: ok, wrong });
  expect(wrong).toBe(0);
  return { people, text: text as string };
}

function expFor(n: number, fields: string[] = ['full_name', 'position', 'admission_date']): Exp {
  const out: Exp = {};
  for (let i = 0; i < n; i++) {
    const all: Record<string, string> = { full_name: NOMES[i], position: CARGOS[i], admission_date: ADM[i] };
    out[digits(CPFS[i])] = Object.fromEntries(fields.map((f) => [f, all[f]]));
  }
  return out;
}
const fichaNomeFirst = (i: number) => [`Nome: ${NOMES[i]}`, `CPF: ${CPFS[i]}`, `Função: ${CARGOS[i]}`, `Admissão: ${ADM[i]}`];
const fichaCpfFirst = (i: number) => [`CPF: ${CPFS[i]}`, `Nome: ${NOMES[i]}`, `Função: ${CARGOS[i]}`, `Admissão: ${ADM[i]}`];

afterAll(() => {
  const rows = recall.map((r) => `${r.layout.padEnd(58)} ${String(r.correct).padStart(3)}/${String(r.expected).padEnd(3)} errados=${r.wrong}`);
  // eslint-disable-next-line no-console
  console.log(`RECALL (campos corretos / esperados)\n${rows.join('\n')}`);
});

describe('extrator de texto livre com PDF e DOCX reais', () => {
  it.each([2, 3])('ficha vertical nome-primeiro, %i pessoas, PDF sem linha em branco', async (n) => {
    const lines = Array.from({ length: n }, (_, i) => fichaNomeFirst(i)).flat();
    await check(`PDF ficha nome-primeiro (${n} pessoas)`, PDF, await pdf(lines), expFor(n));
  });

  it.each([2, 3])('ficha vertical nome-primeiro, %i pessoas, DOCX sem e com parágrafo vazio', async (n) => {
    const semVazio = Array.from({ length: n }, (_, i) => fichaNomeFirst(i).map(P)).flat();
    await check(`DOCX ficha nome-primeiro (${n} pessoas, sem vazio)`, DOCX, await docx(semVazio), expFor(n));
    const comVazio = Array.from({ length: n }, (_, i) => [...fichaNomeFirst(i).map(P), P('')]).flat();
    await check(`DOCX ficha nome-primeiro (${n} pessoas, com vazio)`, DOCX, await docx(comVazio), expFor(n));
  });

  it('ficha cpf-primeiro (PDF e DOCX)', async () => {
    const lines = [0, 1, 2].flatMap(fichaCpfFirst);
    await check('PDF ficha cpf-primeiro (3 pessoas)', PDF, await pdf(lines), expFor(3));
    await check('DOCX ficha cpf-primeiro (3 pessoas)', DOCX, await docx(lines.map(P)), expFor(3));
  });

  it('campo faltando em UMA pessoa: some para todas, sem cruzamento', async () => {
    const faltando = [fichaNomeFirst(0), fichaNomeFirst(1).filter((l) => !l.startsWith('Função')), fichaNomeFirst(2)].flat();
    const { people } = await check('PDF ficha com Função faltando em 1 de 3', PDF, await pdf(faltando), { ...expFor(3) });
    for (const p of people) expect(p.values.position).toBeUndefined();
    const r = await check('DOCX ficha com Função faltando em 1 de 3', DOCX, await docx(faltando.map(P)), expFor(3));
    for (const p of r.people) expect(p.values.position).toBeUndefined();
  });

  it('ficha + rodapé "Responsável/Nome/Cargo" não contamina', async () => {
    const lines = [...fichaNomeFirst(0), ...fichaNomeFirst(1), 'Responsável técnico', 'Nome: JOSE ASSINANTE', 'Cargo: GERENTE RH'];
    const r1 = await check('PDF 2 fichas + rodapé Responsável', PDF, await pdf(lines), expFor(2));
    const r2 = await check('DOCX 2 fichas + rodapé Responsável', DOCX, await docx(lines.map(P)), expFor(2));
    for (const p of [...r1.people, ...r2.people]) expect(JSON.stringify(p.values)).not.toMatch(/JOSE|GERENTE/);
  });

  it('tabela DOCX (cabeçalho + 3 linhas) e aborto com célula vazia', async () => {
    const header = row(['Nome', 'CPF', 'Função']);
    const ok = new Table({ rows: [header, ...[0, 1, 2].map((i) => row([NOMES[i], CPFS[i], CARGOS[i]]))] });
    await check('DOCX tabela cabeçalho + 3 linhas', DOCX, await docx([ok]), expFor(3, ['full_name', 'position']));
    const vazia = new Table({ rows: [header, row([NOMES[0], CPFS[0], CARGOS[0]]), row([NOMES[1], CPFS[1], '']), row([NOMES[2], CPFS[2], CARGOS[2]])] });
    const r = await check('DOCX tabela com célula vazia (aborta)', DOCX, await docx([vazia]), expFor(3, ['full_name', 'position']));
    for (const p of r.people) expect(p.values).toEqual({});
  });

  it('lista PDF de 1 linha por pessoa (sem rótulos)', async () => {
    const lines = [0, 1, 2].map((i) => `${NOMES[i]} ${CPFS[i]} ${CARGOS[i]} ${ADM[i]}`);
    await check('PDF lista 1 linha por pessoa (nome antes do CPF)', PDF, await pdf(lines), expFor(3, ['full_name']));
  });

  it('tabela DOCX de 2 colunas "Nome:"/valor', async () => {
    const rows: TableRow[] = [];
    for (const i of [0, 1, 2]) rows.push(row(['Nome:', NOMES[i]]), row(['CPF:', CPFS[i]]), row(['Função:', CARGOS[i]]));
    await check('DOCX tabela 2 colunas "Rótulo:"/valor (3 pessoas)', DOCX, await docx([new Table({ rows })]), expFor(3, ['full_name', 'position']));
  });

  it('ficha de 1 página com 40 pessoas (PDF)', async () => {
    const lines: string[] = []; const exp: Exp = {};
    for (let i = 0; i < 40; i++) {
      const cpf = makeCpf(i + 100);
      lines.push(`Nome: PESSOA${String.fromCharCode(65 + (i % 26))} FICTICIA`.replace(/\d/g, ''), `CPF: ${cpf}`, `Função: CARGO${String.fromCharCode(65 + (i % 26))}`);
      exp[digits(cpf)] = { full_name: `PESSOA${String.fromCharCode(65 + (i % 26))} FICTICIA`, position: `CARGO${String.fromCharCode(65 + (i % 26))}` };
    }
    await check('PDF ficha com 40 pessoas', PDF, await pdf(lines, 5), exp);
  });

  it('T8/T9: tabela DOCX seguida de rodapé/parágrafos sem CPF continua lida', async () => {
    const mk = () => new Table({ rows: [row(['Nome', 'CPF', 'Cargo', 'Admissão']), ...[0, 1].map((i) => row([NOMES[i], CPFS[i], CARGOS[i], ADM[i]]))] });
    const exp = expFor(2);
    const r8 = await check('DOCX T8 tabela + "Observações / Cargo: DIRETOR"', DOCX, await docx([P('Cadastro'), mk(), P('Observações'), P('Cargo: DIRETOR')]), exp);
    const r9 = await check('DOCX T9 tabela + "Nome:/Função:" extras sem CPF', DOCX, await docx([mk(), P('Nome: JOSE FICTICIO'), P('Função: GERENTE')]), exp);
    for (const p of [...r8.people, ...r9.people]) expect(JSON.stringify(p.values)).not.toMatch(/DIRETOR|JOSE|GERENTE/);
  });

  it('tabela DOCX com linha final que CONTÉM CPF aborta', async () => {
    const t = new Table({ rows: [row(['Nome', 'CPF', 'Cargo']), row([NOMES[0], CPFS[0], CARGOS[0]])] });
    const r = await check('DOCX tabela + parágrafo final com CPF (aborta)', DOCX, await docx([t, P(`Contato ${CPFS[1]}`)]), { [digits(CPFS[0])]: { full_name: NOMES[0], position: CARGOS[0] }, [digits(CPFS[1])]: {} });
    expect(r.people.find((p) => p.cpf === digits(CPFS[0]))?.values).toEqual({});
  });
});
