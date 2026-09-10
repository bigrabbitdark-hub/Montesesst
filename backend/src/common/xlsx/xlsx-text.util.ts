import ExcelJS from 'exceljs';

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Cópia local proposital de cellToText (mesma função de
// employees/spreadsheet-import.util.ts, Fase 22) — mesmo raciocínio já
// usado em normative-answer-shared.ts pra parseRagToolCall: mantém
// common/xlsx sem depender do módulo employees por uma função de 20
// linhas.
function cellToText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString();
  if (typeof cell === 'object') {
    const obj = cell as Record<string, unknown>;
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text?: string }>).map((part) => part.text ?? '').join('').trim();
    }
    if ('result' in obj) {
      return cellToText(obj.result);
    }
    if ('text' in obj && typeof obj.text === 'string') {
      return obj.text.trim();
    }
    if ('error' in obj) {
      return '';
    }
    return '';
  }
  return String(cell).trim();
}

// Cada linha de dado vira uma frase estruturada usando o cabeçalho da
// própria planilha como rótulo de coluna (ver docs/specs/fase-24-...md
// §2) — uma aba pode não ter texto corrido (ex.: tabela de medições de
// ruído por função), então cada linha precisa virar uma unidade de
// texto pesquisável por conta própria, prefixada com o nome da aba.
export async function extractXlsxRows(buffer: Buffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);

    const sentences: string[] = [];
    for (const worksheet of workbook.worksheets) {
      const rows: string[][] = [];
      worksheet.eachRow((row) => {
        const values = row.values as unknown[];
        rows.push(values.slice(1).map((cell) => cellToText(cell)));
      });
      if (rows.length < 2) continue;

      const [headers, ...dataRows] = rows;
      for (const row of dataRows) {
        const parts = headers
          .map((header, i) => (header && row[i] ? `${header}: ${row[i]}` : null))
          .filter((p): p is string => p !== null);
        if (parts.length === 0) continue;
        sentences.push(`Aba: ${worksheet.name} | ${parts.join(' | ')}`);
      }
    }
    return sentences;
  } catch {
    // Cobre tanto workbook.xlsx.load() (buffer não é um .xlsx válido)
    // quanto a iteração de linhas/abas (ex.: tabela de shared-strings
    // corrompida faz o workbook carregar mas eachRow() lançar depois) —
    // mesmo padrão de employees/spreadsheet-import.util.ts, onde o
    // chamador de parseXlsxRows() envolve load() E eachRow() num único
    // try/catch. Nunca deve propagar exceção pro chamador (restrição
    // global da Fase 24: falha de extração sempre vira null/vazio).
    return [];
  }
}
