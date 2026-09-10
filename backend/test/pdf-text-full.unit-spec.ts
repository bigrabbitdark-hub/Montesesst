import PDFDocument from 'pdfkit';
import { extractPdfTextFull } from '../src/common/pdf/pdf-text.util';

function buildTestPdf(text: string | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    if (text) doc.text(text);
    doc.end();
  });
}

describe('extractPdfTextFull', () => {
  it('extrai o texto completo sem truncar em 8000 caracteres', async () => {
    const longText = 'A'.repeat(9000);
    const pdf = await buildTestPdf(longText);
    const result = await extractPdfTextFull(pdf);
    expect(result).not.toBeNull();
    expect((result as string).length).toBeGreaterThan(8000);
  });

  it('devolve null pra PDF sem texto real', async () => {
    const blankPdf = await buildTestPdf(null);
    const result = await extractPdfTextFull(blankPdf);
    expect(result).toBeNull();
  });
});
