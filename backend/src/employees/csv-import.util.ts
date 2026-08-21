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
  // Guarda a posição REAL de cada linha no arquivo original antes de filtrar
  // linhas em branco — se filtrasse primeiro e numerasse depois, uma única
  // linha em branco no meio do arquivo (comum em exports de planilha) faria
  // o número reportado em `linha` desalinhar de todas as linhas seguintes.
  const rawLines = content.split(/\r\n|\n|\r/);
  const indexed = rawLines
    .map((text, idx) => ({ text, lineNumber: idx + 1 }))
    .filter((entry) => entry.text.length > 0);

  if (indexed.length === 0) return { rows: [], formatError: 'Arquivo vazio' };

  const header = splitCsvLine(indexed[0].text).map((h) => h.toLowerCase());
  const headerMatches = EXPECTED_HEADER.every((col, idx) => header[idx] === col);
  if (!headerMatches) {
    return {
      rows: [],
      formatError: `Cabeçalho inválido — esperado "nome,cpf,cargo,filial", recebido "${indexed[0].text}"`,
    };
  }

  const dataEntries = indexed.slice(1);
  if (dataEntries.length > MAX_IMPORT_ROWS) {
    return {
      rows: [],
      formatError: `Arquivo tem ${dataEntries.length} linhas, o máximo permitido é ${MAX_IMPORT_ROWS}`,
    };
  }

  const rows: ParsedCsvRow[] = dataEntries.map((entry) => {
    const fields = splitCsvLine(entry.text);
    return {
      line: entry.lineNumber,
      full_name: fields[0] ?? '',
      cpf: fields[1] ?? '',
      position: fields[2] ?? '',
      company_unit_name: fields[3] ?? '',
    };
  });

  return { rows };
}
