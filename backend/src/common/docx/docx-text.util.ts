import { Logger } from '@nestjs/common';
import mammoth from 'mammoth';

export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const logger = new Logger('DocxTextUtil');

// Devolve null quando o buffer não é um .docx válido ou não tem texto
// real — o chamador decide como comunicar isso (mesmo padrão de
// extractPdfText/extractPdfTextFull).
export async function extractDocxText(buffer: Buffer): Promise<string | null> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const trimmed = result.value.trim();
    return trimmed.length === 0 ? null : trimmed;
  } catch (err) {
    logger.warn(`Falha ao extrair texto de DOCX: ${(err as Error).message}`);
    return null;
  }
}
