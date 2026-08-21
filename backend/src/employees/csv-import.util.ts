export interface ParsedCsvRow {
  line: number;
  full_name: string;
  cpf: string;
  position: string;
  company_unit_name: string;
}

export interface CsvParseResult {
  rows: ParsedCsvRow[];
  formatError?: string;
}

const EXPECTED_HEADER = ['nome', 'cpf', 'cargo', 'filial'];
export const MAX_IMPORT_ROWS = 2000;

// Split simples respeitando campos entre aspas (pra nome/endereço com
// vírgula) — não é um parser de CSV completo (não lida com aspas
// aninhadas em edge cases exóticos), mas cobre o formato de 4 colunas
// fixas desta importação, que é tudo que este endpoint precisa.
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

export function parseEmployeesCsv(content: string): CsvParseResult {
  const lines = content.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
  if (lines.length === 0) return { rows: [], formatError: 'Arquivo vazio' };

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const headerMatches = EXPECTED_HEADER.every((col, idx) => header[idx] === col);
  if (!headerMatches) {
    return {
      rows: [],
      formatError: `Cabeçalho inválido — esperado "nome,cpf,cargo,filial", recebido "${lines[0]}"`,
    };
  }

  const dataLines = lines.slice(1);
  if (dataLines.length > MAX_IMPORT_ROWS) {
    return {
      rows: [],
      formatError: `Arquivo tem ${dataLines.length} linhas, o máximo permitido é ${MAX_IMPORT_ROWS}`,
    };
  }

  const rows: ParsedCsvRow[] = dataLines.map((line, idx) => {
    const fields = splitCsvLine(line);
    return {
      line: idx + 2, // +1 pro índice 0-based, +1 pela linha de cabeçalho
      full_name: fields[0] ?? '',
      cpf: fields[1] ?? '',
      position: fields[2] ?? '',
      company_unit_name: fields[3] ?? '',
    };
  });

  return { rows };
}
