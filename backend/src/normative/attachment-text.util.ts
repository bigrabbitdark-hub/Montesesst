import { PDFParse } from 'pdf-parse';

// Mesma lib e mesmo padrão de classe (não função) já usados em
// normative-monitor.service.ts — pdf-parse v2 é baseado em classe.
const MAX_ATTACHMENT_TEXT_CHARS = 8000;

// Devolve null quando o PDF não tem nenhum texto real extraível (ex.:
// documento escaneado, sem camada de texto) — o chamador decide como
// comunicar isso ao usuário, esta função só relata "não achei texto".
export async function extractPdfText(buffer: Buffer): Promise<string | null> {
  const parser = new PDFParse({ data: buffer });
  try {
    // pageJoiner: '' — sem isso, pdf-parse v2 acrescenta um marcador de
    // fim de página ('\n-- page_number of total_number --') mesmo numa
    // página sem nenhum texto real, então getText() nunca devolveria
    // string vazia pra um PDF escaneado/sem camada de texto (o próprio
    // caso que esta função existe pra detectar).
    const { text } = await parser.getText({ pageJoiner: '' });
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;
    return trimmed.slice(0, MAX_ATTACHMENT_TEXT_CHARS);
  } finally {
    await parser.destroy();
  }
}
