import { extractPdfTextFull } from '../pdf/pdf-text.util';
import { extractDocxText, DOCX_MIME_TYPE } from '../docx/docx-text.util';
import { extractXlsxRows, XLSX_MIME_TYPE } from '../xlsx/xlsx-text.util';

// Extraído de PenteFinoExtractorService/DocumentChecklistExtractorService/
// LipAgentExtractorService (Fases 25/27/28), onde essa mesma lógica estava
// triplicada de forma idêntica. Compartilhado aqui porque a checagem de
// audiometria solta no texto bruto do PCMSO (pós-Fase 28) precisa dela pela
// 4ª vez, sem estar ligada a nenhuma extração de IA específica.
export async function extractFullText(mimeType: string, buffer: Buffer): Promise<string | null> {
  if (mimeType === 'application/pdf') return extractPdfTextFull(buffer);
  if (mimeType === DOCX_MIME_TYPE) return extractDocxText(buffer);
  if (mimeType === XLSX_MIME_TYPE) {
    const rows = await extractXlsxRows(buffer);
    return rows.length > 0 ? rows.join('\n') : null;
  }
  return null;
}
