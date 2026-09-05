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
  } catch {
    // PDF genuinely malformed/corrupto — bytes que não formam um PDF válido
    // de jeito nenhum (ex.: arquivo truncado, ou não-PDF com content-type
    // "application/pdf" falsificado). O load() interno do pdf-parse
    // (chamado dentro de getText()) lança exceções tipadas nesse caso
    // (InvalidPDFException, FormatError...) — diferente do PDF bem formado
    // mas sem camada de texto, já tratado acima via string vazia. Trata os
    // dois casos do mesmo jeito: nenhum texto aproveitável, e deixa o
    // chamador seguir o mesmo caminho de attachment_warning, em vez de
    // propagar uma exceção não tratada (500 cru) pro usuário.
    return null;
  } finally {
    await parser.destroy();
  }
}
