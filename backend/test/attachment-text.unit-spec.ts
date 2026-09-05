import PDFDocument from 'pdfkit';
import { extractPdfText } from '../src/normative/attachment-text.util';

// Gera um PDF real em memória com pdfkit (mesma lib já usada em
// backend/src/cipa/ata-pdf.util.ts) — dá um conteúdo de texto real e
// conhecido pra testar extração de verdade, sem depender de um
// arquivo .pdf binário fixo no repositório.
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

describe('extractPdfText (unit)', () => {
  it('extrai o texto real de um PDF gerado com conteúdo conhecido', async () => {
    const pdf = await buildTestPdf('Texto de teste para extração real via pdf-parse.');
    const text = await extractPdfText(pdf);
    expect(text).toContain('Texto de teste para extração real via pdf-parse.');
  });

  it('devolve null pra um PDF sem nenhum texto real (ex: escaneado, sem camada de texto)', async () => {
    const pdf = await buildTestPdf(null);
    const text = await extractPdfText(pdf);
    expect(text).toBeNull();
  });

  it('trunca texto muito longo em até 8000 caracteres', async () => {
    const longText = 'A'.repeat(20000);
    const pdf = await buildTestPdf(longText);
    const text = await extractPdfText(pdf);
    expect(text).not.toBeNull();
    expect(text!.length).toBeLessThanOrEqual(8000);
  });

  it('devolve null (em vez de rejeitar) pra um PDF genuinamente corrompido/malformado', async () => {
    const notAPdf = Buffer.from('this is definitely not a pdf file, just plain text bytes');
    await expect(extractPdfText(notAPdf)).resolves.toBeNull();
  });
});
