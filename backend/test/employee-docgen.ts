import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';

// Geradores SINTÉTICOS em memória (pdfkit / docx) compartilhados pela bateria extra da Fatia 4 (Task 7).
// Nenhum dado real; CPFs são válidos só pelo dígito verificador.
export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface Cpf { raw: string; fmt: string }

// CPF válido determinístico a partir de um inteiro (nunca repete para n distintos até ~10^5).
export function makeCpf(n: number): Cpf {
  const b = String(100000000 + n * 7919 + 13).slice(0, 9).split('').map(Number);
  const dv = (d: number[]) => { const s = d.reduce((acc, v, i) => acc + v * (d.length + 1 - i), 0); const r = (s * 10) % 11; return r >= 10 ? 0 : r; };
  const d1 = dv(b);
  const d2 = dv([...b, d1]);
  const s = [...b, d1, d2].join('');
  return { raw: s, fmt: `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}` };
}

// Linhas de texto -> PDF. `null` = linha em branco; '\f' = nova página.
export function pdfFromLines(lines: (string | null)[], fontSize = 12): Promise<Buffer> {
  return new Promise((resolve) => {
    const d = new PDFDocument({ size: 'A4', margin: 30 });
    const chunks: Buffer[] = [];
    d.on('data', (c: Buffer) => chunks.push(c));
    d.on('end', () => resolve(Buffer.concat(chunks)));
    d.fontSize(fontSize);
    for (const l of lines) {
      if (l === null) d.moveDown(1);
      else if (l === '\f') d.addPage();
      else d.text(l);
    }
    d.end();
  });
}

export const P = (t: string) => new Paragraph({ children: [new TextRun(t)] });
export async function docxFrom(children: (Paragraph | Table)[]): Promise<Buffer> {
  return Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children }] })));
}
export const tcell = (t: string) => new TableCell({ children: [P(t)] });
export const trow = (cells: string[]) => new TableRow({ children: cells.map(tcell) });
export const dtable = (rows: string[][]) => new Table({ rows: rows.map(trow) });
